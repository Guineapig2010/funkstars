// Tempo estimation (autocorrelation + comb refinement) and dynamic-programming beat tracking.
import { sampleAt } from './features';

export interface TempoResult {
  bpm: number;
  confidence: number;
}

export function estimateTempo(env: Float32Array, rate: number, minBpm = 60, maxBpm = 180, centerBpm = 100): TempoResult {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = env[i] - mean;

  const minLag = Math.floor((rate * 60) / (maxBpm * 1.02));
  const maxLag = Math.ceil((rate * 60) / (minBpm * 0.98)) * 8 + 4;
  const ac = new Float32Array(maxLag + 1);
  for (let L = 1; L <= maxLag && L < n; L++) {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += e[i] * e[i + L];
    ac[L] = s / (n - L);
  }
  const acAt = (l: number) => sampleAt(ac, l);
  let best = -Infinity;
  let bestLag = minLag;
  const lagHi = Math.ceil((rate * 60) / minBpm);
  for (let L = minLag; L <= lagHi; L++) {
    const bpm = (rate * 60) / L;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / centerBpm) / 0.85, 2));
    // beat + half-bar + bar + two-bar periodicity: robust to syncopated (3-3-2) funk patterns
    const s = (acAt(L) + 0.5 * acAt(2 * L) + 0.9 * acAt(4 * L) + 0.45 * acAt(8 * L) + 0.3 * acAt(L / 2)) * (0.5 + prior);
    if (s > best) { best = s; bestLag = L; }
  }
  // parabolic refinement
  const y0 = acAt(bestLag - 1), y1 = acAt(bestLag), y2 = acAt(bestLag + 1);
  const den = y0 - 2 * y1 + y2;
  const lag = den !== 0 ? bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : bestLag;
  const bpm = (rate * 60) / lag;
  const conf = ac[0] !== undefined && ac[1] ? Math.max(0, Math.min(1, y1 / (Math.abs(ac[1]) + 1e-9))) : 0.5;
  return { bpm: refineBpm(env, rate, bpm), confidence: conf };
}

/** Fine-tune BPM by maximising a comb (beat grid) score across the whole song. */
export function refineBpm(env: Float32Array, rate: number, bpm: number): number {
  let bestScore = -Infinity;
  let bestBpm = bpm;
  for (let k = -40; k <= 40; k++) {
    const b = bpm * (1 + k * 0.0004);
    const period = (rate * 60) / b;
    const steps = Math.max(8, Math.round(period * 2));
    for (let ph = 0; ph < steps; ph++) {
      const phase = (ph / steps) * period;
      let s = 0;
      let c = 0;
      for (let p = phase; p < env.length - 1; p += period) {
        s += sampleAt(env, p);
        c++;
      }
      s /= c || 1;
      if (s > bestScore) { bestScore = s; bestBpm = b; }
    }
  }
  return bestBpm;
}

/**
 * Ellis-style dynamic-programming beat tracker. Returns beat positions in (fractional) frames,
 * smoothed with a sliding local linear fit to remove frame quantisation while allowing gradual
 * tempo changes.
 */
export function trackBeats(env: Float32Array, rate: number, bpm: number, tightness = 60): number[] {
  const n = env.length;
  const P = (rate * 60) / bpm;
  let mx = 0;
  for (let i = 0; i < n; i++) mx = Math.max(mx, env[i]);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = env[i] / (mx || 1);
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(P / 2);
  const hi = Math.round(P * 2);
  const penalty = new Float32Array(hi + 1);
  for (let d = 1; d <= hi; d++) penalty[d] = -tightness * Math.pow(Math.log(d / P), 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let bi = -1;
    for (let d = lo; d <= hi; d++) {
      const tau = t - d;
      if (tau < 0) break;
      const v = score[tau] + penalty[d];
      if (v > best || bi < 0) { best = v; bi = tau; }
    }
    score[t] = o[t] + (bi >= 0 ? Math.max(0, best) : 0);
    back[t] = bi >= 0 && best > 0 ? bi : -1;
  }
  // best ending in the last period
  let lastActive = n - 1;
  while (lastActive > 0 && o[lastActive] < 0.15) lastActive--;
  let end = lastActive;
  let bestEnd = -Infinity;
  const ws = Math.max(0, lastActive - Math.round(P));
  const we = Math.min(n - 1, lastActive + Math.round(P / 4));
  for (let t = ws; t <= we; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t; }
  const raw: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    raw.push(t);
    if (back[t] < 0) break;
  }
  raw.reverse();
  // sub-frame refine each beat on the envelope peak (parabolic)
  const refined = raw.map((t) => {
    let best = t;
    for (let d = -2; d <= 2; d++) if (o[t + d] > o[best]) best = t + d;
    const y0 = o[best - 1] ?? 0, y1 = o[best], y2 = o[best + 1] ?? 0;
    const den = y0 - 2 * y1 + y2;
    return den < 0 ? best + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : best;
  });
  return smoothBeats(refined, P);
}

