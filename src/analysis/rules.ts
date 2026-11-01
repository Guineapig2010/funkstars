// Physical playability rules shared by the generator, the validator and the chart editor.
import type { ChartNote, Difficulty, Lane } from '../types';
import { holdLanes, isDiagonal, sortedPath } from '../game/notes';

const isShort = (n: ChartNote) => n.type === 'tap' && !!n.size && n.size !== 'regular';

export interface PlayRules {
  /** Minimum time between two notes in the same lane (end of previous to next start). */
  laneGap: number;
  /** Minimum time between the end of a hold and the next note in that lane. */
  releaseGap: number;
  /** Minimum time after a swipe before any other note. */
  swipeGapAfter: number;
  /** Minimum time between consecutive note groups. */
  minGap: number;
  maxChord: number;
  /** Minimum spacing between consecutive short tiles (half / micro) — rapid repeats & bursts. */
  rapidGap: number;
}

export const PLAY_RULES: Record<Difficulty, PlayRules> = {
  normal: { laneGap: 0.42, releaseGap: 0.34, swipeGapAfter: 0.42, minGap: 0.3, maxChord: 2, rapidGap: 0.3 },
  hard: { laneGap: 0.22, releaseGap: 0.22, swipeGapAfter: 0.26, minGap: 0.15, maxChord: 2, rapidGap: 0.125 },
  extreme: { laneGap: 0.135, releaseGap: 0.16, swipeGapAfter: 0.19, minGap: 0.1, maxChord: 2, rapidGap: 0.088 },
};

const EPS = 0.0015;

interface Opts {
  allowFinalTriple?: boolean;
  report?: string[];
}

function sortNotes(notes: ChartNote[]) {
  return [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane);
}

/**
 * Returns a cleaned copy of `notes` that satisfies the play rules. If `opts.report` is given the
 * function instead records every violation there (and still returns the cleaned chart).
 */
