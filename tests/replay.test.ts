// Plays every built-in chart perfectly through the rules engine with keyboard-style event ordering
// (each lane: press, then release before its next press). Every chart must be clearable cleanly.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { GameSession } from '../src/game/session';
import type { Lane, SongChartFile } from '../src/types';
import { DIFFICULTIES } from '../src/types';

type Ev = { t: number; k: number; run: (s: GameSession) => void };

function replay(notes: SongChartFile['charts']['hard']['notes']) {
  const s = new GameSession(notes, 'practice');
  const evs: Ev[] = [];
  let seq = 0;
  const add = (t: number, run: (s: GameSession) => void) => evs.push({ t, k: seq++, run });
  for (const n of s.notes) {
    if (n.type === 'swipe') { add(n.t, (x) => { x.pressLane(n.lane, n.t); x.direction(n.dir!, n.t + 0.005); }); add(n.t + 0.03, (x) => x.releaseLane(n.lane, n.t + 0.03)); }
    else if (n.type === 'hold') {
      add(n.t, (x) => x.pressLane(n.lane, n.t));
      let cur: Lane = n.lane;
      for (const p of [...(n.path ?? [])].sort((a, b) => a.t - b.t)) {
        const from = cur, at = p.t + (p.slide ?? 0) * 0.5;
        add(at, (x) => { x.pressLane(p.lane, at); x.releaseLane(from, at + 0.01); });
        cur = p.lane;
      }
      const endLane = cur, end = n.t + (n.dur ?? 0);
      add(end + 0.005, (x) => x.releaseLane(endLane, end + 0.005));
    } else { add(n.t, (x) => x.pressLane(n.lane, n.t)); add(n.t + 0.03, (x) => x.releaseLane(n.lane, n.t + 0.03)); }
  }
  evs.sort((a, b) => a.t - b.t || a.k - b.k);
  let i = 0;
  const last = Math.max(...s.notes.map((n) => n.t + (n.dur ?? 0))) + 1;
  for (let t = 0; t < last; t += 1 / 120) {
    while (i < evs.length && evs[i].t <= t) evs[i++].run(s);
    s.update(t);
  }
  return s.result();
}

describe('every chart can be cleared perfectly', () => {
  for (const f of readdirSync('public/songs/charts')) {
    const c: SongChartFile = JSON.parse(readFileSync(`public/songs/charts/${f}`, 'utf8'));
    for (const d of DIFFICULTIES) {
      it(`${f} ${d}`, () => {
        const r = replay(c.charts[d].notes);
        expect({ miss: r.counts.miss, breaks: r.counts.holdBreaks, nonPP: r.totalNotes - r.counts.perfectPlus }).toEqual({ miss: 0, breaks: 0, nonPP: 0 });
      });
    }
  }
});
