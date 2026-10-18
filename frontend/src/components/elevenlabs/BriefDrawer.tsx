import React, { useState } from 'react';
import {
  X,
  FileText,
  Sparkles,
  Copy,
  Check,
  Download,
  AlertCircle,
  RefreshCw,
  Target,
  Users,
  Wrench,
  ShieldAlert,
  CheckCircle,
} from 'lucide-react';
import { ProblemBrief, SessionTurn } from '../../types';
import { ApiRequestError } from '../../services/api';

interface BriefDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  brief: ProblemBrief | null;
  readinessScore: number;
  extractedFacts: Record<string, unknown>;
  turns: SessionTurn[];
  generatingBrief: boolean;
  briefError: ApiRequestError | null;
  onSynthesize: (force: boolean, notes?: string) => Promise<void>;
}

export const BriefDrawer: React.FC<BriefDrawerProps> = ({
  isOpen,
  onClose,
  brief,
  readinessScore,
  extractedFacts,
  turns,
  generatingBrief,
  briefError,
  onSynthesize,
}) => {
  const [copied, setCopied] = useState(false);
  const [forceSynthesis, setForceSynthesis] = useState(false);
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!brief) return;
    const text = `# Problem Brief: ${brief.title}
Severity: ${brief.severity}

## Summary
${brief.summary}

## Problem Statement
${brief.problem_statement}

## Impacted Users
${brief.impacted_users || 'Under investigation'}

## Workaround
${brief.current_workaround || 'None reported'}

## Recommended Actions
${brief.recommended_actions?.map((a) => `- ${a}`).join('\n') || 'None generated'}

## Evidence
${brief.evidence?.map((item) => `- ${item}`).join('\n') || 'None recorded'}

## Assumptions
${brief.assumptions?.map((item) => `- ${item}`).join('\n') || 'None recorded'}

## Open Questions
${brief.open_questions?.map((item) => `- ${item}`).join('\n') || 'None recorded'}
`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!brief) return;
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `problem-brief.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="el-drawer-overlay" onClick={onClose}>
      <div className="el-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="el-drawer-header">
          <div className="drawer-title-group">
            <FileText size={18} />
            <div>
              <h3 className="drawer-title">Problem Brief</h3>
              <p className="drawer-subtitle">
                Synthesized artifact from {turns.length} conversational turns
              </p>
            </div>
          </div>
          <button type="button" className="el-drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="el-drawer-body">
          {/* Readiness & Synthesize Bar */}
          <div className="drawer-readiness-box">
            <div className="readiness-header-row">
              <span className="readiness-lbl">Readiness Score</span>
              <span className="readiness-val">{Math.round(readinessScore * 100)}%</span>
            </div>
            <div className="drawer-progress-track">
              <div
                className="drawer-progress-fill"
                style={{ width: `${Math.min(100, Math.max(5, readinessScore * 100))}%` }}
              />
            </div>

            <div className="drawer-actions-row">
              <label className="drawer-force-label">
                <input
                  type="checkbox"
                  checked={forceSynthesis}
                  onChange={(e) => setForceSynthesis(e.target.checked)}
                />
                <span>Force synthesis</span>
              </label>

              <button
                type="button"
                className="el-btn-primary el-btn-xs"
                onClick={() => onSynthesize(forceSynthesis, notes.trim() || undefined)}
                disabled={generatingBrief}
              >
                {generatingBrief ? (
                  <>
                    <RefreshCw size={12} className="spin" />
                    <span>Synthesizing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={12} />
                    <span>Synthesize Brief</span>
                  </>
                )}
              </button>
            </div>

            <input
              type="text"
              className="drawer-notes-input"
              placeholder="Optional closing notes for brief..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Brief Error Display */}
          {briefError && (
            <div className="drawer-error-card">
              <AlertCircle size={15} />
              <span>{briefError.message}</span>
            </div>
          )}

          {/* Render Brief Artifact or Live Extracted Facts */}
          {brief ? (
            <div className="drawer-brief-content">
              <div className="drawer-brief-top">
                <span className="drawer-severity-badge">{brief.severity} SEVERITY</span>
                <div className="drawer-export-btns">
                  <button type="button" className="el-icon-btn-xs" onClick={handleCopy}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copied ? 'Copied' : 'MD'}</span>
                  </button>
                  <button type="button" className="el-icon-btn-xs" onClick={handleDownload}>
                    <Download size={12} />
                    <span>JSON</span>
                  </button>
                </div>
              </div>

              <h4 className="drawer-brief-title">{brief.title}</h4>
              <p className="drawer-brief-summary">{brief.summary}</p>

              <div className="drawer-section">
                <div className="drawer-sec-title">
                  <Target size={14} /> Problem Statement
                </div>
                <div className="drawer-sec-body">{brief.problem_statement}</div>
              </div>

              <div className="drawer-section">
                <div className="drawer-sec-title">
                  <Users size={14} /> Impacted Users
                </div>
                <div className="drawer-sec-body">{brief.impacted_users || 'Quantifying...'}</div>
              </div>

              <div className="drawer-section">
                <div className="drawer-sec-title">
                  <Wrench size={14} /> Current Workaround
                </div>
                <div className="drawer-sec-body">{brief.current_workaround || 'None recorded'}</div>
              </div>

              <div className="drawer-section">
                <div className="drawer-sec-title">
                  <ShieldAlert size={14} /> Constraints
                </div>
                <div className="drawer-sec-body">
                  {brief.constraints && brief.constraints.length > 0 ? (
                    <ul>
                      {brief.constraints.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>No hard constraints recorded.</span>
                  )}
                </div>
              </div>

              <div className="drawer-section">
                <div className="drawer-sec-title">
                  <CheckCircle size={14} /> Recommended Actions
                </div>
                <div className="drawer-sec-body">
                  {brief.recommended_actions && brief.recommended_actions.length > 0 ? (
                    <ul>
                      {brief.recommended_actions.map((act, i) => (
                        <li key={i}>{act}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>Actions will appear after deep analysis.</span>
                  )}
                </div>
              </div>

              {[
                { title: 'Evidence', items: brief.evidence },
                { title: 'Assumptions', items: brief.assumptions },
                { title: 'Open Questions', items: brief.open_questions },
              ].map(({ title, items }) => (
                <div className="drawer-section" key={title}>
                  <div className="drawer-sec-title">{title}</div>
                  <div className="drawer-sec-body">
                    {items?.length ? (
                      <ul>
                        {items.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    ) : (
                      <span>None recorded.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="drawer-live-facts">
              <h4 className="drawer-facts-heading">Live Extracted Facts:</h4>
              {Object.keys(extractedFacts).length === 0 ? (
                <p className="drawer-empty-facts">
                  No facts captured yet. Answer the agent's questions in chat to populate this brief.
                </p>
              ) : (
                <div className="drawer-facts-list">
                  {Object.entries(extractedFacts).map(([k, v]) => (
                    <div key={k} className="drawer-fact-item">
                      <span className="fact-k">{k.replace(/_/g, ' ')}</span>
                      <span className="fact-v">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
