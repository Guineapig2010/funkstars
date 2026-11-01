import { describe, it, expect } from 'vitest';
import { GameSession } from '../src/game/session';
import { maxScore } from '../src/game/scoring';
import type { ChartNote } from '../src/types';

const S = (notes: ChartNote[], mode: 'classic' | 'practice' = 'practice') => new GameSession(notes, mode);

describe('tile sizes', () => {
  it('judges regular, half and micro tiles with identical timing windows', () => {
    for (const size of ['regular', 'half', 'micro'] as const) {
      for (const [d, j] of [[0.01, 'perfectPlus'], [0.05, 'perfect'], [-0.1, 'great'], [0.14, 'miss']] as const) {
        const s = S([{ t: 1, lane: 0, type: 'tap', size }]);
        s.pressLane(0, 1 + d);
        s.update(2);
        expect(s.notes[0].judged, `${size} ${d}`).toBe(j);
      }
    }
  });
  it('ignores presses earlier than the GREAT window (no ghost hits)', () => {
    const s = S([{ t: 1, lane: 1, type: 'tap', size: 'micro' }]);
    expect(s.pressLane(1, 0.8)).toBeNull();
    s.releaseLane(1, 0.82);
    expect(s.notes[0].judged).toBeNull();
    s.pressLane(1, 1.0);
    expect(s.notes[0].judged).toBe('perfectPlus');
  });
  it('rapid microtile repeats in one lane each need their own press', () => {
    const s = S([0, 1, 2].map((k) => ({ t: 1 + k * 0.1, lane: 0 as const, type: 'tap' as const, size: 'micro' as const })));
    for (let k = 0; k < 3; k++) { s.pressLane(0, 1 + k * 0.1); s.releaseLane(0, 1 + k * 0.1 + 0.03); }
    expect(s.notes.map((n) => n.judged)).toEqual(['perfectPlus', 'perfectPlus', 'perfectPlus']);
    expect(s.combo).toBe(3);
  });
});

describe('holds', () => {
  it('completes a plain hold and breaks one released early', () => {
    const s = S([{ t: 1, lane: 0, type: 'hold', dur: 1 }, { t: 3, lane: 1, type: 'hold', dur: 1 }]);
    s.pressLane(0, 1); s.update(1.5); s.releaseLane(0, 1.95); s.update(2);
    expect(s.notes[0].holdState).toBe('done');
    s.pressLane(1, 3); s.update(3.3); s.releaseLane(1, 3.4); s.update(3.5);
    expect(s.notes[1].holdState).toBe('broken');
    expect(s.counts.holdBreaks).toBe(1);
  });
  it('switch hold (keyboard): pressing the new lane at the switch keeps the hold alive', () => {
    const s = S([{ t: 1, lane: 0, type: 'hold', dur: 2, path: [{ t: 2, lane: 1 }] }]);
    s.pressLane(0, 1); s.update(1.5);
    s.pressLane(1, 1.97); s.releaseLane(0, 2.0); s.update(2.1); s.update(2.9); s.update(3.0);
    expect(s.notes[0].holdState).toBe('done');
    expect(s.notes[0].curLane).toBe(1);
  });
  it('switch hold breaks if the player stays on the old lane', () => {
    const s = S([{ t: 1, lane: 0, type: 'hold', dur: 2, path: [{ t: 2, lane: 2 }] }]);
    s.pressLane(0, 1); s.update(1.9); s.update(2.1); s.update(2.2);
    expect(s.notes[0].holdState).toBe('broken');
  });
  it('rail hold (touch slide) follows the path to the end lane', () => {
    const s = S([{ t: 1, lane: 0, type: 'hold', dur: 2, path: [{ t: 1.5, lane: 2, slide: 0.6 }] }]);
    s.touchDown(0, 1); s.update(1.4);
    expect(s.slide(0, 2, 1.8)).toBe(true);
    s.update(2.2); s.update(3);
    expect(s.notes[0].holdState).toBe('done');
  });
  it('a slide without a switch/rail hold is rejected (fingers drifting do nothing)', () => {
    const s = S([{ t: 1, lane: 0, type: 'hold', dur: 2 }]);
    s.touchDown(0, 1);
    expect(s.slide(0, 1, 1.5)).toBe(false);
  });
});

