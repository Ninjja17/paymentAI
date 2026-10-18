import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff } from 'lucide-react';

interface ElevenLabsInputDockProps {
  onSendMessage: (text: string) => Promise<void>;
  submitting: boolean;
  isVoiceActive: boolean;
  onToggleVoice: () => void;
  selectedPrompt?: string;
  onClearSelectedPrompt?: () => void;
}

export const ElevenLabsInputDock: React.FC<ElevenLabsInputDockProps> = ({
  onSendMessage,
  submitting,
  isVoiceActive,
  onToggleVoice,
  selectedPrompt,
  onClearSelectedPrompt,
}) => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedPrompt) {
      setText(selectedPrompt);
      inputRef.current?.focus();
      onClearSelectedPrompt?.();
    }
  }, [selectedPrompt, onClearSelectedPrompt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || submitting) return;

    setText('');
    await onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="el-input-dock-container">
      <form onSubmit={handleSubmit} className="el-input-capsule">
        {/* Mic Toggle Button */}
        <button
          type="button"
          className={`el-capsule-mic ${isVoiceActive ? 'voice-on' : ''}`}
          onClick={onToggleVoice}
          title={isVoiceActive ? 'Voice mode active (click to stop)' : 'Click to speak with voice'}
        >
          {isVoiceActive ? <MicOff size={18} /> : <Mic size={18} />}
          {isVoiceActive && <span className="mic-pulse-ring" />}
        </button>

        {/* Text Input */}
        <input
          ref={inputRef}
          type="text"
          className="el-capsule-input"
          placeholder={
            isVoiceActive
              ? 'Voice session connected • or type message here...'
              : 'Ask a question, describe your problem, or speak...'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />

        {/* Action Controls */}
        <div className="el-capsule-actions">
          {text.trim().length > 0 && (
            <button
              type="button"
              className="el-clear-text-btn"
              onClick={() => setText('')}
              title="Clear text"
            >
              Clear
            </button>
          )}

          <button
            type="submit"
            className="el-capsule-send"
            disabled={!text.trim() || submitting}
            title="Send message"
          >
            <Send size={16} />
          </button>
        </div>
      </form>

      <div className="el-dock-caption">
        Kuber Voice AI Agent • <strong>Enter</strong> to send • Speak or type anytime
      </div>
    </div>
  );
};
