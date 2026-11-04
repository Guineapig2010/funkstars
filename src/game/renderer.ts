// Canvas2D gameplay renderer: perspective three-lane highway, notes, holds, swipes, particles,
// judgement feedback and the responsive HUD (side panels on wide screens, top bar on portrait).
import type { Judgment, Lane, TileSize } from '../types';
import { DIR_VEC, SIZE_SCALE, holdLanePos, sizeOf, sortedPath } from './notes';
import type { RNote, GameSession } from './session';
import { Particles } from './particles';
import { glowSprite, noteSprite, rgba, roundRect, textSprite, lighten, type Sprite } from './sprites';
import type { NoteSkin } from '../store/settings';
import { STAR_THRESHOLDS } from './scoring';

export interface FrameState {
  t: number;
  dt: number;
  notes: RNote[];
  firstVisible: number;
  beats: number[];
  downbeatPhase: number;
  session: GameSession;
  pressed: boolean[];
  stage: number;
  songProgress: number;
  intensity: number;
  beatPulse: number;
  countdown: string | null;
  inputHint: 'keyboard' | 'touch' | 'gamepad' | 'mouse';
  keyLabels: string[];
  /** Keyboard key shown on swipe tiles for each direction. */
  dirKeyLabels?: Partial<Record<string, string>>;
  title: string;
  artist: string;
  diffLabel: string;
  diffColor: string;
  modeLabel: string;
  cover: HTMLCanvasElement | null;
  fps: number;
  showFps: boolean;
  showJudgments: boolean;
  showAccuracy: boolean;
  showEarlyLate: boolean;
  laneFlash: boolean;
}

export interface RenderOptions {
  laneColors: [string, string, string];
  swipeColor: string;
  accent: string;
  skin: NoteSkin;
  noteSpeed: number;
  reducedMotion: boolean;
  shake: number;
  particleScale: number;
  highContrast: boolean;
  /** true = 3D road with perspective; false = flat board with big tiles. */
  perspective: boolean;
  /** Song tempo: the board scrolls in step with it (one beat = the same distance in every song). */
  bpm?: number;
}

const JCOLORS: Record<Judgment, [string, string]> = {
  perfectPlus: ['#fff6a8', '#ff5ce1'],
  perfect: ['#c8fbff', '#2fc8ff'],
  great: ['#d6ffcf', '#3be36b'],
  miss: ['#ffd0d0', '#ff3b3b'],
};
const JTEXT: Record<Judgment, string> = { perfectPlus: 'PERFECT+', perfect: 'PERFECT', great: 'GREAT', miss: 'MISS' };

interface Popup { j: Judgment; t0: number; delta: number }
interface Ring { x: number; y: number; t0: number; color: string; r: number; dur: number }
interface Banner { text: string; sub?: string; t0: number; dur: number; color: string }

export class Renderer {
  readonly g: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  portrait = false;
  cx = 0; hitY = 0; topY = 0; horizonY = 0; bw = 0; laneW = 0; noteW = 0; noteH = 0;
  topRatio = 0.42;
  k = 1;
  zBottom = -0.2;
  particles = new Particles();
  private sprites = new Map<string, { img: Sprite; pad: number }>();
  private jSprites = new Map<string, Sprite>();
  private flash = [0, 0, 0];
  private flashColor: string[] = ['#fff', '#fff', '#fff'];
  private pop = [0, 0, 0];
  private rings: Ring[] = [];
  private popup: Popup | null = null;
  private banner: Banner | null = null;
  private edge = [0, 0];
  private shakeV = 0;
  private screenFlash = 0;
  private comboPop = 0;
  private shownScore = 0;
  private clock = 0;
  private lastStarCount = 0;
  private starPop = [0, 0, 0, 0, 0];
  private holdSpark = [0, 0, 0];
  private hudGrad: CanvasGradient | null = null;
  vis = 2;

  constructor(public canvas: HTMLCanvasElement, public opts: RenderOptions) {
    this.g = canvas.getContext('2d', { alpha: true, desynchronized: true } as CanvasRenderingContext2DSettings)!;
    this.setSpeed(opts.noteSpeed);
  }

  setSpeed(speed: number) {
    this.vis = 2.6 / (0.5 + speed * 0.15) * tempoScale(this.opts?.bpm);
  }

  setOptions(o: Partial<RenderOptions>) {
    this.opts = { ...this.opts, ...o };
    this.setSpeed(this.opts.noteSpeed);
    this.sprites.clear();
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.w = cssW; this.h = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.portrait = cssH > cssW * 1.05;
    const mobileLandscape = !this.portrait && cssH < 560;
    const flat = !this.opts.perspective;
    if (flat) {
      // flat board: straight lanes, big full-width tiles, no shrinking with distance
      if (this.portrait) { this.bw = Math.min(cssW, cssH * 0.62); this.hitY = cssH * 0.82; this.topY = cssH * 0.12; }
      else if (mobileLandscape) { this.bw = Math.min(cssH * 0.95, cssW * 0.46); this.hitY = cssH * 0.84; this.topY = 0; }
      else { this.bw = Math.min(cssH * 0.9, cssW * 0.5, 1100); this.hitY = cssH * 0.86; this.topY = 0; }
      this.topRatio = 1;
    } else if (this.portrait) {
      this.bw = Math.min(cssW * 0.98, cssH * 0.7);
      this.hitY = cssH * 0.8;
      this.topY = cssH * 0.135;
      this.topRatio = 0.5;
    } else if (mobileLandscape) {
      this.bw = Math.min(cssH * 1.05, cssW * 0.5);
      this.hitY = cssH * 0.83;
      this.topY = cssH * 0.0;
      this.topRatio = 0.48;
    } else {
      this.bw = Math.min(cssH * 0.68, cssW * 0.46, 980);
      this.hitY = cssH * 0.845;
      this.topY = cssH * 0.02;
      this.topRatio = 0.42;
    }
    this.cx = cssW / 2;
    this.laneW = this.bw / 3;
    if (flat) {
      this.k = 0;
      this.horizonY = this.topY;
      this.noteW = this.laneW * 0.9;
      this.noteH = this.laneW * 0.5;
      this.zBottom = -(cssH - this.hitY) / (this.hitY - this.topY);
    } else {
      this.k = 1 / this.topRatio - 1;
      this.horizonY = (this.topY - this.topRatio * this.hitY) / (1 - this.topRatio);
      this.noteW = this.laneW * 0.84;
      this.noteH = this.laneW * 0.32;
      // z at the bottom edge of the screen
      const sBottom = (cssH - this.horizonY) / (this.hitY - this.horizonY);
      this.zBottom = (1 / sBottom - 1) / this.k;
    }
    this.sprites.clear();
    this.hudGrad = null;
    this.particles.scale = this.opts.particleScale;
  }

