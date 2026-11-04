// "Board" gameplay renderer (default): silver lanes with a gentle tilt, dark raised key tiles with a
// glowing timing dash, a frosted PERFECT zone, a score circle at the top and equalizer edges.
// Same public interface as Renderer so the controller can use either.
import type { Judgment, Lane, TileSize } from '../types';
import type { RNote } from './session';
import type { FrameState, RenderOptions } from './renderer';
import { lowerBound, tempoScale } from './renderer';
import { Particles } from './particles';
import { glowSprite, rgba, roundRect, lighten, darken } from './sprites';
import { DIR_VEC, SIZE_SCALE, holdLanePos, sizeOf, sortedPath, isDiagonal } from './notes';
import { multiplierFor } from './scoring';

const JUDGE_TEXT: Record<Judgment, string> = { perfectPlus: 'PERFECT', perfect: 'PERFECT', great: 'GREAT', miss: 'MISS' };
const JUDGE_COLOR: Record<Judgment, string> = { perfectPlus: '#3dffc8', perfect: '#bff4ff', great: '#ffd84a', miss: '#ff4d5e' };

export class BoardRenderer {
  readonly g: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  cx = 0; hitY = 0; topY = 0; horizonY = 0; bw = 0; laneW = 0; noteW = 0; noteH = 0; zoneH = 0;
  k = 0; zBottom = -0.3;
  circleR = 0; circleY = 0;
  vis = 1.8;
  particles = new Particles();
  private clock = 0;
  private press = [0, 0, 0];
  private flash = [0, 0, 0];
  private popup: { j: Judgment; t0: number; plus: boolean } | null = null;
  private streak: { n: number; t0: number } | null = null;
  private banner: { text: string; sub?: string; t0: number; dur: number; color: string } | null = null;
  private shownScore = 0;
  private shake = 0;
  private gapCache: { notes: RNote[]; gap: Float32Array } | null = null;
  private targetHint = [0, 0, 0];
  private switchPop: { lane: number; t0: number } | null = null;
  private eq = new Float32Array(48);
  private touches: { x: number; y: number; t0: number }[] = [];
  private beams: { lane: number; t0: number; strong: boolean }[] = [];
  private circlePulse = 0;
  /** Visual ring at a touch / click point (canvas px). */
  onTouch(x: number, y: number) { this.touches.push({ x, y, t0: this.clock }); }
  /** Hit tiles flash white and pop where they were hit. */
  private shards: { x: number; y: number; w: number; h: number; t0: number }[] = [];

  constructor(public canvas: HTMLCanvasElement, public opts: RenderOptions & { theme: [string, string, string] }) {
    this.g = canvas.getContext('2d', { alpha: true, desynchronized: true } as CanvasRenderingContext2DSettings)!;
    this.setSpeed(opts.noteSpeed);
  }

  setSpeed(speed: number) {
    // time on screen scales with the song tempo, so tiles fall faster on faster songs
    this.vis = 2.3 / (0.5 + speed * 0.15) * tempoScale(this.opts?.bpm);
  }
  setOptions(o: Partial<RenderOptions>) { this.opts = { ...this.opts, ...o }; this.setSpeed(this.opts.noteSpeed); }

  private get accent() { return glowColor(this.opts.theme); }
  private get frame() { return this.opts.theme[0]; }

  resize(cssW: number, cssH: number, dpr: number) {
    this.w = cssW; this.h = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    const portrait = cssH > cssW * 1.05;
    const safeTop = Number(getComputedStyle(document.documentElement).getPropertyValue('--sat').replace('px', '')) || 0;
    if (portrait) {
      this.bw = Math.min(cssW * 0.96, cssH * 0.62);
      this.circleR = Math.min(cssW * 0.21, cssH * 0.1);
      this.hitY = cssH * 0.74;
    } else {
      this.bw = Math.min(cssH * 0.78, cssW * 0.56, 1100);
      this.circleR = Math.min(cssH * 0.12, 150);
      this.hitY = cssH * 0.76;
    }
    this.circleY = safeTop + this.circleR * 0.95 + 6;
    this.topY = this.circleY;
    this.cx = cssW / 2;
    // gentle tilt: lanes at the top are 82% of the width at the hit zone
    const topRatio = 0.82;
    this.k = 1 / topRatio - 1;
    this.horizonY = (this.topY - topRatio * this.hitY) / (1 - topRatio);
    this.laneW = this.bw / 3;
    this.noteW = this.laneW * 0.86;
    this.noteH = this.laneW * 0.8;
    this.zoneH = this.noteH * 1.05;
    const sBottom = (cssH - this.horizonY) / (this.hitY - this.horizonY);
    this.zBottom = (1 / sBottom - 1) / this.k;
    this.particles.scale = this.opts.particleScale;
  }

  scaleAt(z: number) { return 1 / (1 + z * this.k); }
  yAt(z: number) { return this.horizonY + (this.hitY - this.horizonY) * this.scaleAt(z); }
  xAt(u: number, z: number) { return this.cx + u * (this.bw / 2) * this.scaleAt(z); }
  laneU(l: number) { return -2 / 3 + l * (2 / 3); }
  zOf(dt: number) { return dt / this.vis; }
  /** Screen pixels per second of song time at the hit zone. */
  private get pps() { return (this.hitY - this.topY) / this.vis * 1.0; }

