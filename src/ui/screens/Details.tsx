import { useEffect, useState } from 'react';
import { nav } from '../nav';
import { getSong, getChartFile, useSongs } from '../../store/songs';
import { useProfile, toggleFavorite } from '../../store/profile';
import { updateSettings, useSettings } from '../../store/settings';
import { Btn, Cover, DIFF_META, Icon, MedalBadges, ScreenHeader, Segmented, Stars, fmtTime } from '../components/common';
import { background } from '../../game/background';
import { preview } from '../../audio/preview';
import { playSfx } from '../../audio/sfx';
import { DIFFICULTIES, type Difficulty, type GameMode, type SongChartFile } from '../../types';
import { setFeatured } from './Home';

let lastDiff: Difficulty = 'normal';

export function DetailsScreen({ songId }: { songId: string }) {
  useSongs();
  const song = getSong(songId);
  const p = useProfile();
  const s = useSettings();
  const [diff, setDiff] = useState<Difficulty>(p.lastPlayed?.songId === songId ? p.lastPlayed.diff : lastDiff);
  const [mode, setMode] = useState<GameMode>(s.defaultMode);
  const [chart, setChart] = useState<SongChartFile | null>(null);

  useEffect(() => {
    if (!song) return;
    setFeatured(song.id);
    background.setTheme(song.theme.colors, song.theme.bg);
    preview.play(song);
    background.beatSource = () => preview.pulse();
    getChartFile(song).then(setChart).catch(() => setChart(null));
  }, [song]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !(e.target as HTMLElement).closest('button')) start();
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const i = DIFFICULTIES.indexOf(diff) + (e.code === 'ArrowRight' ? 1 : -1);
        if (i >= 0 && i < 3) { playSfx('uiMove', 0.5); setDiff(DIFFICULTIES[i]); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!song) return <div className="center-msg">Song not found. <Btn onClick={() => nav.home()}>Home</Btn></div>;
  const best = p.bests[song.id] ?? {};
  const isFav = p.favorites.includes(song.id);
  const start = () => {
    lastDiff = diff;
    updateSettings({ defaultMode: mode });
    playSfx('uiPlay', 0.7);
    nav.go({ name: 'play', songId: song.id, diff, mode, nonce: Date.now() });
  };
  const c = chart?.charts[diff];
  const counts = c ? {
    taps: c.notes.filter((n) => n.type === 'tap' && !n.size).length,
    half: c.notes.filter((n) => n.size === 'half').length,
    micro: c.notes.filter((n) => n.size === 'micro').length,
    diag: c.notes.filter((n) => n.type === 'swipe' && (n.dir?.length ?? 0) > 5).length,
    paths: c.notes.filter((n) => n.path?.length).length,
    holds: c.notes.filter((n) => n.type === 'hold').length,
    swipes: c.notes.filter((n) => n.type === 'swipe').length,
    chords: new Set(c.notes.map((n) => n.t).filter((t, i, a) => a.indexOf(t) !== i)).size,
  } : null;
  const v = chart?.validation?.[diff];

  return (
    <div className="details" style={{ ['--c1' as string]: song.theme.colors[0], ['--c3' as string]: song.theme.colors[2] }}>
      <ScreenHeader title="" onBack={() => nav.back()} right={<>
        <Btn variant="glass" className={`round fav-top ${isFav ? 'on' : ''}`} aria-label="Favorite" aria-pressed={isFav} onClick={() => toggleFavorite(song.id)} icon={<Icon name="heart" />} />
        <Btn variant="glass" icon={<Icon name="edit" size={18} />} onClick={() => nav.go({ name: 'editor', songId: song.id, diff })}>Edit chart</Btn>
      </>} />
      <div className="details-grid">
        <div className="details-art">
          <div className="details-cover-wrap">
            <Cover meta={song} size={380} animated round />
            <div className="details-glow" />
          </div>
        </div>
        <div className="details-info">
          <div className="eyebrow">{song.genre}{song.tag ? ` · ${song.tag}` : ''}</div>
          <h1 className="details-title">{song.title}</h1>
          <div className="details-artist">{song.artist}</div>
          <div className="details-facts">
            <div><b>{Math.round(song.bpm)}</b><span>BPM</span></div>
            <div><b>{fmtTime(song.duration)}</b><span>Length</span></div>
            <div><b>5</b><span>Stages</span></div>
            <div><b>{p.plays[song.id] ?? 0}</b><span>Plays</span></div>
          </div>
          {song.fileName && <div className="file-note" title="Original file name (preserved)">♪ {song.fileName}</div>}

          <div className="diff-select" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => {
              const r = best[d];
              return (
                <button key={d} role="radio" aria-checked={d === diff} className={`diff-card ${d === diff ? 'active' : ''}`} style={{ ['--dc' as string]: DIFF_META[d].color }}
                  onClick={() => { playSfx('uiMove', 0.5); setDiff(d); }}>
                  <span className="diff-name">{DIFF_META[d].label}</span>
                  <span className="diff-level">{song.levels[d]}</span>
                  <span className="diff-notes">{song.noteCounts[d]} notes</span>
                  <span className="diff-best">{r ? <><Stars count={r.stars} size={12} /> <MedalBadges medals={r.medals} /></> : <small>Not cleared</small>}</span>
                </button>
              );
            })}
          </div>

          <div className="details-panel">
            <div className="best-block">
              <span className="label">Personal best</span>
              <b>{best[diff] ? best[diff]!.score.toLocaleString('en-US') : '—'}</b>
              {best[diff] && <small>{best[diff]!.accuracy.toFixed(2)}% · max combo {best[diff]!.maxCombo} · {best[diff]!.ppPct}% P+</small>}
            </div>
            {counts && (
              <div className="note-mix">
                <span><i className="dot tap" />{counts.taps} taps</span>
                {counts.half > 0 && <span><i className="dot tap half" />{counts.half} half</span>}
                {counts.micro > 0 && <span><i className="dot tap micro" />{counts.micro} micro</span>}
                <span><i className="dot hold" />{counts.holds} holds{counts.paths ? ` (${counts.paths} switch/rail)` : ''}</span>
                <span><i className="dot swipe" />{counts.swipes} swipes{counts.diag ? ` (${counts.diag} diagonal)` : ''}</span>
                <span><i className="dot chord" />{counts.chords} chords</span>
              </div>
            )}
            {v && (
              <div className="sync-note" title="Measured offline against the audio's detected transients">
                Chart sync check: notes align with audio transients (peak offset {v.syncPeakMs >= 0 ? '+' : ''}{v.syncPeakMs} ms){chart?.edited ? ' · hand-edited' : ''}
              </div>
            )}
          </div>

          <div className="details-actions">
            <Segmented<GameMode> value={mode} onChange={setMode} options={[{ value: 'classic', label: 'Classic' }, { value: 'practice', label: 'Practice' }]} />
            <p className="mode-help">{mode === 'classic' ? 'One miss ends the run. Scores & stars count.' : `No fail. ${s.practiceSpeed !== 1 ? `Speed ${s.practiceSpeed}× · ` : ''}${s.practiceStartStage ? `Starts at stage ${s.practiceStartStage + 1} · ` : ''}Half XP.`}</p>
            <Btn variant="play" sfx="none" className="play-big" onClick={start} icon={<Icon name="play" size={30} />}>PLAY</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
