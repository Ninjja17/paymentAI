# Voice AI Problem Intake Agent (Buildathon Sprint)

A real-time, multi-agent Problem Intake system designed for voice AI workflows. The system decouples interactive client communication (speech, transcription, turn management) from multi-agent interview orchestration and problem brief synthesis.

---

## Workspace Architecture

```
PaytmAi/
├── API_CONTRACT.md          # REST and voice API specification
├── README.md                # Local execution and environment setup guide
├── .gitignore               # Secrets, build outputs, and environment ignores
├── backend/                 # FastAPI agent orchestration service
│   ├── app/
│   │   ├── config.py        # Pydantic settings & environment configuration
│   │   ├── main.py          # FastAPI application & CORS configuration
│   │   ├── database.py      # SQLAlchemy engine, session dependency & setup
│   │   ├── middleware.py    # Request quotas and payload-free structured logs
│   │   ├── observability.py # Optional OpenTelemetry OTLP tracing
│   │   ├── security.py      # Session tokens, one-use voice tickets, PII redaction
│   │   ├── models/
│   │   │   ├── entities.py  # Sessions, turns, credentials and state revisions
│   │   │   └── schemas.py   # Pydantic request/response schemas
│   │   ├── routers/
│   │   │   ├── health.py    # GET /health
│   │   │   ├── sessions.py  # Session lifecycle & turn management endpoints
│   │   │   └── voice.py     # Sarvam REST endpoints and realtime STT relay
│   │   └── services/
│   │       └── gemini.py    # Orchestrator and specialist agent provider calls
│   │       └── sarvam.py    # Server-side Sarvam STT/TTS provider calls
│   ├── alembic/             # Database migration history
│   ├── alembic.ini
│   ├── requirements.txt     # Python dependencies
│   ├── .env.example         # Environment template
│   ├── tests/               # API and mocked provider tests
│   └── .gitignore
└── frontend/                # React + TypeScript + Vite web client
    ├── src/
    │   ├── services/
    │   │   └── api.ts       # Typed API client
    │   ├── types/
    │   │   └── index.ts     # TypeScript interfaces matching API contract
    │   ├── App.tsx          # Phase 1 intake readiness view & connection tester
    │   ├── index.css        # Modern design system & styling
    │   └── main.tsx         # React root entrypoint
    ├── index.html           # Document shell
    ├── package.json         # Node dependencies & scripts
    ├── tsconfig.json        # TypeScript configuration
    ├── vite.config.ts       # Vite configuration with proxy to backend (:8000)
    ├── .env.example
    └── .gitignore
```

---

## Prerequisites

- **Python**: 3.10+ (tested on Python 3.10 - 3.13)
- **Node.js**: 18.0+ & npm

---

## 1. Running the Backend (FastAPI)

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment**:
   - **Windows (PowerShell)**:
     ```powershell
     python -m venv .venv
     .\.venv\Scripts\Activate.ps1
     ```
   - **macOS / Linux**:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables** (optional; defaults use a local SQLite file):
   - **Windows (PowerShell)**:
     ```powershell
     Copy-Item .env.example .env
     ```
   - **macOS / Linux**:
     ```bash
     cp .env.example .env
     ```
   Edit `backend/.env` and set `GEMINI_API_KEY` to your own Google AI Studio API
   key to enable Gemini-backed interviewing and brief synthesis. Keep `.env`
   private and do not commit it. Set `SARVAM_API_KEY` to enable voice services.
   The API-key fields in `.env.example` are intentionally blank; never paste
   provider keys into source files.

5. **Apply the database migration** (run after creating or changing the database):
   ```powershell
   alembic upgrade head
   ```

6. **Start the FastAPI development server**:
   ```bash
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
   ```
   Access logging is disabled because realtime voice tickets are short-lived
   credentials carried in the WebSocket query string. The application emits
   structured request logs without query strings or request bodies.
   - Server runs at: `http://localhost:8000`
   - Interactive OpenAPI documentation: `http://localhost:8000/docs`
   - Health check: `http://localhost:8000/health`

7. **Run the backend tests** (from `backend/` with the virtual environment active):
   ```bash
   python -m pytest -q
   ```

