// Pooled particle system using typed arrays and additive sprite rendering.
import { glowSprite, sparkSprite } from './sprites';

const MAX = 1400;

export class Particles {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private kind = new Uint8Array(MAX); // 0 glow dot, 1 spark, 2 confetti
  private color: string[] = new Array(MAX).fill('#ffffff');
  private grav = new Float32Array(MAX);
  private n = 0;
  limit = MAX;
  scale = 1;

  get count() { return this.n; }

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, kind = 0, grav = 0) {
    if (this.n >= this.limit) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.color[i] = color; this.kind[i] = kind; this.grav[i] = grav;
  }

  burst(x: number, y: number, color: string, count: number, speed: number, size: number, opts: { up?: boolean; sparks?: number; spread?: number } = {}) {
    const c = Math.round(count * this.scale);
    for (let k = 0; k < c; k++) {
      const a = opts.up ? -Math.PI / 2 + (Math.random() - 0.5) * (opts.spread ?? 2.2) : Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.45, size * (0.5 + Math.random()), color, 0, speed * 0.9);
    }
    const sp = Math.round((opts.sparks ?? count * 0.6) * this.scale);
    for (let k = 0; k < sp; k++) {
      const a = opts.up ? -Math.PI / 2 + (Math.random() - 0.5) * (opts.spread ?? 2.4) : Math.random() * Math.PI * 2;
      const s = speed * (0.9 + Math.random() * 1.4);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.22 + Math.random() * 0.3, size * (1.2 + Math.random()), color, 1, speed * 1.4);
    }
  }

  confetti(x: number, y: number, w: number, colors: string[], count: number, size: number) {
    const c = Math.round(count * this.scale);
    for (let k = 0; k < c; k++) {
      this.spawn(x + (Math.random() - 0.5) * w, y, (Math.random() - 0.5) * size * 8, -size * (6 + Math.random() * 14), 1.4 + Math.random() * 1.2,
        size * (0.6 + Math.random() * 0.8), colors[k % colors.length], 2, size * 16);
    }
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
        this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j];
        this.color[i] = this.color[j]; this.kind[i] = this.kind[j]; this.grav[i] = this.grav[j];
        continue;
      }
      const drag = this.kind[i] === 2 ? 0.985 : 0.94;
      this.vx[i] *= Math.pow(drag, dt * 60);
      this.vy[i] = this.vy[i] * Math.pow(drag, dt * 60) + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  draw(g: CanvasRenderingContext2D) {
    if (!this.n) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i];
      const k = this.kind[i];
      g.globalAlpha = Math.min(1, t * 1.6);
      if (k === 1) {
        const ang = Math.atan2(this.vy[i], this.vx[i]);
        const len = s * 3.2 * (0.4 + t);
        g.setTransform(Math.cos(ang), Math.sin(ang), -Math.sin(ang), Math.cos(ang), this.x[i], this.y[i]);
        g.drawImage(sparkSprite(this.color[i]), -len, -s * 0.4, len, s * 0.8);
        g.setTransform(1, 0, 0, 1, 0, 0);
      } else if (k === 2) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = this.color[i];
        const r = (this.life[i] * 7 + i) % (Math.PI * 2);
        g.setTransform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), this.x[i], this.y[i]);
        g.fillRect(-s / 2, -s / 4, s, s / 2 * Math.abs(Math.sin(this.life[i] * 9 + i)) + 1);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'lighter';
      } else {
        const r = s * (0.6 + 0.6 * t);
        g.drawImage(glowSprite(this.color[i]), this.x[i] - r, this.y[i] - r, r * 2, r * 2);
      }
    }
    g.restore();
  }

  clear() { this.n = 0; }
}
