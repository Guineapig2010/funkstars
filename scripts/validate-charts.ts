// Re-validates every built-in chart against its audio (sync + playability) without regenerating.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { analyzeAudio } from '../src/analysis/analyzer';
import { validateChart } from '../src/analysis/validate';
import type { SongChartFile } from '../src/types';
import { DIFFICULTIES } from '../src/types';
const m = JSON.parse(readFileSync('public/songs/manifest.json', 'utf8'));
let bad = 0;
for (const s of m.songs) {
  const f: SongChartFile = JSON.parse(readFileSync(`public/songs/charts/${s.id}.json`, 'utf8'));
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', `songs-src/audio/${s.fileName}`, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const res = analyzeAudio(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), 44100);
  const parts = DIFFICULTIES.map((d) => { const v = validateChart(f.charts[d], res); if (!v.playable || Math.abs(v.syncPeakMs) > 10) bad++; return `${d}: ${v.noteCount} notes, sync ${v.syncPeakMs} ms, ${v.playable ? 'playable' : v.issues.length + ' issues'}`; });
  console.log(`${s.id.padEnd(24)} ${parts.join(' | ')}${f.edited ? ' [edited]' : ''}`);
}
process.exit(bad ? 1 : 0);
