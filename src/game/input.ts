// Unified input: keyboard (rebindable, chorded swipes), multi-touch / mouse (tap, hold, swipe
// gestures) and gamepad. Every event carries its original high-resolution timestamp so judgement
// never depends on frame timing.
import type { Lane, SwipeDir } from '../types';
import type { KeyAction, Settings } from '../store/settings';
import { classifyGesture } from './notes';

export interface InputHandlers {
  laneDown: (lane: Lane, ts: number) => void;
  laneUp: (lane: Lane, ts: number) => void;
  dir: (dir: SwipeDir, ts: number) => void;
  /** Pointer pressed a lane. Return true if the note under it is a swipe awaiting a gesture. */
  touchDown: (lane: Lane, ts: number) => boolean;
  swipeGesture: (lane: Lane, dx: number, dy: number, downTs: number) => void;
  /** A pointer dragged into another lane; return true if the game accepted it (switch / rail hold). */
  slide: (from: Lane, to: Lane, ts: number) => boolean;
  pause: () => void;
  restart: () => void;
  hint: (kind: 'keyboard' | 'touch' | 'gamepad' | 'mouse') => void;
}

interface PointerState { lane: Lane; downTs: number; x0: number; y0: number; awaiting: boolean; done: boolean }

const DIRS: SwipeDir[] = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'];

function ts(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  // very old browsers used epoch timestamps
  if (!t || t > now + 1000 || t < now - 10000) return now;
  return t;
}

export class InputManager {
  private keyLane = new Map<string, Lane>();
  private keyDir = new Map<string, SwipeDir>();
  private keyOther = new Map<string, 'pause' | 'restart'>();
  private laneCount = [0, 0, 0];
  private keysDown = new Set<string>();
  private pointers = new Map<number, PointerState>();
  private padPrev: boolean[] = [];
  private padStick: SwipeDir | null = null;
  private padLane = [false, false, false];
  enabled = true;
  /** Returns lane boundaries in client px: [x between lane0/1, x between lane1/2]. */
  laneBounds: (clientY: number) => [number, number] = () => [window.innerWidth / 3, (window.innerWidth * 2) / 3];
  swipeThreshold = 26;

  constructor(private el: HTMLElement, private h: InputHandlers, private settings: Settings) {
    this.applyBindings(settings);
  }

