// Achievements & milestone rewards.
import type { Difficulty } from '../types';
import { getProfile, levelInfo, totalStars, updateProfile, type Profile } from '../store/profile';
import type { NoteSkin } from '../store/settings';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** Returns progress [current, target]. */
  progress: (p: Profile) => [number, number];
}

const songsWith = (p: Profile, pred: (r: NonNullable<Profile['bests'][string][Difficulty]>, d: Difficulty) => boolean) =>
  Object.values(p.bests).filter((s) => (Object.entries(s) as [Difficulty, NonNullable<Profile['bests'][string][Difficulty]>][]).some(([d, r]) => r && pred(r, d))).length;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-song', name: 'First Steps', desc: 'Complete your first song', icon: '🎵', progress: (p) => [Math.min(1, p.stats.completions), 1] },
  { id: 'first-fc', name: 'Unbroken', desc: 'Get your first Full Combo', icon: '🔗', progress: (p) => [Math.min(1, p.stats.fullCombos), 1] },
  { id: 'pp-100', name: 'Pinpoint', desc: 'Hit 100 Perfect+ notes', icon: '🎯', progress: (p) => [Math.min(100, p.stats.perfectPlus), 100] },
  { id: 'pp-1000', name: 'Laser Focus', desc: 'Hit 1,000 Perfect+ notes', icon: '✨', progress: (p) => [Math.min(1000, p.stats.perfectPlus), 1000] },
  { id: 'pp-10000', name: 'Metronome Soul', desc: 'Hit 10,000 Perfect+ notes', icon: '💠', progress: (p) => [Math.min(10000, p.stats.perfectPlus), 10000] },
  { id: 'five-songs', name: 'Setlist', desc: 'Complete 5 different songs', icon: '📀', progress: (p) => [Math.min(5, songsWith(p, () => true)), 5] },
  { id: 'all-songs', name: 'Full Discography', desc: 'Complete 10 different songs', icon: '💿', progress: (p) => [Math.min(10, songsWith(p, () => true)), 10] },
  { id: 'ten-mastered', name: 'Ten Mastered', desc: 'Earn 5 stars on 10 different songs', icon: '👑', progress: (p) => [Math.min(10, songsWith(p, (r) => r.stars >= 5)), 10] },
  { id: 'hard-clear', name: 'Turning Up', desc: 'Complete a song on Hard', icon: '🔥', progress: (p) => [Math.min(1, p.stats.clears.hard), 1] },
  { id: 'extreme-clear', name: 'Extremist', desc: 'Complete a song on Extreme', icon: '⚡', progress: (p) => [Math.min(1, p.stats.clears.extreme), 1] },
  { id: 'extreme-fc', name: 'Untouchable', desc: 'Full Combo a song on Extreme', icon: '🌩️', progress: (p) => [Math.min(1, songsWith(p, (r, d) => d === 'extreme' && r.medals.includes('fc'))), 1] },
  { id: 'all-perfect', name: 'Flawless', desc: 'Get an All Perfect on any song', icon: '💎', progress: (p) => [Math.min(1, p.stats.allPerfects), 1] },
  { id: 'combo-100', name: 'Chain Reaction', desc: 'Reach a 100 combo', icon: '⛓️', progress: (p) => [Math.min(100, p.stats.bestCombo), 100] },
  { id: 'combo-300', name: 'Endless Groove', desc: 'Reach a 300 combo', icon: '♾️', progress: (p) => [Math.min(300, p.stats.bestCombo), 300] },
  { id: 'stars-25', name: 'Rising Star', desc: 'Collect 25 stars', icon: '⭐', progress: (p) => [Math.min(25, totalStars(p)), 25] },
  { id: 'stars-100', name: 'Constellation', desc: 'Collect 100 stars', icon: '🌌', progress: (p) => [Math.min(100, totalStars(p)), 100] },
  { id: 'holds-100', name: 'Hold Steady', desc: 'Complete 100 hold notes', icon: '🫴', progress: (p) => [Math.min(100, p.stats.holdsCompleted), 100] },
  { id: 'swipes-100', name: 'Swipe Right', desc: 'Hit 100 swipe notes', icon: '👆', progress: (p) => [Math.min(100, p.stats.swipesHit), 100] },
  { id: 'plays-50', name: 'Regular', desc: 'Play 50 times', icon: '🎧', progress: (p) => [Math.min(50, p.stats.plays), 50] },
  { id: 'level-10', name: 'Headliner', desc: 'Reach player level 10', icon: '🏆', progress: (p) => [Math.min(10, levelInfo(p.xp).level), 10] },
  { id: 'calibrated', name: 'Tuned In', desc: 'Calibrate your audio latency', icon: '🎚️', progress: (p) => [p.calibrated ? 1 : 0, 1] },
];

/** Check all achievements; unlock and return the newly unlocked ones. */
export function checkAchievements(): AchievementDef[] {
  const p = getProfile();
  const fresh: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    const [c, t] = a.progress(p);
    if (c >= t) fresh.push(a);
  }
  if (fresh.length) updateProfile((d) => { for (const a of fresh) d.achievements[a.id] = Date.now(); });
  return fresh;
}

export interface Milestone { level: number; name: string; desc: string; skin?: NoteSkin }
export const MILESTONES: Milestone[] = [
  { level: 1, name: 'Neon Notes', desc: 'Default glowing note skin', skin: 'neon' },
  { level: 3, name: 'Crystal Notes', desc: 'Faceted glass note skin', skin: 'crystal' },
  { level: 5, name: 'Halo Notes', desc: 'Ring-shaped note skin', skin: 'ring' },
  { level: 8, name: 'Retro Notes', desc: 'Chunky pixel note skin', skin: 'pixel' },
  { level: 12, name: 'Golden Notes', desc: 'Prestige gold note skin', skin: 'gold' },
  { level: 15, name: 'Title: Groove Master', desc: 'Profile title' },
  { level: 20, name: 'Title: Funk Legend', desc: 'Profile title' },
];

export function skinUnlocked(skin: NoteSkin, xp = getProfile().xp) {
  const m = MILESTONES.find((x) => x.skin === skin);
  return !m || levelInfo(xp).level >= m.level;
}

export function playerTitle(xp: number) {
  const lvl = levelInfo(xp).level;
  if (lvl >= 20) return 'Funk Legend';
  if (lvl >= 15) return 'Groove Master';
  if (lvl >= 10) return 'Headliner';
  if (lvl >= 5) return 'Rising Star';
  return 'Rookie';
}
