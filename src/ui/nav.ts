// Minimal navigation store with history and transition direction.
import { useSyncExternalStore } from 'react';
import type { Difficulty, GameMode } from '../types';
import type { FinishInfo } from '../game/controller';
import type { RecordOutcome } from '../store/profile';
import type { AchievementDef } from '../game/achievements';

export type Route =
  | { name: 'splash' }
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'details'; songId: string }
  | { name: 'play'; songId: string; diff: Difficulty; mode: GameMode; playtest?: boolean; startAt?: number; nonce?: number }
  | { name: 'results'; songId: string; diff: Difficulty; mode: GameMode; info: FinishInfo; outcome: RecordOutcome; unlocked: AchievementDef[] }
  | { name: 'settings'; tab?: string }
  | { name: 'progress' }
  | { name: 'achievements' }
  | { name: 'studio' }
  | { name: 'editor'; songId: string; diff?: Difficulty }
  | { name: 'calibrate'; back?: Route };

interface NavState { route: Route; stack: Route[]; dir: 1 | -1; key: number }

let state: NavState = { route: { name: 'splash' }, stack: [], dir: 1, key: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const nav = {
  go(route: Route) {
    state = { route, stack: [...state.stack, state.route], dir: 1, key: state.key + 1 };
    emit();
  },
  replace(route: Route) {
    state = { ...state, route, dir: 1, key: state.key + 1 };
    emit();
  },
  back(fallback: Route = { name: 'home' }) {
    const stack = [...state.stack];
    let prev = stack.pop();
    while (prev && (prev.name === 'play' || prev.name === 'splash' || prev.name === 'results')) prev = stack.pop();
    state = { route: prev ?? fallback, stack, dir: -1, key: state.key + 1 };
    emit();
  },
  home() {
    state = { route: { name: 'home' }, stack: [], dir: -1, key: state.key + 1 };
    emit();
  },
  get current() { return state.route; },
};

export function useNav(): NavState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);
}