  // ---------- events ----------
  onJudge(lane: Lane, j: Judgment, delta: number, type: string, size: TileSize = 'regular') {
    // the tile breaks where it is (early taps break it above the bar)
    const z = j === 'miss' ? 0 : Math.max(this.zBottom, -delta / this.vis);
    const x = this.xAt(this.laneU(lane), z);
    const y = this.yAt(z);
    if (j !== 'miss') {
      this.flash[lane] = 1;
      this.beams.push({ lane, t0: this.clock, strong: j === 'perfectPlus' });
      this.circlePulse = 1;
      this.shards.push({ x, y, w: this.noteW * this.scaleAt(z), h: this.noteH * SIZE_SCALE[size] * this.scaleAt(z), t0: this.clock });
      const k = size === 'micro' ? 0.55 : size === 'half' ? 0.8 : 1;
      const s = this.laneW / 140;
      this.particles.burst(x, y, this.accent, Math.round(10 * k), 520 * s, 8 * s, { up: true, sparks: Math.round(8 * k), spread: 2.6 });
      if (type === 'swipe') this.particles.burst(x, y - this.noteH * 0.4, '#ffffff', 8, 900 * s, 7 * s, { up: true, sparks: 12, spread: 0.8 });
    } else {
      this.shake = Math.max(this.shake, 0.6);
    }
    this.popup = { j, t0: this.clock, plus: j === 'perfectPlus' };
    void delta;
  }
  onHoldEnd(lane: Lane, completed: boolean) {
    if (!completed) return;
    const x = this.xAt(this.laneU(lane), 0);
    this.flash[lane] = 1;
    this.particles.burst(x, this.hitY, '#ffffff', 10, 600 * (this.laneW / 140), 8 * (this.laneW / 140), { up: true, sparks: 10 });
  }
  onTransition(lane: Lane, _n: RNote) {
    this.flash[lane] = 1;
    this.switchPop = { lane, t0: this.clock };
    const x = this.xAt(this.laneU(lane), 0);
    this.particles.burst(x, this.hitY, this.accent, 8, 500 * (this.laneW / 140), 7 * (this.laneW / 140), { up: true, sparks: 8 });
  }
  onStage(n: number, total: number) {
    this.banner = { text: n === total ? 'FINAL STAGE' : `STAGE ${n}`, t0: this.clock, dur: 1.6, color: this.accent };
  }
  onMilestone(combo: number) { this.streak = { n: combo, t0: this.clock }; }
  onFullCombo(text: string) {
    this.banner = { text, t0: this.clock, dur: 3, color: '#ffd84a' };
    this.particles.confetti(this.cx, this.h * 0.15, this.bw, ['#ffd84a', this.accent, '#ffffff'], 110, this.laneW / 16);
  }
  onFail() { this.banner = { text: 'FAILED', sub: 'Classic mode — one miss ends the run', t0: this.clock, dur: 9, color: '#ff4d5e' }; this.shake = 1; }
  holdSparkle(_l: Lane) { /* handled inline */ }

  // ---------- frame ----------
  draw(s: FrameState) {
    const g = this.g;
    const dt = Math.min(0.05, s.dt);
    this.clock += dt;
    this.particles.update(dt);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    let ox = 0, oy = 0;
    if (this.shake > 0.01 && !this.opts.reducedMotion && this.opts.shake > 0) {
      const a = this.shake * this.opts.shake * this.laneW * 0.04;
      ox = (Math.random() - 0.5) * a; oy = (Math.random() - 0.5) * a;
    }
    this.shake *= Math.exp(-dt * 10);
    g.translate(ox, oy);

    this.drawBoard(s, dt);
    this.drawZone(s, dt);
    this.drawBeams();
    this.drawHolds(s);
    this.drawTiles(s);
    this.drawPressedKeys(s, dt);
    this.drawHitPops();
    g.save();
    g.globalCompositeOperation = 'lighter';
    this.particles.draw(g);
    g.restore();
    this.drawJudgement(s);
    this.drawBanner();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCircle(s, dt);
    if (s.countdown) this.drawCountdown(s.countdown);
    if (s.showFps) {
      g.font = '600 12px Outfit, system-ui';
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.textAlign = 'left';
      g.fillText(`${Math.round(s.fps)} fps`, 8, this.h - 8);
    }
  }

  private lanePoly(u0: number, u1: number, z0: number, z1: number) {
    const g = this.g;
    g.beginPath();
    g.moveTo(this.xAt(u0, z0), this.yAt(z0));
    g.lineTo(this.xAt(u0, z1), this.yAt(z1));
    g.lineTo(this.xAt(u1, z1), this.yAt(z1));
    g.lineTo(this.xAt(u1, z0), this.yAt(z0));
    g.closePath();
  }

