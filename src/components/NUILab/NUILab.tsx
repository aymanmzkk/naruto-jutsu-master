import { useEffect, useMemo, useRef, useState } from 'react';
import { getHandTracker } from '../../gestures/HandTracker';
import { getMicrophone } from '../../audio/MicrophoneManager';
import { GESTURE_TEMPLATES, getTemplate } from '../../gestures/GestureTemplates';
import { FreeGestureRecognizer, GestureSequence, type SequenceEvent } from '../../gestures/GestureSequence';
import { matchTemplate, type TemplateMatch } from '../../gestures/GestureRecognizer';
import type { GestureSnapshot } from '../../gestures/GestureStateMachine';
import { FINGERS, type HandAnalysis, type TrackingFrame } from '../../gestures/types';
import { settingsStore, updateSettings } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';
import { WebcamPreview } from '../WebcamPreview/WebcamPreview';
import { VirtualHandsViewport } from '../VirtualHands/VirtualHandsViewport';
import { AudioDetectionControls, RecognitionControls, Toggle } from '../Settings/SettingsControls';
import { SignImage } from '../GestureGuide/SignImage';
import { ReferencePhotos } from './ReferencePhotos';
import { IconExit } from '../Icons';
import { DeviceHelp } from '../DeviceHelp/DeviceHelp';
import { Sound } from '../../audio/SoundEngine';

const FIREBALL = ['snake', 'ram', 'monkey', 'boar', 'horse', 'tiger'];
const TEMPLATES = Object.values(GESTURE_TEMPLATES);

interface LabSnapshot {
  frame: TrackingFrame | null;
  free: GestureSnapshot | null;
  freeMatches: Map<string, TemplateMatch> | null;
  seq: { index: number; total: number; complete: boolean; snapshot: GestureSnapshot | null };
}

/** Runs the real engine on every tracker frame; publishes to React at ~15 Hz. */
function useLabEngine(active: boolean) {
  const tracker = getHandTracker();
  const free = useMemo(() => new FreeGestureRecognizer(TEMPLATES), []);
  const seq = useMemo(() => new GestureSequence(FIREBALL), []);
  const [snap, setSnap] = useState<LabSnapshot>({ frame: null, free: null, freeMatches: null, seq: { index: 0, total: 6, complete: false, snapshot: null } });
  const [log, setLog] = useState<string[]>([]);
  const last = useRef(0);

  useEffect(() => {
    if (!active) return;
    return tracker.onFrame((frame) => {
      const f = free.update(frame);
      const s = seq.update(frame);
      const events = [...f.events.map((e) => ({ ...e, src: 'free' })), ...s.events.map((e) => ({ ...e, src: 'seq' }))];
      const lines: string[] = [];
      for (const e of events as (SequenceEvent & { src: string })[]) {
        const time = new Date().toLocaleTimeString();
        if (e.type === 'confirmed' && e.src === 'free') lines.push(`${time}  ✔ recognised ${getTemplate(e.id).name} (${Math.round(e.confidence * 100)}%)`);
        if (e.type === 'advanced') {
          lines.push(`${time}  ➜ sequence step ${e.index + 1}/6 done: ${getTemplate(e.id).name}`);
          Sound.signConfirm(e.index);
        }
        if (e.type === 'wrong') {
          lines.push(`${time}  ✖ wrong sign ${getTemplate(e.id).name}, expected ${getTemplate(e.expected).name}`);
          Sound.wrong();
        }
        if (e.type === 'completed') {
          lines.push(`${time}  ★ GREAT FIREBALL SEQUENCE COMPLETE`);
          Sound.sequenceComplete();
        }
        if (e.type === 'hands-lost' && e.src === 'free') lines.push(`${time}  · hands lost`);
        if (e.type === 'hands-found' && e.src === 'free') lines.push(`${time}  · hands found`);
      }
      if (lines.length) setLog((l) => [...lines.reverse(), ...l].slice(0, 40));
      const now = performance.now();
      if (now - last.current > 66) {
        last.current = now;
        setSnap({ frame, free: f.snapshot, freeMatches: f.matches, seq: { index: s.index, total: s.total, complete: s.complete, snapshot: s.snapshot } });
      }
    });
  }, [active, tracker, free, seq]);

  return { snap, log, seq, setLog };
}

