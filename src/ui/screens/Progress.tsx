import { nav } from '../nav';
import { useProfile, levelInfo, totalStars } from '../../store/profile';
import { useSongs } from '../../store/songs';
import { MILESTONES, playerTitle, ACHIEVEMENTS } from '../../game/achievements';
import { Cover, DIFF_META, MedalBadges, ScreenHeader, Stars } from '../components/common';
import { DIFFICULTIES } from '../../types';
import { useSettings } from '../../store/settings';

export function ProgressScreen() {
  const p = useProfile();
  const s = useSettings();
  const songs = useSongs();
  const lv = levelInfo(p.xp);
  const st = p.stats;
  const maxStars = songs.length * 3 * 5;
  const hrs = Math.floor(st.timePlayed / 3600), mins = Math.floor((st.timePlayed % 3600) / 60);
  return (
    <div className="progress-screen">
      <ScreenHeader title="Progression" subtitle={`${s.playerName} · ${playerTitle(p.xp)}`} onBack={() => nav.back()} />
      <div className="progress-grid">
        <div className="level-card glass">
          <div className="level-ring" style={{ ['--p' as string]: lv.pct }}>
            <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" className="track" /><circle cx="60" cy="60" r="52" className="fill" /></svg>
            <div className="level-num"><small>LEVEL</small><b>{lv.level}</b></div>
          </div>
          <div className="level-text">
            <h2>{playerTitle(p.xp)}</h2>
            <p>{lv.into} / {lv.need} XP to level {lv.level + 1}</p>
            <div className="xpbar big"><span style={{ width: `${lv.pct * 100}%` }} /></div>
            <div className="mini-stats">
              <div><b>{totalStars(p)}</b><span>/ {maxStars} stars</span></div>
              <div><b>{Object.keys(p.achievements).length}</b><span>/ {ACHIEVEMENTS.length} achievements</span></div>
              <div><b>{p.xp.toLocaleString('en-US')}</b><span>total XP</span></div>
            </div>
          </div>
        </div>

        <div className="milestones glass">
          <h3>Milestone rewards</h3>
          {MILESTONES.map((m) => {
            const ok = lv.level >= m.level;
            return (
              <div key={m.level} className={`milestone ${ok ? 'ok' : ''}`}>
                <span className="ms-level">LV {m.level}</span>
                <span className="ms-text"><b>{m.name}</b><small>{m.desc}</small></span>
                <span className="ms-state">{ok ? '✓ Unlocked' : '🔒'}</span>
              </div>
            );
          })}
        </div>

        <div className="stats glass">
          <h3>Statistics</h3>
          <div className="stat-grid">
            <Stat k="Plays" v={st.plays} /><Stat k="Songs cleared" v={st.completions} /><Stat k="Fails" v={st.fails} />
            <Stat k="Notes hit" v={st.notesHit} /><Stat k="Perfect+" v={st.perfectPlus} /><Stat k="Perfect" v={st.perfect} />
            <Stat k="Great" v={st.great} /><Stat k="Misses" v={st.miss} /><Stat k="Best combo" v={st.bestCombo} />
            <Stat k="Full combos" v={st.fullCombos} /><Stat k="All perfects" v={st.allPerfects} /><Stat k="Time played" v={`${hrs}h ${mins}m`} />
            <Stat k="Normal clears" v={st.clears.normal} /><Stat k="Hard clears" v={st.clears.hard} /><Stat k="Extreme clears" v={st.clears.extreme} />
          </div>
        </div>

        <div className="records glass">
          <h3>Personal records</h3>
          <div className="record-table">
            {songs.map((song) => (
              <button key={song.id} className="record-row" onClick={() => nav.go({ name: 'details', songId: song.id })}>
                <Cover meta={song} size={44} />
                <span className="rr-title"><b>{song.title}</b><small>{song.artist}</small></span>
                {DIFFICULTIES.map((d) => {
                  const r = p.bests[song.id]?.[d];
                  return (
                    <span key={d} className="rr-diff" style={{ ['--dc' as string]: DIFF_META[d].color }}>
                      <i>{DIFF_META[d].short}</i>
                      {r ? <><Stars count={r.stars} size={10} /><small>{r.score.toLocaleString('en-US')}</small><MedalBadges medals={r.medals} /></> : <small className="dim">—</small>}
                    </span>
                  );
                })}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return <div className="stat"><b>{typeof v === 'number' ? v.toLocaleString('en-US') : v}</b><span>{k}</span></div>;
}
