"""Session lifecycle and intake orchestration routes."""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.models.entities import (
    IntakeSession,
    SessionRevision,
    SessionTurn as SessionTurnRecord,
)
from app.security import (
    create_session_token,
    has_session_access,
    redact_text,
    redact_value,
)
from app.services.gemini import GeminiAgents, GeminiCallFailed, GeminiNotConfigured
from app.services.orchestration import run_brief_agents, run_turn_agents
from app.models.schemas import (
    CreateSessionRequest,
    GenerateBriefRequest,
    InterviewAgentOutput,
    ProblemBrief,
    ProblemBriefResponse,
    SessionCreateResponse,
    SessionDetailResponse,
    SessionTurn,
    TurnRequest,
    TurnResponse,
)

router = APIRouter(prefix="/sessions", tags=["Sessions"])
bearer_scheme = HTTPBearer(auto_error=False)
BRIEF_READINESS_THRESHOLD = 0.7
INTERNAL_AGENT_STATE_KEY = "_agent_state"


def require_session_access(
    session_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    database: Session = Depends(get_db),
) -> None:
    if not settings.api_auth_enabled:
        return
    token = credentials.credentials if credentials is not None else None
    if not has_session_access(database, session_id, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "SESSION_UNAUTHORIZED",
                "message": "A valid bearer token for this session is required.",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )


def _state_snapshot(session: IntakeSession) -> dict[str, Any]:
    return {
        "status": session.status,
        "user_name": session.user_name,
        "initial_goal": session.initial_goal,
        "intake_stage": session.intake_stage,
        "brief_readiness_score": session.brief_readiness_score,
        "metadata": session.metadata_json,
        "extracted_facts": session.extracted_facts,
        "brief": session.brief_json,
    }


def _record_revision(database: Session, session: IntakeSession) -> None:
    session.state_version += 1
    database.add(
        SessionRevision(
            revision_id=str(uuid.uuid4()),
            session_id=session.session_id,
            revision=session.state_version,
            state_json=_state_snapshot(session),
            created_at=datetime.now(timezone.utc),
        )
    )


def _commit_revision(database: Session) -> None:
    try:
        database.commit()
    except StaleDataError:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SESSION_STATE_CONFLICT",
                "message": "The session changed during this request. Reload it and retry.",
            },
        ) from None


def _session_not_found(session_id: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "code": "SESSION_NOT_FOUND",
            "message": f"Session '{session_id}' not found",
        },
    )


def _gemini_not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "code": "GEMINI_NOT_CONFIGURED",
            "message": "AI processing is unavailable. Configure GEMINI_API_KEY and restart the backend.",
        },
    )


def _gemini_call_failed() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={
            "code": "GEMINI_UPSTREAM_ERROR",
            "message": "The Gemini agent could not complete this request. No result was saved.",
        },
    )


def _session_context(session: IntakeSession) -> dict[str, Any]:
    extracted_facts = dict(session.extracted_facts)
    agent_state = extracted_facts.pop(INTERNAL_AGENT_STATE_KEY, {})
    return {
        "session_id": session.session_id,
        "user_name": session.user_name,
        "initial_goal": session.initial_goal,
        "intake_stage": session.intake_stage,
        "extracted_facts": extracted_facts,
        "agent_state": agent_state,
        "brief_readiness_score": session.brief_readiness_score,
        "turns": [
            {
                "role": turn.role,
                "agent_name": turn.agent_name,
                "message": turn.message,
                "timestamp": turn.timestamp.isoformat(),
            }
            for turn in session.turns
        ],
    }


def _public_extracted_facts(session: IntakeSession) -> dict[str, Any]:
    return {
        key: value
        for key, value in session.extracted_facts.items()
        if key != INTERNAL_AGENT_STATE_KEY
    }


@router.post(
    "",
    response_model=SessionCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new problem intake session",
)
def create_session(
    payload: CreateSessionRequest,
    database: Session = Depends(get_db),
) -> SessionCreateResponse:
    """Create a durable session with isolated state."""
    now = datetime.now(timezone.utc)
    session = IntakeSession(
        session_id=f"sess_{uuid.uuid4().hex}",
        status="active",
        user_name=redact_text(payload.user_name) if payload.user_name else None,
        initial_goal=redact_text(payload.initial_goal) if payload.initial_goal else None,
        intake_stage="discovery",
        created_at=now,
        updated_at=now,
        brief_readiness_score=0.0,
        metadata_json=redact_value(payload.metadata),
        extracted_facts={},
    )
    database.add(session)
    database.flush()
    access_token, token_expires_at = create_session_token(database, session.session_id)
    database.add(
        SessionRevision(
            revision_id=str(uuid.uuid4()),
            session_id=session.session_id,
            revision=1,
            state_json=_state_snapshot(session),
            created_at=now,
        )
    )
    database.commit()

    return SessionCreateResponse(
        session_id=session.session_id,
        status=session.status,
        created_at=session.created_at,
        updated_at=session.updated_at,
        user_name=session.user_name,
        intake_stage=session.intake_stage,
        turn_count=0,
        metadata=session.metadata_json,
        access_token=access_token,
        token_expires_at=token_expires_at,
    )


