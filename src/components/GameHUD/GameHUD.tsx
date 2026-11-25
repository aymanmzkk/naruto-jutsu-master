import { levelStore } from '../../state/levelStore';
import { settingsStore } from '../../state/settingsStore';
import { useStore, useStoreShallow } from '../../state/createStore';
import { getHandTracker } from '../../gestures/HandTracker';
import { getMicrophone } from '../../audio/MicrophoneManager';
import { getTemplate } from '../../gestures/GestureTemplates';
import type { JutsuLevelController } from '../../game/JutsuLevelController';
import type { JutsuLevelConfig } from '../../game/levels/types';
import { GestureGuide } from '../GestureGuide/GestureGuide';
import { WebcamPreview } from '../WebcamPreview/WebcamPreview';
import { IconCamera, IconExit, IconFlame, IconMic, IconPause } from '../Icons';

const GAMEPLAY = new Set(['permissions', 'signs', 'charge', 'fireball']);

function SensorStatus() {
  const t = useStoreShallow(getHandTracker().state, (s) => ({ status: s.status, hands: s.handsVisible, fps: s.fps, delegate: s.delegate }));
  const mic = useStore(getMicrophone().state, (s) => s.status);
  const assisted = useStore(levelStore, (s) => s.assisted);
  const camLabel = assisted
    ? 'NO CAMERA · ASSISTED'
    : t.status === 'running'
      ? `CAMERA LIVE · ${t.hands} HAND${t.hands === 1 ? '' : 'S'} · ${t.fps} FPS`
      : t.status === 'loading-model'
        ? 'LOADING MODEL'
        : t.status === 'requesting-camera'
          ? 'WAITING PERMISSION'
          : t.status === 'error'
            ? 'CAMERA ERROR'
            : 'CAMERA OFF';
  return (
    <div className="hud-status panel">
      <span className="hud-status__item">
        <IconCamera />
        <span className={`dot ${t.status === 'running' ? (t.hands > 0 ? 'dot--ok' : 'dot--warn') : t.status === 'error' ? 'dot--bad' : 'dot--warn dot--pulse'}`} />
        {camLabel}
      </span>
      <span className="hud-status__item">
        <IconMic />
        <span className={`dot ${mic === 'running' ? 'dot--ok' : mic === 'error' ? 'dot--bad' : ''}`} />
        {mic === 'running' ? 'MIC' : mic === 'error' ? 'NO MIC' : 'MIC OFF'}
      </span>
    </div>
  );
}

function SequenceBar() {
  const ids = useStore(levelStore, (s) => s.signIds);
  const index = useStore(levelStore, (s) => s.signIndex);
  const hold = useStore(levelStore, (s) => s.holdProgress);
  const phase = useStore(levelStore, (s) => s.phase);
  const done = phase !== 'signs' && phase !== 'permissions';
  return (
    <div className="seq panel" aria-label={`Sequence progress ${index} of ${ids.length}`}>
      <div className="seq__track">
        <div className="seq__fill" style={{ width: `${((done ? ids.length : index) / ids.length) * 100}%` }} />
      </div>
      <ol className="seq__list">
        {ids.map((id, i) => {
          const t = getTemplate(id);
          const state = done || i < index ? 'is-done' : i === index ? 'is-current' : '';
          return (
            <li key={id} className={`seq__item ${state}`}>
              <span className="seq__token kanji">
                {t.kanji}
                {i === index && !done && <svg className="seq__hold" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" strokeDasharray={`${113 * hold} 113`} transform="rotate(-90 20 20)" /></svg>}
              </span>
              <span className="seq__label">{t.name}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BlowMeter({ controller }: { controller: JutsuLevelController }) {
  const intensity = useStore(levelStore, (s) => s.blowIntensity);
  const sustain = useStore(levelStore, (s) => s.blowSustain);
  const fallback = useStore(levelStore, (s) => s.showFireFallback);
  const mic = useStore(getMicrophone().state, (s) => s.status);
  return (
    <div className="blow panel">
      <div className="panel-title">BREATH · MICROPHONE</div>
      <div className="blow__meter">
        <div className="blow__fill" style={{ width: `${intensity * 100}%` }} />
        <div className="blow__threshold" style={{ left: '45%' }} />
      </div>
      <div className="blow__sustain">
        <div style={{ width: `${sustain * 100}%` }} />
      </div>
      <div className="blow__label">{mic === 'running' ? (sustain > 0 ? 'KEEP BLOWING…' : 'BLOW INTO THE MICROPHONE') : 'MICROPHONE UNAVAILABLE'}</div>
      {fallback && (
        <button className="btn btn--small" onClick={() => controller.releaseFireManually()}>
          <IconFlame width={14} height={14} /> RELEASE FIRE (NO MICROPHONE)
        </button>
      )}
    </div>
  );
}

function DebugOverlay() {
  const on = useStore(settingsStore, (s) => s.debug.showDebugOverlay);
  const st = useStoreShallow(levelStore, (s) => ({ phase: s.signPhase, best: s.bestId, conf: s.confidence, th: s.threshold, hold: s.holdProgress, hands: s.handsVisible }));
  if (!on) return null;
  return (
    <pre className="hud-debug panel">
      {`state     ${st.phase}
hands     ${st.hands}
best      ${st.best ?? '-'}
target    ${(st.conf * 100).toFixed(0)}% / ${(st.th * 100).toFixed(0)}%
hold      ${(st.hold * 100).toFixed(0)}%`}
    </pre>
  );
}

export function GameHUD({ controller, config, onExit }: { controller: JutsuLevelController; config: JutsuLevelConfig; onExit: () => void }) {
  const phase = useStore(levelStore, (s) => s.phase);
  const assisted = useStore(levelStore, (s) => s.assisted);
  const inGame = GAMEPLAY.has(phase);
  return (
    <div className={`hud ${inGame ? 'is-on' : ''}`}>
      <div className="hud__top-left">
        <div className="hud-title">
          <span className="hud-title__lvl display">LEVEL {String(config.id).padStart(2, '0')}</span>
          <span className="hud-title__name display">{config.title}</span>
          <span className="hud-title__kanji kanji">{config.kanji}</span>
        </div>
      </div>
      <div className="hud__top-right">
        {inGame && <SensorStatus />}
        <button className="icon-btn" aria-label="Pause" onClick={() => controller.pause()}>
          <IconPause />
        </button>
        <button className="icon-btn" aria-label="Exit" onClick={onExit}>
          <IconExit />
        </button>
      </div>
      {inGame && (
        <>
          {!assisted && phase !== 'fireball' && (
            <div className="hud__cam">
              <WebcamPreview className="webcam--hud" />
              <span className="hud__cam-label">YOUR HANDS</span>
            </div>
          )}
          {phase === 'signs' && <GestureGuide controller={controller} />}
          {(phase === 'signs' || phase === 'permissions') && <SequenceBar />}
          {phase === 'charge' && <BlowMeter controller={controller} />}
          <DebugOverlay />
        </>
      )}
    </div>
  );
}
