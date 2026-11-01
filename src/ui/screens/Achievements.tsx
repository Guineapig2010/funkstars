import { nav } from '../nav';
import { useProfile } from '../../store/profile';
import { ACHIEVEMENTS } from '../../game/achievements';
import { ScreenHeader } from '../components/common';

export function AchievementsScreen() {
  const p = useProfile();
  const unlocked = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
  return (
    <div className="achievements">
      <ScreenHeader title="Achievements" subtitle={`${unlocked} of ${ACHIEVEMENTS.length} unlocked`} onBack={() => nav.back()} />
      <div className="ach-progress"><span style={{ width: `${(unlocked / ACHIEVEMENTS.length) * 100}%` }} /></div>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a, i) => {
          const at = p.achievements[a.id];
          const [c, t] = a.progress(p);
          return (
            <div key={a.id} className={`ach-card ${at ? 'unlocked' : ''}`} style={{ ['--i' as string]: i }}>
              <div className="ach-icon">{a.icon}</div>
              <div className="ach-body">
                <b>{a.name}</b>
                <small>{a.desc}</small>
                {at ? <span className="ach-date">Unlocked {new Date(at).toLocaleDateString()}</span> : (
                  <div className="ach-bar"><span style={{ width: `${(c / t) * 100}%` }} /><em>{c.toLocaleString('en-US')} / {t.toLocaleString('en-US')}</em></div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
