// Decoder alignment. Different browsers decode MP3 with different encoder-delay handling
// (up to ~50 ms). We store a compact onset-envelope signature computed offline and, at load time,
// cross-correlate it with the envelope of the browser-decoded audio to find the exact shift.
import { computeFeatures, percentile } from './features';

const SIG_SECONDS = 45;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function quantize(flux: Float32Array, rate: number): Uint8Array {
  const n = Math.min(flux.length, Math.round(SIG_SECONDS * rate));
  const slice = flux.subarray(0, n);
  const top = percentile(slice, 99) || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((slice[i] / top) * 200)));
  return out;
}

export function makeEnvSignature(flux: Float32Array, _rate: number): string {
  return toB64(quantize(flux, _rate));
}

export interface AlignResult {
  /** Seconds the decoded audio is delayed relative to the analysed audio (add to note times). */
  offset: number;
  confidence: number;
}

export function alignToSignature(mono: Float32Array, sampleRate: number, sigB64: string): AlignResult {
  const sig = fromB64(sigB64);
  const seconds = SIG_SECONDS + 2;
  const slice = mono.subarray(0, Math.min(mono.length, Math.round(seconds * sampleRate)));
  const f = computeFeatures(slice, sampleRate);
  const cur = quantize(f.flux, f.rate);
  const maxLag = 12;
  const n = Math.min(sig.length, cur.length) - maxLag * 2;
  if (n < 200) return { offset: 0, confidence: 0 };
  const mean = (a: Uint8Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  const ms = mean(sig), mc = mean(cur);
  const corr: number[] = [];
  for (let L = -maxLag; L <= maxLag; L++) {
    let s = 0, a2 = 0, b2 = 0;
    for (let i = maxLag; i < maxLag + n; i++) {
      const a = sig[i] - ms;
      const b = (cur[i + L] ?? 0) - mc;
      s += a * b; a2 += a * a; b2 += b * b;
    }
    corr.push(s / Math.sqrt(a2 * b2 + 1e-9));
  }
  let bi = 0;
  for (let i = 1; i < corr.length; i++) if (corr[i] > corr[bi]) bi = i;
  let lag = bi - maxLag;
  if (bi > 0 && bi < corr.length - 1) {
    const y0 = corr[bi - 1], y1 = corr[bi], y2 = corr[bi + 1];
    const den = y0 - 2 * y1 + y2;
    if (den < 0) lag += Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  const sorted = [...corr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const confidence = Math.max(0, Math.min(1, (corr[bi] - median) / (1 - median + 1e-9)));
  // only trust a clear, central peak
  if (corr[bi] < 0.5 || Math.abs(lag) >= maxLag - 0.5) return { offset: 0, confidence: 0 };
  return { offset: lag / f.rate, confidence };
}
