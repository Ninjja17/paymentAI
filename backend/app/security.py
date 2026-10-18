"""Session token and transcript privacy helpers."""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.entities import SessionCredential, VoiceTicket

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE = re.compile(r"(?<!\w)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\w)")
_AADHAAR = re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
_PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.IGNORECASE)
_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session_token(database: Session, session_id: str) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.session_token_ttl_hours
    )
    database.add(
        SessionCredential(
            session_id=session_id,
            token_hash=hash_token(token),
            expires_at=expires_at,
        )
    )
    return token, expires_at


def has_session_access(
    database: Session,
    session_id: str,
    token: str | None,
) -> bool:
    if not settings.api_auth_enabled:
        return True
    if token is None:
        return False
    credential = database.scalar(
        select(SessionCredential).where(SessionCredential.session_id == session_id)
    )
    if credential is None:
        return False
    return (
        secrets.compare_digest(credential.token_hash, hash_token(token))
        and credential.expires_at > datetime.now(timezone.utc)
    )


def create_voice_ticket(database: Session, session_id: str) -> str:
    ticket = secrets.token_urlsafe(32)
    database.add(
        VoiceTicket(
            ticket_hash=hash_token(ticket),
            session_id=session_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=1),
        )
    )
    return ticket


def consume_voice_ticket(database: Session, session_id: str, ticket: str) -> bool:
    now = datetime.now(timezone.utc)
    consumed = database.execute(
        update(VoiceTicket)
        .where(
            VoiceTicket.ticket_hash == hash_token(ticket),
            VoiceTicket.session_id == session_id,
            VoiceTicket.consumed_at.is_(None),
            VoiceTicket.expires_at > now,
        )
        .values(consumed_at=now)
    )
    if consumed.rowcount != 1:
        database.rollback()
        return False
    database.commit()
    return True


def _is_luhn_valid(value: str) -> bool:
    digits = [int(char) for char in value if char.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    checksum = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def redact_text(value: str) -> str:
    """Mask common direct identifiers before persistence or provider calls."""
    value = _EMAIL.sub("[REDACTED_EMAIL]", value)
    value = _CARD.sub(
        lambda match: (
            "[REDACTED_CARD]"
            if _is_luhn_valid(match.group())
            else match.group()
        ),
        value,
    )
    value = _AADHAAR.sub("[REDACTED_AADHAAR]", value)
    value = _PAN.sub("[REDACTED_PAN]", value)
    return _PHONE.sub("[REDACTED_PHONE]", value)


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_value(item) for key, item in value.items()}
    return value