describe('swipes', () => {
  it('cardinal chord swipe: lane + direction in either order', () => {
    const a = S([{ t: 1, lane: 1, type: 'swipe', dir: 'left' }]);
    a.pressLane(1, 1.0); a.direction('left', 1.05);
    expect(a.notes[0].judged).toBe('perfectPlus');
    const b = S([{ t: 1, lane: 1, type: 'swipe', dir: 'left' }]);
    b.direction('left', 0.95); b.pressLane(1, 1.0);
    expect(b.notes[0].judged).toBe('perfectPlus');
  });
  it('wrong direction is a miss', () => {
    const s = S([{ t: 1, lane: 1, type: 'swipe', dir: 'up' }]);
    s.pressLane(1, 1); s.direction('down', 1.02);
    expect(s.notes[0].judged).toBe('miss');
  });
  it('diagonal: dedicated key, two direction keys, or touch flick', () => {
    const a = S([{ t: 1, lane: 0, type: 'swipe', dir: 'upright' }]);
    a.pressLane(0, 1); a.direction('upright', 1.01);
    expect(a.notes[0].judged).toBe('perfectPlus');
    const b = S([{ t: 1, lane: 0, type: 'swipe', dir: 'upright' }]);
    b.pressLane(0, 1); b.direction('up', 1.02); b.update(1.05); b.direction('right', 1.06);
    expect(b.notes[0].judged).toBe('perfectPlus');
    const c = S([{ t: 1, lane: 0, type: 'swipe', dir: 'upright' }]);
    c.pressLane(0, 1); c.direction('up', 1.02); c.update(1.3);
    expect(c.notes[0].judged).toBe('miss'); // only half of the diagonal
    const d = S([{ t: 1, lane: 2, type: 'swipe', dir: 'downleft' }]);
    d.touchDown(2, 1.01); d.swipeGesture(2, -40, 38, 1.01);
    expect(d.notes[0].judged).toBe('perfectPlus');
    const e = S([{ t: 1, lane: 2, type: 'swipe', dir: 'downleft' }]);
    e.touchDown(2, 1.01); e.swipeGesture(2, 0, 50, 1.01);
    expect(e.notes[0].judged).toBe('miss'); // straight down is not a diagonal
  });
});

describe('scoring', () => {
  it('a perfect run reaches the theoretical max and earns AP+', () => {
    const chart: ChartNote[] = [];
    for (let i = 0; i < 80; i++) chart.push({ t: 1 + i * 0.3, lane: (i % 3) as 0 | 1 | 2, type: 'tap', size: i % 2 ? 'half' : undefined });
    chart.push({ t: 26, lane: 0, type: 'hold', dur: 1.5, path: [{ t: 26.7, lane: 1 }] });
    const s = S(chart, 'classic');
    for (const n of s.notes) {
      s.pressLane(n.lane, n.t);
      if (n.type === 'hold') { s.update(n.t + 0.5); s.pressLane(1, 26.7); s.update(27); s.update(27.6); }
      else s.releaseLane(n.lane, n.t + 0.03);
      s.update(n.t + 0.01);
    }
    s.update(30);
    const r = s.result();
    expect(r.score).toBe(maxScore(chart));
    expect(r.medals).toEqual(['fc', 'ap', 'app']);
    expect(r.stars).toBe(5);
    expect(r.byType.half).toEqual([40, 40]);
    expect(r.byType.switch).toEqual([1, 1]);
  });
  it('classic mode fails on the first miss; practice continues', () => {
    const c = S([{ t: 1, lane: 0, type: 'tap' }, { t: 2, lane: 0, type: 'tap' }], 'classic');
    c.update(1.5);
    expect(c.failed).toBe(true);
    const p = S([{ t: 1, lane: 0, type: 'tap' }, { t: 2, lane: 0, type: 'tap' }], 'practice');
    p.update(1.5); p.pressLane(0, 2);
    expect(p.failed).toBe(false);
    expect(p.counts.perfectPlus).toBe(1);
  });
});