@router.post(
    "/{session_id}/turn",
    response_model=TurnResponse,
    summary="Submit a conversational turn to the intake orchestrator",
)
def process_turn(
    session_id: str,
    payload: TurnRequest,
    database: Session = Depends(get_db),
    _: None = Depends(require_session_access),
) -> TurnResponse:
    """Run InterviewerAgent and persist a user/agent pair only on success."""
    session = database.scalar(
        select(IntakeSession)
        .options(selectinload(IntakeSession.turns))
        .where(IntakeSession.session_id == session_id)
    )
    if session is None:
        raise _session_not_found(session_id)
    if session.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SESSION_COMPLETED",
                "message": "This intake session is completed and cannot accept additional turns.",
            },
        )

    timestamp = datetime.now(timezone.utc)
    user_timestamp = payload.client_timestamp or timestamp
    if user_timestamp.tzinfo is None:
        user_timestamp = user_timestamp.replace(tzinfo=timezone.utc)

    context = _session_context(session)
    clean_user_input = redact_text(payload.user_input)
    try:
        result, decision, evidence_review, analyst = run_turn_agents(
            GeminiAgents(),
            context,
            clean_user_input,
            payload.speaker_tag,
        )
    except GeminiNotConfigured:
        raise _gemini_not_configured() from None
    except GeminiCallFailed:
        raise _gemini_call_failed() from None

    turn_number = sum(turn.role == "user" for turn in session.turns) + 1
    turn_id = f"turn_{turn_number:03d}"
    database.add_all(
        [
            # The transaction records both sides together; a failed AI call records neither.
            SessionTurnRecord(
                turn_id=f"{turn_id}_req",
                session_id=session_id,
                role="user",
                message=clean_user_input,
                timestamp=user_timestamp,
            ),
            SessionTurnRecord(
                turn_id=f"{turn_id}_res",
                session_id=session_id,
                role="agent",
                agent_name="InterviewerAgent",
                message=redact_text(result.agent_message),
                timestamp=timestamp,
            ),
        ]
    )
    session.intake_stage = result.intake_stage
    internal_state = dict(context.get("agent_state", {}))
    internal_state["orchestrator"] = decision.model_dump(mode="json")
    if evidence_review is not None:
        internal_state["evidence_review"] = evidence_review.model_dump(mode="json")
    if analyst is not None:
        internal_state["problem_analysis"] = analyst.model_dump(mode="json")
    facts = _public_extracted_facts(session)
    facts.update(redact_value(result.extracted_facts))
    session.extracted_facts = {
        **facts,
        INTERNAL_AGENT_STATE_KEY: redact_value(internal_state),
    }
    session.brief_readiness_score = result.brief_readiness_score
    session.updated_at = timestamp
    _record_revision(database, session)
    _commit_revision(database)

    return TurnResponse(
        session_id=session_id,
        turn_id=turn_id,
        agent_role="InterviewerAgent",
        agent_message=redact_text(result.agent_message),
        intake_stage=result.intake_stage,
        extracted_facts=redact_value(facts),
        suggested_next_steps=redact_value(result.suggested_next_steps),
        brief_readiness_score=result.brief_readiness_score,
        timestamp=timestamp,
    )


@router.get(
    "/{session_id}",
    response_model=SessionDetailResponse,
    summary="Get session details and conversation history",
)
def get_session(
    session_id: str,
    database: Session = Depends(get_db),
    _: None = Depends(require_session_access),
) -> SessionDetailResponse:
    """Retrieve state only for the requested session."""
    session = database.scalar(
        select(IntakeSession)
        .options(selectinload(IntakeSession.turns))
        .where(IntakeSession.session_id == session_id)
    )
    if session is None:
        raise _session_not_found(session_id)

    return SessionDetailResponse(
        session_id=session.session_id,
        status=session.status,
        user_name=session.user_name,
        intake_stage=session.intake_stage,
        created_at=session.created_at,
        updated_at=session.updated_at,
        brief_readiness_score=session.brief_readiness_score,
        turns=[
            SessionTurn(
                turn_id=turn.turn_id,
                role=turn.role,
                agent_name=turn.agent_name,
                message=turn.message,
                timestamp=turn.timestamp,
            )
            for turn in session.turns
        ],
        extracted_facts=_public_extracted_facts(session),
        brief=ProblemBrief.model_validate(session.brief_json) if session.brief_json else None,
        metadata=session.metadata_json,
    )


