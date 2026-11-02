import { useEffect, useState } from 'react';
import { nav, type Route } from '../nav';
import { getSong, getSongs } from '../../store/songs';
import { levelInfo, useProfile } from '../../store/profile';
import { Cover, CountUp, DIFF_META, MedalBadges } from '../components/common';
import { toast } from '../components/toasts';
import { playSfx } from '../../audio/sfx';
import { background } from '../../game/background';
import { notifyLevelUp } from './Play';
import { MEDAL_INFO } from '../../game/scoring';
import { CATEGORY_LABEL, type NoteCategory } from '../../game/session';

type ResultsRoute = Extract<Route, { name: 'results' }>;

export function ResultsScreen({ route }: { route: ResultsRoute }) {
  const song = getSong(route.songId);
  const p = useProfile();
  const r = route.info.result;
  const o = route.outcome;
  const [starsShown, setStarsShown] = useState(0);

  useEffect(() => {
    if (song) { background.setTheme(song.theme.colors, song.theme.bg); background.setIntensity(r.completed ? 0.6 : 0.1); }
    const timers: number[] = [];
    for (let i = 1; i <= r.stars; i++) timers.push(window.setTimeout(() => { setStarsShown(i); playSfx('star', 0.6, 1 + i * 0.06); background.pulse(1); }, 900 + i * 380));
    timers.push(window.setTimeout(() => {
      route.unlocked.forEach((a, i) => setTimeout(() => toast({ kind: 'achievement', icon: a.icon, title: `Achievement: ${a.name}`, text: a.desc }), i * 900));
      notifyLevelUp(o.levelBefore, o.levelAfter);
    }, 1200 + r.stars * 380));
    if (!r.completed) playSfx('fail', 0.4);
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' || e.code === 'Enter') retry();
      if (e.code === 'Escape') nav.go({ name: 'library' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!song) return null;
  const songs = getSongs();
  const next = songs[(songs.findIndex((s) => s.id === song.id) + 1) % songs.length];
  const retry = () => nav.replace({ name: 'play', songId: song.id, diff: route.diff, mode: route.mode, nonce: Date.now() });
  const lv = levelInfo(p.xp);
  const prev = o.previous;
  const title = !r.completed ? 'FAILED' : r.medals.includes('app') ? 'ALL PERFECT+' : r.medals.includes('ap') ? 'ALL PERFECT' : r.medals.includes('fc') ? 'FULL COMBO' : 'CLEAR!';

  return (
    <div className={`results2 ${r.completed ? 'win' : 'lose'}`} style={{ ['--c1' as string]: song.theme.colors[0], ['--c2' as string]: song.theme.colors[1], ['--c3' as string]: song.theme.colors[2] }}>
      <div className="r2-col">
        <h1 className="r2-title">{song.title.toUpperCase()}</h1>
        <div className="r2-artist">{song.artist}</div>
        <div className="r2-tags">
          <span className="diff-pill" style={{ ['--dc' as string]: DIFF_META[route.diff].color }}>{DIFF_META[route.diff].label.toUpperCase()}</span>
          <span className="mode-pill">{route.mode === 'classic' ? 'Classic' : 'Practice'}</span>
          {!r.completed && <span className="r2-failed">FAILED</span>}
          {r.completed && title !== 'CLEAR!' && <span className="r2-medal">{title}</span>}
        </div>
        <div className="r2-cover" style={{ ['--prog' as string]: `${Math.min(1, r.score / Math.max(1, r.maxScore)) * 300}deg` }}>
          <Cover meta={song} size={300} animated round />
        </div>
        <div className="r2-stars">
          {[0, 1, 2, 3, 4].map((i) => (
            <svg key={i} viewBox="0 0 24 24" className={`rstar ${i < starsShown ? 'on' : ''}`}><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" /></svg>
          ))}
        </div>
        <div className="r2-score">
          <b><CountUp value={r.score} duration={1600} delay={300} /></b>
          {o.newBest && <span className="r2-new">NEW<br />BEST</span>}
        </div>
        <small className="r2-prev">{prev ? `Previous best ${prev.score.toLocaleString('en-US')}` : r.completed ? 'First clear on this difficulty' : 'Failed runs don’t count toward your best'}</small>
      </div>
      <div className="r2-band">
        <div><b>{r.counts.perfectPlus}</b><span>PERFECT <sup>+</sup></span></div>
        <div><b>{r.counts.perfect}</b><span>PERFECT</span></div>
        <div><b>{r.counts.great}</b><span>GREAT</span></div>
        <div><b>{r.counts.miss}</b><span>MISS</span></div>
      </div>
      <div className="r2-col">
        <div className="r2-details">
          <span>Accuracy <b>{r.accuracy.toFixed(2)}%</b></span>
          <span>Max streak <b>{r.maxCombo}</b></span>
          {r.counts.holdBreaks > 0 && <span>Holds broken <b>{r.counts.holdBreaks}</b></span>}
          {r.timingMs !== null && r.timingMs !== undefined && <span>Your timing <b>{Math.abs(r.timingMs) < 15 ? 'on time' : `${Math.abs(r.timingMs)} ms ${r.timingMs > 0 ? 'late' : 'early'}`}</b></span>}
          <span>+{o.xpGained} XP · LV {lv.level}</span>
        </div>
        {r.medals.length > 0 && <div className="results-medals"><MedalBadges medals={r.medals} size="lg" /></div>}
        {r.byType && Object.keys(r.byType).length > 0 && (
          <div className="results-types">
            {(Object.entries(r.byType) as [NoteCategory, [number, number]][]).map(([k, [hit, tot]]) => (
              <span key={k} className={hit === tot ? 'clean' : ''}><b>{hit}/{tot}</b> {CATEGORY_LABEL[k]}</span>
            ))}
          </div>
        )}
        {r.medals.length === 0 && r.completed && <p className="hint">Hit every tile without a miss for a {MEDAL_INFO.fc.name} medal.</p>}
        <div className="r2-actions">
          <button className="r2-btn outline" onClick={() => { playSfx('uiSelect', 0.6); retry(); }}>RETRY</button>
          <button className="r2-btn solid" onClick={() => { playSfx('uiSelect', 0.6); nav.go({ name: 'library' }); }}>CONTINUE</button>
          <button className="link r2-next" onClick={() => nav.replace({ name: 'details', songId: next.id })}>Next song: {next.title} →</button>
        </div>
      </div>
    </div>
  );
}
