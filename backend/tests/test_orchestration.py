"""Tests for the bounded LangGraph intake turn workflow."""

from typing import Any

import pytest

from app.models.schemas import (
    EvidenceCriticOutput,
    InterviewAgentOutput,
    OrchestratorOutput,
    ProblemAnalystOutput,
)
from app.services.gemini import GeminiAgents
from app.services.orchestration import run_turn_agents


def test_graph_bounds_evidence_review_and_routes_to_analyst(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    decisions = iter(
        [
            OrchestratorOutput(
                next_action="investigate_claims",
                rationale="Review the reported cause.",
                claims_requiring_review=["A recent release caused the outage."],
            ),
            OrchestratorOutput(
                next_action="investigate_claims",
                rationale="The cause remains unsupported.",
                claims_requiring_review=["The cause is still unclear."],
            ),
        ]
    )
    orchestration_reviews: list[dict[str, Any] | None] = []
    call_order: list[str] = []

    def fake_orchestrate(
        _: GeminiAgents,
        session_context: dict[str, Any],
        latest_user_input: str | None = None,
        evidence_review: dict[str, Any] | None = None,
    ) -> OrchestratorOutput:
        orchestration_reviews.append(evidence_review)
        call_order.append("orchestrate")
        return next(decisions)

    def fake_review(
        _: GeminiAgents,
        session_context: dict[str, Any],
        claims: list[str],
    ) -> EvidenceCriticOutput:
        assert claims == ["A recent release caused the outage."]
        call_order.append("review")
        return EvidenceCriticOutput(
            evidence_assessment="The conversation does not establish the cause.",
            unsupported_claims=["A recent release caused the outage."],
            follow_up_needed=True,
        )

    def fake_analyze(
        _: GeminiAgents,
        session_context: dict[str, Any],
        orchestrator_rationale: str,
        evidence_review: dict[str, Any] | None = None,
    ) -> ProblemAnalystOutput:
        assert orchestrator_rationale == "The cause remains unsupported."
        assert evidence_review is not None
        assert evidence_review["follow_up_needed"] is True
        assert session_context["agent_state"]["evidence_review"] == evidence_review
        call_order.append("analyze")
        return ProblemAnalystOutput(
            analysis="The cause needs clarification.",
            key_gaps=["Evidence connecting cause and incident"],
            recommended_question="What evidence links the release to the outage?",
        )

    def fake_interview(
        _: GeminiAgents,
        session_context: dict[str, Any],
        latest_user_input: str,
        speaker_tag: str | None = None,
        analyst_guidance: str | None = None,
        ready_for_synthesis: bool = False,
    ) -> InterviewAgentOutput:
        assert analyst_guidance == "What evidence links the release to the outage?"
        assert not ready_for_synthesis
        call_order.append("interview")
        return InterviewAgentOutput(
            agent_message=analyst_guidance,
            intake_stage="clarification",
            brief_readiness_score=0.3,
        )

    monkeypatch.setattr(GeminiAgents, "orchestrate", fake_orchestrate)
    monkeypatch.setattr(GeminiAgents, "review_evidence", fake_review)
    monkeypatch.setattr(GeminiAgents, "analyze_problem", fake_analyze)
    monkeypatch.setattr(GeminiAgents, "interview", fake_interview)

    interview, decision, evidence_review, analyst = run_turn_agents(
        GeminiAgents(api_key="test-key"),
        {"agent_state": {}},
        "The release caused the outage.",
        "operations",
    )

    assert call_order == ["orchestrate", "review", "orchestrate", "analyze", "interview"]
    assert evidence_review is not None
    assert orchestration_reviews == [None, evidence_review.model_dump(mode="json")]
    assert decision.next_action == "follow_up"
    assert analyst is not None
    assert interview.agent_message == "What evidence links the release to the outage?"
