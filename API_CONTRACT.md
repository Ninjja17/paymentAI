# API Contract: Voice AI Problem Intake Agent

This document defines the REST API contract for communication between the Voice AI Frontend and the FastAPI Multi-Agent Intake Backend.

---

## 1. General Standards

- **Base URL**: `http://localhost:8000/api/v1` (or relative `/api/v1` when using Vite proxy)
- **Data Exchange Format**: `application/json`
- **Character Encoding**: `UTF-8`
- **Timestamp Standard**: ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SS.sssZ`)
- **Standard Error Response**:
  ```json
  {
    "error": {
      "code": "STRING_ERROR_CODE",
      "message": "Human-readable description of error",
      "details": {}
    }
  }
  ```

---

## 2. Endpoints Specification

### 2.1 Health Check

Checks backend service availability, system time, and whether Gemini is configured.

- **Route**: `GET /health` (also aliased at `/api/v1/health`)
- **Authentication**: None
- **Request Headers**: None
- **Query Parameters**: None

#### Response
- **Status**: `200 OK`
- **Body**:
  ```json
  {
    "status": "healthy",
    "version": "0.1.0",
    "timestamp": "2026-10-18T14:30:00.000Z",
    "services": {
      "session_store": "ready",
      "agent_orchestrator": "configured"
    }
  }
  ```

Without `GEMINI_API_KEY`, the endpoint reports `"status": "degraded"` and
`"agent_orchestrator": "not_configured"`. `"configured"` indicates that a key is
present; it does not assert that an external Gemini request has succeeded.

---

### 2.2 Create Session

Initializes a new problem intake session.

- **Route**: `POST /sessions` (or `/api/v1/sessions`)
- **Authentication**: None
- **Request Headers**:
  - `Content-Type: application/json`

#### Request Body
```json
{
  "user_name": "Alex",
  "initial_goal": "Investigate transaction drop-offs on checkout page",
  "metadata": {
    "channel": "voice",
    "client_device": "web_browser",
    "locale": "en-US"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `user_name` | `string` | No | Optional name of the caller/stakeholder. |
| `initial_goal` | `string` | No | Initial problem statement or agenda if known. |
| `metadata` | `object` | No | Arbitrary context flags (audio channel, device, etc.). |

#### Response
- **Status**: `201 Created`
- **Body**:
  ```json
  {
    "session_id": "sess_9f8c12a4e2",
    "status": "active",
    "created_at": "2026-10-18T14:30:05.120Z",
    "updated_at": "2026-10-18T14:30:05.120Z",
    "user_name": "Alex",
    "intake_stage": "discovery",
    "turn_count": 0,
    "metadata": {
      "channel": "voice",
      "client_device": "web_browser",
      "locale": "en-US"
    },
    "access_token": "returned-once-at-session-creation",
    "token_type": "bearer",
    "token_expires_at": "2026-10-19T14:30:05.120Z"
  }
  ```
Store `access_token` securely and send it using bearer authorization on every
session-specific REST endpoint. Only its SHA-256 hash is persisted.

---

### 2.3 Conversational Turn

Submits a user utterance (text or voice payload) to the multi-agent intake engine and receives the next agent action/reply.

- **Route**: `POST /sessions/{session_id}/turn` (or `/api/v1/sessions/{session_id}/turn`)
- **Path Parameters**:
  - `session_id` (`string`, required): Unique session identifier.
- **Request Headers**:
  - `Content-Type: application/json`
  - Session bearer authorization

#### Request Body
```json
{
  "user_input": "Users are encountering payment timeout errors during peak hours on UPI payments.",
  "audio_payload": null,
  "speaker_tag": "user",
  "client_timestamp": "2026-10-18T14:31:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `user_input` | `string` | Yes | Transcribed user speech or direct text message. |
| `audio_payload` | `string` | No | Optional base64-encoded audio chunk or audio reference ID. |
| `speaker_tag` | `string` | No | Default `"user"`. Identifier for multi-speaker turns. |
| `client_timestamp` | `string` | No | Client ISO timestamp when speech ended. |

#### Response
- **Status**: `200 OK`
- **Body**:
  ```json
  {
    "session_id": "sess_9f8c12a4e2",
    "turn_id": "turn_001",
    "agent_role": "InterviewerAgent",
    "agent_message": "Could you tell me approximately what percentage of UPI transactions are timing out, and when this started occurring?",
    "audio_url": null,
    "intake_stage": "clarification",
    "extracted_facts": {
      "affected_service": "UPI payments",
      "symptom": "payment timeout errors",
      "trigger_condition": "peak hours"
    },
    "suggested_next_steps": [
      "Specify volume/failure percentage",
      "Identify timestamp of first occurrence"
    ],
    "brief_readiness_score": 0.35,
    "timestamp": "2026-10-18T14:31:02.450Z"
  }
  ```

#### Error Responses
- `404 Not Found`: Session does not exist.
  ```json
  {
    "error": {
      "code": "SESSION_NOT_FOUND",
      "message": "Session 'sess_invalid' not found"
    }
  }
  ```
- `422 Unprocessable Entity`: Missing `user_input` or invalid format.
- `503 Service Unavailable`: `GEMINI_API_KEY` is not configured.
- `502 Bad Gateway`: Gemini failed or did not return valid structured output. The turn is not persisted.

The turn orchestrator may review claims and ask the Problem Analyst to identify
gaps before the Interviewer Agent responds. The Evidence and Critic Agent reviews
only the supplied session content; it does not independently verify claims.

---

### 2.4 Get Session Details

Retrieves current status, conversation history, and captured facts for a session.

- **Route**: `GET /sessions/{session_id}` (or `/api/v1/sessions/{session_id}`)
- **Authentication**: Session bearer authorization
- **Path Parameters**:
  - `session_id` (`string`, required): Unique session identifier.

#### Response
- **Status**: `200 OK`
- **Body**:
  ```json
  {
    "session_id": "sess_9f8c12a4e2",
    "status": "active",
    "user_name": "Alex",
    "intake_stage": "clarification",
    "created_at": "2026-10-18T14:30:05.120Z",
    "updated_at": "2026-10-18T14:31:02.450Z",
    "brief_readiness_score": 0.35,
    "turns": [
      {
        "turn_id": "turn_001_req",
        "role": "user",
        "message": "Users are encountering payment timeout errors during peak hours on UPI payments.",
        "timestamp": "2026-10-18T14:31:00.000Z"
      },
      {
        "turn_id": "turn_001_res",
        "role": "agent",
        "agent_name": "InterviewerAgent",
        "message": "Could you tell me approximately what percentage of UPI transactions are timing out, and when this started occurring?",
        "timestamp": "2026-10-18T14:31:02.450Z"
      }
    ],
    "extracted_facts": {
      "affected_service": "UPI payments",
      "symptom": "payment timeout errors",
      "trigger_condition": "peak hours"
    },
    "brief": null,
    "metadata": {
      "channel": "voice",
      "client_device": "web_browser",
      "locale": "en-US"
    }
  }
  ```

#### Error Responses
- `404 Not Found`: Session does not exist.

---

### 2.5 Generate / Finalize Problem Brief

Synthesizes the captured intake interview into a structured problem brief artifact.

- **Route**: `POST /sessions/{session_id}/brief` (or `/api/v1/sessions/{session_id}/brief`)
- **Path Parameters**:
  - `session_id` (`string`, required): Unique session identifier.
- **Request Headers**:
  - `Content-Type: application/json`
  - Session bearer authorization

#### Request Body
```json
{
  "force_synthesis": false,
  "additional_notes": "Urgent escalation requested by operations team"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `force_synthesis` | `boolean` | No | Default `false`. If true, generates brief even if readiness score is below optimal threshold. |
| `additional_notes` | `string` | No | Optional closing notes from the user or operator. |

#### Response
- **Status**: `200 OK`
- **Body**:
  ```json
  {
    "session_id": "sess_9f8c12a4e2",
    "brief_id": "brf_4d87e1a3b5",
    "status": "completed",
    "generated_at": "2026-10-18T14:35:10.000Z",
    "readiness_score": 0.92,
    "brief": {
      "title": "UPI Payment Gateway Latency Spike During Peak Hours",
      "summary": "UPI checkout transactions experience elevated timeout rates (>12%) between 18:00 and 21:00 IST.",
      "problem_statement": "Customers cannot complete UPI purchases during high-traffic evening windows due to downstream banking switch timeout latencies exceeding 4000ms.",
      "severity": "HIGH",
      "impacted_users": "Approx. 15,000 users daily",
      "root_causes_hypotheses": [
        "Connection pool exhaustion on payment switch bridge",
        "Aggregator gateway API rate limiting"
      ],
      "constraints": [
        "Zero downtime requirement for hotfix deployment",
        "PCI-DSS compliance bounds on log capture"
      ],
      "recommended_actions": [
        "Increase connection pool limits on UPI microservice",
        "Enable circuit breaker pattern with graceful fallback to alternative payment methods",
        "Coordinate with banking partner on TPS throttling thresholds"
      ]
    }
  }
  ```

#### Error Responses
- `400 Bad Request`: Conversation does not have sufficient data for a brief and `force_synthesis` is `false`.
- `404 Not Found`: Session does not exist.
- `503 Service Unavailable`: `GEMINI_API_KEY` is not configured.
- `502 Bad Gateway`: Gemini failed or did not return a valid structured brief.
- `409 Conflict`: The synthesis/validation agent found material gaps or contradictions.
  The response `error.details` includes `validation_issues`, `follow_up_question`,
  and `session_id`. The clarification question is saved to the session history,
  and the session remains active.

Brief generation requires a readiness score of at least `0.70` unless
`force_synthesis` is `true`. Low-readiness syntheses are not persisted unless
explicitly forced. Forced synthesis still must pass validation before the brief
is delivered.

### 2.6 Voice services (Sarvam)

All REST voice routes require session bearer authorization. The realtime
WebSocket uses a short-lived, one-use ticket.

| Method | Route | Behavior |
|---|---|---|
| `POST` | `/sessions/{session_id}/transcribe` | Multipart `file` audio and optional `language_code`; returns a PII-redacted transcript. |
| `POST` | `/sessions/{session_id}/speak` | JSON with `text` and `language_code`; returns synthesized `audio/wav`. |
| `POST` | `/sessions/{session_id}/voice-ticket` | Returns a ticket valid for 60 seconds and one connection. |
| `WS` | `/sessions/{session_id}/voice-stream?ticket=...&language_code=...` | Relays realtime STT messages between the client and Sarvam. |

Set `SARVAM_API_KEY` in the backend environment to enable provider calls. Disable
ASGI access logging when using the realtime WebSocket because its ticket is
carried in the connection query string. Provider errors are returned explicitly;
the backend does not fabricate transcripts or audio.
Realtime client frames must be JSON audio events with Base64 audio; binary
frames are rejected. The backend relays events without persisting audio and
redacts common identifiers from text/keyterm fields and returned transcripts.

Session updates append numbered state revisions with optimistic write
protection. Common email, phone, Aadhaar, PAN, and payment-card patterns are
redacted before persistence and provider calls; this is a privacy safeguard,
not a comprehensive DLP system. The configurable in-process rate limiter is
per worker and should be replaced by a shared limiter for multi-worker
production deployments.
