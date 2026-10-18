import React from 'react';
import { Sparkles, FileText, Settings, Radio } from 'lucide-react';
import { HealthResponse } from '../../types';

interface ElevenLabsHeaderProps {
  health: HealthResponse | null;
  loadingHealth: boolean;
  readinessScore: number;
  hasBrief: boolean;
  onOpenBrief: () => void;
  onOpenSettings: () => void;
  onNewSession: () => void;
}

export const ElevenLabsHeader: React.FC<ElevenLabsHeaderProps> = ({
  health,
  loadingHealth,
  readinessScore,
  hasBrief,
  onOpenBrief,
  onOpenSettings,
  onNewSession,
}) => {
  const isHealthy = health?.status === 'healthy';

  return (
    <header className="el-header">
      <div className="el-header-left">
        <div className="el-brand" onClick={onNewSession} title="Start new session">
          <div className="el-brand-logo">
            <Radio size={18} />
          </div>
          <span className="el-brand-name">
            Kuber <span className="el-brand-sub">Voice Agent</span>
          </span>
        </div>

        <div className="el-status-pill" onClick={onOpenSettings} role="button" tabIndex={0}>
          <span className={`el-status-dot ${isHealthy ? 'connected' : loadingHealth ? 'checking' : 'disconnected'}`} />
          <span className="el-status-text">
            {isHealthy ? 'Agent Online' : loadingHealth ? 'Connecting...' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="el-header-right">
        {/* Brief Quick Access Pill */}
        <button
          type="button"
          className={`el-pill-btn ${hasBrief ? 'has-brief' : ''}`}
          onClick={onOpenBrief}
          title="View structured problem brief"
        >
          <FileText size={14} />
          <span>Problem Brief</span>
          {readinessScore > 0 && (
            <span className="el-readiness-chip">
              {Math.round(readinessScore * 100)}%
            </span>
          )}
        </button>

        <button
          type="button"
          className="el-icon-btn"
          onClick={onOpenSettings}
          title="Configuration & Diagnostics"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>

        <button
          type="button"
          className="el-btn-primary el-btn-sm"
          onClick={onNewSession}
          title="Reset conversation and start fresh session"
        >
          <Sparkles size={14} />
          <span>New Session</span>
        </button>
      </div>
    </header>
  );
};
