"""Persistent SQLAlchemy entities for intake sessions and user turns."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.types import TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UTCDateTime(TypeDecorator[datetime]):
    impl = DateTime
    cache_ok = True

    def __init__(self) -> None:
        super().__init__(timezone=True)

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        return value

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class IntakeSession(Base):
    __tablename__ = "intake_sessions"

    session_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    user_name: Mapped[str | None] = mapped_column(String(200))
    initial_goal: Mapped[str | None] = mapped_column(Text)
    intake_stage: Mapped[str] = mapped_column(String(40), nullable=False, default="discovery")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    brief_readiness_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    extracted_facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    brief_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    state_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    turns: Mapped[list["SessionTurn"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionTurn.timestamp",
    )
    __mapper_args__ = {
        "version_id_col": state_version,
        "version_id_generator": False,
    }


class SessionTurn(Base):
    __tablename__ = "session_turns"

    turn_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    agent_name: Mapped[str | None] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)

    session: Mapped[IntakeSession] = relationship(back_populates="turns")


class SessionCredential(Base):
    __tablename__ = "session_credentials"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
        primary_key=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class VoiceTicket(Base):
    __tablename__ = "voice_tickets"

    ticket_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class SessionRevision(Base):
    __tablename__ = "session_revisions"
    __table_args__ = (
        UniqueConstraint("session_id", "revision", name="uq_session_revision"),
    )

    revision_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    state_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
