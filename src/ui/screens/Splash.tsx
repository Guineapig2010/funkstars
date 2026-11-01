import { useEffect, useState } from 'react';
import { nav } from '../nav';
import { audio } from '../../audio/engine';
import { initSfx, playSfx } from '../../audio/sfx';
import { isLibraryLoaded, loadLibrary } from '../../store/songs';
import { Logo } from '../components/Logo';
import { db } from '../../store/db';

export function SplashScreen() {
  const [ready, setReady] = useState(isLibraryLoaded());
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    loadLibrary().then(() => setReady(true));
    document.fonts?.ready.then(() => setFontsReady(true));
    db.persist();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const start = async () => {
      await audio.unlock();
      initSfx();
      playSfx('uiPlay', 0.7);
      nav.replace({ name: 'home' });
    };
    const onKey = (e: KeyboardEvent) => { if (!e.repeat) start(); };
    const onPointer = () => start();
    window.addEventListener('keydown', onKey, { once: true });
    window.addEventListener('pointerup', onPointer, { once: true });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerup', onPointer); };
  }, [ready]);

  return (
    <div className={`splash ${fontsReady ? 'fonts-ready' : ''}`}>
      <div className="splash-rays" aria-hidden="true" />
      <Logo size="xl" />
      <p className="splash-tag">Feel every beat.</p>
      <div className="splash-cta">
        {ready ? <span className="press-start">{matchMedia('(pointer: coarse)').matches ? 'TAP TO START' : 'PRESS ANY KEY · CLICK TO START'}</span> : <span className="loading-dots">Loading songs</span>}
      </div>
      <p className="splash-foot">Headphones recommended · Best with sound on</p>
    </div>
  );
}
