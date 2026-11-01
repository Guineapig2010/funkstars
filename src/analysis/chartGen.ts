// Music-driven chart generation. Notes are placed on beat-grid slots ranked by the strength of
// real audio transients (kick / snare / hats / melodic onsets), with density following the song's
// energy and the five gameplay stages. Lanes follow the melodic contour (spectral centroid).
import type { Chart, ChartNote, Difficulty, Lane, SongAnalysis, SwipeDir } from '../types';
import type { AnalysisResult } from './analyzer';
import { maxAround, timeToFrame, sampleAt, frameTime } from './features';
import { hashString, makeRng } from './rng';
import { enforcePlayable, PLAY_RULES, rateLevel } from './rules';

interface GenParams {
  baseNps: number;
  stageMult: number[];
  /** Max metrical depth: 2 = eighths, 3 = sixteenths. */
  maxLevel: number;
  /** Salience required for an eighth / sixteenth slot. */
  eighthThr: number;
  sixteenthThr: number;
  minGap: number;
  maxGapBeats: number;
  holdChance: number;
  holdMinGap: number;
  overlapHoldChance: number;
  swipeChance: number;
  doubleChance: number;
  doubleQuantile: number;
}

const PARAMS: Record<Difficulty, GenParams> = {
  normal: {
    baseNps: 1.15, stageMult: [0.8, 0.9, 1.0, 1.08, 1.18], maxLevel: 2, eighthThr: 0.5, sixteenthThr: 9,
    minGap: 0.36, maxGapBeats: 4, holdChance: 0.6, holdMinGap: 1.15, overlapHoldChance: 0,
    swipeChance: 0.07, doubleChance: 0.5, doubleQuantile: 0.985,
  },
  hard: {
    baseNps: 2.15, stageMult: [0.78, 0.9, 1.0, 1.1, 1.22], maxLevel: 3, eighthThr: 0.18, sixteenthThr: 0.62,
    minGap: 0.18, maxGapBeats: 3, holdChance: 0.5, holdMinGap: 0.8, overlapHoldChance: 0.18,
    swipeChance: 0.1, doubleChance: 0.55, doubleQuantile: 0.93,
  },
  extreme: {
    baseNps: 3.3, stageMult: [0.8, 0.92, 1.0, 1.12, 1.26], maxLevel: 3, eighthThr: 0.08, sixteenthThr: 0.3,
    minGap: 0.115, maxGapBeats: 2, holdChance: 0.45, holdMinGap: 0.62, overlapHoldChance: 0.3,
    swipeChance: 0.13, doubleChance: 0.6, doubleQuantile: 0.86,
  },
};

interface Slot {
  t: number;
  beat: number;
  level: number; // 0 downbeat, 1 beat, 2 eighth, 3 sixteenth
  sal: number;
  loud: number;
  score: number;
  high: number;
  low: number;
}

interface Ev {
  t: number;
  slot: Slot;
  lane: Lane;
  type: 'tap' | 'hold' | 'swipe';
  dur?: number;
  dir?: SwipeDir;
  partner?: { lane: Lane; type: 'tap' | 'swipe'; dir?: SwipeDir };
  triple?: boolean;
}

export const GENERATOR_VERSION = 'funkstars-chartgen/1.2';

export function generateCharts(res: AnalysisResult, songId: string): Record<Difficulty, Chart> {
  return {
    normal: generateChart(res, songId, 'normal'),
    hard: generateChart(res, songId, 'hard'),
    extreme: generateChart(res, songId, 'extreme'),
  };
}

