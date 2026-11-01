// Player profile, scores, progression and stats (localStorage, auto-saved).
import { useSyncExternalStore } from 'react';
import type { Difficulty, GameMode } from '../types';
import type { Medal } from '../game/scoring';
import type { SessionResult } from '../game/session';

export interface ScoreRecord {
  score: number;
  accuracy: number;
  stars: number;
  medals: Medal[];
  maxCombo: number;
  perfectPlus: number;
  perfect: number;
  great: number;
  miss: number;
  ppPct: number;
  date: number;
  mode: GameMode;
}

export interface Stats {
  plays: number;
  completions: number;
  fails: number;
  notesHit: number;
  perfectPlus: number;
  perfect: number;
  great: number;
  miss: number;
  bestCombo: number;
  timePlayed: number;
  fullCombos: number;
  allPerfects: number;
  holdsCompleted: number;
  swipesHit: number;
  clears: Record<Difficulty, number>;
}

export interface Profile {
  name: string;
  xp: number;
  bests: Record<string, Partial<Record<Difficulty, ScoreRecord>>>;
  plays: Record<string, number>;
  favorites: string[];
  achievements: Record<string, number>;
  stats: Stats;
  lastPlayed?: { songId: string; diff: Difficulty };
  calibrated: boolean;
  seenTutorial: boolean;
  createdAt: number;
}

const KEY = 'funkstars.profile.v1';
const emptyStats = (): Stats => ({
  plays: 0, completions: 0, fails: 0, notesHit: 0, perfectPlus: 0, perfect: 0, great: 0, miss: 0, bestCombo: 0,
  timePlayed: 0, fullCombos: 0, allPerfects: 0, holdsCompleted: 0, swipesHit: 0, clears: { normal: 0, hard: 0, extreme: 0 },
});
const fresh = (): Profile => ({
  name: 'Player', xp: 0, bests: {}, plays: {}, favorites: [], achievements: {}, stats: emptyStats(),
  calibrated: false, seenTutorial: false, createdAt: Date.now(),
});

let profile: Profile = load();
const subs = new Set<() => void>();

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...fresh(), ...p, stats: { ...emptyStats(), ...(p.stats ?? {}), clears: { ...emptyStats().clears, ...(p.stats?.clears ?? {}) } } };
    }
  } catch { /* ignore */ }
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function getProfile() { return profile; }
export function useProfile(): Profile { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getProfile, getProfile); }
export function updateProfile(fn: (p: Profile) => Profile | void) {
  const draft = structuredClone(profile);
  profile = fn(draft) ?? draft;
  save();
}
export function resetProfile() { profile = fresh(); save(); }

// ---------- levels ----------
export function xpForLevel(level: number) {
  // XP needed to go from `level` to `level + 1`
  return 300 + (level - 1) * 150;
}
export function levelInfo(xp: number) {
  let level = 1;
  let rest = xp;
  while (rest >= xpForLevel(level) && level < 99) { rest -= xpForLevel(level); level++; }
  return { level, into: rest, need: xpForLevel(level), pct: rest / xpForLevel(level) };
}

export function totalStars(p: Profile = profile) {
  let s = 0;
  for (const song of Object.values(p.bests)) for (const r of Object.values(song)) s += r?.stars ?? 0;
  return s;
}

export function xpForResult(r: SessionResult, diff: Difficulty): number {
  const dm = diff === 'extreme' ? 1.6 : diff === 'hard' ? 1.3 : 1;
  if (!r.completed) return Math.round(15 + (r.score / Math.max(1, r.maxScore)) * 40);
  let xp = 60 + (r.score / Math.max(1, r.maxScore)) * 160 + r.stars * 25;
  if (r.medals.includes('fc')) xp += 60;
  if (r.medals.includes('ap')) xp += 80;
  if (r.medals.includes('app')) xp += 120;
  return Math.round(xp * dm);
}

export interface RecordOutcome {
  previous?: ScoreRecord;
  newBest: boolean;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
}

export function recordResult(songId: string, diff: Difficulty, mode: GameMode, r: SessionResult, playSeconds: number,
  extra: { holdsCompleted: number; swipesHit: number }): RecordOutcome {
  const previous = profile.bests[songId]?.[diff];
  const levelBefore = levelInfo(profile.xp).level;
  const xpGained = xpForResult(r, diff) * (mode === 'practice' ? 0.5 : 1);
  const rec: ScoreRecord = {
    score: r.score, accuracy: r.accuracy, stars: r.stars, medals: r.medals, maxCombo: r.maxCombo,
    perfectPlus: r.counts.perfectPlus, perfect: r.counts.perfect, great: r.counts.great, miss: r.counts.miss,
    ppPct: r.perfectPlusPct, date: Date.now(), mode,
  };
  // practice runs never fail, but they only count as a best if they were clean of the fail rule
  const eligible = r.completed && (mode === 'classic' || r.counts.miss === 0);
  const newBest = eligible && (!previous || r.score > previous.score);
  updateProfile((p) => {
    p.xp += Math.round(xpGained);
    p.plays[songId] = (p.plays[songId] ?? 0) + 1;
    if (eligible) {
      const prev = p.bests[songId]?.[diff];
      const merged: ScoreRecord = prev && !newBest ? { ...prev } : rec;
      if (prev) {
        merged.stars = Math.max(prev.stars, rec.stars);
        merged.medals = [...new Set([...(prev.medals ?? []), ...rec.medals])] as Medal[];
        merged.maxCombo = Math.max(prev.maxCombo, rec.maxCombo);
        merged.accuracy = newBest ? rec.accuracy : prev.accuracy;
      }
      p.bests[songId] = { ...(p.bests[songId] ?? {}), [diff]: merged };
    }
    const s = p.stats;
    s.plays++;
    if (r.completed) { s.completions++; s.clears[diff]++; } else s.fails++;
    s.perfectPlus += r.counts.perfectPlus; s.perfect += r.counts.perfect; s.great += r.counts.great; s.miss += r.counts.miss;
    s.notesHit += r.counts.perfectPlus + r.counts.perfect + r.counts.great;
    s.bestCombo = Math.max(s.bestCombo, r.maxCombo);
    s.timePlayed += playSeconds;
    if (r.medals.includes('fc')) s.fullCombos++;
    if (r.medals.includes('ap')) s.allPerfects++;
    s.holdsCompleted += extra.holdsCompleted;
    s.swipesHit += extra.swipesHit;
    p.lastPlayed = { songId, diff };
  });
  return { previous, newBest, xpGained: Math.round(xpGained), levelBefore, levelAfter: levelInfo(profile.xp).level };
}

export function toggleFavorite(id: string) {
  updateProfile((p) => {
    p.favorites = p.favorites.includes(id) ? p.favorites.filter((x) => x !== id) : [...p.favorites, id];
  });
}
