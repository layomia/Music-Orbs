/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, Settings, Info, 
  ChevronRight, Check, X, Sparkles, Sliders,
  Volume2, VolumeX, Waves, Wind, Accessibility, Mic,
  Square, Loader2, Repeat, HelpCircle, Type, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Track, Proposal, HistoryItem, AdaptiveState, ReverbType } from './types';
import { generateProposals } from './proposalGenerator';
import { audioEngine } from './audioEngine';

const INITIAL_TRACKS: Track[] = [
  { id: 'drums', label: 'Drums', volume: 70, delay: 0.2, reverb: 'room', selected: true, muted: false },
  { id: 'piano', label: 'Piano', volume: 60, delay: 0.5, reverb: 'hall', selected: false, muted: false },
  { id: 'guitar', label: 'Guitar', volume: 65, delay: 0.3, reverb: 'room', selected: false, muted: false },
  { id: 'vocals', label: 'Vocals', volume: 80, delay: 0.1, reverb: 'dry', selected: false, muted: false },
];

export default function App() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<'direct' | 'ai'>('ai');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [previewProposalId, setPreviewProposalId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [isLargeText, setIsLargeText] = useState(false);
  const [showAccessibilityMenu, setShowAccessibilityMenu] = useState(false);
  const [showIntro, setShowIntro] = useState(() => {
    return localStorage.getItem('music-orbs-intro-seen') !== 'true';
  });
  const [adaptationMessage, setAdaptationMessage] = useState<string | null>(null);
  const [isMessageFaded, setIsMessageFaded] = useState(false);
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState>({
    rejectionCount: 0,
    acceptCount: 0,
    reverbBias: 0,
    intensityBias: 1.0,
    lastAction: null,
    feedbackMessage: null,
    feedbackTimestamp: null
  });
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audioEngine.getDuration());
  const [currentStep, setCurrentStep] = useState(0);
  const editStartState = useRef<Partial<Track> | null>(null);
  const accessibilityRef = useRef<HTMLDivElement>(null);

  const selectedTrack = tracks.find(t => t.selected);

  // Initialize audio engine
  useEffect(() => {
    tracks.forEach(t => audioEngine.setupTrack(t.id));
  }, []);

  // Update audio engine when tracks change
  useEffect(() => {
    audioEngine.setLooping(isLooping);
  }, [isLooping]);

  // Update audio engine when tracks change
  useEffect(() => {
    tracks.forEach(t => {
      // If we are previewing a proposal, apply its changes temporarily
      let vol = t.volume;
      let del = t.delay;
      let rev = t.reverb;

      if (previewProposalId) {
        // Solo the selected track during preview
        if (t.selected) {
          const p = proposals.find(prop => prop.id === previewProposalId);
          if (p && p.changes) {
            vol = Math.min(100, Math.max(0, t.volume + (Number(p.changes.volumeDelta) || 0)));
            del = Math.min(3, Math.max(0, t.delay + (Number(p.changes.delayDelta) || 0)));
            rev = p.changes.reverbTarget || t.reverb;
          }
        } else {
          // Mute all other tracks during preview
          vol = 0;
        }
      }

      // If muted, set volume to 0
      const finalVol = t.muted ? 0 : vol;

      audioEngine.updateTrack(t.id, finalVol, del, rev);
    });
  }, [tracks, previewProposalId, proposals]);

  // Handle adaptation message fading
  useEffect(() => {
    if (adaptationMessage) {
      setIsMessageFaded(false);
    }
  }, [adaptationMessage]);

  // Update playback time
  useEffect(() => {
    let frameId: number;
    let lastPlaying = false;
    const stepDuration = (60 / 110) / 4; // 1/16th notes
    
    const update = () => {
      const time = audioEngine.getCurrentTime();
      setCurrentTime(time);
      
      // Calculate current step for visual pulsing
      const loopDuration = 16 * stepDuration;
      const timeInLoop = time % loopDuration;
      setCurrentStep(Math.floor(timeInLoop / stepDuration));

      const playing = audioEngine.isPlayingStatus();
      if (playing !== lastPlaying) {
        setIsPlaying(playing);
        lastPlaying = playing;
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Handle click outside accessibility menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accessibilityRef.current && !accessibilityRef.current.contains(event.target as Node)) {
        setShowAccessibilityMenu(false);
      }
    };

    if (showAccessibilityMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAccessibilityMenu]);

  const togglePreview = (id: string) => {
    const isStarting = previewProposalId !== id;
    setPreviewProposalId(isStarting ? id : null);
    
    // If starting a preview, ensure music is playing so user can hear it
    if (isStarting && !isPlaying) {
      audioEngine.play();
      setIsPlaying(true);
    }
  };

  const handleTrackSelect = (id: string | null) => {
    setTracks(prev => prev.map(t => ({ ...t, selected: t.id === id })));
    setPreviewProposalId(null);
    setProposals([]);
  };

  const updateTrackParam = (id: string, params: Partial<Track>) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...params } : t));
  };

  const commitTrackChange = (id: string, previousState: Partial<Track>, newState: Partial<Track>, type: 'direct' | 'conductor', proposalTitle?: string) => {
    // Determine what changed for the description
    let description = "";
    if (type === 'conductor' && proposalTitle) {
      description = `AI: ${proposalTitle}`;
    } else {
      const changes: string[] = [];
      if (newState.volume !== undefined && newState.volume !== previousState.volume) {
        changes.push(`Volume ${previousState.volume}% → ${newState.volume}%`);
      }
      if (newState.delay !== undefined && newState.delay !== previousState.delay) {
        changes.push(`Delay ${previousState.delay}s → ${newState.delay}s`);
      }
      if (newState.reverb !== undefined && newState.reverb !== previousState.reverb) {
        changes.push(`Reverb ${previousState.reverb} → ${newState.reverb}`);
      }
      description = `Manual: ${changes.join(', ')}`;
    }

    if (!description || (type === 'direct' && description === 'Manual: ')) return;

    const historyItem: HistoryItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      trackId: id,
      description,
      proposalTitle,
      previousState,
      newState,
      type
    };
    setHistory(prev => [historyItem, ...prev].slice(0, 20));

    if (type === 'direct') {
      setAdaptationMessage("Manual adjustment noted. Refining my interpretation model.");
      setAdaptiveState(prev => ({
        ...prev,
        lastAction: 'generate', // Treat direct as a form of generation/input
        feedbackMessage: "Manual adjustment noted. Refining my interpretation model.",
        feedbackTimestamp: Date.now()
      }));
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const lastItem = history[0];
    setTracks(prev => prev.map(t => t.id === lastItem.trackId ? { ...t, ...lastItem.previousState } : t));
    setHistory(prev => prev.slice(1));
    setAdaptationMessage("Reverting change. Restoring previous mix state.");
    setAdaptiveState(prev => ({
      ...prev,
      lastAction: 'generate', // Treat undo as a form of input
      feedbackMessage: "Reverting change. Restoring previous mix state.",
      feedbackTimestamp: Date.now()
    }));
  };

  const dismissIntro = () => {
    setShowIntro(false);
    localStorage.setItem('music-orbs-intro-seen', 'true');
  };

  const handleGenerateProposals = async (textOverride?: string) => {
    const textToUse = textOverride !== undefined ? textOverride : inputText;
    if (!textToUse.trim()) return;
    setIsGenerating(true);
    setPreviewProposalId(null);
    
    let message = "Exploring new creative interpretations.";
    if (adaptiveState.lastAction === 'reject') {
      message = "Exploring alternative interpretations based on your feedback.";
    } else if (selectedTrack && adaptiveState.rejectionCount[selectedTrack.id] >= 1) {
      message = "Adjusting parameters to find a better fit.";
    }

    setAdaptationMessage(message);
    setAdaptiveState(prev => ({
      ...prev,
      lastAction: 'generate',
      feedbackMessage: message,
      feedbackTimestamp: Date.now()
    }));
    
    try {
      const resultsPromise = generateProposals(textToUse, selectedTrack || tracks[0], adaptiveState, process.env.GEMINI_API_KEY);
      
      // Add a 15-second timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Generation timed out")), 15000)
      );

      const results = await Promise.race([resultsPromise, timeoutPromise]);
      
      if (!results || !Array.isArray(results)) {
        throw new Error("Invalid proposals received");
      }

      setProposals(results);
    } catch (error) {
      console.error("Failed to generate proposals:", error);
      setProposals([]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleMute = (trackId: string) => {
    setTracks(prev => prev.map(t => 
      t.id === trackId ? { ...t, muted: !t.muted } : t
    ));
  };

  const handleAcceptProposal = (proposal: Proposal) => {
    if (!selectedTrack) return;
    const previousState = { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb };
    const newParams = {
      volume: Math.min(100, Math.max(0, selectedTrack.volume + (Number(proposal.changes.volumeDelta) || 0))),
      delay: Math.min(3, Math.max(0, selectedTrack.delay + (Number(proposal.changes.delayDelta) || 0))),
      reverb: proposal.changes.reverbTarget || selectedTrack.reverb
    };

    setTracks(prev => prev.map(t => t.id === selectedTrack.id ? { ...t, ...newParams } : t));
    commitTrackChange(selectedTrack.id, previousState, newParams, 'conductor', proposal.title);
    
    setProposals([]);
    setPreviewProposalId(null);
    setInputText('');
    
    const currentAccepts = adaptiveState.acceptCount + 1;
    let message = "Noted. Leaning toward similar changes.";
    
    if (proposal.changes.reverbTarget !== 'dry') {
      message = "Learning your preference for spacious interpretations.";
    } else if (currentAccepts >= 2) {
      message = "Reinforcing this direction in future interpretations.";
    }

    setAdaptationMessage(message);
    setAdaptiveState(prev => {
      const newState = {
        ...prev,
        rejectionCount: 0,
        acceptCount: currentAccepts,
        intensityBias: Math.min(2.0, prev.intensityBias + 0.2),
        lastAction: 'accept' as const,
        feedbackMessage: message,
        feedbackTimestamp: Date.now()
      };
      
      if (proposal.changes.reverbTarget !== 'dry') {
        newState.reverbBias = prev.reverbBias + 2;
      }
      
      return newState;
    });
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setSpeechError("Speech recognition not supported");
      setTimeout(() => setSpeechError(null), 3000);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setSpeechError(null);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText(transcript);
      handleGenerateProposals(transcript);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        setSpeechError(`Error: ${event.error}`);
        setTimeout(() => setSpeechError(null), 3000);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleRejectProposal = (id: string) => {
    setProposals(prev => prev.filter(p => p.id !== id));
    setPreviewProposalId(null);
    
    if (selectedTrack) {
      const currentRejections = adaptiveState.rejectionCount + 1;
      let message = "Okay. Exploring different interpretations.";
      
      if (currentRejections >= 2) {
        message = "Reducing intensity of future suggestions.";
      }

      setAdaptationMessage(message);
      setAdaptiveState(prev => ({
        ...prev,
        rejectionCount: currentRejections,
        acceptCount: 0,
        intensityBias: Math.max(0.1, prev.intensityBias - 0.4),
        lastAction: 'reject' as const,
        feedbackMessage: message,
        feedbackTimestamp: Date.now()
      }));
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      audioEngine.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    audioEngine.seek(time);
    setCurrentTime(time);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`h-screen flex flex-col overflow-hidden transition-colors duration-500 ${isHighContrast ? 'bg-black text-white' : 'bg-warm-white text-ink'}`}>
      {/* Top Bar */}
      <header className="h-20 border-b border-black/5 flex items-center justify-between px-8 bg-white/40 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-serif italic tracking-tight flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-cobalt" />
            Music Orbs
          </h1>
          
          <div className="h-6 w-[1px] bg-black/10 mx-2" />
          
          <AnimatePresence>
            {mode === 'ai' && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full bg-cobalt animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cobalt">AI Active</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-black/5 rounded-full p-1 gap-1">
            <button 
              onClick={togglePlay}
              className="p-2.5 rounded-full hover:bg-black/5 transition-all active:scale-95 text-ink"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <button 
              onClick={handleStop}
              className="p-2.5 rounded-full hover:bg-black/5 transition-all active:scale-95 text-ink"
              aria-label="Stop"
            >
              <Square size={18} fill="currentColor" />
            </button>
            <button 
              onClick={() => setIsLooping(!isLooping)}
              className={`p-2.5 rounded-full transition-all active:scale-95 ${isLooping ? 'text-cobalt bg-cobalt/10' : 'text-ink/60 hover:text-ink/80'}`}
              aria-label="Toggle Loop"
              title="Toggle Loop"
            >
              <Repeat size={18} />
            </button>
          </div>
          
          <button 
            onClick={() => setShowIntro(true)}
            className="p-3 rounded-full bg-black/5 hover:bg-black/10 transition-all active:scale-95"
            aria-label="Show Instructions"
            title="Show Instructions"
          >
            <HelpCircle size={22} />
          </button>

          <button 
            onClick={handleUndo}
            disabled={history.length === 0}
            className="p-3 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20 transition-all active:scale-95"
            aria-label="Undo"
          >
            <RotateCcw size={22} />
          </button>

          <div className="relative" ref={accessibilityRef}>
            <button 
              onClick={() => setShowAccessibilityMenu(!showAccessibilityMenu)}
              className={`p-3 rounded-full transition-all ${showAccessibilityMenu || isReducedMotion || isHighContrast || isLargeText ? 'bg-cobalt text-white' : 'bg-black/5 hover:bg-black/10 text-ink/60'}`}
              aria-label="Accessibility Settings"
              title="Accessibility Settings"
            >
              <Accessibility size={22} />
            </button>

            <AnimatePresence>
              {showAccessibilityMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-black/5 p-2 z-50 overflow-hidden"
                >
                    <div className="px-4 py-3 border-b border-black/5 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">Accessibility</span>
                    </div>
                    
                    <button 
                      onClick={() => setIsReducedMotion(!isReducedMotion)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isReducedMotion ? 'bg-cobalt/10 text-cobalt' : 'hover:bg-black/5 text-ink/80'}`}
                    >
                      <Wind size={18} className={isReducedMotion ? 'text-cobalt' : 'text-ink/50'} />
                      <span className="text-xs font-bold flex-1 text-left">Reduced Motion</span>
                      {isReducedMotion && <Check size={14} />}
                    </button>

                    <button 
                      onClick={() => setIsHighContrast(!isHighContrast)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isHighContrast ? 'bg-cobalt/10 text-cobalt' : 'hover:bg-black/5 text-ink/80'}`}
                    >
                      <Eye size={18} className={isHighContrast ? 'text-cobalt' : 'text-ink/50'} />
                      <span className="text-xs font-bold flex-1 text-left">High Contrast</span>
                      {isHighContrast && <Check size={14} />}
                    </button>

                    <button 
                      onClick={() => setIsLargeText(!isLargeText)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isLargeText ? 'bg-cobalt/10 text-cobalt' : 'hover:bg-black/5 text-ink/80'}`}
                    >
                      <Type size={18} className={isLargeText ? 'text-cobalt' : 'text-ink/50'} />
                      <span className="text-xs font-bold flex-1 text-left">Large Text</span>
                      {isLargeText && <Check size={14} />}
                    </button>
                  </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Proposals & History */}
          <aside className="w-[380px] border-r border-black/5 bg-powder/30 flex flex-col overflow-hidden shrink-0">
            <div className={`flex-1 overflow-y-auto ${isLargeText ? 'p-8 space-y-12' : 'p-6 space-y-8'} custom-scrollbar`}>
              {/* Current Mix Summary (Statically Visible) */}
              <div className="space-y-6">
                <h2 className={`${isLargeText ? 'text-xs mb-8' : 'text-[10px] mb-6'} font-bold uppercase tracking-[0.3em] text-ink/50`}>Current Mix</h2>
                <div className="grid grid-cols-1 gap-3">
                  {tracks.map(track => (
                    <div 
                      key={track.id}
                      onClick={() => handleTrackSelect(track.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${selectedTrack?.id === track.id ? 'bg-white border-cobalt/20 shadow-lg' : 'bg-white/40 border-black/5 hover:bg-white/60'}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            track.id === 'drums' ? 'bg-blue-400' : 
                            track.id === 'piano' ? 'bg-amber-400' : 
                            track.id === 'guitar' ? 'bg-emerald-400' : 'bg-pink-400'
                          }`} />
                          <span className="text-xs font-bold uppercase tracking-widest">{track.label}</span>
                        </div>
                        {track.muted && <VolumeX size={12} className="text-red-500" />}
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-mono text-ink/40">
                        <div className="flex items-center gap-1">
                          <span className="uppercase tracking-tighter">Vol:</span>
                          <span className="text-ink/80">{track.volume}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="uppercase tracking-tighter">Echo:</span>
                          <span className="text-ink/80">{track.delay.toFixed(1)}s</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="uppercase tracking-tighter">Env:</span>
                          <span className="text-ink/80 capitalize">{track.reverb}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* History Section */}
              <div>
                <h2 className={`${isLargeText ? 'text-xs mb-8' : 'text-[10px] mb-6'} font-bold uppercase tracking-[0.3em] text-ink/50`}>History</h2>
                <div className={`${isLargeText ? 'space-y-6' : 'space-y-4'}`}>
                  {history.length > 0 ? (
                    history.map((item) => (
                      <div key={item.id} className={`${isLargeText ? 'p-6 gap-3' : 'p-4 gap-2'} rounded-2xl bg-white/40 border border-black/5 flex flex-col shadow-sm`}>
                        <div className="flex justify-between items-center">
                          <span className={`font-bold text-ink ${isLargeText ? 'text-sm' : 'text-xs'}`}>{tracks.find(t => t.id === item.trackId)?.label}</span>
                          <span className="text-[9px] text-ink/50 font-bold uppercase tracking-widest">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className={`${isLargeText ? 'text-sm' : 'text-ink/50'} font-serif italic`}>
                          {item.description}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className={`${isLargeText ? 'text-sm' : 'text-xs'} text-ink/50 italic font-serif`}>No changes yet.</p>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* Center Area: Orbs */}
          <div 
            className="flex-1 relative flex items-center justify-center p-12 overflow-hidden z-30 bg-warm-white/80 backdrop-blur-md"
            onClick={() => handleTrackSelect(null)}
          >
            {/* AI Adaptation Panel - Fixed at top */}
            <div className="absolute top-12 left-0 right-0 flex justify-center pointer-events-none z-40">
              <AnimatePresence>
                {mode === 'ai' && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="w-full max-w-md p-6 rounded-[2rem] bg-white/60 backdrop-blur-sm border border-cobalt/10 shadow-xl shadow-cobalt/5 space-y-4 pointer-events-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-2xl bg-cobalt/10 text-cobalt">
                          <Sparkles size={18} />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cobalt/80">AI Adaptation</span>
                      </div>
                      <div className="flex items-center gap-2">
                         <span className="text-[10px] text-ink/40 font-serif italic">System Learning</span>
                         <div className="w-1.5 h-1.5 rounded-full bg-cobalt animate-pulse" />
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <AnimatePresence mode="wait">
                        {adaptationMessage && (
                          <motion.p 
                            key={adaptationMessage}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 5 }}
                            className="text-sm text-cobalt font-serif italic border-l-2 border-cobalt/30 pl-4 py-1 leading-relaxed"
                          >
                            "{adaptationMessage}"
                          </motion.p>
                        )}
                      </AnimatePresence>
                      
                      <div className="flex items-end justify-between gap-8">
                        <div className="flex-1 space-y-2">
                          <div className="flex justify-between items-center text-[10px] text-ink/50 font-serif italic mb-1">
                            <span>Experience Level</span>
                            <span>{Math.round((adaptiveState.acceptCount / 10) * 100)}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-black/5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, (adaptiveState.acceptCount / 10) * 100)}%` }}
                              className="h-full bg-cobalt" 
                            />
                          </div>
                        </div>
                        
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-ink/40 font-serif italic block mb-1">Current Leaning</span>
                          <span className="text-xs font-bold text-cobalt tracking-tight">
                            {(() => {
                              const biases: string[] = [];
                              const reverb = adaptiveState.reverbBias;
                              if (reverb > 2) biases.push("Spacious");
                              else if (reverb < -2) biases.push("Dry");
                              const intensity = adaptiveState.intensityBias;
                              if (intensity > 1.2) biases.push("Intense");
                              else if (intensity < 0.8) biases.push("Subtle");
                              return biases.length > 0 ? biases.join(" • ") : "Balanced";
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className={`relative w-full max-w-6xl aspect-video flex items-center justify-center translate-y-12 ${isLargeText ? 'gap-32' : 'gap-20'}`}>
              {tracks.map((track) => (
                <OrbControl 
                  key={track.id} 
                  track={track} 
                  onSelect={() => handleTrackSelect(track.id)}
                  onToggleMute={() => handleToggleMute(track.id)}
                  isReducedMotion={isReducedMotion}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                  isLargeText={isLargeText}
                  isHighContrast={isHighContrast}
                  isSoloMuted={!!previewProposalId && !track.selected}
                />
              ))}
            </div>
          </div>

          {/* Right Panel: Active Workspace (AI & Direct Controls) */}
          <AnimatePresence>
            {(mode === 'ai' || mode === 'direct') && (
              <motion.aside 
                initial={{ x: 380, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 380, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="w-[380px] border-l border-black/5 bg-powder/30 flex flex-col overflow-hidden shrink-0"
              >
                <div className={`flex-1 overflow-y-auto ${isLargeText ? 'p-8 space-y-12' : 'p-6 space-y-8'} custom-scrollbar`}>
                  
                  {/* Mode Switcher inside Sidebar */}
                  <div className="flex bg-black/5 p-1 rounded-2xl">
                    <button 
                      onClick={() => setMode('direct')}
                      className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'direct' ? 'bg-white text-cobalt shadow-sm' : 'text-ink/40 hover:text-ink/60'}`}
                    >
                      Direct
                    </button>
                    <button 
                      onClick={() => setMode('ai')}
                      className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'ai' ? 'bg-white text-cobalt shadow-sm' : 'text-ink/40 hover:text-ink/60'}`}
                    >
                      AI
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {mode === 'ai' ? (
                      <motion.div 
                        key="ai-panel"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="space-y-8"
                      >
                        {/* AI Prompt Section */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Sparkles size={16} className="text-cobalt" />
                              <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink/60">
                                AI Interpretation {selectedTrack && <span className="text-cobalt ml-1">— {selectedTrack.label}</span>}
                              </h3>
                            </div>
                            {selectedTrack && (
                              <button 
                                onClick={() => handleTrackSelect(null)}
                                className="p-1 rounded-full hover:bg-black/5 text-ink/40"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>

                          <div className="relative">
                            <textarea 
                              value={inputText}
                              onChange={(e) => setInputText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleGenerateProposals();
                                }
                              }}
                              placeholder={selectedTrack ? `Describe how you want the ${selectedTrack.label.toLowerCase()} to feel...` : "Describe a mood for the mix..."}
                              disabled={isGenerating}
                              rows={3}
                              className="w-full bg-white/50 border border-black/10 rounded-2xl p-4 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cobalt/20 transition-all disabled:opacity-50 resize-none leading-relaxed"
                            />
                            <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
                              <button 
                                onClick={startListening}
                                disabled={isGenerating || isListening}
                                className={`p-2 rounded-xl transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-black/5 text-ink/80 hover:bg-black/10'} disabled:opacity-30 shadow-sm`}
                              >
                                <Mic size={16} />
                              </button>
                              <button 
                                onClick={() => handleGenerateProposals()}
                                disabled={isGenerating || !inputText.trim()}
                                className="p-2 rounded-xl bg-cobalt text-white hover:bg-cobalt/90 disabled:opacity-30 transition-all shadow-sm shadow-cobalt/20"
                              >
                                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight size={16} />}
                              </button>
                            </div>
                          </div>

                          {/* Hints */}
                          {selectedTrack && (
                            <div className="flex flex-wrap gap-2">
                              {['closer', 'roomier', 'softer', 'wider'].map(hint => (
                                <button
                                  key={hint}
                                  onClick={() => setInputText(`Make it feel ${hint}`)}
                                  className="px-3 py-1.5 rounded-lg bg-black/5 text-[9px] font-bold uppercase tracking-widest text-ink/40 hover:bg-black/10 hover:text-ink/60 transition-all"
                                >
                                  {hint}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Proposals List */}
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/50">Interpretations</h2>
                            {proposals.length > 0 && (
                              <button onClick={() => handleGenerateProposals()} disabled={isGenerating} className="text-cobalt hover:text-cobalt/80 transition-colors">
                                <RotateCcw size={14} className={isGenerating ? 'animate-spin' : ''} />
                              </button>
                            )}
                          </div>
                          <div className="space-y-4">
                            {isGenerating ? (
                              <div className="flex flex-col items-center justify-center py-8 gap-3">
                                <Loader2 className="animate-spin text-cobalt/40" size={24} />
                                <p className="text-[10px] text-ink/40 font-serif italic">Exploring interpretations...</p>
                              </div>
                            ) : proposals.length === 0 ? (
                              <div className="p-8 rounded-3xl border border-dashed border-black/10 flex flex-col items-center justify-center text-center gap-3">
                                <Sparkles size={20} className="text-ink/20" />
                                <p className="text-[10px] text-ink/40 font-serif italic">Describe a mood to see interpretations.</p>
                              </div>
                            ) : (
                              proposals.map((p) => (
                                <ProposalCard 
                                  key={p.id} 
                                  proposal={p} 
                                  onAccept={() => handleAcceptProposal(p)}
                                  onReject={() => handleRejectProposal(p.id)}
                                  onPreview={() => togglePreview(p.id)}
                                  isPreviewing={previewProposalId === p.id}
                                  isLargeText={isLargeText}
                                />
                              ))
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div 
                        key="direct-panel"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="space-y-8"
                      >
                        {selectedTrack ? (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Sliders size={16} className="text-cobalt" />
                                <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Direct Control: {selectedTrack.label}</h3>
                              </div>
                              <button 
                                onClick={() => updateTrackParam(selectedTrack.id, INITIAL_TRACKS.find(t => t.id === selectedTrack.id)!)}
                                className="text-[9px] text-ink/40 hover:text-ink/60 font-bold uppercase tracking-widest"
                              >
                                Reset
                              </button>
                            </div>

                            <div className="space-y-8">
                              <div className="space-y-3">
                                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-ink/60">
                                  <span>Volume</span>
                                  <span className="text-cobalt">{selectedTrack.volume}%</span>
                                </div>
                                <input 
                                  type="range" min="0" max="100" 
                                  value={selectedTrack.volume}
                                  onChange={(e) => updateTrackParam(selectedTrack.id, { volume: parseInt(e.target.value) })}
                                  className="w-full h-1.5 bg-black/5 rounded-full appearance-none cursor-pointer accent-cobalt"
                                />
                              </div>

                              <div className="space-y-3">
                                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-ink/60">
                                  <span>Echo</span>
                                  <span className="text-cobalt">{selectedTrack.delay.toFixed(1)}s</span>
                                </div>
                                <input 
                                  type="range" min="0" max="3" step="0.1"
                                  value={selectedTrack.delay}
                                  onChange={(e) => updateTrackParam(selectedTrack.id, { delay: parseFloat(e.target.value) })}
                                  className="w-full h-1.5 bg-black/5 rounded-full appearance-none cursor-pointer accent-cobalt"
                                />
                              </div>

                              <div className="space-y-3">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-ink/60 block">Space</span>
                                <div className="grid grid-cols-3 gap-2">
                                  {(['dry', 'room', 'hall'] as ReverbType[]).map((r) => (
                                    <button
                                      key={r}
                                      onClick={() => updateTrackParam(selectedTrack.id, { reverb: r })}
                                      className={`py-3 rounded-xl text-[10px] font-bold capitalize transition-all border ${selectedTrack.reverb === r ? 'bg-cobalt text-white border-cobalt shadow-lg shadow-cobalt/20' : 'bg-white/50 text-ink/60 border-black/5 hover:border-black/10'}`}
                                    >
                                      {r}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="p-8 rounded-3xl border border-dashed border-black/10 flex flex-col items-center justify-center text-center gap-3">
                            <Sliders size={20} className="text-ink/20" />
                            <p className="text-[10px] text-ink/40 font-serif italic">Select an orb to adjust its parameters directly.</p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
          </div>

          {/* Timeline Bar at Bottom */}
          <div className="h-16 border-t border-black/5 bg-white/95 backdrop-blur-md px-8 flex items-center gap-6 z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-mono font-bold text-ink/60 w-10">{formatTime(currentTime)}</span>
            <div className="flex-1 relative h-6 flex items-center group">
              <div className="absolute inset-0 h-1 my-auto bg-black/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cobalt transition-all duration-100" 
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
              </div>
              <input 
                type="range"
                min="0"
                max={duration}
                step="0.01"
                value={currentTime}
                onChange={handleSeek}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div 
                className="absolute h-3 w-3 bg-white border-2 border-cobalt rounded-full shadow-md pointer-events-none transition-transform group-hover:scale-125"
                style={{ left: `calc(${(currentTime / duration) * 100}% - 6px)` }}
              />
            </div>
            <span className="text-[10px] font-mono font-bold text-ink/60 w-10 text-right">{formatTime(duration)}</span>
          </div>
      </main>

      <AnimatePresence>
        {showIntro && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissIntro}
            className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 cursor-pointer"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-warm-white max-w-lg w-full rounded-[2.5rem] p-10 shadow-2xl overflow-hidden relative cursor-default"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-cobalt" />
              
              <h2 className="text-3xl font-serif italic mb-8 flex items-center gap-4">
                <HelpCircle className="text-cobalt" size={32} />
                Orbs
              </h2>
              
              <div className="space-y-8 mb-10">
                <div className="flex gap-6">
                  <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0 font-bold text-ink/60">1</div>
                  <div>
                    <h3 className="font-bold uppercase tracking-widest text-[10px] text-ink/60 mb-1">Focus on a Sound</h3>
                    <p className="font-serif italic text-ink/90">Click an orb to select a track. The interface at the bottom will adapt to your selection.</p>
                  </div>
                </div>
                
                <div className="flex gap-6">
                  <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0 font-bold text-ink/60">2</div>
                  <div>
                    <h3 className="font-bold uppercase tracking-widest text-[10px] text-ink/60 mb-1">Direct Precision vs AI Exploration</h3>
                    <p className="font-serif italic text-ink/90">Switch modes at the bottom. Use <b>Direct</b> for manual precision or <b>AI</b> to explore creative interpretations of your intent.</p>
                  </div>
                </div>
                
                <div className="flex gap-6">
                  <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0 font-bold text-ink/60">3</div>
                  <div>
                    <h3 className="font-bold uppercase tracking-widest text-[10px] text-ink/60 mb-1">Interpretations, not Answers</h3>
                    <p className="font-serif italic text-ink/90">AI suggestions are subjective interpretations. Use "Explore Alternatives" to see how the AI can re-imagine your request.</p>
                  </div>
                </div>
                
                <div className="flex gap-6">
                  <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0 font-bold text-ink/60">4</div>
                  <div>
                    <h3 className="font-bold uppercase tracking-widest text-[10px] text-ink/60 mb-1">Adaptive Collaboration</h3>
                    <p className="font-serif italic text-ink/90">The AI learns from your choices. The "Adaptation Bias" display shows how it's currently leaning based on your feedback.</p>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={dismissIntro}
                className="w-full py-4 bg-ink text-warm-white rounded-2xl font-bold hover:bg-ink/90 transition-all shadow-lg active:scale-[0.98]"
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OrbControl({ track, onSelect, onToggleMute, isReducedMotion, currentStep, isPlaying, isLargeText, isHighContrast, isSoloMuted }: { 
  track: Track, 
  onSelect: () => void, 
  onToggleMute: () => void,
  isReducedMotion: boolean, 
  currentStep: number,
  isPlaying: boolean,
  isLargeText: boolean,
  isHighContrast: boolean,
  isSoloMuted?: boolean,
  key?: string
}) {
  const baseSize = isLargeText ? 115 : 90;
  // Scale based on volume (0.8 to 1.3)
  const volumeScale = 0.8 + (track.volume / 100) * 0.5;
  const size = baseSize * volumeScale;
  
  const glowIntensity = track.delay * 25;
  
  // Determine if this orb should "pulse" on the current step
  const isStepActive = () => {
    if (!isPlaying || track.muted) return false;
    switch (track.id) {
      case 'drums': return currentStep % 4 === 0 || currentStep % 2 !== 0; // Kick and Hat
      case 'piano': return currentStep % 4 === 2 || currentStep % 8 === 0;
      case 'guitar': return currentStep % 3 === 0;
      case 'vocals': return currentStep % 16 === 0;
      default: return false;
    }
  };

  const active = isStepActive();
  
  const getOrbStyles = () => {
    switch(track.id) {
      case 'drums': return {
        background: 'radial-gradient(circle at 30% 30%, #60a5fa 0%, #2563eb 60%, #1e40af 100%)',
        boxShadow: 'inset -10px -10px 20px rgba(0,0,0,0.3), inset 10px 10px 20px rgba(255,255,255,0.4)',
        ringColor: 'border-blue-400/80',
        textColor: 'text-blue-500'
      };
      case 'piano': return {
        background: 'radial-gradient(circle at 30% 30%, #ffffff 0%, #fdf5e6 60%, #dcd3c1 100%)',
        boxShadow: 'inset -10px -10px 20px rgba(0,0,0,0.1), inset 10px 10px 20px rgba(255,255,255,0.8)',
        ringColor: 'border-amber-400/80',
        textColor: 'text-amber-600'
      };
      case 'guitar': return {
        background: 'radial-gradient(circle at 30% 30%, #d1fae5 0%, #a7f3d0 60%, #34d399 100%)',
        boxShadow: 'inset -10px -10px 20px rgba(0,0,0,0.2), inset 10px 10px 20px rgba(255,255,255,0.5)',
        ringColor: 'border-emerald-400/80',
        textColor: 'text-emerald-500'
      };
      case 'vocals': return {
        background: 'radial-gradient(circle at 30% 30%, #fce7f3 0%, #fbcfe8 60%, #f472b6 100%)',
        boxShadow: 'inset -10px -10px 20px rgba(0,0,0,0.2), inset 10px 10px 20px rgba(255,255,255,0.5)',
        ringColor: 'border-pink-400/80',
        textColor: 'text-pink-500'
      };
      default: return {
        background: 'radial-gradient(circle at 30% 30%, #f4f4f5 0%, #d4d4d8 60%, #71717a 100%)',
        boxShadow: 'inset -10px -10px 20px rgba(0,0,0,0.2), inset 10px 10px 20px rgba(255,255,255,0.5)',
        ringColor: 'border-zinc-400/40',
        textColor: 'text-zinc-500'
      };
    }
  };

  const orbStyles = getOrbStyles();

  return (
    <div className={`flex flex-col items-center ${isLargeText ? 'gap-8' : 'gap-6'} group relative`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className={`relative focus:outline-none transition-all active:scale-95 ${track.muted || isSoloMuted ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}`}
        aria-label={`Select ${track.label} track`}
      >
        {/* Selection Ring */}
        <AnimatePresence>
          {track.selected && (
            <motion.div 
              layoutId="selection-ring"
              className={`absolute ${isLargeText ? '-inset-8' : '-inset-6'} border-2 ${orbStyles.ringColor} rounded-full pointer-events-none`}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            />
          )}
        </AnimatePresence>

        {/* Reverb Aura */}
        <motion.div 
          animate={{
            scale: track.reverb === 'hall' ? 1.5 : track.reverb === 'room' ? 1.2 : 1,
            opacity: track.reverb === 'hall' ? 0.3 : track.reverb === 'room' ? 0.15 : 0,
          }}
          className={`absolute -inset-20 rounded-full transition-all duration-1000 blur-[80px] pointer-events-none ${
            track.reverb === 'hall' ? 'bg-cobalt/40' : 
            track.reverb === 'room' ? 'bg-cobalt/20' : 
            'bg-transparent'
          }`}
        />

        {/* The Orb */}
        <motion.div
          initial={false}
          animate={{
            width: size,
            height: size,
            scale: active ? 1.05 : 1,
            boxShadow: track.selected 
              ? `0 40px 80px -20px rgba(0, 87, 217, 0.2), 0 0 ${glowIntensity + (active ? 20 : 0)}px rgba(0, 87, 217, ${(glowIntensity + 20) / 100}), ${orbStyles.boxShadow}`
              : `0 20px 40px -10px rgba(0, 0, 0, 0.05), 0 0 ${glowIntensity + (active ? 10 : 0)}px rgba(0, 87, 217, ${(glowIntensity + 10) / 200}), ${orbStyles.boxShadow}`,
          }}
          style={{
            background: orbStyles.background,
          }}
          transition={{ type: 'spring', stiffness: 60, damping: 20 }}
          className={`rounded-full relative overflow-hidden flex items-center justify-center transition-all duration-700 border ${
            track.selected ? 'border-cobalt/30' : 'border-black/5 group-hover:border-black/10'
          }`}
        >
          {/* Glass Highlight */}
          <div className="absolute top-[10%] left-[15%] w-[30%] h-[30%] bg-white/40 rounded-full blur-[8px] pointer-events-none" />
          <div className="absolute top-[15%] left-[20%] w-[10%] h-[10%] bg-white/60 rounded-full blur-[2px] pointer-events-none" />
          
          {/* Inner Fill/Pattern */}
          <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-white via-transparent to-black pointer-events-none" />
          
          {/* Delay Glow Ring */}
          {track.delay > 0 && (
            <motion.div 
              animate={isReducedMotion ? {} : { scale: [1, 1.1, 1], opacity: [0.1, 0.2, 0.1] }}
              transition={{ duration: 4 / Math.max(0.1, track.delay), repeat: Infinity }}
              className="absolute inset-0 border-[4px] border-white/30 rounded-full pointer-events-none"
            />
          )}
        </motion.div>
      </button>

      <div className={`flex flex-col items-center ${isLargeText ? 'gap-4' : 'gap-3'}`}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="text-center focus:outline-none"
        >
          <span className={`${isLargeText ? 'text-sm' : 'text-xs'} font-bold tracking-[0.5em] uppercase transition-all duration-500 ${
            track.selected 
              ? (isHighContrast ? 'text-white' : orbStyles.textColor) 
              : (isHighContrast ? 'text-white/80 group-hover:text-white' : 'text-ink/60 group-hover:text-ink/90')
          }`}>
            {track.label}
          </span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          className={`${isLargeText ? 'p-3' : 'p-2.5'} rounded-full transition-all shadow-lg ${track.muted || isSoloMuted ? 'bg-red-500 text-white scale-110' : 'bg-white text-ink/40 hover:text-ink/60 border border-black/5'}`}
          title={track.muted ? "Unmute" : "Mute"}
        >
          {track.muted || isSoloMuted ? <VolumeX size={isLargeText ? 20 : 16} /> : <Volume2 size={isLargeText ? 20 : 16} />}
        </button>
      </div>
    </div>
  );
}

function ProposalCard({ proposal, onAccept, onReject, onPreview, isPreviewing, isLargeText }: { 
  proposal: Proposal, 
  onAccept: () => void, 
  onReject: () => void,
  onPreview: () => void,
  isPreviewing: boolean,
  isLargeText: boolean,
  key?: string
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`${isLargeText ? 'p-10 rounded-[2.5rem]' : 'p-7 rounded-[2rem]'} border transition-all ${isPreviewing ? 'bg-white border-cobalt shadow-xl shadow-cobalt/5' : 'bg-white border-black/5 shadow-sm hover:shadow-md'}`}
    >
      <div className={`flex justify-between items-start ${isLargeText ? 'mb-6' : 'mb-4'}`}>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-cobalt/60">Interpretation</span>
          <h3 className={`font-serif italic text-ink ${isLargeText ? 'text-2xl' : 'text-lg'}`}>{proposal.title}</h3>
        </div>
      </div>
      
      <p className={`text-ink/70 leading-relaxed font-serif italic ${isLargeText ? 'text-sm mb-8' : 'text-xs mb-6'}`}>
        {proposal.rationale}
      </p>

      <div className={`flex flex-wrap ${isLargeText ? 'gap-3 mb-10' : 'gap-2 mb-8'}`}>
        <div className={`flex items-center gap-2 font-bold bg-black/5 px-3 py-1.5 rounded-full text-ink/60 uppercase tracking-widest ${isLargeText ? 'text-xs px-4 py-2' : 'text-[9px]'}`}>
          <Volume2 size={isLargeText ? 16 : 12} /> {proposal.changes.volumeDelta > 0 ? '+' : ''}{proposal.changes.volumeDelta}
        </div>
        <div className={`flex items-center gap-2 font-bold bg-black/5 px-3 py-1.5 rounded-full text-ink/60 uppercase tracking-widest ${isLargeText ? 'text-xs px-4 py-2' : 'text-[9px]'}`}>
          <Waves size={isLargeText ? 16 : 12} /> {proposal.changes.delayDelta > 0 ? '+' : ''}{proposal.changes.delayDelta.toFixed(1)}s
        </div>
        <div className={`flex items-center gap-2 font-bold bg-black/5 px-3 py-1.5 rounded-full text-ink/60 uppercase tracking-widest ${isLargeText ? 'text-xs px-4 py-2' : 'text-[9px]'}`}>
          <Wind size={isLargeText ? 16 : 12} /> {proposal.changes.reverbTarget}
        </div>
      </div>

      <div className={`grid grid-cols-3 ${isLargeText ? 'gap-4' : 'gap-3'}`}>
        <button 
          onClick={onReject}
          className={`${isLargeText ? 'py-4 text-sm' : 'py-3 text-xs'} rounded-2xl font-bold bg-black/5 text-ink/80 border-transparent hover:bg-red-50 hover:text-red-500 transition-all flex items-center justify-center gap-2`}
          title="Reject Proposal"
        >
          <X size={isLargeText ? 18 : 14} /> Reject
        </button>
        <button 
          onClick={onPreview}
          className={`${isLargeText ? 'py-4 text-sm' : 'py-3 text-xs'} rounded-2xl font-bold transition-all border ${isPreviewing ? 'bg-ink text-white border-ink' : 'bg-black/5 text-ink/80 border-transparent hover:bg-black/10'}`}
        >
          {isPreviewing ? 'Stop' : 'Preview'}
        </button>
        <button 
          onClick={onAccept}
          className={`${isLargeText ? 'py-4 text-sm' : 'py-3 text-xs'} rounded-2xl font-bold bg-cobalt text-white hover:bg-cobalt/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-cobalt/20`}
        >
          <Check size={isLargeText ? 20 : 16} /> Accept
        </button>
      </div>
    </motion.div>
  );
}
