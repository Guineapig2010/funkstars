// Game rules engine: hit detection, holds (incl. switch / rail holds), swipes (4 + diagonal),
// combo and score. Pure logic, no DOM, fully testable. All times are song seconds already
// corrected for audio/input offsets. Tile size never affects timing windows.
import type { ChartNote, GameMode, Judgment, Lane, SwipeDir } from '../types';
import {
  HOLD_RATE, HOLD_RELEASE_TOLERANCE, POINTS, TRANSITION_POINTS, WINDOWS, accuracyOf, judge, maxScore, medalsFor,
  multiplierFor, starsFor, type Counts, type Medal,
} from './scoring';
import { TRANSITION_WINDOW, combineDirs, dirParts, gestureMatches, holdKind, isDiagonal, sizeOf, sortedPath } from './notes';

export type SwipeMode = 'chord' | 'direction' | 'lane';

export interface RNote extends ChartNote {
  id: number;
  judged: Judgment | null;
  delta?: number;
  holdState?: 'pending' | 'holding' | 'done' | 'broken' | 'missed';
  holdProgress?: number;
  swipePendingAt?: number;
  /** Diagonal keyboard swipes: direction components received so far. */
  dirsGot?: SwipeDir[];
  /** Switch/rail holds: lane currently held and index of the next transition. */
  curLane?: Lane;
  pathIdx?: number;
}

export interface SessionEvents {
  onJudge?: (n: RNote, j: Judgment, delta: number) => void;
  onHoldStart?: (n: RNote) => void;
  onHoldEnd?: (n: RNote, completed: boolean) => void;
  onTransition?: (n: RNote, lane: Lane) => void;
  onComboBreak?: (combo: number) => void;
  onFail?: (n: RNote) => void;
  onMilestone?: (combo: number) => void;
}

export type NoteCategory = 'tap' | 'half' | 'micro' | 'hold' | 'switch' | 'rail' | 'swipe' | 'diagonal';
export const CATEGORY_LABEL: Record<NoteCategory, string> = {
  tap: 'Taps', half: 'Half tiles', micro: 'Microtiles', hold: 'Holds', switch: 'Switch holds', rail: 'Rail holds', swipe: 'Swipes', diagonal: 'Diagonal swipes',
};
export function categoryOf(n: ChartNote): NoteCategory {
  if (n.type === 'hold') return holdKind(n);
  if (n.type === 'swipe') return isDiagonal(n.dir) ? 'diagonal' : 'swipe';
  const s = sizeOf(n);
  return s === 'regular' ? 'tap' : s;
}

export interface SessionResult {
  score: number;
  maxScore: number;
  accuracy: number;
  perfectPlusPct: number;
  counts: Counts;
  maxCombo: number;
  stars: number;
  medals: Medal[];
  completed: boolean;
  failed: boolean;
  totalNotes: number;
  /** Median timing error of the player's presses (ms, + = late) and how many presses it is based on. */
  timingMs: number | null;
  timingSamples: number;
  /** Per note-category totals: [cleanly hit, total]. Holds count as clean only when completed. */
  byType: Partial<Record<NoteCategory, [number, number]>>;
}

export class GameSession {
  readonly notes: RNote[];
  private byLane: RNote[][] = [[], [], []];
  private laneNext = [0, 0, 0];
  private holds: RNote[] = [];
  private down = [0, 0, 0];
  private pendingSwipe: RNote[] = [];
  private recentDirs: { dir: SwipeDir; t: number }[] = [];
  private autoMissIdx = 0;

  score = 0;
  combo = 0;
  maxCombo = 0;
  counts: Counts = { perfectPlus: 0, perfect: 0, great: 0, miss: 0, holdBreaks: 0 };
  failed = false;
  readonly max: number;
  /** Seconds a keyboard lane press waits for its swipe direction (and vice versa). */
  chordWindow = 0.2;
  swipeMode: SwipeMode = 'chord';

