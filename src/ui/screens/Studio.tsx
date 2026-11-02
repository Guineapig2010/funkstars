// Song import studio: upload audio + art, automatic BPM / beat analysis, chart generation,
// beat-grid check, save to IndexedDB, and management of imported songs / chart overrides.
import { useEffect, useRef, useState } from 'react';
import { nav } from '../nav';
import { TabBar } from './Home';
import { audio } from '../../audio/engine';
import { db } from '../../store/db';
import { useSongs, upsertSongMeta, removeSongMeta, getChartFile, saveChartOverride, clearAudioCache } from '../../store/songs';
import { Btn, Cover, DIFF_META, Icon, ScreenHeader, fmtTime } from '../components/common';
import { toast } from '../components/toasts';
import { preview } from '../../audio/preview';
import { toMono } from '../../analysis/features';
import type { CoverMotif, SongChartFile, SongMeta, SongTheme } from '../../types';
import { DIFFICULTIES } from '../../types';
import type { WorkerResponse } from '../../analysis/worker';

const MOTIFS: CoverMotif[] = ['sunburst', 'waves', 'grid', 'orbs', 'shards', 'spiral', 'rings', 'bars', 'eclipse', 'prism'];
const PALETTES: [string, string, string][] = [
  ['#ff3d9a', '#7b2bff', '#ffd23f'], ['#19f5c1', '#0b3cff', '#c8ff3d'], ['#ff8a00', '#ff2d6f', '#ffe5a8'], ['#a77bff', '#00d0ff', '#ff7bd5'],
  ['#ff2a2a', '#3a0010', '#ff9a3d'], ['#3dffb0', '#0a5cff', '#b4ff00'], ['#2f7bff', '#00e1ff', '#ffe14d'], ['#ff6ec7', '#ffb3e6', '#7a2cff'],
];

function slug(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40) || 'song';
}

function prettyTitle(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/\(\d+\)$/, '').trim();
  const tagMatch = base.match(/\(([^)]*(slowed|remix|edit|version|sped up|reverb)[^)]*)\)/i);
  const title = base.replace(/\([^)]*\)/g, '').replace(/\s+-\s+.*$/, '').trim();
  const artist = base.includes(' - ') ? base.split(' - ').slice(1).join(' - ').replace(/\([^)]*\)/g, '').trim() : '';
  const tc = (t: string) => t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : t;
  return { title: tc(title || base), tag: tagMatch ? tc(tagMatch[1]) : '', artist: artist ? tc(artist) : '' };
}

async function averageColor(blob: Blob): Promise<[string, string, string] | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    const px: [number, number, number, number][] = [];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      px.push([r, gg, b, (mx - mn) * (mx / 255)]);
    }
    px.sort((a, b) => b[3] - a[3]);
    const hex = (p: number[]) => '#' + p.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
    const dark = px[px.length - 1];
    return [hex(px[0]), hex([dark[0] * 0.6, dark[1] * 0.6, dark[2] * 0.6]), hex(px[Math.floor(px.length * 0.15)])];
  } catch { return null; }
}

interface Draft {
  file: File;
  buffer: AudioBuffer;
  title: string; artist: string; genre: string; tag: string;
  cover?: Blob; coverUrl?: string;
  theme: SongTheme;
  id: string;
  chart?: SongChartFile;
  bpmOverride?: number;
}