export function generateChart(res: AnalysisResult, songId: string, diff: Difficulty): Chart {
  const P = PARAMS[diff];
  const rules = PLAY_RULES[diff];
  const A = res.analysis;
  const f = res.features;
  const env = res.env;
  const rng = makeRng(hashString(songId + ':' + diff));
  const beats = A.beats;
  const beatLen = 60 / A.bpm;

  // ---------- 1. candidate slots ----------
  const slots: Slot[] = [];
  const endT = Math.min(A.lastOnset + 0.25, A.duration - 0.4);
  for (let i = 0; i < beats.length - 1; i++) {
    const b0 = beats[i];
    const b1 = beats[i + 1];
    const sub = A.subdivision === 3 ? 6 : 4;
    for (let k = 0; k < sub; k++) {
      const t = b0 + ((b1 - b0) * k) / sub;
      if (t < Math.max(0.6, A.firstOnset - 0.03) || t > endT) continue;
      const isDown = (i - A.downbeatPhase) % 4 === 0;
      const level = k === 0 ? (isDown ? 0 : 1) : (sub === 4 ? k === 2 : k % 2 === 0) ? 2 : 3;
      if (level > P.maxLevel) continue;
      const fr = timeToFrame(f, t);
      const o = maxAround(env.flux, fr, 2);
      const l = maxAround(env.low, fr, 2);
      const m = maxAround(env.mid, fr, 2);
      const h = maxAround(env.high, fr, 2);
      const sal = 0.5 * o + 0.3 * l + 0.18 * m + 0.12 * h;
      const loud = sampleAt(res.loud, fr);
      if (loud < 0.06) continue;
      if (level === 2 && sal < P.eighthThr) continue;
      if (level === 3 && sal < P.sixteenthThr) continue;
      const bonus = [0.32, 0.22, 0.08, 0][level];
      const score = sal + bonus * (0.45 + 0.55 * loud) + rng() * 0.015;
      slots.push({ t, beat: i, level, sal, loud, score, high: h, low: l });
    }
  }

  // ---------- 2. density-targeted selection per stage ----------
  const stages = A.stages;
  const energyAt = (t: number) => A.energy[Math.min(A.energy.length - 1, Math.max(0, Math.floor(t / A.energyStep)))] ?? 0.5;
  const finaleStart = A.lastOnset - beatLen * 8;
  const picked: Slot[] = [];
  const pickedTimes: number[] = [];
  const canPlace = (t: number, gap: number) => {
    let lo = 0, hi = pickedTimes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pickedTimes[mid] < t) lo = mid + 1; else hi = mid; }
    if (lo < pickedTimes.length && pickedTimes[lo] - t < gap) return false;
    if (lo > 0 && t - pickedTimes[lo - 1] < gap) return false;
    return true;
  };
  const insert = (s: Slot) => {
    let lo = 0, hi = pickedTimes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pickedTimes[mid] < s.t) lo = mid + 1; else hi = mid; }
    pickedTimes.splice(lo, 0, s.t);
    picked.push(s);
  };

  for (let s = 0; s < 5; s++) {
    const a = s === 0 ? 0 : stages[s];
    const b = s === 4 ? A.duration : stages[s + 1];
    let target = 0;
    for (let t = Math.max(a, A.firstOnset); t < Math.min(b, endT); t += 0.25) {
      const e = energyAt(t);
      const fin = t >= finaleStart ? 1.15 : 1;
      target += 0.25 * P.baseNps * P.stageMult[s] * (0.5 + 0.95 * e) * fin;
    }
    const cands = slots.filter((x) => x.t >= a && x.t < b).sort((x, y) => y.score - x.score);
    let count = 0;
    for (const c of cands) {
      if (count >= target) break;
      // quiet passages need a stronger reason to place a note
      if (c.sal < 0.05 && c.level > 1) continue;
      if (!canPlace(c.t, P.minGap)) continue;
      insert(c);
      count++;
    }
  }
  // fill musically-active gaps that are too long
  picked.sort((x, y) => x.t - y.t);
  for (let pass = 0; pass < 2; pass++) {
    const times = picked.map((p) => p.t);
    for (let i = 0; i < times.length - 1; i++) {
      const g = times[i + 1] - times[i];
      if (g <= P.maxGapBeats * beatLen) continue;
      const inGap = slots.filter((x) => x.t > times[i] + P.minGap && x.t < times[i + 1] - P.minGap && x.loud > 0.25 && x.level <= 1);
      if (!inGap.length) continue;
      inGap.sort((x, y) => y.score - x.score);
      const c = inGap[0];
      if (canPlace(c.t, P.minGap)) insert(c);
    }
    picked.sort((x, y) => x.t - y.t);
  }

  // ---------- 3. lanes from melodic contour ----------
  const cen = (t: number) => {
    const fr = Math.round(timeToFrame(f, t));
    const vals: number[] = [];
    for (let d = -2; d <= 4; d++) { const v = f.centroid[fr + d]; if (v > 0) vals.push(v); }
    vals.sort((x, y) => x - y);
    return vals.length ? vals[Math.floor(vals.length / 2)] : 1000;
  };
  const evs: Ev[] = [];
  const lastLaneTime: number[] = [-9, -9, -9];
  let prevLane: Lane = 1;
  let prevC = 0;
  let repeat = 0;
  let trill: [Lane, Lane] | null = null;
  picked.forEach((s, i) => {
    const c = cen(s.t);
    let lane: Lane;
    const gap = i ? s.t - picked[i - 1].t : 9;
    if (i === 0) lane = 1;
    else {
      const dc = Math.log2(Math.max(50, c) / Math.max(50, prevC));
      if (gap < 0.24 && diff !== 'normal') {
        if (!trill || rng() < 0.12) {
          const pairs: [Lane, Lane][] = [[0, 1], [1, 2], [0, 2], [1, 0], [2, 1], [2, 0]];
          trill = pairs.filter((p) => p[0] !== prevLane)[Math.floor(rng() * 4)] ?? [0, 2];
        }
        lane = trill[0] === prevLane ? trill[1] : trill[0];
      } else {
        trill = null;
        if (Math.abs(dc) > 0.22) {
          const dir = dc > 0 ? 1 : -1;
          const step = Math.abs(dc) > 0.9 && gap > 0.35 ? 2 : 1;
          let l = prevLane + dir * step;
          if (l < 0 || l > 2) l = prevLane - dir;
          lane = Math.max(0, Math.min(2, l)) as Lane;
        } else if (s.low > s.high * 1.6 && rng() < 0.5) {
          lane = (rng() < 0.6 ? 1 : prevLane === 0 ? 2 : 0) as Lane;
        } else {
          const r = rng();
          lane = (r < 0.45 ? prevLane : r < 0.75 ? (prevLane + 1) % 3 : (prevLane + 2) % 3) as Lane;
        }
      }
      if (lane === prevLane) repeat++; else repeat = 0;
      if (repeat >= (diff === 'normal' ? 2 : 3)) {
        lane = ((prevLane + (rng() < 0.5 ? 1 : 2)) % 3) as Lane;
        repeat = 0;
      }
      // same-lane spacing
      if (s.t - lastLaneTime[lane] < rules.laneGap) {
        const alts = ([0, 1, 2] as Lane[]).filter((l) => s.t - lastLaneTime[l] >= rules.laneGap);
        if (alts.length) lane = alts.sort((x, y) => lastLaneTime[x] - lastLaneTime[y])[0];
      }
    }
    lastLaneTime[lane] = s.t;
    prevLane = lane;
    prevC = c;
    evs.push({ t: s.t, slot: s, lane, type: 'tap' });
  });

  // ---------- 4. holds on sustained sounds ----------
  const loudAt = (t: number) => sampleAt(res.loud, timeToFrame(f, t));
  const fluxMean = (t0: number, t1: number) => {
    const a = Math.floor(timeToFrame(f, t0)), b = Math.ceil(timeToFrame(f, t1));
    let s = 0; for (let i = a; i < b; i++) s += env.flux[i] ?? 0; return s / Math.max(1, b - a);
  };
  const snapDur = (d: number) => {
    const unit = beatLen / 2;
    return Math.max(0, Math.floor(d / unit + 0.001) * unit);
  };
  for (let i = 0; i < evs.length - 1; i++) {
    const e = evs[i];
    const g = evs[i + 1].t - e.t;
    if (g < P.holdMinGap) continue;
    const span = g * 0.7;
    let sus = 0;
    for (let k = 1; k <= 6; k++) sus += loudAt(e.t + (span * k) / 6);
    sus = sus / 6 / Math.max(0.08, loudAt(e.t + 0.03));
    const busy = fluxMean(e.t + 0.08, e.t + span);
    const sustained = sus > 0.7 && busy < 0.22;
    if (!(sustained || rng() < 0.3) || rng() > P.holdChance) continue;
    const d = snapDur(g - rules.releaseGap);
    if (d >= Math.max(0.36, beatLen * 0.5)) { e.type = 'hold'; e.dur = d; }
  }

  // overlapping holds: hold one edge lane while the other two lanes keep the rhythm
  if (P.overlapHoldChance > 0) {
    for (let i = 0; i < evs.length - 2; i++) {
      const e = evs[i];
      if (e.type !== 'tap' || e.slot.level > 1 || rng() > P.overlapHoldChance * (0.5 + e.slot.loud)) continue;
      const len = beatLen * (rng() < 0.5 ? 1 : 2);
      const end = e.t + len;
      const inside: Ev[] = [];
      for (let j = i + 1; j < evs.length && evs[j].t <= end + rules.releaseGap; j++) inside.push(evs[j]);
      if (inside.length < 2 || inside.length > 8) continue;
      if (inside.some((x) => x.type !== 'tap')) continue;
      if (inside.some((x, k) => k > 0 && x.t - inside[k - 1].t < rules.laneGap * 0.55)) continue;
      const holdLane: Lane = rng() < 0.5 ? 0 : 2;
      const others: Lane[] = holdLane === 0 ? [1, 2] : [0, 1];
      e.lane = holdLane;
      e.type = 'hold';
      e.dur = len;
      let k = rng() < 0.5 ? 0 : 1;
      for (const x of inside) {
        if (x.t <= end + rules.releaseGap) { x.lane = others[k % 2]; k++; }
      }
      i += inside.length;
    }
  }

  // ---------- 5. swipes on accents ----------
  const highs = slots.map((s) => s.high).sort((a, b) => a - b);
  const highThr = highs[Math.floor(highs.length * 0.9)] ?? 1;
  const isDropOrStage = (t: number) => A.drops.some((d) => Math.abs(d - t) < 0.06) || stages.some((s, k) => k > 0 && Math.abs(s - t) < 0.06);
  for (let i = 1; i < evs.length - 1; i++) {
    const e = evs[i];
    if (e.type !== 'tap') continue;
    const before = e.t - evs[i - 1].t - (evs[i - 1].dur ?? 0);
    const after = evs[i + 1].t - e.t;
    if (before < 0.12 || after < rules.swipeGapAfter) continue;
    const accent = e.slot.high >= highThr || isDropOrStage(e.t) || after > beatLen * 2;
    const p = P.swipeChance * (accent ? 2.6 : 0.6);
    if (rng() > p) continue;
    e.type = 'swipe';
    const nl = evs[i + 1].lane;
    const r = rng();
    e.dir = r < 0.5 ? 'up' : r < 0.62 ? 'down' : nl > e.lane ? 'right' : nl < e.lane ? 'left' : r < 0.81 ? 'left' : 'right';
  }

  // ---------- 6. simultaneous notes on the strongest hits ----------
  const sals = evs.map((e) => e.slot.sal).sort((a, b) => a - b);
  const dblThr = sals[Math.floor(sals.length * P.doubleQuantile)] ?? 9;
  let lastDouble = -99;
  for (let i = 1; i < evs.length - 1; i++) {
    const e = evs[i];
    if (e.type === 'hold') continue;
    const special = isDropOrStage(e.t);
    const strong = e.slot.sal >= dblThr && e.slot.level <= (diff === 'extreme' ? 2 : 1);
    if (!(special || strong)) continue;
    if (diff === 'normal' && (!special || e.t - lastDouble < beatLen * 16)) continue;
    if (rng() > P.doubleChance + (special ? 0.35 : 0)) continue;
    const before = e.t - evs[i - 1].t - (evs[i - 1].dur ?? 0);
    const after = evs[i + 1].t - e.t;
    if (before < P.minGap * 1.5 || after < Math.max(P.minGap * 1.5, e.type === 'swipe' ? rules.swipeGapAfter : 0)) continue;
    const other: Lane = e.lane === 1 ? (rng() < 0.5 ? 0 : 2) : rng() < 0.6 ? ((2 - e.lane) as Lane) : 1;
    if (e.type === 'swipe') {
      if (diff === 'normal') continue;
      const outward = e.lane !== 1 && other !== 1;
      const dirA: SwipeDir = outward ? (e.lane === 0 ? 'left' : 'right') : 'up';
      const dirB: SwipeDir = outward ? (other === 0 ? 'left' : 'right') : 'up';
      e.dir = dirA;
      e.partner = { lane: other, type: 'swipe', dir: dirB };
    } else {
      e.partner = { lane: other, type: 'tap' };
    }
    lastDouble = e.t;
  }

  // ---------- 7. finale ----------
  const last = evs[evs.length - 1];
  if (last) {
    const tail = A.duration - last.t;
    let sus = 0;
    for (let k = 1; k <= 4; k++) sus += loudAt(last.t + Math.min(tail - 0.3, 2.5) * (k / 4));
    sus /= 4;
    if (diff === 'normal') {
      if (tail > 1.6 && sus > 0.3) { last.type = 'hold'; last.dur = snapDur(Math.min(tail - 0.5, beatLen * 4)); if ((last.dur ?? 0) < 0.4) { last.type = 'swipe'; last.dir = 'up'; delete last.dur; } }
      else { last.type = 'swipe'; last.dir = 'up'; }
      last.lane = 1;
    } else if (diff === 'hard') {
      last.type = 'swipe'; last.lane = 0; last.dir = 'left'; delete last.dur;
      last.partner = { lane: 2, type: 'swipe', dir: 'right' };
    } else {
      last.type = 'tap'; last.lane = 1; delete last.dur;
      last.triple = true;
    }
  }

  // ---------- 8. micro-align each note group to the actual transient (±18 ms) ----------
  for (const e of evs) {
    const fr = timeToFrame(f, e.t);
    const r = Math.round(0.018 * f.rate);
    let best = -1, bv = 0.3;
    for (let k = Math.ceil(fr - r); k <= Math.floor(fr + r); k++) {
      const v = env.flux[k] ?? 0;
      if (v > bv && v >= (env.flux[k - 1] ?? 0) && v >= (env.flux[k + 1] ?? 0)) { bv = v; best = k; }
    }
    if (best < 0) continue;
    const y0 = env.flux[best - 1] ?? 0, y1 = env.flux[best], y2 = env.flux[best + 1] ?? 0;
    const den = y0 - 2 * y1 + y2;
    const pos = den < 0 ? best + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : best;
    const nt = frameTime(f, pos);
    if (Math.abs(nt - e.t) <= 0.018) e.t = nt;
  }

  // ---------- 9. flatten + enforce playability ----------
  const notes: ChartNote[] = [];
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  for (const e of evs) {
    const n: ChartNote = { t: r4(e.t), lane: e.lane, type: e.type };
    if (e.type === 'hold') n.dur = r4(e.dur ?? 0.5);
    if (e.type === 'swipe') n.dir = e.dir ?? 'up';
    notes.push(n);
    if (e.partner) {
      const p: ChartNote = { t: r4(e.t), lane: e.partner.lane, type: e.partner.type };
      if (p.type === 'swipe') p.dir = e.partner.dir ?? 'up';
      notes.push(p);
    }
    if (e.triple) {
      notes.push({ t: r4(e.t), lane: 0, type: 'tap' });
      notes.push({ t: r4(e.t), lane: 2, type: 'tap' });
    }
  }
  const clean = enforcePlayable(notes, diff, { allowFinalTriple: diff === 'extreme' });
  return { difficulty: diff, level: rateLevel(clean, diff, A.duration), notes: clean };
}

/** Re-export so the editor can show where stages begin. */
export function stageIndexAt(analysis: SongAnalysis, t: number): number {
  let s = 0;
  for (let i = 0; i < analysis.stages.length; i++) if (t >= analysis.stages[i]) s = i;
  return s;
}
