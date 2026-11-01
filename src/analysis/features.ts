// Spectral feature extraction: onset envelopes (total + 3 bands), RMS, spectral centroid.
import { FFT } from './fft';

export const ANALYSIS_SR = 22050;
export const FFT_SIZE = 1024;
export const HOP = 256;
/**
 * Timing bias (seconds) of the spectral-flux peak relative to the true onset of a percussive
 * attack, measured on synthetic drum hits (see tests/analysis.test.ts). Added to every frame time.
 */
export const ONSET_BIAS = 0.0034;

export interface Features {
  sr: number;
  hop: number;
  /** Frames per second. */
  rate: number;
  nFrames: number;
  flux: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  rms: Float32Array;
  centroid: Float32Array;
}

/** Frame index -> seconds (bias corrected). */
export function frameTime(f: Features, i: number): number {
  return (i * f.hop) / f.sr + ONSET_BIAS;
}
export function timeToFrame(f: Features, t: number): number {
  return ((t - ONSET_BIAS) * f.sr) / f.hop;
}

/** Downmix arbitrary channels to mono. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const k = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  return out;
}

/** Resample with a simple anti-aliased (box-filtered) linear interpolation. */
export function resample(data: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return data;
  const ratio = srcRate / dstRate;
  const n = Math.floor(data.length / ratio);
  const out = new Float32Array(n);
  if (Number.isInteger(ratio)) {
    const r = ratio;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * r;
      for (let j = 0; j < r; j++) s += data[o + j];
      out[i] = s / r;
    }
    return out;
  }
  // box pre-filter of width ~ratio, then linear interpolation
  const w = Math.max(1, Math.round(ratio));
  let src = data;
  if (w > 1) {
    src = new Float32Array(data.length);
    let acc = 0;
    for (let i = 0; i < data.length; i++) {
      acc += data[i];
      if (i >= w) acc -= data[i - w];
      src[i] = acc / Math.min(i + 1, w);
    }
  }
  const shift = w > 1 ? (w - 1) / 2 : 0;
  for (let i = 0; i < n; i++) {
    const p = i * ratio + shift;
    const i0 = Math.floor(p);
    const fr = p - i0;
    const a = src[i0] ?? 0;
    const b = src[i0 + 1] ?? a;
    out[i] = a + (b - a) * fr;
  }
  return out;
}

export function computeFeatures(mono: Float32Array, sr: number, onProgress?: (p: number) => void): Features {
  const x = resample(mono, sr, ANALYSIS_SR);
  const N = FFT_SIZE;
  const hop = HOP;
  const nFrames = Math.max(1, Math.floor(x.length / hop));
  const fft = new FFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const half = N / 2;
  const prev = new Float32Array(half);
  const cur = new Float32Array(half);

  const flux = new Float32Array(nFrames);
  const low = new Float32Array(nFrames);
  const mid = new Float32Array(nFrames);
  const high = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);
  const centroid = new Float32Array(nFrames);

  const binHz = ANALYSIS_SR / N;
  const lowEnd = Math.round(160 / binHz);
  const midEnd = Math.round(2200 / binHz);
  const cenEnd = Math.round(6000 / binHz);

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop - half;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      const v = idx >= 0 && idx < x.length ? x[idx] : 0;
      re[i] = v * win[i];
      im[i] = 0;
      if (i >= half - hop && i < half + hop) e += v * v;
    }
    rms[f] = Math.sqrt(e / (2 * hop));
    fft.transform(re, im);
    let sl = 0, sm = 0, sh = 0, cw = 0, cs = 0;
    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const lv = Math.log1p(mag * 10);
      cur[k] = lv;
      const d = lv - prev[k];
      if (d > 0) {
        if (k < lowEnd) sl += d;
        else if (k < midEnd) sm += d;
        else sh += d;
      }
      if (k < cenEnd) { cw += mag * k; cs += mag; }
    }
    low[f] = sl;
    mid[f] = sm / 4; // roughly equalise band widths
    high[f] = sh / 12;
    flux[f] = sl + sm / 4 + sh / 12;
    centroid[f] = cs > 1e-9 ? (cw / cs) * binHz : 0;
    prev.set(cur);
    if (onProgress && (f & 1023) === 0) onProgress(f / nFrames);
  }
  // the first frame's flux is meaningless (diff against silence)
  flux[0] = low[0] = mid[0] = high[0] = 0;
  return { sr: ANALYSIS_SR, hop, rate: ANALYSIS_SR / hop, nFrames, flux, low, mid, high, rms, centroid };
}

// ---------- helpers ----------

export function percentile(arr: ArrayLike<number>, p: number): number {
  const a = Array.from(arr).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
  return a[idx];
}

/** Normalise to 0..1 using the given percentile as the ceiling. */
export function normalizeEnv(env: Float32Array, p = 98): Float32Array {
  const top = percentile(env, p) || 1;
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) out[i] = Math.min(1.5, env[i] / top);
  return out;
}

/** Subtract a moving average (window w frames) and half-wave rectify. */
export function highpassEnv(env: Float32Array, w: number): Float32Array {
  const out = new Float32Array(env.length);
  const hw = Math.floor(w / 2);
  // centred moving average using prefix sums
  const pre = new Float64Array(env.length + 1);
  for (let i = 0; i < env.length; i++) pre[i + 1] = pre[i] + env[i];
  for (let i = 0; i < env.length; i++) {
    const a = Math.max(0, i - hw);
    const b = Math.min(env.length, i + hw + 1);
    const m = (pre[b] - pre[a]) / (b - a);
    out[i] = Math.max(0, env[i] - m);
  }
  return out;
}

export function smooth(env: ArrayLike<number>, w: number): Float32Array {
  const n = env.length;
  const out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
  const hw = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - hw);
    const b = Math.min(n, i + hw + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

/** Linear-interpolated sample of an envelope at fractional frame position. */
export function sampleAt(env: ArrayLike<number>, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0) return env[0] ?? 0;
  if (i >= env.length - 1) return env[env.length - 1] ?? 0;
  const fr = pos - i;
  return env[i] * (1 - fr) + env[i + 1] * fr;
}

/** Maximum of an envelope in the window [pos - r, pos + r] frames. */
export function maxAround(env: ArrayLike<number>, pos: number, r: number): number {
  const a = Math.max(0, Math.floor(pos - r));
  const b = Math.min(env.length - 1, Math.ceil(pos + r));
  let m = 0;
  for (let i = a; i <= b; i++) if (env[i] > m) m = env[i];
  return m;
}
