"""Pydantic schemas matching the API contract."""
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Health Schemas
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str = Field(default="healthy", description="System health status")
    version: str = Field(default="0.1.0", description="Application version")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of the check",
    )
    services: dict[str, str] = Field(
        default_factory=dict,
        description="Subsystem operational readiness",
    )


# ---------------------------------------------------------------------------
# Session Schemas
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_name: str | None = Field(default=None, max_length=200, description="Optional name of the user/caller")
    initial_goal: str | None = Field(default=None, max_length=10000, description="Initial problem context or goal")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary client metadata")


class SessionCreateResponse(BaseModel):
    session_id: str
    status: str = "active"
    created_at: datetime
    updated_at: datetime
    user_name: str | None = None
    intake_stage: str = "discovery"
    turn_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    token_expires_at: datetime


class VoiceTicketResponse(BaseModel):
    ticket: str
    expires_in_seconds: int = 60


class TranscriptionResponse(BaseModel):
    transcript: str
    language_code: str | None = None


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=2500)
    language_code: str = Field(
        default="en-IN",
        min_length=2,
        max_length=10,
        pattern=r"^(?:unknown|[a-z]{2}(?:-[A-Z]{2})?)$",
    )

    @field_validator("text")
    @classmethod
    def speech_text_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class SessionTurn(BaseModel):
    turn_id: str
    role: str = Field(description="'user' or 'agent'")
    agent_name: str | None = None
    message: str
    timestamp: datetime


# ---------------------------------------------------------------------------
# Turn Schemas
# ---------------------------------------------------------------------------

class TurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_input: str = Field(..., min_length=1, description="Transcribed speech or text input from user")
    audio_payload: str | None = Field(default=None, description="Base64 encoded audio chunk or audio ID")
    speaker_tag: str | None = Field(default="user", max_length=100, description="Speaker identifier")
    client_timestamp: datetime | None = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("user_input")
    @classmethod
    def user_input_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("user_input must not be blank")
        return value


class TurnResponse(BaseModel):
    session_id: str
    turn_id: str
    agent_role: str = "InterviewerAgent"
    agent_message: str
    audio_url: str | None = None
    intake_stage: str = "clarification"
    extracted_facts: dict[str, Any] = Field(default_factory=dict)
    suggested_next_steps: list[str] = Field(default_factory=list)
    brief_readiness_score: float = Field(default=0.0, ge=0.0, le=1.0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class InterviewAgentOutput(BaseModel):
    agent_message: str = Field(min_length=1, max_length=4000)
    intake_stage: Literal["discovery", "clarification", "validation", "ready"]
    extracted_facts: dict[str, str] = Field(default_factory=dict)
    suggested_next_steps: list[str] = Field(default_factory=list, max_length=8)
    brief_readiness_score: float = Field(ge=0.0, le=1.0)


class OrchestratorOutput(BaseModel):
    next_action: Literal["investigate_claims", "follow_up", "ready_for_synthesis"]
    rationale: str = Field(min_length=1, max_length=1000)
    claims_requiring_review: list[str] = Field(default_factory=list, max_length=8)


class EvidenceCriticOutput(BaseModel):
    evidence_assessment: str = Field(min_length=1, max_length=3000)
    supported_facts: dict[str, str] = Field(default_factory=dict)
    unsupported_claims: list[str] = Field(default_factory=list, max_length=10)
    contradictions: list[str] = Field(default_factory=list, max_length=10)
    follow_up_needed: bool


class ProblemAnalystOutput(BaseModel):
    analysis: str = Field(min_length=1, max_length=3000)
    key_gaps: list[str] = Field(default_factory=list, max_length=10)
    recommended_question: str = Field(min_length=1, max_length=1000)


# ---------------------------------------------------------------------------
# Problem Brief Schemas
# ---------------------------------------------------------------------------

class ProblemBrief(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=2000)
    problem_statement: str = Field(min_length=1, max_length=4000)
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    impacted_users: str | None = Field(default=None, max_length=1000)
    root_causes_hypotheses: list[str] = Field(default_factory=list, max_length=10)
    constraints: list[str] = Field(default_factory=list, max_length=10)
    recommended_actions: list[str] = Field(default_factory=list, max_length=10)
    evidence: list[str] = Field(default_factory=list, max_length=10)
    assumptions: list[str] = Field(default_factory=list, max_length=10)
    open_questions: list[str] = Field(default_factory=list, max_length=10)


class BriefAgentOutput(BaseModel):
    readiness_score: float = Field(ge=0.0, le=1.0)
    brief: ProblemBrief


class SynthesisValidationOutput(BaseModel):
    passed_validation: bool
    readiness_score: float = Field(ge=0.0, le=1.0)
    brief: ProblemBrief
    validation_issues: list[str] = Field(default_factory=list, max_length=10)


class GenerateBriefRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    force_synthesis: bool = Field(default=False, description="Synthesize brief even if score is below threshold")
    additional_notes: str | None = Field(default=None, max_length=10000, description="Optional closing notes")


class ProblemBriefResponse(BaseModel):
    session_id: str
    brief_id: str
    status: str = "completed"
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    readiness_score: float = Field(default=1.0, ge=0.0, le=1.0)
    brief: ProblemBrief


class SessionDetailResponse(BaseModel):
    session_id: str
    status: str
    user_name: str | None = None
    intake_stage: str
    created_at: datetime
    updated_at: datetime
    brief_readiness_score: float = 0.0
    turns: list[SessionTurn] = Field(default_factory=list)
    extracted_facts: dict[str, Any] = Field(default_factory=dict)
    brief: ProblemBrief | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Generic Error Response
# ---------------------------------------------------------------------------

class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorDetail
