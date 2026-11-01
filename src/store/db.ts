// IndexedDB storage for imported songs (audio + cover blobs) and chart overrides.
import type { SongChartFile, SongMeta } from '../types';

const DB_NAME = 'funkstars';
const DB_VERSION = 1;

export interface StoredSong {
  id: string;
  meta: SongMeta;
  audio: Blob;
  cover?: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('charts')) db.createObjectStore('charts', { keyPath: 'songId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export const db = {
  async allSongs(): Promise<StoredSong[]> {
    try { return await tx<StoredSong[]>('songs', 'readonly', (s) => s.getAll() as IDBRequest<StoredSong[]>); } catch { return []; }
  },
  getSong(id: string) { return tx<StoredSong | undefined>('songs', 'readonly', (s) => s.get(id)); },
  putSong(song: StoredSong) { return tx('songs', 'readwrite', (s) => s.put(song)); },
  deleteSong(id: string) { return tx('songs', 'readwrite', (s) => s.delete(id)); },
  async getChart(songId: string): Promise<SongChartFile | undefined> {
    try { return await tx<SongChartFile | undefined>('charts', 'readonly', (s) => s.get(songId)); } catch { return undefined; }
  },
  putChart(chart: SongChartFile) { return tx('charts', 'readwrite', (s) => s.put(chart)); },
  deleteChart(songId: string) { return tx('charts', 'readwrite', (s) => s.delete(songId)); },
  async persist() {
    try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
  },
};
