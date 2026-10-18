"""Authenticated Sarvam speech endpoints and realtime STT relay."""

import asyncio
import json
import logging
import re
from urllib.parse import urlencode

import websockets
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.models.entities import IntakeSession
from app.models.schemas import (
    SpeechRequest,
    TranscriptionResponse,
    VoiceTicketResponse,
)
from app.routers.sessions import require_session_access
from app.security import (
    consume_voice_ticket,
    create_voice_ticket,
    redact_text,
)
from app.services.sarvam import (
    SarvamCallFailed,
    SarvamNotConfigured,
    synthesize,
    transcribe,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Voice"])
MAX_TEXT_BYTES = 10_000
MAX_REALTIME_FRAME_BYTES = 1_000_000
_TRANSCRIPT_KEYS = {"text", "transcript", "transcript_text", "partial_transcript"}
_OUTBOUND_TEXT_KEYS = {"text", "prompt", "keyterms"}
_LANGUAGE_CODE = re.compile(r"^(?:unknown|[a-z]{2}(?:-[A-Z]{2})?)$")


def _voice_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _redact_realtime_transcript(message: str) -> str:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        return redact_text(message)
    if isinstance(payload, str):
        return redact_text(payload)

    def redact_fields(value: object) -> object:
        if isinstance(value, dict):
            return {
                key: redact_text(item) if key in _TRANSCRIPT_KEYS and isinstance(item, str)
                else redact_fields(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [redact_fields(item) for item in value]
        return value

    return json.dumps(redact_fields(payload), separators=(",", ":"))


def _prepare_realtime_input(message: str) -> str:
    payload = json.loads(message)
    if not isinstance(payload, dict):
        raise ValueError("Realtime provider messages must be JSON objects.")

    def redact_fields(value: object, redact_strings: bool = False) -> object:
        if isinstance(value, str):
            return redact_text(value) if redact_strings else value
        if isinstance(value, dict):
            return {
                key: redact_fields(
                    item,
                    redact_strings or key in _OUTBOUND_TEXT_KEYS,
                )
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [redact_fields(item, redact_strings) for item in value]
        return value

    return json.dumps(redact_fields(payload), separators=(",", ":"))


@router.post(
    "/sessions/{session_id}/voice-ticket",
    response_model=VoiceTicketResponse,
    summary="Create a one-use credential for a realtime voice connection",
)
def issue_voice_ticket(
    session_id: str,
    database: Session = Depends(get_db),
    _: None = Depends(require_session_access),
) -> VoiceTicketResponse:
    if database.get(IntakeSession, session_id) is None:
        raise _voice_error(404, "SESSION_NOT_FOUND", f"Session '{session_id}' not found")
    ticket = create_voice_ticket(database, session_id)
    database.commit()
    return VoiceTicketResponse(ticket=ticket)


@router.post(
    "/sessions/{session_id}/transcribe",
    response_model=TranscriptionResponse,
    summary="Transcribe an audio recording with Sarvam",
)
async def transcribe_audio(
    session_id: str,
    file: UploadFile = File(...),
    language_code: str = Form(
        default="unknown",
        pattern=r"^(?:unknown|[a-z]{2}(?:-[A-Z]{2})?)$",
    ),
    database: Session = Depends(get_db),
    _: None = Depends(require_session_access),
) -> TranscriptionResponse:
    if database.get(IntakeSession, session_id) is None:
        raise _voice_error(404, "SESSION_NOT_FOUND", f"Session '{session_id}' not found")
    if file.content_type and not (
        file.content_type.startswith("audio/")
        or file.content_type == "application/octet-stream"
    ):
        raise _voice_error(415, "UNSUPPORTED_AUDIO_TYPE", "Upload an audio file.")
    audio = await file.read(settings.max_audio_upload_bytes + 1)
    if not audio:
        raise _voice_error(422, "EMPTY_AUDIO", "The uploaded audio file is empty.")
    if len(audio) > settings.max_audio_upload_bytes:
        raise _voice_error(413, "AUDIO_TOO_LARGE", "The uploaded audio file exceeds the size limit.")
    try:
        transcript, detected_language = await transcribe(
            audio,
            file.filename or "audio",
            file.content_type or "application/octet-stream",
            language_code,
        )
    except SarvamNotConfigured:
        raise _voice_error(
            503,
            "SARVAM_NOT_CONFIGURED",
            "Speech transcription is unavailable. Configure SARVAM_API_KEY.",
        ) from None
    except SarvamCallFailed:
        raise _voice_error(
            502,
            "SARVAM_UPSTREAM_ERROR",
            "Sarvam could not transcribe this audio. No transcript was saved.",
        ) from None
    return TranscriptionResponse(
        transcript=redact_text(transcript),
        language_code=detected_language,
    )


@router.post(
    "/sessions/{session_id}/speak",
    summary="Synthesize speech with Sarvam",
    responses={200: {"content": {"audio/wav": {}}}},
)
async def synthesize_speech(
    session_id: str,
    payload: SpeechRequest,
    database: Session = Depends(get_db),
    _: None = Depends(require_session_access),
) -> Response:
    if database.get(IntakeSession, session_id) is None:
        raise _voice_error(404, "SESSION_NOT_FOUND", f"Session '{session_id}' not found")
    text = redact_text(payload.text)
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise _voice_error(422, "SPEECH_TEXT_TOO_LONG", "Speech text exceeds the supported size.")
    try:
        audio = await synthesize(text, payload.language_code)
    except SarvamNotConfigured:
        raise _voice_error(
            503,
            "SARVAM_NOT_CONFIGURED",
            "Speech synthesis is unavailable. Configure SARVAM_API_KEY.",
        ) from None
    except SarvamCallFailed:
        raise _voice_error(
            502,
            "SARVAM_UPSTREAM_ERROR",
            "Sarvam could not synthesize this speech request.",
        ) from None
    return Response(content=audio, media_type="audio/wav")


@router.websocket("/sessions/{session_id}/voice-stream")
async def realtime_voice_stream(
    websocket: WebSocket,
    session_id: str,
    ticket: str | None = None,
    language_code: str = "unknown",
) -> None:
    with SessionLocal() as database:
        session_exists = database.get(IntakeSession, session_id) is not None
        ticket_valid = (
            not settings.api_auth_enabled
            or (
                ticket is not None
                and session_exists
                and consume_voice_ticket(database, session_id, ticket)
            )
        )
    if not session_exists or not ticket_valid:
        await websocket.close(code=4401 if session_exists else 4404)
        return
    if not _LANGUAGE_CODE.fullmatch(language_code):
        await websocket.close(code=4400, reason="Invalid language code")
        return
    if not settings.sarvam_api_key:
        await websocket.close(code=1011, reason="Voice provider is not configured")
        return

    provider_query = urlencode(
        {
            "api_key": settings.sarvam_api_key,
            "language_code": language_code,
            "model": settings.sarvam_stt_model,
            "mode": "transcribe",
        }
    )
    provider_url = f"wss://api.sarvam.ai/speech-to-text-realtime/ws?{provider_query}"
    try:
        async with websockets.connect(provider_url, max_size=2**20) as provider:
            await websocket.accept()

            async def send_audio() -> None:
                while True:
                    message = await websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        return
                    content = message.get("text")
                    if content is not None:
                        if len(content.encode("utf-8")) > MAX_REALTIME_FRAME_BYTES:
                            await websocket.close(code=1009, reason="Audio frame is too large")
                            return
                        try:
                            safe_message = _prepare_realtime_input(content)
                        except (json.JSONDecodeError, ValueError):
                            await websocket.close(code=1003, reason="Expected a JSON audio event")
                            return
                        await provider.send(safe_message)
                    elif message.get("bytes") is not None:
                        await websocket.close(code=1003, reason="Send JSON audio events")
                        return

            async def send_transcripts() -> None:
                async for message in provider:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(_redact_realtime_transcript(message))

            tasks = [
                asyncio.create_task(send_audio()),
                asyncio.create_task(send_transcripts()),
            ]
            done, pending = await asyncio.wait(
                tasks,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception:
        logger.warning("Sarvam realtime voice connection failed for session %s", session_id)
        if websocket.client_state.value == 1:
            await websocket.close(code=1011, reason="Realtime speech service unavailable")
