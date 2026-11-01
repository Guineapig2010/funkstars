import { useEffect, useMemo, useState } from 'react';
import { nav } from '../nav';
import { useSongs } from '../../store/songs';
import { useProfile, toggleFavorite } from '../../store/profile';
import { Btn, Cover, DIFF_META, Icon, MedalBadges, ScreenHeader, Segmented, Stars, fmtTime } from '../components/common';
import { bestStars, setFeatured } from './Home';
import { background } from '../../game/background';
import { preview } from '../../audio/preview';
import { playSfx } from '../../audio/sfx';
import { DIFFICULTIES, type SongMeta } from '../../types';

type Sort = 'recent' | 'name' | 'genre' | 'difficulty' | 'best' | 'duration';
let memo = { q: '', genre: 'all', sort: 'recent' as Sort, fav: false };

export function LibraryScreen() {
  const songs = useSongs();
  const p = useProfile();
  const [q, setQ] = useState(memo.q);
  const [genre, setGenre] = useState(memo.genre);
  const [sort, setSort] = useState<Sort>(memo.sort);
  const [fav, setFav] = useState(memo.fav);
  const [hover, setHover] = useState<SongMeta | null>(null);
  useEffect(() => { memo = { q, genre, sort, fav }; }, [q, genre, sort, fav]);

  const genres = useMemo(() => ['all', ...[...new Set(songs.map((s) => s.genre))].sort()], [songs]);
  const best = (s: SongMeta) => Math.max(0, ...DIFFICULTIES.map((d) => p.bests[s.id]?.[d]?.score ?? 0));
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out = songs.filter((s) =>
      (genre === 'all' || s.genre === genre) && (!fav || p.favorites.includes(s.id)) &&
      (!ql || `${s.title} ${s.artist} ${s.genre} ${s.tag ?? ''}`.toLowerCase().includes(ql)));
    const cmp: Record<Sort, (a: SongMeta, b: SongMeta) => number> = {
      recent: (a, b) => b.addedAt - a.addedAt,
      name: (a, b) => a.title.localeCompare(b.title),
      genre: (a, b) => a.genre.localeCompare(b.genre) || a.title.localeCompare(b.title),
      difficulty: (a, b) => a.levels.extreme - b.levels.extreme || a.levels.hard - b.levels.hard,
      best: (a, b) => best(b) - best(a),
      duration: (a, b) => a.duration - b.duration,
    };
    return out.sort(cmp[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, q, genre, sort, fav, p]);

  useEffect(() => {
    const s = hover ?? list[0];
    if (!s) return;
    background.setTheme(s.theme.colors, s.theme.bg);
    if (hover) {
      const t = setTimeout(() => { preview.play(hover); background.beatSource = () => preview.pulse(); }, 350);
      return () => clearTimeout(t);
    }
  }, [hover, list]);

  return (
    <div className="library">
      <ScreenHeader title="Song Library" subtitle={`${list.length} of ${songs.length} songs`} onBack={() => nav.back()}
        right={<Btn variant="glass" icon={<Icon name="plus" />} onClick={() => nav.go({ name: 'studio' })}>Import</Btn>} />
      <div className="lib-controls">
        <label className="search">
          <Icon name="search" size={18} />
          <input placeholder="Search title, artist, genre…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search songs" />
          {q && <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search"><Icon name="close" size={14} /></button>}
        </label>
        <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Filter by genre" className="select">
          {genres.map((g) => <option key={g} value={g}>{g === 'all' ? 'All genres' : g}</option>)}
        </select>
        <Segmented<Sort> value={sort} onChange={setSort} options={[
          { value: 'recent', label: 'Recent' }, { value: 'name', label: 'Name' }, { value: 'genre', label: 'Genre' },
          { value: 'difficulty', label: 'Difficulty' }, { value: 'best', label: 'Best' }, { value: 'duration', label: 'Length' },
        ]} />
        <button className={`chip-toggle ${fav ? 'on' : ''}`} onClick={() => { playSfx('uiMove', 0.4); setFav(!fav); }} aria-pressed={fav}>
          <Icon name="heart" size={16} /> Favorites
        </button>
      </div>
      <div className="song-grid">
        {list.map((s, i) => {
          const b = p.bests[s.id] ?? {};
          const isFav = p.favorites.includes(s.id);
          return (
            <div key={s.id} className="song-card" style={{ ['--i' as string]: i, ['--c1' as string]: s.theme.colors[0], ['--c3' as string]: s.theme.colors[2] }}
              onMouseEnter={() => setHover(s)} onFocus={() => setHover(s)}>
              <button className="song-card-main" onClick={() => { playSfx('uiSelect', 0.6); setFeatured(s.id); nav.go({ name: 'details', songId: s.id }); }}>
                <div className="song-card-cover">
                  <Cover meta={s} size={180} />
                  <span className="duration">{fmtTime(s.duration)}</span>
                  {s.source !== 'builtin' && <span className="src-badge">{s.source === 'demo' ? 'TUTORIAL' : 'IMPORTED'}</span>}
                </div>
                <div className="song-card-body">
                  <div className="song-card-title">{s.title}</div>
                  <div className="song-card-artist">{s.artist}</div>
                  <div className="song-card-genre">{s.genre}{s.tag ? ` · ${s.tag}` : ''}</div>
                  <div className="song-card-row">
                    <Stars count={bestStars(p, s.id)} size={14} />
                    <span className="lvls">{DIFFICULTIES.map((d) => <span key={d} style={{ color: DIFF_META[d].color }}>{s.levels[d]}</span>)}</span>
                  </div>
                  <div className="song-card-row small">
                    <span>Best {best(s) ? best(s).toLocaleString('en-US') : '—'}</span>
                    <span>{DIFFICULTIES.map((d) => b[d] ? <MedalBadges key={d} medals={b[d]!.medals} /> : null)}</span>
                  </div>
                </div>
              </button>
              <button className={`fav-btn ${isFav ? 'on' : ''}`} aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={isFav}
                onClick={() => { playSfx('uiMove', 0.5); toggleFavorite(s.id); }}><Icon name="heart" size={18} /></button>
            </div>
          );
        })}
        {!list.length && <div className="empty">No songs match these filters.</div>}
      </div>
    </div>
  );
}
