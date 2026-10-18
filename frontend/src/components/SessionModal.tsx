import React, { useState } from 'react';
import { X, Sparkles, User, Target, Radio, ArrowRight, RefreshCw } from 'lucide-react';
import { CreateSessionPayload } from '../types';

interface SessionModalProps {
  isOpen: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateSessionPayload) => Promise<void>;
}

export const SessionModal: React.FC<SessionModalProps> = ({
  isOpen,
  creating,
  onClose,
  onSubmit,
}) => {
  const [userName, setUserName] = useState('');
  const [initialGoal, setInitialGoal] = useState('');
  const [channel, setChannel] = useState<'voice' | 'web_browser'>('voice');
  const [locale, setLocale] = useState('en-IN');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      user_name: userName.trim() || undefined,
      initial_goal: initialGoal.trim() || undefined,
      metadata: {
        channel,
        client_device: 'web_browser',
        locale,
      },
    });
  };

  const handleApplyPreset = (name: string, goal: string) => {
    setUserName(name);
    setInitialGoal(goal);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="modal-title">Initialize Intake Session</h3>
              <p className="modal-subtitle">
                Set up an isolated multi-agent diagnostic session (POST /sessions)
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={creating}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {/* Quick Presets */}
          <div className="presets-group">
            <span className="presets-label">Quick Scenario Presets:</span>
            <div className="presets-buttons">
              <button
                type="button"
                className="preset-pill"
                onClick={() =>
                  handleApplyPreset(
                    'Alex',
                    'Investigate UPI payment gateway latency spike and 12% timeout errors during peak hours'
                  )
                }
              >
                UPI Latency Spike
              </button>
              <button
                type="button"
                className="preset-pill"
                onClick={() =>
                  handleApplyPreset(
                    'Priya',
                    'Mobile Safari KYC verification drop-offs due to image upload failures'
                  )
                }
              >
                KYC Upload Failures
              </button>
              <button
                type="button"
                className="preset-pill"
                onClick={() =>
                  handleApplyPreset(
                    'Rohan',
                    'Aggregator webhook delivery timeouts resulting in pending order state'
                  )
                }
              >
                Webhook Timeouts
              </button>
            </div>
          </div>

          <div className="form-field">
            <label className="field-label">
              <User size={14} />
              <span>Problem Giver / Stakeholder Name</span>
            </label>
            <input
              type="text"
              className="field-input"
              placeholder="e.g. Alex"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              disabled={creating}
              maxLength={200}
            />
          </div>

          <div className="form-field">
            <label className="field-label">
              <Target size={14} />
              <span>Initial Problem Statement or Objective (Optional)</span>
            </label>
            <textarea
              className="field-textarea"
              placeholder="e.g. Investigate transaction drop-offs on checkout page during evening peak hours..."
              value={initialGoal}
              onChange={(e) => setInitialGoal(e.target.value)}
              disabled={creating}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="form-row-2">
            <div className="form-field">
              <label className="field-label">
                <Radio size={14} />
                <span>Channel Mode</span>
              </label>
              <select
                className="field-select"
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'voice' | 'web_browser')}
                disabled={creating}
              >
                <option value="voice">Voice AI Channel (WebRTC/Audio)</option>
                <option value="web_browser">Standard Web Chat</option>
              </select>
            </div>

            <div className="form-field">
              <label className="field-label">
                <span>Locale</span>
              </label>
              <select
                className="field-select"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                disabled={creating}
              >
                <option value="en-IN">en-IN (English - India)</option>
                <option value="en-US">en-US (English - US)</option>
                <option value="en-GB">en-GB (English - UK)</option>
              </select>
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  <span>Creating Session...</span>
                </>
              ) : (
                <>
                  <span>Start Intake Session</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
