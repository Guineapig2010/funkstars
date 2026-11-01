// Procedural synthesiser for the original demo/tutorial track "First Light" (Funkstars Sound Lab).
// Also used as ground truth for analyzer timing tests: every drum hit time is known exactly.

export interface DemoSong {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  bpm: number;
  /** Exact beat times (s). */
  beats: number[];
  kicks: number[];
  snares: number[];
  duration: number;
}

export function synthDemo(sampleRate = 44100, bars = 40, bpm = 112, startOffset = 0.5): DemoSong {
  const beat = 60 / bpm;
  const duration = startOffset + bars * 4 * beat + 3;
  const n = Math.ceil(duration * sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

  const add = (t: number, len: number, fn: (x: number, i: number) => number, gain = 1, pan = 0) => {
    const s0 = Math.round(t * sampleRate);
    const cnt = Math.round(len * sampleRate);
    const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
    for (let i = 0; i < cnt && s0 + i < n; i++) {
      const v = fn(i / sampleRate, i);
      L[s0 + i] += v * gl;
      R[s0 + i] += v * gr;
    }
  };
  const kick = (t: number, g = 0.9) => {
    let ph = 0;
    add(t, 0.4, (x) => {
      const f = 45 + 95 * Math.exp(-x * 28);
      ph += (2 * Math.PI * f) / sampleRate;
      return Math.sin(ph) * Math.exp(-x * 7) * (x < 0.002 ? x / 0.002 : 1);
    }, g);
  };
  const snare = (t: number, g = 0.55) => {
    let lp = 0;
    add(t, 0.25, (x) => {
      const nz = rnd();
      const hp = nz - lp; lp = nz * 0.4 + lp * 0.6;
      return (hp * 0.8 * Math.exp(-x * 16) + Math.sin(2 * Math.PI * 190 * x) * 0.5 * Math.exp(-x * 25)) * (x < 0.001 ? x / 0.001 : 1);
    }, g, 0.05);
  };
  const hat = (t: number, g = 0.16, open = false) => {
    let p = 0;
    add(t, open ? 0.25 : 0.06, (x) => { const nz = rnd(); const h = nz - p; p = nz; return h * Math.exp(-x * (open ? 12 : 60)); }, g, 0.3);
  };
  const tone = (t: number, len: number, freq: number, g: number, shape: 'saw' | 'sq' | 'tri' | 'sine', pan = 0, attack = 0.005, release = 0.08) => {
    add(t, len + release, (x) => {
      const ph = (x * freq) % 1;
      let v = shape === 'sine' ? Math.sin(2 * Math.PI * ph)
        : shape === 'tri' ? 1 - 4 * Math.abs(ph - 0.5)
        : shape === 'sq' ? (ph < 0.5 ? 0.6 : -0.6)
        : (2 * ph - 1) * 0.7;
      const env = x < attack ? x / attack : x > len ? Math.max(0, 1 - (x - len) / release) : 1;
      v *= env;
      return v;
    }, g, pan);
  };
  const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  // A minor: Am F C G
  const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const roots = [45, 41, 48, 43];
  const leadScale = [69, 72, 74, 76, 79, 81, 84];

  const beats: number[] = [];
  const kicks: number[] = [];
  const snares: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = startOffset + bar * 4 * beat;
    const sec = bar < 4 ? 'intro' : bar < 12 ? 'verse' : bar < 16 ? 'build' : bar < 24 ? 'drop' : bar < 28 ? 'break' : bar < 36 ? 'drop2' : 'outro';
    const ch = prog[bar % 4];
    for (let b = 0; b < 4; b++) beats.push(t0 + b * beat);
    // pad
    if (sec !== 'drop2') for (const m of ch) tone(t0, 4 * beat - 0.05, midi(m), sec === 'break' ? 0.07 : 0.045, 'tri', (m % 3 - 1) * 0.4, 0.25, 0.4);
    // drums
    if (sec !== 'intro' && sec !== 'break') {
      for (let b = 0; b < 4; b++) {
        const tb = t0 + b * beat;
        if (b === 0 || b === 2 || (sec.startsWith('drop') && b === 3 && bar % 2 === 1)) { kick(tb); kicks.push(tb); }
        if ((b === 1 || b === 3) && sec !== 'build') { snare(tb); snares.push(tb); }
        if (sec === 'build') { for (let s = 0; s < (bar >= 14 ? 4 : 2); s++) { const ts = tb + (s * beat) / (bar >= 14 ? 4 : 2); snare(ts, 0.25 + 0.1 * (bar - 12)); snares.push(ts); } }
        hat(tb + beat / 2, 0.14, sec === 'drop2' && b === 3);
        if (sec.startsWith('drop')) { hat(tb + beat / 4, 0.08); hat(tb + (3 * beat) / 4, 0.08); }
      }
    } else if (sec === 'intro') {
      for (let b = 0; b < 4; b++) hat(t0 + b * beat, 0.1);
    }
    // bass
    if (sec !== 'intro' && sec !== 'break') {
      for (let e = 0; e < 8; e++) {
        if (e % 2 === 1 && sec === 'verse') continue;
        tone(t0 + (e * beat) / 2, beat / 2 - 0.04, midi(roots[bar % 4] - 12 + (e === 6 ? 12 : 0)), 0.18, 'saw', 0, 0.003, 0.03);
      }
    }
    // lead arpeggio
    if (sec === 'drop' || sec === 'drop2' || sec === 'break') {
      const steps = sec === 'drop2' ? 8 : 4;
      for (let s = 0; s < steps * 4 / (sec === 'break' ? 2 : 1); s++) {
        const len = (beat * 4) / (steps * 4 / (sec === 'break' ? 2 : 1));
        const idx = (s * 3 + bar * 2) % leadScale.length;
        tone(t0 + s * len, len * 0.7, midi(leadScale[idx] - (sec === 'break' ? 12 : 0)), 0.05, 'sq', 0.2 * Math.sin(s), 0.003, 0.05);
      }
    }
  }
  // final hit
  const tEnd = startOffset + bars * 4 * beat;
  kick(tEnd, 1); kicks.push(tEnd); snare(tEnd, 0.6); snares.push(tEnd); hat(tEnd, 0.2, true);
  for (const m of prog[0]) tone(tEnd, 2, midi(m), 0.06, 'saw', 0, 0.01, 0.8);
  beats.push(tEnd);

  // soft clip / normalise
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.89 / (peak || 1);
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * g * 1.1); R[i] = Math.tanh(R[i] * g * 1.1); }
  return { sampleRate, left: L, right: R, bpm, beats, kicks, snares, duration };
}

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return new Uint8Array(buf);
}
