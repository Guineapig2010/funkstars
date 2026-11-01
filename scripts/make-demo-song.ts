// Renders the original demo track "First Light" to public/songs/audio/first-light.mp3.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { synthDemo, encodeWav } from './lib/demoSynth';
const d = synthDemo();
mkdirSync('songs-src/audio', { recursive: true });
const wav = 'songs-src/audio/.first-light.wav';
writeFileSync(wav, encodeWav(d.left, d.right, d.sampleRate));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', 'songs-src/audio/first-light.mp3']);
execFileSync('rm', [wav]);
writeFileSync('songs-src/first-light.groundtruth.json', JSON.stringify({ bpm: d.bpm, beats: d.beats, kicks: d.kicks, snares: d.snares }, null, 0));
console.log('wrote songs-src/audio/first-light.mp3', d.duration.toFixed(1) + 's');
