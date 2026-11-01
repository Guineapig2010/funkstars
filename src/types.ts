// Shared data types for FUNKSTARS.

export type Lane = 0 | 1 | 2;
export type NoteType = 'tap' | 'hold' | 'swipe';
export type SwipeDir = 'up' | 'down' | 'left' | 'right' | 'upleft' | 'upright' | 'downleft' | 'downright';
export const CARDINAL_DIRS: SwipeDir[] = ['up', 'down', 'left', 'right'];
export const DIAGONAL_DIRS: SwipeDir[] = ['upleft', 'upright', 'downleft', 'downright'];
/** Visual tile size. Timing windows are identical for every size. */
export type TileSize = 'regular' | 'half' | 'micro';

/**
 * A lane transition inside a hold. At time `t` the hold starts moving to `lane`, arriving at
 * `t + slide`. slide = 0 is an instant *switch*; slide > 0 is a *rail* (gradual slide).
 */
export interface PathPoint { t: number; lane: Lane; slide?: number }
export type Difficulty = 'normal' | 'hard' | 'extreme';
export const DIFFICULTIES: Difficulty[] = ['normal', 'hard', 'extreme'];

/** A single note in a chart. Times are in seconds of song (audio) time. */
export interface ChartNote {
  t: number;
  lane: Lane;
  type: NoteType;
  /** Hold duration in seconds (hold notes only). */
  dur?: number;
  /** Swipe direction (swipe notes only). */
  dir?: SwipeDir;
  /** Visual tile size (tap / swipe). Missing = 'regular' (older charts). */
  size?: TileSize;
  /** Hold notes only: lane transitions (switch / rail holds). */
  path?: PathPoint[];
}

export interface Chart {
  difficulty: Difficulty;
  /** Difficulty level shown to the player (1–15). */
  level: number;
  notes: ChartNote[];
}

export interface SongSection {
  t: number;
  /** 0..1 relative energy. */
  energy: number;
  kind: 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'outro';
}

export interface SongAnalysis {
  duration: number;
  bpm: number;
  /** Beat times (seconds). Tempo changes are represented by non-uniform spacing. */
  beats: number[];
  /** Index (0..3) of the beat within each bar that carries the downbeat. */
  downbeatPhase: number;
  /** Five gameplay stage start times. stages[0] is always 0. */
  stages: number[];
  sections: SongSection[];
  /** Times where a major drop / chorus hit starts. */
  drops: number[];
  /** Energy curve sampled every `energyStep` seconds, 0..1. */
  energy: number[];
  energyStep: number;
  firstOnset: number;
  lastOnset: number;
  /** Suggested preview start time for menus. */
  previewStart: number;
  /** Onset-envelope signature (base64 uint8) used to auto-align browser decoders. */
  envSig?: string;
  envRate?: number;
  /** Confidence 0..1 of the tempo/beat estimate. */
  beatConfidence: number;
  /** Beat subdivision feel: 4 = straight (16ths), 3 = triplet / compound (12/8 swing). */
  subdivision?: 3 | 4;
}

export interface ChartValidation {
  /** Offset (ms) at which notes best align with audio transients. 0 = perfectly aligned. */
  syncPeakMs: number;
  /** Ratio of onset strength at note times vs. random times (>1 means notes land on transients). */
  onsetContrast: number;
  playable: boolean;
  issues: string[];
  noteCount: number;
  nps: number;
}

export interface SongChartFile {
  version: 1;
  songId: string;
  generator: string;
  analysis: SongAnalysis;
  charts: Record<Difficulty, Chart>;
  validation?: Partial<Record<Difficulty, ChartValidation>>;
  /** true if a human edited this chart in the editor. */
  edited?: boolean;
}

export interface SongTheme {
  /** Three CSS hex colours: primary, secondary, accent. */
  colors: [string, string, string];
  /** Background shader mode 0..3. */
  bg: number;
  /** Procedural cover motif. */
  motif: CoverMotif;
}

export type CoverMotif = 'sunburst' | 'waves' | 'grid' | 'orbs' | 'shards' | 'spiral' | 'rings' | 'bars' | 'eclipse' | 'prism';

export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  genre: string;
  /** Short tag e.g. "Super Slowed". */
  tag?: string;
  /** Original supplied filename (preserved). */
  fileName?: string;
  /** URL of audio (builtin) — imported songs load from IndexedDB. */
  audioUrl?: string;
  chartUrl?: string;
  coverUrl?: string;
  duration: number;
  bpm: number;
  levels: Record<Difficulty, number>;
  noteCounts: Record<Difficulty, number>;
  theme: SongTheme;
  source: 'builtin' | 'imported' | 'demo';
  addedAt: number;
  previewStart: number;
}

export type Judgment = 'perfectPlus' | 'perfect' | 'great' | 'miss';
export type GameMode = 'classic' | 'practice';