/** Replace each beat by a local robust linear fit over its neighbours. */
export function smoothBeats(beats: number[], P: number, half = 8): number[] {
  if (beats.length < 4) return beats;
  // re-index: assume beats are consecutive; detect doubled/skipped beats and fix spacing
  const fixed: number[] = [beats[0]];
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i] - fixed[fixed.length - 1];
    if (gap < P * 0.6) continue; // spurious
    const k = Math.round(gap / P);
    if (k >= 2) for (let j = 1; j < k; j++) fixed.push(fixed[fixed.length - 1] + gap / k);
    fixed.push(beats[i]);
  }
  const out: number[] = [];
  for (let i = 0; i < fixed.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(fixed.length - 1, i + half);
    // two passes: fit, drop outliers, refit
    let fit = linFit(fixed, a, b, null);
    const resid: number[] = [];
    for (let j = a; j <= b; j++) resid.push(Math.abs(fixed[j] - (fit.m * j + fit.c)));
    const sorted = [...resid].sort((x, y) => x - y);
    const thr = Math.max(1.0, sorted[Math.floor(sorted.length * 0.7)] * 2);
    const mask = resid.map((r) => r <= thr);
    fit = linFit(fixed, a, b, mask);
    out.push(fit.m * i + fit.c);
  }
  return out;
}

function linFit(y: number[], a: number, b: number, mask: boolean[] | null) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let j = a; j <= b; j++) {
    if (mask && !mask[j - a]) continue;
    sx += j; sy += y[j]; sxx += j * j; sxy += j * y[j]; n++;
  }
  const den = n * sxx - sx * sx;
  const m = den !== 0 ? (n * sxy - sx * sy) / den : 0;
  const c = (sy - m * sx) / (n || 1);
  return { m, c };
}

/** Extend a beat list (seconds) backwards to 0 and forwards to `end` using the edge periods. */
export function extendBeats(beats: number[], end: number): number[] {
  if (beats.length < 2) return beats;
  const out = [...beats];
  const p0 = (out[Math.min(8, out.length - 1)] - out[0]) / Math.min(8, out.length - 1);
  while (out[0] - p0 > -0.0001) out.unshift(out[0] - p0);
  if (out[0] < 0) out.shift();
  const k = Math.min(8, out.length - 1);
  const p1 = (out[out.length - 1] - out[out.length - 1 - k]) / k;
  while (out[out.length - 1] + p1 < end + p1) out.push(out[out.length - 1] + p1);
  return out;
}

/**
 * Most produced music runs at one fixed tempo. If the tracked beats fit a single constant grid
 * (≥ 80% of beats within ±15 ms), replace them with that exact grid so every beat is perfectly even
 * and local tracker wobble (breakdowns, outros) disappears. Otherwise the beats are returned as-is.
 */
export function lockGrid(beats: number[], end: number): { beats: number[]; locked: boolean } {
  if (beats.length < 16) return { beats, locked: false };
  let mask: boolean[] | null = null;
  let fit = linFit(beats, 0, beats.length - 1, null);
  for (const tol of [0.06, 0.03, 0.015]) {
    mask = beats.map((b, i) => Math.abs(b - (fit.m * i + fit.c)) <= tol);
    if (mask.filter(Boolean).length < beats.length * 0.5) return { beats, locked: false };
    fit = linFit(beats, 0, beats.length - 1, mask);
  }
  const inl = beats.filter((b, i) => Math.abs(b - (fit.m * i + fit.c)) <= 0.015).length / beats.length;
  if (inl < 0.8 || fit.m <= 0) return { beats, locked: false };
  const out: number[] = [];
  const i0 = Math.ceil(-fit.c / fit.m);
  for (let i = i0; fit.m * i + fit.c <= end + 1e-6; i++) out.push(fit.m * i + fit.c);
  return { beats: out, locked: true };
}
