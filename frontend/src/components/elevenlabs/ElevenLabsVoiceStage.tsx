import React, { useEffect, useState } from 'react';
import { ElevenLabsVoiceOrb, OrbState } from '../canvas/ElevenLabsVoiceOrb';
import { Volume2, VolumeX, Mic, MicOff, PhoneCall, PhoneOff } from 'lucide-react';

interface ElevenLabsVoiceStageProps {
  orbState: OrbState;
  isVoiceActive: boolean;
  isMuted: boolean;
  isSpeakerMuted: boolean;
  onToggleVoice: () => void;
  onToggleMute: () => void;
  onToggleSpeakerMute: () => void;
  isCompact?: boolean;
}

export const ElevenLabsVoiceStage: React.FC<ElevenLabsVoiceStageProps> = ({
  orbState,
  isVoiceActive,
  isMuted,
  isSpeakerMuted,
  onToggleVoice,
  onToggleMute,
  onToggleSpeakerMute,
  isCompact = false,
}) => {
  const [callDuration, setCallDuration] = useState(0);

  // Call timer simulation when voice mode is active
  useEffect(() => {
    let interval: number;
    if (isVoiceActive) {
      interval = window.setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [isVoiceActive]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    switch (orbState) {
      case 'speaking':
        return 'InterviewerAgent is speaking...';
      case 'listening':
        return 'Listening to your voice...';
      case 'thinking':
        return 'Analyzing problem facts...';
      case 'idle':
      default:
        return isVoiceActive ? 'Voice connected • Listening' : 'Voice Agent Ready • Tap to Speak';
    }
  };

  return (
    <div className={`el-voice-stage ${isCompact ? 'compact' : ''}`}>
      <div className="el-orb-container">
        <ElevenLabsVoiceOrb
          state={orbState}
          size={isCompact ? 100 : 160}
          onClick={onToggleVoice}
        />
      </div>

      <div className="el-stage-info">
        <div className="el-status-row">
          <span className={`el-orb-status-indicator ${orbState}`} />
          <span className="el-orb-status-label">{getStatusText()}</span>
          {isVoiceActive && (
            <span className="el-call-timer">
              <span className="live-call-dot" />
              {formatTimer(callDuration)}
            </span>
          )}
        </div>

        {/* Dynamic Sound Wave Bars */}
        <div className={`el-waveform-bars ${orbState === 'speaking' || orbState === 'listening' ? 'active' : ''}`}>
          <span className="wave-bar b1" />
          <span className="wave-bar b2" />
          <span className="wave-bar b3" />
          <span className="wave-bar b4" />
          <span className="wave-bar b5" />
          <span className="wave-bar b6" />
          <span className="wave-bar b7" />
          <span className="wave-bar b8" />
          <span className="wave-bar b7" />
          <span className="wave-bar b6" />
          <span className="wave-bar b5" />
          <span className="wave-bar b4" />
          <span className="wave-bar b3" />
          <span className="wave-bar b2" />
          <span className="wave-bar b1" />
        </div>
      </div>

      {/* Voice Controls Bar */}
      <div className="el-voice-controls">
        <button
          type="button"
          className={`el-voice-btn-main ${isVoiceActive ? 'active' : ''}`}
          onClick={onToggleVoice}
          title={isVoiceActive ? 'End Voice Conversation' : 'Start Voice Conversation'}
        >
          {isVoiceActive ? <PhoneOff size={18} /> : <PhoneCall size={18} />}
          <span>{isVoiceActive ? 'End Call' : 'Start Voice Call'}</span>
        </button>

        <button
          type="button"
          className={`el-voice-control-btn ${isMuted ? 'muted' : ''}`}
          onClick={onToggleMute}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        <button
          type="button"
          className="el-voice-control-btn"
          onClick={onToggleSpeakerMute}
          title={isSpeakerMuted ? 'Unmute speaker output' : 'Mute speaker output'}
        >
          {isSpeakerMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
    </div>
  );
};
