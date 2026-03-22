/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, Settings, Info, 
  ChevronRight, Check, X, Sparkles, Sliders,
  Volume2, VolumeX, Waves, Wind, Accessibility, Mic,
  Square, Loader2, Repeat
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
  const [mode, setMode] = useState<'direct' | 'conductor'>('conductor');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [previewProposalId, setPreviewProposalId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState>({
    rejectionCount: { drums: 0, piano: 0, guitar: 0, vocals: 0 },
    acceptCount: { drums: 0, piano: 0, guitar: 0, vocals: 0 },
    reverbBias: { drums: 0, piano: 0, guitar: 0, vocals: 0 }
  });
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audioEngine.getDuration());
  const [currentStep, setCurrentStep] = useState(0);
  const editStartState = useRef<Partial<Track> | null>(null);

  const selectedTrack = tracks.find(t => t.selected)!;

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

      if (t.selected && previewProposalId) {
        const p = proposals.find(prop => prop.id === previewProposalId);
        if (p && p.changes) {
          vol = Math.min(100, Math.max(0, t.volume + (Number(p.changes.volumeDelta) || 0)));
          del = Math.min(3, Math.max(0, t.delay + (Number(p.changes.delayDelta) || 0)));
          rev = p.changes.reverbTarget || t.reverb;
        }
      }

      // If muted, set volume to 0
      const finalVol = t.muted ? 0 : vol;

      audioEngine.updateTrack(t.id, finalVol, del, rev);
    });
  }, [tracks, previewProposalId, proposals]);

  // Handle feedback message timeout
  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => {
        setFeedbackMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMessage]);

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

  const togglePreview = (id: string) => {
    const isStarting = previewProposalId !== id;
    setPreviewProposalId(isStarting ? id : null);
    
    // If starting a preview, ensure music is playing so user can hear it
    if (isStarting && !isPlaying) {
      audioEngine.play();
      setIsPlaying(true);
    }
  };

  const handleTrackSelect = (id: string) => {
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
      description = `Conductor: ${proposalTitle}`;
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
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const lastItem = history[0];
    setTracks(prev => prev.map(t => t.id === lastItem.trackId ? { ...t, ...lastItem.previousState } : t));
    setHistory(prev => prev.slice(1));
  };

  const handleGenerateProposals = async (textOverride?: string) => {
    const textToUse = textOverride !== undefined ? textOverride : inputText;
    if (!textToUse.trim()) return;
    setIsGenerating(true);
    setPreviewProposalId(null);
    setFeedbackMessage("Exploring alternative interpretations.");
    
    try {
      // Simulate intensity reduction if many rejections
      const intensityFactor = adaptiveState.rejectionCount[selectedTrack.id] >= 2 ? 0.5 : 1.0;
      
      const resultsPromise = generateProposals(textToUse, selectedTrack, process.env.GEMINI_API_KEY);
      
      // Add a 15-second timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Generation timed out")), 15000)
      );

      const results = await Promise.race([resultsPromise, timeoutPromise]);
      
      if (!results || !Array.isArray(results)) {
        throw new Error("Invalid proposals received");
      }

      // Apply intensity factor to results
      const adjustedResults = results.map(p => ({
        ...p,
        changes: {
          ...p.changes,
          volumeDelta: Math.round((p.changes?.volumeDelta || 0) * intensityFactor),
          delayDelta: (p.changes?.delayDelta || 0) * intensityFactor,
          reverbTarget: p.changes?.reverbTarget || selectedTrack.reverb
        }
      }));

      setProposals(adjustedResults);
    } catch (error) {
      console.error("Failed to generate proposals:", error);
      // Fallback to empty proposals or show error
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
    
    const currentAccepts = (adaptiveState.acceptCount[selectedTrack.id] || 0) + 1;
    if (currentAccepts >= 2) {
      setFeedbackMessage("Got it — keeping that direction in mind.");
    } else {
      setFeedbackMessage("Noted — leaning toward similar changes.");
    }

    // Adaptive: Bias toward reverb if accepted "roomy"
    setAdaptiveState(prev => ({
      ...prev,
      rejectionCount: { ...prev.rejectionCount, [selectedTrack.id]: 0 }, // Reset rejections on accept
      acceptCount: { ...prev.acceptCount, [selectedTrack.id]: currentAccepts }
    }));
    if (proposal.changes.reverbTarget !== 'dry') {
      setAdaptiveState(prev => ({
        ...prev,
        reverbBias: { ...prev.reverbBias, [selectedTrack.id]: prev.reverbBias[selectedTrack.id] + 1 }
      }));
    }
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
    
    const currentRejections = (adaptiveState.rejectionCount[selectedTrack.id] || 0) + 1;
    
    if (currentRejections >= 2) {
      setFeedbackMessage("Adjusting toward more subtle interpretations.");
    } else {
      setFeedbackMessage("Okay — trying a different interpretation.");
    }

    // Adaptive: Track rejections
    setAdaptiveState(prev => ({
      ...prev,
      rejectionCount: { ...prev.rejectionCount, [selectedTrack.id]: currentRejections },
      acceptCount: { ...prev.acceptCount, [selectedTrack.id]: 0 } // Reset accepts on reject
    }));
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
    <div className={`min-h-screen flex flex-col transition-colors duration-500 ${isHighContrast ? 'bg-black text-white' : 'bg-warm-white text-ink'}`}>
      {/* Top Bar */}
      <header className="h-20 border-b border-black/5 flex items-center justify-between px-8 bg-white/40 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-serif italic tracking-tight flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-cobalt" />
            Music Orbs
          </h1>
          <div className="h-6 w-[1px] bg-black/10" />
          <span className="text-sm text-ink/60 font-medium uppercase tracking-widest">Midnight Echo</span>
          
          <div className="flex items-center bg-black/5 rounded-full p-1 gap-1">
            <button 
              onClick={() => setMode('direct')}
              className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'direct' ? 'bg-white text-ink shadow-sm' : 'text-ink/40 hover:text-ink/60'}`}
            >
              Direct
            </button>
            <button 
              onClick={() => setMode('conductor')}
              className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'conductor' ? 'bg-white text-ink shadow-sm' : 'text-ink/40 hover:text-ink/60'}`}
            >
              Conductor
            </button>
          </div>
          
          <div className="h-6 w-[1px] bg-black/10 mx-2" />
          
          <AnimatePresence>
            {mode === 'conductor' && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full bg-cobalt animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cobalt">Conductor Active</span>
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
              className={`p-2.5 rounded-full transition-all active:scale-95 ${isLooping ? 'text-cobalt bg-cobalt/10' : 'text-ink/40 hover:text-ink/60'}`}
              aria-label="Toggle Loop"
              title="Toggle Loop"
            >
              <Repeat size={18} />
            </button>
          </div>
          
          <button 
            onClick={handleUndo}
            disabled={history.length === 0}
            className="p-3 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20 transition-all active:scale-95"
            aria-label="Undo"
          >
            <RotateCcw size={22} />
          </button>

          <button 
            onClick={() => setIsReducedMotion(!isReducedMotion)}
            className={`p-3 rounded-full transition-all ${isReducedMotion ? 'bg-cobalt text-white' : 'bg-black/5 hover:bg-black/10'}`}
            aria-label="Toggle Reduced Motion"
            title="Toggle Reduced Motion"
          >
            <Wind size={22} />
          </button>

          <button 
            onClick={() => setIsHighContrast(!isHighContrast)}
            className={`p-3 rounded-full transition-all ${isHighContrast ? 'bg-ink text-warm-white' : 'bg-black/5 hover:bg-black/10'}`}
            aria-label="Toggle High Contrast"
            title="Toggle High Contrast"
          >
            <Accessibility size={22} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Timeline Bar */}
        <div className="h-16 border-b border-black/5 bg-white/20 backdrop-blur-md px-8 flex items-center gap-6 z-40">
          <span className="text-[10px] font-mono font-bold text-ink/40 w-10">{formatTime(currentTime)}</span>
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
          <span className="text-[10px] font-mono font-bold text-ink/40 w-10 text-right">{formatTime(duration)}</span>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Proposals & History */}
          <aside className="w-[450px] border-r border-black/5 bg-powder/30 flex flex-col overflow-hidden">
            {/* NLP Input Area (Moved to Top) */}
            {mode === 'conductor' && (
              <div className="p-8 bg-white/60 border-b border-black/5 backdrop-blur-xl z-20">
                <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/30 mb-4 block">
                  What would you like to change?
                </label>
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
                    placeholder="e.g. make the drums feel more atmospheric and the piano a bit roomier..."
                    disabled={isGenerating}
                    rows={3}
                    className="w-full bg-white border border-black/10 rounded-[2rem] py-6 pl-8 pr-32 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cobalt/20 transition-all disabled:opacity-50 shadow-xl shadow-black/5 resize-none leading-relaxed min-h-[140px]"
                  />
                  <div className="absolute right-4 bottom-4 flex items-center gap-2">
                    <button 
                      onClick={startListening}
                      disabled={isGenerating || isListening}
                      className={`p-3.5 rounded-2xl transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-black/5 text-ink/60 hover:bg-black/10'} disabled:opacity-30 shadow-lg`}
                      aria-label="Voice Input"
                      title="Voice Input"
                    >
                      <Mic size={20} />
                    </button>
                    <button 
                      onClick={() => handleGenerateProposals()}
                      disabled={isGenerating || !inputText.trim()}
                      className="p-3.5 rounded-2xl bg-cobalt text-white hover:bg-cobalt/90 disabled:opacity-30 transition-all shadow-lg shadow-cobalt/20"
                      aria-label="Generate Proposals"
                    >
                      {isGenerating ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ChevronRight size={20} />}
                    </button>
                  </div>
                </div>

                {/* Feedback Message Area */}
                <div className="h-6 mt-2 overflow-hidden" aria-live="polite">
                  <AnimatePresence mode="wait">
                    {feedbackMessage && (
                      <motion.p 
                        key={feedbackMessage}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="text-[10px] text-cobalt font-bold uppercase tracking-wider text-center"
                      >
                        {feedbackMessage}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {speechError && (
                  <p className="mt-2 text-[10px] text-red-500 font-bold uppercase tracking-wider text-center">
                    {speechError}
                  </p>
                )}
                
                <div className="mt-6 flex flex-wrap gap-3">
                  {['closer', 'roomier', 'softer', 'wider'].map(hint => (
                    <button
                      key={hint}
                      onClick={() => {
                        setInputText(`Make the ${selectedTrack.label.toLowerCase()} feel ${hint}`);
                      }}
                      className="px-4 py-2 rounded-xl bg-black/5 text-[10px] font-bold uppercase tracking-widest text-ink/40 hover:bg-black/10 hover:text-ink/60 transition-all"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-8 space-y-12 custom-scrollbar">
              {/* Proposals Section */}
              {mode === 'conductor' && (
                <div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/30 mb-6">AI Suggestions</h2>
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-6">
                      {isGenerating ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                          <Loader2 className="animate-spin text-cobalt/40" size={32} />
                          <p className="text-xs text-ink/30 font-serif italic">The conductor is listening...</p>
                        </div>
                      ) : proposals.length === 0 ? (
                        <div className="p-8 rounded-[2rem] border border-dashed border-black/10 flex flex-col items-center justify-center text-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-black/5 flex items-center justify-center text-ink/20">
                            <Sparkles size={20} />
                          </div>
                          <p className="text-xs text-ink/30 font-serif italic">Describe a mood or a change to see suggestions.</p>
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
                          />
                        ))
                      )}
                    </div>
                  </AnimatePresence>
                </div>
              )}

              {/* Mix Summary */}
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/30 mb-6">Current Mix</h2>
                <div className="space-y-4">
                  {tracks.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-sm p-4 rounded-2xl bg-white/40 border border-black/5 shadow-sm">
                      <span className="font-bold text-ink/80">{t.label}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${t.muted ? 'text-red-500' : 'text-ink/40'}`}>
                        {t.muted ? 'Muted' : `${t.volume > 75 ? 'Loud' : t.volume < 30 ? 'Quiet' : 'Medium'} • ${t.reverb}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* History Section */}
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/30 mb-6">History</h2>
                <div className="space-y-4">
                  {history.length > 0 ? (
                    history.map((item) => (
                      <div key={item.id} className="text-xs p-4 rounded-2xl bg-white/40 border border-black/5 flex flex-col gap-2 shadow-sm">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-ink/80">{tracks.find(t => t.id === item.trackId)?.label}</span>
                          <span className="text-[9px] text-ink/30 font-bold uppercase tracking-widest">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-ink/50 font-serif italic">
                          {item.description}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-ink/30 italic font-serif">No changes yet.</p>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* Center Area: Orbs */}
          <div className="flex-1 relative flex flex-col items-center justify-center p-8 pb-32 overflow-x-auto">
            <div className="flex flex-nowrap gap-8 items-center justify-center w-full max-w-6xl">
              {tracks.map((track) => (
                <OrbControl 
                  key={track.id} 
                  track={track} 
                  onSelect={() => handleTrackSelect(track.id)}
                  onToggleMute={() => handleToggleMute(track.id)}
                  isReducedMotion={isReducedMotion}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                />
              ))}
            </div>
          </div>

          {/* Right Panel: Direct Editing */}
          <AnimatePresence>
            {mode === 'direct' && (
              <motion.aside 
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 50 }}
                className="w-80 border-l border-black/5 bg-powder/30 flex flex-col overflow-hidden backdrop-blur-xl z-20"
              >
                <div className="p-8 bg-white/60 border-b border-black/5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-serif italic text-xl flex items-center gap-3">
                      <Sliders size={20} className="text-cobalt" />
                      Editing {selectedTrack.label}
                    </h3>
                    <button 
                      onClick={() => updateTrackParam(selectedTrack.id, INITIAL_TRACKS.find(t => t.id === selectedTrack.id)!)}
                      className="text-[10px] text-ink/40 hover:text-ink/60 font-bold uppercase tracking-[0.2em] transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                  <p className="text-[10px] text-ink/30 font-bold uppercase tracking-widest">Manual Control Mode</p>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-12 custom-scrollbar">
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <div className="flex justify-between text-sm font-bold tracking-tight">
                        <label htmlFor="volume" className="text-ink/50 uppercase tracking-widest text-[10px]">Volume</label>
                        <span className="text-cobalt">{selectedTrack.volume}%</span>
                      </div>
                      <input 
                        id="volume"
                        type="range" 
                        min="0" max="100" 
                        value={selectedTrack.volume}
                        onMouseDown={() => {
                          editStartState.current = { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb };
                        }}
                        onMouseUp={() => {
                          if (editStartState.current) {
                            commitTrackChange(selectedTrack.id, editStartState.current, { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb }, 'direct');
                            editStartState.current = null;
                          }
                        }}
                        onChange={(e) => updateTrackParam(selectedTrack.id, { volume: parseInt(e.target.value) })}
                        className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cobalt"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between text-sm font-bold tracking-tight">
                        <label htmlFor="delay" className="text-ink/50 uppercase tracking-widest text-[10px]">Delay (Echo)</label>
                        <span className="text-cobalt">{selectedTrack.delay.toFixed(1)}s</span>
                      </div>
                      <input 
                        id="delay"
                        type="range" 
                        min="0" max="3" step="0.1"
                        value={selectedTrack.delay}
                        onMouseDown={() => {
                          editStartState.current = { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb };
                        }}
                        onMouseUp={() => {
                          if (editStartState.current) {
                            commitTrackChange(selectedTrack.id, editStartState.current, { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb }, 'direct');
                            editStartState.current = null;
                          }
                        }}
                        onChange={(e) => updateTrackParam(selectedTrack.id, { delay: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cobalt"
                      />
                    </div>

                    <div className="space-y-4">
                      <span className="text-ink/50 uppercase tracking-widest text-[10px] font-bold block">Reverb (Environment)</span>
                      <div className="grid grid-cols-3 gap-2">
                        {(['dry', 'room', 'hall'] as ReverbType[]).map((r) => (
                          <button
                            key={r}
                            onClick={() => {
                              const previousState = { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb };
                              const newState = { reverb: r };
                              updateTrackParam(selectedTrack.id, newState);
                              commitTrackChange(selectedTrack.id, previousState, { ...previousState, ...newState }, 'direct');
                            }}
                            className={`py-3 rounded-xl text-[10px] font-bold capitalize transition-all border flex flex-col items-center justify-center gap-1 ${selectedTrack.reverb === r ? 'bg-cobalt text-white border-cobalt shadow-lg shadow-cobalt/20' : 'bg-white/50 text-ink/50 border-black/5 hover:border-black/10'}`}
                          >
                            {r}
                            {selectedTrack.reverb === r && <div className="w-1 h-1 rounded-full bg-white" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-black/5">
                      <button
                        onClick={() => handleToggleMute(selectedTrack.id)}
                        className={`w-full py-4 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-3 border ${selectedTrack.muted ? 'bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/20' : 'bg-black/5 text-ink/60 border-transparent hover:bg-black/10'}`}
                      >
                        {selectedTrack.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        {selectedTrack.muted ? 'Unmute Track' : 'Mute Track'}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function OrbControl({ track, onSelect, onToggleMute, isReducedMotion, currentStep, isPlaying }: { 
  track: Track, 
  onSelect: () => void, 
  onToggleMute: () => void,
  isReducedMotion: boolean, 
  currentStep: number,
  isPlaying: boolean,
  key?: string
}) {
  const baseSize = 100;
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
    <div className="flex flex-col items-center gap-10 group relative">
      <div className="flex items-center gap-3">
        <button
          onClick={onSelect}
          className="text-center focus:outline-none"
        >
          <span className={`text-[10px] font-bold tracking-[0.4em] uppercase transition-all duration-500 ${track.selected ? orbStyles.textColor : 'text-ink/20 group-hover:text-ink/40'}`}>
            {track.label}
          </span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          className={`p-1.5 rounded-full transition-all ${track.muted ? 'bg-red-500/10 text-red-500' : 'bg-black/5 text-ink/20 hover:text-ink/40'}`}
          title={track.muted ? "Unmute" : "Mute"}
        >
          {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </button>
      </div>
      
      <button
        onClick={onSelect}
        className={`relative focus:outline-none transition-all active:scale-95 ${track.muted ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}`}
        aria-label={`Select ${track.label} track`}
      >
        {/* Selection Ring */}
        <AnimatePresence>
          {track.selected && (
            <motion.div 
              layoutId="selection-ring"
              className={`absolute -inset-6 border-2 ${orbStyles.ringColor} rounded-full pointer-events-none`}
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
    </div>
  );
}

function ProposalCard({ proposal, onAccept, onReject, onPreview, isPreviewing }: { 
  proposal: Proposal, 
  onAccept: () => void, 
  onReject: () => void,
  onPreview: () => void,
  isPreviewing: boolean,
  key?: string
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`p-7 rounded-[2rem] border transition-all ${isPreviewing ? 'bg-white border-cobalt shadow-xl shadow-cobalt/5' : 'bg-white border-black/5 shadow-sm hover:shadow-md'}`}
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-serif italic text-lg text-ink">{proposal.title}</h3>
        <button onClick={onReject} className="text-ink/20 hover:text-ink/40 transition-colors">
          <X size={18} />
        </button>
      </div>
      
      <p className="text-xs text-ink/50 leading-relaxed mb-6 font-serif italic">
        {proposal.rationale}
      </p>

      <div className="flex flex-wrap gap-2 mb-8">
        <div className="flex items-center gap-2 text-[9px] font-bold bg-black/5 px-3 py-1.5 rounded-full text-ink/40 uppercase tracking-widest">
          <Volume2 size={12} /> {proposal.changes.volumeDelta > 0 ? '+' : ''}{proposal.changes.volumeDelta}
        </div>
        <div className="flex items-center gap-2 text-[9px] font-bold bg-black/5 px-3 py-1.5 rounded-full text-ink/40 uppercase tracking-widest">
          <Waves size={12} /> {proposal.changes.delayDelta > 0 ? '+' : ''}{proposal.changes.delayDelta.toFixed(1)}s
        </div>
        <div className="flex items-center gap-2 text-[9px] font-bold bg-black/5 px-3 py-1.5 rounded-full text-ink/40 uppercase tracking-widest">
          <Wind size={12} /> {proposal.changes.reverbTarget}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button 
          onClick={onPreview}
          className={`py-3 rounded-2xl text-xs font-bold transition-all border ${isPreviewing ? 'bg-ink text-white border-ink' : 'bg-black/5 text-ink/60 border-transparent hover:bg-black/10'}`}
        >
          {isPreviewing ? 'Stop' : 'Preview'}
        </button>
        <button 
          onClick={onAccept}
          className="py-3 rounded-2xl text-xs font-bold bg-cobalt text-white hover:bg-cobalt/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-cobalt/20"
        >
          <Check size={16} /> Accept
        </button>
      </div>
    </motion.div>
  );
}