export function enforcePlayable(input: ChartNote[], diff: Difficulty, opts: Opts = {}): ChartNote[] {
  const R = PLAY_RULES[diff];
  const report = opts.report;
  const notes = sortNotes(input).map((n) => ({ ...n }));
  // merge near-simultaneous notes into exact chords
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].t - notes[i - 1].t < 0.02 && notes[i].t !== notes[i - 1].t) {
      report?.push(`Notes at ${fmt(notes[i].t)} are ${Math.round((notes[i].t - notes[i - 1].t) * 1000)}ms apart (merged into a chord)`);
      notes[i].t = notes[i - 1].t;
    }
  }
  const out: ChartNote[] = [];
  const laneLast: (ChartNote | null)[] = [null, null, null];
  let lastGroupT = -99;
  let lastGroupShort = false;
  let lastSwipeT = -99;
  const lastT = notes.length ? notes[notes.length - 1].t : 0;

  let i = 0;
  while (i < notes.length) {
    const T = notes[i].t;
    const group: ChartNote[] = [];
    while (i < notes.length && notes[i].t === T) group.push(notes[i++]);
    // dedupe lanes
    const seen = new Set<number>();
    const g2 = group.filter((n) => (seen.has(n.lane) ? (report?.push(`Duplicate note in lane ${n.lane + 1} at ${fmt(T)}`), false) : (seen.add(n.lane), true)));

    const groupShort = g2.length === 1 && isShort(g2[0]);
    const gapNeeded = groupShort && lastGroupShort ? R.rapidGap : R.minGap;
    if (T - lastGroupT < gapNeeded - EPS) {
      report?.push(`Notes at ${fmt(T)} follow the previous notes too quickly (${ms(T - lastGroupT)})`);
      continue;
    }
    if (T - lastSwipeT < R.swipeGapAfter - EPS) {
      report?.push(`Note at ${fmt(T)} comes too soon after a swipe (${ms(T - lastSwipeT)})`);
      continue;
    }
    const active = out.filter((n) => n.type === 'hold' && n.t < T - EPS && n.t + (n.dur ?? 0) > T - 0.03);
    const activeHolds = active.length;
    if (active.some((h) => h.path?.length) && g2.length) {
      // nothing may be played while a switch / rail hold is travelling between lanes
      report?.push(`Note at ${fmt(T)} during a switch/rail hold`);
      continue;
    }
    let allowed = R.maxChord - activeHolds;
    if (opts.allowFinalTriple && T === lastT && activeHolds === 0) allowed = 3;
    if (diff === 'normal' && g2.length > 1) for (const n of g2) if (n.type === 'hold') { n.type = 'tap'; delete n.dur; delete n.path; report?.push(`Hold inside a chord at ${fmt(T)} (Normal)`); }
    for (const n of g2) {
      if (n.type !== 'hold') { delete n.path; continue; }
      if (n.type === 'hold' && n.path?.length) {
        // transitions must be reachable: away from the head/tail and from each other
        const ok = sortedPath(n).filter((p, i, arr) => p.t - n.t >= 0.2 && n.t + (n.dur ?? 0) - p.t - (p.slide ?? 0) >= 0.12 && (i === 0 || p.t - arr[i - 1].t - (arr[i - 1].slide ?? 0) >= 0.2));
        if (ok.length !== n.path.length) report?.push(`Switch/rail hold at ${fmt(T)} has unreachable transitions (removed)`);
        if (ok.length) n.path = ok; else delete n.path;
      }
    }
    if (g2.length > 1) for (const n of g2) if (n.path?.length) { delete n.path; report?.push(`Switch/rail hold inside a chord at ${fmt(T)} (made a plain hold)`); }
    if (diff === 'normal') for (const n of g2) if (n.type === 'swipe' && isDiagonal(n.dir)) { n.dir = n.dir!.startsWith('up') ? 'up' : 'down'; report?.push(`Diagonal swipe at ${fmt(T)} (Normal)`); }
    if (activeHolds > 0) {
      for (const n of g2) if (n.type === 'swipe' && diff !== 'extreme') { n.type = 'tap'; delete n.dir; report?.push(`Swipe during a hold at ${fmt(T)}`); }
    }

    const kept: ChartNote[] = [];
    const used = new Set<Lane>();
    for (const n of g2) {
      if (kept.length >= allowed) { report?.push(`Too many simultaneous inputs at ${fmt(T)}`); break; }
      let lane = n.lane;
      const free = (l: Lane) => {
        const p = laneLast[l];
        if (!p) return true;
        if (p.type === 'hold') return T >= p.t + (p.dur ?? 0) + R.releaseGap - EPS;
        if (isShort(p) && isShort(n)) return T >= p.t + R.rapidGap - EPS;
        return T >= p.t + R.laneGap - EPS;
      };
      if (!free(lane)) {
        const p = laneLast[lane]!;
        // try shortening a hold
        if (p.type === 'hold' && T - R.releaseGap - p.t >= 0.3) {
          report?.push(`Hold in lane ${lane + 1} at ${fmt(p.t)} overlaps the next note (shortened)`);
          p.dur = Math.round((T - R.releaseGap - p.t) * 10000) / 10000;
        } else {
          const alt = ([0, 1, 2] as Lane[]).find((l) => l !== lane && !used.has(l) && free(l) && g2.every((o) => o === n || o.lane !== l));
          report?.push(`Lane ${lane + 1} is still busy at ${fmt(T)}${alt !== undefined && g2.length === 1 ? ' (moved)' : ''}`);
          if (alt === undefined || g2.length > 1) continue;
          lane = alt;
        }
      }
      if (used.has(lane)) continue;
      const nn: ChartNote = { ...n, lane };
      if (nn.type === 'hold' && (!nn.dur || nn.dur < 0.15)) { nn.type = 'tap'; delete nn.dur; }
      kept.push(nn);
      used.add(lane);
    }
    if (!kept.length) continue;
    for (const k of kept) {
      out.push(k);
      for (const l of k.type === 'hold' ? holdLanes(k) : [k.lane]) laneLast[l] = k;
      if (k.type === 'swipe') lastSwipeT = T;
    }
    lastGroupT = T;
    lastGroupShort = kept.length === 1 && isShort(kept[0]);
  }
  return out;
}

export function checkPlayable(notes: ChartNote[], diff: Difficulty): string[] {
  const issues: string[] = [];
  enforcePlayable(notes, diff, { report: issues, allowFinalTriple: diff === 'extreme' });
  return issues;
}

export function rateLevel(notes: ChartNote[], diff: Difficulty, duration: number): number {
  if (!notes.length) return 1;
  const times = notes.map((n) => n.t);
  const span = Math.max(10, Math.min(duration, times[times.length - 1] - times[0]));
  const nps = notes.length / span;
  let peak = 0;
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i] - times[j] > 5) j++;
    peak = Math.max(peak, (i - j + 1) / 5);
  }
  const special = notes.filter((n) => n.type !== 'tap').length / notes.length;
  const chords = new Set(times.filter((t, i) => times.indexOf(t) !== i)).size / notes.length;
  const raw = nps * 1.55 + peak * 0.85 + special * 2.2 + chords * 4;
  const range: Record<Difficulty, [number, number]> = { normal: [1, 6], hard: [4, 10], extreme: [7, 15] };
  const [lo, hi] = range[diff];
  return Math.max(lo, Math.min(hi, Math.round(raw)));
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}
function ms(d: number) {
  return `${Math.round(d * 1000)}ms`;
}
