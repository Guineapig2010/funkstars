// Chart editor: waveform + beat grid timeline, note tools (tap / hold / swipe / select / erase),
// snapping, undo/redo, playback with assist ticks, global offset correction, validation, playtest,
// save as override, JSON import/export.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nav } from '../nav';
import { getSong, getChartFile, loadSongBuffer, decoderAlignment, saveChartOverride, useSongs } from '../../store/songs';
import { db } from '../../store/db';
import { audio, MusicPlayer } from '../../audio/engine';
import { Btn, DIFF_META, Icon, Segmented, fmtTime } from '../components/common';
import { toast } from '../components/toasts';
import { checkPlayable, enforcePlayable, rateLevel } from '../../analysis/rules';
import { setPlaytestNotes } from './Play';
import { playSfx } from '../../audio/sfx';
import { getSettings } from '../../store/settings';
import { DIFFICULTIES, CARDINAL_DIRS, DIAGONAL_DIRS, type ChartNote, type Difficulty, type Lane, type SongChartFile, type SongMeta, type SwipeDir, type TileSize } from '../../types';
import { DIR_ARROW, SIZE_SCALE, holdLanePos, isDiagonal } from '../../game/notes';
const ALL_DIRS: SwipeDir[] = [...CARDINAL_DIRS, ...DIAGONAL_DIRS];
import type { WorkerResponse } from '../../analysis/worker';
import { toMono } from '../../analysis/features';

type ENote = ChartNote & { uid: number };
type Tool = 'select' | 'tap' | 'hold' | 'swipe' | 'erase';
let uidSeq = 1;
const withUid = (n: ChartNote[]): ENote[] => n.map((x) => ({ ...x, uid: uidSeq++ }));
const strip = (n: ENote[]): ChartNote[] => n.map(({ uid: _u, ...rest }) => { const r = { ...rest }; r.t = Math.round(r.t * 10000) / 10000; if (r.dur) r.dur = Math.round(r.dur * 10000) / 10000; if (r.type !== 'hold' || !r.path?.length) delete r.path; if (r.type !== 'tap' || r.size === 'regular') delete r.size; return r; }).sort((a, b) => a.t - b.t || a.lane - b.lane);

const LABEL_W = 64;
const RULER_H = 22;
const WAVE_H = 72;
const LANE_H = 58;

