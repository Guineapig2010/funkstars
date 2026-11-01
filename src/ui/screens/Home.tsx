import { useEffect, useMemo, useRef, useState } from 'react';
import { nav } from '../nav';
import { useSongs } from '../../store/songs';
import { useProfile, levelInfo, totalStars } from '../../store/profile';
import { useSettings } from '../../store/settings';
import { Btn, Cover, DIFF_META, Icon, MedalBadges, Stars, fmtTime } from '../components/common';
import { Logo } from '../components/Logo';
import { background } from '../../game/background';
import { preview } from '../../audio/preview';
import { playSfx } from '../../audio/sfx';
import { ACHIEVEMENTS, playerTitle } from '../../game/achievements';
import { toggleFullscreen, fullscreenSupported } from '../App';
import type { SongMeta } from '../../types';
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

export function HomeScreen() {
  const songs = useSongs();
  const p = useProfile();
  const [idx, setIdx] = useState(() => Math.max(0, songs.findIndex((s) => s.id === (rememberedId ?? p.lastPlayed?.songId))));
  const song: SongMeta | undefined = songs[idx];
  const carRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!song) return;
    rememberedId = song.id;
    background.setTheme(song.theme.colors, song.theme.bg);
    background.setIntensity(0.15);
    preview.play(song);
    background.beatSource = () => preview.pulse();
    const el = carRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [song, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code === 'Enter') return;
      if (e.code === 'ArrowRight') { setIdx((i) => (i + 1) % songs.length); playSfx('uiMove', 0.5); }
      else if (e.code === 'ArrowLeft') { setIdx((i) => (i - 1 + songs.length) % songs.length); playSfx('uiMove', 0.5); }
      else if (e.code === 'Enter' && song && !(e.target as HTMLElement).closest('button')) { playSfx('uiSelect', 0.6); nav.go({ name: 'details', songId: song.id }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [songs.length, song]);

  const unlocked = Object.keys(p.achievements).length;
  const lv = levelInfo(p.xp);
  const completed = useMemo(() => Object.keys(p.bests).length, [p.bests]);

  if (!song) return <div className="center-msg">No songs found. Open the Studio to import music.</div>;
  const best = p.bests[song.id] ?? {};

  return (
    <div className="home">
      <TopBar />
      <div className="home-grid">
        <div className="home-hero">
          <Logo size="lg" />
          <div className="featured" onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTilt({ x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 });
          }} onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
            <div className="featured-cover" style={{ transform: `perspective(900px) rotateY(${tilt.x * 10}deg) rotateX(${-tilt.y * 10}deg)` }}>
              <Cover meta={song} size={300} animated key={song.id} />
              <div className="cover-shine" style={{ background: `radial-gradient(circle at ${50 + tilt.x * 40}% ${50 + tilt.y * 40}%, rgba(255,255,255,.35), transparent 55%)` }} />
              <div className="vinyl" aria-hidden="true" />
            </div>
            <div className="featured-info" key={song.id + '-info'}>
              <div className="eyebrow">{song.source === 'demo' ? 'TUTORIAL TRACK' : song.source === 'imported' ? 'IMPORTED' : 'FEATURED'} · {song.genre}</div>
              <h2 className="featured-title">{song.title}</h2>
              <div className="featured-artist">{song.artist}{song.tag ? <span className="tag">{song.tag}</span> : null}</div>
              <div className="featured-meta">
                <span>{Math.round(song.bpm)} BPM</span><span>{fmtTime(song.duration)}</span>
                <span className="diff-pills">{DIFFICULTIES.map((d) => (
                  <span key={d} className="diff-pill" style={{ ['--dc' as string]: DIFF_META[d].color }}>{DIFF_META[d].short}{song.levels[d]}</span>
                ))}</span>
              </div>
              <div className="featured-best">
                <Stars count={bestStars(p, song.id)} size={20} />
                {DIFFICULTIES.map((d) => best[d] ? <MedalBadges key={d} medals={best[d]!.medals} /> : null)}
              </div>
              <div className="featured-actions">
                <Btn variant="play" sfx="uiPlay" className="play-big" onClick={() => nav.go({ name: 'details', songId: song.id })} icon={<Icon name="play" size={28} />}>PLAY</Btn>
                <Btn variant="glass" className="round" aria-label="Previous song" onClick={() => setIdx((i) => (i - 1 + songs.length) % songs.length)} icon={<Icon name="back" />} />
                <Btn variant="glass" className="round" aria-label="Next song" onClick={() => setIdx((i) => (i + 1) % songs.length)} icon={<Icon name="next" />} />
              </div>
            </div>
          </div>
        </div>

        <nav className="home-tiles" aria-label="Main menu">
          <Tile icon="library" title="Song Library" sub={`${songs.length} songs · ${completed} cleared`} color="#7b5cff" onClick={() => nav.go({ name: 'library' })} />
          <Tile icon="chart" title="Progression" sub={`Level ${lv.level} · ${Math.round(lv.pct * 100)}% to next`} color="#19d3ff" onClick={() => nav.go({ name: 'progress' })} />
          <Tile icon="trophy" title="Achievements" sub={`${unlocked} / ${ACHIEVEMENTS.length} unlocked`} color="#ffb81f" onClick={() => nav.go({ name: 'achievements' })} />
          <Tile icon="upload" title="Studio" sub="Import songs · Chart editor" color="#ff4fa3" onClick={() => nav.go({ name: 'studio' })} />
          <Tile icon="play" title={p.seenTutorial ? 'Tutorial' : 'Tutorial · NEW'} sub="Learn every note type" color="#ffd23f" onClick={() => nav.go({ name: 'play', songId: 'first-light', diff: 'normal', mode: 'practice', tutorial: true, nonce: Date.now() })} />
          <Tile icon="sliders" title="Calibrate" sub={p.calibrated ? 'Latency tuned ✓' : 'Sync audio & input'} color="#2fd87a" onClick={() => nav.go({ name: 'calibrate' })} />
          <Tile icon="gear" title="Settings" sub="Controls · Graphics · Audio" color="#a0a8c8" onClick={() => nav.go({ name: 'settings' })} />
          <div className="home-stats">
            <div><b>{p.stats.plays}</b><span>Plays</span></div>
            <div><b>{p.stats.bestCombo}</b><span>Best combo</span></div>
            <div><b>{p.stats.perfectPlus.toLocaleString('en-US')}</b><span>Perfect+</span></div>
          </div>
        </nav>
      </div>

      <div className="carousel-wrap">
        <div className="carousel" ref={carRef} role="listbox" aria-label="Songs">
          {songs.map((s, i) => (
            <button key={s.id} data-idx={i} role="option" aria-selected={i === idx} className={`car-card ${i === idx ? 'active' : ''}`}
              onClick={() => { if (i === idx) nav.go({ name: 'details', songId: s.id }); else { playSfx('uiMove', 0.5); setIdx(i); } }}>
              <Cover meta={s} size={132} />
              <span className="car-title">{s.title}</span>
              <span className="car-sub"><Stars count={bestStars(p, s.id)} size={11} /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({ icon, title, sub, color, onClick }: { icon: string; title: string; sub: string; color: string; onClick: () => void }) {
  return (
    <button className="tile" style={{ ['--tc' as string]: color }} onClick={() => { playSfx('uiSelect', 0.6); onClick(); }} onMouseEnter={() => playSfx('uiMove', 0.3)}>
      <span className="tile-icon"><Icon name={icon} size={26} /></span>
      <span className="tile-text"><b>{title}</b><small>{sub}</small></span>
      <span className="tile-arrow"><Icon name="next" size={18} /></span>
    </button>
  );
}
