import { useEffect, useRef, useState, type ReactNode } from 'react';
import { nav, useNav, type Route } from './nav';
import { background } from '../game/background';
import { Toasts } from './components/toasts';
import { SplashScreen } from './screens/Splash';
import { HomeScreen } from './screens/Home';
import { LibraryScreen } from './screens/Library';
import { DetailsScreen } from './screens/Details';
import { PlayScreen } from './screens/Play';
import { ResultsScreen } from './screens/Results';
import { SettingsScreen } from './screens/Settings';
import { ProgressScreen } from './screens/Progress';
import { AchievementsScreen } from './screens/Achievements';
import { StudioScreen } from './screens/Studio';
import { EditorScreen } from './screens/Editor';
import { CalibrateScreen } from './screens/Calibrate';
import { getSettings, subscribeSettings } from '../store/settings';
import { audio } from '../audio/engine';
import { preview } from '../audio/preview';

function renderRoute(r: Route): ReactNode {
  switch (r.name) {
    case 'splash': return <SplashScreen />;
    case 'home': return <HomeScreen />;
    case 'library': return <LibraryScreen />;
    case 'details': return <DetailsScreen songId={r.songId} />;
    case 'play': return <PlayScreen key={`${r.songId}-${r.diff}-${r.nonce ?? 0}`} route={r} />;
    case 'results': return <ResultsScreen route={r} />;
    case 'settings': return <SettingsScreen tab={r.tab} />;
    case 'progress': return <ProgressScreen />;
    case 'achievements': return <AchievementsScreen />;
    case 'studio': return <StudioScreen />;
    case 'editor': return <EditorScreen songId={r.songId} diff={r.diff} />;
    case 'calibrate': return <CalibrateScreen back={r.back} />;
  }
}

export function App() {
  const { route, key, dir } = useNav();
  const bgRef = useRef<HTMLCanvasElement>(null);
  const [layers, setLayers] = useState<{ key: number; route: Route; leaving: boolean }[]>([{ key, route, leaving: false }]);

  useEffect(() => {
    if (bgRef.current) background.attach(bgRef.current);
    const apply = () => {
      const s = getSettings();
      background.reducedMotion = s.reducedMotion;
      audio.setVolumes(s.musicVolume, s.sfxVolume);
      document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
      const q = s.quality;
      background.scale = q === 'low' ? 0.33 : q === 'medium' ? 0.45 : q === 'high' ? 0.6 : q === 'ultra' ? 0.85 : 0.5;
    };
    apply();
    return subscribeSettings(apply);
  }, []);

  // screen transitions: keep the old screen briefly for its exit animation
  useEffect(() => {
    setLayers((ls) => {
      if (ls.length && ls[ls.length - 1].key === key) return ls;
      return [...ls.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), { key, route, leaving: false }];
    });
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), getSettings().reducedMotion ? 10 : 420);
    return () => clearTimeout(t);
  }, [key, route]);

  // stop menu previews while playing
  useEffect(() => {
    if (route.name === 'play' || route.name === 'editor' || route.name === 'calibrate') { preview.stop(0.2); background.beatSource = null; }
  }, [route.name]);

  // global Esc = back in menus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' && e.code !== 'Backspace') return;
      const r = nav.current;
      if (['play', 'splash', 'home', 'editor', 'results'].includes(r.name)) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [data-capture-keys]')) return;
      e.preventDefault();
      nav.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <canvas ref={bgRef} className="bg-canvas" aria-hidden="true" />
      <div className="bg-overlay" aria-hidden="true" />
      <main className="screens">
        {layers.map((l) => (
          <section key={l.key} className={`screen-layer ${l.leaving ? 'leaving' : 'entering'} dir-${dir > 0 ? 'fwd' : 'back'} route-${l.route.name}`} aria-hidden={l.leaving}>
            {renderRoute(l.route)}
          </section>
        ))}
      </main>
      <Toasts />
    </>
  );
}

export async function toggleFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (document.fullscreenElement || d.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen(); else d.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
      try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('any'); } catch { /* ignore */ }
    } else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch { return false; }
}

export function fullscreenSupported() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  return !!(el.requestFullscreen || el.webkitRequestFullscreen) && !/iPhone|iPod/.test(navigator.userAgent);
}