  // ---------- projection ----------
  scaleAt(z: number) { return this.k === 0 ? 1 : 1 / (1 + z * this.k); }
  yAt(z: number) { return this.k === 0 ? this.hitY - z * (this.hitY - this.topY) : this.horizonY + (this.hitY - this.horizonY) * this.scaleAt(z); }
  /** x of lane-relative offset u (-1 left edge .. 1 right edge). */
  xAt(u: number, z: number) { return this.cx + u * (this.bw / 2) * this.scaleAt(z); }
  laneU(l: number) { return -2 / 3 + l * (2 / 3); }
  zOf(dt: number) { return dt / this.vis; }

  // ---------- events from the controller ----------
  onJudge(lane: Lane, j: Judgment, delta: number, type: string, size: TileSize = 'regular') {
    const x = this.xAt(this.laneU(lane), 0);
    const k = size === 'micro' ? 0.5 : size === 'half' ? 0.75 : 1;
    const y = this.hitY;
    const color = this.opts.laneColors[lane];
    if (j !== 'miss') {
      this.flash[lane] = 1;
      this.flashColor[lane] = j === 'perfectPlus' ? '#ffffff' : color;
      this.pop[lane] = 1;
      const big = j === 'perfectPlus';
      const s = (this.laneW / 120) * (0.6 + 0.4 * k);
      this.particles.burst(x, y, big ? lighten(color, 0.35) : color, Math.round((big ? 14 : 8) * k), 520 * s, 9 * s, { up: true, sparks: Math.round((big ? 12 : 6) * k) });
      if (big) this.particles.burst(x, y, '#fff3b0', 4, 300 * s, 6 * s, { up: true, sparks: 6, spread: 1.2 });
      if (type === 'swipe') this.particles.burst(x, y - this.noteH, '#ffffff', 10, 900 * s, 7 * s, { up: true, sparks: 14, spread: 0.9 });
      this.rings.push({ x, y, t0: this.clock, color: big ? '#ffffff' : color, r: this.laneW * (big ? 0.5 : 0.4) * (0.6 + 0.4 * k), dur: 0.3 });
      this.edge[lane === 0 ? 0 : lane === 2 ? 1 : this.edge[0] > this.edge[1] ? 1 : 0] = Math.min(1, 0.35 + this.edge[0] * 0.2);
      this.comboPop = 1;
    } else {
      this.shakeV = Math.max(this.shakeV, 0.5);
    }
    this.popup = { j, t0: this.clock, delta };
  }
  onHoldEnd(lane: Lane, completed: boolean) {
    if (!completed) return;
    const x = this.xAt(this.laneU(lane), 0);
    this.particles.burst(x, this.hitY, '#ffffff', 10, 600 * (this.laneW / 120), 8 * (this.laneW / 120), { up: true, sparks: 10 });
    this.rings.push({ x, y: this.hitY, t0: this.clock, color: this.opts.laneColors[lane], r: this.laneW * 0.6, dur: 0.35 });
  }
  onStage(n: number, total: number) {
    this.banner = { text: n === total ? 'FINAL STAGE' : `STAGE ${n}`, sub: n === total ? 'Finish strong!' : ['', 'Warm up', 'Find the groove', 'Turn it up', 'Full power'][n - 1] ?? '', t0: this.clock, dur: 1.9, color: this.opts.accent };
    this.screenFlash = this.opts.reducedMotion ? 0 : 0.18;
    this.shakeV = Math.max(this.shakeV, 0.35);
    this.particles.confetti(this.cx, this.h * 0.2, this.bw, this.opts.laneColors, 40, this.laneW / 18);
  }
  onMilestone(combo: number) {
    this.banner = { text: `${combo} COMBO`, t0: this.clock, dur: 1.2, color: '#ffd23f' };
    this.edge = [1, 1];
  }
  onFullCombo(text: string) {
    this.banner = { text, t0: this.clock, dur: 3, color: '#4df3ff' };
    this.particles.confetti(this.cx, this.h * 0.1, this.w * 0.8, ['#ffd23f', '#4df3ff', '#ff5ce1', '#ffffff'], 120, this.laneW / 14);
    this.screenFlash = this.opts.reducedMotion ? 0 : 0.2;
  }
  onFail() {
    this.banner = { text: 'FAILED', sub: 'Classic mode — one miss ends the run', t0: this.clock, dur: 9, color: '#ff3b3b' };
    this.shakeV = 1;
  }
  holdSparkle(lane: Lane) { this.holdSpark[lane] = 1; }

