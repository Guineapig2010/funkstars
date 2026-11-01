// Offline song pipeline: decode -> analyse -> generate 3 charts -> validate -> write JSON + manifest.
// Usage: npm run charts            (all songs)
//        npm run charts -- <id>    (one song)
//        npm run charts -- --force (also regenerate charts marked "edited")
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { analyzeAudio } from '../src/analysis/analyzer';
import { generateCharts, GENERATOR_VERSION } from '../src/analysis/chartGen';
import { validateChart } from '../src/analysis/validate';
import type { Difficulty, SongChartFile, SongMeta, SongTheme } from '../src/types';
import { DIFFICULTIES } from '../src/types';

interface SrcSong {
  id: string; title: string; tag?: string; artist: string; genre: string; file: string;
  theme: SongTheme; source?: 'builtin' | 'demo'; cover?: string;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const src: { songs: SrcSong[] } = JSON.parse(readFileSync('songs-src/songs.json', 'utf8'));
mkdirSync('public/songs/charts', { recursive: true });

function decode(path: string, sr = 44100): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const manifest: SongMeta[] = [];
const report: string[] = [];
let addedAt = Date.UTC(2026, 10, 1);
for (const s of src.songs) {
  const audioPath = `public/songs/audio/${s.file}`;
  if (!existsSync(audioPath)) { console.warn(`! missing audio for ${s.id}: ${audioPath}`); continue; }
  const chartPath = `public/songs/charts/${s.id}.json`;
  const mono = decode(audioPath);
  const t0 = Date.now();
  const res = analyzeAudio(mono, 44100);
  let file: SongChartFile;
  const existing: SongChartFile | null = existsSync(chartPath) ? JSON.parse(readFileSync(chartPath, 'utf8')) : null;
  const regenerate = (only.length === 0 || only.includes(s.id)) && (force || !existing?.edited);
  if (!regenerate && existing) {
    file = existing;
  } else {
    const charts = generateCharts(res, s.id);
    file = { version: 1, songId: s.id, generator: GENERATOR_VERSION, analysis: res.analysis, charts };
  }
  file.validation = {};
  for (const d of DIFFICULTIES) file.validation[d] = validateChart(file.charts[d], res);
  writeFileSync(chartPath, JSON.stringify(file));
  const A = file.analysis;
  const levels = Object.fromEntries(DIFFICULTIES.map((d) => [d, file.charts[d].level])) as Record<Difficulty, number>;
  const noteCounts = Object.fromEntries(DIFFICULTIES.map((d) => [d, file.charts[d].notes.length])) as Record<Difficulty, number>;
  manifest.push({
    id: s.id, title: s.title, artist: s.artist, genre: s.genre, tag: s.tag, fileName: s.file,
    audioUrl: `songs/audio/${encodeURIComponent(s.file)}`, chartUrl: `songs/charts/${s.id}.json`,
    coverUrl: s.cover, duration: Math.round(A.duration * 100) / 100, bpm: A.bpm, levels, noteCounts,
    theme: s.theme, source: s.source ?? 'builtin', addedAt: addedAt++, previewStart: A.previewStart,
  });
  const v = file.validation;
  const line = `${s.id.padEnd(24)} ${A.duration.toFixed(1).padStart(6)}s  bpm ${A.bpm.toFixed(2).padStart(7)}  beatConf ${A.beatConfidence.toFixed(2)}  ` +
    DIFFICULTIES.map((d) => `${d[0].toUpperCase()}:${file.charts[d].notes.length}n L${file.charts[d].level} sync ${v[d]!.syncPeakMs}ms x${v[d]!.onsetContrast}${v[d]!.playable ? '' : ' !' + v[d]!.issues.length}`).join('  ') +
    `  (${Date.now() - t0}ms)${regenerate ? '' : ' [kept edited chart]'}`;
  console.log(line);
  report.push(line);
}
writeFileSync('public/songs/manifest.json', JSON.stringify({ version: 1, songs: manifest }, null, 1));
writeFileSync('songs-src/last-build-report.txt', report.join('\n') + '\n');
console.log(`\nWrote ${manifest.length} songs to public/songs/manifest.json`);
