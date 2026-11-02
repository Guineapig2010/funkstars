// Shared UI components.
import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import type { Difficulty, SongMeta } from '../../types';
import { coverCanvas, drawCover, loadCoverImage, cachedCoverImage } from '../cover';
import { playSfx } from '../../audio/sfx';
import { MEDAL_INFO, type Medal } from '../../game/scoring';
import { getSettings } from '../../store/settings';

export const DIFF_META: Record<Difficulty, { label: string; color: string; short: string }> = {
  normal: { label: 'Normal', color: '#2fd87a', short: 'N' },
  hard: { label: 'Hard', color: '#ff9a1f', short: 'H' },
  extreme: { label: 'Extreme', color: '#ff2d6f', short: 'X' },
};

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Album cover. `animated` re-draws the procedural art each frame (featured / detail views). */
export function Cover({ meta, size = 256, animated = false, className = '', round = false }: { meta: SongMeta; size?: number; animated?: boolean; className?: string; round?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (meta.coverUrl && !cachedCoverImage(meta.coverUrl)) loadCoverImage(meta.coverUrl).then(() => setLoaded((x) => x + 1)).catch(() => {});
  }, [meta.coverUrl]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    c.width = c.height = px;
    const g = c.getContext('2d')!;
    if (!animated || getSettings().reducedMotion || meta.coverUrl) {
      g.drawImage(coverCanvas(meta, px, !round), 0, 0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 32) return; // ~30fps is plenty for cover art
      last = now;
      g.clearRect(0, 0, px, px);
      drawCover(g, px, meta, (now - t0) / 1000 + 1.3, !round);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
  return <canvas ref={ref} className={`cover ${className}`} style={{ width: size, height: size }} aria-label={`${meta.title} cover art`} role="img" />;
}

export function Stars({ count, max = 5, size = 16 }: { count: number; max?: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" className={i < count ? 'on' : 'off'}>
          <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" />
        </svg>
      ))}
    </span>
  );
}

export function MedalBadges({ medals, size = 'sm' }: { medals: Medal[]; size?: 'sm' | 'lg' }) {
  if (!medals?.length) return null;
  const top = medals.includes('app') ? 'app' : medals.includes('ap') ? 'ap' : 'fc';
  const list: Medal[] = size === 'lg' ? medals : [top];
  return (
    <span className={`medals ${size}`}>
      {list.map((m) => (
        <span key={m} className={`medal medal-${m}`} style={{ ['--mc' as string]: MEDAL_INFO[m].color }} title={MEDAL_INFO[m].name}>
          {size === 'lg' ? MEDAL_INFO[m].name : MEDAL_INFO[m].short}
        </span>
      ))}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'glass' | 'danger' | 'play'; sfx?: 'uiSelect' | 'uiBack' | 'uiPlay' | 'none'; icon?: ReactNode };
export function Btn({ variant = 'glass', sfx = 'uiSelect', icon, className = '', children, onClick, onMouseEnter, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={`btn btn-${variant} ${className}`}
      onMouseEnter={(e) => { playSfx('uiMove', 0.3); onMouseEnter?.(e); }}
      onClick={(e) => { if (sfx !== 'none') playSfx(sfx, 0.6); onClick?.(e); }}
    >
      {icon && <span className="btn-icon">{icon}</span>}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></>,
    back: <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
    next: <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
    gear: <path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8.6 4.9l1.9 1.5-2 3.4-2.3-.8a7.7 7.7 0 01-2 1.2l-.4 2.3h-4l-.4-2.3a7.7 7.7 0 01-2-1.2l-2.3.8-2-3.4 1.9-1.5a7.6 7.6 0 010-2.3L1.1 9.6l2-3.4 2.3.8a7.7 7.7 0 012-1.2L7.8 3.5h4l.4 2.3a7.7 7.7 0 012 1.2l2.3-.8 2 3.4-1.9 1.5a7.6 7.6 0 010 2.3z" fill="currentColor" transform="translate(1.2 0) scale(.95)" />,
    library: <><rect x="3" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="9" y="4" width="4" height="16" rx="1" fill="currentColor" opacity=".7" /><path d="M15.5 5.2l3.8-1 3.4 14.6-3.8 1z" fill="currentColor" /></>,
    trophy: <path d="M7 3h10v2h3v3a4 4 0 01-4 4h-.3A5 5 0 0113 15v3h3v3H8v-3h3v-3a5 5 0 01-2.7-3H8a4 4 0 01-4-4V5h3zm-1 4v1a2 2 0 002 2V7zm12 0h-2v3a2 2 0 002-2z" fill="currentColor" />,
    chart: <path d="M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z" fill="currentColor" />,
    plus: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
    heart: <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.4 1.1 4.9 2.9 1.5-1.8 2.9-2.9 4.9-2.9 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></>,
    star: <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" fill="currentColor" />,
    edit: <path d="M4 17.2V20h2.8L17.6 9.2l-2.8-2.8zM20.7 6.1a1 1 0 000-1.4l-1.4-1.4a1 1 0 00-1.4 0l-1.6 1.6 2.8 2.8z" fill="currentColor" />,
    restart: <path d="M12 5a7 7 0 11-6.6 4.7M5 4v5h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
    home: <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" fill="currentColor" />,
    fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
    upload: <path d="M12 16V4m0 0l-5 5m5-5l5 5M4 20h16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
    music: <path d="M9 18a3 3 0 11-2-2.8V5l12-2v12a3 3 0 11-2-2.8V7.4L9 8.7z" fill="currentColor" />,
    user: <><circle cx="12" cy="8" r="4.2" fill="currentColor" /><path d="M3.5 21a8.5 8.5 0 0117 0z" fill="currentColor" /></>,
    close: <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
    trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
    download: <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
    sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }} />
      <span className="slider-value">{format ? format(value) : value}</span>
    </label>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <span className="toggle-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={value} onChange={(e) => { playSfx('uiMove', 0.4); onChange(e.target.checked); }} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented-wrap">
      {label && <span className="slider-label">{label}</span>}
      <div className="segmented" role="radiogroup">
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''}
            onClick={() => { playSfx('uiMove', 0.4); onChange(o.value); }}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function ScreenHeader({ title, onBack, right, subtitle }: { title: string; onBack?: () => void; right?: ReactNode; subtitle?: string }) {
  return (
    <header className="screen-header">
      {onBack && <Btn variant="glass" className="round" sfx="uiBack" onClick={onBack} aria-label="Back" icon={<Icon name="back" />} />}
      <div className="screen-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="screen-header-right">{right}</div>
    </header>
  );
}

/** Animated number counter. */
export function CountUp({ value, duration = 1400, delay = 0, format = (v: number) => Math.round(v).toLocaleString('en-US') }: { value: number; duration?: number; delay?: number; format?: (v: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / duration));
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, delay]);
  return <>{format(v)}</>;
}