  // ---------- frame ----------
  draw(s: FrameState) {
    const g = this.g;
    const dt = Math.min(0.05, s.dt);
    this.clock += dt;
    this.particles.update(dt);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    // screen shake
    let sx = 0, sy = 0;
    if (this.shakeV > 0.01 && !this.opts.reducedMotion && this.opts.shake > 0) {
      const a = this.shakeV * this.opts.shake * this.laneW * 0.06;
      sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a;
    }
    this.shakeV *= Math.exp(-dt * 9);
    g.translate(sx, sy);

    this.drawEdges(s, dt);
    this.drawHighway(s);
    this.drawHolds(s);
    this.drawReceptors(s, dt);
    this.drawNotes(s);
    this.drawRings();
    this.particles.draw(g);
    this.drawCombo(s, dt);
    if (s.showJudgments) this.drawPopup(s);
    this.drawBanner(s);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.portrait || this.w < 900) this.drawHudTop(s, dt); else this.drawHudSide(s, dt);
    if (s.countdown) this.drawCountdown(s.countdown);
    if (this.screenFlash > 0.005) {
      g.fillStyle = `rgba(255,255,255,${Math.min(0.25, this.screenFlash)})`;
      g.fillRect(0, 0, this.w, this.h);
      this.screenFlash *= Math.exp(-dt * 8);
    }
    if (s.showFps) {
      g.font = '600 12px Outfit, system-ui';
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.textAlign = 'left';
      g.fillText(`${Math.round(s.fps)} fps · ${this.particles.count} fx · ${Math.round(this.dpr * 100) / 100}x`, 8, this.h - 8);
    }
  }

  private drawEdges(s: FrameState, dt: number) {
    const g = this.g;
    const base = 0.08 + s.intensity * 0.22 + s.beatPulse * 0.12;
    for (let i = 0; i < 2; i++) {
      this.edge[i] *= Math.exp(-dt * 3.5);
      const a = Math.min(0.85, base + this.edge[i] * 0.6);
      const color = i === 0 ? this.opts.laneColors[0] : this.opts.laneColors[2];
      const wdt = this.w * 0.12;
      const grd = g.createLinearGradient(i === 0 ? 0 : this.w, 0, i === 0 ? wdt : this.w - wdt, 0);
      grd.addColorStop(0, rgba(color, a));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(i === 0 ? 0 : this.w - wdt, 0, wdt, this.h);
    }
  }

  private drawHighway(s: FrameState) {
    const g = this.g;
    const zb = this.zBottom;
    const zt = 1.02;
    const xl0 = this.xAt(-1, zb), xr0 = this.xAt(1, zb), xl1 = this.xAt(-1, zt), xr1 = this.xAt(1, zt);
    const yb = this.yAt(zb), yt = this.yAt(zt);
    // body
    g.beginPath();
    g.moveTo(xl0, yb); g.lineTo(xl1, yt); g.lineTo(xr1, yt); g.lineTo(xr0, yb); g.closePath();
    const body = g.createLinearGradient(0, yt, 0, yb);
    body.addColorStop(0, 'rgba(8,4,24,0)');
    body.addColorStop(0.25, 'rgba(10,6,30,0.55)');
    body.addColorStop(0.85, 'rgba(12,6,34,0.82)');
    body.addColorStop(1, 'rgba(6,2,18,0.9)');
    g.fillStyle = body;
    g.fill();

    // lane tints + press flashes
    for (let l = 0; l < 3; l++) {
      const u0 = -1 + l * (2 / 3), u1 = u0 + 2 / 3;
      this.flash[l] *= Math.exp(-s.dt * 7);
      const pressed = s.pressed[l];
      const f = Math.max(this.flash[l] * 0.8, pressed ? 0.35 : 0);
      if (f > 0.01 && s.laneFlash) {
        const zTop = 0.55;
        g.beginPath();
        g.moveTo(this.xAt(u0, 0.0), this.hitY); g.lineTo(this.xAt(u0, zTop), this.yAt(zTop));
        g.lineTo(this.xAt(u1, zTop), this.yAt(zTop)); g.lineTo(this.xAt(u1, 0.0), this.hitY); g.closePath();
        const lg = g.createLinearGradient(0, this.yAt(zTop), 0, this.hitY);
        const c = this.flash[l] > 0.3 ? this.flashColor[l] : this.opts.laneColors[l];
        lg.addColorStop(0, rgba(c.startsWith('#') ? c : '#ffffff', 0));
        lg.addColorStop(1, rgba(c.startsWith('#') ? c : '#ffffff', 0.5 * f));
        g.fillStyle = lg;
        g.fill();
      }
    }

    // beat lines
    const beats = s.beats;
    let bi = lowerBound(beats, s.t - 0.1);
    g.lineCap = 'round';
    for (; bi < beats.length; bi++) {
      const z = this.zOf(beats[bi] - s.t);
      if (z > 1) break;
      if (z < zb) continue;
      const bar = (bi - s.downbeatPhase) % 4 === 0;
      const fade = Math.min(1, (1 - z) * 4) * Math.min(1, (z - zb) * 6);
      const y = this.yAt(z);
      g.strokeStyle = bar ? rgba(this.opts.accent, 0.42 * fade) : `rgba(255,255,255,${0.1 * fade})`;
      g.lineWidth = (bar ? 2.4 : 1.2) * this.scaleAt(z);
      g.beginPath(); g.moveTo(this.xAt(-1, z), y); g.lineTo(this.xAt(1, z), y); g.stroke();
    }

    // separators
    for (let i = 0; i < 4; i++) {
      const u = -1 + i * (2 / 3);
      const outer = i === 0 || i === 3;
      const c = outer ? (i === 0 ? this.opts.laneColors[0] : this.opts.laneColors[2]) : '#ffffff';
      const grd = g.createLinearGradient(0, yt, 0, yb);
      grd.addColorStop(0, rgba(c, 0));
      grd.addColorStop(0.5, rgba(c, outer ? 0.5 + s.intensity * 0.3 : 0.14));
      grd.addColorStop(1, rgba(c, outer ? 0.95 : 0.25));
      g.strokeStyle = grd;
      g.lineWidth = outer ? 3 : 1.2;
      g.beginPath(); g.moveTo(this.xAt(u, zb), yb); g.lineTo(this.xAt(u, zt), yt); g.stroke();
      if (outer) {
        g.lineWidth = 10;
        g.globalAlpha = 0.18 + s.beatPulse * 0.25;
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // rail lights travelling on the outer rails at half-beat intervals
    if (beats.length > 1) {
      let k = lowerBound(beats, s.t);
      for (; k < beats.length - 1; k++) {
        for (const frac of [0, 0.5]) {
          const bt = beats[k] + (beats[k + 1] - beats[k]) * frac;
          const z = this.zOf(bt - s.t);
          if (z > 1) break;
          if (z < 0) continue;
          const sc = this.scaleAt(z);
          const r = 7 * sc * (frac === 0 ? 1.4 : 1);
          const a = Math.min(1, (1 - z) * 3);
          g.globalAlpha = a;
          g.drawImage(glowSprite(this.opts.laneColors[0]), this.xAt(-1.03, z) - r * 2, this.yAt(z) - r * 2, r * 4, r * 4);
          g.drawImage(glowSprite(this.opts.laneColors[2]), this.xAt(1.03, z) - r * 2, this.yAt(z) - r * 2, r * 4, r * 4);
        }
        if (this.zOf(beats[k] - s.t) > 1) break;
      }
      g.globalAlpha = 1;
    }
  }

  private drawReceptors(s: FrameState, dt: number) {
    const g = this.g;
    // hit line
    const xl = this.xAt(-1, 0), xr = this.xAt(1, 0);
    const hl = g.createLinearGradient(xl, 0, xr, 0);
    const pulse = 0.55 + s.beatPulse * 0.45;
    hl.addColorStop(0, rgba(this.opts.laneColors[0], 0.2));
    hl.addColorStop(0.5, `rgba(255,255,255,${0.75 * pulse + 0.2})`);
    hl.addColorStop(1, rgba(this.opts.laneColors[2], 0.2));
    g.fillStyle = hl;
    g.fillRect(xl, this.hitY - 1.5, xr - xl, 3);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35 * pulse;
    g.drawImage(glowSprite(this.opts.accent), xl, this.hitY - this.noteH * 0.9, xr - xl, this.noteH * 1.8);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    for (let l = 0; l < 3; l++) {
      this.pop[l] *= Math.exp(-dt * 10);
      const x = this.xAt(this.laneU(l), 0);
      const pressed = s.pressed[l];
      const sc = 1 + this.pop[l] * 0.12 + (pressed ? 0.04 : 0);
      const w = this.noteW * sc, h = this.noteH * sc;
      const c = this.opts.laneColors[l];
      roundRect(g, x - w / 2, this.hitY - h / 2, w, h, this.k === 0 ? Math.min(h / 2, w * 0.13) : h / 2);
      g.fillStyle = pressed ? rgba(c, 0.42) : 'rgba(255,255,255,0.05)';
      g.fill();
      g.lineWidth = pressed ? 3 : 2;
      g.strokeStyle = pressed ? lighten(c, 0.5) : rgba(c, 0.75);
      g.stroke();
      if (this.targetHint[l] > 0.02) {
        // next lane of a switch / rail hold: pulsing target outline
        const k = this.targetHint[l];
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 18);
        roundRect(g, x - w * (0.55 + 0.05 * pulse), this.hitY - h * (0.6 + 0.08 * pulse), w * (1.1 + 0.1 * pulse), h * (1.2 + 0.16 * pulse), h * 0.6);
        g.lineWidth = 3;
        g.setLineDash([8, 6]);
        g.strokeStyle = `rgba(255,255,255,${0.35 + 0.6 * k})`;
        g.stroke();
        g.setLineDash([]);
        this.targetHint[l] *= Math.exp(-dt * 6);
      }
      if (pressed || this.pop[l] > 0.05) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.max(pressed ? 0.5 : 0, this.pop[l]);
        g.drawImage(glowSprite(c), x - w, this.hitY - h * 1.5, w * 2, h * 3);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      if (s.inputHint === 'keyboard' || s.inputHint === 'gamepad') {
        g.font = `800 ${Math.max(11, this.noteH * 0.36)}px Outfit, system-ui`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = pressed ? '#fff' : 'rgba(255,255,255,0.55)';
        g.fillText(s.keyLabels[l] ?? '', x, this.hitY + this.noteH * 1.05);
      }
      // holding sparkle
      if (this.holdSpark[l] > 0.01) {
        this.holdSpark[l] *= Math.exp(-dt * 12);
        if (Math.random() < 0.6) {
          const sc2 = this.laneW / 120;
          this.particles.spawn(x + (Math.random() - 0.5) * w * 0.8, this.hitY, (Math.random() - 0.5) * 80 * sc2, -260 * sc2 * (0.5 + Math.random()), 0.35, 7 * sc2, c, Math.random() < 0.5 ? 1 : 0, 0);
        }
      }
    }
  }

  private sprite(kind: 'tap' | 'hold' | 'swipe', lane: number, dir?: string, size: TileSize = 'regular') {
    const color = kind === 'swipe' ? (dir && dir.length > 5 ? '#ffd23f' : this.opts.swipeColor) : this.opts.laneColors[lane];
    const key = `${kind}|${color}|${dir ?? ''}|${this.opts.skin}|${size}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      sp = noteSprite(this.opts.skin, color, this.noteW * this.dpr, this.noteH * SIZE_SCALE[size] * this.dpr, kind, dir as never, size);
      this.sprites.set(key, sp);
    }
    return sp;
  }

  onTransition(lane: Lane, _n: RNote) {
    const x = this.xAt(this.laneU(lane), 0);
    const s = this.laneW / 120;
    this.particles.burst(x, this.hitY, '#ffffff', 8, 520 * s, 7 * s, { up: true, sparks: 10 });
    this.rings.push({ x, y: this.hitY, t0: this.clock, color: this.opts.laneColors[lane], r: this.laneW * 0.55, dur: 0.3 });
    this.flash[lane] = 1;
    this.flashColor[lane] = '#ffffff';
    this.switchPop = { lane, t0: this.clock };
  }
  private switchPop: { lane: number; t0: number } | null = null;

  /** Hold body (plain, switch or rail), drawn as perspective ribbons following the hold's lane path. */
  private drawHolds(s: FrameState) {
    const g = this.g;
    const end = s.t + this.vis * 1.05;
    const half = (1 / 3) * (this.k === 0 ? 0.38 : 0.42);
    for (let i = s.firstVisible; i < s.notes.length; i++) {
      const n = s.notes[i];
      if (n.t > end) break;
      if (n.type !== 'hold' || !n.dur) continue;
      const tail = n.t + n.dur;
      if (tail < s.t - 0.3) continue;
      if (n.holdState === 'done') continue;
      const holding = n.holdState === 'holding';
      const dead = n.holdState === 'broken' || n.holdState === 'missed';
      const t0 = holding ? s.t : n.t;
      const tEnd = Math.min(tail, s.t + this.vis * 1.02);
      if (this.zOf(tail - s.t) < this.zBottom) continue;
      const path = sortedPath(n);
      // split into pieces at switch points (instant jumps); rails stay inside one piece
      const cuts = [t0, ...path.filter((p) => !(p.slide ?? 0) && p.t > t0 && p.t < tEnd).map((p) => p.t), tEnd];
      const colorAt = (tt: number) => this.opts.laneColors[Math.round(holdLanePos(n, tt))];
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], b = cuts[k + 1];
        if (b <= a) continue;
        const steps = Math.max(6, Math.ceil(((b - a) / this.vis) * 24));
        const left: [number, number][] = [], right: [number, number][] = [], mid: [number, number][] = [];
        for (let j = 0; j <= steps; j++) {
          const tt = a + ((b - a) * j) / steps - (j === steps && k < cuts.length - 2 ? 1e-4 : 0);
          const z = this.zOf(tt - s.t);
          const u = this.laneU(holdLanePos(n, tt + (j === 0 ? 1e-4 : 0)));
          const y = this.yAt(z);
          left.push([this.xAt(u - half, z), y]); right.push([this.xAt(u + half, z), y]); mid.push([this.xAt(u, z), y]);
        }
        g.beginPath();
        left.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
        for (let j = right.length - 1; j >= 0; j--) g.lineTo(right[j][0], right[j][1]);
        g.closePath();
        const yH = mid[0][1], yT = mid[mid.length - 1][1];
        const grd = g.createLinearGradient(0, yT, 0, yH);
        const c = colorAt((a + b) / 2);
        if (dead) { grd.addColorStop(0, 'rgba(120,120,140,0.1)'); grd.addColorStop(1, 'rgba(120,120,140,0.35)'); }
        else { const al = holding ? 0.85 : 0.58; grd.addColorStop(0, rgba(c, al * 0.4)); grd.addColorStop(1, rgba(c, al)); }
        g.fillStyle = grd;
        g.fill();
        g.strokeStyle = dead ? 'rgba(200,200,220,0.25)' : holding ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)';
        g.lineWidth = Math.max(2, this.laneW * 0.04) * (holding ? 1.4 + Math.sin(this.clock * 30) * 0.2 : 1);
        g.beginPath();
        mid.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
        // rail edges glow
        if (path.some((p) => (p.slide ?? 0) > 0)) {
          g.strokeStyle = dead ? 'rgba(200,200,220,0.2)' : 'rgba(255,255,255,0.5)';
          g.lineWidth = 1.5;
          g.beginPath(); left.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
          g.beginPath(); right.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
        }
      }
      // switch connectors: a bright bar with chevrons from the old lane to the new one
      let lane = n.lane;
      for (const p of path) {
        const from = lane;
        lane = p.lane;
        if ((p.slide ?? 0) > 0) {
          // rail: chevrons along the slide
          for (let q = 1; q <= 3; q++) {
            const tt = p.t + ((p.slide ?? 0) * q) / 4;
            if (tt < t0 || tt > tEnd) continue;
            this.chevron(this.laneU(holdLanePos(n, tt)), this.zOf(tt - s.t), p.lane > from ? 1 : -1, dead);
          }
          continue;
        }
        if (p.t < t0 - 0.05 || p.t > tEnd + 0.01) continue;
        const z = this.zOf(p.t - s.t);
        const sc = this.scaleAt(z);
        const x1 = this.xAt(this.laneU(from), z), x2 = this.xAt(this.laneU(p.lane), z), y = this.yAt(z);
        const h = this.noteH * 0.42 * sc;
        roundRect(g, Math.min(x1, x2) - h / 2, y - h / 2, Math.abs(x2 - x1) + h, h, h / 2);
        const lg = g.createLinearGradient(x1, 0, x2, 0);
        lg.addColorStop(0, dead ? 'rgba(150,150,170,0.4)' : rgba(this.opts.laneColors[from], 0.9));
        lg.addColorStop(1, dead ? 'rgba(150,150,170,0.4)' : '#ffffff');
        g.fillStyle = lg;
        g.fill();
        const dir = p.lane > from ? 1 : -1;
        for (let q = 1; q <= Math.abs(p.lane - from) * 2; q++) {
          const u = this.laneU(from) + ((this.laneU(p.lane) - this.laneU(from)) * q) / (Math.abs(p.lane - from) * 2 + 1);
          this.chevron(u, z, dir, dead);
        }
        // landing pad on the new lane
        const lx = x2;
        roundRect(g, lx - this.noteW * 0.4 * sc, y - this.noteH * 0.3 * sc, this.noteW * 0.8 * sc, this.noteH * 0.6 * sc, this.noteH * 0.3 * sc);
        g.strokeStyle = dead ? 'rgba(170,170,190,0.5)' : '#ffffff';
        g.lineWidth = 2.5 * sc;
        g.stroke();
      }
      // tail cap at the final lane
      const zT = this.zOf(tail - s.t);
      if (zT <= 1) {
        const sc = this.scaleAt(zT);
        const u = this.laneU(holdLanePos(n, tail));
        roundRect(g, this.xAt(u, zT) - this.noteW * 0.42 * sc, this.yAt(zT) - this.noteH * 0.18 * sc, this.noteW * 0.84 * sc, this.noteH * 0.36 * sc, this.noteH * 0.18 * sc);
        g.fillStyle = dead ? 'rgba(160,160,180,0.4)' : lighten(colorAt(tail), 0.4);
        g.fill();
      }
      if (holding) {
        const cur = n.curLane ?? n.lane;
        this.holdSparkle(cur as Lane);
        // upcoming transition: pulse the target receptor so the movement is readable
        const next = path[n.pathIdx ?? 0];
        if (next && next.t - s.t < 0.9) this.targetHint[next.lane] = Math.max(this.targetHint[next.lane], 1 - Math.max(0, next.t - s.t) / 0.9);
      }
    }
  }
  private targetHint = [0, 0, 0];

  private chevron(u: number, z: number, dir: number, dead: boolean) {
    const g = this.g;
    const sc = this.scaleAt(z);
    const x = this.xAt(u, z), y = this.yAt(z);
    const s = this.noteH * 0.22 * sc;
    g.strokeStyle = dead ? 'rgba(200,200,220,0.5)' : '#1a0838';
    g.lineWidth = Math.max(1.5, 3 * sc);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x - dir * s * 0.6, y - s);
    g.lineTo(x + dir * s * 0.6, y);
    g.lineTo(x - dir * s * 0.6, y + s);
    g.stroke();
  }

  private drawNotes(s: FrameState) {
    const g = this.g;
    const end = s.t + this.vis * 1.05;
    let last = s.firstVisible;
    while (last < s.notes.length && s.notes[last].t <= end) last++;
    for (let i = last - 1; i >= s.firstVisible; i--) {
      const n = s.notes[i];
      const z = this.zOf(n.t - s.t);
      if (z < this.zBottom - 0.05) continue;
      let alpha = 1;
      if (n.judged && n.judged !== 'miss') continue;
      if (n.judged === 'miss') {
        if (n.type === 'hold') continue;
        alpha = Math.max(0, 1 + z * 4) * 0.45;
        if (alpha <= 0) continue;
      }
      if (n.type === 'hold' && n.holdState === 'holding') continue;
      const size = n.type === 'tap' ? sizeOf(n) : 'regular';
      const sc = this.scaleAt(z);
      const sp = this.sprite(n.type, n.lane, n.dir, size);
      const w = this.noteW * sc, h = this.noteH * SIZE_SCALE[size] * sc;
      const pad = (sp.pad / this.dpr) * sc;
      const x = this.xAt(this.laneU(n.lane), z);
      const y = this.yAt(z);
      const fadeIn = Math.min(1, (1.05 - z) * 5);
      g.globalAlpha = alpha * fadeIn;
      if (n.judged === 'miss') g.filter = 'grayscale(1)';
      g.drawImage(sp.img, x - w / 2 - pad, y - h / 2 - pad, w + pad * 2, h + pad * 2);
      if (n.judged === 'miss') g.filter = 'none';
      if (n.type !== 'swipe' && !n.judged) {
        // timing line through the middle of every tile: hit when it crosses the hit line
        const lt = Math.max(2, Math.min(5, h * 0.07));
        g.fillStyle = 'rgba(20,6,40,0.55)';
        g.fillRect(x - w * 0.4, y - lt / 2 - 1, w * 0.8, lt + 2);
        g.fillStyle = '#ffffff';
        g.fillRect(x - w * 0.4, y - lt / 2, w * 0.8, lt);
      }
      if (n.type === 'swipe' && !n.judged && s.inputHint === 'keyboard' && s.dirKeyLabels) {
        // print the direction key on the tile: lane key + this key together
        const label = s.dirKeyLabels[n.dir ?? 'up'];
        if (label) {
          const fs = Math.max(11, Math.min(h * 0.3, w * 0.16));
          const bx = x + w / 2 - fs * 1.35, by = y + h / 2 - fs * 1.2;
          roundRect(g, bx - fs * 0.75, by - fs * 0.62, fs * 1.5, fs * 1.24, fs * 0.3);
          g.fillStyle = 'rgba(20,8,48,0.88)';
          g.fill();
          g.font = `900 ${fs}px Outfit, system-ui`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = '#ffffff';
          g.fillText(label, bx, by + fs * 0.04);
        }
      }
      if (n.type === 'swipe' && !n.judged) {
        const ph = (this.clock * 2.5) % 1;
        const d = DIR_VEC[n.dir ?? 'up'];
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (1 - ph) * 0.6 * fadeIn;
        const r = h * 0.55;
        g.drawImage(glowSprite('#ffffff'), x + d[0] * w * 0.35 * ph - r, y + d[1] * h * 1.2 * ph - r, r * 2, r * 2);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = 1;
    }
  }

  private drawRings() {
    const g = this.g;
    g.save();
    g.globalCompositeOperation = 'lighter';
    this.rings = this.rings.filter((r) => this.clock - r.t0 < r.dur);
    for (const r of this.rings) {
      const p = (this.clock - r.t0) / r.dur;
      const e = 1 - Math.pow(1 - p, 3);
      g.strokeStyle = rgba(r.color.startsWith('#') ? r.color : '#ffffff', (1 - p) * 0.7);
      g.lineWidth = Math.max(1, (1 - p) * this.laneW * 0.045);
      g.beginPath();
      g.ellipse(r.x, r.y, r.r * (0.45 + e * 0.8), r.r * (0.45 + e * 0.8) * 0.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private jSprite(j: Judgment) {
    const size = Math.round(Math.min(64, this.laneW * 0.36) * this.dpr);
    const key = j + size;
    let sp = this.jSprites.get(key);
    if (!sp) { sp = textSprite(JTEXT[j], JCOLORS[j], size); this.jSprites.set(key, sp); }
    return sp;
  }

  private drawSwitchPop() {
    const sp = this.switchPop;
    if (!sp) return;
    const age = this.clock - sp.t0;
    if (age > 0.45) { this.switchPop = null; return; }
    const g = this.g;
    g.globalAlpha = 1 - age / 0.45;
    g.font = `400 ${Math.max(12, this.laneW * 0.13)}px Bungee, Outfit, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText('SWITCH!', this.xAt(this.laneU(sp.lane), 0), this.hitY - this.noteH * (1.2 + age * 2));
    g.globalAlpha = 1;
  }

  private drawPopup(s: FrameState) {
    this.drawSwitchPop();
    const p = this.popup;
    if (!p) return;
    const age = this.clock - p.t0;
    if (age > 0.6) return;
    const g = this.g;
    const sp = this.jSprite(p.j);
    const pop = this.opts.reducedMotion ? 1 : age < 0.08 ? 1.35 - age * 4.4 : 1;
    const a = age > 0.42 ? 1 - (age - 0.42) / 0.18 : 1;
    const w = (sp.width / this.dpr) * pop, h = (sp.height / this.dpr) * pop;
    const y = this.hitY - (this.hitY - this.topY) * 0.3 - (this.opts.reducedMotion ? 0 : age * 12);
    g.globalAlpha = Math.max(0, a);
    g.drawImage(sp, this.cx - w / 2, y - h / 2, w, h);
    if (s.showEarlyLate && p.j !== 'perfectPlus' && p.j !== 'miss') {
      g.font = `800 ${Math.max(11, this.laneW * 0.11)}px Outfit, system-ui`;
      g.textAlign = 'center';
      g.fillStyle = p.delta < 0 ? '#7fd6ff' : '#ffb36b';
      g.fillText(p.delta < 0 ? `EARLY ${Math.round(-p.delta * 1000)}ms` : `LATE +${Math.round(p.delta * 1000)}ms`, this.cx, y + h * 0.42);
    }
    g.globalAlpha = 1;
  }

  private drawCombo(s: FrameState, dt: number) {
    const combo = s.session.combo;
    this.comboPop *= Math.exp(-dt * 10);
    if (combo < 3) return;
    const g = this.g;
    const y = this.hitY - (this.hitY - this.topY) * 0.56;
    const size = Math.min(110, this.laneW * 0.62) * (1 + (this.opts.reducedMotion ? 0 : this.comboPop * 0.12));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${size}px Outfit, system-ui`;
    g.globalAlpha = 0.9;
    const grd = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, lighten(this.opts.accent, 0.3));
    g.lineWidth = size * 0.08;
    g.strokeStyle = 'rgba(10,0,30,0.55)';
    g.strokeText(String(combo), this.cx, y);
    g.fillStyle = grd;
    g.fillText(String(combo), this.cx, y);
    g.font = `800 ${size * 0.2}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(`COMBO  ×${s.session.multiplier}`, this.cx, y + size * 0.62);
    g.globalAlpha = 1;
  }

  private drawBanner(_s: FrameState) {
    const b = this.banner;
    if (!b) return;
    const age = this.clock - b.t0;
    if (age > b.dur) { this.banner = null; return; }
    const g = this.g;
    const inT = Math.min(1, age / 0.25);
    const outT = Math.max(0, (age - (b.dur - 0.3)) / 0.3);
    const ease = 1 - Math.pow(1 - inT, 3);
    const y = this.topY + (this.hitY - this.topY) * 0.32;
    const bh = Math.min(120, this.laneW * 0.75);
    const bwid = this.bw * 1.15 * ease;
    g.globalAlpha = 1 - outT;
    const grd = g.createLinearGradient(this.cx - bwid / 2, 0, this.cx + bwid / 2, 0);
    grd.addColorStop(0, rgba(b.color, 0));
    grd.addColorStop(0.5, rgba(b.color, 0.55));
    grd.addColorStop(1, rgba(b.color, 0));
    g.fillStyle = grd;
    g.fillRect(this.cx - bwid / 2, y - bh / 2, bwid, bh);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(this.cx - bwid / 2, y - bh / 2, bwid, 2);
    g.fillRect(this.cx - bwid / 2, y + bh / 2 - 2, bwid, 2);
    g.font = `400 ${bh * 0.42}px Bungee, Outfit, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    const slide = this.opts.reducedMotion ? 0 : (1 - ease) * 60;
    g.fillText(b.text, this.cx + slide, y - (b.sub ? bh * 0.1 : 0));
    if (b.sub) {
      g.font = `700 ${bh * 0.17}px Outfit, system-ui`;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(b.sub, this.cx - slide, y + bh * 0.28);
    }
    g.globalAlpha = 1;
  }

  private drawCountdown(text: string) {
    const g = this.g;
    const size = Math.min(160, this.laneW * 0.9);
    g.font = `400 ${size}px Bungee, Outfit, system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = size * 0.08;
    g.strokeStyle = 'rgba(10,0,30,0.7)';
    const y = this.topY + (this.hitY - this.topY) * 0.45;
    g.strokeText(text, this.cx, y);
    g.fillStyle = '#ffffff';
    g.fillText(text, this.cx, y);
  }

  // ---------- HUD ----------
  private star(cx: number, cy: number, r: number, fill: string, stroke?: string) {
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }

  private starBar(x: number, y: number, w: number, h: number, s: FrameState, dt: number) {
    const g = this.g;
    const max = s.session.max || 1;
    const ratio = Math.min(1, this.shownScore / max);
    roundRect(g, x, y, w, h, h / 2);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fill();
    if (ratio > 0) {
      roundRect(g, x, y, Math.max(h, w * ratio), h, h / 2);
      const grd = g.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, this.opts.laneColors[0]);
      grd.addColorStop(1, this.opts.laneColors[2]);
      g.fillStyle = grd;
      g.fill();
    }
    let count = 0;
    STAR_THRESHOLDS.forEach((th, i) => {
      const on = ratio >= th;
      if (on) count++;
      this.starPop[i] *= Math.exp(-dt * 6);
      const r = h * 1.15 * (1 + this.starPop[i] * 0.6);
      this.star(x + w * th, y + h / 2, r, on ? '#ffd23f' : 'rgba(40,30,70,0.95)', on ? '#fff3b0' : 'rgba(255,255,255,0.35)');
    });
    if (count > this.lastStarCount) {
      this.starPop[count - 1] = 1;
      this.particles.burst(x + w * STAR_THRESHOLDS[count - 1], y + h / 2, '#ffd23f', 10, 240, 6, { sparks: 8 });
    }
    this.lastStarCount = count;
  }

  private drawHudSide(s: FrameState, dt: number) {
    const g = this.g;
    this.shownScore += (s.session.score - this.shownScore) * Math.min(1, dt * 12);
    const left = this.xAt(-1, 0) - 30;
    const pw = Math.min(360, left - 40);
    if (pw < 180) { this.drawHudTop(s, dt); return; }
    const x = left - pw;
    const y = this.h * 0.08;
    const u = Math.min(1.4, Math.max(0.8, this.h / 900));
    // cover + title
    const cs = 84 * u;
    if (s.cover) {
      g.save();
      roundRect(g, x, y, cs, cs, 14 * u);
      g.clip();
      g.drawImage(s.cover, x, y, cs, cs);
      g.restore();
      roundRect(g, x, y, cs, cs, 14 * u);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    g.font = `800 ${20 * u}px Outfit, system-ui`;
    fitText(g, s.title, x + cs + 14 * u, y + 28 * u, pw - cs - 14 * u);
    g.font = `500 ${14 * u}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    fitText(g, s.artist, x + cs + 14 * u, y + 50 * u, pw - cs - 14 * u);
    // diff badge
    g.font = `800 ${11 * u}px Outfit, system-ui`;
    const badge = `${s.diffLabel}  ·  ${s.modeLabel}`;
    const bwid = g.measureText(badge).width + 18 * u;
    roundRect(g, x + cs + 14 * u, y + 60 * u, bwid, 20 * u, 10 * u);
    g.fillStyle = rgba(s.diffColor, 0.85);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(badge, x + cs + 23 * u, y + 74 * u);

    // score
    const sy = y + cs + 70 * u;
    g.font = `700 ${13 * u}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('SCORE', x, sy - 44 * u);
    g.font = `900 ${46 * u}px Outfit, system-ui`;
    g.fillStyle = '#fff';
    g.fillText(Math.round(this.shownScore).toLocaleString('en-US'), x, sy);
    // multiplier chip
    const mult = s.session.multiplier;
    g.font = `900 ${18 * u}px Outfit, system-ui`;
    const mw = 54 * u;
    roundRect(g, x + pw - mw, sy - 34 * u, mw, 32 * u, 16 * u);
    const mg = g.createLinearGradient(x + pw - mw, 0, x + pw, 0);
    mg.addColorStop(0, ['#555', '#2fc8ff', '#a77bff', '#ff5ce1', '#ffd23f'][mult]);
    mg.addColorStop(1, ['#777', '#5be0ff', '#c9a6ff', '#ff9bf0', '#fff1a8'][mult]);
    g.fillStyle = mg;
    g.fill();
    g.fillStyle = '#10051f';
    g.textAlign = 'center';
    g.fillText(`×${mult}`, x + pw - mw / 2, sy - 12 * u);
    g.textAlign = 'left';
    this.starBar(x, sy + 26 * u, pw, 10 * u, s, dt);

    // stage progress
    const py = sy + 80 * u;
    g.font = `700 ${13 * u}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(`STAGE ${s.stage + 1} / 5`, x, py);
    const segW = (pw - 4 * 6 * u) / 5;
    for (let i = 0; i < 5; i++) {
      roundRect(g, x + i * (segW + 6 * u), py + 10 * u, segW, 8 * u, 4 * u);
      g.fillStyle = i < s.stage ? this.opts.accent : i === s.stage ? rgba(this.opts.accent, 0.55) : 'rgba(255,255,255,0.12)';
      g.fill();
    }
    roundRect(g, x, py + 30 * u, pw, 4 * u, 2 * u);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fill();
    roundRect(g, x, py + 30 * u, pw * Math.max(0, Math.min(1, s.songProgress)), 4 * u, 2 * u);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fill();

    // right panel
    const rx = this.xAt(1, 0) + 30;
    const rw = Math.min(320, this.w - rx - 40);
    if (rw < 160) return;
    let ry = this.h * 0.08 + 10 * u;
    g.font = `700 ${13 * u}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('MAX COMBO', rx, ry);
    g.font = `900 ${34 * u}px Outfit, system-ui`;
    g.fillStyle = '#fff';
    g.fillText(String(s.session.maxCombo), rx, ry + 38 * u);
    if (s.showAccuracy) {
      g.font = `700 ${13 * u}px Outfit, system-ui`;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillText('ACCURACY', rx + rw * 0.5, ry);
      g.font = `900 ${34 * u}px Outfit, system-ui`;
      g.fillStyle = '#fff';
      g.fillText(`${s.session.accuracy.toFixed(1)}%`, rx + rw * 0.5, ry + 38 * u);
    }
    ry += 80 * u;
    const rows: [string, number, string][] = [
      ['PERFECT+', s.session.counts.perfectPlus, JCOLORS.perfectPlus[1]],
      ['PERFECT', s.session.counts.perfect, JCOLORS.perfect[1]],
      ['GREAT', s.session.counts.great, JCOLORS.great[1]],
      ['MISS', s.session.counts.miss, JCOLORS.miss[1]],
    ];
    for (const [label, val, col] of rows) {
      roundRect(g, rx, ry, rw, 34 * u, 10 * u);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fill();
      g.fillStyle = col;
      roundRect(g, rx, ry, 5 * u, 34 * u, 2.5 * u);
      g.fill();
      g.font = `800 ${14 * u}px Outfit, system-ui`;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.textAlign = 'left';
      g.fillText(label, rx + 16 * u, ry + 22 * u);
      g.textAlign = 'right';
      g.fillStyle = '#fff';
      g.font = `900 ${17 * u}px Outfit, system-ui`;
      g.fillText(String(val), rx + rw - 14 * u, ry + 23 * u);
      ry += 42 * u;
    }
    g.textAlign = 'left';
  }

  private drawHudTop(s: FrameState, dt: number) {
    const g = this.g;
    this.shownScore += (s.session.score - this.shownScore) * Math.min(1, dt * 12);
    const safeTop = Number(getComputedStyle(document.documentElement).getPropertyValue('--sat').replace('px', '')) || 0;
    const pad = 14;
    const y0 = safeTop + 10;
    if (!this.hudGrad) {
      this.hudGrad = g.createLinearGradient(0, 0, 0, y0 + 90);
      this.hudGrad.addColorStop(0, 'rgba(5,0,20,0.75)');
      this.hudGrad.addColorStop(1, 'rgba(5,0,20,0)');
    }
    g.fillStyle = this.hudGrad;
    g.fillRect(0, 0, this.w, y0 + 90);
    // song progress
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, safeTop, this.w, 3);
    g.fillStyle = this.opts.accent;
    g.fillRect(0, safeTop, this.w * Math.max(0, Math.min(1, s.songProgress)), 3);
    const u = Math.min(1.25, Math.max(0.8, this.w / 430));
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `900 ${28 * u}px Outfit, system-ui`;
    g.fillStyle = '#fff';
    g.fillText(Math.round(this.shownScore).toLocaleString('en-US'), pad, y0 + 30 * u);
    g.font = `800 ${12 * u}px Outfit, system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    const info = `×${s.session.multiplier}  ·  STAGE ${s.stage + 1}/5${s.showAccuracy ? `  ·  ${s.session.accuracy.toFixed(1)}%` : ''}`;
    g.fillText(info, pad, y0 + 48 * u);
    const barW = Math.min(this.w - pad * 2 - 60, 420);
    this.starBar(pad + 6, y0 + 62 * u, barW, 7 * u, s, dt);
  }
}

function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  let t = text;
  if (g.measureText(t).width > maxW) {
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  g.fillText(t, x, y);
}

export function lowerBound(arr: ArrayLike<number>, v: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Screen-time multiplier from the song tempo: faster songs scroll faster, slower songs slower.
 * 95 BPM = 1×; steeper than linear so tempo differences are clearly felt
 * (135 BPM ≈ 0.62× screen time, i.e. tiles fall ~1.6× faster; 75 BPM and below ≈ 1.15×).
 */
export function tempoScale(bpm?: number): number {
  if (!bpm || !isFinite(bpm) || bpm <= 0) return 1;
  return Math.max(0.55, Math.min(1.15, Math.pow(95 / bpm, 1.35)));
}
