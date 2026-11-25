import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { AudioDetectionControls, RecognitionControls, SoundControls } from './SettingsControls';
import { resetSettings, settingsStore, updateSettings } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';
import level1 from '../../game/levels/Level1/config';
import { getPickedVideo, setPickedVideo } from '../../state/videoPick';

type Tab = 'video' | 'recognition' | 'sound';

async function videoExists(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('video');
  } catch {
    return false;
  }
}

function TimeField({ label, value, fallback, onChange, onNow, allowEmpty }: { label: string; value: number | null; fallback: number | null; onChange: (v: number | null) => void; onNow: () => void; allowEmpty?: boolean }) {
  return (
    <div className="time-field">
      <label>
        <span className="ctl__label">{label}</span>
        <input
          type="number"
          step="0.01"
          min={0}
          value={value ?? ''}
          placeholder={fallback === null ? (allowEmpty ? 'auto' : '') : fallback.toFixed(2)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      </label>
      <button className="btn btn--ghost btn--small" onClick={onNow} title="Use the preview's current time">
        ⟵ NOW
      </button>
    </div>
  );
}

function VideoTab() {
  const v = useStore(settingsStore, (s) => s.video);
  const [exists, setExists] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<File | null>(getPickedVideo());
  const [now, setNow] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const cfg = level1.video;

  useEffect(() => {
    videoExists(cfg.src).then(setExists);
  }, [cfg.src]);

  useEffect(() => {
    if (picked) {
      const u = URL.createObjectURL(picked);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(exists ? cfg.src : null);
  }, [picked, exists, cfg.src]);

  const setV = (p: Partial<typeof v>) => updateSettings('video', p);
  const cur = () => Math.round((ref.current?.currentTime ?? 0) * 100) / 100;
  const focusX = v.focusX ?? cfg.focus.x;
  const focusY = v.focusY ?? cfg.focus.y;

  const pickFocus = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setV({ focusX: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, focusY: Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000 });
  };

  return (
    <div className="video-tab">
      <div className="video-tab__status">
        <span className={`dot ${picked || exists ? 'dot--ok' : 'dot--warn'}`} />
        {picked ? (
          <span>
            Using selected file: <b>{picked.name}</b>
          </span>
        ) : exists === null ? (
          <span>Checking public/assets/videos/level1.mp4…</span>
        ) : exists ? (
          <span>
            Found <b>public/assets/videos/level1.mp4</b>
          </span>
        ) : (
          <span>No video found — Level 1 will use the original 3D cinematic. Add <b>public/assets/videos/level1.mp4</b> or pick a file.</span>
        )}
      </div>
      <div className="video-tab__pick">
        <label className="btn btn--small">
          CHOOSE LOCAL MP4…
          <input
            type="file"
            accept="video/mp4,video/webm,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPickedVideo(f);
              setPicked(f);
            }}
          />
        </label>
        {picked && (
          <button
            className="btn btn--ghost btn--small"
            onClick={() => {
              setPickedVideo(null);
              setPicked(null);
            }}
          >
            CLEAR
          </button>
        )}
      </div>
      {url && (
        <>
          <div className="video-tab__preview" onClick={pickFocus} title="Click the character to set the zoom focus">
            <video ref={ref} src={url} controls={false} onTimeUpdate={() => setNow(ref.current?.currentTime ?? 0)} />
            <span className="video-tab__focus" style={{ left: `${focusX * 100}%`, top: `${focusY * 100}%` }} />
          </div>
          <div className="video-tab__scrub">
            <button className="btn btn--ghost btn--small" onClick={() => (ref.current!.paused ? ref.current!.play() : ref.current!.pause())}>
              PLAY / PAUSE
            </button>
            <input
              type="range"
              min={0}
              max={ref.current?.duration || 1}
              step={0.01}
              value={now}
              onChange={(e) => {
                if (ref.current) ref.current.currentTime = Number(e.target.value);
              }}
            />
            <span className="ctl__value">{now.toFixed(2)}s</span>
          </div>
          <p className="ctl__help">Click the frame where the character is to set the zoom focus (crosshair).</p>
        </>
      )}
      <div className="video-tab__fields">
        <TimeField label="Intro starts at (s)" value={v.introStart} fallback={cfg.introStart} onChange={(x) => setV({ introStart: x })} onNow={() => setV({ introStart: cur() })} />
        <TimeField label="Pause for gameplay at (s)" value={v.pauseAt} fallback={cfg.pauseAt} onChange={(x) => setV({ pauseAt: x })} onNow={() => setV({ pauseAt: cur() })} />
        <TimeField label="Resume at (s) — empty = exact pause point" value={v.resumeAt} fallback={cfg.resumeAt} allowEmpty onChange={(x) => setV({ resumeAt: x })} onNow={() => setV({ resumeAt: cur() })} />
        <TimeField label="Ending stops at (s) — empty = end of file" value={v.endAt} fallback={cfg.endAt} allowEmpty onChange={(x) => setV({ endAt: x })} onNow={() => setV({ endAt: cur() })} />
      </div>
      <button className="btn btn--ghost btn--small" onClick={() => resetSettings('video')}>
        RESET TO CONFIG DEFAULTS
      </button>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('video');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings__head">
          <h2 className="display">SETTINGS</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tabs" role="tablist">
          {(['video', 'recognition', 'sound'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
              {t === 'video' ? 'VIDEO' : t === 'recognition' ? 'RECOGNITION' : 'SOUND'}
            </button>
          ))}
        </div>
        {tab === 'video' && <VideoTab />}
        {tab === 'recognition' && (
          <>
            <RecognitionControls />
            <div className="panel-title" style={{ margin: '18px 0 10px' }}>
              BLOW DETECTION
            </div>
            <AudioDetectionControls />
          </>
        )}
        {tab === 'sound' && <SoundControls />}
      </div>
    </div>
  );
}
