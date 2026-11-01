import { useEffect, useState } from 'react';
import { nav } from '../nav';
import {
  useSettings, updateSettings, resetSettings, bindKey, keyLabel, KEY_PRESETS, type KeyAction, type Settings, type NoteSkin,
} from '../../store/settings';
import { Btn, Icon, ScreenHeader, Segmented, Slider, Toggle } from '../components/common';
import { toggleFullscreen, fullscreenSupported } from '../App';
import { getProfile, resetProfile, updateProfile, useProfile } from '../../store/profile';
import { skinUnlocked, MILESTONES } from '../../game/achievements';
import { playSfx } from '../../audio/sfx';
import { toast } from '../components/toasts';

const TABS = ['audio', 'gameplay', 'controls', 'graphics', 'accessibility', 'data'] as const;
type Tab = (typeof TABS)[number];

export function SettingsScreen({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initial ?? '') ? (initial as Tab) : 'audio');
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  return (
    <div className="settings">
      <ScreenHeader title="Settings" subtitle="Saved automatically" onBack={() => nav.back()}
        right={<Btn variant="glass" sfx="uiBack" onClick={() => { if (confirm('Reset all settings to defaults?')) resetSettings(); }}>Reset</Btn>} />
      <div className="settings-layout">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'active' : ''} onClick={() => { playSfx('uiMove', 0.4); setTab(t); }}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="settings-body glass">
          {tab === 'audio' && <>
            <h3>Volume</h3>
            <Slider label="Music" value={s.musicVolume} min={0} max={1} onChange={(v) => set({ musicVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Sound effects" value={s.sfxVolume} min={0} max={1} onChange={(v) => { set({ sfxVolume: v }); playSfx('tap', 0.6); }} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="Hit sounds" hint="Subtle click on every hit" value={s.hitSounds} onChange={(v) => set({ hitSounds: v })} />
            <h3>Timing</h3>
            <Slider label="Audio offset" value={s.audioOffsetMs} min={-200} max={300} step={1} onChange={(v) => set({ audioOffsetMs: v })} format={(v) => `${v > 0 ? '+' : ''}${v} ms`} />
            <Slider label="Input offset" value={s.inputOffsetMs} min={-150} max={250} step={1} onChange={(v) => set({ inputOffsetMs: v })} format={(v) => `${v > 0 ? '+' : ''}${v} ms`} />
            <p className="help">Audio offset: raise it if notes reach the line <i>before</i> you hear them (e.g. Bluetooth headphones). Input offset: raise it if your hits register late. Use the calibration tool for exact values.</p>
            <Btn variant="primary" icon={<Icon name="sliders" />} onClick={() => nav.go({ name: 'calibrate', back: { name: 'settings', tab: 'audio' } })}>Calibrate latency</Btn>
          </>}

          {tab === 'gameplay' && <>
            <h3>Notes</h3>
            <Slider label="Note speed" value={s.noteSpeed} min={1} max={10} step={0.5} onChange={(v) => set({ noteSpeed: v })} format={(v) => v.toFixed(1)} />
            <Segmented label="Swipe input" value={s.swipeMode} onChange={(v) => set({ swipeMode: v })} options={[
              { value: 'chord', label: 'Lane + direction' }, { value: 'direction', label: 'Direction key only' }, { value: 'lane', label: 'Lane only (easy)' },
            ]} />
            <p className="help">Keyboard swipes: press the note’s lane key and its direction key together (within 160 ms, either order). Touch: press the lane and flick in the arrow’s direction.</p>
            <h3>HUD</h3>
            <Toggle label="Show judgements" value={s.showJudgments} onChange={(v) => set({ showJudgments: v })} />
            <Toggle label="Show early / late" hint="Timing error in ms under each judgement" value={s.showEarlyLate} onChange={(v) => set({ showEarlyLate: v })} />
            <Toggle label="Show accuracy" value={s.showAccuracy} onChange={(v) => set({ showAccuracy: v })} />
            <Toggle label="Show FPS" value={s.showFps} onChange={(v) => set({ showFps: v })} />
            <h3>Practice mode</h3>
            <Slider label="Playback speed" value={s.practiceSpeed} min={0.5} max={1} step={0.05} onChange={(v) => set({ practiceSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
            <Segmented label="Start at" value={s.practiceStartStage} onChange={(v) => set({ practiceStartStage: v })} options={[0, 1, 2, 3, 4].map((i) => ({ value: i, label: `Stage ${i + 1}` }))} />
            <p className="help">Practice never fails, can be slowed down (pitch drops with speed) and started from any stage. Practice runs give half XP and only count as a personal best when you make no misses.</p>
            <Segmented label="Default mode" value={s.defaultMode} onChange={(v) => set({ defaultMode: v })} options={[{ value: 'classic', label: 'Classic' }, { value: 'practice', label: 'Practice' }]} />
          </>}

          {tab === 'controls' && <ControlsTab s={s} />}

          {tab === 'graphics' && <>
            <h3>Display</h3>
            {fullscreenSupported() ? <Btn variant="glass" icon={<Icon name="fullscreen" />} onClick={() => toggleFullscreen()}>Toggle fullscreen</Btn>
              : <p className="help">Fullscreen: on iPhone use Share → “Add to Home Screen” to play FUNKSTARS full-screen as an app.</p>}
            <Segmented label="Graphics quality" value={s.quality} onChange={(v) => set({ quality: v })} options={[
              { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' },
            ]} />
            <p className="help">Auto adapts render resolution and particle count to keep the frame rate smooth.</p>
            <Slider label="Particle intensity" value={s.particles} min={0} max={1.5} step={0.05} onChange={(v) => set({ particles: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Screen shake" value={s.screenShake} min={0} max={1} step={0.05} onChange={(v) => set({ screenShake: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Background dim" value={s.bgDim} min={0} max={0.8} step={0.05} onChange={(v) => set({ bgDim: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="Lane flash" value={s.laneFlash} onChange={(v) => set({ laneFlash: v })} />
            <h3>Note skin</h3>
            <SkinPicker value={s.noteSkin} onChange={(v) => set({ noteSkin: v })} />
          </>}

          {tab === 'accessibility' && <>
            <h3>Motion</h3>
            <Toggle label="Reduced motion" hint="Calmer backgrounds, no shake, no flashes" value={s.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
            <h3>Colour</h3>
            <Segmented label="Lane colours" value={s.colorMode} onChange={(v) => set({ colorMode: v })} options={[
              { value: 'theme', label: 'Song theme' }, { value: 'classic', label: 'Classic' }, { value: 'deuteranopia', label: 'Deuteranopia' },
              { value: 'protanopia', label: 'Protanopia' }, { value: 'tritanopia', label: 'Tritanopia' }, { value: 'highContrast', label: 'High contrast' },
            ]} />
            <p className="help">Swipe notes always carry a white arrow and hold notes a trail, so note types never rely on colour alone. Flash effects are capped well below photosensitivity limits.</p>
          </>}

          {tab === 'data' && <DataTab />}
        </div>
      </div>
    </div>
  );
}

function SkinPicker({ value, onChange }: { value: NoteSkin; onChange: (v: NoteSkin) => void }) {
  useProfile();
  const skins: NoteSkin[] = ['neon', 'crystal', 'ring', 'pixel', 'gold'];
  return (
    <div className="skins">
      {skins.map((k) => {
        const ok = skinUnlocked(k);
        const m = MILESTONES.find((x) => x.skin === k)!;
        return (
          <button key={k} className={`skin ${value === k ? 'active' : ''} skin-${k}`} disabled={!ok} onClick={() => onChange(k)}>
            <span className="skin-preview" />
            <b>{m.name}</b>
            <small>{ok ? 'Unlocked' : `Level ${m.level}`}</small>
          </button>
        );
      })}
    </div>
  );
}

const ACTIONS: { a: KeyAction; label: string }[] = [
  { a: 'lane0', label: 'Left lane' }, { a: 'lane1', label: 'Middle lane' }, { a: 'lane2', label: 'Right lane' },
  { a: 'up', label: 'Swipe up' }, { a: 'down', label: 'Swipe down' }, { a: 'left', label: 'Swipe left' }, { a: 'right', label: 'Swipe right' },
  { a: 'pause', label: 'Pause' }, { a: 'restart', label: 'Restart (paused)' },
];

function ControlsTab({ s }: { s: Settings }) {
  const [capture, setCapture] = useState<{ a: KeyAction; slot: number } | null>(null);
  const [pads, setPads] = useState(0);
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape' && capture.a !== 'pause') { setCapture(null); return; }
      bindKey(capture.a, capture.slot, e.code);
      playSfx('uiSelect', 0.5);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capture]);
  useEffect(() => {
    const upd = () => setPads((navigator.getGamepads?.() ?? []).filter(Boolean).length);
    upd();
    window.addEventListener('gamepadconnected', upd);
    window.addEventListener('gamepaddisconnected', upd);
    return () => { window.removeEventListener('gamepadconnected', upd); window.removeEventListener('gamepaddisconnected', upd); };
  }, []);
  return (
    <div data-capture-keys>
      <h3>Keyboard</h3>
      <div className="presets">
        {Object.entries(KEY_PRESETS).map(([k, p]) => (
          <Btn key={k} variant="glass" onClick={() => updateSettings({ keys: p.keys })}>{p.label}</Btn>
        ))}
      </div>
      <div className="keymap">
        {ACTIONS.map(({ a, label }) => (
          <div key={a} className="keyrow">
            <span>{label}</span>
            {[0, 1, 2].map((slot) => {
              const active = capture?.a === a && capture.slot === slot;
              return (
                <button key={slot} className={`keycap ${active ? 'capturing' : ''} ${s.keys[a][slot] ? '' : 'empty'}`} onClick={() => setCapture({ a, slot })}
                  onContextMenu={(e) => { e.preventDefault(); const list = s.keys[a].filter((_, i) => i !== slot); updateSettings({ keys: { ...s.keys, [a]: list } }); }}>
                  {active ? 'Press a key…' : keyLabel(s.keys[a][slot])}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="help">Click a slot and press any key. Assigning a key removes it from other actions, so bindings can never conflict. Right-click a slot to clear it. Key-repeat is ignored and every key is tracked separately, so chords and multiple keys per lane work.</p>
      <h3>Other inputs</h3>
      <Toggle label="Mouse controls" hint="Click a lane to tap, hold to hold, drag to swipe" value={s.mouseControls} onChange={(v) => updateSettings({ mouseControls: v })} />
      <Toggle label="Touch controls" hint="Multi-touch lanes with flick swipes" value={s.touchControls} onChange={(v) => updateSettings({ touchControls: v })} />
      <Toggle label="Gamepad" hint={pads ? `${pads} controller connected` : 'D-pad / X A B for lanes, Y or right stick for swipes, Start to pause'} value={s.gamepad} onChange={(v) => updateSettings({ gamepad: v })} />
    </div>
  );
}

function DataTab() {
  const s = useSettings();
  const exportSave = () => {
    const data = JSON.stringify({ app: 'funkstars', version: 1, profile: getProfile(), settings: s }, null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `funkstars-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importSave = (f: File) => {
    f.text().then((t) => {
      const d = JSON.parse(t);
      if (d.app !== 'funkstars') throw new Error('Not a FUNKSTARS save file');
      if (d.profile) updateProfile(() => d.profile);
      if (d.settings) updateSettings(d.settings);
      toast({ kind: 'info', icon: '💾', title: 'Save imported', text: 'Profile and settings restored.' });
    }).catch((e) => toast({ kind: 'error', icon: '⚠️', title: 'Import failed', text: String(e.message ?? e) }));
  };
  return (
    <>
      <h3>Profile</h3>
      <label className="text-field">
        <span>Player name</span>
        <input value={s.playerName} maxLength={18} onChange={(e) => updateSettings({ playerName: e.target.value || 'Player' })} />
      </label>
      <h3>Save data</h3>
      <p className="help">Progress, scores and settings save automatically in this browser. Imported songs are stored in IndexedDB on this device.</p>
      <div className="row-btns">
        <Btn variant="glass" icon={<Icon name="download" />} onClick={exportSave}>Export save</Btn>
        <label className="btn btn-glass file-btn"><Icon name="upload" /><span className="btn-label">Import save</span>
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importSave(e.target.files[0])} hidden />
        </label>
        <Btn variant="danger" onClick={() => { if (confirm('Erase all progress, scores and achievements? This cannot be undone.')) resetProfile(); }}>Reset progress</Btn>
      </div>
    </>
  );
}