  constructor(chart: ChartNote[], public mode: GameMode, public events: SessionEvents = {}) {
    this.notes = [...chart].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n, i) => ({
      ...n, id: i, judged: null, holdState: n.type === 'hold' ? 'pending' : undefined, holdProgress: 0,
    }));
    for (const n of this.notes) this.byLane[n.lane].push(n);
    this.max = maxScore(chart);
  }

  get multiplier() { return multiplierFor(this.combo); }
  get accuracy() { return accuracyOf(this.counts); }
  get judgedCount() { return this.counts.perfectPlus + this.counts.perfect + this.counts.great + this.counts.miss; }
  get lastTime() {
    let m = 0;
    for (const n of this.notes) m = Math.max(m, n.t + (n.dur ?? 0));
    return m;
  }
  get finished() { return this.failed || (this.notes.every((n) => n.judged !== null) && this.holds.length === 0); }
  get activeHolds(): readonly RNote[] { return this.holds; }

  /** Earliest unjudged note in a lane that is inside the hittable window at time t. */
  private candidate(lane: Lane, t: number): RNote | null {
    const list = this.byLane[lane];
    let i = this.laneNext[lane];
    while (i < list.length && list[i].judged !== null) i++;
    this.laneNext[lane] = i;
    for (let k = i; k < list.length; k++) {
      const n = list[k];
      if (n.judged !== null) continue;
      const d = t - n.t;
      if (d < -WINDOWS.early) return null; // far too early: ignore the press
      if (d <= WINDOWS.miss) return n;
    }
    return null;
  }

  /** Is this lane press the player arriving on a switch / rail transition? */
  private transitionTarget(lane: Lane, t: number): RNote | null {
    for (const h of this.holds) {
      const p = sortedPath(h)[h.pathIdx ?? 0];
      if (p && p.lane === lane && t >= p.t - TRANSITION_WINDOW && t <= p.t + (p.slide ?? 0) + TRANSITION_WINDOW) return h;
    }
    return null;
  }

  /** Signed timing errors (s) of the player's presses against the nearest note in that lane. */
  readonly pressDeltas: number[] = [];
  private recordDelta(lane: Lane, t: number) {
    let best = 9;
    for (const n of this.byLane[lane]) {
      const d = t - n.t;
      if (d < -0.4) break;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    if (Math.abs(best) < 0.3) this.pressDeltas.push(best);
  }
  /** Median timing error of recent presses (s); positive = player hits late. */
  medianDelta(last = 0): number | null {
    const a = (last ? this.pressDeltas.slice(-last) : this.pressDeltas).slice().sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  }

  /**
   * Press a lane. `forced` = the tile the player physically touched: it is hit regardless of how far it
   * still is from the PERFECT bar (an early touch grades as GREAT).
   */
  pressLane(lane: Lane, t: number, forced?: RNote | null): RNote | null {
    this.down[lane]++;
    this.recordDelta(lane, t);
    if (this.failed) return null;
    if (!forced && this.transitionTarget(lane, t)) { this.updateHolds(t); return null; }
    const n = forced && forced.judged === null ? forced : this.candidate(lane, t);
    if (!n) return null;
    if (forced && n === forced && t - n.t < -WINDOWS.early) t = n.t - WINDOWS.early;
    if (n.type === 'swipe') {
      if (this.swipeMode === 'lane') { this.hit(n, t - n.t); return n; }
      if (this.swipeMode === 'direction') return null;
      const dir = this.recentDirection(t, n.dir);
      if (dir === 'match') { this.recentDirs = []; this.hit(n, t - n.t); return n; }
      if (dir === 'wrong') { this.recentDirs = []; this.miss(n); return n; }
      if (n.swipePendingAt === undefined) {
        n.swipePendingAt = t;
        n.dirsGot = this.recentDirs.filter((r) => t - r.t <= this.chordWindow).map((r) => r.dir);
        this.recentDirs = [];
        this.pendingSwipe.push(n);
      }
      return n;
    }
    this.hit(n, t - n.t);
    if (n.type === 'hold' && n.judged !== 'miss') {
      n.holdState = 'holding';
      n.curLane = n.lane;
      n.pathIdx = 0;
      this.holds.push(n);
      this.events.onHoldStart?.(n);
    }
    return n;
  }

  /** Directions pressed just before a lane press: complete match, wrong, or still partial. */
  private recentDirection(t: number, target?: SwipeDir): 'match' | 'wrong' | 'partial' | 'none' {
    const recent = this.recentDirs.filter((r) => t - r.t <= this.chordWindow).map((r) => r.dir);
    if (!recent.length || !target) return 'none';
    if (recent.includes(target)) return 'match';
    if (isDiagonal(target)) {
      if (recent.length >= 2 && combineDirs(recent[recent.length - 2], recent[recent.length - 1]) === target) return 'match';
      const parts = dirParts(target);
      return recent.every((d) => parts.includes(d)) ? 'partial' : 'wrong';
    }
    return 'wrong';
  }

  releaseLane(lane: Lane, t: number): void {
    if (this.down[lane] > 0) this.down[lane]--;
    if (this.down[lane] > 0) return;
    for (const h of [...this.holds]) {
      if (h.curLane !== lane) continue;
      const end = h.t + (h.dur ?? 0);
      if (t >= end - HOLD_RELEASE_TOLERANCE) { this.finishHold(h, true); continue; }
      // lifting during a transition window is the player moving to the next lane
      const p = sortedPath(h)[h.pathIdx ?? 0];
      if (p && t >= p.t - TRANSITION_WINDOW) continue;
      this.finishHold(h, false);
    }
  }

  /** A touch dragged from one lane into another. Returns true if it continued a switch/rail hold. */
  slide(from: Lane, to: Lane, t: number): boolean {
    const h = this.holds.find((x) => x.curLane === from);
    const p = h ? sortedPath(h)[h.pathIdx ?? 0] : undefined;
    if (!h || !p || p.lane !== to || t < p.t - TRANSITION_WINDOW * 2) return false;
    this.down[to]++;
    if (this.down[from] > 0) this.down[from]--;
    this.updateHolds(t);
    return true;
  }

  /** Keyboard / gamepad direction input (keyboard swipe system). */
  direction(dir: SwipeDir, t: number): RNote[] {
    if (this.failed) return [];
    const hits: RNote[] = [];
    if (this.swipeMode === 'chord') {
      if (this.pendingSwipe.length) {
        for (const n of [...this.pendingSwipe]) {
          if (n.judged !== null) continue;
          const target = n.dir ?? 'up';
          const got = [...(n.dirsGot ?? []), dir];
          n.dirsGot = got;
          const ok = got.includes(target) || (isDiagonal(target) && got.length >= 2 && combineDirs(got[got.length - 2], got[got.length - 1]) === target);
          if (ok) { this.hit(n, (n.swipePendingAt ?? t) - n.t); hits.push(n); }
          else if (!isDiagonal(target) || !got.every((d) => dirParts(target).includes(d))) { this.miss(n); hits.push(n); }
          else continue; // first half of a diagonal
          this.pendingSwipe = this.pendingSwipe.filter((x) => x !== n);
        }
        return hits;
      }
      this.recentDirs.push({ dir, t });
      if (this.recentDirs.length > 4) this.recentDirs.shift();
      return hits;
    }
    if (this.swipeMode === 'direction') {
      this.recentDirs = [...this.recentDirs.filter((r) => t - r.t <= this.chordWindow), { dir, t }];
      const combo = this.recentDirs.length >= 2 ? combineDirs(this.recentDirs[this.recentDirs.length - 2].dir, dir) : null;
      for (const n of this.notes) {
        if (n.judged !== null || n.type !== 'swipe') continue;
        const d = t - n.t;
        if (d < -WINDOWS.early) break;
        if (d > WINDOWS.miss) continue;
        if (n.dir === dir || (combo && n.dir === combo)) { this.hit(n, d); hits.push(n); this.recentDirs = []; break; }
      }
    }
    return hits;
  }

  /** Touch / mouse swipe gesture (any angle), timed at touch-down. */
  swipeGesture(lane: Lane, dx: number, dy: number, downT: number, forced?: RNote | null): RNote | null {
    if (this.failed) return null;
    const n = forced && forced.judged === null ? forced : this.candidate(lane, downT);
    if (!n || n.type !== 'swipe') return null;
    if (forced && n === forced && downT - n.t < -WINDOWS.early) downT = n.t - WINDOWS.early;
    if (Math.abs(downT - n.t) < 0.3) this.pressDeltas.push(downT - n.t);
    if (gestureMatches(n.dir ?? 'up', dx, dy)) this.hit(n, downT - n.t); else this.miss(n);
    return n;
  }

  /** Touch-down on a lane: taps & holds hit immediately; swipe notes wait for the gesture. */
  touchDown(lane: Lane, t: number, forced?: RNote | null): { note: RNote | null; awaitingSwipe: boolean } {
    if (!this.failed && (forced || !this.transitionTarget(lane, t))) {
      const n = forced && forced.judged === null ? forced : this.candidate(lane, t);
      if (n && n.type === 'swipe' && this.swipeMode !== 'lane') { this.down[lane]++; return { note: n, awaitingSwipe: true }; }
    }
    return { note: this.pressLane(lane, t, forced), awaitingSwipe: false };
  }

  isLaneDown(l: Lane) { return this.down[l] > 0; }

  update(t: number): void {
    if (this.failed) return;
    if (this.pendingSwipe.length) {
      this.pendingSwipe = this.pendingSwipe.filter((n) => {
        if (n.judged !== null) return false;
        if (t - (n.swipePendingAt ?? t) > this.chordWindow) { this.miss(n); return false; }
        return true;
      });
    }
    if (this.recentDirs.length) this.recentDirs = this.recentDirs.filter((r) => t - r.t <= this.chordWindow * 2);
    while (this.autoMissIdx < this.notes.length && this.notes[this.autoMissIdx].judged !== null) this.autoMissIdx++;
    for (let i = this.autoMissIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > t - WINDOWS.miss) break;
      if (n.judged === null && !(n.swipePendingAt !== undefined && t - n.swipePendingAt <= this.chordWindow)) this.miss(n);
      if (this.failed) return;
    }
    this.updateHolds(t);
  }

  private updateHolds(t: number) {
    for (const h of [...this.holds]) {
      const end = h.t + (h.dur ?? 0);
      // transitions
      const path = sortedPath(h);
      let p = path[h.pathIdx ?? 0];
      while (p && t >= p.t - TRANSITION_WINDOW && this.down[p.lane] > 0) {
        h.curLane = p.lane;
        h.pathIdx = (h.pathIdx ?? 0) + 1;
        this.score += TRANSITION_POINTS * this.multiplier;
        this.events.onTransition?.(h, p.lane);
        p = path[h.pathIdx];
      }
      if (p && t > p.t + (p.slide ?? 0) + TRANSITION_WINDOW) { this.finishHold(h, false); continue; }
      const inWindow = p && t >= p.t - TRANSITION_WINDOW;
      if (this.down[h.curLane ?? h.lane] <= 0 && !inWindow) {
        if (t >= end - HOLD_RELEASE_TOLERANCE) this.finishHold(h, true); else this.finishHold(h, false);
        continue;
      }
      const prog = Math.min(1, Math.max(0, (t - h.t) / (h.dur || 1)));
      const prev = h.holdProgress ?? 0;
      if (prog > prev) {
        this.score += HOLD_RATE * (h.dur ?? 0) * (prog - prev) * this.multiplier;
        h.holdProgress = prog;
      }
      if (t >= end) this.finishHold(h, true);
    }
  }

  isHolding(lane: Lane) { return this.holds.some((h) => h.curLane === lane); }

  private finishHold(h: RNote, completed: boolean) {
    this.holds = this.holds.filter((x) => x !== h);
    if (completed) {
      const rest = 1 - (h.holdProgress ?? 0);
      if (rest > 0) this.score += HOLD_RATE * (h.dur ?? 0) * rest * this.multiplier;
      // award any transitions the player was already in position for
      h.holdProgress = 1;
      h.holdState = 'done';
      this.score = Math.round(this.score);
      this.events.onHoldEnd?.(h, true);
    } else {
      h.holdState = 'broken';
      this.counts.holdBreaks++;
      this.breakCombo();
      this.events.onHoldEnd?.(h, false);
    }
  }

  private hit(n: RNote, delta: number) {
    const j = judge(delta) ?? 'miss';
    if (j === 'miss') { this.miss(n); return; }
    n.judged = j;
    n.delta = delta;
    this.counts[j]++;
    this.score += POINTS[j] * this.multiplier;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (this.combo % 25 === 0) this.events.onMilestone?.(this.combo);
    this.events.onJudge?.(n, j, delta);
  }

  private miss(n: RNote) {
    n.judged = 'miss';
    if (n.type === 'hold') n.holdState = 'missed';
    this.counts.miss++;
    this.events.onJudge?.(n, 'miss', 0);
    this.breakCombo();
    if (this.mode === 'classic') {
      this.failed = true;
      this.events.onFail?.(n);
    }
  }

  private breakCombo() {
    if (this.combo > 0) this.events.onComboBreak?.(this.combo);
    this.combo = 0;
  }

  result(): SessionResult {
    const completed = !this.failed;
    const total = this.notes.length;
    const score = Math.min(this.max, Math.round(this.score));
    const byType: SessionResult['byType'] = {};
    for (const n of this.notes) {
      const c = categoryOf(n);
      const e = byType[c] ?? [0, 0];
      e[1]++;
      const clean = n.judged !== null && n.judged !== 'miss' && (n.type !== 'hold' || n.holdState === 'done');
      if (clean) e[0]++;
      byType[c] = e;
    }
    return {
      score,
      maxScore: this.max,
      accuracy: Math.round(this.accuracy * 100) / 100,
      perfectPlusPct: total ? Math.round((this.counts.perfectPlus / total) * 10000) / 100 : 0,
      counts: { ...this.counts },
      maxCombo: this.maxCombo,
      stars: starsFor(score, this.max, completed),
      medals: medalsFor(this.counts, completed),
      completed,
      failed: this.failed,
      totalNotes: total,
      timingMs: this.pressDeltas.length >= 8 ? Math.round((this.medianDelta() ?? 0) * 1000) : null,
      timingSamples: this.pressDeltas.length,
      byType,
    };
  }
}
