// Scoring rules: judgement windows, points, multipliers, stars and medals.
import type { ChartNote, Judgment } from '../types';

/** Judgement windows in seconds (absolute timing error). */
export const WINDOWS = {
  perfectPlus: 0.045,
  perfect: 0.09,
  /** Late side: anything up to this after the note is still a GREAT; later is a miss. */
  great: 0.18,
  /** Notes are auto-missed this long after their time. */
  miss: 0.18,
  /** Early side: a tap this early still hits the tile (as GREAT). Earlier taps are ignored. */
  early: 0.25,
};

export const POINTS: Record<Judgment, number> = { perfectPlus: 100, perfect: 80, great: 40, miss: 0 };
export const ACC_WEIGHT: Record<Judgment, number> = { perfectPlus: 1, perfect: 0.9, great: 0.5, miss: 0 };
/** Points (before multiplier) for each switch / rail transition reached in time. */
export const TRANSITION_POINTS = 50;
/** Hold body points per second (before multiplier). */
export const HOLD_RATE = 60;
/** Releasing within this time before a hold's end counts as completed. */
export const HOLD_RELEASE_TOLERANCE = 0.12;

export function judge(delta: number): Judgment | null {
  const a = Math.abs(delta);
  if (a <= WINDOWS.perfectPlus) return 'perfectPlus';
  if (a <= WINDOWS.perfect) return 'perfect';
  if (delta < 0 ? a <= WINDOWS.early : a <= WINDOWS.great) return 'great';
  return 'miss';
}

export function multiplierFor(combo: number): number {
  if (combo >= 60) return 4;
  if (combo >= 30) return 3;
  if (combo >= 10) return 2;
  return 1;
}

/** Theoretical maximum score: every note Perfect+, every hold fully held, no combo breaks. */
export function maxScore(notes: ChartNote[]): number {
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  let combo = 0;
  let total = 0;
  for (const n of sorted) {
    const m = multiplierFor(combo);
    total += POINTS.perfectPlus * m;
    combo++;
    if (n.type === 'hold' && n.dur) {
      total += HOLD_RATE * n.dur * multiplierFor(combo);
      total += (n.path?.length ?? 0) * TRANSITION_POINTS * multiplierFor(combo);
    }
  }
  return Math.round(total);
}

export const STAR_THRESHOLDS = [0.3, 0.5, 0.7, 0.85, 0.95];

export function starsFor(score: number, max: number, completed: boolean): number {
  if (!completed || max <= 0) return 0;
  const r = score / max;
  let s = 0;
  for (const t of STAR_THRESHOLDS) if (r >= t) s++;
  return Math.max(1, s);
}

export type Medal = 'fc' | 'ap' | 'app';
export const MEDAL_INFO: Record<Medal, { name: string; short: string; color: string }> = {
  fc: { name: 'Full Combo', short: 'FC', color: '#4df3ff' },
  ap: { name: 'All Perfect', short: 'AP', color: '#ffd23f' },
  app: { name: 'All Perfect+', short: 'AP+', color: '#ff6ef3' },
};

export interface Counts { perfectPlus: number; perfect: number; great: number; miss: number; holdBreaks: number }

export function medalsFor(c: Counts, completed: boolean): Medal[] {
  if (!completed) return [];
  const out: Medal[] = [];
  if (c.miss === 0 && c.holdBreaks === 0) {
    out.push('fc');
    if (c.great === 0) out.push('ap');
    if (c.great === 0 && c.perfect === 0) out.push('app');
  }
  return out;
}

export function accuracyOf(c: Counts): number {
  const n = c.perfectPlus + c.perfect + c.great + c.miss;
  if (!n) return 100;
  return ((c.perfectPlus * ACC_WEIGHT.perfectPlus + c.perfect * ACC_WEIGHT.perfect + c.great * ACC_WEIGHT.great) / n) * 100;
}
