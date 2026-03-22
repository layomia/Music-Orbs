/**
 * Synthetic audio engine using Web Audio API.
 * Generates 4 distinct looping tracks with real-time parameter control.
 */

export class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private tracks: Map<string, {
    gain: GainNode;
    delay: DelayNode;
    delayFeedback: GainNode;
    spaceGain: GainNode;
    spaceDelay: DelayNode;
    spaceFeedback: GainNode;
  }> = new Map();

  private isPlaying: boolean = false;
  private currentStep: number = 0;
  private nextStepTime: number = 0;
  private lookahead: number = 0.1; // 100ms
  private scheduleInterval: number = 25; // 25ms
  private timerId: any = null;
  private noiseBuffer: AudioBuffer | null = null;

  private startTime: number = 0;
  private offsetTime: number = 0;
  private duration: number = 32; // 32 seconds song
  private isLooping: boolean = true;

  private bpm: number = 110;
  private stepDuration: number = 0;

  constructor() {
    this.stepDuration = (60 / this.bpm) / 4; // 1/16th notes
  }

  private initContext() {
    if (!this.context) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        console.error("Web Audio API not supported");
        return;
      }
      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.context.destination);

      // Pre-generate noise buffer
      const bufferSize = this.context.sampleRate * 0.05;
      this.noiseBuffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') {
      this.context.resume().catch(err => console.error("Failed to resume context:", err));
    }
  }

  public setupTrack(id: string) {
    if (this.tracks.has(id)) return;
    this.initContext();
    if (!this.context || !this.masterGain) return;

    const trackGain = this.context.createGain();
    const delayNode = this.context.createDelay(3);
    const delayFeedback = this.context.createGain();
    
    // Space effect (fake reverb)
    const spaceDelay = this.context.createDelay(0.5);
    const spaceFeedback = this.context.createGain();
    const spaceGain = this.context.createGain();

    // Routing
    // Track -> Gain -> Master
    // Track -> Gain -> Delay -> DelayFeedback -> Delay -> Master
    // Track -> Gain -> SpaceGain -> SpaceDelay -> SpaceFeedback -> SpaceDelay -> Master

    trackGain.connect(this.masterGain);
    
    // Delay loop
    trackGain.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(this.masterGain);

    // Space loop
    trackGain.connect(spaceGain);
    spaceGain.connect(spaceDelay);
    spaceDelay.connect(spaceFeedback);
    spaceFeedback.connect(spaceDelay);
    spaceDelay.connect(this.masterGain);

    // Initial values
    delayFeedback.gain.value = 0.3;
    spaceFeedback.gain.value = 0.5;
    spaceGain.gain.value = 0; // Dry by default

    this.tracks.set(id, {
      gain: trackGain,
      delay: delayNode,
      delayFeedback,
      spaceGain,
      spaceDelay,
      spaceFeedback
    });
  }

  public updateTrack(id: string, volume: number, delayTime: number, reverb: string) {
    const track = this.tracks.get(id);
    if (!track || !this.context) return;

    // Ensure context is running to apply changes
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    const now = this.context.currentTime;
    
    // Volume (0-100 -> 0-1)
    const safeVolume = isNaN(volume) ? 0.7 : Math.min(100, Math.max(0, volume)) / 100;
    track.gain.gain.setTargetAtTime(safeVolume, now, 0.05);
    
    // Delay (0-3s)
    const safeDelay = isNaN(delayTime) ? 0 : Math.min(3, Math.max(0, delayTime));
    track.delay.delayTime.setTargetAtTime(safeDelay, now, 0.05);
    track.delayFeedback.gain.setTargetAtTime(safeDelay > 0 ? 0.4 : 0, now, 0.05);

    // Reverb/Space
    let spaceLevel = 0;
    let spaceTime = 0.05;
    let spaceFb = 0.3;

    if (reverb === 'room') {
      spaceLevel = 0.3;
      spaceTime = 0.08;
      spaceFb = 0.5;
    } else if (reverb === 'hall') {
      spaceLevel = 0.6;
      spaceTime = 0.25;
      spaceFb = 0.7;
    }

    track.spaceGain.gain.setTargetAtTime(spaceLevel, now, 0.05);
    track.spaceDelay.delayTime.setTargetAtTime(spaceTime, now, 0.05);
    track.spaceFeedback.gain.setTargetAtTime(spaceFb, now, 0.05);
  }

  private scheduleNote(trackId: string, time: number, step: number) {
    if (!this.context) return;
    const track = this.tracks.get(trackId);
    if (!track) return;

    switch (trackId) {
      case 'drums':
        this.playKick(time, step);
        this.playHiHat(time, step);
        break;
      case 'piano':
        this.playPiano(time, step);
        break;
      case 'guitar':
        this.playGuitar(time, step);
        break;
      case 'vocals':
        this.playVocals(time, step);
        break;
    }
  }

  private playKick(time: number, step: number) {
    if (step % 4 !== 0 || !this.context) return;
    const track = this.tracks.get('drums');
    if (!track) return;
    
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);
    
    env.gain.setValueAtTime(1, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    
    osc.connect(env);
    env.connect(track.gain);
    
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private playHiHat(time: number, step: number) {
    if (step % 2 === 0 || !this.context || !this.noiseBuffer) return;
    const track = this.tracks.get('drums');
    if (!track) return;
    
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    
    const filter = this.context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    
    const env = this.context.createGain();
    env.gain.setValueAtTime(0.2, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    source.connect(filter);
    filter.connect(env);
    env.connect(track.gain);
    
    source.start(time);
    source.stop(time + 0.05);
  }

  private playPiano(time: number, step: number) {
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    if (step % 4 === 2 || step % 8 === 0) {
      const freq = notes[step % notes.length];
      this.playPluck(time, freq, 'triangle', 0.4, 'piano');
    }
  }

  private playGuitar(time: number, step: number) {
    const notes = [196.00, 246.94, 293.66, 392.00]; // G3, B3, D4, G4
    if (step % 3 === 0) {
      const freq = notes[(step / 3) % notes.length];
      this.playPluck(time, freq, 'sawtooth', 0.3, 'guitar', 2000);
    }
  }

  private playVocals(time: number, step: number) {
    if (step % 16 === 0) {
      const freq = 440; // A4
      const track = this.tracks.get('vocals');
      if (!track || !this.context) return;
      
      const osc = this.context.createOscillator();
      const env = this.context.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.2, time + 1);
      osc.frequency.exponentialRampToValueAtTime(freq, time + 2);
      
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.3, time + 0.5);
      env.gain.linearRampToValueAtTime(0.3, time + 1.5);
      env.gain.linearRampToValueAtTime(0, time + 2);
      
      osc.connect(env);
      env.connect(track.gain);
      
      osc.start(time);
      osc.stop(time + 2);
    }
  }

  private playPluck(time: number, freq: number, type: OscillatorType, volume: number, trackId: string, filterFreq?: number) {
    if (!this.context) return;
    const track = this.tracks.get(trackId);
    if (!track) return;
    
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    
    env.gain.setValueAtTime(volume, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    
    let lastNode: AudioNode = env;
    if (filterFreq) {
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      env.connect(filter);
      lastNode = filter;
    }
    
    osc.connect(env);
    lastNode.connect(track.gain);
    
    osc.start(time);
    osc.stop(time + 0.5);
  }

  private scheduler() {
    if (!this.context) return;
    while (this.nextStepTime < this.context.currentTime + this.lookahead) {
      this.tracks.forEach((_, id) => {
        this.scheduleNote(id, this.nextStepTime, this.currentStep);
      });
      this.nextStepTime += this.stepDuration;
      this.currentStep = (this.currentStep + 1) % 16;
      
      // Update offsetTime periodically to keep it accurate
      this.offsetTime = this.context.currentTime - this.startTime;
      if (this.offsetTime >= this.duration) {
        if (this.isLooping) {
          // Auto-loop: shift the start time forward by one duration to create a seamless loop
          this.startTime += this.duration;
          this.offsetTime -= this.duration;
        } else {
          this.stop();
        }
      }
    }
  }

  public play() {
    this.initContext();
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.startTime = this.context!.currentTime - this.offsetTime;
    this.nextStepTime = this.context!.currentTime + 0.05;
    this.timerId = setInterval(() => this.scheduler(), this.scheduleInterval);
  }

  public pause() {
    this.isPlaying = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.context) {
      this.offsetTime = this.context.currentTime - this.startTime;
    }
  }

  public stop() {
    this.pause();
    this.offsetTime = 0;
    this.currentStep = 0;
  }

  public seek(time: number) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    
    this.offsetTime = Math.min(this.duration, Math.max(0, time));
    
    // Calculate currentStep based on time within the 16-step loop
    const loopDuration = 16 * this.stepDuration;
    const timeInLoop = this.offsetTime % loopDuration;
    this.currentStep = Math.floor(timeInLoop / this.stepDuration);
    
    if (wasPlaying) this.play();
  }

  public getCurrentTime() {
    if (!this.context) return this.offsetTime % this.duration;
    if (this.isPlaying) {
      const time = this.context.currentTime - this.startTime;
      return time % this.duration;
    }
    return this.offsetTime % this.duration;
  }

  public getDuration() {
    return this.duration;
  }

  public isPlayingStatus() {
    return this.isPlaying;
  }

  public setLooping(loop: boolean) {
    this.isLooping = loop;
  }
}

export const audioEngine = new AudioEngine();