function FingerTable({ hand, label }: { hand: HandAnalysis | null; label: 'LEFT' | 'RIGHT' }) {
  return (
    <div className="ft">
      <div className="ft__head">
        <span className={`ft__side ft__side--${label.toLowerCase()}`}>{label} HAND</span>
        {hand ? (
          <span className="ft__meta">
            dir {hand.angleFromUp.toFixed(0)}° · palm {hand.palmSize.toFixed(3)} · {(hand.score * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="ft__meta">not detected</span>
        )}
      </div>
      {FINGERS.map((f) => {
        const fa = hand?.fingers[f];
        return (
          <div key={f} className={`ft__row ${fa ? `is-${fa.state}` : 'is-none'}`}>
            <span className="ft__name">{f}</span>
            <span className="ft__bar">
              <i style={{ width: `${(fa?.curl ?? 0) * 100}%` }} />
            </span>
            <span className="ft__state">{fa ? fa.state.toUpperCase() : '—'}</span>
            <span className="ft__angles">{fa ? `${fa.angles.mcp.toFixed(0)}° ${fa.angles.pip.toFixed(0)}° ${fa.angles.dip.toFixed(0)}°` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function AudioPanel() {
  const mic = getMicrophone();
  const st = useStore(mic.state, (s) => s);
  const b = st.blow;
  const toPct = (db: number) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
  return (
    <section className="lab-card panel">
      <div className="lab-card__head">
        <div className="panel-title">AUDIO · BLOW DETECTION</div>
        {st.status === 'running' ? (
          <button className="btn btn--ghost btn--small" onClick={() => mic.stop()}>
            STOP MIC
          </button>
        ) : (
          <button className="btn btn--small" onClick={() => mic.start()}>
            START MIC
          </button>
        )}
      </div>
      {st.error && (
        <>
          <div className="perm__error">{st.error}</div>
          <DeviceHelp device="microphone" />
        </>
      )}
      <div className="db-meter" aria-label={`Level ${b.db.toFixed(0)} dBFS`}>
        <div className="db-meter__fill" style={{ width: `${toPct(b.db)}%` }} />
        <div className="db-meter__mark db-meter__mark--floor" style={{ left: `${toPct(b.noiseFloorDb)}%` }} title="noise floor" />
        <div className="db-meter__mark db-meter__mark--th" style={{ left: `${toPct(b.thresholdDb)}%` }} title="threshold" />
      </div>
      <div className="lab-kv">
        <span>Level</span>
        <b>{b.db.toFixed(1)} dBFS</b>
        <span>Noise floor</span>
        <b>{b.noiseFloorDb.toFixed(1)} dB</b>
        <span>Trigger at</span>
        <b>{b.thresholdDb.toFixed(1)} dB</b>
        <span>Spectral flatness</span>
        <b>{b.flatness.toFixed(2)}</b>
        <span>Low-freq ratio</span>
        <b>{b.lowRatio.toFixed(2)}</b>
        <span>Sustain</span>
        <b>{Math.round(b.sustain * 100)}%</b>
      </div>
      <div className={`blow-flag ${b.blowing ? 'is-on' : ''}`}>{b.blowing ? '🔥 BLOWING DETECTED' : 'NO BLOW'}</div>
      <div className="lab-kv">
        <span>Valid blows</span>
        <b>{st.blowCount}</b>
      </div>
      <button className="btn btn--ghost btn--small" onClick={() => mic.detector.rearm()}>
        RE-ARM DETECTOR
      </button>
    </section>
  );
}

export function NUILab({ onExit }: { onExit: () => void }) {
  const tracker = getHandTracker();
  const ts = useStore(tracker.state, (s) => s);
  const running = ts.status === 'running';
  const { snap, log, seq, setLog } = useLabEngine(running);
  const debug = useStore(settingsStore, (s) => s.debug);
  const rec = useStore(settingsStore, (s) => s.recognition);
  const [testId, setTestId] = useState('tiger');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    return () => {
      tracker.stop();
      getMicrophone().stop();
    };
  }, [tracker]);

  const frame = snap.frame;
  const free = snap.free;
  const testMatch = frame ? matchTemplate(getTemplate(testId), frame.left, frame.right, rec) : null;
  const best = free?.candidateId && free.phase !== 'SEARCHING' ? free.candidateId : free?.bestId;

  return (
    <main className="screen lab screen-enter">
      <header className="lab__header">
        <div>
          <h1 className="display">
            NUI LAB <span className="kanji">研究所</span>
          </h1>
          <p>Natural User Interface laboratory · the same tracking, recognition and audio engine used by the game.</p>
        </div>
        <button className="btn btn--ghost" onClick={onExit}>
          <IconExit width={18} height={18} /> BACK TO MENU
        </button>
      </header>

      <div className="lab__grid">
        {/* ---------- Vision column ---------- */}
        <section className="lab__vision">
          <div className="lab-card panel lab-cam">
            <div className="lab-card__head">
              <div className="panel-title">COMPUTER VISION · MEDIAPIPE HAND LANDMARKER</div>
              {running ? (
                <button className="btn btn--ghost btn--small" onClick={() => tracker.stop()}>
                  STOP TRACKING
                </button>
              ) : (
                <button className="btn btn--primary btn--small" onClick={() => tracker.start()} disabled={ts.status === 'loading-model' || ts.status === 'requesting-camera'}>
                  {ts.status === 'loading-model' ? 'LOADING MODEL…' : ts.status === 'requesting-camera' ? 'WAITING…' : 'START TRACKING'}
                </button>
              )}
            </div>
            {ts.error && (
              <>
                <div className="perm__error">{ts.errorMessage}</div>
                <DeviceHelp device="camera" />
              </>
            )}
            <WebcamPreview className="webcam--lab" labels scale={1.2} />
            <div className="lab-stats">
              <span>
                <span className={`dot ${running ? 'dot--ok' : ''}`} /> {ts.status.toUpperCase()}
              </span>
              <span>{ts.fps} FPS</span>
              <span>{ts.inferenceMs} ms / frame</span>
              <span>{ts.delegate ?? '—'} delegate</span>
              <span>model: {ts.modelSource ?? '—'}</span>
              <span>{frame?.hands.length ?? 0} / 2 hands · 21 landmarks each</span>
            </div>
            <div className="lab-toggles">
              <Toggle label="Landmarks" checked={debug.showLandmarks} onChange={(v) => updateSettings('debug', { showLandmarks: v })} />
              <Toggle label="Connections" checked={debug.showConnections} onChange={(v) => updateSettings('debug', { showConnections: v })} />
            </div>
          </div>

          <div className="lab-card panel">
            <div className="lab-card__head">
              <div className="panel-title">NATURAL MOVEMENT · RIGGED 3D HANDS</div>
              <Toggle label={`Preview "${getTemplate(testId).name}" pose`} checked={preview} onChange={setPreview} />
            </div>
            <VirtualHandsViewport previewPose={preview ? getTemplate(testId).illustration : null} />
            <p className="lab-note">16-bone skinned hands. Wrist orientation and every finger joint are retargeted from the 21 world landmarks each frame (One Euro filter + damped slerp).</p>
          </div>

          <div className="lab-card panel">
            <div className="panel-title">FINGER STATES · JOINT ANGLES (MCP · PIP · DIP)</div>
            <div className="ft-grid">
              <FingerTable hand={frame?.left ?? null} label="LEFT" />
              <FingerTable hand={frame?.right ?? null} label="RIGHT" />
            </div>
          </div>
        </section>

        {/* ---------- Recognition column ---------- */}
        <section className="lab__reco">
          <ReferencePhotos />
          <div className="lab-card panel">
            <div className="panel-title">LIVE GESTURE RECOGNITION</div>
            <div className="live">
              {best ? <SignImage id={best} className="live__img" /> : <div className="live__img live__img--empty kanji">?</div>}
              <div className="live__info">
                <div className="display live__name">{best ? getTemplate(best).name.toUpperCase() : 'NO SIGN'}</div>
                <div className={`live__state is-${(free?.phase ?? 'NO_HANDS').toLowerCase()}`}>
                  {free?.phase === 'HOLDING' ? 'EVALUATING — HOLD STILL' : free?.phase === 'COOLDOWN' || free?.phase === 'CONFIRMED' ? 'STABLE · CONFIRMED' : free?.phase === 'NO_HANDS' ? 'NO HANDS' : 'SEARCHING'}
                </div>
                <div className="live__conf">{best && free ? `${Math.round((free.confidences[best] ?? 0) * 100)}% confidence` : '—'}</div>
                <div className="live__hold">
                  <i style={{ width: `${(free?.holdProgress ?? 0) * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="conf-list">
              {TEMPLATES.map((t) => {
                const c = free?.confidences[t.id] ?? 0;
                const th = Math.min(0.98, Math.max(0.3, t.threshold + rec.thresholdOffset));
                return (
                  <button key={t.id} className={`conf-row ${c >= th ? 'is-ok' : ''} ${testId === t.id ? 'is-sel' : ''}`} onClick={() => setTestId(t.id)}>
                    <span className="kanji">{t.kanji}</span>
                    <span className="conf-row__name">{t.name}</span>
                    <span className="conf-row__bar">
                      <i style={{ width: `${c * 100}%` }} />
                      <em style={{ left: `${th * 100}%` }} />
                    </span>
                    <span className="conf-row__val">{Math.round(c * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lab-card panel">
            <div className="lab-card__head">
              <div className="panel-title">TEMPLATE TESTER</div>
              <select value={testId} onChange={(e) => setTestId(e.target.value)} className="lab-select">
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.kanji} {t.name} ({t.japanese})
                  </option>
                ))}
              </select>
            </div>
            <div className="tester">
              <SignImage id={testId} className="tester__img" />
              <div>
                <p className="tester__desc">{getTemplate(testId).description}</p>
                <div className="lab-kv">
                  <span>Threshold</span>
                  <b>{Math.round(getTemplate(testId).threshold * 100)}%</b>
                  <span>Stable for</span>
                  <b>{Math.round(getTemplate(testId).holdMs * rec.holdMultiplier)} ms</b>
                  <span>Confidence now</span>
                  <b>{testMatch ? `${Math.round(testMatch.confidence * 100)}%` : '—'}</b>
                </div>
              </div>
            </div>
            <div className="features">
              {testMatch?.features.map((f) => (
                <div key={f.label} className={`feature ${f.score > 0.8 ? 'is-ok' : f.score > 0.4 ? 'is-mid' : 'is-bad'}`}>
                  <span className="feature__label">{f.label}</span>
                  <span className="feature__bar">
                    <i style={{ width: `${f.score * 100}%` }} />
                  </span>
                  <span className="feature__w">×{f.weight}</span>
                </div>
              ))}
              {testMatch?.weakest && testMatch.confidence < getTemplate(testId).threshold && <div className="guide__hint">↳ {testMatch.weakest.hint}</div>}
              {!testMatch && <p className="lab-note">Start tracking to evaluate this template live.</p>}
            </div>
          </div>

          <div className="lab-card panel">
            <div className="lab-card__head">
              <div className="panel-title">SEQUENCE · GREAT FIREBALL (6 SIGNS)</div>
              <button
                className="btn btn--ghost btn--small"
                onClick={() => {
                  seq.reset();
                  setLog([]);
                }}
              >
                RESET
              </button>
            </div>
            <div className="lab-seq">
              {FIREBALL.map((id, i) => (
                <button key={id} className={`lab-seq__item ${i < snap.seq.index ? 'is-done' : i === snap.seq.index && !snap.seq.complete ? 'is-current' : ''}`} onClick={() => seq.goTo(i)} title="Jump to this step">
                  <SignImage id={id} className="lab-seq__img" labels={false} />
                  <span className="kanji">{getTemplate(id).kanji}</span>
                  <small>{getTemplate(id).name}</small>
                </button>
              ))}
            </div>
            <div className="lab-kv">
              <span>Step</span>
              <b>{snap.seq.complete ? 'COMPLETE ★' : `${snap.seq.index + 1} / 6 — ${getTemplate(FIREBALL[Math.min(5, snap.seq.index)]).name}`}</b>
              <span>Target confidence</span>
              <b>{snap.seq.snapshot ? `${Math.round(snap.seq.snapshot.confidence * 100)}%` : '—'}</b>
              <span>State</span>
              <b>{snap.seq.snapshot?.phase ?? '—'}</b>
              <span>Hint</span>
              <b>{snap.seq.snapshot?.hint ?? (snap.seq.snapshot?.wrongId ? `wrong: ${getTemplate(snap.seq.snapshot.wrongId).name}` : '—')}</b>
            </div>
            <ol className="lab-log">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Audio + controls column ---------- */}
        <section className="lab__ctl">
          <AudioPanel />
          <div className="lab-card panel">
            <div className="panel-title">RECOGNITION THRESHOLDS</div>
            <RecognitionControls compact />
          </div>
          <div className="lab-card panel">
            <div className="panel-title">BLOW DETECTION THRESHOLDS</div>
            <AudioDetectionControls />
          </div>
        </section>
      </div>
    </main>
  );
}
