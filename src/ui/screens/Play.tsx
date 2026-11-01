import { useEffect, useRef, useState } from 'react';
import { nav, type Route } from '../nav';
import { getSong, getChartFile } from '../../store/songs';
import { GameController, type FinishInfo } from '../../game/controller';
import { recordResult } from '../../store/profile';
import { checkAchievements } from '../../game/achievements';
import { Btn, Icon, Slider } from '../components/common';
import { toast } from '../components/toasts';
import { updateSettings, useSettings } from '../../store/settings';
import { playSfx } from '../../audio/sfx';
import type { ChartNote } from '../../types';
import { buildTutorial, type Lesson } from '../../game/tutorial';
import { updateProfile } from '../../store/profile';

function TutorialCaptions({ lessons, gameRef }: { lessons: Lesson[]; gameRef: React.RefObject<GameController | null> }) {
  const [idx, setIdx] = useState(-1);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = gameRef.current?.songTime ?? -9;
      let k = -1;
      lessons.forEach((l, i) => { if (t >= l.t && t < l.end + 0.5) k = i; });
      setIdx((cur) => (cur === k ? cur : k));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lessons, gameRef]);
  const l = lessons[idx];
  if (!l) return idx === -1 && lessons.length ? <div className="tut-caption no-game-input"><small>TUTORIAL</small><b>Get ready</b><span>Notes fall toward the glowing line — hit them as they cross it.</span></div> : null;
  return (
    <div className="tut-caption no-game-input" key={idx}>
      <small>LESSON {idx + 1} / {lessons.length}</small>
      <b>{l.title}</b>
      <span>{touch ? l.touch : l.keys}</span>
    </div>
  );
}

type PlayRoute = Extract<Route, { name: 'play' }>;

/** Notes passed from the editor for play-testing unsaved changes. */
let playtestNotes: ChartNote[] | null = null;
export function setPlaytestNotes(n: ChartNote[] | null) { playtestNotes = n; }

export function PlayScreen({ route }: { route: PlayRoute }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameController | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const s = useSettings();

  useEffect(() => {
    const song = getSong(route.songId);
    if (!song) { setError('Song not found'); return; }
    let cancelled = false;
    setLoading(true);
    setPaused(false);
    (async () => {
      try {
        const chart = await getChartFile(song, { ignoreOverride: !!route.tutorial });
        if (cancelled || !wrapRef.current || !canvasRef.current) return;
        let override = route.playtest ? playtestNotes ?? undefined : undefined;
        if (route.tutorial) { const tut = buildTutorial(chart.analysis.beats); override = tut.notes; setLessons(tut.lessons); }
        const g = new GameController(wrapRef.current, canvasRef.current, {
          meta: song, chart, difficulty: route.diff, mode: route.mode,
          notesOverride: override, startAt: route.startAt,
        }, {
          onFinish: (info) => finish(info),
          onPauseChange: (p) => setPaused(p),
          onReady: () => setLoading(false),
          onRestart: () => setNonce((n) => n + 1),
        });
        gameRef.current = g;
        (window as unknown as { __fsGame?: GameController }).__fsGame = g;
        await g.init();
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; gameRef.current?.destroy(); gameRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.songId, route.diff, route.mode, nonce]);

  const finish = (info: FinishInfo) => {
    if (route.tutorial) {
      updateProfile((p) => { p.seenTutorial = true; });
      toast({ kind: 'info', icon: '🎓', title: 'Tutorial complete', text: `${info.result.counts.perfectPlus + info.result.counts.perfect + info.result.counts.great} / ${info.result.totalNotes} notes hit — you know every note type now!` });
      nav.back();
      return;
    }
    if (route.playtest) { nav.back(); return; }
    const outcome = recordResult(route.songId, route.diff, route.mode, info.result, info.playSeconds, { holdsCompleted: info.holdsCompleted, swipesHit: info.swipesHit });
    const unlocked = checkAchievements();
    nav.replace({ name: 'results', songId: route.songId, diff: route.diff, mode: route.mode, info, outcome, unlocked });
  };

  const quit = () => {
    gameRef.current?.destroy();
    playSfx('uiBack', 0.6);
    nav.back();
  };

  return (
    <div className="play" ref={wrapRef}>
      <canvas ref={canvasRef} className="game-canvas" />
      {!loading && !error && (
        <button className="pause-btn no-game-input" aria-label="Pause" onClick={() => gameRef.current?.pause()}><Icon name="pause" size={22} /></button>
      )}
      {route.tutorial && !loading && <TutorialCaptions lessons={lessons} gameRef={gameRef} />}
      {loading && !error && (
        <div className="play-loading"><div className="spinner" /><span>Loading track…</span></div>
      )}
      {error && (
        <div className="overlay"><div className="panel glass">
          <h2>Couldn’t start the song</h2><p>{error}</p>
          <Btn onClick={() => nav.back()}>Back</Btn>
        </div></div>
      )}
      {paused && (
        <div className="overlay pause-overlay no-game-input">
          <div className="panel glass pause-panel">
            <h2>PAUSED</h2>
            <Btn variant="play" sfx="uiSelect" icon={<Icon name="play" />} onClick={() => gameRef.current?.resume()} autoFocus>Resume</Btn>
            <Btn variant="glass" icon={<Icon name="restart" />} onClick={() => gameRef.current?.restart()}>Restart <kbd>R</kbd></Btn>
            <div className="pause-quick">
              <Slider label="Note speed" value={s.noteSpeed} min={1} max={10} step={0.5} onChange={(v) => updateSettings({ noteSpeed: v })} />
              <Slider label="Audio offset" value={s.audioOffsetMs} min={-200} max={300} step={1} onChange={(v) => updateSettings({ audioOffsetMs: v })} format={(v) => `${v} ms`} />
              <Slider label="Music volume" value={s.musicVolume} min={0} max={1} onChange={(v) => updateSettings({ musicVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </div>
            <Btn variant="danger" sfx="uiBack" icon={<Icon name="home" />} onClick={quit}>{route.playtest ? 'Back to editor' : 'Quit song'}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export function notifyLevelUp(before: number, after: number) {
  if (after > before) toast({ kind: 'level', icon: '⬆️', title: `Level ${after}!`, text: 'New rewards may be unlocked in Progression.' }, 4500);
}
