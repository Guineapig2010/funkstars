// Interactive tutorial: a hand-authored chart on the original "First Light" track that teaches every
// note type with the real gameplay engine and inputs. Notes sit exactly on the synthesized beat grid.
import type { ChartNote, Lane, SwipeDir } from '../types';

export interface Lesson { t: number; end: number; title: string; keys: string; touch: string }

export function buildTutorial(beats: number[]): { notes: ChartNote[]; lessons: Lesson[] } {
  const B = (i: number) => beats[Math.min(beats.length - 1, i)];
  const mid = (i: number, f: number) => B(i) + (B(i + 1) - B(i)) * f;
  const notes: ChartNote[] = [];
  const lessons: Lesson[] = [];
  const lesson = (from: number, to: number, title: string, keys: string, touch: string) =>
    lessons.push({ t: B(from) - (B(from + 1) - B(from)) * 3, end: B(to), title, keys, touch });

  // 1. taps
  lesson(8, 24, 'Tap', 'Press A · S · D (or ← ↓ →) as each tile reaches the line.', 'Tap the lane as each tile reaches the line.');
  const seq: Lane[] = [0, 1, 2, 1, 0, 2, 1, 0, 2, 1, 0, 1, 2, 1, 0, 1];
  for (let i = 0; i < 16; i++) notes.push({ t: B(8 + i), lane: seq[i], type: 'tap' });
  // 2. half tiles (8ths) then microtiles (16ths)
  lesson(24, 40, 'Half tiles & microtiles', 'Shorter tiles mean faster rhythm — the timing window is the same. Hit the white centre line.', 'Shorter tiles mean faster rhythm — same timing window. Tap on the white centre line.');
  for (let i = 0; i < 8; i++) for (let h = 0; h < 2; h++) notes.push({ t: mid(24 + i, h * 0.5), lane: ((i + h) % 3) as Lane, type: 'tap', size: 'half' });
  for (let i = 0; i < 8; i += 2) {
    const lane = ([0, 2, 1, 0] as Lane[])[i / 2];
    for (let q = 0; q < 3; q++) notes.push({ t: mid(32 + i, q * 0.25), lane: q === 1 ? (lane === 1 ? 2 : 1) as Lane : lane, type: 'tap', size: 'micro' });
    notes.push({ t: B(33 + i), lane: 1, type: 'tap' });
  }
  // 3. chords
  lesson(40, 48, 'Chords', 'Two tiles at once: press both keys together.', 'Two tiles at once: tap with two thumbs.');
  const pairs: [Lane, Lane][] = [[0, 2], [0, 1], [1, 2], [0, 2], [0, 1], [1, 2], [0, 2], [0, 2]];
  pairs.forEach(([a, b], i) => { notes.push({ t: B(40 + i), lane: a, type: 'tap' }); notes.push({ t: B(40 + i), lane: b, type: 'tap' }); });
  // 4. holds
  lesson(48, 64, 'Hold', 'Hold the key until the trail ends, then let go.', 'Keep your finger down until the trail ends.');
  for (let i = 0; i < 4; i++) notes.push({ t: B(48 + i * 4), lane: ([1, 0, 2, 1] as Lane[])[i], type: 'hold', dur: B(50 + i * 4) - B(48 + i * 4) });
  // 5. swipes
  lesson(64, 72, 'Swipe', 'Lane key + direction key together: I ↑  J ←  K ↓  L →  (or W A S D with the arrows preset).', 'Touch the lane and flick in the arrow’s direction.');
  (['up', 'left', 'right', 'down'] as SwipeDir[]).forEach((d, i) => notes.push({ t: B(64 + i * 2), lane: ([1, 0, 2, 1] as Lane[])[i], type: 'swipe', dir: d }));
  // 6. diagonal swipes
  lesson(72, 80, 'Diagonal swipe (gold arrows)', 'Lane key + a diagonal key (U ↖  O ↗  M ↙  . ↘) — or both direction keys at once, e.g. I + L for ↗.', 'Flick diagonally, along the gold arrow.');
  (['upleft', 'upright', 'downleft', 'downright'] as SwipeDir[]).forEach((d, i) => notes.push({ t: B(72 + i * 2), lane: ([0, 2, 1, 1] as Lane[])[i], type: 'swipe', dir: d }));
  // 7. switch holds
  lesson(80, 96, 'Switch hold', 'Hold, and when the bar jumps press the new lane’s key (you can let go of the old one).', 'Hold, and slide your finger to the new lane when the bar jumps.');
  notes.push({ t: B(80), lane: 0, type: 'hold', dur: B(86) - B(80), path: [{ t: B(83), lane: 1 }] });
  notes.push({ t: B(88), lane: 2, type: 'hold', dur: B(95) - B(88), path: [{ t: B(90), lane: 1 }, { t: B(93), lane: 0 }] });
  // 8. rail holds
  lesson(96, 112, 'Rail hold', 'The trail glides to another lane: switch keys while it slides.', 'Follow the gliding trail with your finger.');
  notes.push({ t: B(96), lane: 0, type: 'hold', dur: B(102) - B(96), path: [{ t: B(98), lane: 2, slide: B(100) - B(98) }] });
  notes.push({ t: B(104), lane: 2, type: 'hold', dur: B(110) - B(104), path: [{ t: B(106), lane: 1, slide: B(107) - B(106) }] });
  // 9. finale mix
  lesson(112, 128, 'Put it together!', 'Everything at once — good luck!', 'Everything at once — good luck!');
  for (let i = 0; i < 16; i++) {
    const t = B(112 + i);
    if (i % 4 === 3) notes.push({ t, lane: 1, type: 'swipe', dir: i === 15 ? 'up' : i % 8 === 3 ? 'upleft' : 'upright' });
    else if (i === 4 || i === 8) notes.push({ t, lane: i === 4 ? 0 : 2, type: 'hold', dur: B(114 + i) - t, ...(i === 8 ? { path: [{ t: B(113 + i), lane: 1 as Lane }] } : {}) });
    else if (i === 5 || i === 9 || i === 6 || i === 10) continue;
    else { notes.push({ t, lane: (i % 3) as Lane, type: 'tap', size: 'half' }); notes.push({ t: mid(112 + i, 0.5), lane: ((i + 1) % 3) as Lane, type: 'tap', size: 'half' }); }
  }
  return { notes: notes.sort((a, b) => a.t - b.t || a.lane - b.lane), lessons };
}
