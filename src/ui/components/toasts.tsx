import { useSyncExternalStore } from 'react';
import { playSfx } from '../../audio/sfx';

export interface Toast { id: number; icon: string; title: string; text: string; kind: 'achievement' | 'info' | 'level' | 'error' }
let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => { toasts = [...toasts]; subs.forEach((f) => f()); };

export function toast(t: Omit<Toast, 'id'>, ms = 4200) {
  const id = nextId++;
  toasts.push({ ...t, id });
  emit();
  if (t.kind === 'achievement') playSfx('achievement', 0.6);
  if (t.kind === 'level') playSfx('levelUp', 0.6);
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== id); emit(); }, ms);
}

export function Toasts() {
  const list = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => toasts, () => toasts);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <div className="toast-icon">{t.icon}</div>
          <div>
            <div className="toast-title">{t.title}</div>
            <div className="toast-text">{t.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
