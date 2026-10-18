import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ElevenLabsHeader } from './components/elevenlabs/ElevenLabsHeader';
import { ElevenLabsVoiceStage } from './components/elevenlabs/ElevenLabsVoiceStage';
import { ElevenLabsChatStream } from './components/elevenlabs/ElevenLabsChatStream';
import { ElevenLabsInputDock } from './components/elevenlabs/ElevenLabsInputDock';
import { BriefDrawer } from './components/elevenlabs/BriefDrawer';
import { BackendSettingsModal } from './components/BackendSettingsModal';
import { OrbState } from './components/canvas/ElevenLabsVoiceOrb';
import {
  apiClient,
  ApiRequestError,
  clearSessionCredentials,
  getStoredSessionId,
} from './services/api';
import {
  HealthResponse,
  SessionTurn,
  ProblemBrief,
  CreateSessionPayload,
} from './types';

export const App: React.FC = () => {
  // Backend Health State
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Session State
  const [sessionId, setSessionId] = useState<string | null>(() => getStoredSessionId());
  const [creatingSession, setCreatingSession] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const isMicMutedRef = useRef(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const isRecordingRef = useRef(false);
  const recordingChunksRef = useRef<Float32Array[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<AudioNode[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);

  // Conversation & Intelligence State
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [extractedFacts, setExtractedFacts] = useState<Record<string, unknown>>({});
  const [readinessScore, setReadinessScore] = useState<number>(0.0);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([
    'Users are encountering payment timeout errors (>12%) on UPI during peak hours (18:00 - 21:00 IST)',
    'Mobile Safari KYC verification fails on camera image capture',
    'Checkout latency spiked from 320ms to 2400ms after latest release',
  ]);
  const [brief, setBrief] = useState<ProblemBrief | null>(null);

  // Voice & Orb Interaction States
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [submittingTurn, setSubmittingTurn] = useState<boolean>(false);
  const [lastTurnInput, setLastTurnInput] = useState<string>('');
  const [lastTurnError, setLastTurnError] = useState<ApiRequestError | null>(null);
  const [autoSpeakTurnId, setAutoSpeakTurnId] = useState<string | null>(null);

  const [generatingBrief, setGeneratingBrief] = useState<boolean>(false);
  const [briefError, setBriefError] = useState<ApiRequestError | null>(null);

  // UI Drawers & Modals
  const [isBriefDrawerOpen, setIsBriefDrawerOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string | undefined>(undefined);

  const stopRecordingResources = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    audioNodesRef.current.forEach((node) => node.disconnect());
    audioNodesRef.current = [];
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  };

  const handleToggleMute = () => {
    isMicMutedRef.current = !isMicMutedRef.current;
    setIsMicMuted(isMicMutedRef.current);
  };

  const createWavBlob = (frames: Float32Array[], inputRate: number): Blob => {
    const totalLength = frames.reduce((total, frame) => total + frame.length, 0);
    const input = new Float32Array(totalLength);
    let offset = 0;
    frames.forEach((frame) => {
      input.set(frame, offset);
      offset += frame.length;
    });
    const ratio = inputRate / 16000;
    const outputLength = Math.floor(input.length / ratio);
    const buffer = new ArrayBuffer(44 + outputLength * 2);
    const view = new DataView(buffer);
    const writeText = (position: number, text: string) => {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(position + index, text.charCodeAt(index));
      }
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + outputLength * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, outputLength * 2, true);
    for (let index = 0; index < outputLength; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const handleRecordedAudio = async (audio: Blob) => {
    try {
      setSubmittingTurn(true);
      let activeId = sessionId;
      if (!activeId) {
        const created = await apiClient.createSession({
          user_name: 'Problem Giver',
          initial_goal: 'Problem Discovery Intake',
          metadata: { channel: 'voice', client_device: 'web_browser', locale: 'en-IN' },
        });
        activeId = created.session_id;
        setSessionId(activeId);
      }
      const result = await apiClient.transcribeAudio(activeId, audio);
      const transcript = result.transcript.trim();
      if (!transcript) throw new Error('Sarvam returned an empty transcript.');
      await handleSendMessage(transcript, true);
      setVoiceError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not transcribe microphone audio.';
      setVoiceError(message);
      if (err instanceof ApiRequestError) {
        setLastTurnError(err);
        if (err.statusCode === 401) setSessionId(null);
      }
    } finally {
      setSubmittingTurn(false);
      recordingChunksRef.current = [];
    }
  };

  const stopVoiceRecording = () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsVoiceActive(false);
    const sampleRate = audioContextRef.current?.sampleRate ?? 16000;
    stopRecordingResources();
    if (recordingChunksRef.current.length > 0) {
      void handleRecordedAudio(createWavBlob(recordingChunksRef.current, sampleRate));
    } else {
      setVoiceError('No microphone audio was captured. Try again.');
    }
  };

  // Derive Orb State for ElevenLabs Visualizer
  const getOrbState = (): OrbState => {
    if (submittingTurn) return 'thinking';
    if (isVoiceActive) return 'listening';
    if (turns.length > 0 && turns[turns.length - 1].role === 'agent') return 'speaking';
    return 'idle';
  };

  // Check backend health
  const checkHealth = useCallback(async () => {
    setLoadingHealth(true);
    setHealthError(null);
    try {
      const data = await apiClient.getHealth();
      setHealth(data);
      setHealthError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cannot reach backend server';
      setHealthError(msg);
      setHealth(null);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  // Fetch complete session details
  const fetchSession = useCallback(async (id: string) => {
    try {
      const details = await apiClient.getSession(id);
      setTurns(details.turns || []);
      setExtractedFacts(details.extracted_facts || {});
      setReadinessScore(details.brief_readiness_score || 0.0);
      if (details.brief) {
        setBrief(details.brief);
      }
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.statusCode === 401) {
        clearSessionCredentials();
        setSessionId(null);
        setTurns([]);
        setLastTurnError(err);
      } else {
        console.warn('Failed to load session details:', err);
      }
    }
  }, []);

  // Initialize a new session
  const handleCreateSession = async (payload: CreateSessionPayload = {}) => {
    setCreatingSession(true);
    setLastTurnError(null);
    setBriefError(null);
    setVoiceError(null);
    try {
      const newSession = await apiClient.createSession({
        user_name: 'Problem Giver',
        initial_goal: 'Problem Discovery Intake',
        metadata: {
          channel: 'voice_kuber',
          client_device: 'web_browser',
          locale: 'en-US',
        },
        ...payload,
      });
      setSessionId(newSession.session_id);
      setTurns([]);
      setExtractedFacts({});
      setReadinessScore(0.0);
      setBrief(null);
      setVoiceError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not create a session.';
      setLastTurnError(
        err instanceof ApiRequestError
          ? err
          : new ApiRequestError(message, 'SESSION_CREATE_FAILED', 500)
      );
    } finally {
      setCreatingSession(false);
    }
  };

  // Send Conversational Turn
  const handleSendMessage = async (userInput: string, speakResponse = false) => {
    let activeId = sessionId;
    if (!activeId) {
      try {
        const newSession = await apiClient.createSession({
          user_name: 'Problem Giver',
          initial_goal: userInput,
        });
        activeId = newSession.session_id;
        setSessionId(activeId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not create a session.';
        setLastTurnError(
          err instanceof ApiRequestError
            ? err
            : new ApiRequestError(message, 'SESSION_CREATE_FAILED', 500)
        );
        return;
      }
    }

    setSubmittingTurn(true);
    setLastTurnInput(userInput);
    setLastTurnError(null);
    setAutoSpeakTurnId(null);

    // Optimistically show user turn in feed
    const userTurn: SessionTurn = {
      turn_id: `user_${Date.now()}`,
      role: 'user',
      message: userInput,
      timestamp: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);

    try {
      if (activeId) {
        const response = await apiClient.submitTurn(activeId, {
          user_input: userInput,
          speaker_tag: 'user',
          client_timestamp: new Date().toISOString(),
        });

        // Add agent response
        const agentTurn: SessionTurn = {
          turn_id: response.turn_id,
          role: 'agent',
          agent_name: response.agent_role || 'InterviewerAgent',
          message: response.agent_message,
          timestamp: response.timestamp,
        };
        setTurns((prev) => [...prev, agentTurn]);
        if (speakResponse) setAutoSpeakTurnId(response.turn_id);

        if (response.extracted_facts) {
          setExtractedFacts((prev) => ({ ...prev, ...response.extracted_facts }));
        }
        if (typeof response.brief_readiness_score === 'number') {
          setReadinessScore(response.brief_readiness_score);
        }
        if (response.suggested_next_steps && response.suggested_next_steps.length > 0) {
          setSuggestedPrompts(response.suggested_next_steps);
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiRequestError) {
        setLastTurnError(err);
      } else {
        const msg = err instanceof Error ? err.message : 'Turn request failed';
        setLastTurnError(new ApiRequestError(msg, 'UNKNOWN_ERROR', 500));
      }
    } finally {
      setSubmittingTurn(false);
    }
  };

  // Retry last turn
  const handleRetryLastTurn = () => {
    if (lastTurnInput) {
      setTurns((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'user') {
          return prev.slice(0, -1);
        }
        return prev;
      });
      handleSendMessage(lastTurnInput);
    }
  };

  // Synthesize brief
  const handleSynthesizeBrief = async (forceSynthesis = false, notes?: string) => {
    if (!sessionId) return;
    setGeneratingBrief(true);
    setBriefError(null);

    try {
      const response = await apiClient.generateBrief(sessionId, {
        force_synthesis: forceSynthesis,
        additional_notes: notes,
      });
      setBrief(response.brief);
      setReadinessScore(response.readiness_score || 1.0);
      setBriefError(null);
    } catch (err: unknown) {
      if (err instanceof ApiRequestError) {
        setBriefError(err);
      } else {
        const msg = err instanceof Error ? err.message : 'Brief synthesis failed';
        setBriefError(new ApiRequestError(msg, 'BRIEF_SYNTHESIS_FAILED', 500));
      }
    } finally {
      setGeneratingBrief(false);
    }
  };

  // Record microphone input locally, convert it to WAV, then submit it to Sarvam STT.
  const handleToggleVoice = async () => {
    if (isRecordingRef.current) {
      stopVoiceRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      setVoiceError('Microphone recording is not supported by this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      recordingChunksRef.current = [];
      processor.onaudioprocess = (event) => {
        if (isRecordingRef.current && !isMicMutedRef.current) {
          recordingChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        }
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(context.destination);
      mediaStreamRef.current = stream;
      audioContextRef.current = context;
      audioNodesRef.current = [source, processor, silentOutput];
      isRecordingRef.current = true;
      setVoiceError(null);
      setIsVoiceActive(true);
      recordingTimeoutRef.current = window.setTimeout(stopVoiceRecording, 30_000);
    } catch (err: unknown) {
      stopRecordingResources();
      const message = err instanceof Error ? err.message : 'Microphone access was denied.';
      setVoiceError(`Could not start microphone recording: ${message}`);
    }
  };

  // Initial load
  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  useEffect(() => () => stopRecordingResources(), []);

  // Auto-init session if healthy
  useEffect(() => {
    if (health?.services.session_store === 'ready' && !sessionId && !creatingSession) {
      handleCreateSession();
    }
  }, [health, sessionId, creatingSession]);

  useEffect(() => {
    if (sessionId) {
      fetchSession(sessionId);
    }
  }, [sessionId, fetchSession]);

  return (
    <div className="el-app-viewport">
      {/* ElevenLabs Minimalist Navbar */}
      <ElevenLabsHeader
        health={health}
        loadingHealth={loadingHealth}
        readinessScore={readinessScore}
        hasBrief={Boolean(brief)}
        onOpenBrief={() => setIsBriefDrawerOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onNewSession={() => handleCreateSession()}
      />

      {/* Main Unified Screen: Living Voice Stage + Chat Stream */}
      <main className="el-main-window">
        <div className="el-content-scroll">
          {/* ElevenLabs Living Voice Orb Hero Stage */}
          <ElevenLabsVoiceStage
            orbState={getOrbState()}
            isVoiceActive={isVoiceActive}
            onToggleVoice={handleToggleVoice}
            isMuted={isMicMuted}
            onToggleMute={handleToggleMute}
            isSpeakerMuted={isSpeakerMuted}
            onToggleSpeakerMute={() => setIsSpeakerMuted((muted) => !muted)}
            isCompact={turns.length > 1}
          />

          {/* Unified Conversation & Questions Stream */}
          <ElevenLabsChatStream
            turns={turns}
            submittingTurn={submittingTurn}
            lastTurnError={lastTurnError}
            brief={brief}
            suggestedPrompts={suggestedPrompts}
            onSelectPrompt={(p) => setSelectedPrompt(p)}
            onRetryTurn={handleRetryLastTurn}
            onOpenBrief={() => setIsBriefDrawerOpen(true)}
            sessionId={sessionId}
            onAudioError={(message, error) => {
              setVoiceError(message);
              if (error?.statusCode === 401) {
                clearSessionCredentials();
                setSessionId(null);
              }
            }}
            isSpeakerMuted={isSpeakerMuted}
            autoSpeakTurnId={autoSpeakTurnId}
          />
        </div>

        {/* Floating Capsule Input Dock */}
        <ElevenLabsInputDock
          onSendMessage={handleSendMessage}
          submitting={submittingTurn}
          isVoiceActive={isVoiceActive}
          onToggleVoice={handleToggleVoice}
          selectedPrompt={selectedPrompt}
          onClearSelectedPrompt={() => setSelectedPrompt(undefined)}
        />
        {voiceError && <div className="el-error-card" role="alert">{voiceError}</div>}
      </main>

      {/* Slide-in Brief Drawer */}
      <BriefDrawer
        isOpen={isBriefDrawerOpen}
        onClose={() => setIsBriefDrawerOpen(false)}
        brief={brief}
        readinessScore={readinessScore}
        extractedFacts={extractedFacts}
        turns={turns}
        generatingBrief={generatingBrief}
        briefError={briefError}
        onSynthesize={handleSynthesizeBrief}
      />

      {/* Settings Modal */}
      <BackendSettingsModal
        isOpen={isSettingsModalOpen}
        health={health}
        loadingHealth={loadingHealth}
        healthError={healthError}
        onClose={() => setIsSettingsModalOpen(false)}
        onRefreshHealth={checkHealth}
      />
    </div>
  );
};

export default App;
