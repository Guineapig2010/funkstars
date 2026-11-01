// Note geometry helpers shared by the rules engine, renderer, generator and editor.
import type { ChartNote, Lane, PathPoint, SwipeDir, TileSize } from '../types';

/** Grace window (s) around a switch / rail arrival in which the player may change lanes. */
export const TRANSITION_WINDOW = 0.15;

export const SIZE_SCALE: Record<TileSize, number> = { regular: 1, half: 0.6, micro: 0.38 };
export const sizeOf = (n: ChartNote): TileSize => n.size ?? 'regular';

export function isDiagonal(d?: SwipeDir) { return !!d && d.length > 5; }

export const DIR_VEC: Record<SwipeDir, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  upleft: [-Math.SQRT1_2, -Math.SQRT1_2], upright: [Math.SQRT1_2, -Math.SQRT1_2],
  downleft: [-Math.SQRT1_2, Math.SQRT1_2], downright: [Math.SQRT1_2, Math.SQRT1_2],
};
export const DIR_ARROW: Record<SwipeDir, string> = {
  up: '↑', down: '↓', left: '←', right: '→', upleft: '↖', upright: '↗', downleft: '↙', downright: '↘',
};

/** Does a gesture vector (screen coords, y down) match the target direction? */
export function gestureMatches(target: SwipeDir, dx: number, dy: number): boolean {
  const [tx, ty] = DIR_VEC[target];
  const len = Math.hypot(dx, dy) || 1;
  const cos = (dx * tx + dy * ty) / len;
  // cardinal: within ±45°; diagonal: within ±35° (so the two never overlap ambiguously with the
  // neighbouring cardinal when the target is diagonal, but a sloppy flick still counts)
  return cos >= (isDiagonal(target) ? Math.cos((35 * Math.PI) / 180) : Math.cos((45 * Math.PI) / 180));
}

/** Classify a gesture into the nearest of the 8 directions. */
export function classifyGesture(dx: number, dy: number): SwipeDir {
  let best: SwipeDir = 'up';
  let bc = -2;
  const len = Math.hypot(dx, dy) || 1;
  for (const d of Object.keys(DIR_VEC) as SwipeDir[]) {
    const [tx, ty] = DIR_VEC[d];
    const c = (dx * tx + dy * ty) / len;
    if (c > bc) { bc = c; best = d; }
  }
  return best;
}

/** Combine two cardinal directions into a diagonal (or null). */
export function combineDirs(a: SwipeDir, b: SwipeDir): SwipeDir | null {
  const v = new Set([a, b]);
  if (v.has('up') && v.has('left')) return 'upleft';
  if (v.has('up') && v.has('right')) return 'upright';
  if (v.has('down') && v.has('left')) return 'downleft';
  if (v.has('down') && v.has('right')) return 'downright';
  return null;
}
export function dirParts(d: SwipeDir): SwipeDir[] {
  return isDiagonal(d) ? [d.startsWith('up') ? 'up' : 'down', d.endsWith('left') ? 'left' : 'right'] : [d];
}

export function sortedPath(n: ChartNote): PathPoint[] {
  return (n.path ?? []).filter((p) => p.t > n.t && p.t < n.t + (n.dur ?? 0)).sort((a, b) => a.t - b.t);
}
export function holdKind(n: ChartNote): 'hold' | 'switch' | 'rail' {
  const p = n.path;
  if (!p?.length) return 'hold';
  return p.some((x) => (x.slide ?? 0) > 0) ? 'rail' : 'switch';
}

/** Continuous lane position (0..2) of a hold body at time t (rails interpolate). */
export function holdLanePos(n: ChartNote, t: number): number {
  let lane: number = n.lane;
  for (const p of sortedPath(n)) {
    const s = p.slide ?? 0;
    if (t < p.t) break;
    if (s > 0 && t < p.t + s) return lane + (p.lane - lane) * ((t - p.t) / s);
    lane = p.lane;
  }
  return lane;
}

/** Lanes that count as "on the hold" at time t (both lanes are valid around a transition). */
export function holdValidLanes(n: ChartNote, t: number): Lane[] {
  let lane: Lane = n.lane;
  for (const p of sortedPath(n)) {
    const s = p.slide ?? 0;
    const start = p.t - TRANSITION_WINDOW;
    const end = p.t + s + TRANSITION_WINDOW;
    if (t < start) return [lane];
    if (t <= end) return lane === p.lane ? [lane] : [lane, p.lane];
    lane = p.lane;
  }
  return [lane];
}

/** Final lane of a hold. */
export function holdEndLane(n: ChartNote): Lane {
  const p = sortedPath(n);
  return p.length ? p[p.length - 1].lane : n.lane;
}

/** All lanes a hold occupies. */
export function holdLanes(n: ChartNote): Lane[] {
  return [...new Set([n.lane, ...sortedPath(n).map((p) => p.lane)])];
}