  private drawBoard(s: FrameState, dt: number) {
    const g = this.g;
    const zb = this.zBottom, zt = 1;
    const yT = this.yAt(zt), yB = this.h;
    // outer frame (theme colour) with equalizer ticks
    const fw = this.laneW * 0.16;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(this.xAt(side * 1, zt), yT);
      g.lineTo(this.xAt(side * 1, zt) + side * fw * this.scaleAt(zt), yT);
      g.lineTo(this.xAt(side * 1, zb) + side * fw * this.scaleAt(zb), yB);
      g.lineTo(this.xAt(side * 1, zb), yB);
      g.closePath();
      const fg = g.createLinearGradient(0, yT, 0, yB);
      fg.addColorStop(0, rgba(this.frame, 0.35));
      fg.addColorStop(1, rgba(darken(this.frame, 0.2).replace('rgb(', '#').startsWith('#') ? this.frame : this.frame, 0.85));
      g.fillStyle = fg;
      g.fill();
    }
    // equalizer ticks along both edges, driven by the beat & song energy
    const n = 40;
    for (let i = 0; i < n; i++) {
      const target = 0.25 + s.intensity * 0.45 + s.beatPulse * 0.6 * (0.6 + 0.4 * Math.sin(i * 1.7 + this.clock * 3));
      this.eq[i] += (target - this.eq[i]) * Math.min(1, dt * 14);
    }
    const mult = multiplierFor(s.session.combo);
    g.fillStyle = mult >= 4 ? 'rgba(255,214,90,0.95)' : rgba(lighten(this.frame, 0.12 + mult * 0.12), 0.75 + mult * 0.06);
    for (let i = 0; i < n; i++) {
      const z = zt - (i / n) * (zt - zb);
      const y = this.yAt(z);
      const sc = this.scaleAt(z);
      const len = this.laneW * 0.11 * sc * (0.4 + this.eq[i]) * (0.85 + mult * 0.12);
      const th = Math.max(1.5, 3 * sc);
      for (const side of [-1, 1]) {
        const x = this.xAt(side * 1, z) + side * fw * sc * 0.25;
        g.fillRect(side > 0 ? x : x - len, y - th / 2, len, th);
      }
    }
    // lanes: brushed silver
    for (let l = 0; l < 3; l++) {
      const u0 = -1 + l * (2 / 3), u1 = u0 + 2 / 3;
      this.lanePoly(u0, u1, zb, zt);
      const lg = g.createLinearGradient(0, yT, 0, yB);
      lg.addColorStop(0, '#c9cdd3');
      lg.addColorStop(0.45, '#e6e8eb');
      lg.addColorStop(1, '#d2d6db');
      g.fillStyle = lg;
      g.fill();
      // soft inner shading on each lane
      const xg = g.createLinearGradient(this.xAt(u0, 0), 0, this.xAt(u1, 0), 0);
      xg.addColorStop(0, 'rgba(0,0,0,0.07)');
      xg.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      xg.addColorStop(1, 'rgba(0,0,0,0.07)');
      g.fillStyle = xg;
      g.fill();
    }
    // separators
    g.lineWidth = 2;
    for (let i = 0; i <= 3; i++) {
      const u = -1 + i * (2 / 3);
      g.strokeStyle = i === 0 || i === 3 ? 'rgba(40,44,52,0.55)' : 'rgba(120,126,136,0.55)';
      g.beginPath(); g.moveTo(this.xAt(u, zb), yB); g.lineTo(this.xAt(u, zt), yT); g.stroke();
    }
    // faint beat lines for motion
    const beats = s.beats;
    let bi = lowerBound(beats, s.t);
    g.lineWidth = 1;
    for (; bi < beats.length; bi++) {
      const z = this.zOf(beats[bi] - s.t);
      if (z > 1) break;
      const bar = (bi - s.downbeatPhase) % 4 === 0;
      g.strokeStyle = bar ? 'rgba(70,76,88,0.55)' : 'rgba(80,86,98,0.26)';
      g.lineWidth = (bar ? 3 : 1.5) * this.scaleAt(z);
      const y = this.yAt(z);
      g.beginPath(); g.moveTo(this.xAt(-1, z), y); g.lineTo(this.xAt(1, z), y); g.stroke();
    }
    // fade the far end into the circle
    const fade = g.createLinearGradient(0, yT, 0, yT + (this.hitY - yT) * 0.18);
    fade.addColorStop(0, rgba(this.frame, 0.45));
    fade.addColorStop(1, rgba(this.frame, 0));
    g.fillStyle = fade;
    g.fillRect(this.xAt(-1.2, zt), yT, this.xAt(1.2, zt) - this.xAt(-1.2, zt), (this.hitY - yT) * 0.18);
  }

  private drawZone(s: FrameState, dt: number) {
    const g = this.g;
    // pressed lanes glow below the zone
    const keys = s.inputHint === 'keyboard' || s.inputHint === 'gamepad';
    for (let l = 0; l < 3; l++) {
      const target = s.pressed[l] && keys ? 1 : 0;
      this.press[l] += (target - this.press[l]) * Math.min(1, dt * 22);
      this.flash[l] *= Math.exp(-dt * 6);
      const a = Math.max(this.press[l] * 0.85, keys ? this.flash[l] * 0.6 : 0);
      if (a < 0.02) continue;
      const u0 = -1 + l * (2 / 3), u1 = u0 + 2 / 3;
      const zTop = this.zOf(this.zoneH / 2 / this.pps) * -1;
      this.lanePoly(u0 + 0.01, u1 - 0.01, this.zBottom, -zTop);
      const lg = g.createLinearGradient(0, this.hitY, 0, this.h);
      lg.addColorStop(0, rgba(this.accent, 0.85 * a));
      lg.addColorStop(1, rgba(this.accent, 0.35 * a));
      g.fillStyle = lg;
      g.fill();
    }
    // frosted PERFECT zone
    const x0 = this.xAt(-1, 0) + 4, x1 = this.xAt(1, 0) - 4;
    const zh = this.zoneH;
    roundRect(g, x0, this.hitY - zh / 2, x1 - x0, zh, Math.min(14, zh * 0.12));
    const zg = g.createLinearGradient(0, this.hitY - zh / 2, 0, this.hitY + zh / 2);
    zg.addColorStop(0, 'rgba(255,255,255,0.62)');
    zg.addColorStop(1, 'rgba(236,240,246,0.5)');
    g.fillStyle = zg;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.stroke();
    // centre timing line with the label sitting on it
    g.font = `400 ${Math.max(10, this.laneW * 0.085)}px Outfit, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = 'P E R F E C T';
    const lw = g.measureText(label).width + this.laneW * 0.12;
    g.fillStyle = s.beatPulse > 0.05 ? rgba(darken(this.accent, 0.25), 0.4 + 0.6 * Math.min(1, s.beatPulse)) : 'rgba(120,128,140,0.55)';
    g.fillRect(x0 + 10, this.hitY - 1, this.cx - lw / 2 - x0 - 10, 2);
    g.fillRect(this.cx + lw / 2, this.hitY - 1, x1 - 10 - this.cx - lw / 2, 2);
    g.fillStyle = 'rgba(110,118,130,0.8)';
    g.fillText(label, this.cx, this.hitY + 1);
  }

  private drawPressedKeys(s: FrameState, _dt: number) {
    const g = this.g;
    const keys = s.inputHint === 'keyboard' || s.inputHint === 'gamepad';
    // touch / mouse: a ring where the finger landed (the tile itself is what you hit)
    this.touches = this.touches.filter((p) => this.clock - p.t0 < 0.3);
    for (const p of this.touches) {
      const k = (this.clock - p.t0) / 0.3;
      g.globalAlpha = 1 - k;
      g.lineWidth = 3;
      g.strokeStyle = this.accent;
      g.beginPath(); g.arc(p.x, p.y, this.laneW * (0.15 + 0.25 * k), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    for (let l = 0; l < 3; l++) {
      const a = keys ? Math.max(this.press[l], this.flash[l]) : 0;
      const x = this.xAt(this.laneU(l), 0);
      // keyboard hints on the zone
      if ((s.inputHint === 'keyboard' || s.inputHint === 'gamepad') && a < 0.3) {
        g.font = `600 ${Math.max(11, this.laneW * 0.09)}px Outfit, system-ui`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(80,88,100,0.55)';
        g.fillText(s.keyLabels[l] ?? '', x, this.hitY - this.zoneH * 0.3);
      }
      if (a < 0.03) continue;
      const w = this.noteW * 0.98, h = this.zoneH * 0.94;
      g.globalAlpha = Math.min(1, a * 1.2);
      roundRect(g, x - w / 2, this.hitY - h / 2, w, h, w * 0.12);
      g.fillStyle = 'rgba(255,255,255,0.96)';
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = rgba(this.accent, 0.95);
      g.stroke();
      g.globalAlpha = 1;
      if (this.targetHint[l] > 0.02) this.targetHint[l] *= 0.9;
    }
    // upcoming switch / rail target
    for (let l = 0; l < 3; l++) {
      if (this.targetHint[l] < 0.03) continue;
      const x = this.xAt(this.laneU(l), 0);
      const w = this.noteW, h = this.zoneH;
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 16);
      roundRect(g, x - w / 2 - 4 * pulse, this.hitY - h / 2 - 4 * pulse, w + 8 * pulse, h + 8 * pulse, w * 0.14);
      g.setLineDash([10, 7]);
      g.lineWidth = 3;
      g.strokeStyle = rgba(this.accent, 0.4 + 0.6 * this.targetHint[l]);
      g.stroke();
      g.setLineDash([]);
      this.targetHint[l] *= 0.92;
    }
    if (this.switchPop && this.clock - this.switchPop.t0 < 0.5) {
      const a = 1 - (this.clock - this.switchPop.t0) / 0.5;
      g.globalAlpha = a;
      g.font = `600 ${Math.max(12, this.laneW * 0.12)}px Outfit, system-ui`;
      g.textAlign = 'center';
      g.fillStyle = darken(this.accent, 0.35);
      g.fillText('SWITCH', this.xAt(this.laneU(this.switchPop.lane), 0), this.hitY - this.zoneH * 0.9);
      g.globalAlpha = 1;
    }
  }

  /** Light beam shooting up the lane on every hit. */
  private drawBeams() {
    if (this.opts.reducedMotion) { this.beams = []; return; }
    const g = this.g;
    this.beams = this.beams.filter((b) => this.clock - b.t0 < 0.32);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of this.beams) {
      const k = (this.clock - b.t0) / 0.32;
      const a = (1 - k) * (b.strong ? 0.55 : 0.32);
      const u0 = -1 + b.lane * (2 / 3) + 0.04, u1 = u0 + 2 / 3 - 0.08;
      const zTop = 0.15 + 0.85 * Math.min(1, k * 2.2);
      this.lanePoly(u0, u1, 0, zTop);
      const lg = g.createLinearGradient(0, this.yAt(zTop), 0, this.hitY);
      lg.addColorStop(0, rgba(this.accent, 0));
      lg.addColorStop(1, rgba(b.strong ? '#ffffff' : this.accent, a));
      g.fillStyle = lg;
      g.fill();
    }
    g.restore();
  }

  private drawHitPops() {
    const g = this.g;
    this.shards = this.shards.filter((p) => this.clock - p.t0 < 0.22);
    for (const p of this.shards) {
      const a = 1 - (this.clock - p.t0) / 0.22;
      const sc = 1 + (1 - a) * 0.25;
      g.globalAlpha = a;
      roundRect(g, p.x - (p.w * sc) / 2, p.y - (p.h * sc) / 2, p.w * sc, p.h * sc, p.w * 0.12);
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = rgba(this.accent, a);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** Same-lane gap per note (s) so tiles never overlap their neighbours. */
  private gaps(notes: RNote[]) {
    if (this.gapCache?.notes === notes) return this.gapCache.gap;
    const gap = new Float32Array(notes.length).fill(9);
    const last: (RNote | null)[] = [null, null, null];
    notes.forEach((n, i) => {
      const p = last[n.lane];
      if (p) {
        const d = n.t - (p.t + (p.dur ?? 0));
        gap[i] = Math.min(gap[i], d);
        gap[p.id] = Math.min(gap[p.id], d);
      }
      last[n.lane] = n;
    });
    this.gapCache = { notes, gap };
    return gap;
  }

  /** Raised dark key tile with timing dash / arrow. (x, y) = centre at the timing point. */
  private tile(x: number, y: number, w: number, h: number, kind: 'tap' | 'swipe' | 'hold', dir: string | undefined, alpha: number, dead = false) {
    const g = this.g;
    const r = Math.min(w * 0.12, h * 0.3);
    const depth = Math.max(3, h * 0.07);
    g.globalAlpha = alpha;
    // side / thickness
    roundRect(g, x - w / 2, y - h / 2 + depth, w, h, r);
    g.fillStyle = '#07080a';
    g.fill();
    // face
    roundRect(g, x - w / 2, y - h / 2, w, h, r);
    const fg = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    fg.addColorStop(0, dead ? '#55585e' : '#2b3036');
    fg.addColorStop(1, dead ? '#3c3f44' : '#14171b');
    g.fillStyle = fg;
    g.fill();
    g.lineWidth = Math.max(1, w * 0.012);
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.stroke();
    // top-edge highlight
    g.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(g, x - w / 2 + 3, y - h / 2 + 2, w - 6, Math.min(h * 0.18, 12), r * 0.6);
    g.fill();
    const col = dead ? '#9aa0a8' : kind === 'swipe' && isDiagonal(dir as never) ? '#ffd84a' : this.accent;
    if (kind === 'swipe') {
      const v = DIR_VEC[(dir ?? 'up') as keyof typeof DIR_VEC];
      const s = Math.min(w, h) * 0.32;
      const ang = Math.atan2(v[1], v[0]);
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      if (!dead) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha * 0.7;
        g.drawImage(glowSprite(col), -s * 1.6, -s * 1.6, s * 3.2, s * 3.2);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = alpha;
      }
      g.strokeStyle = dead ? col : '#ffffff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = Math.max(3, s * 0.26);
      g.beginPath();
      g.moveTo(-s, 0); g.lineTo(s * 0.9, 0);
      g.moveTo(s * 0.25, -s * 0.65); g.lineTo(s * 0.95, 0); g.lineTo(s * 0.25, s * 0.65);
      g.stroke();
      g.strokeStyle = rgba(col, 0.9);
      g.lineWidth = Math.max(1.5, s * 0.1);
      g.stroke();
      g.restore();
    } else {
      // glowing timing dash
      const dw = w * 0.58, dh = Math.max(3, Math.min(h * 0.09, w * 0.07));
      if (!dead) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha * 0.85;
        g.drawImage(glowSprite(col), x - dw * 0.75, y - dh * 4, dw * 1.5, dh * 8);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = alpha;
      }
      roundRect(g, x - dw / 2, y - dh / 2, dw, dh, dh / 2);
      g.fillStyle = dead ? col : '#ffffff';
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /** Height (px, before perspective) a tile is drawn at. */
  private tileH(n: RNote, gaps: Float32Array) {
    const size = n.type === 'tap' ? sizeOf(n) : 'regular';
    let h = this.noteH * SIZE_SCALE[size];
    h = Math.min(h, gaps[n.id] * this.pps * 0.88);
    return Math.max(h, this.noteH * 0.22);
  }

  /**
   * The tile under a touch point (canvas px), or null. Tiles are the hitbox: a touch anywhere on a
   * tile in the lower part of the board hits it, however far it still is from the PERFECT bar.
   */
  noteAt(px: number, py: number, notes: RNote[], first: number, t: number): RNote | null {
    if (px < -1000) return null;
    const gaps = this.gaps(notes);
    let best: RNote | null = null;
    for (let i = first; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t + this.vis) break;
      if (n.judged !== null || n.t < t - 0.18) continue;
      const z = this.zOf(n.t - t);
      if (z > 1) continue;
      const sc = this.scaleAt(z);
      const cx = this.xAt(this.laneU(n.lane), z), cy = this.yAt(z);
      const w = this.noteW * sc * 1.12;
      let top = cy - (this.tileH(n, gaps) * sc) / 2, bottom = cy + (this.tileH(n, gaps) * sc) / 2;
      const padY = Math.max(this.laneW * 0.18 * sc, ((this.laneW * 0.55 * sc) - (bottom - top)) / 2);
      top -= padY; bottom += padY;
      if (n.type === 'hold' && n.dur) top = Math.min(top, this.yAt(Math.min(1, this.zOf(n.t + n.dur - t))));
      if (px >= cx - w / 2 && px <= cx + w / 2 && py >= top && py <= bottom) {
        if (!best || n.t < best.t) best = n;
      }
    }
    return best;
  }

  private drawTiles(s: FrameState) {
    const end = s.t + this.vis * 1.08;
    let last = s.firstVisible;
    while (last < s.notes.length && s.notes[last].t <= end) last++;
    const gaps = this.gaps(s.notes);
    for (let i = last - 1; i >= s.firstVisible; i--) {
      const n = s.notes[i];
      if (n.type === 'hold') continue;
      if (n.judged && n.judged !== 'miss') continue;
      const z = this.zOf(n.t - s.t);
      if (z < this.zBottom - 0.1) continue;
      let alpha = Math.min(1, (1.06 - z) * 6);
      if (n.judged === 'miss') { alpha *= Math.max(0, 1 + z * 3) * 0.6; if (alpha <= 0.01) continue; }
      const sc = this.scaleAt(z);
      const h = this.tileH(n, gaps) * sc;
      const w = this.noteW * sc;
      this.tile(this.xAt(this.laneU(n.lane), z), this.yAt(z), w, h, n.type === 'swipe' ? 'swipe' : 'tap', n.dir, alpha, n.judged === 'miss');
      if (n.type === 'swipe' && !n.judged && s.inputHint === 'keyboard' && s.dirKeyLabels) {
        const label = s.dirKeyLabels[n.dir ?? 'up'];
        if (label) {
          const g = this.g;
          const fs = Math.max(11, w * 0.14);
          const x = this.xAt(this.laneU(n.lane), z) + w / 2 - fs * 1.1, y = this.yAt(z) - h / 2 + fs * 0.95;
          roundRect(g, x - fs * 0.7, y - fs * 0.62, fs * 1.4, fs * 1.24, fs * 0.3);
          g.fillStyle = 'rgba(255,255,255,0.92)';
          g.fill();
          g.font = `800 ${fs}px Outfit, system-ui`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = '#14171b';
          g.fillText(label, x, y + fs * 0.04);
        }
      }
    }
  }

  private drawHolds(s: FrameState) {
    const g = this.g;
    const end = s.t + this.vis * 1.05;
    for (let i = s.firstVisible; i < s.notes.length; i++) {
      const n = s.notes[i];
      if (n.t > end) break;
      if (n.type !== 'hold' || !n.dur) continue;
      const tail = n.t + n.dur;
      if (tail < s.t - 0.3 || n.holdState === 'done') continue;
      const holding = n.holdState === 'holding';
      const dead = n.holdState === 'broken' || n.holdState === 'missed';
      const t0 = holding ? s.t : n.t;
      const tEnd = Math.min(tail, s.t + this.vis * 1.02);
      const capH = this.noteH * 0.5;
      // body: a long dark key following the lane path
      const steps = Math.max(8, Math.ceil(((tEnd - t0) / this.vis) * 30));
      const L: [number, number][] = [], R: [number, number][] = [], M: [number, number][] = [];
      for (let j = 0; j <= steps; j++) {
        const tt = t0 + ((tEnd - t0) * j) / steps;
        const z = this.zOf(tt - s.t);
        const u = this.laneU(holdLanePos(n, tt));
        const half = (this.noteW / this.bw) * 1.0;
        const y = this.yAt(z);
        L.push([this.xAt(u - half, z), y]); R.push([this.xAt(u + half, z), y]); M.push([this.xAt(u, z), y]);
      }
      // extend the head and tail by half a tile so the hold reads as one long key
      const headExt = holding ? this.zoneH * 0.45 : capH;
      const tailExt = capH * this.scaleAt(this.zOf(tEnd - s.t));
      g.beginPath();
      g.moveTo(L[0][0], L[0][1] + headExt);
      L.forEach(([x, y]) => g.lineTo(x, y));
      g.lineTo(L[L.length - 1][0], L[L.length - 1][1] - tailExt);
      g.lineTo(R[R.length - 1][0], R[R.length - 1][1] - tailExt);
      for (let j = R.length - 1; j >= 0; j--) g.lineTo(R[j][0], R[j][1]);
      g.lineTo(R[0][0], R[0][1] + headExt);
      g.closePath();
      const bg = g.createLinearGradient(0, M[M.length - 1][1], 0, M[0][1]);
      bg.addColorStop(0, dead ? 'rgba(80,84,90,0.6)' : '#1d2126');
      bg.addColorStop(1, dead ? 'rgba(80,84,90,0.8)' : holding ? darken(this.accent, 0.55) : '#14171b');
      g.fillStyle = bg;
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.2)';
      g.lineWidth = 1.5;
      g.stroke();
      // glowing centre line
      const col = dead ? '#9aa0a8' : this.accent;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (!dead) {
        g.strokeStyle = rgba(col, 0.45);
        g.lineWidth = Math.max(6, this.noteW * 0.09);
        g.beginPath(); M.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      }
      g.strokeStyle = dead ? col : '#ffffff';
      g.lineWidth = Math.max(2.5, this.noteW * 0.035);
      g.beginPath(); M.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      // dashes at head and tail
      const dash = (x: number, y: number, sc: number) => {
        const dw = this.noteW * 0.5 * sc, dh = Math.max(3, this.noteW * 0.05 * sc);
        roundRect(g, x - dw / 2, y - dh / 2, dw, dh, dh / 2);
        g.fillStyle = dead ? col : '#ffffff';
        g.fill();
      };
      if (!holding) dash(M[0][0], M[0][1], this.scaleAt(this.zOf(t0 - s.t)));
      if (tEnd >= tail - 1e-3) dash(M[M.length - 1][0], M[M.length - 1][1], this.scaleAt(this.zOf(tail - s.t)));
      // switch connectors
      let lane = n.lane;
      for (const p of sortedPath(n)) {
        const from = lane;
        lane = p.lane;
        if ((p.slide ?? 0) > 0 || p.t < t0 || p.t > tEnd) continue;
        const z = this.zOf(p.t - s.t);
        const y = this.yAt(z), sc = this.scaleAt(z);
        const xa = this.xAt(this.laneU(from), z), xb = this.xAt(this.laneU(p.lane), z);
        const hh = this.noteW * 0.16 * sc;
        roundRect(g, Math.min(xa, xb) - hh, y - hh / 2, Math.abs(xb - xa) + hh * 2, hh, hh / 2);
        g.fillStyle = dead ? col : '#ffffff';
        g.fill();
      }
      if (holding) {
        const next = sortedPath(n)[n.pathIdx ?? 0];
        if (next && next.t - s.t < 0.9) this.targetHint[next.lane] = Math.max(this.targetHint[next.lane], 1 - Math.max(0, next.t - s.t) / 0.9);
        if (Math.random() < 0.5) {
          const x = this.xAt(this.laneU(holdLanePos(n, s.t)), 0), sc = this.laneW / 140;
          this.particles.spawn(x + (Math.random() - 0.5) * this.noteW * 0.5, this.hitY, (Math.random() - 0.5) * 60 * sc, -220 * sc * (0.5 + Math.random()), 0.35, 6 * sc, this.accent, Math.random() < 0.5 ? 1 : 0, 0);
        }
      }
    }
  }

  private drawJudgement(s: FrameState) {
    if (!s.showJudgments) return;
    const g = this.g;
    const fs0 = Math.min(64, this.laneW * 0.32);
    const y = Math.max(this.topY + (this.hitY - this.topY) * 0.24, this.circleY + this.circleR * 1.45 + fs0 * 0.7);
    const p = this.popup;
    if (p && this.clock - p.t0 < 0.55) {
      const age = this.clock - p.t0;
      const a = age > 0.35 ? 1 - (age - 0.35) / 0.2 : 1;
      const sc = this.opts.reducedMotion ? 1 : age < 0.07 ? 1.15 - age * 2 : 1;
      const fs = Math.min(64, this.laneW * 0.32) * sc;
      g.globalAlpha = Math.max(0, a);
      // light streak across the board
      const sg = g.createLinearGradient(this.xAt(-1.15, 1), 0, this.xAt(1.15, 1), 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, rgba(JUDGE_COLOR[p.j], 0.9));
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sg;
      g.fillRect(this.xAt(-1.15, 1), y - 1.5, this.xAt(1.15, 1) - this.xAt(-1.15, 1), 3);
      g.font = `300 ${fs}px Outfit, system-ui`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const text = JUDGE_TEXT[p.j];
      g.lineWidth = Math.max(2, fs * 0.08);
      g.strokeStyle = 'rgba(10,20,24,0.55)';
      const spaced = text.split('').join(String.fromCharCode(8202));
      g.strokeText(spaced, this.cx, y);
      g.fillStyle = JUDGE_COLOR[p.j];
      g.fillText(spaced, this.cx, y);
      const tw = g.measureText(spaced).width;
      if (p.plus) {
        g.font = `300 ${fs * 0.55}px Outfit, system-ui`;
        g.fillText('+', this.cx + tw / 2 + fs * 0.18, y - fs * 0.42);
      }
      // side dashes
      g.fillStyle = JUDGE_COLOR[p.j];
      g.fillRect(this.cx - tw / 2 - fs * 0.9, y - 1, fs * 0.5, 2);
      g.fillRect(this.cx + tw / 2 + fs * 0.4, y - 1, fs * 0.5, 2);
      g.globalAlpha = 1;
    }
    if (this.streak && this.clock - this.streak.t0 < 1.4) {
      const age = this.clock - this.streak.t0;
      g.globalAlpha = age > 1 ? 1 - (age - 1) / 0.4 : 1;
      g.font = `700 ${Math.min(36, this.laneW * 0.17)}px Outfit, system-ui`;
      g.textAlign = 'center';
      g.fillStyle = '#ffc93a';
      g.fillText(`${this.streak.n} STREAK`, this.cx, y + Math.min(64, this.laneW * 0.32) * 0.75);
      g.globalAlpha = 1;
    }
  }

  private drawBanner() {
    const b = this.banner;
    if (!b) return;
    const age = this.clock - b.t0;
    if (age > b.dur) { this.banner = null; return; }
    const g = this.g;
    const a = Math.min(1, age / 0.2) * (age > b.dur - 0.3 ? (b.dur - age) / 0.3 : 1);
    const y = this.topY + (this.hitY - this.topY) * 0.42;
    g.globalAlpha = a;
    g.font = `300 ${Math.min(58, this.laneW * 0.3)}px Outfit, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(10,10,20,0.6)';
    g.strokeText(b.text, this.cx, y);
    g.fillStyle = b.color;
    g.fillText(b.text, this.cx, y);
    if (b.sub) {
      g.font = `500 ${Math.min(18, this.laneW * 0.09)}px Outfit, system-ui`;
      g.fillStyle = '#ffffff';
      g.fillText(b.sub, this.cx, y + Math.min(58, this.laneW * 0.3) * 0.75);
    }
    g.globalAlpha = 1;
  }

  /** Score circle: stage, score, multiplier and progress to the next multiplier. */
  private drawCircle(s: FrameState, dt: number) {
    const g = this.g;
    this.circlePulse *= Math.exp(-dt * 9);
    const R = this.circleR * (1 + (this.opts.reducedMotion ? 0 : this.circlePulse * 0.035)), cx = this.cx, cy = this.circleY;
    this.shownScore += (s.session.score - this.shownScore) * Math.min(1, dt * 12);
    // equalizer ticks either side
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 26; i++) {
      const hgt = R * (0.08 + 0.12 * Math.max(0, this.eq[i % this.eq.length]));
      for (const side of [-1, 1]) {
        const x = cx + side * (R * 1.12 + i * R * 0.07);
        g.fillRect(x - 1, cy - hgt, 2, hgt * 2);
      }
    }
    // ring
    g.beginPath(); g.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
    g.fillStyle = darken(this.frame, 0.35);
    g.fill();
    g.beginPath(); g.arc(cx, cy, R * 0.86, 0, Math.PI * 2);
    g.fillStyle = '#111316';
    g.fill();
    const combo = s.session.combo;
    const mult = multiplierFor(combo);
    const tiers = [0, 10, 30, 60];
    const lo = tiers[mult - 1], hi = tiers[mult] ?? 60;
    const prog = mult >= 4 ? 1 : (combo - lo) / (hi - lo);
    g.lineCap = 'round';
    g.lineWidth = Math.max(3, R * 0.05);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(cx, cy, R * 0.66, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
    g.strokeStyle = mult >= 4 ? '#ffc93a' : lighten(this.accent, 0.1);
    g.beginPath(); g.arc(cx, cy, R * 0.66, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * Math.max(0.001, prog))); g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const before = s.session.judgedCount === 0 && s.cover;
    if (before) {
      g.save();
      g.beginPath(); g.arc(cx, cy, R * 0.86, 0, Math.PI * 2); g.clip();
      g.drawImage(s.cover!, cx - R * 0.86, cy - R * 0.86, R * 1.72, R * 1.72);
      g.restore();
    } else {
      g.fillStyle = lighten(this.accent, 0.2);
      g.font = `500 ${R * 0.14}px Outfit, system-ui`;
      g.fillText(s.stage >= 4 ? 'FINAL STAGE' : `STAGE ${s.stage + 1}`, cx, cy - R * 0.36);
      g.fillStyle = '#ffffff';
      g.font = `300 ${R * 0.34}px Outfit, system-ui`;
      g.fillText(Math.round(this.shownScore).toLocaleString('en-US'), cx, cy + R * 0.02);
      g.fillStyle = '#ffc93a';
      g.font = `400 ${R * 0.2}px Outfit, system-ui`;
      g.fillText(`x${mult}`, cx, cy + R * 0.38);
    }
    // difficulty pill
    const label = s.diffLabel;
    g.font = `500 ${Math.max(11, R * 0.15)}px Outfit, system-ui`;
    const tw = g.measureText(label).width + R * 0.4;
    const ph = Math.max(20, R * 0.26);
    roundRect(g, cx - tw / 2, cy + R * 0.98, tw, ph, ph / 2);
    g.fillStyle = s.diffColor;
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillText(label, cx, cy + R * 0.98 + ph / 2 + 1);
    // thin song progress around the ring
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(cx, cy, R * 1.08, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, s.songProgress)));
    g.stroke();
  }

  private drawCountdown(text: string) {
    const g = this.g;
    const y = this.topY + (this.hitY - this.topY) * 0.45;
    g.font = `300 ${Math.min(120, this.laneW * 0.6)}px Outfit, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(10,10,20,0.55)';
    g.strokeText(text, this.cx, y);
    g.fillStyle = '#ffffff';
    g.fillText(text, this.cx, y);
  }
}

/** Bright glow colour derived from the song theme (keeps the dash readable on dark tiles). */
function glowColor(theme: [string, string, string]): string {
  const pick = [theme[0], theme[2], theme[1]].map((c) => {
    const v = parseInt(c.replace('#', ''), 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return { c, sat: mx ? (mx - mn) / mx : 0, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  }).sort((a, b) => b.sat * (b.lum > 60 ? 1 : 0.3) - a.sat * (a.lum > 60 ? 1 : 0.3))[0];
  const v = parseInt(pick.c.replace('#', ''), 16);
  let r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 140) { const k = (140 - lum) / 255 + 0.15; r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k); }
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
