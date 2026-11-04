// GameController: loads a song, runs the frame loop and wires audio clock -> rules -> renderer.
// The audio playback clock (MusicPlayer.songTime) is the single timing authority.
import type { Difficulty, GameMode, Lane, SongChartFile, SongMeta, SwipeDir, ChartNote } from '../types';
import { audio, MusicPlayer } from '../audio/engine';
import { playSfx, setHitSounds } from '../audio/sfx';
import { GameSession, type RNote, type SessionResult } from './session';
import { Renderer, lowerBound, type RenderOptions } from './renderer';
import { BoardRenderer } from './boardRenderer';
import { InputManager } from './input';
import { background } from './background';
import { getSettings, keyLabel, subscribeSettings, updateSettings, type Settings } from '../store/settings';
import { toast } from '../ui/components/toasts';
import { loadSongBuffer, decoderAlignment } from '../store/songs';
import { coverCanvas } from '../ui/cover';
import { laneColorsFor } from './palette';
import { DIR_VEC, sizeOf } from './notes';

export interface GameConfig {
  meta: SongMeta;
  chart: SongChartFile;
  difficulty: Difficulty;
  mode: GameMode;
  /** Custom notes (editor playtest). */
  notesOverride?: ChartNote[];
  startAt?: number;
  speed?: number;
}

export interface FinishInfo {
  result: SessionResult;
  playSeconds: number;
  holdsCompleted: number;
  swipesHit: number;
  quit?: boolean;
}

export interface GameCallbacks {
  onFinish: (info: FinishInfo) => void;
  onPauseChange: (paused: boolean) => void;
  onReady?: () => void;
  onRestart: () => void;
}

const DIFF_COLORS: Record<Difficulty, string> = { normal: '#2fd87a', hard: '#ff9a1f', extreme: '#ff2d6f' };
const LEAD_IN = 2.4;

export class GameController {
  private renderer!: Renderer | BoardRenderer;
  private rendererKind = '';
  private input!: InputManager;
  private player!: MusicPlayer;
  session!: GameSession;
  private raf = 0;
  private lastFrame = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private fps = 60;
  private frameTimes: number[] = [];
  private dprCap = 2;
  private paused = false;
  private finished = false;
  private destroyed = false;
  private countdown: { until: number; label: string } | null = null;
  private stage = 0;
  private lastBeatIdx = -1;
  private firstVisible = 0;
  private endTime = 0;
  private inputHint: 'keyboard' | 'touch' | 'gamepad' | 'mouse' = 'keyboard';
  private settings: Settings = getSettings();
  private unsubSettings: () => void = () => {};
  private unsubAudio: () => void = () => {};
  private playStartPerf = 0;
  private holdsCompleted = 0;
  private swipesHit = 0;
  private cover: HTMLCanvasElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private failAt = 0;
  private finishAt = 0;
  private fcShown = false;
  private notes: RNote[] = [];

  constructor(private container: HTMLElement, private canvas: HTMLCanvasElement, private cfg: GameConfig, private cb: GameCallbacks) {}

