// Objective chart validation: physical playability + synchronisation against the real audio.
import type { Chart, ChartValidation } from '../types';
import type { AnalysisResult } from './analyzer';
import { sampleAt, timeToFrame } from './features';
import { checkPlayable } from './rules';
import { makeRng } from './rng';

/**
 * Measures how strongly note times coincide with audio transients as a function of a global time
 * shift. A correctly synchronised chart peaks at 0 ms.
 */
export function syncProfile(times: number[], res: AnalysisResult, rangeMs = 100, stepMs = 1) {
  const f = res.features;
  const env = res.env.flux;
  const uniq = [...new Set(times)];
  const prof: { ms: number; v: number }[] = [];
  for (let d = -rangeMs; d <= rangeMs; d += stepMs) {
    let s = 0;
    for (const t of uniq) s += sampleAt(env, timeToFrame(f, t + d / 1000));
    prof.push({ ms: d, v: s / (uniq.length || 1) });
  }
  // light smoothing then argmax
  const sm = prof.map((p, i) => ({ ms: p.ms, v: (prof[i - 1]?.v ?? p.v) * 0.25 + p.v * 0.5 + (prof[i + 1]?.v ?? p.v) * 0.25 }));
  let bi = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i].v > sm[bi].v) bi = i;
  let peak = sm[bi].ms;
  if (bi > 0 && bi < sm.length - 1) {
    const y0 = sm[bi - 1].v, y1 = sm[bi].v, y2 = sm[bi + 1].v;
    const den = y0 - 2 * y1 + y2;
    if (den < 0) peak += stepMs * Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  return { peakMs: peak, profile: prof };
}

export function onsetContrast(times: number[], res: AnalysisResult): number {
  const f = res.features;
  const env = res.env.flux;
  const rng = makeRng(1234);
  const uniq = [...new Set(times)];
  let on = 0, off = 0;
  for (const t of uniq) {
    on += sampleAt(env, timeToFrame(f, t));
    // random time within ±(60..250) ms
    const d = (0.06 + rng() * 0.19) * (rng() < 0.5 ? -1 : 1);
    off += sampleAt(env, timeToFrame(f, t + d));
  }
  return on / (off + 1e-9);
}

export function validateChart(chart: Chart, res: AnalysisResult): ChartValidation {
  const times = chart.notes.map((n) => n.t);
  const issues = checkPlayable(chart.notes, chart.difficulty);
  const { peakMs } = syncProfile(times, res);
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 1;
  return {
    syncPeakMs: Math.round(peakMs * 10) / 10,
    onsetContrast: Math.round(onsetContrast(times, res) * 100) / 100,
    playable: issues.length === 0,
    issues,
    noteCount: chart.notes.length,
    nps: Math.round((chart.notes.length / span) * 100) / 100,
  };
}
