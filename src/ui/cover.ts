// Procedural album artwork. Each song gets a deterministic, original cover built from its theme
// (palette + motif) and id. Supports animation (time parameter) for featured/detail views.
import type { SongMeta } from '../types';
import { hashString, makeRng } from '../analysis/rng';
import { lighten, darken, rgba } from '../game/sprites';

const imgCache = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement>>();

export function loadCoverImage(url: string): Promise<HTMLImageElement> {
  if (imgCache.has(url)) return Promise.resolve(imgCache.get(url)!);
  if (loading.has(url)) return loading.get(url)!;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { imgCache.set(url, img); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
  loading.set(url, p);
  return p;
}
export function cachedCoverImage(url?: string) { return url ? imgCache.get(url) : undefined; }

export function drawCover(g: CanvasRenderingContext2D, size: number, meta: SongMeta, time = 0, withText = true) {
  const [c1, c2, c3] = meta.theme.colors;
  const rng = makeRng(hashString(meta.id));
  const S = size;
  g.save();
  const custom = meta.coverUrl ? imgCache.get(meta.coverUrl) : undefined;
  if (custom) {
    const ar = custom.width / custom.height;
    const w = ar >= 1 ? S * ar : S, h = ar >= 1 ? S : S / ar;
    g.drawImage(custom, (S - w) / 2, (S - h) / 2, w, h);
    g.restore();
    return;
  }
  // base gradient
  const bg = g.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, darken(c2, 0.55));
  bg.addColorStop(0.55, darken(c1, 0.35));
  bg.addColorStop(1, darken(c2, 0.75));
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  const cx = S / 2, cy = S / 2;
  const t = time;
  switch (meta.theme.motif) {
    case 'rings': {
      for (let i = 9; i >= 1; i--) {
        const r = (S * 0.06 * i) * (1 + 0.04 * Math.sin(t * 2 + i));
        g.beginPath(); g.arc(cx, cy * 1.05, r, 0, Math.PI * 2);
        g.strokeStyle = i % 2 ? rgba(c1, 0.85) : rgba(c3, 0.7);
        g.lineWidth = S * 0.018;
        g.stroke();
      }
      glowDot(g, cx, cy * 1.05, S * 0.18, c3);
      break;
    }
    case 'eclipse': {
      glowDot(g, cx, cy * 0.9, S * 0.55, c1);
      g.beginPath(); g.arc(cx, cy * 0.9, S * 0.24, 0, Math.PI * 2); g.fillStyle = lighten(c3, 0.3); g.fill();
      g.beginPath(); g.arc(cx + S * 0.06 * Math.cos(t * 0.6), cy * 0.9 - S * 0.03, S * 0.23, 0, Math.PI * 2); g.fillStyle = '#05000a'; g.fill();
      for (let i = 0; i < 40; i++) { g.fillStyle = rgba('#ffffff', rng() * 0.6); g.fillRect(rng() * S, rng() * S * 0.6, 1.5, 1.5); }
      // horizon silhouette
      g.beginPath(); g.moveTo(0, S);
      for (let x = 0; x <= S; x += S / 20) g.lineTo(x, S * 0.78 + Math.sin(x * 0.05 + rng()) * S * 0.04 - rng() * S * 0.05);
      g.lineTo(S, S); g.closePath(); g.fillStyle = '#07000c'; g.fill();
      break;
    }
    case 'grid': {
      const hz = S * 0.55;
      glowDot(g, cx, hz - S * 0.12, S * 0.38, c3);
      g.beginPath(); g.arc(cx, hz - S * 0.1, S * 0.17, Math.PI, 0); g.fillStyle = lighten(c3, 0.2); g.fill();
      g.fillStyle = darken(c2, 0.6); g.fillRect(0, hz, S, S - hz);
      g.strokeStyle = rgba(c1, 0.9); g.lineWidth = S * 0.006;
      for (let i = -10; i <= 10; i++) { g.beginPath(); g.moveTo(cx + i * S * 0.02, hz); g.lineTo(cx + i * S * 0.16, S); g.stroke(); }
      for (let k = 0; k < 9; k++) { const p = ((k + (t * 0.8) % 1) / 9); const y = hz + (S - hz) * p * p; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
      break;
    }
    case 'bars': {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const h = S * (0.15 + 0.55 * Math.abs(Math.sin(i * 1.7 + rng() + t * 2.2 * (0.5 + (i % 3) * 0.3))));
        const x = S * 0.08 + i * (S * 0.84 / n);
        const grd = g.createLinearGradient(0, S * 0.85 - h, 0, S * 0.85);
        grd.addColorStop(0, lighten(c3, 0.3)); grd.addColorStop(1, c1);
        g.fillStyle = grd;
        g.fillRect(x, S * 0.85 - h, S * 0.84 / n * 0.62, h);
      }
      break;
    }
    case 'sunburst': {
      g.save(); g.translate(cx, cy); g.rotate(t * 0.15);
      for (let i = 0; i < 24; i++) {
        g.rotate(Math.PI / 12);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(S, -S * 0.08); g.lineTo(S, S * 0.08); g.closePath();
        g.fillStyle = i % 2 ? rgba(c1, 0.55) : rgba(c2, 0.4); g.fill();
      }
      g.restore();
      glowDot(g, cx, cy, S * 0.35, c3);
      g.beginPath(); g.arc(cx, cy, S * 0.13, 0, Math.PI * 2); g.fillStyle = lighten(c3, 0.5); g.fill();
      break;
    }
    case 'waves': {
      for (let k = 0; k < 7; k++) {
        g.beginPath();
        for (let x = 0; x <= S; x += 4) {
          const y = S * (0.25 + k * 0.1) + Math.sin(x * 0.02 + k * 0.9 + t * 1.5) * S * 0.05 + Math.sin(x * 0.045 + k) * S * 0.02;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = k % 2 ? rgba(c1, 0.85) : rgba(c3, 0.75);
        g.lineWidth = S * 0.014;
        g.stroke();
      }
      break;
    }
    case 'shards': {
      for (let i = 0; i < 18; i++) {
        const x = rng() * S, y = rng() * S, r = S * (0.08 + rng() * 0.2), a = rng() * Math.PI * 2 + t * 0.2 * (rng() - 0.5);
        g.beginPath();
        for (let k = 0; k < 3; k++) g.lineTo(x + Math.cos(a + k * 2.1) * r, y + Math.sin(a + k * 2.1) * r);
        g.closePath();
        g.fillStyle = rgba([c1, c3, lighten(c1, 0.4)][i % 3], 0.35 + rng() * 0.4);
        g.fill();
      }
      break;
    }
    case 'orbs': {
      for (let i = 0; i < 9; i++) {
        const x = S * (0.15 + rng() * 0.7) + Math.sin(t + i) * S * 0.02, y = S * (0.15 + rng() * 0.7) + Math.cos(t * 0.8 + i) * S * 0.02;
        glowDot(g, x, y, S * (0.12 + rng() * 0.2), [c1, c3, c2][i % 3]);
      }
      break;
    }
    case 'spiral': {
      g.save(); g.translate(cx, cy); g.rotate(-t * 0.3);
      for (let i = 0; i < 220; i++) {
        const a = i * 0.25, r = i * S * 0.0021;
        g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, S * 0.004 + i * S * 0.00006, 0, Math.PI * 2);
        g.fillStyle = i % 3 ? rgba(c1, 0.9) : rgba(c3, 0.9); g.fill();
      }
      g.restore();
      glowDot(g, cx, cy, S * 0.2, c3);
      break;
    }
    case 'prism':
    default: {
      g.save(); g.translate(cx, cy * 1.02);
      const r = S * 0.26;
      glowDot(g, 0, 0, S * 0.5, c1);
      g.beginPath();
      for (let k = 0; k < 3; k++) g.lineTo(Math.cos(-Math.PI / 2 + k * 2.094) * r, Math.sin(-Math.PI / 2 + k * 2.094) * r);
      g.closePath();
      g.strokeStyle = '#ffffff'; g.lineWidth = S * 0.016; g.stroke();
      g.fillStyle = rgba(c2, 0.5); g.fill();
      const colors = [c1, c3, lighten(c1, 0.5), c2];
      colors.forEach((c, i) => {
        g.beginPath(); g.moveTo(r * 0.3, 0);
        const sp = 0.06 + i * 0.05 + Math.sin(t + i) * 0.01;
        g.lineTo(S, S * (sp - 0.04)); g.lineTo(S, S * (sp + 0.02)); g.closePath();
        g.fillStyle = rgba(c, 0.75); g.fill();
      });
      g.beginPath(); g.moveTo(-S, S * 0.02); g.lineTo(-r * 0.3, 0); g.lineTo(-S, -S * 0.0); g.closePath(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
      g.restore();
      break;
    }
  }

  // grain + vignette
  const vg = g.createRadialGradient(cx, cy, S * 0.3, cx, cy, S * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  // sheen
  const sh = g.createLinearGradient(0, 0, S, S);
  const sp = (Math.sin(t * 0.7) * 0.5 + 0.5) * 0.6 + 0.2;
  sh.addColorStop(Math.max(0, sp - 0.15), 'rgba(255,255,255,0)');
  sh.addColorStop(sp, 'rgba(255,255,255,0.12)');
  sh.addColorStop(Math.min(1, sp + 0.15), 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, S, S);

  if (withText) {
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const title = meta.title.toUpperCase();
    let fs = S * 0.105;
    g.font = `400 ${fs}px Bungee, Outfit, system-ui`;
    while (g.measureText(title).width > S * 0.86 && fs > S * 0.05) { fs *= 0.92; g.font = `400 ${fs}px Bungee, Outfit, system-ui`; }
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillText(title, S * 0.07 + 2, S * 0.9 + 2);
    g.fillStyle = '#ffffff';
    g.fillText(title, S * 0.07, S * 0.9);
    if (meta.tag) {
      g.font = `700 ${S * 0.045}px Outfit, system-ui`;
      g.fillStyle = lighten(c3, 0.3);
      g.fillText(meta.tag.toUpperCase(), S * 0.07, S * 0.9 - fs * 1.0);
    }
    // small logo mark
    g.font = `800 ${S * 0.04}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.textAlign = 'right';
    g.fillText('★ FS', S * 0.93, S * 0.1);
  }
  g.restore();
}

function glowDot(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, lighten(c, 0.6));
  grd.addColorStop(0.3, rgba(c, 0.8));
  grd.addColorStop(1, rgba(c, 0));
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

const staticCache = new Map<string, HTMLCanvasElement>();
/** Static cover rendered once at a given pixel size. */
export function coverCanvas(meta: SongMeta, px: number, withText = true): HTMLCanvasElement {
  const key = `${withText ? 't' : 'n'}|${meta.id}|${px}|${meta.coverUrl ?? ''}|${imgCache.has(meta.coverUrl ?? '') ? 1 : 0}|${meta.title}`;
  let c = staticCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = px;
    drawCover(c.getContext('2d')!, px, meta, 1.3, withText);
    staticCache.set(key, c);
  }
  return c;
}
