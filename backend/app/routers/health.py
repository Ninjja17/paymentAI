"""Health check router."""

import logging

from fastapi import APIRouter
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.database import database_is_ready
from app.models.schemas import HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Report storage readiness and whether AI orchestration is configured."""
    try:
        database_is_ready()
        session_store = "ready"
    except SQLAlchemyError:
        logger.exception("Database health check failed")
        session_store = "unavailable"

    orchestrator = (
        "configured"
        if settings.gemini_api_key and settings.gemini_api_key.strip()
        else "not_configured"
    )
    return HealthResponse(
        status=(
            "healthy"
            if session_store == "ready" and orchestrator == "configured"
            else "degraded"
        ),
        version=settings.app_version,
        services={
            "session_store": session_store,
            "agent_orchestrator": orchestrator,
        },
    )
