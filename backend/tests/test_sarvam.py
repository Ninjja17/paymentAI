"""Sarvam provider contract tests with network access mocked."""

import base64
import asyncio
from typing import Any

import pytest

from app.config import settings
from app.services import sarvam


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.payload


class FakeAsyncClient:
    calls: list[tuple[str, dict[str, Any]]] = []
    response_payload: dict[str, Any] = {}

    def __init__(self, timeout: int) -> None:
        assert timeout == 90

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((url, kwargs))
        return FakeResponse(self.response_payload)


@pytest.fixture
def fake_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> type[FakeAsyncClient]:
    FakeAsyncClient.calls = []
    monkeypatch.setattr(settings, "sarvam_api_key", "test-provider-key")
    monkeypatch.setattr(settings, "sarvam_stt_model", "saaras:v4")
    monkeypatch.setattr(settings, "sarvam_tts_model", "bulbul:v4-flash")
    monkeypatch.setattr(sarvam.httpx, "AsyncClient", FakeAsyncClient)
    return FakeAsyncClient


def test_transcribe_sends_audio_to_sarvam_with_server_side_key(
    fake_provider: type[FakeAsyncClient],
) -> None:
    fake_provider.response_payload = {
        "transcript": "The payment page is slow.",
        "language_code": "en-IN",
    }

    transcript, language = asyncio.run(
        sarvam.transcribe(b"fake audio", "sample.wav", "audio/wav", "en-IN")
    )

    assert transcript == "The payment page is slow."
    assert language == "en-IN"
    url, request = fake_provider.calls[0]
    assert url == "https://api.sarvam.ai/speech-to-text"
    assert request["headers"] == {"api-subscription-key": "test-provider-key"}
    assert request["data"] == {"model": "saaras:v4", "language_code": "en-IN"}
    assert request["files"]["file"] == ("sample.wav", b"fake audio", "audio/wav")


def test_synthesize_decodes_provider_audio(
    fake_provider: type[FakeAsyncClient],
) -> None:
    fake_provider.response_payload = {
        "audios": [base64.b64encode(b"wav bytes").decode("ascii")]
    }

    audio = asyncio.run(sarvam.synthesize("Hello there", "en-IN"))

    assert audio == b"wav bytes"
    url, request = fake_provider.calls[0]
    assert url == "https://api.sarvam.ai/text-to-speech"
    assert request["json"] == {
        "text": "Hello there",
        "target_language_code": "en-IN",
        "speaker": settings.sarvam_tts_voice,
        "model": "bulbul:v4-flash",
    }


def test_malformed_provider_output_is_an_explicit_failure(
    fake_provider: type[FakeAsyncClient],
) -> None:
    fake_provider.response_payload = {"audios": ["not base64"]}

    with pytest.raises(sarvam.SarvamCallFailed):
        asyncio.run(sarvam.synthesize("Hello there", "en-IN"))


def test_sarvam_requests_require_a_configured_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "sarvam_api_key", None)

    with pytest.raises(sarvam.SarvamNotConfigured):
        asyncio.run(sarvam.synthesize("Hello there", "en-IN"))
