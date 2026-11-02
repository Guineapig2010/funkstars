import { createRoot } from 'react-dom/client';
import '@fontsource/outfit/300.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import '@fontsource/outfit/900.css';
import '@fontsource/bungee/400.css';
import './styles/main.css';
import { App } from './ui/App';

// safe-area top inset available to canvas code
function syncSafeArea() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  document.documentElement.style.setProperty('--sat', probe.offsetHeight + 'px');
  probe.remove();
}
syncSafeArea();
window.addEventListener('orientationchange', () => setTimeout(syncSafeArea, 300));
window.addEventListener('resize', syncSafeArea);

// block pinch-zoom / double-tap zoom gestures (iOS Safari ignores user-scalable=no)
document.addEventListener('gesturestart', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && !(e.target as HTMLElement).closest('input, textarea, select, .play')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('SW registration failed', e));
  });
}
