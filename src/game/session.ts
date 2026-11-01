// Game rules engine: hit detection, holds, swipes, combo, score. Pure logic, no DOM, fully testable.
// All times are song seconds already corrected for audio/input offsets.
import type { ChartNote, GameMode, Judgment, Lane, SwipeDir } from '../types';
import {
  HOLD_RATE, HOLD_RELEASE_TOLERANCE, POINTS, WINDOWS, accuracyOf, judge, maxScore, medalsFor,
  multiplierFor, starsFor, type Counts, type Medal,
} from './scoring';

export type SwipeMode = 'chord' | 'direction' | 'lane';

export interface RNote extends ChartNote {
  id: number;
  judged: Judgment | null;
  delta?: number;
  holdState?: 'pending' | 'holding' | 'done' | 'broken' | 'missed';
  holdProgress?: number;
  swipePendingAt?: number;
}

export interface SessionEvents {
  onJudge?: (n: RNote, j: Judgment, delta: number) => void;
  onHoldStart?: (n: RNote) => void;
  onHoldEnd?: (n: RNote, completed: boolean) => void;
  onComboBreak?: (combo: number) => void;
  onFail?: (n: RNote) => void;
  onMilestone?: (combo: number) => void;
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
}

export class GameSession {
  readonly notes: RNote[];
  private byLane: RNote[][] = [[], [], []];
  private laneNext = [0, 0, 0];
  private holding: (RNote | null)[] = [null, null, null];
  private pendingSwipe: RNote[] = [];
  private lastDir: { dir: SwipeDir; t: number } | null = null;
  private autoMissIdx = 0;

