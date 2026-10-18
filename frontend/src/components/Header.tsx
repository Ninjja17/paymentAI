import React from 'react';
import { RefreshCw, AlertCircle, PlusCircle, Settings } from 'lucide-react';
import { HealthResponse } from '../types';
import { VoiceAuraCanvas } from './canvas/VoiceAuraCanvas';
import { DecryptText } from './canvas/DecryptText';

interface HeaderProps {
  health: HealthResponse | null;
  loadingHealth: boolean;
  healthError: string | null;
  sessionId: string | null;
  intakeStage?: string;
  readinessScore: number;
  onRefreshHealth: () => void;
  onOpenNewSession: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  loadingHealth,
  healthError,
  sessionId,
  intakeStage = 'discovery',
  readinessScore,
  onRefreshHealth,
  onOpenNewSession,
  onOpenSettings,
}) => {
  const isHealthy = health?.status === 'healthy';

  const getStageBadgeClass = (stage: string) => {
    switch (stage.toLowerCase()) {
      case 'discovery':
        return 'badge-stage-discovery';
      case 'clarification':
        return 'badge-stage-clarification';
      case 'synthesis':
        return 'badge-stage-synthesis';
      case 'completed':
        return 'badge-stage-completed';
      default:
        return 'badge-neutral';
    }
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <VoiceAuraCanvas active={isHealthy} size={32} />
          </div>
          <div className="brand-text">
            <div className="brand-title">
              Problem Intake Agent
              <span className="brand-version-tag">Canvas UI</span>
            </div>
            <div className="brand-subtitle">
              Voice & Conversational Diagnostic Studio • Multi-Agent Intake
            </div>
          </div>
        </div>

        {sessionId && (
          <div className="session-pill">
            <span className="session-label">Session:</span>
            <code className="session-id" title={sessionId}>
              <DecryptText
                text={sessionId.length > 18 ? `${sessionId.slice(0, 10)}...${sessionId.slice(-6)}` : sessionId}
                speed={35}
              />
            </code>
            <span className={`badge ${getStageBadgeClass(intakeStage)}`}>
              <DecryptText text={intakeStage.toUpperCase()} speed={40} />
            </span>
          </div>
        )}
      </div>

      <div className="header-right">
        {/* Readiness Meter in Header */}
        {sessionId && (
          <div className="header-readiness" title={`Intake readiness: ${Math.round(readinessScore * 100)}%`}>
            <div className="readiness-label-group">
              <span className="readiness-title">Intake Readiness</span>
              <span className="readiness-percent">{Math.round(readinessScore * 100)}%</span>
            </div>
            <div className="readiness-bar-track">
              <div
                className="readiness-bar-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, readinessScore * 100))}%`,
                  backgroundColor:
                    readinessScore >= 0.8 ? '#10b981' : readinessScore >= 0.4 ? '#f59e0b' : '#6366f1',
                }}
              />
            </div>
          </div>
        )}

        {/* Backend Connectivity Status */}
        <div
          className={`health-badge-btn ${
            loadingHealth ? 'loading' : isHealthy ? 'healthy' : 'unhealthy'
          }`}
          onClick={onOpenSettings}
          title={healthError || (isHealthy ? `Connected to backend (v${health?.version})` : 'Backend connection issue')}
          role="button"
          tabIndex={0}
        >
          {loadingHealth ? (
            <>
              <RefreshCw size={13} className="spin" />
              <span>Checking</span>
            </>
          ) : isHealthy ? (
            <>
              <span className="pulse-indicator online" />
              <span>API Online (v{health?.version})</span>
            </>
          ) : (
            <>
              <AlertCircle size={13} className="error-icon" />
              <span>API Disconnected</span>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <button
          className="btn btn-secondary btn-icon-only"
          onClick={onRefreshHealth}
          disabled={loadingHealth}
          title="Refresh backend status"
          aria-label="Refresh health"
        >
          <RefreshCw size={15} className={loadingHealth ? 'spin' : ''} />
        </button>

        <button
          className="btn btn-secondary btn-icon-only"
          onClick={onOpenSettings}
          title="API Configuration & Diagnostics"
          aria-label="Settings"
        >
          <Settings size={15} />
        </button>

        <button
          className="btn btn-primary btn-sm"
          onClick={onOpenNewSession}
          title="Start a new problem intake session"
        >
          <PlusCircle size={15} />
          <span>New Session</span>
        </button>
      </div>
    </header>
  );
};
