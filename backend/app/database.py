"""SQLAlchemy engine, session dependency, and schema initialization."""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


def _prepare_sqlite_path(database_url: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)


_prepare_sqlite_path(settings.database_url)
_engine_options = {"pool_pre_ping": True}
if make_url(settings.database_url).get_backend_name() == "sqlite":
    _engine_options["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.database_url, **_engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as database:
        yield database


def initialize_database() -> None:
    from app.models.entities import (  # noqa: F401
        IntakeSession,
        SessionCredential,
        SessionRevision,
        SessionTurn,
        VoiceTicket,
    )

    _ = (IntakeSession, SessionCredential, SessionRevision, SessionTurn, VoiceTicket)
    Base.metadata.create_all(bind=engine)


def database_is_ready() -> bool:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True
