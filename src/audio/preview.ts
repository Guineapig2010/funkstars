// Menu song previews: decoded once (shared cache with gameplay), looped with fades, beat-synced pulse.
import { audio } from './engine';
import { loadSongBuffer } from '../store/songs';
import type { SongMeta } from '../types';

const PREVIEW_LEN = 18;

class Preview {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private currentId: string | null = null;
  private startCtx = 0;
  private bpm = 120;
  private token = 0;
  private loopTimer = 0;

  get playingId() { return this.currentId; }

  async play(meta: SongMeta) {
    if (this.currentId === meta.id) return;
    const token = ++this.token;
    this.stop(0.35);
    this.currentId = meta.id;
    if (!audio.ready) return;
    let buf: AudioBuffer;
    try { buf = await loadSongBuffer(meta); } catch { return; }
    if (token !== this.token || !audio.ctx) return;
    this.bpm = meta.bpm || 120;
    this.startLoop(buf, meta.previewStart, token);
  }

  private startLoop(buf: AudioBuffer, at: number, token: number) {
    const ctx = audio.ctx!;
    const g = ctx.createGain();
    g.connect(audio.previewBus);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    const now = ctx.currentTime + 0.03;
    const start = Math.max(0, Math.min(at, buf.duration - PREVIEW_LEN - 0.5));
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 0.8);
    g.gain.setValueAtTime(1, now + PREVIEW_LEN - 1.5);
    g.gain.linearRampToValueAtTime(0, now + PREVIEW_LEN);
    src.start(now, start, PREVIEW_LEN + 0.1);
    this.src = src; this.gain = g; this.startCtx = now;
    clearTimeout(this.loopTimer);
    this.loopTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      try { src.disconnect(); g.disconnect(); } catch { /* ignore */ }
      this.startLoop(buf, at, token);
    }, PREVIEW_LEN * 1000);
  }

  stop(fade = 0.3) {
    this.token++;
    clearTimeout(this.loopTimer);
    this.currentId = null;
    const src = this.src, g = this.gain;
    this.src = null; this.gain = null;
    if (src && g && audio.ctx) {
      const t = audio.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
      try { src.stop(t + fade + 0.05); } catch { /* ignore */ }
      setTimeout(() => { try { src.disconnect(); g.disconnect(); } catch { /* ignore */ } }, (fade + 0.2) * 1000);
    }
  }

  /** 0..1 pulse envelope following the preview's beat. */
  pulse(): number {
    if (!this.src || !audio.ctx) return 0;
    const t = audio.heardTime() - this.startCtx;
    if (t < 0) return 0;
    const beat = 60 / this.bpm;
    const ph = (t % beat) / beat;
    return Math.exp(-ph * beat * 9) * 0.55;
  }
}

export const preview = new Preview();