export function StudioScreen() {
  const songs = useSongs();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [progress, setProgress] = useState<{ p: number; stage: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [beatCheck, setBeatCheck] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const beatNodes = useRef<AudioScheduledSourceNode[]>([]);
  const imported = songs.filter((s) => s.source === 'imported');

  useEffect(() => () => { workerRef.current?.terminate(); stopBeatCheck(); }, []);

  const onAudio = async (f: File) => {
    try {
      await audio.unlock();
      preview.stop();
      const ab = await f.arrayBuffer();
      const buffer = await audio.decode(ab.slice(0));
      const guess = prettyTitle(f.name);
      const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
      const d: Draft = {
        file: f, buffer, title: guess.title, artist: guess.artist || 'Unknown Artist', genre: 'Imported', tag: guess.tag,
        theme: { colors: pal, bg: Math.floor(Math.random() * 4), motif: MOTIFS[Math.floor(Math.random() * MOTIFS.length)] },
        id: `${slug(guess.title)}-${Math.random().toString(36).slice(2, 6)}`,
      };
      setDraft(d);
      analyze(d);
    } catch (e) {
      toast({ kind: 'error', icon: '⚠️', title: 'Could not read audio', text: e instanceof Error ? e.message : 'Unsupported or corrupted file' });
    }
  };

  const analyze = (d: Draft, bpm?: number) => {
    workerRef.current?.terminate();
    const w = new Worker(new URL('../../analysis/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const chans: Float32Array[] = [];
    for (let c = 0; c < d.buffer.numberOfChannels; c++) chans.push(d.buffer.getChannelData(c));
    const mono = new Float32Array(toMono(chans));
    setProgress({ p: 0, stage: 'Starting analysis' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') setProgress({ p: m.p, stage: m.stage });
      else if (m.type === 'done') { setProgress(null); setDraft((cur) => cur && cur.id === d.id ? { ...cur, chart: m.file, bpmOverride: bpm } : cur); w.terminate(); }
      else { setProgress(null); toast({ kind: 'error', icon: '⚠️', title: 'Analysis failed', text: m.message }); w.terminate(); }
    };
    w.postMessage({ id: d.id, mono, sampleRate: d.buffer.sampleRate, bpm }, [mono.buffer]);
  };

  const onCover = async (f: File) => {
    if (!draft) return;
    const colors = await averageColor(f);
    setDraft({ ...draft, cover: f, coverUrl: URL.createObjectURL(f), theme: colors ? { ...draft.theme, colors } : draft.theme });
  };

  const stopBeatCheck = () => {
    beatNodes.current.forEach((n) => { try { n.stop(); } catch { /* ignore */ } });
    beatNodes.current = [];
    setBeatCheck(false);
  };

  const startBeatCheck = () => {
    if (!draft?.chart || !audio.ctx) return;
    stopBeatCheck();
    const ctx = audio.ctx;
    const A = draft.chart.analysis;
    const from = Math.max(0, A.previewStart - 2);
    const t0 = ctx.currentTime + 0.15;
    const src = ctx.createBufferSource();
    src.buffer = draft.buffer;
    src.connect(audio.musicBus);
    src.start(t0, from, 24);
    const click = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
    const cd = click.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.sin(i / ctx.sampleRate * 2 * Math.PI * 2000) * Math.exp(-i / ctx.sampleRate * 150);
    const nodes: AudioScheduledSourceNode[] = [src];
    A.beats.forEach((b, i) => {
      if (b < from || b > from + 24) return;
      const s = ctx.createBufferSource();
      s.buffer = click;
      const g = ctx.createGain();
      g.gain.value = (i - A.downbeatPhase) % 4 === 0 ? 0.9 : 0.45;
      s.connect(g); g.connect(audio.sfxBus);
      s.start(t0 + (b - from));
      nodes.push(s);
    });
    beatNodes.current = nodes;
    setBeatCheck(true);
    src.onended = () => setBeatCheck(false);
  };

  const tapTempo = () => {
    const now = performance.now();
    const list = [...taps.filter((t) => now - t < 3000), now];
    setTaps(list);
  };
  const tapBpm = taps.length >= 4 ? Math.round((60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))) * 10) / 10 : null;

  const save = async (then: 'stay' | 'play' | 'edit') => {
    if (!draft?.chart) return;
    stopBeatCheck();
    const A = draft.chart.analysis;
    const meta: SongMeta = {
      id: draft.id, title: draft.title.trim() || 'Untitled', artist: draft.artist.trim() || 'Unknown Artist', genre: draft.genre.trim() || 'Imported',
      tag: draft.tag.trim() || undefined, fileName: draft.file.name, duration: A.duration, bpm: A.bpm,
      levels: { normal: draft.chart.charts.normal.level, hard: draft.chart.charts.hard.level, extreme: draft.chart.charts.extreme.level },
      noteCounts: { normal: draft.chart.charts.normal.notes.length, hard: draft.chart.charts.hard.notes.length, extreme: draft.chart.charts.extreme.notes.length },
      theme: draft.theme, source: 'imported', addedAt: Date.now(), previewStart: A.previewStart,
      coverUrl: draft.coverUrl,
    };
    try {
      await db.putSong({ id: meta.id, meta: { ...meta, coverUrl: undefined }, audio: draft.file, cover: draft.cover });
      await db.putChart(draft.chart);
      upsertSongMeta(meta);
      toast({ kind: 'info', icon: '🎶', title: 'Song saved', text: `${meta.title} is now in your library.` });
      setDraft(null);
      if (then === 'play') nav.go({ name: 'details', songId: meta.id });
      if (then === 'edit') nav.go({ name: 'editor', songId: meta.id, diff: 'normal' });
    } catch (e) {
      toast({ kind: 'error', icon: '⚠️', title: 'Save failed', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const del = async (s: SongMeta) => {
    if (!confirm(`Delete “${s.title}” and its charts from this device?`)) return;
    await db.deleteSong(s.id);
    await db.deleteChart(s.id);
    clearAudioCache(s.id);
    removeSongMeta(s.id);
  };

  const exportChart = async (s: SongMeta) => {
    const f = await getChartFile(s);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(f)], { type: 'application/json' }));
    a.download = `${s.id}.json`;
    a.click();
  };

  const importChartFor = async (s: SongMeta, file: File) => {
    try {
      const data = JSON.parse(await file.text()) as SongChartFile;
      if (!data.charts || !data.analysis) throw new Error('Not a FUNKSTARS chart file');
      data.songId = s.id;
      data.edited = true;
      await saveChartOverride(data, s);
      toast({ kind: 'info', icon: '📄', title: 'Chart imported', text: `Applied to ${s.title}` });
    } catch (e) {
      toast({ kind: 'error', icon: '⚠️', title: 'Chart import failed', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const previewMeta: SongMeta | null = draft ? {
    id: draft.id, title: draft.title || 'Untitled', artist: draft.artist, genre: draft.genre, tag: draft.tag, duration: draft.buffer.duration, bpm: draft.chart?.analysis.bpm ?? 0,
    levels: { normal: 0, hard: 0, extreme: 0 }, noteCounts: { normal: 0, hard: 0, extreme: 0 }, theme: draft.theme, source: 'imported', addedAt: 0, previewStart: 0, coverUrl: draft.coverUrl,
  } : null;

  return (
    <div className="studio">
      <ScreenHeader title="Studio" subtitle="Import songs, generate charts, fix timing" onBack={() => nav.back()} />
      <div className="studio-grid">
        <div className="glass studio-import">
          {!draft && (
            <label className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onAudio(f); }}>
              <Icon name="music" size={48} />
              <b>Drop an audio file here or click to browse</b>
              <small>MP3 · WAV · OGG · M4A/AAC · FLAC (whatever your browser can decode)</small>
              <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm" hidden onChange={(e) => e.target.files?.[0] && onAudio(e.target.files[0])} />
            </label>
          )}
          {draft && previewMeta && (
            <div className="draft">
              <div className="draft-top">
                <div className="draft-cover">
                  <Cover meta={previewMeta} size={180} key={draft.coverUrl ?? draft.theme.motif + draft.title} />
                  <label className="btn btn-glass small file-btn"><Icon name="upload" size={16} /><span className="btn-label">Cover art</span>
                    <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onCover(e.target.files[0])} />
                  </label>
                  {!draft.cover && <button className="link" onClick={() => setDraft({ ...draft, theme: { colors: PALETTES[Math.floor(Math.random() * PALETTES.length)], bg: Math.floor(Math.random() * 4), motif: MOTIFS[Math.floor(Math.random() * MOTIFS.length)] } })}>Shuffle generated art</button>}
                </div>
                <div className="draft-fields">
                  <label className="text-field"><span>Title</span><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                  <label className="text-field"><span>Artist</span><input value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })} /></label>
                  <div className="two">
                    <label className="text-field"><span>Genre</span><input value={draft.genre} onChange={(e) => setDraft({ ...draft, genre: e.target.value })} /></label>
                    <label className="text-field"><span>Tag (optional)</span><input value={draft.tag} placeholder="e.g. Slowed" onChange={(e) => setDraft({ ...draft, tag: e.target.value })} /></label>
                  </div>
                  <div className="file-note">♪ {draft.file.name} · {fmtTime(draft.buffer.duration)} · {draft.buffer.sampleRate} Hz</div>
                </div>
              </div>

              {progress && (
                <div className="analysis-progress">
                  <div className="bar"><span style={{ width: `${progress.p * 100}%` }} /></div>
                  <small>{progress.stage}…</small>
                </div>
              )}

              {draft.chart && !progress && (
                <div className="analysis-result">
                  <div className="ar-facts">
                    <div><b>{draft.chart.analysis.bpm.toFixed(1)}</b><span>BPM (detected)</span></div>
                    <div><b>{Math.round(draft.chart.analysis.beatConfidence * 100)}%</b><span>Beat confidence</span></div>
                    <div><b>{draft.chart.analysis.subdivision === 3 ? 'Triplet' : 'Straight'}</b><span>Feel</span></div>
                    <div><b>{draft.chart.analysis.drops.length}</b><span>Drops found</span></div>
                  </div>
                  <div className="ar-charts">
                    {DIFFICULTIES.map((d) => {
                      const v = draft.chart!.validation?.[d];
                      return (
                        <div key={d} className="ar-chart" style={{ ['--dc' as string]: DIFF_META[d].color }}>
                          <b>{DIFF_META[d].label} {draft.chart!.charts[d].level}</b>
                          <span>{draft.chart!.charts[d].notes.length} notes</span>
                          {v && <small>{v.playable ? '✓ playable' : `${v.issues.length} issues`} · sync {v.syncPeakMs} ms</small>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="ar-tools">
                    <Btn variant="glass" icon={<Icon name={beatCheck ? 'pause' : 'play'} size={16} />} onClick={() => beatCheck ? stopBeatCheck() : startBeatCheck()}>
                      {beatCheck ? 'Stop beat check' : 'Beat check (clicks on detected beats)'}
                    </Btn>
                    <div className="bpm-fix">
                      <button className="btn btn-glass small" onClick={tapTempo}>Tap tempo{tapBpm ? `: ${tapBpm}` : ''}</button>
                      <button className="btn btn-glass small" onClick={() => analyze(draft, draft.chart!.analysis.bpm / 2)}>½×</button>
                      <button className="btn btn-glass small" onClick={() => analyze(draft, draft.chart!.analysis.bpm * 2)}>2×</button>
                      {tapBpm && <button className="btn btn-primary small" onClick={() => analyze(draft, tapBpm)}>Re-analyse at {tapBpm}</button>}
                    </div>
                  </div>
                  <p className="help">If the clicks drift from the music, tap along to set the right tempo (or halve/double it) and re-analyse. Note-level timing can then be fine-tuned in the chart editor.</p>
                  <div className="row-btns">
                    <Btn variant="play" icon={<Icon name="play" />} onClick={() => save('play')}>Save & play</Btn>
                    <Btn variant="primary" icon={<Icon name="edit" />} onClick={() => save('edit')}>Save & edit chart</Btn>
                    <Btn variant="glass" onClick={() => save('stay')}>Save</Btn>
                    <Btn variant="danger" sfx="uiBack" onClick={() => { stopBeatCheck(); setDraft(null); }}>Discard</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="glass studio-list">
          <h3>Imported songs</h3>
          {!imported.length && <p className="help">Nothing imported yet. Songs you import are stored on this device (IndexedDB) and appear in the library alongside the built-in tracks.</p>}
          {imported.map((s) => (
            <div key={s.id} className="studio-row">
              <Cover meta={s} size={52} />
              <span className="rr-title"><b>{s.title}</b><small>{s.artist} · {fmtTime(s.duration)} · {Math.round(s.bpm)} BPM</small></span>
              <Btn variant="glass" className="round small" aria-label="Play" onClick={() => nav.go({ name: 'details', songId: s.id })} icon={<Icon name="play" size={16} />} />
              <Btn variant="glass" className="round small" aria-label="Edit chart" onClick={() => nav.go({ name: 'editor', songId: s.id })} icon={<Icon name="edit" size={16} />} />
              <Btn variant="glass" className="round small" aria-label="Export chart JSON" onClick={() => exportChart(s)} icon={<Icon name="download" size={16} />} />
              <Btn variant="danger" className="round small" aria-label="Delete" onClick={() => del(s)} icon={<Icon name="trash" size={16} />} />
            </div>
          ))}
          <h3>Chart files (all songs)</h3>
          <p className="help">Export any song’s chart as JSON, or import a corrected chart to replace it. Charts edited here are stored as overrides and never touch the original files.</p>
          <div className="chart-files">
            {songs.map((s) => (
              <div key={s.id} className="chart-file-row">
                <span>{s.title}</span>
                <button className="btn btn-glass small" onClick={() => exportChart(s)}>Export</button>
                <label className="btn btn-glass small file-btn"><span className="btn-label">Import</span>
                  <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importChartFor(s, e.target.files[0])} />
                </label>
                <button className="btn btn-glass small" onClick={() => nav.go({ name: 'editor', songId: s.id })}>Edit</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <TabBar active="studio" />
    </div>
  );
}
