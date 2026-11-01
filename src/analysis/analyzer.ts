// Full-song music analysis: tempo, beats, downbeats, energy, sections, drops and stages.
import type { SongAnalysis, SongSection } from '../types';
import {
  computeFeatures, frameTime, highpassEnv, normalizeEnv, percentile, smooth, timeToFrame, maxAround, sampleAt,
  type Features,
} from './features';
import { estimateTempo, extendBeats, trackBeats } from './tempo';
import { makeEnvSignature } from './align';

export interface AnalysisResult {
  analysis: SongAnalysis;
  features: Features;
  /** Normalised, locally high-passed onset envelopes (0..~1.5). */
  env: { flux: Float32Array; low: Float32Array; mid: Float32Array; high: Float32Array };
  /** Normalised loudness (0..1) per frame. */
  loud: Float32Array;
}

export interface AnalyzeOptions {
  bpmOverride?: number;
  onProgress?: (p: number, stage: string) => void;
}

export function analyzeAudio(mono: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): AnalysisResult {
  const prog = opts.onProgress ?? (() => {});
  prog(0, 'Extracting spectral features');
  const f = computeFeatures(mono, sampleRate, (p) => prog(p * 0.6, 'Extracting spectral features'));
  const duration = mono.length / sampleRate;
  const w = Math.round(f.rate * 0.35);
  const env = {
    flux: normalizeEnv(highpassEnv(f.flux, w), 99),
    low: normalizeEnv(highpassEnv(f.low, w), 99),
    mid: normalizeEnv(highpassEnv(f.mid, w), 99),
    high: normalizeEnv(highpassEnv(f.high, w), 99),
  };

  // loudness (dB) normalised between the 5th and 99th percentile
  const db = new Float32Array(f.nFrames);
  for (let i = 0; i < f.nFrames; i++) db[i] = 20 * Math.log10(f.rms[i] + 1e-6);
  const dbS = smooth(db, Math.round(f.rate * 0.4));
  const dbHi = percentile(dbS, 99);
  const dbLo = Math.max(percentile(dbS, 5), dbHi - 40);
  const loud = new Float32Array(f.nFrames);
  for (let i = 0; i < f.nFrames; i++) loud[i] = Math.max(0, Math.min(1, (dbS[i] - dbLo) / (dbHi - dbLo || 1)));

  prog(0.62, 'Estimating tempo');
  const beatEnv = new Float32Array(f.nFrames);
  for (let i = 0; i < f.nFrames; i++) beatEnv[i] = env.flux[i] + 0.6 * env.low[i];
  const tempo = opts.bpmOverride
    ? { bpm: opts.bpmOverride, confidence: 1 }
    : estimateTempo(beatEnv, f.rate);

  prog(0.75, 'Tracking beats');
  const beatFrames = trackBeats(beatEnv, f.rate, tempo.bpm);
  let beats = beatFrames.map((b) => frameTime(f, b));
  beats = extendBeats(beats, duration);
  // global fine alignment: shift the whole grid so beats sit on the transients (±30 ms, 0.5 ms steps)
  {
    let bestD = 0, bestV = -1;
    for (let d = -0.03; d <= 0.03 + 1e-9; d += 0.0005) {
      let v = 0;
      for (const b of beats) v += sampleAt(beatEnv, timeToFrame(f, b + d));
      if (v > bestV) { bestV = v; bestD = d; }
    }
    beats = beats.map((b) => b + bestD).filter((b) => b >= 0);
  }
  const intervals = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const bpm = intervals.length ? 60 / intervals[Math.floor(intervals.length / 2)] : tempo.bpm;

  // beat confidence: onset strength on beats vs. halfway between beats
  let on = 0, off = 0;
  for (let i = 0; i < beats.length - 1; i++) {
    on += maxAround(beatEnv, timeToFrame(f, beats[i]), 1.5);
    off += maxAround(beatEnv, timeToFrame(f, (beats[i] + beats[i + 1]) / 2 + (beats[i + 1] - beats[i]) / 4), 1.5);
  }
  const beatConfidence = Math.max(0, Math.min(1, (on - off) / (on + 1e-9) + 0.25));

  // straight vs. triplet feel
  const fracScore = (fr: number) => {
    let v = 0;
    for (let i = 0; i < beats.length - 1; i++) v += maxAround(env.flux, timeToFrame(f, beats[i] + (beats[i + 1] - beats[i]) * fr), 1);
    return v / Math.max(1, beats.length - 1);
  };
  const straight = Math.max(fracScore(0.5), (fracScore(0.25) + fracScore(0.75)) / 2);
  const triplet = (fracScore(1 / 3) + fracScore(2 / 3)) / 2;
  const subdivision: 3 | 4 = triplet > straight * 1.3 ? 3 : 4;

  prog(0.85, 'Finding downbeats & sections');
  const phaseScore = [0, 0, 0, 0];
  beats.forEach((b, i) => {
    const fr = timeToFrame(f, b);
    phaseScore[i % 4] += maxAround(env.low, fr, 2) * 1.0 + maxAround(env.flux, fr, 2) * 0.5;
  });
  const downbeatPhase = phaseScore.indexOf(Math.max(...phaseScore));

  // first/last musical activity
  let firstOnset = 0;
  let lastOnset = duration;
  const audible = (i: number) => dbS[i] > dbHi - 32 && env.flux[i] > 0.04;
  for (let i = 0; i < f.nFrames; i++) if (audible(i)) { firstOnset = frameTime(f, i); break; }
  for (let i = f.nFrames - 1; i >= 0; i--) if (audible(i)) { lastOnset = frameTime(f, i); break; }

  // energy curve every 0.5 s
  const energyStep = 0.5;
  const energy: number[] = [];
  for (let t = 0; t < duration; t += energyStep) {
    const a = Math.max(0, Math.floor(timeToFrame(f, t)));
    const b = Math.min(f.nFrames, Math.ceil(timeToFrame(f, t + energyStep)));
    let s = 0;
    let fx = 0;
    for (let i = a; i < b; i++) { s += loud[i]; fx += env.flux[i]; }
    const c = Math.max(1, b - a);
    energy.push(Math.min(1, (s / c) * 0.75 + Math.min(1, (fx / c) * 3) * 0.25));
  }

  // bars
  const bars: number[] = [];
  for (let i = downbeatPhase; i < beats.length; i += 4) bars.push(beats[i]);
  const energyAt = (t0: number, t1: number) => {
    const a = Math.max(0, Math.floor(t0 / energyStep));
    const b = Math.min(energy.length, Math.max(a + 1, Math.ceil(t1 / energyStep)));
    let s = 0;
    for (let i = a; i < b; i++) s += energy[i];
    return s / Math.max(1, b - a);
  };
  const barE = bars.map((b, i) => energyAt(b, bars[i + 1] ?? b + (bars[1] - bars[0] || 2)));
  const barES = Array.from(smooth(barE, 3));
  const hiThr = percentile(barES, 70);
  const loThr = percentile(barES, 30);

  const drops: number[] = [];
  for (let i = 2; i < bars.length; i++) {
    const prev = (barES[i - 1] + barES[i - 2]) / 2;
    if (barE[i] - prev > 0.18 && barE[i] >= hiThr && bars[i] > firstOnset + 4) {
      if (!drops.length || bars[i] - drops[drops.length - 1] > 12) drops.push(bars[i]);
    }
  }

  const sections: SongSection[] = [];
  let lastKind: SongSection['kind'] | null = null;
  bars.forEach((b, i) => {
    const e = barES[i];
    let kind: SongSection['kind'];
    const isDrop = drops.some((d) => Math.abs(d - b) < 0.05);
    if (b < firstOnset + 1 || (i < bars.length * 0.12 && e < hiThr && !drops.some((d) => d <= b))) kind = 'intro';
    else if (b > lastOnset - 8 && e < hiThr) kind = 'outro';
    else if (isDrop || e >= hiThr) kind = 'drop';
    else if (e <= loThr) kind = 'breakdown';
    else if (i + 2 < bars.length && barES[i + 2] - e > 0.1) kind = 'build';
    else kind = 'verse';
    if (kind !== lastKind) {
      sections.push({ t: b, energy: e, kind });
      lastKind = kind;
    }
  });
  if (!sections.length || sections[0].t > 0) sections.unshift({ t: 0, energy: barES[0] ?? 0.3, kind: 'intro' });

  // five gameplay stages, snapped to bar lines (preferring drops)
  const stages = [0];
  const span = lastOnset - firstOnset;
  for (let k = 1; k < 5; k++) {
    const target = firstOnset + (span * k) / 5;
    let best = target;
    let bestCost = Infinity;
    for (const b of bars) {
      let cost = Math.abs(b - target);
      if (drops.some((d) => Math.abs(d - b) < 0.05)) cost -= (60 / bpm) * 6;
      if (cost < bestCost && b > stages[stages.length - 1] + 4) { bestCost = cost; best = b; }
    }
    stages.push(best);
  }

  // preview: loudest 15 s window, bar aligned
  let previewStart = Math.min(duration * 0.3, Math.max(0, duration - 20));
  let bestE = -1;
  for (const b of bars) {
    if (b + 15 > duration) break;
    const e = energyAt(b, b + 15);
    if (e > bestE + 0.02) { bestE = e; previewStart = b; }
  }

  prog(0.95, 'Building signature');
  const sig = makeEnvSignature(f.flux, f.rate);

  const analysis: SongAnalysis = {
    duration,
    bpm: Math.round(bpm * 100) / 100,
    beats: beats.map((b) => Math.round(b * 10000) / 10000),
    downbeatPhase,
    stages: stages.map((s) => Math.round(s * 1000) / 1000),
    sections,
    drops,
    energy: energy.map((e) => Math.round(e * 1000) / 1000),
    energyStep,
    firstOnset,
    lastOnset,
    previewStart,
    envSig: sig,
    envRate: f.rate,
    beatConfidence: Math.round(beatConfidence * 100) / 100,
    subdivision,
  };
  prog(1, 'Done');
  return { analysis, features: f, env, loud };
}