@router.post(
    "/{session_id}/brief",
    response_model=ProblemBriefResponse,
    summary="Synthesize and finalize a problem brief",
)
def generate_brief(
    session_id: str,
    payload: GenerateBriefRequest,
    database: Session = Depends(get_db),
    _: None = Depends(require_session_access),
) -> ProblemBriefResponse:
    """Run ProblemBriefAgent and persist its validated output."""
    session = database.scalar(
        select(IntakeSession)
        .options(selectinload(IntakeSession.turns))
        .where(IntakeSession.session_id == session_id)
    )
    if session is None:
        raise _session_not_found(session_id)

    if (
        (not session.turns or session.brief_readiness_score < BRIEF_READINESS_THRESHOLD)
        and not payload.force_synthesis
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INSUFFICIENT_INTAKE_DATA",
                "message": (
                    "The intake does not meet the brief readiness threshold. "
                    f"Current score: {session.brief_readiness_score:.2f}; required: "
                    f"{BRIEF_READINESS_THRESHOLD:.2f}. Set force_synthesis=true to bypass."
                ),
                "details": {
                    "readiness_score": session.brief_readiness_score,
                    "required_score": BRIEF_READINESS_THRESHOLD,
                },
            },
        )

    try:
        context = _session_context(session)
        latest_user_input = next(
            (turn.message for turn in reversed(session.turns) if turn.role == "user"),
            session.initial_goal or "",
        )
        result, validation_issues, analyst, follow_up = run_brief_agents(
            agents=GeminiAgents(),
            context=context,
            additional_notes=(
                redact_text(payload.additional_notes)
                if payload.additional_notes
                else None
            ),
            latest_user_input=latest_user_input,
            force_synthesis=payload.force_synthesis,
            readiness_threshold=BRIEF_READINESS_THRESHOLD,
        )
    except GeminiNotConfigured:
        raise _gemini_not_configured() from None
    except GeminiCallFailed:
        raise _gemini_call_failed() from None

    if follow_up is not None:
        if analyst is None:
            raise RuntimeError("Brief validation requested follow-up without analysis.")
        now = datetime.now(timezone.utc)
        follow_up_id = f"validation_{uuid.uuid4().hex[:12]}"
        database.add(
            SessionTurnRecord(
                turn_id=follow_up_id,
                session_id=session_id,
                role="agent",
                agent_name="InterviewerAgent",
                message=follow_up.agent_message,
                timestamp=now,
            )
        )
        facts = _public_extracted_facts(session)
        internal_state = dict(context.get("agent_state", {}))
        internal_state["problem_analysis"] = analyst.model_dump(mode="json")
        internal_state["validation_issues"] = validation_issues
        session.extracted_facts = redact_value({
            **facts,
            INTERNAL_AGENT_STATE_KEY: internal_state,
        })
        session.intake_stage = "validation"
        session.brief_readiness_score = min(
            follow_up.brief_readiness_score,
            BRIEF_READINESS_THRESHOLD - 0.01,
        )
        session.updated_at = now
        _record_revision(database, session)
        _commit_revision(database)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "BRIEF_VALIDATION_FAILED",
                "message": "More information is needed before the brief can pass validation.",
                "details": {
                    "validation_issues": validation_issues,
                    "follow_up_question": follow_up.agent_message,
                    "session_id": session_id,
                },
            },
        )

    now = datetime.now(timezone.utc)
    brief_id = f"brf_{uuid.uuid4().hex}"
    session.brief_json = redact_value(result.brief.model_dump(mode="json"))
    session.brief_readiness_score = result.readiness_score
    session.status = "completed"
    session.intake_stage = "ready"
    session.updated_at = now
    _record_revision(database, session)
    _commit_revision(database)

    return ProblemBriefResponse(
        session_id=session_id,
        brief_id=brief_id,
        generated_at=now,
        readiness_score=result.readiness_score,
        brief=ProblemBrief.model_validate(session.brief_json),
    )
