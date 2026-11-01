# FUNKSTARS

A three-lane rhythm game for desktop and mobile browsers (Chrome, Edge, Firefox, Safari incl. iOS),
inspired by Beatstar's gameplay feel but with its own name, artwork, effects and sounds.
It ships with your 10 supplied tracks (original files and filenames kept) plus one original tutorial track.

- **Gameplay:** a perspective three-lane highway with three tile sizes (regular, half, micro), holds,
  switch holds, rail holds, swipes in 4 directions and 4 diagonals, and chords.
  There are five stages per song, Classic mode (one miss ends the run) and Practice mode
  (no fail, slow-down, start from any stage).
- **Charts:** Normal, Hard and Extreme for every song. They are generated from the real audio
  (tempo, beats, onsets, energy, drops), checked automatically, and editable in the built-in chart editor.
- **Progression:** stars, medals (FC / AP / AP+), XP and levels, 21 achievements, unlockable note skins,
  statistics and personal records. Everything saves automatically.
- **Studio:** import your own audio and cover art. The game detects the BPM, generates charts,
  lets you check the beat grid, edit the charts, and saves everything in IndexedDB.
- **Controls:** rebindable keyboard, multi-touch, mouse and gamepad, with latency calibration.
  It also installs as a PWA and works offline after the first play.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. `--host` is on, so phones on the same Wi-Fi can open the network URL. Audio starts after the first tap or key press, as browsers require.

Production build:

```bash
npm run build
```

```bash
npm run preview
```

`dist/` is a fully static site. Upload it to any static host (Netlify, Vercel, GitHub Pages, S3, nginx, …).
Paths are relative (`base: './'`), so it also works from a sub-folder. PWA install and the service worker
need HTTPS (or `localhost`).

## Controls

| Action | Keyboard (default) | Touch / mouse | Gamepad |
|---|---|---|---|
| Lanes | `A` `S` `D` or `←` `↓` `→` | tap a lane | D-pad ◀▼▶ / X A B / LB RB |
| Hold | keep the key down | keep the finger down | keep the button down |
| Swipe ↑ ← ↓ → | lane key **+** `I` `J` `K` `L` (or `↑`, `W`) within 200 ms — the key is printed on the tile, either order | flick in the arrow's direction | Y / right stick |
| Diagonal swipe ↖ ↗ ↙ ↘ (gold arrows) | lane key **+** `U` `O` `M` `.`, **or** lane key + two direction keys (e.g. `I`+`L` = ↗) | flick diagonally | right stick (8-way) |
| Switch / rail hold | keep holding; press the new lane's key when the path turns (letting go of the old one is fine) | slide your finger to the new lane | press the new lane's button |
| Pause / restart | `Esc` (`P`) / `R` while paused | ❚❚ button | Start |

Other key presets: arrows + WASD (Q E Z C for diagonals) and J K L + WASD. Every action is rebindable under
Settings → Controls. Assigning a key removes it from other actions, so bindings can't conflict. Key-repeat is
ignored, and several keys on one lane plus chords are tracked separately. The "Swipe input" setting also offers
*direction key only* and *lane only (easy)* modes.

**Touch adaptation:** taps, holds and swipes map directly. Diagonal swipes accept a flick within ±35° of the
diagonal; cardinal swipes accept ±45°. Switch and rail holds are played by sliding the finger. A finger that drifts into
another lane during a normal hold is ignored, so it never triggers stray hits.

## Tile sizes

Each tap has a `size`: `regular` (default), `half` or `micro`. Size is **visual only**. All sizes use the same
timing windows (PERFECT+ ±35 ms, PERFECT ±70 ms, GREAT ±120 ms, miss after 150 ms) and centre on the hit line
at their timestamp. Half and micro tiles also draw a crisp white centre line marking the exact hit point.

The generator picks the size from the real rhythm. Spacing of a 16th note or faster becomes a microtile, 8th-note
runs become half tiles, and everything else stays regular. Microtile bursts are added only on detected fast
onsets (16th/triplet slots with strong transients). Consecutive short tiles may be closer together than regular
tiles (Hard 125 ms, Extreme 88 ms).

## Timing & sync

- **One clock.** The audio output clock drives everything (`AudioContext.getOutputTimestamp`, smoothed).
  Frame timing never decides judgements. Input events keep their own high-resolution timestamps, which map
  onto that clock, so judgement accuracy doesn't depend on FPS.
- **Decoder alignment.** Browsers trim MP3 encoder delay differently. Each chart stores an onset-envelope
  signature, and at load time the game cross-correlates it with the browser-decoded audio to remove any shift.
- **Offsets.** Settings → Audio has an audio offset and an input offset, plus a two-step calibration
  (tap to clicks, then tap to flashes).
