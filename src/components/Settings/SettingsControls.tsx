import type { ReactNode } from 'react';
import { resetSettings, settingsStore, updateSettings, type Settings } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';

/** Shared tuning controls — used by both Settings and the NUI LAB (same store). */

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v.toFixed(2),
  help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  help?: string;
}) {
  return (
    <label className="ctl" title={help}>
      <span className="ctl__row">
        <span className="ctl__label">{label}</span>
        <span className="ctl__value">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {help && <span className="ctl__help">{help}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: ReactNode }) {
  return (
    <div className="ctl ctl--toggle">
      <span className="ctl__row">
        <span className="ctl__label">{label}</span>
        <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
      </span>
      {help && <span className="ctl__help">{help}</span>}
    </div>
  );
}

export function RecognitionControls({ compact = false }: { compact?: boolean }) {
  const r = useStore(settingsStore, (s) => s.recognition);
  const set = (p: Partial<Settings['recognition']>) => updateSettings('recognition', p);
  return (
    <div className="ctl-group">
      <Slider label="Confidence threshold offset" value={r.thresholdOffset} min={-0.2} max={0.2} step={0.01} onChange={(v) => set({ thresholdOffset: v })} format={(v) => (v >= 0 ? '+' : '') + v.toFixed(2)} help={compact ? undefined : 'Added to every sign threshold. Negative = easier.'} />
      <Slider label="Stability time ×" value={r.holdMultiplier} min={0.3} max={2.5} step={0.05} onChange={(v) => set({ holdMultiplier: v })} help={compact ? undefined : 'How long a sign must be held before it counts.'} />
      <Slider label="Tolerance" value={r.tolerance} min={0.5} max={2} step={0.05} onChange={(v) => set({ tolerance: v })} help={compact ? undefined : 'Softness of all finger/angle checks (hand shape differences).'} />
      <Slider label="Distance tolerance ×" value={r.distanceTolerance} min={0.6} max={2} step={0.05} onChange={(v) => set({ distanceTolerance: v })} help={compact ? undefined : 'Scales how close the hands must be.'} />
      <Slider label="Extended if curl <" value={r.extendedMax} min={0.15} max={0.5} step={0.01} onChange={(v) => set({ extendedMax: Math.min(v, r.bentMin - 0.05) })} />
      <Slider label="Bent if curl >" value={r.bentMin} min={0.4} max={0.85} step={0.01} onChange={(v) => set({ bentMin: Math.max(v, r.extendedMax + 0.05) })} />
      <Slider label="Smoothing (min cutoff Hz)" value={r.smoothingMinCutoff} min={0.3} max={5} step={0.1} onChange={(v) => set({ smoothingMinCutoff: v })} format={(v) => v.toFixed(1)} help={compact ? undefined : 'Lower = smoother but more latency (One Euro filter).'} />
      <Slider label="Smoothing speed β" value={r.smoothingBeta} min={0} max={0.2} step={0.005} onChange={(v) => set({ smoothingBeta: v })} format={(v) => v.toFixed(3)} />
      <Slider label="Cooldown (ms)" value={r.cooldownMs} min={100} max={1500} step={50} onChange={(v) => set({ cooldownMs: v })} format={(v) => v.toFixed(0)} />
      <Toggle label="Swap left / right hands" checked={r.swapHandedness} onChange={(v) => set({ swapHandedness: v })} help={compact ? undefined : 'Only if the lab shows your right hand as LEFT.'} />
      <button className="btn btn--ghost btn--small" onClick={() => resetSettings('recognition')}>
        RESET RECOGNITION
      </button>
    </div>
  );
}

export function AudioDetectionControls() {
  const a = useStore(settingsStore, (s) => s.audio);
  const set = (p: Partial<Settings['audio']>) => updateSettings('audio', p);
  return (
    <div className="ctl-group">
      <Slider label="Blow threshold (dBFS)" value={a.blowThresholdDb} min={-60} max={-10} step={1} onChange={(v) => set({ blowThresholdDb: v })} format={(v) => v.toFixed(0)} />
      <Slider label="Margin over noise floor (dB)" value={a.blowMarginDb} min={4} max={30} step={1} onChange={(v) => set({ blowMarginDb: v })} format={(v) => v.toFixed(0)} />
      <Slider label="Minimum duration (ms)" value={a.blowMinDurationMs} min={100} max={1200} step={20} onChange={(v) => set({ blowMinDurationMs: v })} format={(v) => v.toFixed(0)} />
      <Slider label="Minimum noise-likeness (flatness)" value={a.blowMinFlatness} min={0.02} max={0.6} step={0.01} onChange={(v) => set({ blowMinFlatness: v })} />
      <button className="btn btn--ghost btn--small" onClick={() => resetSettings('audio')}>
        RESET AUDIO
      </button>
    </div>
  );
}

export function SoundControls() {
  const d = useStore(settingsStore, (s) => s.debug);
  return (
    <div className="ctl-group">
      <Slider label="Music" value={d.musicVolume} min={0} max={1} step={0.05} onChange={(v) => updateSettings('debug', { musicVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Effects" value={d.sfxVolume} min={0} max={1} step={0.05} onChange={(v) => updateSettings('debug', { sfxVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
      <Toggle label="Mute everything" checked={d.muted} onChange={(v) => updateSettings('debug', { muted: v })} />
    </div>
  );
}