export function EditorScreen({ songId, diff: initialDiff }: { songId: string; diff?: Difficulty }) {
  useSongs();
  const meta = getSong(songId) as SongMeta | undefined;
  const [file, setFile] = useState<SongChartFile | null>(null);
  const [diff, setDiff] = useState<Difficulty>(initialDiff ?? 'normal');
  const [notes, setNotes] = useState<ENote[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<Tool>('select');
  const [swipeDir, setSwipeDir] = useState<SwipeDir>('up');
  const [tapSize, setTapSize] = useState<TileSize>('regular');
  const [snap, setSnap] = useState(4);
  const [pps, setPps] = useState(160);
  const [view, setView] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ticks, setTicks] = useState(true);
  const [metro, setMetro] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [regen, setRegen] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<MusicPlayer | null>(null);
  const tickNodes = useRef<AudioScheduledSourceNode[]>([]);
  const undo = useRef<ENote[][]>([]);
  const redo = useRef<ENote[][]>([]);
  const peaks = useRef<Float32Array | null>(null);
  const drag = useRef<null | { kind: 'move' | 'hold' | 'box' | 'seek'; x0: number; y0: number; t0: number; lane0: number; orig: ENote[]; uid?: number; x1?: number; y1?: number }>(null);
  const allCharts = useRef<Record<Difficulty, ENote[]> | null>(null);

  // ---------- load ----------
  useEffect(() => {
    if (!meta) return;
    let alive = true;
    (async () => {
      await audio.unlock();
      const f = await getChartFile(meta);
      if (!alive) return;
      setFile(f);
      allCharts.current = { normal: withUid(f.charts.normal.notes), hard: withUid(f.charts.hard.notes), extreme: withUid(f.charts.extreme.notes) };
      setNotes(allCharts.current[diff]);
      const buf = await loadSongBuffer(meta);
      if (!alive) return;
      setBuffer(buf);
      const p = new MusicPlayer(buf);
      p.align = decoderAlignment(meta, buf, f);
      p.userOffset = getSettings().audioOffsetMs / 1000;
      playerRef.current = p;
      // waveform peaks at 200/s
      const ch = buf.getChannelData(0);
      const ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch;
      const per = Math.floor(buf.sampleRate / 200);
      const pk = new Float32Array(Math.ceil(ch.length / per));
      for (let i = 0; i < pk.length; i++) {
        let m = 0;
        const end = Math.min(ch.length, (i + 1) * per);
        for (let j = i * per; j < end; j += 2) { const v = Math.abs(ch[j] + ch2[j]) * 0.5; if (v > m) m = v; }
        pk[i] = m;
      }
      peaks.current = pk;
    })().catch((e) => toast({ kind: 'error', icon: '⚠️', title: 'Editor failed to load', text: String(e) }));
    return () => { alive = false; stopPlayback(); playerRef.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  const switchDiff = (d: Difficulty) => {
    if (allCharts.current) allCharts.current[diff] = notes;
    setDiff(d);
    setNotes(allCharts.current?.[d] ?? []);
    setSel(new Set());
    undo.current = []; redo.current = [];
  };

  const commit = useCallback((next: ENote[]) => {
    undo.current.push(notes);
    if (undo.current.length > 150) undo.current.shift();
    redo.current = [];
    const sorted = [...next].sort((a, b) => a.t - b.t || a.lane - b.lane);
    setNotes(sorted);
    if (allCharts.current) allCharts.current[diff] = sorted;
    setDirty(true);
  }, [notes, diff]);

  const doUndo = () => { const p = undo.current.pop(); if (p) { redo.current.push(notes); setNotes(p); if (allCharts.current) allCharts.current[diff] = p; setDirty(true); } };
  const doRedo = () => { const n = redo.current.pop(); if (n) { undo.current.push(notes); setNotes(n); if (allCharts.current) allCharts.current[diff] = n; setDirty(true); } };

  // ---------- grid / snapping ----------
  const beats = file?.analysis.beats ?? [];
  const snapTime = useCallback((t: number) => {
    if (!snap || beats.length < 2) return t;
    let lo = 0, hi = beats.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
    const b0 = beats[lo], b1 = beats[lo + 1] ?? b0 + 0.5;
    const step = (b1 - b0) / snap;
    const k = Math.round((t - b0) / step);
    return b0 + k * step;
  }, [snap, beats]);
  const stepSize = useCallback((t: number) => {
    let i = beats.findIndex((b) => b > t);
    if (i <= 0) i = 1;
    return ((beats[i] ?? beats[i - 1] + 0.5) - (beats[i - 1] ?? 0)) / (snap || 4);
  }, [beats, snap]);

  // ---------- geometry ----------
  const tToX = (t: number) => LABEL_W + (t - view) * pps;
  const xToT = (x: number) => view + (x - LABEL_W) / pps;
  const laneY = (l: number) => RULER_H + WAVE_H + l * LANE_H;
  const yToLane = (y: number): Lane | null => { const l = Math.floor((y - RULER_H - WAVE_H) / LANE_H); return l >= 0 && l <= 2 ? (l as Lane) : null; };

  const noteAt = (x: number, y: number): ENote | null => {
    const lane = yToLane(y);
    if (lane === null) return null;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.lane !== lane) continue;
      const x0 = tToX(n.t) - 9, x1 = tToX(n.t + (n.dur ?? 0)) + 9;
      if (x >= x0 && x <= x1) return n;
    }
    return null;
  };

  // ---------- playback ----------
  const stopPlayback = () => {
    tickNodes.current.forEach((n) => { try { n.stop(); } catch { /* ignore */ } });
    tickNodes.current = [];
    const p = playerRef.current;
    if (p?.playing) { setPlayhead(Math.max(0, p.songTime())); p.pause(); }
    setPlaying(false);
  };
  const startPlayback = () => {
    const p = playerRef.current;
    if (!p || !audio.ctx) return;
    p.userOffset = getSettings().audioOffsetMs / 1000;
    p.play(playhead, 0.1);
    const ctx = audio.ctx;
    const startCtx = ctx.currentTime + 0.1;
    const nodes: AudioScheduledSourceNode[] = [];
    const sched = (t: number, freq: number, gain: number) => {
      const when = startCtx + (t - playhead) + p.userOffset;
      if (when < ctx.currentTime) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      o.connect(g); g.connect(audio.sfxBus);
      o.start(when); o.stop(when + 0.06);
      nodes.push(o);
    };
    const horizon = playhead + 90;
    if (ticks) for (const n of notes) if (n.t >= playhead && n.t < horizon) sched(n.t, n.type === 'swipe' ? 2400 : 1700, 0.35);
    if (metro) beats.forEach((b, i) => { if (b >= playhead && b < horizon) sched(b, (i - (file?.analysis.downbeatPhase ?? 0)) % 4 === 0 ? 1000 : 800, 0.25); });
    tickNodes.current = nodes;
    setPlaying(true);
  };
  const togglePlay = () => (playing ? stopPlayback() : startPlayback());

  // ---------- drawing ----------
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current, w = wrapRef.current;
      if (!c || !w || !file) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = w.clientWidth, H = RULER_H + WAVE_H + LANE_H * 3 + 8;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.height = H + 'px'; }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      let ph = playhead;
      const p = playerRef.current;
      if (playing && p) {
        ph = p.songTime();
        if (ph > view + (W - LABEL_W) / pps * 0.85) setView(ph - (W - LABEL_W) / pps * 0.15);
        if (ph >= file.analysis.duration) stopPlayback();
      }
      const tEnd = xToT(W);
      // background rows
      g.fillStyle = 'rgba(10,6,28,0.85)';
      g.fillRect(0, 0, W, H);
      for (let l = 0; l < 3; l++) {
        g.fillStyle = l % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)';
        g.fillRect(LABEL_W, laneY(l), W - LABEL_W, LANE_H);
      }
      // stages
      file.analysis.stages.forEach((s, i) => {
        if (s < view - 1 || s > tEnd) return;
        const x = tToX(s);
        g.fillStyle = 'rgba(255,210,63,0.9)';
        g.fillRect(x, RULER_H, 2, H - RULER_H);
        g.font = '700 10px Outfit, system-ui';
        g.fillText(`STAGE ${i + 1}`, x + 4, RULER_H + 11);
      });
      // waveform
      const pk = peaks.current;
      if (pk) {
        g.fillStyle = 'rgba(120,200,255,0.55)';
        const mid = RULER_H + WAVE_H / 2;
        for (let x = LABEL_W; x < W; x++) {
          const t0 = xToT(x), t1 = xToT(x + 1);
          const i0 = Math.max(0, Math.floor(t0 * 200)), i1 = Math.min(pk.length, Math.ceil(t1 * 200));
          let m = 0;
          for (let i = i0; i < i1; i++) if (pk[i] > m) m = pk[i];
          const h = Math.min(1, m * 1.4) * (WAVE_H / 2 - 4);
          g.fillRect(x, mid - h, 1, h * 2);
        }
      }
      // beat grid
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (b < view - 2) continue;
        if (b > tEnd) break;
        const bar = (i - file.analysis.downbeatPhase) % 4 === 0;
        const x = tToX(b);
        g.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
        g.fillRect(x, RULER_H, bar ? 1.5 : 1, H - RULER_H);
        if (snap > 1 && pps > 60) {
          const nb = beats[i + 1] ?? b + 0.5;
          for (let k = 1; k < snap; k++) {
            const xs = tToX(b + ((nb - b) * k) / snap);
            g.fillStyle = 'rgba(255,255,255,0.09)';
            g.fillRect(xs, RULER_H + WAVE_H, 1, LANE_H * 3);
          }
        }
        if (bar) {
          g.fillStyle = 'rgba(255,255,255,0.6)';
          g.font = '600 10px Outfit, system-ui';
          g.fillText(String(Math.floor((i - file.analysis.downbeatPhase) / 4) + 1), x + 3, 14);
        }
      }
      // ruler seconds
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, W, RULER_H);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = '600 10px Outfit, system-ui';
      const stepS = pps > 120 ? 1 : pps > 40 ? 5 : 10;
      for (let s = Math.ceil(view / stepS) * stepS; s < tEnd; s += stepS) g.fillText(fmtTime(s), tToX(s) + 2, RULER_H - 4);
      // notes
      const colors = file && meta ? [meta.theme.colors[0], meta.theme.colors[2], meta.theme.colors[0]] : ['#29d3ff', '#ff3df0', '#29d3ff'];
      for (const n of notes) {
        if (n.t + (n.dur ?? 0) < view - 0.5 || n.t > tEnd + 0.5) continue;
        const x = tToX(n.t), y = laneY(n.lane) + LANE_H * 0.2, h = LANE_H * 0.6;
        const selected = sel.has(n.uid);
        if (n.type === 'hold' && n.dur) {
          // body follows switch / rail paths across lane rows
          const steps = Math.max(8, Math.ceil(n.dur * pps / 6));
          g.strokeStyle = selected ? 'rgba(255,255,255,0.75)' : colors[n.lane] + 'cc';
          g.lineWidth = h * 0.4;
          g.lineCap = 'butt';
          g.beginPath();
          for (let k = 0; k <= steps; k++) {
            const tt = n.t + (n.dur * k) / steps;
            const yy = RULER_H + WAVE_H + holdLanePos(n, tt) * LANE_H + LANE_H / 2;
            if (k) g.lineTo(tToX(tt), yy); else g.moveTo(tToX(tt), yy);
          }
          g.stroke();
          for (const p of n.path ?? []) {
            g.fillStyle = (p.slide ?? 0) > 0 ? '#29d3ff' : '#ffd23f';
            g.beginPath(); g.arc(tToX(p.t), RULER_H + WAVE_H + p.lane * LANE_H + LANE_H / 2, 5, 0, Math.PI * 2); g.fill();
          }
          const endY = RULER_H + WAVE_H + holdLanePos(n, n.t + n.dur) * LANE_H + LANE_H * 0.35;
          g.fillStyle = '#ffffff';
          g.fillRect(x + n.dur * pps - 3, endY, 4, LANE_H * 0.3);
        }
        const hs = n.type === 'tap' ? SIZE_SCALE[n.size ?? 'regular'] : 1;
        g.beginPath();
        g.roundRect(x - 8, y + (h - h * hs) / 2, 16, h * hs, Math.min(6, h * hs / 2));
        g.fillStyle = n.type === 'swipe' ? (isDiagonal(n.dir) ? '#ffd23f' : '#ffffff') : colors[n.lane];
        g.fill();
        g.lineWidth = selected ? 3 : 1.5;
        g.strokeStyle = selected ? '#ffd23f' : 'rgba(0,0,0,0.6)';
        g.stroke();
        if (n.type === 'swipe') {
          g.fillStyle = '#20103a';
          g.font = '900 13px Outfit, system-ui';
          g.textAlign = 'center';
          g.fillText(DIR_ARROW[n.dir ?? 'up'], x, y + h * 0.66);
          g.textAlign = 'left';
        }
      }
      // box selection
      const d = drag.current;
      if (d?.kind === 'box' && d.x1 !== undefined) {
        g.strokeStyle = '#ffd23f';
        g.setLineDash([4, 3]);
        g.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1!), Math.abs(d.x1 - d.x0), Math.abs(d.y1! - d.y0));
        g.setLineDash([]);
      }
      // labels
      g.fillStyle = 'rgba(12,6,30,0.95)';
      g.fillRect(0, RULER_H, LABEL_W, H - RULER_H);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = '700 11px Outfit, system-ui';
      g.fillText('WAVE', 10, RULER_H + WAVE_H / 2 + 4);
      ['LEFT', 'MID', 'RIGHT'].forEach((l, i) => g.fillText(l, 10, laneY(i) + LANE_H / 2 + 4));
      // playhead
      const px = tToX(ph);
      if (px >= LABEL_W) {
        g.fillStyle = '#ff3d6e';
        g.fillRect(px - 1, 0, 2, H);
        g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  });

  // ---------- mouse ----------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (x < LABEL_W) return;
    const t = xToT(x);
    if (y < RULER_H + WAVE_H) { drag.current = { kind: 'seek', x0: x, y0: y, t0: t, lane0: 0, orig: notes }; if (playing) stopPlayback(); setPlayhead(Math.max(0, t)); return; }
    const lane = yToLane(y);
    if (lane === null) return;
    const hit = noteAt(x, y);
    if (e.button === 2 || tool === 'erase') { if (hit) { commit(notes.filter((n) => n.uid !== hit.uid)); playSfx('uiBack', 0.3); } return; }
    if (tool === 'select') {
      if (hit) {
        const next = new Set(e.shiftKey || e.metaKey || e.ctrlKey ? sel : sel.has(hit.uid) ? sel : []);
        next.add(hit.uid);
        setSel(next);
        drag.current = { kind: 'move', x0: x, y0: y, t0: t, lane0: lane, orig: notes, uid: hit.uid };
      } else {
        if (!e.shiftKey) setSel(new Set());
        drag.current = { kind: 'box', x0: x, y0: y, t0: t, lane0: lane, orig: notes, x1: x, y1: y };
      }
      return;
    }
    if (hit) { setSel(new Set([hit.uid])); return; }
    const st = snapTime(t);
    const n: ENote = { t: st, lane, type: tool === 'swipe' ? 'swipe' : tool === 'hold' ? 'hold' : 'tap', uid: uidSeq++ };
    if (tool === 'swipe') n.dir = swipeDir;
    if (tool === 'tap' && tapSize !== 'regular') n.size = tapSize;
    if (tool === 'hold') n.dur = stepSize(st) * Math.max(1, snap / 2);
    commit([...notes, n]);
    setSel(new Set([n.uid]));
    playSfx('tap', 0.4);
    if (tool === 'hold') drag.current = { kind: 'hold', x0: x, y0: y, t0: st, lane0: lane, orig: [...notes, n], uid: n.uid };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (d.kind === 'seek') { setPlayhead(Math.max(0, xToT(x))); return; }
    if (d.kind === 'box') { d.x1 = x; d.y1 = y; return; }
    if (d.kind === 'hold') {
      const end = snapTime(xToT(x));
      setNotes(d.orig.map((n) => n.uid === d.uid ? { ...n, dur: Math.max(stepSize(n.t), end - n.t) } : n));
      return;
    }
    if (d.kind === 'move') {
      const dtRaw = xToT(x) - d.t0;
      const lane = yToLane(y);
      const dl = lane === null ? 0 : lane - d.lane0;
      const anchor = d.orig.find((n) => n.uid === d.uid)!;
      const dt = snap ? snapTime(anchor.t + dtRaw) - anchor.t : dtRaw;
      setNotes(d.orig.map((n) => sel.has(n.uid) ? { ...n, t: Math.max(0, n.t + dt), lane: Math.max(0, Math.min(2, n.lane + dl)) as Lane } : n));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'box' && d.x1 !== undefined) {
      const t0 = xToT(Math.min(d.x0, d.x1)), t1 = xToT(Math.max(d.x0, d.x1));
      const l0 = yToLane(Math.min(d.y0, d.y1!)) ?? 0, l1 = yToLane(Math.max(d.y0, d.y1!)) ?? 2;
      const next = new Set(sel);
      notes.forEach((n) => { if (n.t >= t0 && n.t <= t1 && n.lane >= l0 && n.lane <= l1) next.add(n.uid); });
      setSel(next);
    }
    if (d.kind === 'move' || d.kind === 'hold') {
      const changed = notes.some((n, i) => d.orig[i] !== n);
      if (changed) {
        undo.current.push(d.kind === 'hold' ? d.orig.filter((n) => n.uid !== d.uid) : d.orig);
        redo.current = [];
        const sorted = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane);
        setNotes(sorted);
        if (allCharts.current) allCharts.current[diff] = sorted;
        setDirty(true);
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const tAt = xToT(e.clientX - r.left);
      const np = Math.max(20, Math.min(900, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setPps(np);
      setView(Math.max(-1, tAt - (e.clientX - r.left - LABEL_W) / np));
    } else {
      setView((v) => Math.max(-1, Math.min((file?.analysis.duration ?? 0), v + (e.deltaX + e.deltaY) / pps)));
    }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if ((e.code === 'Delete' || e.code === 'Backspace') && sel.size) { e.preventDefault(); commit(notes.filter((n) => !sel.has(n.uid))); setSel(new Set()); }
      else if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); doRedo(); }
      else if (mod && e.code === 'KeyA') { e.preventDefault(); setSel(new Set(notes.map((n) => n.uid))); }
      else if (mod && e.code === 'KeyS') { e.preventDefault(); save(); }
      else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && sel.size) {
        e.preventDefault();
        const first = notes.find((n) => sel.has(n.uid))!;
        const d = (e.altKey ? 0.001 : stepSize(first.t)) * (e.code === 'ArrowLeft' ? -1 : 1);
        commit(notes.map((n) => sel.has(n.uid) ? { ...n, t: Math.max(0, n.t + d) } : n));
      } else if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && sel.size) {
        e.preventDefault();
        const d = e.code === 'ArrowUp' ? -1 : 1;
        commit(notes.map((n) => sel.has(n.uid) ? { ...n, lane: Math.max(0, Math.min(2, n.lane + d)) as Lane } : n));
      } else if (e.code === 'Escape') { if (sel.size) setSel(new Set()); else leave(); }
      else if (!mod) {
        const map: Record<string, Tool> = { KeyV: 'select', KeyT: 'tap', KeyH: 'hold', KeyW: 'swipe', KeyE: 'erase' };
        if (map[e.code]) setTool(map[e.code]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- actions ----------
  const issues = useMemo(() => checkPlayable(strip(notes), diff), [notes, diff]);

  const buildFile = (): SongChartFile | null => {
    if (!file || !allCharts.current) return null;
    allCharts.current[diff] = notes;
    const charts = { ...file.charts };
    for (const d of DIFFICULTIES) {
      const n = strip(allCharts.current[d]);
      charts[d] = { difficulty: d, level: rateLevel(n, d, file.analysis.duration), notes: n };
    }
    return { ...file, charts, edited: true };
  };

  const save = async () => {
    const f = buildFile();
    if (!f || !meta) return;
    await saveChartOverride(f, meta);
    setFile(f);
    setDirty(false);
    toast({ kind: 'info', icon: '💾', title: 'Chart saved', text: `${meta.title} — saved on this device` });
  };

  const revert = async () => {
    if (!meta || !confirm('Discard all edits and restore the generated chart?')) return;
    await db.deleteChart(meta.id);
    if (meta.source === 'imported') { toast({ kind: 'info', icon: 'ℹ️', title: 'Imported songs keep their saved chart', text: 'Use “Regenerate” to rebuild it from the audio.' }); return; }
    const f = await getChartFile(meta, { ignoreOverride: true });
    setFile(f);
    allCharts.current = { normal: withUid(f.charts.normal.notes), hard: withUid(f.charts.hard.notes), extreme: withUid(f.charts.extreme.notes) };
    setNotes(allCharts.current[diff]);
    setDirty(false);
  };

  const exportJson = () => {
    const f = buildFile();
    if (!f || !meta) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(f)], { type: 'application/json' }));
    a.download = `${meta.id}.json`;
    a.click();
  };

  const importJson = async (fl: File) => {
    try {
      const d = JSON.parse(await fl.text()) as SongChartFile;
      if (!d.charts) throw new Error('Not a chart file');
      allCharts.current = { normal: withUid(d.charts.normal.notes), hard: withUid(d.charts.hard.notes), extreme: withUid(d.charts.extreme.notes) };
      setFile({ ...(file ?? d), charts: d.charts, analysis: d.analysis ?? file!.analysis });
      setNotes(allCharts.current[diff]);
      setDirty(true);
    } catch (e) { toast({ kind: 'error', icon: '⚠️', title: 'Import failed', text: String(e) }); }
  };

  const shiftAll = (ms: number) => commit(notes.map((n) => ({ ...n, t: Math.max(0, n.t + ms / 1000) })));

  const autoFix = () => {
    const fixed = withUid(enforcePlayable(strip(notes), diff, { allowFinalTriple: diff === 'extreme' }));
    commit(fixed);
    toast({ kind: 'info', icon: '🛠️', title: 'Playability fixed', text: `${notes.length - fixed.length} conflicting notes removed or moved` });
  };

  const regenerate = () => {
    if (!buffer || !meta) return;
    if (!confirm('Re-analyse the audio and regenerate all three difficulties? Unsaved edits will be replaced.')) return;
    const w = new Worker(new URL('../../analysis/worker.ts', import.meta.url), { type: 'module' });
    const chans: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const mono = new Float32Array(toMono(chans));
    setRegen('Analysing');
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') setRegen(m.stage);
      else if (m.type === 'done') {
        setRegen(null);
        w.terminate();
        // browser decoding may shift the buffer; the new analysis is in buffer time, store align-free
        setFile({ ...m.file, songId: meta.id });
        allCharts.current = { normal: withUid(m.file.charts.normal.notes), hard: withUid(m.file.charts.hard.notes), extreme: withUid(m.file.charts.extreme.notes) };
        setNotes(allCharts.current[diff]);
        setDirty(true);
      } else { setRegen(null); w.terminate(); toast({ kind: 'error', icon: '⚠️', title: 'Regeneration failed', text: m.message }); }
    };
    w.postMessage({ id: meta.id, mono, sampleRate: buffer.sampleRate }, [mono.buffer]);
  };

  const playtest = () => {
    stopPlayback();
    setPlaytestNotes(strip(notes));
    nav.go({ name: 'play', songId, diff, mode: 'practice', playtest: true, startAt: Math.max(0, playhead - 1), nonce: Date.now() });
  };

  const leave = () => {
    if (dirty && !confirm('You have unsaved changes. Leave the editor?')) return;
    stopPlayback();
    nav.back();
  };

  if (!meta) return <div className="center-msg">Song not found</div>;
  const selNotes = notes.filter((n) => sel.has(n.uid));
  const duration = file?.analysis.duration ?? 0;

  return (
    <div className="editor">
      <header className="screen-header">
        <Btn variant="glass" className="round" sfx="uiBack" onClick={leave} aria-label="Back" icon={<Icon name="back" />} />
        <div className="screen-title"><h1>Chart Editor</h1><p>{meta.title} · {file ? `${file.analysis.bpm.toFixed(1)} BPM` : 'loading…'}{dirty ? ' · unsaved' : ''}</p></div>
        <div className="screen-header-right">
          <Segmented<Difficulty> value={diff} onChange={switchDiff} options={DIFFICULTIES.map((d) => ({ value: d, label: DIFF_META[d].label }))} />
          <Btn variant="primary" icon={<Icon name="download" size={16} />} onClick={save} disabled={!dirty}>Save</Btn>
        </div>
      </header>

      <div className="editor-toolbar glass">
        <div className="tool-group">
          {(['select', 'tap', 'hold', 'swipe', 'erase'] as Tool[]).map((t) => (
            <button key={t} className={`tool ${tool === t ? 'active' : ''}`} onClick={() => setTool(t)} title={`${t} (${{ select: 'V', tap: 'T', hold: 'H', swipe: 'W', erase: 'E' }[t]})`}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
          {tool === 'swipe' && ALL_DIRS.map((d) => (
            <button key={d} className={`tool small ${swipeDir === d ? 'active' : ''}`} onClick={() => setSwipeDir(d)} title={d}>{DIR_ARROW[d]}</button>
          ))}
          {tool === 'tap' && (['regular', 'half', 'micro'] as TileSize[]).map((z) => (
            <button key={z} className={`tool small ${tapSize === z ? 'active' : ''}`} onClick={() => setTapSize(z)}>{z === 'regular' ? 'Full' : z === 'half' ? 'Half' : 'Micro'}</button>
          ))}
        </div>
        <div className="tool-group">
          <label className="mini-select">Snap
            <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
              <option value={0}>Off</option><option value={1}>1/1</option><option value={2}>1/2</option><option value={3}>1/3</option>
              <option value={4}>1/4</option><option value={6}>1/6</option><option value={8}>1/8</option>
            </select>
          </label>
          <button className="tool" onClick={() => setPps((p) => Math.max(20, p / 1.4))}>−</button>
          <button className="tool" onClick={() => setPps((p) => Math.min(900, p * 1.4))}>+</button>
        </div>
        <div className="tool-group">
          <button className={`tool ${playing ? 'active' : ''}`} onClick={togglePlay}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <label className="mini-check"><input type="checkbox" checked={ticks} onChange={(e) => setTicks(e.target.checked)} /> Note ticks</label>
          <label className="mini-check"><input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} /> Metronome</label>
          <span className="time">{fmtTime(playhead)} / {fmtTime(duration)}</span>
        </div>
      </div>

      <div className="editor-timeline" ref={wrapRef} onWheel={onWheel}>
        <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={(e) => e.preventDefault()} />
        <input className="timeline-scroll" type="range" min={-1} max={Math.max(1, duration)} step={0.01} value={view} onChange={(e) => setView(Number(e.target.value))} aria-label="Scroll timeline" />
      </div>

      <div className="editor-panels">
        <div className="glass panel-col">
          <h3>Selection</h3>
          {selNotes.length === 0 && <p className="help">Click notes to select (Shift for multiple, drag for a box). Drag to move. Arrows nudge by the snap step (Alt: 1 ms). Delete removes. Right-click erases.</p>}
          {selNotes.length === 1 && (() => {
            const n = selNotes[0];
            const upd = (patch: Partial<ENote>) => commit(notes.map((x) => x.uid === n.uid ? { ...x, ...patch } : x));
            return (
              <div className="note-props">
                <label className="text-field"><span>Time (s)</span><input type="number" step="0.001" value={n.t.toFixed(3)} onChange={(e) => upd({ t: Math.max(0, Number(e.target.value)) })} /></label>
                <Segmented value={n.type} onChange={(v) => upd({ type: v, dur: v === 'hold' ? (n.dur ?? 0.5) : undefined, dir: v === 'swipe' ? (n.dir ?? 'up') : undefined })}
                  options={[{ value: 'tap', label: 'Tap' }, { value: 'hold', label: 'Hold' }, { value: 'swipe', label: 'Swipe' }]} />
                <Segmented value={n.lane} onChange={(v) => upd({ lane: v as Lane })} options={[{ value: 0, label: 'Left' }, { value: 1, label: 'Mid' }, { value: 2, label: 'Right' }]} />
                {n.type === 'hold' && <label className="text-field"><span>Hold length (s)</span><input type="number" step="0.01" value={(n.dur ?? 0).toFixed(3)} onChange={(e) => upd({ dur: Math.max(0.15, Number(e.target.value)) })} /></label>}
                {n.type === 'swipe' && <Segmented value={n.dir ?? 'up'} onChange={(v) => upd({ dir: v })} options={ALL_DIRS.map((d) => ({ value: d, label: DIR_ARROW[d] }))} />}
                {n.type === 'tap' && <Segmented value={n.size ?? 'regular'} onChange={(v) => upd({ size: v === 'regular' ? undefined : v })} options={[{ value: 'regular', label: 'Full tile' }, { value: 'half', label: 'Half tile' }, { value: 'micro', label: 'Microtile' }]} />}
                {n.type === 'hold' && (
                  <div className="path-editor">
                    <span className="slider-label">Switch / rail path</span>
                    {(n.path ?? []).map((p, i) => (
                      <div key={i} className="path-row">
                        <input type="number" step="0.001" value={p.t.toFixed(3)} aria-label="Transition time" onChange={(e) => upd({ path: (n.path ?? []).map((q, k) => k === i ? { ...q, t: Number(e.target.value) } : q) })} />
                        <select value={p.lane} aria-label="Target lane" onChange={(e) => upd({ path: (n.path ?? []).map((q, k) => k === i ? { ...q, lane: Number(e.target.value) as Lane } : q) })}>
                          <option value={0}>Left</option><option value={1}>Mid</option><option value={2}>Right</option>
                        </select>
                        <input type="number" step="0.01" min="0" value={(p.slide ?? 0).toFixed(2)} aria-label="Slide seconds (0 = switch)" title="Slide time: 0 = instant switch, >0 = rail" onChange={(e) => upd({ path: (n.path ?? []).map((q, k) => k === i ? { ...q, slide: Math.max(0, Number(e.target.value)) || undefined } : q) })} />
                        <button className="btn btn-glass small" onClick={() => upd({ path: (n.path ?? []).filter((_, k) => k !== i) })}>✕</button>
                      </div>
                    ))}
                    <div className="row-btns small">
                      {(['switch', 'rail'] as const).map((kind) => (
                        <button key={kind} className="btn btn-glass small" onClick={() => {
                          const end = n.t + (n.dur ?? 0);
                          const at = playhead > n.t + 0.1 && playhead < end - 0.1 ? playhead : n.t + (n.dur ?? 0) / 2;
                          const cur = Math.round(holdLanePos(n, at)) as Lane;
                          const lane = (cur === 2 ? 1 : cur + 1) as Lane;
                          const slide = kind === 'rail' ? Math.min(0.5, (end - at) / 2) : undefined;
                          upd({ path: [...(n.path ?? []), { t: snapTime(at), lane, slide }].sort((a, b) => a.t - b.t) });
                        }}>+ {kind === 'switch' ? 'Switch' : 'Rail'} {playhead > n.t && playhead < n.t + (n.dur ?? 0) ? 'at playhead' : ''}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {selNotes.length > 1 && <p>{selNotes.length} notes selected</p>}
          <h3>Timing correction</h3>
          <p className="help">Shift every note in this difficulty if the whole chart feels early or late.</p>
          <div className="row-btns small">
            {[-10, -5, -1, 1, 5, 10].map((ms) => <button key={ms} className="btn btn-glass small" onClick={() => shiftAll(ms)}>{ms > 0 ? '+' : ''}{ms} ms</button>)}
          </div>
        </div>
        <div className="glass panel-col">
          <h3>Validation</h3>
          <p>{notes.length} notes · level {file ? rateLevel(strip(notes), diff, duration) : '-'} · {issues.length ? `${issues.length} playability issues` : '✓ physically playable'}</p>
          {issues.length > 0 && <>
            <ul className="issues">{issues.slice(0, 40).map((s, i) => {
              const m = s.match(/(\d+):(\d+\.\d+)/);
              return <li key={i}><button className="link" onClick={() => { if (m) { const t = Number(m[1]) * 60 + Number(m[2]); setPlayhead(t); setView(Math.max(-1, t - 2)); } }}>{s}</button></li>;
            })}</ul>
            <Btn variant="glass" onClick={autoFix}>Auto-fix playability</Btn>
          </>}
          <h3>Chart</h3>
          <div className="row-btns">
            <Btn variant="play" icon={<Icon name="play" size={16} />} onClick={playtest}>Playtest from playhead</Btn>
            <Btn variant="glass" icon={<Icon name="download" size={16} />} onClick={exportJson}>Export JSON</Btn>
            <label className="btn btn-glass file-btn"><Icon name="upload" size={16} /><span className="btn-label">Import JSON</span>
              <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            </label>
            <Btn variant="glass" onClick={regenerate} disabled={!!regen}>{regen ? `${regen}…` : 'Regenerate from audio'}</Btn>
            <Btn variant="danger" onClick={revert}>Revert to generated</Btn>
          </div>
          <p className="help">Shortcuts: Space play · V/T/H/W/E tools · Ctrl+Z / Ctrl+Shift+Z undo/redo · Ctrl+S save · Ctrl+wheel zoom · wheel scroll · click the waveform to seek.</p>
        </div>
      </div>
    </div>
  );
}
