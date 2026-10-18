"""API tests using an isolated in-memory SQLite database."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

from app import database
from app.config import settings
from app.database import Base
from app.middleware import request_guard
from app.main import app
from app.models.entities import IntakeSession, SessionCredential, SessionRevision
from app.models.schemas import (
    EvidenceCriticOutput,
    InterviewAgentOutput,
    OrchestratorOutput,
    ProblemAnalystOutput,
    ProblemBrief,
    SynthesisValidationOutput,
)
from app.services.gemini import GeminiAgents, GeminiCallFailed
from app.security import hash_token, redact_text


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    monkeypatch.setattr(settings, "gemini_api_key", None)
    monkeypatch.setattr(settings, "sarvam_api_key", None)
    monkeypatch.setattr(settings, "api_auth_enabled", False)
    monkeypatch.setattr(settings, "rate_limit_requests_per_minute", 10_000)
    monkeypatch.setattr(settings, "rate_limit_session_creation_per_hour", 1_000)
    request_guard.reset()
    test_engine = create_engine(
        URL.create("sqlite", database=str(tmp_path / "test.db")),
        connect_args={"check_same_thread": False},
    )
    test_session_local = sessionmaker(
        bind=test_engine,
        autoflush=False,
        expire_on_commit=False,
    )
    monkeypatch.setattr(database, "engine", test_engine)
    monkeypatch.setattr(database, "SessionLocal", test_session_local)
    Base.metadata.create_all(bind=test_engine)

    with TestClient(app) as test_client:
        yield test_client

    request_guard.reset()
    test_engine.dispose()


def test_health_reports_database_and_orchestrator_state(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["services"] == {
        "session_store": "ready",
        "agent_orchestrator": "not_configured",
    }
    assert payload["version"] == "0.1.0"
    assert client.get("/api/v1/health").status_code == 200


def test_health_reports_gemini_configuration_without_calling_the_provider(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "gemini_api_key", "configured-test-key")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
    assert response.json()["services"]["agent_orchestrator"] == "configured"


def test_create_session_persists_state_and_keeps_sessions_isolated(client: TestClient) -> None:
    first = client.post(
        "/sessions",
        json={
            "user_name": "Alex",
            "initial_goal": "Investigate payment errors",
            "metadata": {"channel": "voice"},
        },
    )
    second = client.post("/api/v1/sessions", json={"metadata": {"channel": "text"}})

    assert first.status_code == 201
    assert second.status_code == 201
    first_session = first.json()
    assert first_session["turn_count"] == 0
    assert first_session["access_token"]
    assert first_session["token_type"] == "bearer"
    assert first_session["metadata"] == {"channel": "voice"}
    assert first_session["session_id"] != second.json()["session_id"]

    detail = client.get(f"/sessions/{first_session['session_id']}")
    assert detail.status_code == 200
    assert detail.json()["user_name"] == "Alex"
    assert detail.json()["metadata"] == {"channel": "voice"}
    assert detail.json()["turns"] == []
    assert detail.json()["created_at"].endswith("Z")

    other_detail = client.get(f"/sessions/{second.json()['session_id']}")
    assert other_detail.json()["metadata"] == {"channel": "text"}
    assert other_detail.json()["user_name"] is None
    with database.SessionLocal() as db:
        credential = db.get(SessionCredential, first_session["session_id"])
        session = db.get(IntakeSession, first_session["session_id"])
        revisions = db.query(SessionRevision).filter_by(
            session_id=first_session["session_id"]
        ).all()
        assert credential is not None
        assert credential.token_hash == hash_token(first_session["access_token"])
        assert first_session["access_token"] not in credential.token_hash
        assert session is not None and session.state_version == 1
        assert [revision.revision for revision in revisions] == [1]


def test_session_bearer_tokens_enforce_session_isolation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "api_auth_enabled", True)
    first = client.post("/sessions", json={}).json()
    second = client.post("/sessions", json={}).json()

    assert client.get(f"/sessions/{first['session_id']}").status_code == 401
    first_headers = {"Authorization": f"Bearer {first['access_token']}"}
    second_headers = {"Authorization": f"Bearer {second['access_token']}"}
    assert client.get(f"/sessions/{first['session_id']}", headers=first_headers).status_code == 200
    assert client.get(f"/sessions/{second['session_id']}", headers=first_headers).status_code == 401
    assert client.get(f"/sessions/{second['session_id']}", headers=second_headers).status_code == 200


def test_create_session_redacts_common_pii_before_storage(client: TestClient) -> None:
    response = client.post(
        "/sessions",
        json={
            "user_name": "alex@example.com",
            "initial_goal": "Call me at 9876543210",
            "metadata": {"contact": "alex@example.com"},
        },
    )

    assert response.status_code == 201
    result = response.json()
    assert result["user_name"] == "[REDACTED_EMAIL]"
    assert result["metadata"]["contact"] == "[REDACTED_EMAIL]"
    with database.SessionLocal() as db:
        stored = db.get(IntakeSession, result["session_id"])
        assert stored is not None
        assert stored.initial_goal == "Call me at [REDACTED_PHONE]"
        assert "alex@example.com" not in str(stored.metadata_json)
    assert redact_text("Card 4111 1111 1111 1111") == "Card [REDACTED_CARD]"


def test_rate_limit_returns_standard_error(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_requests_per_minute", 1)
    request_guard.reset()

    assert client.get("/health").status_code == 200
    limited = client.get("/health")

    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "REQUEST_RATE_LIMITED"
    assert limited.headers["retry-after"] == "60"


def test_session_creation_has_an_independent_quota(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rate_limit_session_creation_per_hour", 1)
    request_guard.reset()

    assert client.post("/sessions", json={}).status_code == 201
    limited = client.post("/sessions", json={})

    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "SESSION_CREATION_RATE_LIMITED"
    assert int(limited.headers["retry-after"]) >= 1


def test_voice_routes_fail_explicitly_without_sarvam_credentials(client: TestClient) -> None:
    created = client.post("/sessions", json={}).json()
    audio = client.post(
        f"/sessions/{created['session_id']}/transcribe",
        files={"file": ("sample.wav", b"audio data", "audio/wav")},
    )
    speech = client.post(
        f"/sessions/{created['session_id']}/speak",
        json={"text": "Hello"},
    )

    assert audio.status_code == 503
    assert audio.json()["error"]["code"] == "SARVAM_NOT_CONFIGURED"
    assert speech.status_code == 503
    assert speech.json()["error"]["code"] == "SARVAM_NOT_CONFIGURED"


def test_voice_routes_reject_invalid_payloads(client: TestClient) -> None:
    created = client.post("/sessions", json={}).json()
    invalid_audio = client.post(
        f"/sessions/{created['session_id']}/transcribe",
        files={"file": ("sample.txt", b"not audio", "text/plain")},
    )
    blank_speech = client.post(
        f"/sessions/{created['session_id']}/speak",
        json={"text": "   "},
    )
    invalid_language = client.post(
        f"/sessions/{created['session_id']}/speak",
        json={"text": "Hello", "language_code": "not-a-language"},
    )

    assert invalid_audio.status_code == 415
    assert invalid_audio.json()["error"]["code"] == "UNSUPPORTED_AUDIO_TYPE"
    assert blank_speech.status_code == 422
    assert invalid_language.status_code == 422


def test_voice_ticket_is_one_use_and_transcripts_are_redacted(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models.entities import VoiceTicket
    from app.routers import voice

    created = client.post("/sessions", json={}).json()
    async def fake_transcribe(*_: object) -> tuple[str, str]:
        return "Contact me at user@example.com", "en-IN"

    monkeypatch.setattr(voice, "transcribe", fake_transcribe)
    response = client.post(
        f"/sessions/{created['session_id']}/transcribe",
        files={"file": ("sample.wav", b"audio data", "audio/wav")},
    )
    assert response.status_code == 200
    assert response.json()["transcript"] == "Contact me at [REDACTED_EMAIL]"

    ticket_response = client.post(
        f"/sessions/{created['session_id']}/voice-ticket"
    )
    assert ticket_response.status_code == 200
    ticket = ticket_response.json()["ticket"]
    with database.SessionLocal() as db:
        record = db.query(VoiceTicket).one()
        assert record.ticket_hash == hash_token(ticket)
        assert ticket not in record.ticket_hash
        from app.security import consume_voice_ticket

        assert consume_voice_ticket(db, created["session_id"], ticket)
        assert not consume_voice_ticket(db, created["session_id"], ticket)


def test_realtime_voice_frames_redact_text_and_reject_non_json() -> None:
    import json

    from app.routers.voice import (
        _prepare_realtime_input,
        _redact_realtime_transcript,
    )

    outbound = json.loads(
        _prepare_realtime_input(
            '{"event":"audio_input","audio":"base64-audio",'
            '"prompt":"Contact user@example.com"}'
        )
    )
    inbound = json.loads(
        _redact_realtime_transcript(
            '{"event":"transcript","text":"Email user@example.com"}'
        )
    )

    assert outbound["audio"] == "base64-audio"
    assert outbound["prompt"] == "Contact [REDACTED_EMAIL]"
    assert inbound["text"] == "Email [REDACTED_EMAIL]"
    with pytest.raises(ValueError):
        _prepare_realtime_input('"not an object"')


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"user_input": ""},
        {"user_input": "   "},
        {"user_input": "hello", "unexpected": True},
    ],
)
def test_invalid_turn_requests_return_contract_error(
    client: TestClient,
    body: dict[str, object],
) -> None:
    response = client.post("/sessions/sess_unknown/turn", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"]["errors"]


def test_turn_returns_explicit_configuration_error_without_api_key(client: TestClient) -> None:
    created = client.post("/sessions", json={}).json()

    response = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "Payments are timing out"},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "GEMINI_NOT_CONFIGURED"
    assert client.get(f"/sessions/{created['session_id']}").json()["turns"] == []


def test_missing_sessions_and_unavailable_brief_use_explicit_errors(client: TestClient) -> None:
    missing = client.get("/sessions/sess_missing")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SESSION_NOT_FOUND"

    created = client.post("/sessions", json={}).json()
    insufficient = client.post(f"/sessions/{created['session_id']}/brief", json={})
    assert insufficient.status_code == 400
    assert insufficient.json()["error"]["code"] == "INSUFFICIENT_INTAKE_DATA"

    forced = client.post(
        f"/sessions/{created['session_id']}/brief",
        json={"force_synthesis": True},
    )
    assert forced.status_code == 503
    assert forced.json()["error"]["code"] == "GEMINI_NOT_CONFIGURED"


def test_gemini_turn_result_is_saved_as_a_paired_conversation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post(
        "/sessions",
        json={"initial_goal": "Investigate payment errors"},
    ).json()

    def fake_interview(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str,
        speaker_tag: str | None = None,
        analyst_guidance: str | None = None,
        ready_for_synthesis: bool = False,
    ) -> InterviewAgentOutput:
        assert session_context["initial_goal"] == "Investigate payment errors"
        assert latest_user_input == "Payments time out at peak hours"
        assert speaker_tag == "operations"
        assert analyst_guidance == "When did this begin?"
        return InterviewAgentOutput(
            agent_message="When did these timeouts first begin?",
            intake_stage="clarification",
            extracted_facts={"symptom": "payment timeouts", "trigger": "peak hours"},
            suggested_next_steps=["Identify when the issue began"],
            brief_readiness_score=0.4,
        )

    def fake_orchestrate(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str | None = None,
        evidence_review: dict[str, object] | None = None,
    ) -> OrchestratorOutput:
        return OrchestratorOutput(
            next_action="follow_up",
            rationale="The timeline is unknown.",
        )

    def fake_analyze(
        _: GeminiAgents,
        session_context: dict[str, object],
        orchestrator_rationale: str,
        evidence_review: dict[str, object] | None = None,
    ) -> ProblemAnalystOutput:
        return ProblemAnalystOutput(
            analysis="The onset time is not known.",
            key_gaps=["Start time"],
            recommended_question="When did this begin?",
        )

    monkeypatch.setattr(GeminiAgents, "orchestrate", fake_orchestrate)
    monkeypatch.setattr(GeminiAgents, "analyze_problem", fake_analyze)
    monkeypatch.setattr(GeminiAgents, "interview", fake_interview)
    response = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={
            "user_input": "Payments time out at peak hours",
            "speaker_tag": "operations",
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["agent_role"] == "InterviewerAgent"
    assert result["turn_id"] == "turn_001"
    assert result["extracted_facts"]["symptom"] == "payment timeouts"
    detail = client.get(f"/sessions/{created['session_id']}").json()
    assert [turn["role"] for turn in detail["turns"]] == ["user", "agent"]
    assert [turn["turn_id"] for turn in detail["turns"]] == [
        "turn_001_req",
        "turn_001_res",
    ]
    assert detail["brief_readiness_score"] == 0.4
    with database.SessionLocal() as db:
        stored = db.get(IntakeSession, created["session_id"])
        revisions = (
            db.query(SessionRevision)
            .filter_by(session_id=created["session_id"])
            .order_by(SessionRevision.revision)
            .all()
        )
        assert stored is not None and stored.state_version == 2
        assert [revision.revision for revision in revisions] == [1, 2]


def test_failed_gemini_call_does_not_persist_a_partial_turn(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post("/sessions", json={}).json()

    def failed_orchestration(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str | None = None,
        evidence_review: dict[str, object] | None = None,
    ) -> OrchestratorOutput:
        raise GeminiCallFailed("upstream unavailable")

    monkeypatch.setattr(GeminiAgents, "orchestrate", failed_orchestration)
    response = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "Payments time out"},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "GEMINI_UPSTREAM_ERROR"
    assert client.get(f"/sessions/{created['session_id']}").json()["turns"] == []


def test_brief_agent_synthesizes_and_persists_structured_result(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post("/sessions", json={}).json()

    def fake_interview(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str,
        speaker_tag: str | None = None,
        analyst_guidance: str | None = None,
        ready_for_synthesis: bool = False,
    ) -> InterviewAgentOutput:
        return InterviewAgentOutput(
            agent_message="How many transactions are affected?",
            intake_stage="ready",
            extracted_facts={"symptom": "payment timeouts"},
            suggested_next_steps=[],
            brief_readiness_score=0.9,
        )

    def fake_orchestrate(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str | None = None,
        evidence_review: dict[str, object] | None = None,
    ) -> OrchestratorOutput:
        return OrchestratorOutput(
            next_action="ready_for_synthesis",
            rationale="The issue and impact are sufficiently clear.",
        )

    def fake_synthesize_validate(
        _: GeminiAgents,
        session_context: dict[str, object],
        additional_notes: str | None,
    ) -> SynthesisValidationOutput:
        assert additional_notes == "Escalated by operations"
        return SynthesisValidationOutput(
            passed_validation=True,
            readiness_score=0.92,
            brief=ProblemBrief(
                title="Payment timeouts",
                summary="Payment timeouts were reported; scale is not yet confirmed.",
                problem_statement="Users report payment timeouts.",
                severity="MEDIUM",
                root_causes_hypotheses=["Cause is unknown from the available interview."],
            ),
        )

    monkeypatch.setattr(GeminiAgents, "orchestrate", fake_orchestrate)
    monkeypatch.setattr(GeminiAgents, "interview", fake_interview)
    monkeypatch.setattr(GeminiAgents, "synthesize_and_validate", fake_synthesize_validate)
    turn = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "Payments time out"},
    )
    assert turn.status_code == 200

    response = client.post(
        f"/sessions/{created['session_id']}/brief",
        json={"additional_notes": "Escalated by operations"},
    )

    assert response.status_code == 200
    assert response.json()["readiness_score"] == 0.92
    assert response.json()["brief"]["title"] == "Payment timeouts"
    detail = client.get(f"/sessions/{created['session_id']}").json()
    assert detail["status"] == "completed"
    assert detail["brief"]["problem_statement"] == "Users report payment timeouts."
    rejected_turn = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "Another message"},
    )
    assert rejected_turn.status_code == 409


def test_orchestrator_routes_claims_through_critic_and_analyst(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post("/sessions", json={}).json()
    decisions = iter(
        [
            OrchestratorOutput(
                next_action="investigate_claims",
                rationale="Review the claimed cause.",
                claims_requiring_review=["The bank gateway caused the outage."],
            ),
            OrchestratorOutput(
                next_action="follow_up",
                rationale="The gateway cause is unverified.",
            ),
        ]
    )

    def fake_orchestrate(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str | None = None,
        evidence_review: dict[str, object] | None = None,
    ) -> OrchestratorOutput:
        result = next(decisions)
        if evidence_review is not None:
            assert evidence_review["unsupported_claims"] == [
                "The bank gateway cause is unverified."
            ]
        return result

    def fake_review(
        _: GeminiAgents,
        session_context: dict[str, object],
        claims: list[str],
    ) -> EvidenceCriticOutput:
        assert claims == ["The bank gateway caused the outage."]
        return EvidenceCriticOutput(
            evidence_assessment="The interview does not provide corroboration.",
            unsupported_claims=["The bank gateway cause is unverified."],
            follow_up_needed=True,
        )

    def fake_analyze(
        _: GeminiAgents,
        session_context: dict[str, object],
        orchestrator_rationale: str,
        evidence_review: dict[str, object] | None = None,
    ) -> ProblemAnalystOutput:
        assert evidence_review["follow_up_needed"] is True
        return ProblemAnalystOutput(
            analysis="The proposed cause has not been established.",
            key_gaps=["Evidence for the gateway cause"],
            recommended_question="What evidence connects the gateway to the outage?",
        )

    def fake_interview(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str,
        speaker_tag: str | None = None,
        analyst_guidance: str | None = None,
        ready_for_synthesis: bool = False,
    ) -> InterviewAgentOutput:
        assert analyst_guidance == "What evidence connects the gateway to the outage?"
        return InterviewAgentOutput(
            agent_message=analyst_guidance,
            intake_stage="clarification",
            extracted_facts={"reported_symptom": "payment failures"},
            suggested_next_steps=["Clarify the alleged gateway cause"],
            brief_readiness_score=0.25,
        )

    monkeypatch.setattr(GeminiAgents, "orchestrate", fake_orchestrate)
    monkeypatch.setattr(GeminiAgents, "review_evidence", fake_review)
    monkeypatch.setattr(GeminiAgents, "analyze_problem", fake_analyze)
    monkeypatch.setattr(GeminiAgents, "interview", fake_interview)

    response = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "The bank gateway caused the outage."},
    )

    assert response.status_code == 200
    assert response.json()["agent_message"] == (
        "What evidence connects the gateway to the outage?"
    )
    detail = client.get(f"/sessions/{created['session_id']}").json()
    assert detail["extracted_facts"] == {"reported_symptom": "payment failures"}


def test_failed_brief_validation_saves_a_follow_up_and_keeps_session_open(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post("/sessions", json={}).json()

    def fake_orchestrate(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str | None = None,
        evidence_review: dict[str, object] | None = None,
    ) -> OrchestratorOutput:
        return OrchestratorOutput(
            next_action="ready_for_synthesis",
            rationale="Ready for a validation pass.",
        )

    def fake_interview(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str,
        speaker_tag: str | None = None,
        analyst_guidance: str | None = None,
        ready_for_synthesis: bool = False,
    ) -> InterviewAgentOutput:
        return InterviewAgentOutput(
            agent_message=(
                "The intake is ready for a brief."
                if ready_for_synthesis
                else "How many transactions were affected?"
            ),
            intake_stage="ready" if ready_for_synthesis else "clarification",
            extracted_facts={"symptom": "payment timeouts"},
            suggested_next_steps=[],
            brief_readiness_score=0.9,
        )

    def failed_validation(
        _: GeminiAgents,
        session_context: dict[str, object],
        additional_notes: str | None,
    ) -> SynthesisValidationOutput:
        return SynthesisValidationOutput(
            passed_validation=False,
            readiness_score=0.9,
            validation_issues=["The affected transaction volume is unknown."],
            brief=ProblemBrief(
                title="Payment timeouts",
                summary="Payment timeouts were reported.",
                problem_statement="Users report payment timeouts.",
            ),
        )

    def fake_analyze(
        _: GeminiAgents,
        session_context: dict[str, object],
        orchestrator_rationale: str,
        evidence_review: dict[str, object] | None = None,
    ) -> ProblemAnalystOutput:
        assert "affected transaction volume" in orchestrator_rationale
        return ProblemAnalystOutput(
            analysis="The impact cannot be quantified.",
            key_gaps=["Affected transaction count"],
            recommended_question="How many transactions were affected?",
        )

    monkeypatch.setattr(GeminiAgents, "orchestrate", fake_orchestrate)
    monkeypatch.setattr(GeminiAgents, "interview", fake_interview)
    monkeypatch.setattr(GeminiAgents, "synthesize_and_validate", failed_validation)
    monkeypatch.setattr(GeminiAgents, "analyze_problem", fake_analyze)
    turn = client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "Payments are timing out"},
    )
    assert turn.status_code == 200

    response = client.post(f"/sessions/{created['session_id']}/brief", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BRIEF_VALIDATION_FAILED"
    assert response.json()["error"]["details"]["follow_up_question"] == (
        "How many transactions were affected?"
    )
    detail = client.get(f"/sessions/{created['session_id']}").json()
    assert detail["status"] == "active"
    assert detail["brief"] is None
    assert detail["intake_stage"] == "validation"
    assert detail["turns"][-1]["agent_name"] == "InterviewerAgent"
    assert detail["turns"][-1]["message"] == "How many transactions were affected?"


def test_brief_agent_low_readiness_is_not_saved_without_force(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post("/sessions", json={}).json()

    def fake_interview(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str,
        speaker_tag: str | None = None,
        analyst_guidance: str | None = None,
        ready_for_synthesis: bool = False,
    ) -> InterviewAgentOutput:
        return InterviewAgentOutput(
            agent_message="What else should we know?",
            intake_stage="clarification",
            extracted_facts={},
            suggested_next_steps=[],
            brief_readiness_score=0.9,
        )

    def fake_orchestrate(
        _: GeminiAgents,
        session_context: dict[str, object],
        latest_user_input: str | None = None,
        evidence_review: dict[str, object] | None = None,
    ) -> OrchestratorOutput:
        return OrchestratorOutput(
            next_action="ready_for_synthesis",
            rationale="Sufficient details were gathered.",
        )

    def low_readiness_brief(
        _: GeminiAgents,
        session_context: dict[str, object],
        additional_notes: str | None,
    ) -> SynthesisValidationOutput:
        return SynthesisValidationOutput(
            passed_validation=True,
            readiness_score=0.2,
            brief=ProblemBrief(
                title="Unresolved issue",
                summary="Not enough details were captured.",
                problem_statement="Details remain unclear.",
            ),
        )

    def fake_analyze(
        _: GeminiAgents,
        session_context: dict[str, object],
        orchestrator_rationale: str,
        evidence_review: dict[str, object] | None = None,
    ) -> ProblemAnalystOutput:
        return ProblemAnalystOutput(
            analysis="More information is needed.",
            key_gaps=["Problem details"],
            recommended_question="What else should we know?",
        )

    monkeypatch.setattr(GeminiAgents, "orchestrate", fake_orchestrate)
    monkeypatch.setattr(GeminiAgents, "interview", fake_interview)
    monkeypatch.setattr(GeminiAgents, "analyze_problem", fake_analyze)
    monkeypatch.setattr(GeminiAgents, "synthesize_and_validate", low_readiness_brief)
    client.post(
        f"/sessions/{created['session_id']}/turn",
        json={"user_input": "Something is wrong"},
    )

    response = client.post(f"/sessions/{created['session_id']}/brief", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BRIEF_VALIDATION_FAILED"
    detail = client.get(f"/sessions/{created['session_id']}").json()
    assert detail["status"] == "active"
    assert detail["brief"] is None
