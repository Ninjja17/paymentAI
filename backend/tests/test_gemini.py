"""Unit tests for the Gemini adapter without making network calls."""

import json
from typing import Any

from app.models.schemas import InterviewAgentOutput
from app.services.gemini import GeminiAgents, GeminiNotConfigured


class FakeInteractions:
    def __init__(self, output: str) -> None:
        self.output = output
        self.request: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> Any:
        self.request = kwargs
        return type("FakeInteraction", (), {"output_text": self.output})()


class FakeGeminiClient:
    def __init__(self, output: str) -> None:
        self.interactions = FakeInteractions(output)
        self.closed = False

    def close(self) -> None:
        self.closed = True


def test_interview_uses_structured_stateless_gemini_request() -> None:
    output = InterviewAgentOutput(
        agent_message="When did the issue start?",
        intake_stage="clarification",
        extracted_facts={"symptom": "timeouts"},
        suggested_next_steps=["Establish start date"],
        brief_readiness_score=0.35,
    )
    client = FakeGeminiClient(output.model_dump_json())
    received_key: str | None = None

    def client_factory(*, api_key: str) -> FakeGeminiClient:
        nonlocal received_key
        received_key = api_key
        return client

    result = GeminiAgents(
        api_key="test-key",
        model="test-model",
        client_factory=client_factory,
    ).interview(
        session_context={"turns": []},
        latest_user_input="Payments time out",
    )

    assert result == output
    assert received_key == "test-key"
    assert client.closed
    assert client.interactions.request is not None
    request = client.interactions.request
    assert request["model"] == "test-model"
    assert request["store"] is False
    assert request["response_format"]["mime_type"] == "application/json"
    assert request["response_format"]["schema"] == InterviewAgentOutput.model_json_schema()
    submitted_input = json.loads(request["input"])
    assert submitted_input["input_data"]["latest_user_input"] == "Payments time out"
    assert submitted_input["input_data"]["speaker_tag"] is None


def test_gemini_adapter_rejects_missing_credentials_before_api_call() -> None:
    agent = GeminiAgents(api_key="", client_factory=lambda **_: None)

    try:
        agent.interview(session_context={}, latest_user_input="Hello")
    except GeminiNotConfigured:
        pass
    else:
        raise AssertionError("Missing API key must not be treated as a successful call.")
