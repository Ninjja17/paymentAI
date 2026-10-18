"""Server-side Sarvam STT/TTS client."""

import base64
import binascii
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)
SARVAM_API = "https://api.sarvam.ai"


class SarvamNotConfigured(Exception):
    pass


class SarvamCallFailed(Exception):
    pass


def _headers() -> dict[str, str]:
    if not settings.sarvam_api_key:
        raise SarvamNotConfigured
    return {"api-subscription-key": settings.sarvam_api_key}


async def transcribe(
    audio: bytes,
    filename: str,
    content_type: str,
    language_code: str,
) -> tuple[str, str | None]:
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"{SARVAM_API}/speech-to-text",
                headers=_headers(),
                data={
                    "model": settings.sarvam_stt_model,
                    "language_code": language_code,
                },
                files={"file": (filename, audio, content_type)},
            )
        response.raise_for_status()
        result: Any = response.json()
        transcript = result.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise SarvamCallFailed
        detected_language = result.get("language_code")
        return transcript, detected_language if isinstance(detected_language, str) else None
    except SarvamNotConfigured:
        raise
    except (httpx.HTTPError, ValueError, SarvamCallFailed):
        logger.warning("Sarvam transcription request failed")
        raise SarvamCallFailed from None


async def synthesize(text: str, language_code: str) -> bytes:
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"{SARVAM_API}/text-to-speech",
                headers=_headers(),
                json={
                    "text": text,
                    "target_language_code": language_code,
                    "speaker": settings.sarvam_tts_voice,
                    "model": settings.sarvam_tts_model,
                },
            )
        response.raise_for_status()
        result: Any = response.json()
        audios = result.get("audios")
        if not isinstance(audios, list) or not audios or not isinstance(audios[0], str):
            raise SarvamCallFailed
        return base64.b64decode(audios[0], validate=True)
    except SarvamNotConfigured:
        raise
    except (httpx.HTTPError, ValueError, binascii.Error, SarvamCallFailed):
        logger.warning("Sarvam speech synthesis request failed")
        raise SarvamCallFailed from None