  score = 0;
  combo = 0;
  maxCombo = 0;
  counts: Counts = { perfectPlus: 0, perfect: 0, great: 0, miss: 0, holdBreaks: 0 };
  failed = false;
  readonly max: number;
  /** Seconds a keyboard lane press waits for its swipe direction (and vice versa). */
  chordWindow = 0.16;
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
  get finished() {
    return this.failed || (this.notes.every((n) => n.judged !== null) && this.holding.every((h) => !h));
  }

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
      if (d < -WINDOWS.great) return null; // too early: ignore the press entirely
      if (d <= WINDOWS.miss) return n;
    }
    return null;
  }

  pressLane(lane: Lane, t: number): RNote | null {
    if (this.failed) return null;
    const n = this.candidate(lane, t);
    if (!n) return null;
    if (n.type === 'swipe') {
      if (this.swipeMode === 'lane') { this.hit(n, t - n.t); return n; }
      if (this.swipeMode === 'direction') return null;
      if (this.lastDir && t - this.lastDir.t <= this.chordWindow) {
        const ok = this.lastDir.dir === n.dir;
        this.lastDir = null;
        if (ok) this.hit(n, t - n.t); else this.miss(n);
        return n;
      }
      if (n.swipePendingAt === undefined) {
        n.swipePendingAt = t;
        this.pendingSwipe.push(n);
      }
      return n;
    }
    this.hit(n, t - n.t);
    if (n.type === 'hold' && n.judged !== 'miss') {
      n.holdState = 'holding';
      this.holding[lane] = n;
      this.events.onHoldStart?.(n);
    }
    return n;
  }

  releaseLane(lane: Lane, t: number): void {
    const h = this.holding[lane];
    if (!h) return;
    const end = h.t + (h.dur ?? 0);
    this.holding[lane] = null;
    if (t >= end - HOLD_RELEASE_TOLERANCE) this.completeHold(h);
    else {
      h.holdState = 'broken';
      this.counts.holdBreaks++;
      this.breakCombo();
      this.events.onHoldEnd?.(h, false);
    }
  }

  /** Keyboard / gamepad direction input (keyboard swipe system). */
  direction(dir: SwipeDir, t: number): RNote[] {
    if (this.failed) return [];
    const hits: RNote[] = [];
    if (this.swipeMode === 'chord') {
      if (this.pendingSwipe.length) {
        for (const n of this.pendingSwipe.splice(0)) {
          if (n.judged !== null) continue;
          if (n.dir === dir) this.hit(n, (n.swipePendingAt ?? t) - n.t); else this.miss(n);
          hits.push(n);
        }
        return hits;
      }
      this.lastDir = { dir, t };
      return hits;
    }
    if (this.swipeMode === 'direction') {
      // every swipe note at the nearest time with this direction
      let best: RNote | null = null;
      for (const n of this.notes) {
        if (n.judged !== null || n.type !== 'swipe' || n.dir !== dir) continue;
        const d = t - n.t;
        if (d < -WINDOWS.great) break;
        if (d <= WINDOWS.miss) { best = n; break; }
      }
      if (best) { this.hit(best, t - best.t); hits.push(best); }
    }
    return hits;
  }

  /** Touch / mouse swipe gesture: lane + direction, timed at touch-down. */
  swipeGesture(lane: Lane, dir: SwipeDir, downT: number): RNote | null {
    if (this.failed) return null;
    const n = this.candidate(lane, downT);
    if (!n || n.type !== 'swipe') return null;
    if (n.dir === dir) this.hit(n, downT - n.t); else this.miss(n);
    return n;
  }

  /** Touch-down on a lane: taps & holds hit immediately; swipe notes wait for the gesture. */
  touchDown(lane: Lane, t: number): { note: RNote | null; awaitingSwipe: boolean } {
    const n = this.candidate(lane, t);
    if (!n) return { note: null, awaitingSwipe: false };
    if (n.type === 'swipe') {
      if (this.swipeMode === 'lane') { this.hit(n, t - n.t); return { note: n, awaitingSwipe: false }; }
      return { note: n, awaitingSwipe: true };
    }
    return { note: this.pressLane(lane, t), awaitingSwipe: false };
  }

  update(t: number): void {
    if (this.failed) return;
    // pending keyboard swipes that never got a direction
    if (this.pendingSwipe.length) {
      this.pendingSwipe = this.pendingSwipe.filter((n) => {
        if (n.judged !== null) return false;
        if (t - (n.swipePendingAt ?? t) > this.chordWindow) { this.miss(n); return false; }
        return true;
      });
    }
    // auto-miss
    while (this.autoMissIdx < this.notes.length && this.notes[this.autoMissIdx].judged !== null) this.autoMissIdx++;
    for (let i = this.autoMissIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > t - WINDOWS.miss) break;
      if (n.judged === null && !(n.swipePendingAt !== undefined && t - n.swipePendingAt <= this.chordWindow)) this.miss(n);
      if (this.failed) return;
    }
    // holds
    for (let l = 0; l < 3; l++) {
      const h = this.holding[l];
      if (!h) continue;
      const end = h.t + (h.dur ?? 0);
      const prog = Math.min(1, Math.max(0, (t - h.t) / (h.dur || 1)));
      const prev = h.holdProgress ?? 0;
      if (prog > prev) {
        const pts = HOLD_RATE * (h.dur ?? 0) * (prog - prev) * this.multiplier;
        this.score += pts;
        h.holdProgress = prog;
      }
      if (t >= end) { this.holding[l] = null; this.completeHold(h); }
    }
  }

  isHolding(lane: Lane) { return this.holding[lane] !== null; }

  private completeHold(h: RNote) {
    const rest = 1 - (h.holdProgress ?? 0);
    if (rest > 0) this.score += HOLD_RATE * (h.dur ?? 0) * rest * this.multiplier;
    h.holdProgress = 1;
    h.holdState = 'done';
    this.score = Math.round(this.score);
    this.events.onHoldEnd?.(h, true);
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
    if (this.combo % 50 === 0) this.events.onMilestone?.(this.combo);
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
    const score = Math.round(this.score);
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
    };
  }
}
