// Song registry: built-in songs (static manifest) + imported songs (IndexedDB) + chart overrides.
import { useSyncExternalStore } from 'react';
import type { SongChartFile, SongMeta } from '../types';
import { db } from './db';
import { audio } from '../audio/engine';
import { alignToSignature } from '../analysis/align';
import { toMono } from '../analysis/features';

let songs: SongMeta[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => { songs = [...songs]; subs.forEach((f) => f()); };

export async function loadLibrary(): Promise<SongMeta[]> {
  let builtin: SongMeta[] = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}songs/manifest.json`, { cache: 'no-cache' });
    builtin = (await res.json()).songs as SongMeta[];
  } catch (e) {
    console.error('Failed to load song manifest', e);
  }
  const imported = (await db.allSongs()).map((s) => ({ ...s.meta, coverUrl: s.cover ? URL.createObjectURL(s.cover) : undefined }));
  songs = [...builtin, ...imported];
  loaded = true;
  emit();
  return songs;
}

export function getSongs() { return songs; }
export function getSong(id: string) { return songs.find((s) => s.id === id); }
export function librarySubscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function useSongs(): SongMeta[] { return useSyncExternalStore(librarySubscribe, getSongs, getSongs); }
export function isLibraryLoaded() { return loaded; }

export function upsertSongMeta(meta: SongMeta) {
  const i = songs.findIndex((s) => s.id === meta.id);
  if (i >= 0) songs[i] = meta; else songs.push(meta);
  emit();
}
export function removeSongMeta(id: string) {
  songs = songs.filter((s) => s.id !== id);
  emit();
}

// ---------- charts ----------
const chartCache = new Map<string, SongChartFile>();

export async function getChartFile(meta: SongMeta, opts: { ignoreOverride?: boolean } = {}): Promise<SongChartFile> {
  if (!opts.ignoreOverride) {
    const override = await db.getChart(meta.id);
    if (override) return override;
  }
  const key = meta.id;
  if (chartCache.has(key) && !opts.ignoreOverride) return chartCache.get(key)!;
  if (!meta.chartUrl) throw new Error('No chart for ' + meta.title);
  const res = await fetch(`${import.meta.env.BASE_URL}${meta.chartUrl}`);
  const file = (await res.json()) as SongChartFile;
  chartCache.set(key, file);
  return file;
}

export async function saveChartOverride(file: SongChartFile, meta?: SongMeta) {
  await db.putChart(file);
  if (meta) {
    const m = { ...meta };
    for (const d of ['normal', 'hard', 'extreme'] as const) {
      m.levels = { ...m.levels, [d]: file.charts[d].level };
      m.noteCounts = { ...m.noteCounts, [d]: file.charts[d].notes.length };
    }
    if (m.source === 'imported') {
      const stored = await db.getSong(m.id);
      if (stored) await db.putSong({ ...stored, meta: m });
    }
    upsertSongMeta(m);
  }
}

export async function hasChartOverride(id: string) { return !!(await db.getChart(id)); }

// ---------- audio ----------
const bufferCache = new Map<string, Promise<AudioBuffer>>();
const order: string[] = [];
const alignCache = new Map<string, number>();

export async function fetchSongBlob(meta: SongMeta): Promise<ArrayBuffer> {
  if (meta.source === 'imported') {
    const s = await db.getSong(meta.id);
    if (!s) throw new Error('Imported audio missing');
    return s.audio.arrayBuffer();
  }
  const res = await fetch(`${import.meta.env.BASE_URL}${meta.audioUrl}`);
  if (!res.ok) throw new Error(`Audio not found (${res.status})`);
  return res.arrayBuffer();
}

export function loadSongBuffer(meta: SongMeta): Promise<AudioBuffer> {
  let p = bufferCache.get(meta.id);
  if (!p) {
    p = fetchSongBlob(meta).then((ab) => audio.decode(ab));
    p.catch(() => bufferCache.delete(meta.id));
    bufferCache.set(meta.id, p);
    order.push(meta.id);
    while (order.length > 3) bufferCache.delete(order.shift()!);
  } else {
    order.splice(order.indexOf(meta.id), 1);
    order.push(meta.id);
  }
  return p;
}

/**
 * Seconds the browser-decoded buffer is shifted relative to the offline analysis (MP3 encoder
 * delay handling differs between browsers). Computed once per song by envelope cross-correlation.
 */
export function decoderAlignment(meta: SongMeta, buf: AudioBuffer, file: SongChartFile): number {
  const sig = file.analysis.envSig;
  const key = `${meta.id}:${sig ? sig.length + sig.slice(200, 260) : 'none'}`;
  if (alignCache.has(key)) return alignCache.get(key)!;
  let off = 0;
  if (sig) {
    const chans: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    try {
      const r = alignToSignature(toMono(chans), buf.sampleRate, sig);
      if (r.confidence > 0.2) off = r.offset;
    } catch (e) { console.warn('alignment failed', e); }
  }
  alignCache.set(key, off);
  if (Math.abs(off) > 0.0005) console.info(`[sync] ${meta.title}: browser decoder offset ${(off * 1000).toFixed(1)} ms corrected`);
  return off;
}

export function clearAudioCache(id: string) {
  bufferCache.delete(id);
  chartCache.delete(id);
  for (const k of [...alignCache.keys()]) if (k.startsWith(id + ':')) alignCache.delete(k);
}
