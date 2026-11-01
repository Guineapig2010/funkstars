// Original synthesized sound effects (generated at runtime, no external assets).
import { audio } from './engine';

export type SfxName =
  | 'tap' | 'perfectPlus' | 'swipe' | 'holdEnd' | 'miss' | 'uiMove' | 'uiSelect' | 'uiBack' | 'uiPlay'
  | 'star' | 'achievement' | 'count' | 'countGo' | 'fail' | 'levelUp' | 'combo' | 'stage';

type Gen = (t: number, i: number) => number;

const buffers = new Map<SfxName, AudioBuffer>();
const lastPlay = new Map<SfxName, number>();
let enabledHits = true;

export function setHitSounds(on: boolean) { enabledHits = on; }

function make(ctx: AudioContext, dur: number, gen: Gen, stereo = 0): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.ceil(dur * sr);
  const b = ctx.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  for (let i = 0; i < n; i++) {
    const v = gen(i / sr, i);
    L[i] = v * (1 - stereo * 0.5);
    R[i] = v * (1 + stereo * 0.5);
  }
  // tiny fade-out to avoid clicks
  const f = Math.min(n, Math.round(sr * 0.004));
  for (let i = 0; i < f; i++) { const g = i / f; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  return b;
}

let seed = 7;
const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2147483648) - 1;
const sine = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

function bell(t: number, f: number, d = 0.25) {
  return (sine(f, t) * 0.6 + sine(f * 2.01, t) * 0.25 + sine(f * 3.98, t) * 0.12) * env(t, 0.002, d);
}

export function initSfx() {
  const ctx = audio.ctx;
  if (!ctx || buffers.size) return;
  let lp = 0;
  buffers.set('tap', make(ctx, 0.07, (t) => {
    const f = 2200 * Math.exp(-t * 40) + 700;
    return (sine(f, t) * 0.5 + noise() * 0.15 * Math.exp(-t * 120)) * env(t, 0.0008, 0.018);
  }));
  buffers.set('perfectPlus', make(ctx, 0.28, (t) => {
    const click = (sine(2400 * Math.exp(-t * 40) + 900, t) * 0.4 + noise() * 0.1 * Math.exp(-t * 140)) * env(t, 0.0008, 0.016);
    return click + bell(t, 2637, 0.09) * 0.22 + bell(Math.max(0, t - 0.035), 3951, 0.08) * (t > 0.035 ? 0.16 : 0);
  }, 0.2));
  buffers.set('swipe', make(ctx, 0.2, (t) => {
    const nz = noise();
    const k = 0.15 + 0.8 * (t / 0.2);
    lp = lp + (nz - lp) * k;
    return (nz - lp * 0.6) * 0.35 * Math.sin(Math.PI * Math.min(1, t / 0.2)) * Math.exp(-t * 6);
  }, -0.3));
  buffers.set('holdEnd', make(ctx, 0.35, (t) => bell(t, 1760, 0.12) * 0.3 + bell(t, 2637, 0.1) * 0.18));
  buffers.set('miss', make(ctx, 0.22, (t) => (sine(110 * Math.exp(-t * 6), t) * 0.6 + noise() * 0.12) * env(t, 0.002, 0.06)));
  buffers.set('uiMove', make(ctx, 0.05, (t) => sine(1250, t) * env(t, 0.001, 0.012) * 0.35));
  buffers.set('uiSelect', make(ctx, 0.18, (t) => (t < 0.06 ? sine(880, t) : sine(1320, t)) * env(t % 0.06, 0.002, 0.04) * 0.35));
  buffers.set('uiBack', make(ctx, 0.16, (t) => (t < 0.06 ? sine(990, t) : sine(660, t)) * env(t % 0.06, 0.002, 0.04) * 0.3));
  buffers.set('uiPlay', make(ctx, 0.9, (t) => {
    const rise = 220 * Math.pow(2, t * 2.2);
    const sweep = (sine(rise, t) * 0.25 + sine(rise * 1.5, t) * 0.15) * Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 0.35) * 6);
    const nz = noise() * 0.12 * Math.sin(Math.PI * Math.min(1, t / 0.6));
    const chord = t > 0.4 ? (bell(t - 0.4, 1046.5, 0.3) + bell(t - 0.4, 1318.5, 0.3) + bell(t - 0.4, 1568, 0.3)) * 0.16 : 0;
    return sweep + nz + chord;
  }));
  buffers.set('star', make(ctx, 0.6, (t) => bell(t, 1568, 0.22) * 0.32 + bell(t, 2349, 0.18) * 0.15, 0.2));
  buffers.set('achievement', make(ctx, 1.1, (t) => {
    const notes = [1046.5, 1318.5, 1568, 2093];
    let v = 0;
    notes.forEach((f, k) => { const s = t - k * 0.09; if (s > 0) v += bell(s, f, 0.35) * 0.18; });
    return v;
  }));
  buffers.set('count', make(ctx, 0.15, (t) => sine(880, t) * env(t, 0.002, 0.05) * 0.4));
  buffers.set('countGo', make(ctx, 0.4, (t) => (sine(1760, t) * 0.4 + sine(1318.5, t) * 0.2) * env(t, 0.002, 0.14)));
  buffers.set('fail', make(ctx, 1.0, (t) => (sine(440 * Math.pow(2, -t * 1.6), t) * 0.35 + sine(330 * Math.pow(2, -t * 1.6), t) * 0.2) * env(t, 0.01, 0.35)));
  buffers.set('levelUp', make(ctx, 1.4, (t) => {
    const seq = [784, 988, 1175, 1568];
    let v = 0;
    seq.forEach((f, k) => { const s = t - k * 0.12; if (s > 0) v += (bell(s, f, 0.4) * 0.16 + sine(f / 2, s) * 0.06 * env(s, 0.01, 0.3)); });
    return v;
  }));
  buffers.set('combo', make(ctx, 0.5, (t) => {
    const f = 1200 * Math.pow(2, t * 2);
    return sine(f, t) * 0.18 * env(t, 0.005, 0.15);
  }));
  buffers.set('stage', make(ctx, 1.2, (t) => {
    const nz = noise();
    return nz * 0.08 * Math.sin(Math.PI * Math.min(1, t / 1.2)) + (sine(110, t) * 0.15 + sine(220.5, t) * 0.1) * env(t, 0.05, 0.4);
  }));
}

const HIT_SOUNDS = new Set<SfxName>(['tap', 'perfectPlus', 'swipe', 'holdEnd', 'miss']);

export function playSfx(name: SfxName, gain = 1, rate = 1, when = 0) {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running') return;
  if (!enabledHits && HIT_SOUNDS.has(name)) return;
  if (!buffers.size) initSfx();
  const b = buffers.get(name);
  if (!b) return;
  const now = performance.now();
  if (now - (lastPlay.get(name) ?? 0) < 18) return; // polyphony guard
  lastPlay.set(name, now);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(audio.sfxBus);
  src.start(when || 0);
  src.onended = () => { src.disconnect(); g.disconnect(); };
}
