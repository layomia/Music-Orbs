/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, Settings, Info, 
  ChevronRight, Check, X, Sparkles, Sliders,
  Volume2, Waves, Wind, Accessibility, Mic
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Track, Proposal, HistoryItem, AdaptiveState, ReverbType } from './types';
import { generateProposals } from './proposalGenerator';
import { audioEngine } from './audioEngine';

const INITIAL_TRACKS: Track[] = [
  { id: 'drums', label: 'Drums', volume: 70, delay: 0.2, reverb: 'room', selected: true },
  { id: 'piano', label: 'Piano', volume: 60, delay: 0.5, reverb: 'hall', selected: false },
  { id: 'guitar', label: 'Guitar', volume: 65, delay: 0.3, reverb: 'room', selected: false },
  { id: 'vocals', label: 'Vocals', volume: 80, delay: 0.1, reverb: 'dry', selected: false },
];

export default function App() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<'direct' | 'conductor'>('direct');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [previewProposalId, setPreviewProposalId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState>({
    rejectionCount: { drums: 0, piano: 0, guitar: 0, vocals: 0 },
    reverbBias: { drums: 0, piano: 0, guitar: 0, vocals: 0 }
  });
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const selectedTrack = tracks.find(t => t.selected)!;

  // Initialize audio engine
  useEffect(() => {
    tracks.forEach(t => audioEngine.setupTrack(t.id));
  }, []);

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

      audioEngine.updateTrack(t.id, vol, del, rev);
    });
  }, [tracks, previewProposalId, proposals]);

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
    const prevTrack = tracks.find(t => t.id === id)!;
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...params } : t));
    
    // Record history for direct edits
    const historyItem: HistoryItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      trackId: id,
      previousState: { volume: prevTrack.volume, delay: prevTrack.delay, reverb: prevTrack.reverb },
      newState: params,
      type: 'direct'
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

  const handleAcceptProposal = (proposal: Proposal) => {
    const newParams = {
      volume: Math.min(100, Math.max(0, selectedTrack.volume + (Number(proposal.changes.volumeDelta) || 0))),
      delay: Math.min(3, Math.max(0, selectedTrack.delay + (Number(proposal.changes.delayDelta) || 0))),
      reverb: proposal.changes.reverbTarget || selectedTrack.reverb
    };

    const historyItem: HistoryItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      trackId: selectedTrack.id,
      proposalTitle: proposal.title,
      previousState: { volume: selectedTrack.volume, delay: selectedTrack.delay, reverb: selectedTrack.reverb },
      newState: newParams,
      type: 'conductor'
    };

    setTracks(prev => prev.map(t => t.id === selectedTrack.id ? { ...t, ...newParams } : t));
    setHistory(prev => [historyItem, ...prev].slice(0, 20));
    setProposals([]);
    setPreviewProposalId(null);
    setInputText('');

    // Adaptive: Bias toward reverb if accepted "roomy"
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
    
    // Adaptive: Track rejections
    setAdaptiveState(prev => ({
      ...prev,
      rejectionCount: { ...prev.rejectionCount, [selectedTrack.id]: prev.rejectionCount[selectedTrack.id] + 1 }
    }));
  };

  const togglePlay = () => {
    if (isPlaying) audioEngine.pause();
    else audioEngine.play();
    setIsPlaying(!isPlaying);
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
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={togglePlay}
            className="p-3 rounded-full bg-black/5 hover:bg-black/10 transition-all active:scale-95"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
          </button>
          
          <button 
            onClick={handleUndo}
            disabled={history.length === 0}
            className="p-3 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20 transition-all active:scale-95"
            aria-label="Undo"
          >
            <RotateCcw size={22} />
          </button>

          <div className="flex bg-black/5 rounded-full p-1.5 ml-2">
            <button 
              onClick={() => setMode('direct')}
              className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all ${mode === 'direct' ? 'bg-white text-ink shadow-sm' : 'text-ink/40 hover:text-ink/60'}`}
            >
              Direct
            </button>
            <button 
              onClick={() => setMode('conductor')}
              className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all ${mode === 'conductor' ? 'bg-cobalt text-white shadow-md' : 'text-ink/40 hover:text-ink/60'}`}
            >
              Conductor
            </button>
          </div>

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

      <main className="flex-1 flex overflow-hidden">
        {/* Center Area: Orbs */}
        <div className="flex-1 relative flex flex-col items-center justify-center p-16 overflow-hidden">
          {showOnboarding && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-10 left-1/2 -translate-x-1/2 bg-white border border-black/5 px-8 py-4 rounded-3xl text-sm text-ink/70 shadow-xl shadow-black/5 backdrop-blur-sm flex items-center gap-4 z-10"
            >
              <Info size={18} className="text-cobalt" />
              Press Play to start the music. Select a track to edit it directly or ask the AI Conductor for interpretations.
              <button onClick={() => setShowOnboarding(false)} className="ml-6 text-ink/30 hover:text-ink transition-colors"><X size={18} /></button>
            </motion.div>
          )}

          <div className="flex gap-16 items-center justify-center w-full max-w-5xl">
            {tracks.map((track) => (
              <OrbControl 
                key={track.id} 
                track={track} 
                onSelect={() => handleTrackSelect(track.id)}
                isReducedMotion={isReducedMotion}
              />
            ))}
          </div>

          {/* Direct Mode Controls Overlay */}
          <AnimatePresence>
            {mode === 'direct' && (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30 }}
                className="mt-20 bg-powder/80 border border-black/5 p-8 rounded-[2.5rem] backdrop-blur-2xl w-full max-w-lg shadow-2xl shadow-black/5"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="font-serif italic text-xl flex items-center gap-3">
                    <Sliders size={20} className="text-cobalt" />
                    Editing {selectedTrack.label}
                  </h3>
                  <button 
                    onClick={() => updateTrackParam(selectedTrack.id, INITIAL_TRACKS.find(t => t.id === selectedTrack.id)!)}
                    className="text-[10px] text-ink/40 hover:text-ink/60 font-bold uppercase tracking-[0.2em] transition-colors"
                  >
                    Reset Track
                  </button>
                </div>

                <div className="space-y-8">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm font-bold tracking-tight">
                      <label htmlFor="volume" className="text-ink/50 uppercase tracking-widest text-[10px]">Volume</label>
                      <span className="text-cobalt">{selectedTrack.volume}%</span>
                    </div>
                    <input 
                      id="volume"
                      type="range" 
                      min="0" max="100" 
                      value={selectedTrack.volume}
                      onChange={(e) => updateTrackParam(selectedTrack.id, { volume: parseInt(e.target.value) })}
                      className="w-full h-1 bg-black/5 rounded-lg appearance-none cursor-pointer accent-cobalt"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm font-bold tracking-tight">
                      <label htmlFor="delay" className="text-ink/50 uppercase tracking-widest text-[10px]">Delay (Echo)</label>
                      <span className="text-cobalt">{selectedTrack.delay.toFixed(1)}s</span>
                    </div>
                    <input 
                      id="delay"
                      type="range" 
                      min="0" max="3" step="0.1"
                      value={selectedTrack.delay}
                      onChange={(e) => updateTrackParam(selectedTrack.id, { delay: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-black/5 rounded-lg appearance-none cursor-pointer accent-cobalt"
                    />
                  </div>

                  <div className="space-y-4">
                    <span className="text-ink/50 uppercase tracking-widest text-[10px] font-bold block">Reverb (Environment)</span>
                    <div className="grid grid-cols-3 gap-3">
                      {(['dry', 'room', 'hall'] as ReverbType[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => updateTrackParam(selectedTrack.id, { reverb: r })}
                          className={`py-3 rounded-2xl text-xs font-bold capitalize transition-all border ${selectedTrack.reverb === r ? 'bg-cobalt text-white border-cobalt shadow-lg shadow-cobalt/20' : 'bg-white/50 text-ink/50 border-black/5 hover:border-black/10'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel: Proposals & History */}
        <aside className="w-[26rem] border-l border-black/5 bg-powder/30 flex flex-col overflow-hidden">
          <div className="p-8 flex-1 overflow-y-auto space-y-10 custom-scrollbar">
            {/* Proposals Section */}
            {mode === 'conductor' && (
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/30 mb-6 flex items-center gap-3">
                  <Sparkles size={14} className="text-cobalt" />
                  AI Proposals
                </h2>
                
                <AnimatePresence mode="wait">
                  <div className="space-y-5">
                    {proposals.length > 0 ? (
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
                    ) : (
                      <div className="p-10 border border-dashed border-black/10 rounded-[2rem] text-center bg-white/20">
                        <p className="text-sm text-ink/40 italic font-serif">
                          {isGenerating ? "Conductor is thinking..." : "Describe the feeling you want below..."}
                        </p>
                      </div>
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
                    <span className="text-ink/40 text-[10px] font-bold uppercase tracking-widest">
                      {t.volume > 75 ? 'Loud' : t.volume < 30 ? 'Quiet' : 'Medium'} • {t.reverb}
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
                        {item.type === 'conductor' ? `“${item.proposalTitle}”` : 'Manual adjustment'}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-ink/30 italic font-serif">No changes yet.</p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Input Area */}
          {mode === 'conductor' && (
            <div className="p-8 bg-white/40 border-t border-black/5 backdrop-blur-xl">
              <div className="relative">
                <input 
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerateProposals()}
                  placeholder="e.g. make it feel closer..."
                  disabled={isGenerating}
                  className="w-full bg-white border border-black/10 rounded-3xl py-5 pl-7 pr-32 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cobalt/20 transition-all disabled:opacity-50 shadow-lg shadow-black/5"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button 
                    onClick={startListening}
                    disabled={isGenerating || isListening}
                    className={`p-3 rounded-2xl transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-black/5 text-ink/60 hover:bg-black/10'} disabled:opacity-30 shadow-lg`}
                    aria-label="Voice Input"
                    title="Voice Input"
                  >
                    <Mic size={22} />
                  </button>
                  <button 
                    onClick={() => handleGenerateProposals()}
                    disabled={isGenerating || !inputText.trim()}
                    className="p-3 rounded-2xl bg-cobalt text-white hover:bg-cobalt/90 disabled:opacity-30 transition-all shadow-lg shadow-cobalt/20"
                    aria-label="Generate Proposals"
                  >
                    {isGenerating ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ChevronRight size={22} />}
                  </button>
                </div>
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
                    className="text-[9px] font-bold uppercase tracking-[0.2em] px-4 py-2 rounded-full bg-black/5 text-ink/40 hover:text-ink hover:bg-black/10 transition-all"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function OrbControl({ track, onSelect, isReducedMotion }: { track: Track, onSelect: () => void, isReducedMotion: boolean, key?: string }) {
  const size = 100 + (track.volume / 100) * 100;
  const glowIntensity = track.delay * 15;
  
  const getOrbColor = () => {
    switch(track.id) {
      case 'drums': return 'bg-blue-400';
      case 'piano': return 'bg-[#FDF5E6]'; // Cream
      case 'guitar': return 'bg-[#A7F3D0]'; // Mint
      case 'vocals': return 'bg-[#FBCFE8]'; // Pink
      default: return 'bg-zinc-200';
    }
  };

  return (
    <div className="flex flex-col items-center gap-10">
      <button
        onClick={onSelect}
        className="relative group focus:outline-none"
        aria-label={`Select ${track.label} track`}
      >
        {/* Selection Ring */}
        <AnimatePresence>
          {track.selected && (
            <motion.div 
              layoutId="selection-ring"
              className="absolute -inset-12 border border-cobalt/20 rounded-full"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            />
          )}
        </AnimatePresence>

        {/* Reverb Aura */}
        <div 
          className={`absolute -inset-20 rounded-full transition-all duration-1000 blur-[80px] opacity-20 ${
            track.reverb === 'hall' ? 'bg-cobalt/30' : 
            track.reverb === 'room' ? 'bg-cobalt/15' : 
            'bg-transparent'
          }`}
        />

        {/* The Orb */}
        <motion.div
          animate={{
            width: size,
            height: size,
            boxShadow: track.selected 
              ? `0 40px 80px -20px rgba(0, 87, 217, 0.15), 0 0 ${glowIntensity}px rgba(0, 87, 217, ${glowIntensity / 100})`
              : `0 20px 40px -10px rgba(0, 0, 0, 0.05), 0 0 ${glowIntensity}px rgba(0, 87, 217, ${glowIntensity / 200})`,
          }}
          transition={{ type: 'spring', stiffness: 60, damping: 20 }}
          className={`rounded-full relative overflow-hidden flex items-center justify-center transition-all duration-700 border ${
            track.selected ? 'border-cobalt/30' : 'border-black/5 group-hover:border-black/10'
          } ${getOrbColor()}`}
        >
          {/* Inner Fill/Pattern */}
          <div className="absolute inset-0 opacity-30 bg-gradient-to-br from-white to-transparent" />
          
          {/* Delay Glow Ring */}
          {track.delay > 0 && (
            <motion.div 
              animate={isReducedMotion ? {} : { scale: [1, 1.1, 1], opacity: [0.1, 0.2, 0.1] }}
              transition={{ duration: 4 / Math.max(0.1, track.delay), repeat: Infinity }}
              className="absolute inset-0 border-[4px] border-white/30 rounded-full"
            />
          )}
        </motion.div>
      </button>
      
      <div className="text-center">
        <span className={`text-[10px] font-bold tracking-[0.4em] uppercase transition-all duration-500 ${track.selected ? 'text-cobalt' : 'text-ink/20'}`}>
          {track.label}
        </span>
      </div>
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