The default database is persisted at `backend/data/sessions.db`; override it with
`DATABASE_URL` in `backend/.env`. Session creation, turns, specialist-agent state,
and generated briefs use that database. For live AI, set `GEMINI_API_KEY` in
`backend/.env` (never commit that file); `GEMINI_MODEL` defaults to
`gemini-3.8-flash`. The turn workflow is implemented as a compiled LangGraph state graph in
`backend/app/services/orchestration.py`, with typed state and explicit nodes,
conditional routing, and a bounded evidence-review loop. Gemini remains the
model provider for each specialist role. The workflow follows the multi-agent
intake diagram:

1. The **Intake Orchestrator** routes each user turn to claim review, follow-up,
   or synthesis readiness.
2. **Evidence and Critic Agent** reviews claims against the supplied interview
   only; it does not claim external fact verification. The orchestrator
   reevaluates once after review to keep each turn bounded.
3. **Problem Analyst Agent** identifies gaps and supplies a focused question;
   **InterviewerAgent** turns that guidance into the user-facing response.
4. **Synthesis and Validation Agent** checks the proposed brief for unsupported
   claims, contradictions, and missing context. Failed validation records the
   issues, asks a clarification question, and leaves the session active for the
   next user turn instead of delivering a failed brief.

Each agent call uses a validated structured response. If the key is missing or
Gemini fails, the API returns an explicit error and does not save a fabricated
turn or brief. Requests use stateless Gemini interactions (`store=false`). Brief
synthesis requires a readiness score of at least 0.70 unless
`force_synthesis=true`; forced synthesis still has to pass validation.

Tests mock the Gemini integration, so they require no API key and do not make
billable network calls.

### Backend security, voice and storage

- Session creation returns a random bearer token; send it as
  `Authorization: Bearer <access_token>` on every session and voice REST route.
  Only a SHA-256 token hash is stored. Health and session creation remain public.
- `API_AUTH_ENABLED=false` disables session authorization for isolated local
  development only. Session state still uses per-session IDs.
- Sarvam credentials stay on the backend. Audio upload transcription,
  speech synthesis, and a one-use-ticket authenticated realtime WebSocket relay
  are available after `SARVAM_API_KEY` is configured. No live provider call is
  made by the test suite.
- The frontend microphone button records up to 30 seconds, converts it to
  16 kHz mono WAV, submits it to the authenticated Sarvam transcription route,
  and sends the returned transcript through the Gemini turn API. Agent messages
  can be played using the authenticated Sarvam speech route. Text turns,
  session creation/history, health checks, and brief synthesis use the backend
  API client and Vite proxy.
- Common email, phone, Aadhaar, PAN and Luhn-valid payment-card patterns are
  redacted before session persistence and Gemini/Sarvam requests. This pattern
  filter is a privacy safeguard, not a comprehensive DLP guarantee.
- Each successful session mutation appends a state snapshot revision. SQLAlchemy
  version checks prevent concurrent stale writes. Run `alembic upgrade head`
  before starting when upgrading an existing local database.
- HTTP request and session-creation limits are configurable via
  `RATE_LIMIT_REQUESTS_PER_MINUTE` and
  `RATE_LIMIT_SESSION_CREATION_PER_HOUR`. The built-in limiter is process-local;
  multi-worker or multi-instance deployments should put a shared gateway or
  distributed rate limiter in front of the API.
- Set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable FastAPI and SQLAlchemy tracing.
  With it blank, telemetry export is disabled. Configure `DATABASE_URL` with
  your PostgreSQL connection URL to use PostgreSQL instead of local SQLite.

If a provider key was previously stored in any project template or source file,
rotate it in that provider's dashboard and update only your private `.env`.

---

## 2. Running the Frontend (React + Vite)

1. **Navigate to the frontend directory** (in a new terminal):
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables** (optional for dev defaults):
   ```bash
   cp .env.example .env
   ```

4. **Start the Vite dev server**:
   ```bash
   npm run dev
   ```
   - Client runs at: `http://localhost:5173`
   - API requests to `/health`, `/sessions`, and `/api/*` are automatically proxied to `http://localhost:8000` via Vite server proxy.

---

## 3. API Contract Summary

See [`API_CONTRACT.md`](./API_CONTRACT.md) for full request/response schemas.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Check service readiness and subsystem health |
| `POST` | `/sessions` | Create a new intake session |
| `POST` | `/sessions/{session_id}/turn` | Process a conversational speech/text turn |
| `GET` | `/sessions/{session_id}` | Retrieve session state, turns, and facts |
| `POST` | `/sessions/{session_id}/brief` | Finalize and synthesize the Problem Brief |
