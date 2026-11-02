import { useEffect, useRef, useState } from 'react';
import { nav } from '../nav';
import { useSongs } from '../../store/songs';
import { useProfile, levelInfo, totalStars } from '../../store/profile';
import { updateSettings, useSettings } from '../../store/settings';
import { Btn, Cover, DIFF_META, Icon, MedalBadges, Stars, fmtTime } from '../components/common';
import { Logo } from '../components/Logo';
import { background } from '../../game/background';
import { preview } from '../../audio/preview';
import { playSfx } from '../../audio/sfx';
import { ACHIEVEMENTS, playerTitle } from '../../game/achievements';
import { toggleFullscreen, fullscreenSupported } from '../App';
import type { Difficulty, GameMode, SongMeta } from '../../types';
import { DIFFICULTIES } from '../../types';

let rememberedId: string | null = null;
export function setFeatured(id: string) { rememberedId = id; }

export function bestStars(p: ReturnType<typeof useProfile>, id: string) {
  const b = p.bests[id] ?? {};
  return Math.max(0, ...DIFFICULTIES.map((d) => b[d]?.stars ?? 0));
}

export function TopBar() {
  const p = useProfile();
  const s = useSettings();
  const lv = levelInfo(p.xp);
  return (
    <div className="topbar">
      <button className="profile-chip" onClick={() => { playSfx('uiSelect', 0.5); nav.go({ name: 'progress' }); }} aria-label="Open profile & progression">
        <span className="avatar"><Icon name="user" size={22} /></span>
        <span className="profile-info">
          <span className="profile-name">{s.playerName} <em>{playerTitle(p.xp)}</em></span>
          <span className="xpbar"><span style={{ width: `${lv.pct * 100}%` }} /></span>
        </span>
        <span className="level-badge">LV {lv.level}</span>
      </button>
      <div className="topbar-right">
        <div className="stat-chip" title="Total stars"><Icon name="star" size={18} /> {totalStars(p)}</div>
        {fullscreenSupported() && <Btn variant="glass" className="round" aria-label="Fullscreen" onClick={() => toggleFullscreen()} icon={<Icon name="fullscreen" />} />}
        <Btn variant="glass" className="round" aria-label="Settings" onClick={() => nav.go({ name: 'settings' })} icon={<Icon name="gear" />} />
      </div>
    </div>
  );
}

let lastDiff: Difficulty = 'normal';

