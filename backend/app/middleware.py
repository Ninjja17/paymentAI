"""Small-process HTTP quotas and payload-free structured request logging."""

import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Callable
from math import ceil

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from app.config import settings

logger = logging.getLogger("app.http")


class RequestGuard:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._session_creations: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        self._requests.clear()
        self._session_creations.clear()

    async def check(
        self,
        client_id: str,
        is_session_creation: bool,
    ) -> tuple[str, int] | None:
        now = time.monotonic()
        async with self._lock:
            requests = self._requests[client_id]
            while requests and now - requests[0] >= 60:
                requests.popleft()
            if len(requests) >= settings.rate_limit_requests_per_minute:
                retry_after = max(1, ceil(60 - (now - requests[0])))
                return "REQUEST_RATE_LIMITED", retry_after
            requests.append(now)

            if is_session_creation:
                creations = self._session_creations[client_id]
                while creations and now - creations[0] >= 3600:
                    creations.popleft()
                if len(creations) >= settings.rate_limit_session_creation_per_hour:
                    retry_after = max(1, ceil(3600 - (now - creations[0])))
                    return "SESSION_CREATION_RATE_LIMITED", retry_after
                creations.append(now)
        return None


request_guard = RequestGuard()


async def guarded_request(
    request: Request,
    call_next: Callable[[Request], Response],
) -> Response:
    started_at = time.monotonic()
    request_id = request.headers.get("x-request-id")
    if not request_id or len(request_id) > 100:
        request_id = str(uuid.uuid4())
    client_id = request.client.host if request.client else "unknown"
    is_session_creation = (
        request.method == "POST"
        and request.url.path.rstrip("/") in {"/sessions", "/api/v1/sessions"}
    )
    limit_error = await request_guard.check(client_id, is_session_creation)
    if limit_error:
        error_code, retry_after = limit_error
        response: Response = JSONResponse(
            status_code=429,
            content={
                "error": {
                    "code": error_code,
                    "message": "Request quota exceeded. Retry after the current quota window.",
                    "details": {},
                }
            },
            headers={"Retry-After": str(retry_after)},
        )
    else:
        response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        json.dumps(
            {
                "event": "http_request",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.monotonic() - started_at) * 1000, 2),
            },
            separators=(",", ":"),
        )
    )
    return response
