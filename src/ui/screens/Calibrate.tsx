// Two-step latency calibration:
//  1) tap to an audio metronome  -> measures (unreported audio latency + input latency)
//  2) tap to a silent visual pulse -> measures input/display latency
// audioOffset = step1 - step2, inputOffset = step2.
import { useEffect, useRef, useState } from 'react';
import { nav, type Route } from '../nav';
import { audio } from '../../audio/engine';
import { playSfx } from '../../audio/sfx';
import { updateSettings, useSettings } from '../../store/settings';
import { updateProfile } from '../../store/profile';
import { checkAchievements } from '../../game/achievements';
import { Btn, Icon, ScreenHeader } from '../components/common';
import { toast } from '../components/toasts';
import { background } from '../../game/background';

const BPM = 100;
const PERIOD = 60 / BPM;
const TAPS = 16;

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

export function CalibrateScreen({ back }: { back?: Route }) {
  const s = useSettings();
  const [step, setStep] = useState<'intro' | 'audio' | 'visual' | 'done'>('intro');
  const [taps, setTaps] = useState<number[]>([]);
  const [audioRes, setAudioRes] = useState<number | null>(null);
  const [visualRes, setVisualRes] = useState<number | null>(null);
  const [beat, setBeat] = useState(0);
  const startRef = useRef(0); // audio ctx time (step 1) or perf time (step 2) of first beat
  const clickNodes = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => { background.setIntensity(0.05); }, []);

  const clickBuf = () => {
    const ctx = audio.ctx!;
    const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const t = i / ctx.sampleRate; d[i] = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 90) * 0.8; }
    return b;
  };

  const startAudio = async () => {
    await audio.unlock();
    const ctx = audio.ctx!;
    const buf = clickBuf();
    const t0 = ctx.currentTime + 1.0;
    startRef.current = t0;
    clickNodes.current = [];
    for (let i = 0; i < TAPS + 8; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = i % 4 === 0 ? 1 : 0.6;
      src.connect(g); g.connect(audio.sfxBus);
      src.start(t0 + i * PERIOD);
      clickNodes.current.push(src);
    }
    setTaps([]);
    setStep('audio');
  };

  const startVisual = () => {
    clickNodes.current.forEach((n) => { try { n.stop(); } catch { /* ignore */ } });
    startRef.current = performance.now() + 1000;
    setTaps([]);
    setStep('visual');
  };

  // beat indicator animation
  useEffect(() => {
    if (step !== 'audio' && step !== 'visual') return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = step === 'audio' ? audio.heardTime() - startRef.current : (performance.now() - startRef.current) / 1000;
      if (t < 0) { setBeat(0); return; }
      const ph = (t % PERIOD) / PERIOD;
      setBeat(Math.exp(-ph * 7));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // tap capture
  useEffect(() => {
    if (step !== 'audio' && step !== 'visual') return;
    const onTap = (ts: number) => {
      let t: number;
      if (step === 'audio') t = audio.heardTime(ts) - startRef.current;
      else t = (ts - startRef.current) / 1000;
      if (t < -PERIOD / 2) return;
      const k = Math.round(t / PERIOD);
      const delta = t - k * PERIOD;
      setTaps((prev) => {
        const next = [...prev, delta];
        if (next.length >= TAPS) {
          const m = median(next.slice(2)) * 1000;
          if (step === 'audio') { setAudioRes(m); setTimeout(startVisual, 300); }
          else { setVisualRes(m); setStep('done'); clickNodes.current.forEach((n) => { try { n.stop(); } catch { /* ignore */ } }); }
        }
        return next;
      });
    };
    const onKey = (e: KeyboardEvent) => { if (e.repeat || e.code === 'Escape') return; e.preventDefault(); onTap(e.timeStamp || performance.now()); };
    const onPtr = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('button')) return; onTap(e.timeStamp || performance.now()); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPtr);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPtr); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => () => clickNodes.current.forEach((n) => { try { n.stop(); } catch { /* ignore */ } }), []);

  const apply = () => {
    if (audioRes === null || visualRes === null) return;
    const input = Math.round(visualRes);
    const aud = Math.round(audioRes - visualRes);
    updateSettings({ inputOffsetMs: Math.max(-150, Math.min(250, input)), audioOffsetMs: Math.max(-200, Math.min(300, aud)) });
    updateProfile((p) => { p.calibrated = true; });
    checkAchievements().forEach((a) => toast({ kind: 'achievement', icon: a.icon, title: `Achievement: ${a.name}`, text: a.desc }));
    playSfx('uiSelect', 0.6);
    toast({ kind: 'info', icon: '🎚️', title: 'Calibration saved', text: `Audio ${aud > 0 ? '+' : ''}${aud} ms · Input ${input > 0 ? '+' : ''}${input} ms` });
    back ? nav.replace(back) : nav.back();
  };

  return (
    <div className="calibrate">
      <ScreenHeader title="Latency Calibration" subtitle={`Current: audio ${s.audioOffsetMs} ms · input ${s.inputOffsetMs} ms`} onBack={() => nav.back()} />
      <div className="calib-body glass">
        {step === 'intro' && <>
          <h2>Get perfectly in sync</h2>
          <p>Every device has a little delay between the game and your ears (speakers, Bluetooth headphones) and between your fingers and the game (keyboards, touchscreens). Two quick tests measure both.</p>
          <ol>
            <li><b>Listen:</b> tap any key or the screen on every click you hear.</li>
            <li><b>Watch:</b> tap on every flash of the circle (no sound).</li>
          </ol>
          <p className="help">Use the same headphones/speakers you play with. Bluetooth audio often needs +150–250 ms.</p>
          <Btn variant="play" icon={<Icon name="play" />} onClick={startAudio}>Start</Btn>
        </>}
        {(step === 'audio' || step === 'visual') && <>
          <h2>{step === 'audio' ? 'Step 1 — Tap to the clicks' : 'Step 2 — Tap to the flashes'}</h2>
          <div className="calib-pulse" style={{ transform: `scale(${1 + (step === 'visual' ? beat : beat * 0.25) * 0.35})`, opacity: step === 'visual' ? 0.25 + beat * 0.75 : 0.5 + beat * 0.3 }}>
            <span>{taps.length}/{TAPS}</span>
          </div>
          <div className="calib-dots">{taps.map((d, i) => <i key={i} style={{ left: `${50 + Math.max(-45, Math.min(45, d * 300))}%` }} />)}</div>
          <p className="help">{step === 'audio' ? 'Close your eyes if it helps — just follow the sound.' : 'Follow the circle with your eyes.'} Any key, click or tap counts.</p>
        </>}
        {step === 'done' && audioRes !== null && visualRes !== null && <>
          <h2>Results</h2>
          <div className="calib-results">
            <div><span>Audio offset</span><b>{Math.round(audioRes - visualRes) > 0 ? '+' : ''}{Math.round(audioRes - visualRes)} ms</b></div>
            <div><span>Input offset</span><b>{Math.round(visualRes) > 0 ? '+' : ''}{Math.round(visualRes)} ms</b></div>
          </div>
          <p className="help">Raw: audio taps {Math.round(audioRes)} ms, visual taps {Math.round(visualRes)} ms (median of {TAPS - 2} taps).</p>
          <div className="row-btns">
            <Btn variant="play" onClick={apply}>Apply</Btn>
            <Btn variant="glass" onClick={() => setStep('intro')}>Try again</Btn>
          </div>
        </>}
      </div>
    </div>
  );
}
