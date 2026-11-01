import { useEffect, useState } from 'react';
import { nav, type Route } from '../nav';
import { getSong, getSongs } from '../../store/songs';
import { levelInfo, useProfile } from '../../store/profile';
import { Btn, Cover, CountUp, DIFF_META, Icon, MedalBadges } from '../components/common';
import { toast } from '../components/toasts';
import { playSfx } from '../../audio/sfx';
import { background } from '../../game/background';
import { notifyLevelUp } from './Play';
import { MEDAL_INFO } from '../../game/scoring';

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
    <div className={`results ${r.completed ? 'win' : 'lose'}`} style={{ ['--c1' as string]: song.theme.colors[0], ['--c3' as string]: song.theme.colors[2] }}>
      <div className="results-grid">
        <div className="results-left">
          <div className="results-cover"><Cover meta={song} size={260} animated /></div>
          <h2 className="results-song">{song.title}</h2>
          <div className="results-artist">{song.artist}</div>
          <div className="results-badges">
            <span className="diff-pill big" style={{ ['--dc' as string]: DIFF_META[route.diff].color }}>{DIFF_META[route.diff].label} {song.levels[route.diff]}</span>
            <span className="mode-pill">{route.mode === 'classic' ? 'Classic' : 'Practice'}</span>
          </div>
        </div>
        <div className="results-main">
          <div className={`results-title ${r.completed ? '' : 'fail'}`}>{title}</div>
          <div className="results-stars">
            {[0, 1, 2, 3, 4].map((i) => (
              <svg key={i} viewBox="0 0 24 24" className={`rstar ${i < starsShown ? 'on' : ''}`}><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" /></svg>
            ))}
          </div>
          <div className="results-score">
            <span className="label">Score</span>
            <b><CountUp value={r.score} duration={1600} delay={300} /></b>
            {o.newBest && <span className="new-best">NEW BEST!</span>}
            <small>{prev ? `Previous best ${prev.score.toLocaleString('en-US')}` : r.completed ? 'First clear on this difficulty' : 'No best yet on this difficulty'}{!r.completed ? ' · failed runs don’t count toward your best' : ''}</small>
          </div>
          {r.medals.length > 0 && <div className="results-medals"><MedalBadges medals={r.medals} size="lg" /></div>}
          <div className="results-stats">
            <Stat label="Accuracy" value={<CountUp value={r.accuracy} delay={500} format={(v) => v.toFixed(2) + '%'} />} />
            <Stat label="Max combo" value={<CountUp value={r.maxCombo} delay={500} />} />
            <Stat label="Perfect+ rate" value={<CountUp value={r.perfectPlusPct} delay={500} format={(v) => v.toFixed(1) + '%'} />} />
            <Stat label="Perfect+" value={r.counts.perfectPlus} color="#ff5ce1" />
            <Stat label="Perfect" value={r.counts.perfect} color="#2fc8ff" />
            <Stat label="Great" value={r.counts.great} color="#3be36b" />
            <Stat label="Miss" value={r.counts.miss} color="#ff3b3b" />
            <Stat label="Holds broken" value={r.counts.holdBreaks} color="#ff9a1f" />
          </div>
          <div className="results-xp">
            <span>+{o.xpGained} XP</span>
            <div className="xpbar big"><span style={{ width: `${lv.pct * 100}%` }} /></div>
            <span>LV {lv.level}</span>
          </div>
          {r.medals.length === 0 && r.completed && <p className="hint">Tip: hit every note without a miss for a {MEDAL_INFO.fc.name} medal.</p>}
          <div className="results-actions">
            <Btn variant="play" icon={<Icon name="restart" />} onClick={retry}>Retry</Btn>
            <Btn variant="glass" icon={<Icon name="library" />} onClick={() => nav.go({ name: 'library' })}>Song Library</Btn>
            <Btn variant="glass" icon={<Icon name="next" />} onClick={() => nav.replace({ name: 'details', songId: next.id })}>Next Song</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="rstat" style={color ? { ['--sc' as string]: color } : undefined}>
      <span>{label}</span><b>{value}</b>
    </div>
  );
}
