import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  User,
  Bot,
  Play,
  Pause,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  FileText,
  Clock,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import { SessionTurn, ProblemBrief } from '../../types';
import { ApiRequestError, apiClient } from '../../services/api';

interface ElevenLabsChatStreamProps {
  turns: SessionTurn[];
  submittingTurn: boolean;
  lastTurnError: ApiRequestError | null;
  brief: ProblemBrief | null;
  suggestedPrompts: string[];
  onSelectPrompt: (prompt: string) => void;
  onRetryTurn: () => void;
  onOpenBrief: () => void;
  sessionId: string | null;
  onAudioError: (message: string, error?: ApiRequestError) => void;
  isSpeakerMuted: boolean;
  autoSpeakTurnId: string | null;
}

export const ElevenLabsChatStream: React.FC<ElevenLabsChatStreamProps> = ({
  turns,
  submittingTurn,
  lastTurnError,
  brief,
  suggestedPrompts,
  onSelectPrompt,
  onRetryTurn,
  onOpenBrief,
  sessionId,
  onAudioError,
  isSpeakerMuted,
  autoSpeakTurnId,
}) => {
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const autoSpokenTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, submittingTurn, lastTurnError]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = isSpeakerMuted;
  }, [isSpeakerMuted]);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const toggleAudioPlayback = useCallback(async (turn: SessionTurn, id: string) => {
    if (playingTurnId === id) {
      audioRef.current?.pause();
      audioRef.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      setPlayingTurnId(null);
      return;
    }
    if (!sessionId) {
      onAudioError('Start a session before requesting voice playback.');
      return;
    }
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    setPlayingTurnId(id);
    try {
      const audioBlob = await apiClient.synthesizeSpeech(sessionId, {
        text: turn.message,
        language_code: 'en-IN',
      });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.muted = isSpeakerMuted;
      audioUrlRef.current = audioUrl;
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingTurnId(null);
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingTurnId(null);
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
        audioRef.current = null;
        onAudioError('The synthesized audio could not be played.');
      };
      await audio.play();
      onAudioError('');
    } catch (err: unknown) {
      setPlayingTurnId(null);
      const message = err instanceof Error ? err.message : 'Speech playback failed.';
      onAudioError(message, err instanceof ApiRequestError ? err : undefined);
    }
  }, [isSpeakerMuted, onAudioError, playingTurnId, sessionId]);

  useEffect(() => {
    if (!autoSpeakTurnId || isSpeakerMuted || autoSpokenTurnIdRef.current === autoSpeakTurnId) {
      return;
    }
    const turn = turns.find((item) => item.turn_id === autoSpeakTurnId);
    if (turn?.role === 'agent') {
      autoSpokenTurnIdRef.current = autoSpeakTurnId;
      void toggleAudioPlayback(turn, autoSpeakTurnId);
    }
  }, [autoSpeakTurnId, isSpeakerMuted, toggleAudioPlayback, turns]);

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="el-chat-stream">
      {turns.length === 0 ? (
        <div className="el-empty-intro">
          <div className="el-intro-badge">
            <Sparkles size={13} />
            <span>Problem Discovery Mode</span>
          </div>
          <h2 className="el-intro-heading">Describe Your Issue</h2>
          <p className="el-intro-text">
            Speak or type naturally. The Problem Intake Agent analyzes symptoms, captures affected
            stakeholders, checks workarounds, and synthesizes an executive problem brief.
          </p>

          <div className="el-prompt-chips-grid">
            <button
              type="button"
              className="el-starter-chip"
              onClick={() =>
                onSelectPrompt(
                  'Users are encountering payment timeout errors (>12%) during peak evening hours (18:00 - 21:00 IST) on UPI transactions.'
                )
              }
            >
              <span>"UPI payment timeout errors during peak hours..."</span>
              <ArrowRight size={13} />
            </button>
            <button
              type="button"
              className="el-starter-chip"
              onClick={() =>
                onSelectPrompt(
                  'Our KYC verification pipeline is dropping 18% of ID document uploads on mobile Safari due to client camera orientation parsing bugs.'
                )
              }
            >
              <span>"Mobile Safari KYC document upload failure rate..."</span>
              <ArrowRight size={13} />
            </button>
            <button
              type="button"
              className="el-starter-chip"
              onClick={() =>
                onSelectPrompt(
                  'The checkout page latency spiked from 320ms to 2400ms following the v2.4.1 aggregator release, causing cart abandonments.'
                )
              }
            >
              <span>"Checkout latency spike following v2.4.1 release..."</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div className="el-messages-container">
          {turns.map((turn, i) => {
            const isUser = turn.role === 'user';
            const turnKey = turn.turn_id || `turn-${i}`;
            const isPlaying = playingTurnId === turnKey;

            return (
              <div key={turnKey} className={`el-message-row ${isUser ? 'user' : 'agent'}`}>
                <div className="el-message-avatar">
                  {isUser ? <User size={15} /> : <Bot size={15} />}
                </div>

                <div className="el-message-bubble-box">
                  <div className="el-message-meta">
                    <span className="el-message-author">
                      {isUser ? 'You' : turn.agent_name || 'InterviewerAgent'}
                    </span>
                    <span className="el-message-time">
                      <Clock size={11} /> {formatTime(turn.timestamp)}
                    </span>
                  </div>

                  <div className="el-message-bubble">
                    <p>{turn.message}</p>
                  </div>

                  {/* Audio utterance playback on agent turns */}
                  {!isUser && (
                    <div className="el-message-actions">
                      <button
                        type="button"
                        className={`el-audio-play-btn ${isPlaying ? 'playing' : ''}`}
                        onClick={() => void toggleAudioPlayback(turn, turnKey)}
                        title={isPlaying ? 'Pause voice playback' : 'Play synthesized voice audio'}
                      >
                        {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                        <span>{isPlaying ? 'Playing Voice...' : 'Listen'}</span>
                      </button>

                      {isPlaying && (
                        <div className="el-inline-waveform">
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Submitting in-flight turn */}
          {submittingTurn && (
            <div className="el-message-row agent submitting">
              <div className="el-message-avatar">
                <Bot size={15} />
              </div>
              <div className="el-message-bubble-box">
                <div className="el-message-bubble el-thinking-bubble">
                  <div className="el-dots-loader">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="el-thinking-text">Formulating diagnostic question...</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Banner (e.g. 501 AGENT_ORCHESTRATOR_NOT_CONFIGURED) */}
          {lastTurnError && (
            <div className="el-error-card">
              <div className="el-error-header">
                <AlertTriangle size={16} />
                <strong>
                  {lastTurnError.isOrchestratorNotConfigured
                    ? 'AI Provider Setup Required'
                    : 'Turn Processing Error'}
                </strong>
                <span className="el-error-badge">{lastTurnError.code}</span>
              </div>
              <p className="el-error-message">{lastTurnError.message}</p>

              {lastTurnError.isOrchestratorNotConfigured && (
                <div className="el-setup-instructions">
                  <div className="instructions-title">
                    <Terminal size={13} />
                    <span>How to activate AI responses:</span>
                  </div>
                  <ol>
                    <li>Open <code>backend/.env</code> in your editor.</li>
                    <li>Add your API key (e.g. <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, or <code>GEMINI_API_KEY</code>).</li>
                    <li>Restart the backend server.</li>
                  </ol>
                </div>
              )}

              <button
                type="button"
                className="el-btn-secondary el-btn-xs"
                onClick={onRetryTurn}
                disabled={submittingTurn}
              >
                <RotateCcw size={12} />
                <span>Retry Turn</span>
              </button>
            </div>
          )}

          {/* Inline Brief Card (When Brief is synthesized) */}
          {brief && (
            <div className="el-inline-brief-card" onClick={onOpenBrief} role="button" tabIndex={0}>
              <div className="el-brief-card-header">
                <div className="brief-card-icon">
                  <FileText size={18} />
                </div>
                <div>
                  <span className="brief-card-tag">{brief.severity} SEVERITY BRIEF</span>
                  <h4 className="brief-card-title">{brief.title}</h4>
                </div>
              </div>
              <p className="brief-card-summary">{brief.summary}</p>
              <div className="brief-card-footer">
                <span>Click to view complete structured brief & recommendations</span>
                <ArrowRight size={14} />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Suggested Follow-up Prompts Carousel */}
      {suggestedPrompts.length > 0 && !submittingTurn && (
        <div className="el-suggestions-bar">
          <span className="suggestions-label">Suggested follow-ups:</span>
          <div className="suggestions-scroll">
            {suggestedPrompts.map((prompt, index) => (
              <button
                key={index}
                type="button"
                className="el-suggestion-chip"
                onClick={() => onSelectPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