/** Home: swipeable round-cover carousel, difficulty + mode, big PLAY, tab bar. */
export function HomeScreen() {
  const songs = useSongs();
  const p = useProfile();
  const st = useSettings();
  const [idx, setIdx] = useState(() => Math.max(0, songs.findIndex((s) => s.id === (rememberedId ?? p.lastPlayed?.songId))));
  const [diff, setDiff] = useState<Difficulty>(p.lastPlayed?.diff ?? lastDiff);
  const [mode, setMode] = useState<GameMode>(st.defaultMode);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef<{ x0: number; id: number } | null>(null);
  const song: SongMeta | undefined = songs[idx];
  const n = songs.length;
  const go = (d: number) => { if (!n) return; playSfx('uiMove', 0.5); setIdx((i) => (i + d + n) % n); };

  useEffect(() => {
    if (!song) return;
    rememberedId = song.id;
    background.setTheme(song.theme.colors, song.theme.bg);
    background.setIntensity(0.15);
    preview.play(song);
    background.beatSource = () => preview.pulse();
  }, [song]);

  const play = () => {
    if (!song) return;
    lastDiff = diff;
    updateSettings({ defaultMode: mode });
    playSfx('uiPlay', 0.7);
    nav.go({ name: 'play', songId: song.id, diff, mode, nonce: Date.now() });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.code === 'ArrowRight') go(1);
      else if (e.code === 'ArrowLeft') go(-1);
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const i = DIFFICULTIES.indexOf(diff) + (e.code === 'ArrowDown' ? 1 : -1);
        if (i >= 0 && i < 3) { playSfx('uiMove', 0.5); setDiff(DIFFICULTIES[i]); }
      } else if ((e.code === 'Enter' || e.code === 'Space') && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); play(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!song) return <div className="center-msg">No songs found. Open the Studio to import music.</div>;
  const best = p.bests[song.id]?.[diff];
  const ring = best ? best.stars / 5 : 0;
  const neighbours = [-2, -1, 0, 1, 2].map((o) => ({ o, s: songs[(idx + o + n * 4) % n] }));

  return (
    <div className="home2" style={{ ['--c1' as string]: song.theme.colors[0], ['--c2' as string]: song.theme.colors[1], ['--c3' as string]: song.theme.colors[2] }}>
      <TopBar />
      <div className="h2-brand"><Logo size="sm" /></div>
      <div className="h2-stage"
        onPointerDown={(e) => { dragRef.current = { x0: e.clientX, id: e.pointerId }; }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (d?.id !== e.pointerId) return;
          const dx = e.clientX - d.x0;
          // only take over the pointer once it is clearly a drag, so plain taps still click the covers
          if (Math.abs(dx) > 8) { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } setDrag(dx); }
        }}
        onPointerUp={(e) => {
          const d = dragRef.current ? e.clientX - dragRef.current.x0 : 0;
          dragRef.current = null;
          if (Math.abs(d) > 45) go(d < 0 ? 1 : -1);
          // let the click handler see the drag distance first, then reset
          setTimeout(() => setDrag(0), 0);
        }}
        onPointerCancel={() => { dragRef.current = null; setDrag(0); }}>
        {neighbours.map(({ o, s }) => (
          <button key={`${s.id}-${o}`} className={`h2-disc ${o === 0 ? 'center' : ''}`} aria-label={o === 0 ? `${s.title} — details` : `Select ${s.title}`}
            style={{ ['--o' as string]: o, transform: `translateX(calc(${o} * var(--step) + ${drag}px)) scale(${o === 0 ? 1 : Math.abs(o) === 1 ? 0.62 : 0.42})`, zIndex: 10 - Math.abs(o), opacity: Math.abs(o) === 2 ? 0.35 : 1 }}
            onClick={() => { if (Math.abs(drag) > 5) return; if (o === 0) nav.go({ name: 'details', songId: s.id }); else go(o); }}>
            <span className="h2-ring" style={{ ['--ring' as string]: o === 0 ? `${ring * 300}deg` : '0deg' }}>
              <Cover meta={s} size={o === 0 ? 300 : 160} animated={o === 0} round />
            </span>
          </button>
        ))}
      </div>
      <div className="h2-info" key={song.id}>
        <h1 className="h2-title">{song.title.toUpperCase()}</h1>
        <div className="h2-artist">{song.artist}{song.tag ? <span> · {song.tag}</span> : null}</div>
        <div className="h2-meta">
          <Stars count={bestStars(p, song.id)} size={18} />
          <span>{best ? best.score.toLocaleString('en-US') : 'Not played'}</span>
          {best && <MedalBadges medals={best.medals} />}
          <span className="dim">{fmtTime(song.duration)} · {Math.round(song.bpm)} BPM</span>
        </div>
      </div>
      <div className="h2-diffs" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button key={d} role="radio" aria-checked={d === diff} className={`h2-diff ${d === diff ? 'on' : ''}`} style={{ ['--dc' as string]: DIFF_META[d].color }}
            onClick={() => { playSfx('uiMove', 0.5); setDiff(d); }}>
            {d === 'extreme' && <span aria-hidden="true">🔥</span>}{DIFF_META[d].label.toUpperCase()} <b>{song.levels[d]}</b>
          </button>
        ))}
      </div>
      <div className="h2-mode">
        <button className={mode === 'classic' ? 'on' : ''} onClick={() => setMode('classic')}>Classic</button>
        <button className={mode === 'practice' ? 'on' : ''} onClick={() => setMode('practice')}>Practice</button>
      </div>
      <button className="h2-play" onClick={play}>PLAY</button>
      <TabBar active="home" />
    </div>
  );
}

export function TabBar({ active }: { active: string }) {
  const p = useProfile();
  const items: { id: string; icon: string; label: string; go: () => void }[] = [
    { id: 'home', icon: 'home', label: 'Play', go: () => nav.home() },
    { id: 'library', icon: 'library', label: 'Songs', go: () => nav.go({ name: 'library' }) },
    { id: 'progress', icon: 'chart', label: 'Progress', go: () => nav.go({ name: 'progress' }) },
    { id: 'achievements', icon: 'trophy', label: `${Object.keys(p.achievements).length}/${ACHIEVEMENTS.length}`, go: () => nav.go({ name: 'achievements' }) },
    { id: 'tutorial', icon: 'play', label: p.seenTutorial ? 'Tutorial' : 'Tutorial ●', go: () => nav.go({ name: 'play', songId: 'first-light', diff: 'normal', mode: 'practice', tutorial: true, nonce: Date.now() }) },
    { id: 'studio', icon: 'upload', label: 'Studio', go: () => nav.go({ name: 'studio' }) },
  ];
  return (
    <nav className="tabbar" aria-label="Main menu">
      {items.map((it) => (
        <button key={it.id} className={it.id === active ? 'on' : ''} onClick={() => { playSfx('uiSelect', 0.5); it.go(); }}>
          <Icon name={it.icon} size={22} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
