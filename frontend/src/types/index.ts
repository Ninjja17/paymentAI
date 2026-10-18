/**
 * Type definitions matching API_CONTRACT.md and backend Pydantic schemas.
 */

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
  services: {
    session_store: string;
    agent_orchestrator: string;
    [key: string]: string;
  };
}

export interface CreateSessionPayload {
  user_name?: string;
  initial_goal?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionCreateResponse {
  session_id: string;
  status: 'active' | 'completed' | 'paused' | string;
  created_at: string;
  updated_at: string;
  user_name?: string | null;
  initial_goal?: string | null;
  intake_stage: 'discovery' | 'clarification' | 'synthesis' | 'completed' | string;
  turn_count: number;
  metadata: Record<string, unknown>;
  access_token: string;
  token_type: 'bearer';
  token_expires_at: string;
}

export interface SessionTurn {
  turn_id: string;
  role: 'user' | 'agent';
  agent_name?: string | null;
  message: string;
  timestamp: string;
}

export interface TurnRequestPayload {
  user_input: string;
  audio_payload?: string | null;
  speaker_tag?: string;
  client_timestamp?: string;
}

export interface TurnResponse {
  session_id: string;
  turn_id: string;
  agent_role: string;
  agent_message: string;
  audio_url?: string | null;
  intake_stage: string;
  extracted_facts: Record<string, unknown>;
  suggested_next_steps: string[];
  brief_readiness_score: number;
  timestamp: string;
}

export interface ProblemBrief {
  title: string;
  summary: string;
  problem_statement: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  impacted_users?: string | null;
  root_causes_hypotheses: string[];
  constraints: string[];
  recommended_actions: string[];
  evidence: string[];
  assumptions: string[];
  open_questions: string[];
  current_workaround?: string | null;
  frequency?: string | null;
  attempted_solutions?: string[];
  unknowns?: string[];
  success_criteria?: string[];
}

export interface GenerateBriefPayload {
  force_synthesis?: boolean;
  additional_notes?: string;
}

export interface ProblemBriefResponse {
  session_id: string;
  brief_id: string;
  status: string;
  generated_at: string;
  readiness_score: number;
  brief: ProblemBrief;
}

export interface SessionDetail {
  session_id: string;
  status: string;
  user_name?: string | null;
  intake_stage: string;
  created_at: string;
  updated_at: string;
  brief_readiness_score: number;
  turns: SessionTurn[];
  extracted_facts: Record<string, unknown>;
  brief?: ProblemBrief | null;
  metadata: Record<string, unknown>;
}

export interface TranscriptionResponse {
  transcript: string;
  language_code: string | null;
}

export interface SpeechPayload {
  text: string;
  language_code?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type TriageCategory = 'facts' | 'assumptions' | 'unknowns';
