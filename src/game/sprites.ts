// Pre-rendered sprites (notes, glows, judgement text). Rendering expensive effects once into
// offscreen canvases keeps the per-frame cost low on phones and 4K displays.
import type { NoteSkin } from '../store/settings';
import type { SwipeDir } from '../types';

export type Sprite = HTMLCanvasElement;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function hexToRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgba(h: string, a: number) {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
export function lighten(h: string, k: number) {
  const [r, g, b] = hexToRgb(h);
  const f = (x: number) => Math.round(x + (255 - x) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function darken(h: string, k: number) {
  const [r, g, b] = hexToRgb(h);
  const f = (x: number) => Math.round(x * (1 - k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
export { roundRect };

/** Soft radial glow dot, white core tinted with colour. */
const glowCache = new Map<string, Sprite>();
export function glowSprite(color: string, size = 64): Sprite {
  const key = color + size;
  let c = glowCache.get(key);
  if (c) return c;
  c = canvas(size, size);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, rgba(color, 0.95));
  grd.addColorStop(0.45, rgba(color, 0.35));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}

/** Elongated spark streak (pointing right). */
const sparkCache = new Map<string, Sprite>();
export function sparkSprite(color: string): Sprite {
  let c = sparkCache.get(color);
  if (c) return c;
  c = canvas(64, 16);
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, rgba(color, 0));
  grd.addColorStop(0.7, rgba(color, 0.9));
  grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(32, 8, 32, 5, 0, 0, Math.PI * 2);
  g.fill();
  sparkCache.set(color, c);
  return c;
}

/**
 * Note sprite. Width `w`, height `h` in device pixels. Includes a glow margin `pad` on all sides.
 */
export function noteSprite(skin: NoteSkin, color: string, w: number, h: number, kind: 'tap' | 'hold' | 'swipe', dir?: SwipeDir, size: 'regular' | 'half' | 'micro' = 'regular'): { img: Sprite; pad: number } {
  // glow margin is based on the regular tile height so short tiles keep a readable halo
  const pad = Math.round(Math.max(h, w * 0.2) * 0.6);
  const c = canvas(w + pad * 2, h + pad * 2);
  const g = c.getContext('2d')!;
  const x = pad, y = pad;
  const r = skin === 'pixel' ? h * 0.12 : h / 2;
  // outer glow
  g.save();
  g.shadowColor = rgba(color, 0.95);
  g.shadowBlur = pad * 0.9;
  roundRect(g, x, y, w, h, r);
  g.fillStyle = rgba(color, 0.9);
  g.fill();
  g.restore();

  if (skin === 'ring') {
    g.lineWidth = h * 0.22;
    roundRect(g, x + g.lineWidth / 2, y + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, r);
    g.clearRect(x + h * 0.2, y + h * 0.2, w - h * 0.4, h - h * 0.4);
    g.strokeStyle = lighten(color, 0.35);
    g.stroke();
    roundRect(g, x + h * 0.3, y + h * 0.36, w - h * 0.6, h * 0.28, h * 0.14);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fill();
  } else {
    // body
    const body = g.createLinearGradient(0, y, 0, y + h);
    if (skin === 'gold') {
      body.addColorStop(0, '#fff6c9'); body.addColorStop(0.35, '#ffd34d'); body.addColorStop(0.6, '#c98a10'); body.addColorStop(1, '#ffe27a');
    } else if (skin === 'crystal') {
      body.addColorStop(0, lighten(color, 0.85)); body.addColorStop(0.5, lighten(color, 0.25)); body.addColorStop(0.51, darken(color, 0.15)); body.addColorStop(1, lighten(color, 0.4));
    } else if (skin === 'pixel') {
      body.addColorStop(0, lighten(color, 0.5)); body.addColorStop(0.5, color); body.addColorStop(1, darken(color, 0.35));
    } else {
      body.addColorStop(0, lighten(color, 0.7)); body.addColorStop(0.45, lighten(color, 0.15)); body.addColorStop(1, darken(color, 0.25));
    }
    roundRect(g, x, y, w, h, r);
    g.fillStyle = body;
    g.fill();
    // rim (short tiles get a proportionally stronger rim so they stay readable)
    g.lineWidth = Math.max(1.5, h * (size === 'micro' ? 0.16 : size === 'half' ? 0.1 : 0.07));
    g.strokeStyle = skin === 'gold' ? '#fff3b0' : 'rgba(255,255,255,0.9)';
    roundRect(g, x + g.lineWidth / 2, y + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, r);
    g.stroke();
    // glossy highlight
    if (skin === 'crystal') {
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.moveTo(x + w * 0.15, y + h * 0.18); g.lineTo(x + w * 0.42, y + h * 0.18); g.lineTo(x + w * 0.3, y + h * 0.5); g.lineTo(x + w * 0.1, y + h * 0.5);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.moveTo(x + w * 0.55, y + h * 0.2); g.lineTo(x + w * 0.85, y + h * 0.2); g.lineTo(x + w * 0.78, y + h * 0.45); g.lineTo(x + w * 0.5, y + h * 0.45);
      g.closePath(); g.fill();
    } else if (skin === 'pixel') {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      const px = Math.max(2, Math.round(h * 0.14));
      for (let i = 0; i < 4; i++) g.fillRect(x + h * 0.3 + i * px * 1.5, y + h * 0.22, px, px);
    } else {
      const hl = g.createLinearGradient(0, y, 0, y + h * 0.5);
      hl.addColorStop(0, 'rgba(255,255,255,0.85)');
      hl.addColorStop(1, 'rgba(255,255,255,0.05)');
      roundRect(g, x + h * 0.22, y + h * 0.12, w - h * 0.44, h * 0.34, h * 0.17);
      g.fillStyle = hl;
      g.fill();
    }
  }

  if (kind === 'hold') {
    // three grip dots
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.arc(x + w / 2 + i * h * 0.42, y + h * 0.62, h * 0.09, 0, Math.PI * 2);
      g.fill();
    }
  }

  if (kind === 'swipe') {
    // chevron arrow
    g.save();
    g.translate(x + w / 2, y + h / 2);
    const ROT: Record<string, number> = { up: 0, upright: Math.PI / 4, right: Math.PI / 2, downright: (3 * Math.PI) / 4, down: Math.PI, downleft: (-3 * Math.PI) / 4, left: -Math.PI / 2, upleft: -Math.PI / 4 };
    const rot = ROT[dir ?? 'up'] ?? 0;
    g.rotate(rot);
    const s = h * 0.62;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = h * 0.18;
    g.strokeStyle = 'rgba(20,10,40,0.55)';
    g.beginPath(); g.moveTo(-s * 0.85, s * 0.42); g.lineTo(0, -s * 0.42); g.lineTo(s * 0.85, s * 0.42); g.stroke();
    g.lineWidth = h * 0.12;
    g.strokeStyle = '#ffffff';
    g.beginPath(); g.moveTo(-s * 0.85, s * 0.36); g.lineTo(0, -s * 0.48); g.lineTo(s * 0.85, s * 0.36); g.stroke();
    g.restore();
  }
  return { img: c, pad };
}

/** Judgement text sprite. */
export function textSprite(text: string, colors: [string, string], size: number, font = 'Bungee'): Sprite {
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = `${size}px ${font}, "Outfit", system-ui, sans-serif`;
  const w = m.measureText(text).width;
  const pad = size * 0.6;
  const c = canvas(w + pad * 2, size * 1.4 + pad * 2);
  const g = c.getContext('2d')!;
  g.font = m.font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = c.width / 2, cy = c.height / 2;
  g.save();
  g.shadowColor = colors[1];
  g.shadowBlur = size * 0.45;
  g.lineWidth = size * 0.14;
  g.strokeStyle = 'rgba(10,0,30,0.8)';
  g.strokeText(text, cx, cy);
  g.restore();
  const grd = g.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.45, colors[0]);
  grd.addColorStop(1, colors[1]);
  g.fillStyle = grd;
  g.fillText(text, cx, cy);
  return c;
}