  async init() {
    await audio.unlock();
    const buf = await loadSongBuffer(this.cfg.meta);
    if (this.destroyed) return;
    const align = decoderAlignment(this.cfg.meta, buf, this.cfg.chart);
    this.player = new MusicPlayer(buf);
    this.player.align = align;
    this.applySettings(getSettings());
    const s = this.settings;
    const chart = this.cfg.notesOverride ?? this.cfg.chart.charts[this.cfg.difficulty].notes;
    const startAt = this.cfg.startAt ?? (this.cfg.mode === 'practice' && s.practiceStartStage > 0 ? this.cfg.chart.analysis.stages[s.practiceStartStage] : 0);
    const notes = startAt > 0 ? chart.filter((n) => n.t >= startAt + 0.5) : chart;
    this.session = new GameSession(notes, this.cfg.mode, {
      onJudge: (n, j, d) => {
        this.renderer.onJudge(n.lane, j, d, n.type, n.type === 'tap' ? sizeOf(n) : 'regular');
        if (this.settings.vibration && navigator.vibrate) { try { navigator.vibrate(j === 'miss' ? 35 : n.type === 'swipe' ? 18 : 9); } catch { /* unsupported */ } }
        if (j !== 'miss') {
          if (n.type === 'swipe') { this.swipesHit++; playSfx('swipe', 0.8); }
          playSfx(j === 'perfectPlus' ? 'perfectPlus' : 'tap', n.type === 'swipe' ? 0.35 : 0.55);
        } else playSfx('miss', 0.5);
      },
      onTransition: (n, lane) => { this.renderer.onTransition(lane, n); playSfx('holdEnd', 0.35, 1.25); },
      onHoldEnd: (n, ok) => { this.renderer.onHoldEnd(n.lane, ok); if (ok) { this.holdsCompleted++; playSfx('holdEnd', 0.45); } },
      onMilestone: (c) => { this.renderer.onMilestone(c); playSfx('combo', 0.5); background.pulse(1.2); },
      onFail: () => this.fail(),
    });
    this.session.swipeMode = s.swipeMode;
    this.notes = this.session.notes;
    this.endTime = Math.min(this.cfg.chart.analysis.duration, Math.max(this.session.lastTime + 2.2, startAt + 4));
    this.cover = coverCanvas(this.cfg.meta, 256);

    this.renderer = this.makeRenderer(s);
    this.input = new InputManager(this.container, {
      laneDown: (l, ts) => this.onLaneDown(l, ts),
      laneUp: (l, ts) => this.onLaneUp(l, ts),
      dir: (d, ts) => this.onDir(d, ts),
      touchDown: (l, ts, x, y) => this.onTouchDown(l, ts, x, y),
      swipeGesture: (l, dx, dy, ts) => this.onSwipe(l, dx, dy, ts),
      slide: (from, to, ts) => this.onSlide(from, to, ts),
      pause: () => (this.paused ? this.resume() : this.pause()),
      restart: () => { if (this.paused) this.restart(); },
      hint: (k) => { this.inputHint = k; },
    }, s);
    this.input.laneBounds = (clientY: number) => {
      const r = this.canvas.getBoundingClientRect();
      const rd = this.renderer;
      // lane edges at the height of the touch (the board narrows slightly with distance)
      let z = 0;
      const y = clientY - r.top;
      if ('yAt' in rd && y < rd.hitY) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (rd.yAt(m) > y) lo = m; else hi = m; }
        z = lo;
      }
      return [r.left + rd.xAt(-1 / 3, z), r.left + rd.xAt(1 / 3, z)];
    };
    if (matchMedia('(pointer: coarse)').matches) this.inputHint = 'touch';
    this.input.attach();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.container);
    this.unsubSettings = subscribeSettings(() => this.applySettings(getSettings()));
    this.unsubAudio = audio.onStateChange((st) => { if (st !== 'running' && !this.paused && !this.finished) this.pause(); });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onVisibility);

    background.setTheme(this.cfg.meta.theme.colors, this.cfg.meta.theme.bg);
    background.beatSource = null;
    this.player.rate = this.cfg.mode === 'practice' ? s.practiceSpeed : 1;
    this.player.onEnded = () => { /* end handled by time */ };
    this.stage = this.stageAt(startAt);
    this.playStartPerf = performance.now();
    this.player.play(startAt - LEAD_IN * this.player.rate, 0.1);
    this.lastFrame = performance.now();
    this.cb.onReady?.();
    this.loop();
  }

  private renderOpts(s: Settings): RenderOptions {
    const colors = laneColorsFor(s.colorMode, this.cfg.meta.theme.colors);
    return {
      laneColors: colors.lanes, swipeColor: colors.swipe, accent: colors.accent, skin: s.noteSkin, noteSpeed: s.noteSpeed,
      reducedMotion: s.reducedMotion, shake: s.screenShake, particleScale: s.particles, highContrast: s.colorMode === 'highContrast',
      perspective: s.playfield === '3d',
      bpm: this.cfg.chart.analysis.bpm,
    };
  }
  private makeRenderer(s: Settings): Renderer | BoardRenderer {
    this.rendererKind = s.playfield;
    if (s.playfield === 'board') return new BoardRenderer(this.canvas, { ...this.renderOpts(s), theme: this.cfg.meta.theme.colors });
    return new Renderer(this.canvas, this.renderOpts(s));
  }

  private applySettings(s: Settings) {
    this.settings = s;
    audio.setVolumes(s.musicVolume, s.sfxVolume);
    setHitSounds(s.hitSounds);
    if (this.player) this.player.userOffset = s.audioOffsetMs / 1000 + this.syncAdjust;
    if (this.renderer) {
      if (this.rendererKind !== s.playfield) this.renderer = this.makeRenderer(s);
      else this.renderer.setOptions(this.renderOpts(s));
      this.renderer.particles.scale = s.particles;
    }
    if (this.input) this.input.applyBindings(s);
    if (this.session) this.session.swipeMode = s.swipeMode;
    background.reducedMotion = s.reducedMotion;
    background.setDim(s.bgDim);
    const q = s.quality;
    this.dprCap = q === 'low' ? 1 : q === 'medium' ? 1.5 : q === 'high' ? 2 : q === 'ultra' ? 3 : this.dprCap;
    background.scale = q === 'low' ? 0.33 : q === 'medium' ? 0.45 : q === 'high' ? 0.6 : q === 'ultra' ? 0.85 : background.scale;
    if (this.renderer) this.resize();
  }

  private resize() {
    if (!this.renderer) return;
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.renderer.resize(r.width, r.height, dpr);
    this.input.swipeThreshold = Math.max(18, Math.min(34, this.renderer.laneW * 0.22));
  }

  // ---------- time ----------
  /** Song time for an input event timestamp, corrected by the input offset. */
  private inputTime(ts: number) {
    return this.player.songTime(ts) - this.settings.inputOffsetMs / 1000;
  }
  private canInput() { return !this.paused && !this.countdown && !this.finished; }

  private onLaneDown(l: Lane, ts: number) { if (this.canInput()) this.session.pressLane(l, this.inputTime(ts)); }
  private onLaneUp(l: Lane, ts: number) { if (!this.finished) this.session.releaseLane(l, this.inputTime(ts)); }
  private onDir(d: SwipeDir, ts: number) { if (this.canInput()) this.session.direction(d, this.inputTime(ts)); }
  /** Swipe tiles touched directly, waiting for their flick (per lane). */
  private swipeTargets = new Map<Lane, RNote>();
  private onTouchDown(l: Lane, ts: number, x: number, y: number): { awaiting: boolean; lane: Lane } {
    if (!this.canInput()) return { awaiting: false, lane: l };
    // the tile under the finger is the hitbox (not the PERFECT bar)
    const rect = this.canvas.getBoundingClientRect();
    const rd = this.renderer;
    const touched = 'noteAt' in rd ? rd.noteAt(x - rect.left, y - rect.top, this.notes, this.firstVisible, this.player.songTime(ts)) : null;
    if ('onTouch' in rd && x > -1000) rd.onTouch(x - rect.left, y - rect.top);
    const lane = touched ? touched.lane : l;
    const r = this.session.touchDown(lane, this.inputTime(ts), touched);
    if (r.awaitingSwipe && r.note) this.swipeTargets.set(lane, r.note); else this.swipeTargets.delete(lane);
    return { awaiting: r.awaitingSwipe, lane };
  }
  private onSwipe(l: Lane, dx: number, dy: number, ts: number) {
    if (!this.canInput()) return;
    const forced = this.swipeTargets.get(l) ?? null;
    this.swipeTargets.delete(l);
    this.session.swipeGesture(l, dx, dy, this.inputTime(ts), forced);
  }
  private onSlide(from: Lane, to: Lane, ts: number) { return this.canInput() ? this.session.slide(from, to, this.inputTime(ts)) : false; }

  private stageAt(t: number) {
    const st = this.cfg.chart.analysis.stages;
    let s = 0;
    for (let i = 0; i < st.length; i++) if (t >= st[i]) s = i;
    return s;
  }

  // ---------- loop ----------
  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.trackPerf(dt);
    this.input.pollGamepad();

    const A = this.cfg.chart.analysis;
    let t = this.player.songTime(now);
    let cd: string | null = null;
    if (this.countdown) {
      const left = (this.countdown.until - now) / 1000;
      if (left <= 0) {
        this.countdown = null;
        this.player.resume(0.05);
        t = this.player.songTime(now);
      } else {
        cd = String(Math.ceil(left));
        if (cd !== this.countdown.label) { this.countdown.label = cd; playSfx('count', 0.6); }
      }
    }
    if (!this.paused && !this.countdown) this.session.update(t - this.settings.inputOffsetMs / 1000);
    if (t < 0 && !this.paused && !cd) cd = t < -LEAD_IN * 0.55 ? 'READY' : t < -0.3 ? '' : 'GO!';
    if (cd === '') cd = null;

    // stage changes
    const st = this.stageAt(t);
    if (st !== this.stage && !this.finished) {
      if (st > this.stage) { this.renderer.onStage(st + 1, 5); playSfx('stage', 0.55); background.pulse(1.4); }
      this.stage = st;
    }
    // beat pulse
    const bi = lowerBound(A.beats, t + 0.0001) - 1;
    let beatPulse = 0;
    if (bi >= 0) {
      const down = (bi - A.downbeatPhase) % 4 === 0;
      beatPulse = Math.exp(-(t - A.beats[bi]) * 7) * (down ? 1 : 0.6);
      if (bi !== this.lastBeatIdx && !this.paused) {
        this.lastBeatIdx = bi;
        background.pulse((down ? 0.9 : 0.5) * (this.settings.reducedMotion ? 0.3 : 1));
      }
    }
    // intensity: song energy + combo + drops
    const e = A.energy[Math.max(0, Math.min(A.energy.length - 1, Math.floor(t / A.energyStep)))] ?? 0.4;
    const inDrop = A.sections.some((s, i) => s.kind === 'drop' && t >= s.t && t < (A.sections[i + 1]?.t ?? 1e9));
    const intensity = Math.min(1.4, e * 0.6 + Math.min(1, this.session.combo / 120) * 0.45 + (inDrop ? 0.25 : 0) + this.stage * 0.05);
    background.setIntensity(intensity);

    if (this.settings.autoSync && !this.paused && !this.countdown) this.autoSync();
    if (this.settings.assistTicks && !this.paused && !this.countdown && !this.finished) this.scheduleTicks(t);

    // first visible note
    while (this.firstVisible < this.notes.length && this.isGone(this.notes[this.firstVisible], t)) this.firstVisible++;

    const s = this.settings;
    const kl = [s.keys.lane0[0], s.keys.lane1[0], s.keys.lane2[0]].map(keyLabel);
    this.renderer.draw({
      t, dt, notes: this.notes, firstVisible: this.firstVisible, beats: A.beats, downbeatPhase: A.downbeatPhase,
      session: this.session, pressed: [0, 1, 2].map((l) => this.input.isPressed(l) || this.session.isLaneDown(l as Lane)), stage: this.stage,
      songProgress: t / A.duration, intensity, beatPulse, countdown: cd, inputHint: this.inputHint,
      keyLabels: this.inputHint === 'gamepad' ? ['◀ / X', '▼ / A', '▶ / B'] : kl,
      dirKeyLabels: this.dirLabels(),
      title: this.cfg.meta.title, artist: this.cfg.meta.artist, diffLabel: this.cfg.difficulty.toUpperCase(), diffColor: DIFF_COLORS[this.cfg.difficulty],
      modeLabel: this.cfg.mode === 'classic' ? 'CLASSIC' : `PRACTICE${this.player.rate !== 1 ? ' ' + this.player.rate + '×' : ''}`, cover: this.cover,
      fps: this.fps, showFps: s.showFps, showJudgments: s.showJudgments, showAccuracy: s.showAccuracy, showEarlyLate: s.showEarlyLate, laneFlash: s.laneFlash,
    });

    // end of song
    if (!this.finished && !this.paused && t >= this.endTime - 1.6 && this.session.finished) this.complete();
    if (!this.finished && !this.paused && t >= this.endTime + 1) this.complete();
    if (this.finishAt && now >= this.finishAt) { this.finishAt = 0; this.emitFinish(false); }
    if (this.failAt && now >= this.failAt) { this.failAt = 0; this.emitFinish(false); }
  };

  /** Live sync correction (s) learned from the player's taps this song. */
  syncAdjust = 0;
  private syncFrom = 0;
  /**
   * Auto-sync: if the player's taps are consistently early or late against the notes, the device's
   * audio output delay isn't what the browser reports. Shift the chart to match what they hear.
   */
  private autoSync() {
    const d = this.session.pressDeltas;
    if (d.length - this.syncFrom < 10) return;
    const recent = d.slice(this.syncFrom).sort((a, b) => a - b);
    const med = recent[Math.floor(recent.length / 2)];
    this.syncFrom = d.length;
    if (Math.abs(med) < 0.025) return;
    const step = Math.max(-0.12, Math.min(0.12, med * 0.7));
    this.syncAdjust += step;
    this.player.userOffset += step;
  }
  get timingNow() { return this.session?.medianDelta(30) ?? null; }

  private ticked = new Set<number>();
  private tickNodes: AudioScheduledSourceNode[] = [];
  private tickBuf: AudioBuffer | null = null;
  /** Assist ticks: a click at every note time, scheduled on the audio clock against the music. */
  private scheduleTicks(t: number) {
    const ctx = audio.ctx;
    if (!ctx || !this.player.playing) return;
    if (!this.tickBuf) {
      const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) { const x = i / ctx.sampleRate; d[i] = Math.sin(2 * Math.PI * 2200 * x) * Math.exp(-x * 160) * 0.9; }
      this.tickBuf = b;
    }
    const times = new Set<number>();
    for (let i = this.firstVisible; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > t + 0.35) break;
      if (n.t < t - 0.02 || this.ticked.has(n.id)) continue;
      this.ticked.add(n.id);
      if (times.has(n.t)) continue; // one click per chord
      times.add(n.t);
      const when = this.player.ctxTimeFor(n.t);
      if (when < ctx.currentTime) continue;
      const src = ctx.createBufferSource();
      src.buffer = this.tickBuf;
      src.connect(audio.sfxBus);
      src.start(when);
      this.tickNodes.push(src);
      src.onended = () => { this.tickNodes = this.tickNodes.filter((x) => x !== src); src.disconnect(); };
    }
  }
  private stopTicks() {
    for (const n of this.tickNodes) { try { n.stop(); } catch { /* ignore */ } }
    this.tickNodes = [];
    this.ticked.clear();
  }

  private dirLabelsCache: { keys: unknown; v: Partial<Record<string, string>> } | null = null;
  private dirLabels() {
    const k = this.settings.keys;
    if (this.dirLabelsCache?.keys === k) return this.dirLabelsCache.v;
    const v: Partial<Record<string, string>> = {};
    for (const d of ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'] as const) v[d] = keyLabel(k[d][0]);
    this.dirLabelsCache = { keys: k, v };
    return v;
  }

  private isGone(n: RNote, t: number) {
    const end = n.t + (n.dur ?? 0);
    return n.judged !== null && n.holdState !== 'holding' && end < t - 0.6;
  }

  private trackPerf(dt: number) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    if (this.settings.quality !== 'auto' || this.paused) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.frameTimes = [];
    if (p80 > 0.021 && this.dprCap > 1) {
      this.dprCap = Math.max(1, this.dprCap - 0.35);
      background.scale = Math.max(0.3, background.scale - 0.1);
      this.renderer.particles.limit = Math.max(300, this.renderer.particles.limit - 300);
      this.resize();
    } else if (p80 < 0.0125 && this.dprCap < 2) {
      this.dprCap = Math.min(2, this.dprCap + 0.25);
      this.resize();
    }
  }

  // ---------- flow ----------
  private complete() {
    if (this.finished) return;
    this.finished = true;
    const r = this.session.result();
    if (r.medals.includes('app')) this.renderer.onFullCombo('ALL PERFECT+');
    else if (r.medals.includes('ap')) this.renderer.onFullCombo('ALL PERFECT!');
    else if (r.medals.includes('fc')) this.renderer.onFullCombo('FULL COMBO!');
    else this.renderer.onFullCombo('CLEAR!');
    this.fcShown = true;
    playSfx('achievement', 0.6);
    this.player.fadeOut(2.2);
    this.finishAt = performance.now() + 2600;
  }

  private fail() {
    if (this.finished) return;
    this.finished = true;
    this.renderer.onFail();
    playSfx('fail', 0.7);
    this.player.fadeOut(1.4);
    this.failAt = performance.now() + 2200;
  }

  private persistSync() {
    if (Math.abs(this.syncAdjust) < 0.005) return;
    const ms = Math.round(this.syncAdjust * 1000);
    const s = getSettings();
    this.syncAdjust = 0;
    updateSettings({ audioOffsetMs: Math.max(-200, Math.min(300, s.audioOffsetMs + ms)) });
    toast({ kind: 'info', icon: '🎚️', title: 'Sync auto-adjusted', text: `Notes now arrive ${Math.abs(ms)} ms ${ms > 0 ? 'later' : 'earlier'} to match your audio. Change it any time in Settings → Audio.` });
  }

  private emitFinish(quit: boolean) {
    this.persistSync();
    const playSeconds = (performance.now() - this.playStartPerf) / 1000;
    this.cb.onFinish({ result: this.session.result(), playSeconds, holdsCompleted: this.holdsCompleted, swipesHit: this.swipesHit, quit });
  }

  pause() {
    if (this.paused || this.destroyed) return;
    if (this.finished) return;
    this.paused = true;
    this.countdown = null;
    this.stopTicks();
    this.player.pause();
    this.input.releaseAll();
    this.cb.onPauseChange(true);
  }

  resume() {
    if (!this.paused || this.destroyed) return;
    audio.unlock().then(() => {
      this.paused = false;
      this.cb.onPauseChange(false);
      if (this.player.songTime() < 0) { this.player.resume(0.05); return; }
      this.countdown = { until: performance.now() + 3000, label: '' };
    });
  }

  restart() {
    if (this.destroyed) return;
    this.destroy();
    this.cb.onRestart();
  }

  quit() {
    if (!this.session) { this.destroy(); return; }
    this.destroy();
  }

  private onVisibility = () => { if (document.hidden || document.visibilityState === 'hidden') this.pause(); };

  // ---------- automated-test hooks (used by scripts/e2e.mjs) ----------
  /** performance.now() timestamp at which song time `t` will be heard. */
  perfAt(t: number) {
    const now = performance.now();
    return now + ((t - this.player.songTime(now)) * 1000) / this.player.rate;
  }
  /** Inject an input through the normal handlers with an explicit event timestamp. */
  testInput(kind: 'down' | 'up' | 'dir' | 'touch' | 'swipe' | 'slide', lane: Lane, dir: SwipeDir, ts: number, to?: Lane) {
    if (kind === 'slide') { this.onSlide(lane, to ?? lane, ts); return; }
    if (kind === 'down') this.onLaneDown(lane, ts);
    else if (kind === 'up') this.onLaneUp(lane, ts);
    else if (kind === 'dir') this.onDir(dir, ts);
    else if (kind === 'touch') this.onTouchDown(lane, ts, -9999, -9999);
    else { const v = DIR_VEC[dir]; this.onSwipe(lane, v[0] * 50, v[1] * 50, ts); }
  }

  get isPaused() { return this.paused; }
  get songTime() { return this.player ? this.player.songTime() : 0; }
  get isFinished() { return this.finished; }
  get usedFcBanner() { return this.fcShown; }

  destroy() {
    if (!this.destroyed && this.session) this.persistSync();
    this.destroyed = true;
    const w = window as unknown as { __fsGame?: GameController };
    if (w.__fsGame === this) delete w.__fsGame;
    cancelAnimationFrame(this.raf);
    this.stopTicks();
    this.input?.detach();
    this.player?.dispose();
    this.resizeObs?.disconnect();
    this.unsubSettings();
    this.unsubAudio();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onVisibility);
    this.renderer?.particles.clear();
    background.setIntensity(0);
  }
}
