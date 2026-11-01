import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { checkPlayable, enforcePlayable } from '../src/analysis/rules';
import { synthDemo } from '../scripts/lib/demoSynth';
import { analyzeAudio } from '../src/analysis/analyzer';
import { generateCharts } from '../src/analysis/chartGen';
import { GameSession } from '../src/game/session';
import type { SongChartFile, ChartNote } from '../src/types';
import { DIFFICULTIES } from '../src/types';

describe('built-in charts', () => {
  const files = readdirSync('public/songs/charts').filter((f) => f.endsWith('.json'));
  it('there is a chart for every song in the manifest', () => {
    const m = JSON.parse(readFileSync('public/songs/manifest.json', 'utf8'));
    for (const s of m.songs) expect(files).toContain(`${s.id}.json`);
  });
  for (const f of files) {
    it(`${f}: all difficulties are physically playable`, () => {
      const c: SongChartFile = JSON.parse(readFileSync(`public/songs/charts/${f}`, 'utf8'));
      for (const d of DIFFICULTIES) expect(checkPlayable(c.charts[d].notes, d), `${f} ${d}`).toEqual([]);
      // difficulties are genuinely different charts, not the same notes faster
      expect(c.charts.hard.notes.length).toBeGreaterThan(c.charts.normal.notes.length * 1.3);
      expect(c.charts.extreme.notes.length).toBeGreaterThan(c.charts.hard.notes.length * 1.1);
    });
  }
});

describe('backward compatibility', () => {
  it('v1 charts without size/path fields still load and play', () => {
    const old: ChartNote[] = [{ t: 1, lane: 0, type: 'tap' }, { t: 2, lane: 1, type: 'hold', dur: 1 }, { t: 4, lane: 2, type: 'swipe', dir: 'up' }];
    const s = new GameSession(old, 'practice');
    s.pressLane(0, 1); s.pressLane(1, 2); s.update(3.1); s.pressLane(2, 4); s.direction('up', 4.01); s.update(5);
    expect(s.result().counts.perfectPlus).toBe(3);
    expect(checkPlayable(old, 'normal')).toEqual([]);
  });
});

describe('rules', () => {
  it('allow rapid microtile spacing but not for regular tiles', () => {
    const micro: ChartNote[] = [0, 1, 2].map((k) => ({ t: 1 + k * 0.1, lane: 0, type: 'tap', size: 'micro' }));
    expect(checkPlayable(micro, 'extreme')).toEqual([]);
    const reg: ChartNote[] = [0, 1, 2].map((k) => ({ t: 1 + k * 0.1, lane: 0, type: 'tap' }));
    expect(checkPlayable(reg, 'extreme').length).toBeGreaterThan(0);
  });
  it('removes notes that would collide with a switch hold path', () => {
    const notes: ChartNote[] = [{ t: 1, lane: 0, type: 'hold', dur: 2, path: [{ t: 2, lane: 1 }] }, { t: 2.5, lane: 1, type: 'tap' }];
    expect(enforcePlayable(notes, 'hard').length).toBe(1);
  });
});

describe('analyzer on ground-truth audio', () => {
  const d = synthDemo();
  const mono = new Float32Array(d.left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (d.left[i] + d.right[i]) / 2;
  const res = analyzeAudio(mono, d.sampleRate);
  it('finds the exact tempo', () => expect(Math.abs(res.analysis.bpm - d.bpm)).toBeLessThan(0.1));
  it('places beats within 8 ms of the true beats', () => {
    const errs = d.beats.slice(2, -2).map((tb) => Math.min(...res.analysis.beats.map((b) => Math.abs(b - tb))));
    expect(Math.max(...errs)).toBeLessThan(0.008);
  });
  it('generated charts are deterministic, playable and land on drum hits', () => {
    const a = generateCharts(res, 'first-light'), b = generateCharts(res, 'first-light');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const diff of DIFFICULTIES) expect(checkPlayable(a[diff].notes, diff)).toEqual([]);
    const hits = [...d.kicks, ...d.snares];
    const near = a.normal.notes.filter((n) => hits.some((h) => Math.abs(h - n.t) < 0.012)).length;
    expect(near / a.normal.notes.length).toBeGreaterThan(0.8);
  });
});
