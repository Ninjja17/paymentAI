import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  User,
  Bot,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  HelpCircle,
  Lightbulb,
  Clock,
  Terminal,
  Mic,
  Copy,
  Check,
} from 'lucide-react';
import { SessionTurn } from '../types';
import { ApiRequestError } from '../services/api';
import { VoiceAuraCanvas } from './canvas/VoiceAuraCanvas';
import { RefractionCard } from './canvas/RefractionCard';

interface ConversationAreaProps {
  sessionId: string;
  userName?: string | null;
  initialGoal?: string | null;
  turns: SessionTurn[];
  submittingTurn: boolean;
  lastTurnError: ApiRequestError | null;
  suggestedPrompts: string[];
  onSendTurn: (userInput: string) => Promise<void>;
  onRetryLastTurn: () => void;
}

export const ConversationArea: React.FC<ConversationAreaProps> = ({
  sessionId,
  userName,
  initialGoal,
  turns,
  submittingTurn,
  lastTurnError,
  suggestedPrompts,
  onSendTurn,
  onRetryLastTurn,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new turns or errors
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, submittingTurn, lastTurnError]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || submittingTurn) return;

    setInputText('');
    await onSendTurn(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePromptClick = (prompt: string) => {
    setInputText(prompt);
    textareaRef.current?.focus();
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTimestamp = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="conversation-panel">
      {/* Conversation Header */}
      <div className="conversation-header" title={`Session ID: ${sessionId}`}>
        <div className="conversation-header-info">
          <div className="conversation-title-row">
            <h2 className="panel-title">Intake Dialogue</h2>
            <span className="turn-count-badge">
              {turns.length} {turns.length === 1 ? 'Turn' : 'Turns'}
            </span>
          </div>
          <div className="conversation-meta-sub">
            {userName ? (
              <span>
                Interviewing <strong>{userName}</strong>
              </span>
            ) : (
              <span>Anonymous Stakeholder</span>
            )}
            {initialGoal && (
              <span className="goal-indicator" title={initialGoal}>
                • Goal: {initialGoal}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="conversation-messages">
        {turns.length === 0 ? (
          <div className="empty-conversation">
            <div className="empty-icon-wrapper">
              <Sparkles size={28} />
            </div>
            <h3 className="empty-title">Start the Intake Discovery</h3>
            <p className="empty-desc">
              Explain the problem in your own words. The Problem Intake Agent will dissect symptoms,
              quantify affected users, uncover root-cause hypotheses, and construct a structured problem brief.
            </p>

            <div className="discovery-questions-box">
              <div className="discovery-header">
                <HelpCircle size={15} />
                <span>Key Aspects to Cover:</span>
              </div>
              <ul className="discovery-list">
                <li><strong>What happened?</strong> Core symptoms, error messages, or anomalies.</li>
                <li><strong>Who is affected?</strong> Specific customer segment, team, or service volume.</li>
                <li><strong>How often?</strong> Occurs continuously, during peak traffic, or after deploy.</li>
                <li><strong>Workarounds?</strong> How the issue is currently mitigated or bypassed.</li>
                <li><strong>Constraints?</strong> Regulatory, latency, SLA, or zero-downtime boundaries.</li>
              </ul>
            </div>

            <div className="sample-prompts-section">
              <div className="sample-prompts-label">
                <Lightbulb size={14} />
                <span>Example Intake Scenarios (Click to Use):</span>
              </div>
              <div className="sample-prompts-grid">
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() =>
                    handlePromptClick(
                      'Users are encountering payment timeout errors (>12%) during peak evening hours (18:00 - 21:00 IST) on UPI transactions.'
                    )
                  }
                >
                  "UPI payment timeout errors during peak hours..."
                </button>
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() =>
                    handlePromptClick(
                      'Our KYC verification pipeline is dropping 18% of ID document uploads on mobile Safari due to client camera orientation parsing bugs.'
                    )
                  }
                >
                  "Mobile Safari KYC document upload failure rate..."
                </button>
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() =>
                    handlePromptClick(
                      'The checkout page latency spiked from 320ms to 2400ms following the v2.4.1 aggregator release, causing cart abandonments.'
                    )
                  }
                >
                  "Checkout latency spike following v2.4.1 release..."
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {turns.map((turn, index) => {
              const isUser = turn.role === 'user';
              const turnKey = turn.turn_id || `turn-${index}`;

              return (
                <div
                  key={turnKey}
                  className={`message-row ${isUser ? 'message-user' : 'message-agent'}`}
                >
                  <div className="message-avatar">
                    {isUser ? <User size={16} /> : <Bot size={16} />}
                  </div>

                  <div className="message-bubble-wrapper">
                    <div className="message-header-meta">
                      <span className="sender-name">
                        {isUser ? userName || 'Problem Giver' : turn.agent_name || 'InterviewerAgent'}
                      </span>
                      {!isUser && (
                        <span className="agent-role-tag">Agent</span>
                      )}
                      <span className="message-time">
                        <Clock size={11} /> {formatTimestamp(turn.timestamp)}
                      </span>
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => handleCopyText(turnKey, turn.message)}
                        title="Copy message text"
                      >
                        {copiedId === turnKey ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                      </button>
                    </div>

                    <div className="message-content">
                      <p>{turn.message}</p>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Submitting in-flight turn */}
            {submittingTurn && (
              <div className="message-row message-agent submitting-row">
                <div className="message-avatar submitting">
                  <VoiceAuraCanvas active={true} size={32} />
                </div>
                <div className="message-bubble-wrapper">
                  <div className="message-header-meta">
                    <span className="sender-name">InterviewerAgent</span>
                    <span className="agent-role-tag">Processing</span>
                  </div>
                  <div className="message-content message-submitting-indicator">
                    <div className="typing-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="typing-text">Synthesizing turn & extracting facts...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error Message Display (e.g. 501 AGENT_ORCHESTRATOR_NOT_CONFIGURED) */}
            {lastTurnError && (
              <RefractionCard intensity={1.2}>
                <div className="turn-error-banner">
                  <div className="error-banner-header">
                    <div className="error-icon-box">
                      <AlertTriangle size={18} />
                    </div>
                    <div>
                      <h4 className="error-title">
                        {lastTurnError.isOrchestratorNotConfigured
                          ? 'AI Agent Provider Setup Required'
                          : 'Turn Processing Failed'}
                      </h4>
                      <span className="error-code-badge">
                        {lastTurnError.code} ({lastTurnError.statusCode || 'Network Error'})
                      </span>
                    </div>
                  </div>

                  <div className="error-banner-body">
                    <p className="error-message-text">{lastTurnError.message}</p>

                    {lastTurnError.isOrchestratorNotConfigured && (
                      <div className="setup-guidance-box">
                        <div className="guidance-title">
                          <Terminal size={14} /> Backend Setup Instructions:
                        </div>
                        <p className="guidance-desc">
                          The backend returned <code>501 AGENT_ORCHESTRATOR_NOT_CONFIGURED</code>.
                          To activate dynamic AI responses:
                        </p>
                        <ol className="guidance-steps">
                          <li>
                            Open <code>backend/.env</code> in your repository.
                          </li>
                          <li>
                            Configure your AI provider API key (e.g., <code>OPENAI_API_KEY</code>,{' '}
                            <code>ANTHROPIC_API_KEY</code>, or <code>GEMINI_API_KEY</code>).
                          </li>
                          <li>Restart the backend FastAPI server so the agent orchestrator is initialized.</li>
                        </ol>
                      </div>
                    )}

                    <div className="error-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={onRetryLastTurn}
                        disabled={submittingTurn}
                      >
                        <RotateCcw size={14} />
                        <span>Retry Turn</span>
                      </button>
                    </div>
                  </div>
                </div>
              </RefractionCard>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Suggested Follow-ups Chips */}
      {suggestedPrompts.length > 0 && !submittingTurn && (
        <div className="suggested-prompts-bar">
          <span className="suggested-label">
            <Lightbulb size={13} /> Suggested next detail:
          </span>
          <div className="suggested-chips-scroll">
            {suggestedPrompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                className="chip-suggestion"
                onClick={() => handlePromptClick(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Dock */}
      <div className="conversation-input-dock">
        <form onSubmit={handleSend} className="input-form">
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder="Describe symptoms, affected users, frequency, workarounds, or constraints..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={submittingTurn}
            />

            <div className="input-actions-bar">
              <div className="input-meta-left">
                <span className="voice-channel-pill" title="Ready for Voice Input Channel">
                  <VoiceAuraCanvas active={submittingTurn} size={16} />
                  <Mic size={12} />
                  <span>Voice / Text Engine</span>
                </span>
                <span className="input-hint">
                  Press <strong>Enter</strong> to send, <strong>Shift+Enter</strong> for newline
                </span>
              </div>

              <div className="input-meta-right">
                {inputText.trim().length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setInputText('')}
                    disabled={submittingTurn}
                  >
                    Clear
                  </button>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!inputText.trim() || submittingTurn}
                >
                  <Send size={15} />
                  <span>{submittingTurn ? 'Sending...' : 'Send Turn'}</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