  applyBindings(s: Settings) {
    this.settings = s;
    this.keyLane.clear(); this.keyDir.clear(); this.keyOther.clear();
    const k = s.keys;
    (['lane0', 'lane1', 'lane2'] as KeyAction[]).forEach((a, i) => k[a].forEach((c) => this.keyLane.set(c, i as Lane)));
    DIRS.forEach((d) => k[d].forEach((c) => { if (!this.keyLane.has(c)) this.keyDir.set(c, d); }));
    k.pause.forEach((c) => this.keyOther.set(c, 'pause'));
    k.restart.forEach((c) => this.keyOther.set(c, 'restart'));
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.releaseAll);
    this.el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.el.addEventListener('touchstart', this.prevent, { passive: false });
    this.el.addEventListener('touchmove', this.prevent, { passive: false });
    this.el.addEventListener('contextmenu', this.prevent);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.releaseAll);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.el.removeEventListener('touchstart', this.prevent);
    this.el.removeEventListener('touchmove', this.prevent);
    this.el.removeEventListener('contextmenu', this.prevent);
  }

  private prevent = (e: Event) => {
    // never swallow touches meant for overlay UI (pause menu, buttons, sliders)
    if ((e.target as HTMLElement)?.closest?.('button, input, .no-game-input')) return;
    if (e.cancelable) e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    const lane = this.keyLane.get(code);
    const dir = this.keyDir.get(code);
    const other = this.keyOther.get(code);
    if (lane === undefined && dir === undefined && other === undefined) return;
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
    e.preventDefault();
    if (e.repeat || this.keysDown.has(code)) return; // no key-repeat
    this.keysDown.add(code);
    if (other === 'pause') { this.h.pause(); return; }
    if (other === 'restart') { this.h.restart(); return; }
    if (!this.enabled) return;
    this.h.hint('keyboard');
    const t = ts(e);
    if (lane !== undefined) {
      if (this.laneCount[lane]++ === 0) this.h.laneDown(lane, t);
    } else if (dir) this.h.dir(dir, t);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const code = e.code;
    if (!this.keysDown.delete(code)) return;
    const lane = this.keyLane.get(code);
    if (lane !== undefined && this.laneCount[lane] > 0) {
      if (--this.laneCount[lane] === 0) this.h.laneUp(lane, ts(e));
    }
  };

  private laneFromX(x: number, y: number): Lane {
    const [a, b] = this.laneBounds(y);
    return x < a ? 0 : x < b ? 1 : 2;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    const isMouse = e.pointerType === 'mouse';
    if (isMouse ? !this.settings.mouseControls : !this.settings.touchControls) return;
    if (isMouse && e.button !== 0) return;
    if ((e.target as HTMLElement)?.closest?.('button, .no-game-input')) return;
    e.preventDefault();
    try { this.el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    this.h.hint(isMouse ? 'mouse' : 'touch');
    const lane = this.laneFromX(e.clientX, e.clientY);
    const t = ts(e);
    const st: PointerState = { lane, downTs: t, x0: e.clientX, y0: e.clientY, awaiting: false, done: false };
    this.pointers.set(e.pointerId, st);
    this.laneCount[lane]++;
    st.awaiting = this.h.touchDown(lane, t);
  };

  private onPointerMove = (e: PointerEvent) => {
    const st = this.pointers.get(e.pointerId);
    if (!st || st.done) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (!st.awaiting) {
      // finger travelling across lanes: continue switch / rail holds
      const lane = this.laneFromX(e.clientX, e.clientY);
      if (lane !== st.lane && this.h.slide(st.lane, lane, ts(e))) {
        this.laneCount[st.lane] = Math.max(0, this.laneCount[st.lane] - 1);
        this.laneCount[lane]++;
        st.lane = lane;
      }
      return;
    }
    if (Math.hypot(dx, dy) < this.swipeThreshold) return;
    st.done = true;
    this.h.swipeGesture(st.lane, dx, dy, st.downTs);
  };

  private onPointerUp = (e: PointerEvent) => {
    const st = this.pointers.get(e.pointerId);
    if (!st) return;
    this.pointers.delete(e.pointerId);
    if (this.laneCount[st.lane] > 0) this.laneCount[st.lane]--;
    this.h.laneUp(st.lane, ts(e)); // one release per pointer (the rules engine counts presses per lane)
  };

  releaseAll = () => {
    const t = performance.now();
    for (let l = 0; l < 3; l++) while (this.laneCount[l] > 0) { this.laneCount[l]--; this.h.laneUp(l as Lane, t); }
    this.keysDown.clear();
    this.pointers.clear();
    this.padLane = [false, false, false];
  };

  isPressed(l: number) { return this.laneCount[l] > 0; }

  /** Poll gamepads (call every frame). */
  pollGamepad() {
    if (!this.settings.gamepad || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    const t = performance.now();
    const b = (i: number) => !!pad!.buttons[i]?.pressed;
    const lanes = [b(14) || b(2) || b(4), b(13) || b(0), b(15) || b(1) || b(5)];
    for (let l = 0; l < 3; l++) {
      if (lanes[l] && !this.padLane[l]) { this.h.hint('gamepad'); if (this.laneCount[l]++ === 0) this.h.laneDown(l as Lane, t); }
      if (!lanes[l] && this.padLane[l]) { if (this.laneCount[l] > 0 && --this.laneCount[l] === 0) this.h.laneUp(l as Lane, t); }
      this.padLane[l] = lanes[l];
    }
    const edge = (i: number) => b(i) && !this.padPrev[i];
    if (edge(3) || edge(12)) this.h.dir('up', t);
    if (edge(9)) this.h.pause();
    const ax = pad.axes[2] ?? 0, ay = pad.axes[3] ?? 0;
    const mag = Math.hypot(ax, ay);
    const stick: SwipeDir | null = mag > 0.65 ? classifyGesture(ax, ay) : null;
    if (stick && stick !== this.padStick) this.h.dir(stick, t);
    this.padStick = mag < 0.35 ? null : stick ?? this.padStick;
    this.padPrev = pad.buttons.map((x) => x.pressed);
  }
}
