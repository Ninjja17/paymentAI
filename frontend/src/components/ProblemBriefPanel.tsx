import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Users,
  Clock,
  ShieldAlert,
  Sliders,
  Wrench,
  Target,
  Copy,
  Check,
  Download,
  Flame,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import { ProblemBrief, SessionTurn, TriageCategory } from '../types';
import { ApiRequestError } from '../services/api';
import { RefractionCard } from './canvas/RefractionCard';
import { DecryptText } from './canvas/DecryptText';

interface ProblemBriefPanelProps {
  sessionId: string;
  readinessScore: number;
  extractedFacts: Record<string, unknown>;
  brief: ProblemBrief | null;
  turns: SessionTurn[];
  generatingBrief: boolean;
  briefError: ApiRequestError | null;
  onGenerateBrief: (forceSynthesis: boolean, notes?: string) => Promise<void>;
}

export const ProblemBriefPanel: React.FC<ProblemBriefPanelProps> = ({
  sessionId,
  readinessScore,
  extractedFacts,
  brief,
  turns,
  generatingBrief,
  briefError,
  onGenerateBrief,
}) => {
  const [activeTab, setActiveTab] = useState<'brief' | 'triage'>('brief');
  const [triageCategory, setTriageCategory] = useState<TriageCategory>('facts');
  const [forceSynthesis, setForceSynthesis] = useState(false);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);
  const [copied, setCopied] = useState(false);

  // Derive reported facts, assumptions, and unknowns from extractedFacts, turns, and brief
  const derivedFacts: Array<{ label: string; value: string }> = [];
  const derivedAssumptions: string[] = [];
  const derivedUnknowns: string[] = [];

  // 1. Process extracted facts from turns / backend
  if (extractedFacts && Object.keys(extractedFacts).length > 0) {
    Object.entries(extractedFacts).forEach(([key, val]) => {
      const formattedKey = key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
      derivedFacts.push({
        label: formattedKey,
        value: typeof val === 'object' ? JSON.stringify(val) : String(val),
      });
    });
  }

  // 2. Derive facts from brief if available
  if (brief) {
    if (brief.impacted_users) {
      derivedFacts.push({ label: 'Impacted Users', value: brief.impacted_users });
    }
    if (brief.frequency) {
      derivedFacts.push({ label: 'Observed Frequency', value: brief.frequency });
    }
    if (brief.current_workaround) {
      derivedFacts.push({ label: 'Current Workaround', value: brief.current_workaround });
    }

    if (brief.root_causes_hypotheses && brief.root_causes_hypotheses.length > 0) {
      brief.root_causes_hypotheses.forEach((hyp) => derivedAssumptions.push(hyp));
    }

    if (brief.constraints && brief.constraints.length > 0) {
      brief.constraints.forEach((c) => derivedAssumptions.push(`Constraint: ${c}`));
    }

    if (brief.unknowns && brief.unknowns.length > 0) {
      brief.unknowns.forEach((u) => derivedUnknowns.push(u));
    }
  }

  const handleSynthesizeClick = () => {
    onGenerateBrief(forceSynthesis || readinessScore < 0.5, additionalNotes.trim() || undefined);
  };

  const handleCopyMarkdown = () => {
    if (!brief) return;
    const md = `# Problem Brief: ${brief.title}

**Severity**: ${brief.severity}
**Readiness**: ${Math.round(readinessScore * 100)}%
**Generated**: ${new Date().toISOString()}

## Executive Summary
${brief.summary}

## Problem Statement
${brief.problem_statement}

## Impacted Users & Scope
${brief.impacted_users || 'Under investigation'}

## Current Workaround
${brief.current_workaround || 'None reported'}

## Frequency & Timing
${brief.frequency || 'Continuous / Under investigation'}

## Constraints
${brief.constraints?.map((c) => `- ${c}`).join('\n') || '- None documented'}

## Root Cause Hypotheses
${brief.root_causes_hypotheses?.map((h) => `- ${h}`).join('\n') || '- None documented'}

## Recommended Actions & Success Criteria
${brief.recommended_actions?.map((a) => `- ${a}`).join('\n') || '- None documented'}
`;

    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    if (!brief) return;
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `problem-brief-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getSeverityBadgeClass = (sev?: string) => {
    switch (sev?.toUpperCase()) {
      case 'CRITICAL':
        return 'badge-severity-critical';
      case 'HIGH':
        return 'badge-severity-high';
      case 'MEDIUM':
        return 'badge-severity-medium';
      case 'LOW':
        return 'badge-severity-low';
      default:
        return 'badge-neutral';
    }
  };

  return (
    <div className="brief-panel">
      {/* Top Header */}
      <div className="brief-panel-header">
        <div className="brief-panel-title-group">
          <div className="brief-title-wrapper">
            <FileText size={18} className="brief-header-icon" />
            <h2 className="panel-title">Structured Problem Brief</h2>
          </div>
          <span className="live-badge">
            Live Intelligence ({turns.length} {turns.length === 1 ? 'Turn' : 'Turns'})
          </span>
        </div>

        {/* Action: Synthesize Brief Button */}
        <div className="brief-header-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSynthesizeClick}
            disabled={generatingBrief}
            title="Synthesize and finalize problem brief"
          >
            {generatingBrief ? (
              <>
                <RefreshCw size={13} className="spin" />
                <span>Synthesizing...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Synthesize Brief</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Readiness Gauge Meter */}
      <RefractionCard intensity={1.1}>
        <div className="readiness-card">
          <div className="readiness-card-top">
            <div className="readiness-metric-label">
              <TrendingUp size={15} />
              <span>Synthesis Readiness Score</span>
            </div>
            <span className="readiness-score-value">{Math.round(readinessScore * 100)}%</span>
          </div>

          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(100, Math.max(5, readinessScore * 100))}%`,
                background:
                  readinessScore >= 0.7
                    ? 'linear-gradient(90deg, #10b981, #059669)'
                    : readinessScore >= 0.4
                    ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                    : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              }}
            />
          </div>

          <div className="readiness-subtext">
            {readinessScore >= 0.8 ? (
              <span className="text-success">Optimal readiness achieved for comprehensive problem brief.</span>
            ) : readinessScore >= 0.4 ? (
              <span className="text-warning">Moderate intake coverage. More facts will improve precision.</span>
            ) : (
              <span className="text-muted">Early discovery stage. Continue interview turns to build coverage.</span>
            )}
          </div>

          {/* Optional Force Synthesis & Notes Toggle */}
          <div className="force-synthesis-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={forceSynthesis}
                onChange={(e) => setForceSynthesis(e.target.checked)}
              />
              <span>Force synthesis (bypass minimum turns check)</span>
            </label>

            <button
              type="button"
              className="toggle-notes-btn"
              onClick={() => setShowNotesField(!showNotesField)}
            >
              <span>{showNotesField ? 'Hide Notes' : '+ Add Closing Notes'}</span>
              {showNotesField ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {showNotesField && (
            <div className="closing-notes-field">
              <input
                type="text"
                placeholder="e.g. Urgent escalation requested by payments team..."
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                className="notes-input"
              />
            </div>
          )}
        </div>
      </RefractionCard>

      {/* Synthesis Error Display */}
      {briefError && (
        <div className="brief-error-card">
          <div className="brief-error-header">
            <AlertCircle size={16} />
            <strong>Synthesis Notice: {briefError.code}</strong>
          </div>
          <p className="brief-error-text">{briefError.message}</p>
          {briefError.isOrchestratorNotConfigured && (
            <div className="brief-error-guidance">
              Backend multi-agent synthesis requires an AI provider configured in <code>backend/.env</code>.
            </div>
          )}
        </div>
      )}

      {/* Mode Switcher Tabs */}
      <div className="panel-tab-bar">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'brief' ? 'active' : ''}`}
          onClick={() => setActiveTab('brief')}
        >
          <FileText size={14} />
          <span>Structured Brief</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'triage' ? 'active' : ''}`}
          onClick={() => setActiveTab('triage')}
        >
          <Sliders size={14} />
          <span>Triage: Facts vs Assumptions vs Unknowns</span>
          <span className="triage-pill-count">{derivedFacts.length}</span>
        </button>
      </div>

      {/* Tab 1: Structured Problem Brief View */}
      {activeTab === 'brief' && (
        <div className="brief-content-scroll">
          {brief ? (
            <div className="brief-document">
              {/* Brief Title & Severity Header */}
              <div className="brief-doc-header">
                <div className="brief-meta-row">
                  <span className={`badge ${getSeverityBadgeClass(brief.severity)}`}>
                    <Flame size={12} />
                    <DecryptText text={`${brief.severity} SEVERITY`} speed={35} />
                  </span>
                  <div className="brief-export-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={handleCopyMarkdown}
                      title="Copy brief as Markdown"
                    >
                      {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                      <span>{copied ? 'Copied' : 'Copy MD'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={handleDownloadJson}
                      title="Download brief as JSON"
                    >
                      <Download size={12} />
                      <span>JSON</span>
                    </button>
                  </div>
                </div>

                <h3 className="brief-doc-title">
                  <DecryptText text={brief.title} speed={25} />
                </h3>
                <p className="brief-doc-summary">{brief.summary}</p>
              </div>

              {/* 1. Current Understanding / Problem Statement */}
              <div className="brief-section">
                <div className="section-title">
                  <Target size={15} />
                  <span>Current Understanding & Problem Statement</span>
                </div>
                <div className="section-box">
                  <p>{brief.problem_statement}</p>
                </div>
              </div>

              {/* 2. Affected People / Impacted Users */}
              <div className="brief-section">
                <div className="section-title">
                  <Users size={15} />
                  <span>Affected People / Impacted Users</span>
                </div>
                <div className="section-box">
                  <p>{brief.impacted_users || 'Quantification in progress through intake turns.'}</p>
                </div>
              </div>

              {/* 3. Current Workaround */}
              <div className="brief-section">
                <div className="section-title">
                  <Wrench size={15} />
                  <span>Current Workaround</span>
                </div>
                <div className="section-box">
                  <p>{brief.current_workaround || 'No formal workaround identified yet; operations team manually monitoring.'}</p>
                </div>
              </div>

              {/* 4. Frequency & Timing */}
              <div className="brief-section">
                <div className="section-title">
                  <Clock size={15} />
                  <span>Frequency & Trigger Conditions</span>
                </div>
                <div className="section-box">
                  <p>{brief.frequency || 'Occurs primarily during peak evening load cycles or post-release intervals.'}</p>
                </div>
              </div>

              {/* 5. Constraints */}
              <div className="brief-section">
                <div className="section-title">
                  <ShieldAlert size={15} />
                  <span>Operating & Technical Constraints</span>
                </div>
                <div className="section-box">
                  {brief.constraints && brief.constraints.length > 0 ? (
                    <ul className="bullet-list">
                      {brief.constraints.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">No hard constraints recorded yet.</p>
                  )}
                </div>
              </div>

              {/* 6. Root Causes Hypotheses & Unknowns */}
              <div className="brief-section">
                <div className="section-title">
                  <HelpCircle size={15} />
                  <span>Root Causes & Hypotheses</span>
                </div>
                <div className="section-box">
                  {brief.root_causes_hypotheses && brief.root_causes_hypotheses.length > 0 ? (
                    <ul className="bullet-list">
                      {brief.root_causes_hypotheses.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">Hypotheses pending deeper triage.</p>
                  )}
                </div>
              </div>

              {/* 7. Recommended Actions / Success Criteria */}
              <div className="brief-section">
                <div className="section-title">
                  <CheckCircle size={15} />
                  <span>Recommended Actions & Success Criteria</span>
                </div>
                <div className="section-box">
                  {brief.recommended_actions && brief.recommended_actions.length > 0 ? (
                    <ul className="bullet-list success-list">
                      {brief.recommended_actions.map((act, i) => (
                        <li key={i}>{act}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">Actions will be generated upon brief synthesis.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Live Intake Brief Blueprint (Before Final Synthesis) */
            <div className="brief-blueprint">
              <div className="blueprint-hero">
                <Cpu size={32} className="blueprint-icon" />
                <h3 className="blueprint-title">Live Problem Intake Blueprint</h3>
                <p className="blueprint-desc">
                  As you describe the issue, extracted facts and constraints populate this live brief in
                  real time. Click <strong>"Synthesize Brief"</strong> at any time to generate the formal artifact.
                </p>
              </div>

              {/* Dynamic Live Facts Breakdown */}
              <div className="live-brief-grid">
                <div className="live-card">
                  <div className="live-card-title">
                    <Target size={14} color="#6366f1" />
                    <span>Current Understanding</span>
                  </div>
                  <div className="live-card-body">
                    {extractedFacts.symptom ? (
                      <span className="fact-highlight">{String(extractedFacts.symptom)}</span>
                    ) : (
                      <span className="empty-cue">Symptom pending user description...</span>
                    )}
                  </div>
                </div>

                <div className="live-card">
                  <div className="live-card-title">
                    <Users size={14} color="#10b981" />
                    <span>Affected People / Service</span>
                  </div>
                  <div className="live-card-body">
                    {extractedFacts.affected_service || extractedFacts.affected_users ? (
                      <span className="fact-highlight">
                        {String(extractedFacts.affected_service || extractedFacts.affected_users)}
                      </span>
                    ) : (
                      <span className="empty-cue">Awaiting target system / volume...</span>
                    )}
                  </div>
                </div>

                <div className="live-card">
                  <div className="live-card-title">
                    <Clock size={14} color="#f59e0b" />
                    <span>Frequency & Triggers</span>
                  </div>
                  <div className="live-card-body">
                    {extractedFacts.trigger_condition || extractedFacts.frequency ? (
                      <span className="fact-highlight">
                        {String(extractedFacts.trigger_condition || extractedFacts.frequency)}
                      </span>
                    ) : (
                      <span className="empty-cue">Awaiting timing / peak load conditions...</span>
                    )}
                  </div>
                </div>

                <div className="live-card">
                  <div className="live-card-title">
                    <Wrench size={14} color="#ec4899" />
                    <span>Current Workaround</span>
                  </div>
                  <div className="live-card-body">
                    {extractedFacts.workaround ? (
                      <span className="fact-highlight">{String(extractedFacts.workaround)}</span>
                    ) : (
                      <span className="empty-cue">No temporary mitigation noted yet...</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Intake Readiness Notice */}
              <div className="synthesis-callout">
                <Sparkles size={16} />
                <div className="synthesis-callout-text">
                  <strong>Ready to finalize?</strong> When ready, click "Synthesize Brief" to run the
                  multi-agent intake synthesizer.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Three-Way Triage Categorization */}
      {activeTab === 'triage' && (
        <div className="triage-panel-content">
          {/* Triage Sub-Tabs */}
          <div className="triage-subtabs">
            <button
              type="button"
              className={`triage-subtab facts ${triageCategory === 'facts' ? 'active' : ''}`}
              onClick={() => setTriageCategory('facts')}
            >
              <span className="triage-dot green" />
              <span>Reported Facts ({derivedFacts.length})</span>
            </button>

            <button
              type="button"
              className={`triage-subtab assumptions ${
                triageCategory === 'assumptions' ? 'active' : ''
              }`}
              onClick={() => setTriageCategory('assumptions')}
            >
              <span className="triage-dot yellow" />
              <span>Assumptions & Hypotheses ({derivedAssumptions.length})</span>
            </button>

            <button
              type="button"
              className={`triage-subtab unknowns ${triageCategory === 'unknowns' ? 'active' : ''}`}
              onClick={() => setTriageCategory('unknowns')}
            >
              <span className="triage-dot purple" />
              <span>Unknowns & Questions ({derivedUnknowns.length})</span>
            </button>
          </div>

          <div className="triage-list-scroll">
            {triageCategory === 'facts' && (
              <div className="triage-items-group">
                <div className="triage-category-desc facts-desc">
                  <strong>🟢 Reported Facts:</strong> Directly stated or validated by the problem
                  giver during intake turns. High confidence data.
                </div>
                {derivedFacts.length === 0 ? (
                  <div className="triage-empty">
                    <span>No reported facts extracted yet. Provide specific error details in chat.</span>
                  </div>
                ) : (
                  <div className="triage-cards-list">
                    {derivedFacts.map((fact, i) => (
                      <div key={i} className="triage-fact-card">
                        <span className="fact-key">{fact.label}</span>
                        <span className="fact-val">{fact.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {triageCategory === 'assumptions' && (
              <div className="triage-items-group">
                <div className="triage-category-desc assumptions-desc">
                  <strong>🟡 Working Assumptions & Hypotheses:</strong> Inferred root causes, probable
                  bottlenecks, or working assumptions that need validation.
                </div>
                {derivedAssumptions.length === 0 ? (
                  <div className="triage-empty">
                    <span>
                      No assumptions synthesized yet. Synthesize the brief or continue turns.
                    </span>
                  </div>
                ) : (
                  <ul className="triage-bullet-list assumptions-list">
                    {derivedAssumptions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {triageCategory === 'unknowns' && (
              <div className="triage-items-group">
                <div className="triage-category-desc unknowns-desc">
                  <strong>🟣 Unresolved Questions & Unknowns:</strong> Critical unknowns and gaps
                  identified by the Intake Agent that require additional data.
                </div>
                {derivedUnknowns.length === 0 ? (
                  <div className="triage-empty">
                    <span>
                      Unknowns are surfaced as the InterviewerAgent identifies missing diagnostic criteria.
                    </span>
                  </div>
                ) : (
                  <ul className="triage-bullet-list unknowns-list">
                    {derivedUnknowns.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