- **Pause/resume.** Resume continues from the exact paused sample after a 3-2-1 count. A tab switch, an incoming call or
  an audio interruption pauses automatically.

## Adding songs

**In the app (no rebuild):** Studio → drop an audio file → set title, artist and cover → *Beat check*
(clicks on the detected beats; use tap tempo or ½×/2× if needed) → save → optionally edit the chart.
Imported songs live in IndexedDB on that device.

**As built-in static assets (for deployment):**
1. Copy the audio file into `public/songs/audio/` (keep the filename).
2. Add an entry to `songs-src/songs.json` (id, title, artist, genre, file, theme colours/motif; optional `cover`
   pointing at an image in `public/`).
3. Run `npm run charts`. It decodes with ffmpeg, analyses, generates and validates three charts, and writes
   `public/songs/charts/<id>.json` and `public/songs/manifest.json`. It also writes a summary to
   `songs-src/last-build-report.txt`.
4. `npm run build`.

Charts marked `"edited": true` (exported from the editor) are never overwritten. Use `npm run charts -- --force` to
regenerate them anyway, or `npm run charts -- <id>` for one song. Requires `ffmpeg` on the PATH.

## Chart format (`public/songs/charts/<id>.json`)

```jsonc
{
  "version": 1, "songId": "virou", "generator": "funkstars-chartgen/2.0",
  "analysis": { "bpm": 134.98, "beats": [...], "stages": [0, 15.1, ...], "sections": [...], "envSig": "..." },
  "charts": {
    "hard": { "difficulty": "hard", "level": 7, "notes": [
      { "t": 12.345, "lane": 0, "type": "tap" },                       // regular tile
      { "t": 12.567, "lane": 1, "type": "tap", "size": "half" },
      { "t": 12.678, "lane": 1, "type": "tap", "size": "micro" },
      { "t": 13.0,   "lane": 2, "type": "swipe", "dir": "upleft" },     // up/down/left/right + 4 diagonals
      { "t": 14.0,   "lane": 0, "type": "hold", "dur": 1.5 },
      { "t": 16.0,   "lane": 0, "type": "hold", "dur": 2.0,
        "path": [ { "t": 16.8, "lane": 1 },                              // switch (instant)
                  { "t": 17.3, "lane": 2, "slide": 0.4 } ] }             // rail (glides over 0.4 s)
    ] }
  }
}
```

`size` and `path` are optional, so older charts without them load unchanged. Export and import charts as JSON in
the editor or the Studio. Edited charts are stored as overrides in IndexedDB and never modify the shipped files.

## Testing

```bash
npm test
```

Runs the unit tests: rules engine, tile sizes, holds, switch/rail holds, diagonals, scoring, playability of every
built-in chart, backward compatibility, and analyzer accuracy against a synthesized track with known beat times.

```bash
npm run build && npm run e2e
```

Runs the browser tests in headless Chromium. They navigate every screen, take screenshots at 1366×768, 1080p, 1440p, 4K,
iPhone portrait/landscape and iPad into `e2e-out/`, and play songs and the tutorial through the real input
handlers (keyboard and touch paths). They also check pause/resume/restart, saving, settings persistence and the editor.

```bash
npm run validate
```

Re-runs chart validation and prints the sync/playability report.

## Project structure

```
src/analysis/   FFT, onset features, tempo/beat tracking, chart generator, playability rules, validation, worker
src/audio/      Web Audio engine + smoothed clock, synthesized SFX, menu previews
src/game/       session (rules/scoring), renderer, sprites, particles, WebGL background, input, controller,
                notes (sizes/paths/directions), tutorial, achievements, palettes
src/store/      settings, profile/progression, IndexedDB, song registry
src/ui/         React screens (home, library, details, play, results, settings, progress, achievements,
                studio, editor, calibrate) and components
scripts/        build-songs (offline analysis), validate-charts, e2e, icons, demo-track synth, zip
public/songs/   audio (your original files), generated charts, manifest
```

## Status / known limits

- The charts are machine-generated and checked automatically. The beat grid and note placement are verified
  against detected audio transients, and every chart passes the playability rules. Nobody has listened to them,
  though. Use the editor (with note ticks and metronome) to fine-tune any passage that doesn't feel right.
- Song artists are "Unknown Artist" except Faixa Rosa (Jmilton x Ogryzek, from the filename). Genres are guesses.
  Edit `songs-src/songs.json` to correct them.
- Practice slow-down uses `playbackRate`, so pitch drops with speed.
- iPhone Safari doesn't support element fullscreen. Use *Add to Home Screen* to get the full-screen app.
- Music rights: check distribution permissions before publishing the supplied tracks.
