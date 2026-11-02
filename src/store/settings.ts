// Persistent settings (localStorage) with a tiny subscribe API for React.
import { useSyncExternalStore } from 'react';

export type KeyAction = 'lane0' | 'lane1' | 'lane2' | 'up' | 'down' | 'left' | 'right' | 'upleft' | 'upright' | 'downleft' | 'downright' | 'pause' | 'restart';
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type ColorMode = 'theme' | 'classic' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'highContrast';
export type NoteSkin = 'neon' | 'crystal' | 'ring' | 'gold' | 'pixel';

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  hitSounds: boolean;
  noteSpeed: number;
  audioOffsetMs: number;
  inputOffsetMs: number;
  keys: Record<KeyAction, string[]>;
  swipeMode: 'chord' | 'direction' | 'lane';
  mouseControls: boolean;
  touchControls: boolean;
  gamepad: boolean;
  quality: Quality;
  particles: number;
  screenShake: number;
  reducedMotion: boolean;
  colorMode: ColorMode;
  showJudgments: boolean;
  showAccuracy: boolean;
  showEarlyLate: boolean;
  showFps: boolean;
  laneFlash: boolean;
  bgDim: number;
  noteSkin: NoteSkin;
  highway: 'flat' | '3d';
  /** Gameplay look: 'board' (default), 'flat' or '3d' (stored separately from the old setting). */
  playfield: 'board' | 'flat' | '3d';
  assistTicks: boolean;
  autoSync: boolean;
  vibration: boolean;
  defaultMode: 'classic' | 'practice';
  practiceSpeed: number;
  practiceStartStage: number;
  practiceAutoRestart: boolean;
  playerName: string;
}

export const KEY_PRESETS: Record<string, { label: string; keys: Record<KeyAction, string[]> }> = {
  default: {
    label: 'A S D lanes + I J K L swipes (U O M . diagonals)',
    keys: {
      lane0: ['KeyA', 'ArrowLeft'], lane1: ['KeyS', 'ArrowDown'], lane2: ['KeyD', 'ArrowRight'],
      up: ['KeyI', 'ArrowUp', 'KeyW'], left: ['KeyJ'], down: ['KeyK'], right: ['KeyL'],
      upleft: ['KeyU'], upright: ['KeyO'], downleft: ['KeyM'], downright: ['Period'],
      pause: ['Escape', 'KeyP'], restart: ['KeyR'],
    },
  },
  arrows: {
    label: '← ↓ → lanes + W A S D swipes (Q E Z C diagonals)',
    keys: {
      lane0: ['ArrowLeft'], lane1: ['ArrowDown'], lane2: ['ArrowRight'],
      up: ['KeyW', 'ArrowUp'], left: ['KeyA'], down: ['KeyS'], right: ['KeyD'],
      upleft: ['KeyQ'], upright: ['KeyE'], downleft: ['KeyZ'], downright: ['KeyC'],
      pause: ['Escape', 'KeyP'], restart: ['KeyR'],
    },
  },
  jkl: {
    label: 'J K L lanes + W A S D swipes (Q E Z C diagonals)',
    keys: {
      lane0: ['KeyJ'], lane1: ['KeyK'], lane2: ['KeyL'],
      up: ['KeyW', 'ArrowUp'], left: ['KeyA'], down: ['KeyS'], right: ['KeyD'],
      upleft: ['KeyQ'], upright: ['KeyE'], downleft: ['KeyZ'], downright: ['KeyC'],
      pause: ['Escape', 'KeyP'], restart: ['KeyR'],
    },
  },
};

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.85,
  sfxVolume: 0.55,
  hitSounds: true,
  noteSpeed: 5,
  audioOffsetMs: 0,
  inputOffsetMs: 0,
  keys: KEY_PRESETS.default.keys,
  swipeMode: 'chord',
  mouseControls: true,
  touchControls: true,
  gamepad: true,
  quality: 'auto',
  particles: 1,
  screenShake: 0.6,
  reducedMotion: !!prefersReduced,
  colorMode: 'theme',
  showJudgments: true,
  showAccuracy: true,
  showEarlyLate: true,
  showFps: false,
  laneFlash: true,
  bgDim: 0.15,
  noteSkin: 'neon',
  highway: 'flat',
  playfield: 'board',
  assistTicks: false,
  autoSync: true,
  vibration: true,
  defaultMode: 'classic',
  practiceSpeed: 1,
  practiceStartStage: 0,
  practiceAutoRestart: false,
  playerName: 'Player',
};

const KEY = 'funkstars.settings.v1';
let current: Settings = load();
const subs = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const keys = { ...DEFAULT_SETTINGS.keys, ...(s.keys ?? {}) } as Record<KeyAction, string[]>;
      // v1 saves have no diagonal actions: add defaults only where the key isn't already bound
      const used = new Set(Object.entries(s.keys ?? {}).flatMap(([, v]) => v as string[]));
      for (const a of ['upleft', 'upright', 'downleft', 'downright'] as KeyAction[]) {
        if (!s.keys?.[a]) keys[a] = DEFAULT_SETTINGS.keys[a].filter((c) => !used.has(c));
      }
      return { ...DEFAULT_SETTINGS, ...s, keys };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_SETTINGS };
}

export function getSettings(): Settings { return current; }

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function resetSettings() { updateSettings({ ...DEFAULT_SETTINGS }); }

export function subscribeSettings(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

/** Bind `code` to `action` slot `slot`, removing it from every other action to avoid conflicts. */
export function bindKey(action: KeyAction, slot: number, code: string) {
  const keys = { ...current.keys };
  for (const a of Object.keys(keys) as KeyAction[]) keys[a] = keys[a].filter((c) => c !== code);
  const list = [...keys[action]];
  list[slot] = code;
  keys[action] = list.filter(Boolean);
  updateSettings({ keys });
}

export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Escape: 'Esc',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', Enter: 'Enter', Backspace: '⌫', Tab: 'Tab',
  };
  return map[code] ?? code.replace('Numpad', 'Num ');
}
