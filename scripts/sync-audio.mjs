// Copies the original audio (songs-src/audio, filenames preserved) to public/songs/audio/<id>.mp3 so
// every static host can serve it (original names contain spaces, '+', apostrophes, parentheses).
import { readFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
const src = JSON.parse(readFileSync('songs-src/songs.json', 'utf8'));
mkdirSync('public/songs/audio', { recursive: true });
let n = 0;
for (const s of src.songs) {
  const from = `songs-src/audio/${s.file}`;
  const ext = s.file.split('.').pop().toLowerCase();
  const to = `public/songs/audio/${s.id}.${ext}`;
  if (!existsSync(from)) { console.warn(`missing ${from}`); continue; }
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) { copyFileSync(from, to); n++; }
}
if (n) console.log(`synced ${n} audio file(s) to public/songs/audio`);
