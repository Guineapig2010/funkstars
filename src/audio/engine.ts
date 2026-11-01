// Web Audio engine: context lifecycle (incl. iOS/Safari unlock), volume buses, decoding,
// sample-accurate music playback and a smoothed audio clock that maps performance.now() to the
// sample currently leaving the speakers.

type AudioCtxCtor = typeof AudioContext;

class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  previewBus!: GainNode;
  private unlocked = false;
  private listeners = new Set<(state: string) => void>();
  musicVolume = 0.85;
  sfxVolume = 0.6;

  /** Create (or resume) the AudioContext. Must be called from a user gesture the first time. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: AudioCtxCtor = (window.AudioContext || (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext);
      // iOS 17+: play through the silent switch like a game/media app
      try { (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback'; } catch { /* unsupported */ }
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // gentle limiter so hit sounds never clip on top of loud masters
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -3; comp.knee.value = 4; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
      comp.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.previewBus = this.ctx.createGain();
      this.musicBus.connect(comp);
      this.sfxBus.connect(comp);
      this.previewBus.connect(comp);
      this.applyVolumes();
      this.ctx.addEventListener('statechange', () => this.listeners.forEach((l) => l(this.ctx!.state)));
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* ignored */ }
    }
    if (!this.unlocked) {
      // a silent buffer kick-starts output on older iOS
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      this.unlocked = true;
    }
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  onStateChange(fn: (state: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // perceptual (squared) curve
    this.musicBus.gain.setTargetAtTime(this.musicVolume * this.musicVolume, t, 0.02);
    this.previewBus.gain.setTargetAtTime(this.musicVolume * this.musicVolume * 0.9, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume * this.sfxVolume, t, 0.02);
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.ctx) await this.unlock();
    const ctx = this.ctx!;
    // Safari < 14.1 only supports the callback form
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
    });
  }

  /** Estimated output latency (s) when getOutputTimestamp is unavailable. */
  outputLatency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    if (!c) return 0;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }

  // ---------- smoothed "heard" clock ----------
  private clockOffset = NaN; // heardCtxTime - perf/1000
  private hasTs = true;

  /** Context time of the sample being heard at performance time `perfMs`. */
  heardTime(perfMs = performance.now()): number {
    const ctx = this.ctx;
    if (!ctx) return perfMs / 1000;
    let measured: number;
    let ts: AudioTimestamp | null = null;
    if (this.hasTs && typeof ctx.getOutputTimestamp === 'function') {
      try { ts = ctx.getOutputTimestamp(); } catch { ts = null; }
    }
    if (ts && ts.contextTime && ts.performanceTime && ts.contextTime > 0) {
      measured = ts.contextTime - ts.performanceTime / 1000;
    } else {
      if (ts === null) this.hasTs = false;
      measured = ctx.currentTime - this.outputLatency() - perfMs / 1000;
    }
    if (ctx.state !== 'running') {
      this.clockOffset = measured;
    } else if (!Number.isFinite(this.clockOffset) || Math.abs(measured - this.clockOffset) > 0.04) {
      this.clockOffset = measured;
    } else {
      this.clockOffset += (measured - this.clockOffset) * 0.04;
    }
    return perfMs / 1000 + this.clockOffset;
  }

  resetClock() { this.clockOffset = NaN; }
}

export const audio = new Engine();

/**
 * Music playback with a song-time clock. Song time 0 = first sample of the buffer; `align` shifts
 * chart time relative to the buffer (decoder alignment) and `userOffset` is the calibrated audio
 * offset. songTime(perf) is what notes are rendered/judged against.
 */
export class MusicPlayer {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private startCtx = 0;
  private startPos = 0;
  private pausedAt = 0;
  playing = false;
  rate = 1;
  align = 0;
  userOffset = 0;
  onEnded?: () => void;

  constructor(public buffer: AudioBuffer) {
    const ctx = audio.ctx!;
    this.gain = ctx.createGain();
    this.gain.connect(audio.musicBus);
  }

  /** Start so that song time `songT` is heard after `delay` seconds (songT may be negative). */
  play(songT: number, delay = 0.12) {
    this.stopSource();
    const ctx = audio.ctx!;
    const bufPos = songT + this.align + this.userOffset;
    const when = ctx.currentTime + delay;
    this.gain.gain.cancelScheduledValues(ctx.currentTime);
    this.gain.gain.setValueAtTime(1, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    if (bufPos >= 0) {
      src.start(when, bufPos);
      this.startCtx = when;
      this.startPos = bufPos;
    } else {
      // lead-in: buffer starts later
      const lead = -bufPos / this.rate;
      src.start(when + lead, 0);
      this.startCtx = when + lead;
      this.startPos = 0;
    }
    src.onended = () => { if (this.src === src) { this.playing = false; this.onEnded?.(); } };
    this.src = src;
    this.playing = true;
    audio.resetClock();
  }

  /** Current song time as heard by the player. */
  songTime(perfMs = performance.now()): number {
    if (!this.playing) return this.pausedAt;
    const heard = audio.heardTime(perfMs);
    return this.startPos + (heard - this.startCtx) * this.rate - this.align - this.userOffset;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.songTime();
    this.stopSource();
    this.playing = false;
  }

  /** Resume from the paused position (exact). */
  resume(delay = 0.08) {
    this.play(this.pausedAt, delay);
  }

  fadeOut(sec: number) {
    const ctx = audio.ctx!;
    this.gain.gain.cancelScheduledValues(ctx.currentTime);
    this.gain.gain.setValueAtTime(this.gain.gain.value, ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + sec);
  }

  private stopSource() {
    if (this.src) {
      try { this.src.onended = null; this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
      this.src = null;
    }
  }

  dispose() {
    this.stopSource();
    this.playing = false;
    this.gain.disconnect();
  }
}
