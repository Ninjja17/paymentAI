import {
  HealthResponse,
  CreateSessionPayload,
  SessionCreateResponse,
  TurnRequestPayload,
  TurnResponse,
  SessionDetail,
  GenerateBriefPayload,
  ProblemBriefResponse,
  SpeechPayload,
  TranscriptionResponse,
} from '../types';

const SESSION_TOKEN_KEY = 'intake_agent_session_token';
const SESSION_ID_KEY = 'intake_agent_session_id';

// Support VITE_API_URL as primary, fallback to VITE_API_BASE_URL or relative
let currentBaseUrl: string =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  localStorage.getItem('intake_agent_api_url') ||
  '';
let sessionToken: string | null = sessionStorage.getItem(SESSION_TOKEN_KEY);

export const clearSessionCredentials = (): void => {
  sessionToken = null;
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_ID_KEY);
};

export class ApiRequestError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(message: string, code = 'REQUEST_FAILED', statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  get isOrchestratorNotConfigured(): boolean {
    return this.code === 'AGENT_ORCHESTRATOR_NOT_CONFIGURED' || this.statusCode === 501;
  }

  get isSessionNotFound(): boolean {
    return this.code === 'SESSION_NOT_FOUND' || this.statusCode === 404;
  }
}

export const getApiBaseUrl = (): string => currentBaseUrl;

export const setApiBaseUrl = (url: string): void => {
  currentBaseUrl = url.trim().replace(/\/+$/, '');
  localStorage.setItem('intake_agent_api_url', currentBaseUrl);
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = currentBaseUrl ? `${currentBaseUrl}${normalizedEndpoint}` : normalizedEndpoint;

  try {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (sessionToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${sessionToken}`);
    }
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) clearSessionCredentials();
      let code = 'HTTP_' + response.status;
      let message = response.statusText || 'Request failed';
      let details: Record<string, unknown> | undefined = undefined;

      try {
        const errJson = await response.json();
        if (errJson.detail) {
          if (typeof errJson.detail === 'object') {
            code = errJson.detail.code || code;
            message = errJson.detail.message || message;
            details = errJson.detail.details;
          } else if (typeof errJson.detail === 'string') {
            message = errJson.detail;
          }
        } else if (errJson.error) {
          code = errJson.error.code || code;
          message = errJson.error.message || message;
          details = errJson.error.details;
        } else if (errJson.message) {
          message = errJson.message;
        }
      } catch {
        // Body was not JSON
        message = `${response.status} ${response.statusText}`;
      }

      throw new ApiRequestError(message, code, response.status, details);
    }

    return await response.json();
  } catch (err: unknown) {
    if (err instanceof ApiRequestError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Network connection failure';
    throw new ApiRequestError(
      `Cannot connect to backend (${url}): ${message}. Ensure FastAPI server is running.`,
      'NETWORK_ERROR',
      0
    );
  }
}

export const apiClient = {
  getBaseUrl(): string {
    return currentBaseUrl;
  },

  setBaseUrl(url: string): void {
    setApiBaseUrl(url);
  },

  /**
   * Health check endpoint: GET /health
   */
  async getHealth(): Promise<HealthResponse> {
    return request<HealthResponse>('/health');
  },

  /**
   * Initialize a new intake session: POST /sessions
   */
  async createSession(payload: CreateSessionPayload = {}): Promise<SessionCreateResponse> {
    const created = await request<SessionCreateResponse>('/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    sessionToken = created.access_token;
    sessionStorage.setItem(SESSION_TOKEN_KEY, created.access_token);
    sessionStorage.setItem(SESSION_ID_KEY, created.session_id);
    return created;
  },

  /**
   * Post conversational turn: POST /sessions/{session_id}/turn
   */
  async submitTurn(sessionId: string, payload: TurnRequestPayload): Promise<TurnResponse> {
    return request<TurnResponse>(`/sessions/${encodeURIComponent(sessionId)}/turn`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Retrieve session state and history: GET /sessions/{session_id}
   */
  async getSession(sessionId: string): Promise<SessionDetail> {
    return request<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`);
  },

  /**
   * Finalize and synthesize problem brief: POST /sessions/{session_id}/brief
   */
  async generateBrief(
    sessionId: string,
    payload: GenerateBriefPayload = {}
  ): Promise<ProblemBriefResponse> {
    return request<ProblemBriefResponse>(`/sessions/${encodeURIComponent(sessionId)}/brief`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async transcribeAudio(sessionId: string, audio: Blob): Promise<TranscriptionResponse> {
    const form = new FormData();
    const extension = audio.type.includes('webm') ? 'webm' : audio.type.includes('ogg') ? 'ogg' : 'wav';
    form.append('file', audio, `recording.${extension}`);
    form.append('language_code', 'en-IN');
    return request<TranscriptionResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/transcribe`,
      { method: 'POST', body: form }
    );
  },

  async synthesizeSpeech(sessionId: string, payload: SpeechPayload): Promise<Blob> {
    const endpoint = `/sessions/${encodeURIComponent(sessionId)}/speak`;
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = currentBaseUrl ? `${currentBaseUrl}${normalizedEndpoint}` : normalizedEndpoint;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let code = `HTTP_${response.status}`;
        let message = response.statusText || 'Request failed';
        try {
          const body = await response.json();
          const error = body.error ?? body.detail;
          if (typeof error === 'object' && error !== null) {
            code = error.code ?? code;
            message = error.message ?? message;
          }
        } catch {
          message = `${response.status} ${response.statusText}`;
        }
        throw new ApiRequestError(message, code, response.status);
      }
      return await response.blob();
    } catch (err: unknown) {
      if (err instanceof ApiRequestError) throw err;
      const message = err instanceof Error ? err.message : 'Network connection failure';
      throw new ApiRequestError(
        `Cannot connect to backend (${url}): ${message}. Ensure FastAPI server is running.`,
        'NETWORK_ERROR',
        0
      );
    }
  },

};

export const getStoredSessionId = (): string | null =>
  sessionStorage.getItem(SESSION_ID_KEY);
