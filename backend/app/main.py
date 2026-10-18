"""FastAPI backend entrypoint for the intake service."""

from contextlib import asynccontextmanager
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import initialize_database
from app.middleware import guarded_request
from app.observability import configure_telemetry
from app.routers import health, sessions, voice

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_database()
    configure_telemetry(app)
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Persistent API foundation for the Voice AI Problem Intake Agent.",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)
app.middleware("http")(guarded_request)

# CORS setup for frontend development and production deployments (Vercel & Render)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app|https://.*\.onrender\.com|http://localhost:.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers - root endpoints
app.include_router(health.router)
app.include_router(sessions.router)
app.include_router(voice.router)

# Also expose under /api/v1 prefix for standard versioned API consumption
app.include_router(health.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        code = str(detail.get("code", f"HTTP_{exc.status_code}"))
        message = str(detail.get("message", "Request failed"))
        details = detail.get("details", {})
    else:
        code = f"HTTP_{exc.status_code}"
        message = str(detail)
        details = {}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message, "details": details}},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        {
            "field": ".".join(str(part) for part in error["loc"]),
            "message": error["msg"],
            "type": error["type"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": errors},
            }
        },
    )


@app.get("/")
def root() -> dict[str, str]:
    """Root redirect / information endpoint."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "health": "/health",
    }
