import React, { useState } from 'react';
import {
  X,
  Server,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Code,
  Save,
  Globe,
} from 'lucide-react';
import { HealthResponse } from '../types';
import { apiClient } from '../services/api';

interface BackendSettingsModalProps {
  isOpen: boolean;
  health: HealthResponse | null;
  loadingHealth: boolean;
  healthError: string | null;
  onClose: () => void;
  onRefreshHealth: () => void;
}

export const BackendSettingsModal: React.FC<BackendSettingsModalProps> = ({
  isOpen,
  health,
  loadingHealth,
  healthError,
  onClose,
  onRefreshHealth,
}) => {
  const [apiUrl, setApiUrl] = useState(apiClient.getBaseUrl() || 'http://localhost:8000');
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSaveUrl = () => {
    apiClient.setBaseUrl(apiUrl);
    setSaveSuccess(true);
    onRefreshHealth();
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleResetDefault = () => {
    const defaultUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
    setApiUrl(defaultUrl);
    apiClient.setBaseUrl(defaultUrl);
    onRefreshHealth();
  };

  const isHealthy = health?.status === 'healthy';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon">
              <Server size={18} />
            </div>
            <div>
              <h3 className="modal-title">Backend Connection & Diagnostics</h3>
              <p className="modal-subtitle">
                Configure FastAPI backend endpoint and verify service readiness
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Endpoint Configuration */}
          <div className="form-field">
            <label className="field-label">
              <Globe size={14} />
              <span>Backend API URL (<code>VITE_API_URL</code>)</span>
            </label>
            <div className="input-with-button">
              <input
                type="text"
                className="field-input"
                placeholder="http://localhost:8000"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSaveUrl}
              >
                <Save size={14} />
                <span>Save</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleResetDefault}
                title="Reset to default VITE_API_URL"
              >
                Reset
              </button>
            </div>
            <div className="field-hint">
              Default is configured via <code>VITE_API_URL</code> or Vite proxy. Changes are saved to local storage.
            </div>
            {saveSuccess && (
              <div className="save-success-pill">
                <CheckCircle size={13} /> URL updated successfully. Re-checking health...
              </div>
            )}
          </div>

          {/* Real Health Status Card */}
          <div className={`health-detail-card ${isHealthy ? 'healthy' : 'error'}`}>
            <div className="health-card-header">
              <div className="health-card-title">
                {loadingHealth ? (
                  <RefreshCw size={16} className="spin text-warning" />
                ) : isHealthy ? (
                  <CheckCircle size={16} color="#10b981" />
                ) : (
                  <AlertCircle size={16} color="#ef4444" />
                )}
                <span>Health Check: GET /health</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={onRefreshHealth}
                disabled={loadingHealth}
              >
                <RefreshCw size={12} className={loadingHealth ? 'spin' : ''} />
                <span>Ping Endpoint</span>
              </button>
            </div>

            <div className="health-card-content">
              {loadingHealth ? (
                <div className="health-loading">Pinging {apiUrl}/health...</div>
              ) : isHealthy ? (
                <div className="health-stats-grid">
                  <div className="health-stat">
                    <span className="stat-name">Status:</span>
                    <span className="stat-val text-success">Healthy</span>
                  </div>
                  <div className="health-stat">
                    <span className="stat-name">Version:</span>
                    <span className="stat-val">{health?.version}</span>
                  </div>
                  <div className="health-stat">
                    <span className="stat-name">Session Store:</span>
                    <span className="stat-val">{health?.services?.session_store || 'ready'}</span>
                  </div>
                  <div className="health-stat">
                    <span className="stat-name">Agent Engine:</span>
                    <span className="stat-val">{health?.services?.agent_orchestrator || 'ready'}</span>
                  </div>
                </div>
              ) : (
                <div className="health-error-box">
                  <p className="health-error-text">
                    <strong>Cannot connect:</strong> {healthError || 'Failed to ping backend'}
                  </p>
                  <p className="health-troubleshoot">
                    Make sure the FastAPI server is running on port 8000:
                    <br />
                    <code>.\.venv\Scripts\uvicorn.exe app.main:app --reload --host 0.0.0.0 --port 8000</code>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* API Contract Quick Reference */}
          <div className="api-contract-box">
            <div className="api-contract-title">
              <Code size={14} />
              <span>Connected Contract Endpoints</span>
            </div>
            <div className="endpoints-list">
              <div className="endpoint-item">
                <span className="method get">GET</span>
                <code>/health</code>
                <span className="endpoint-desc">Backend availability & services</span>
              </div>
              <div className="endpoint-item">
                <span className="method post">POST</span>
                <code>/sessions</code>
                <span className="endpoint-desc">Initialize durable problem session</span>
              </div>
              <div className="endpoint-item">
                <span className="method post">POST</span>
                <code>/sessions/:id/turn</code>
                <span className="endpoint-desc">Submit conversational utterance</span>
              </div>
              <div className="endpoint-item">
                <span className="method get">GET</span>
                <code>/sessions/:id</code>
                <span className="endpoint-desc">Fetch turns & live problem brief</span>
              </div>
              <div className="endpoint-item">
                <span className="method post">POST</span>
                <code>/sessions/:id/brief</code>
                <span className="endpoint-desc">Synthesize finalized brief artifact</span>
              </div>
              <div className="endpoint-item">
                <span className="method post">POST</span>
                <code>/sessions/:id/transcribe</code>
                <span className="endpoint-desc">Transcribe microphone audio with Sarvam</span>
              </div>
              <div className="endpoint-item">
                <span className="method post">POST</span>
                <code>/sessions/:id/speak</code>
                <span className="endpoint-desc">Synthesize agent playback with Sarvam</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
