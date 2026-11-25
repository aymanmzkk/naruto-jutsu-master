import { levelStore } from '../../state/levelStore';
import { useStore, useStoreShallow } from '../../state/createStore';
import { getSignCredit, getSignPhoto, signPhotoStore } from '../../state/signPhotos';
import { getTemplate } from '../../gestures/GestureTemplates';
import { SignImage } from './SignImage';
import type { JutsuLevelController } from '../../game/JutsuLevelController';

const STATUS: Record<string, { label: string; cls: string }> = {
  NO_HANDS: { label: 'SHOW YOUR HANDS', cls: 'is-idle' },
  SEARCHING: { label: 'FORM THE SIGN', cls: 'is-search' },
  HOLDING: { label: 'HOLD STILL…', cls: 'is-hold' },
  CONFIRMED: { label: 'SIGN CONFIRMED', cls: 'is-ok' },
  COOLDOWN: { label: 'SIGN CONFIRMED', cls: 'is-ok' },
};

/** Confidence ring: confidence arc, threshold tick and stability (hold) arc. */
function ConfidenceRing({ confidence, threshold, hold }: { confidence: number; threshold: number; hold: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const thA = threshold * 2 * Math.PI - Math.PI / 2;
  const ok = confidence >= threshold;
  return (
    <svg className="ring" viewBox="0 0 90 90" aria-label={`Confidence ${Math.round(confidence * 100)} percent`}>
      <circle cx="45" cy="45" r={r} className="ring__track" />
      <circle cx="45" cy="45" r={r} className={`ring__conf ${ok ? 'is-ok' : ''}`} strokeDasharray={`${c * confidence} ${c}`} transform="rotate(-90 45 45)" />
      <circle cx="45" cy="45" r={r - 9} className="ring__hold" strokeDasharray={`${2 * Math.PI * (r - 9) * hold} ${c}`} transform="rotate(-90 45 45)" />
      <line x1={45 + Math.cos(thA) * (r - 6)} y1={45 + Math.sin(thA) * (r - 6)} x2={45 + Math.cos(thA) * (r + 6)} y2={45 + Math.sin(thA) * (r + 6)} className="ring__th" />
      <text x="45" y="50" textAnchor="middle" className="ring__txt">
        {Math.round(confidence * 100)}%
      </text>
    </svg>
  );
}

export function GestureGuide({ controller }: { controller: JutsuLevelController }) {
  const s = useStoreShallow(levelStore, (st) => ({
    index: st.signIndex,
    total: st.signTotal,
    ids: st.signIds,
    phase: st.signPhase,
    conf: st.confidence,
    th: st.threshold,
    hold: st.holdProgress,
    hint: st.hint,
    wrongId: st.wrongId,
    confirmPulse: st.confirmPulse,
    wrongPulse: st.wrongPulse,
    assisted: st.assisted,
    hands: st.handsVisible,
  }));
  const id = s.ids[Math.min(s.index, s.total - 1)];
  const hasPhoto = useStore(signPhotoStore, (st) => (id ? !!getSignPhoto(st, id) : false));
  const isReference = useStore(signPhotoStore, (st) => (id ? !!getSignCredit(st, id) : false));
  if (!id) return null;
  const t = getTemplate(id);
  const status = s.assisted ? { label: 'ASSISTED MODE', cls: 'is-idle' } : STATUS[s.phase] ?? STATUS.SEARCHING;
  const recentlyConfirmed = performance.now() - s.confirmPulse < 900;
  const recentlyWrong = performance.now() - s.wrongPulse < 1400;
  const wrong = s.wrongId ? getTemplate(s.wrongId) : null;

  return (
    <aside className={`guide panel ${recentlyConfirmed ? 'is-confirmed' : ''} ${recentlyWrong ? 'is-wrong' : ''}`} key={id}>
      <div className="guide__head">
        <span className="guide__step display">
          SIGN {Math.min(s.index + 1, s.total)}/{s.total}
        </span>
        <span className={`guide__status ${status.cls}`}>
          <span className="dot" /> {status.label}
        </span>
      </div>
      <SignImage id={id} className="guide__img" />
      {isReference ? (
        <div className="guide__legend">
          <span>REAL-HAND REFERENCE</span>
          <span>copy the hand shape</span>
        </div>
      ) : hasPhoto ? (
        <div className="guide__legend">
          <span>YOUR PHOTO · MIRROR VIEW</span>
          <span>copy it like a mirror</span>
        </div>
      ) : (
        <div className="guide__legend">
          <span>MIRROR VIEW</span>
          <span>
            <i className="guide__key guide__key--l">L</i> your left
          </span>
          <span>
            <i className="guide__key guide__key--r">R</i> your right
          </span>
        </div>
      )}
      <div className="guide__name">
        <span className="kanji guide__kanji">{t.kanji}</span>
        <div>
          <div className="display guide__title">{t.name.toUpperCase()}</div>
          <div className="guide__jp">{t.japanese}</div>
        </div>
        {!s.assisted && <ConfidenceRing confidence={s.conf} threshold={s.th} hold={s.hold} />}
      </div>
      <p className="guide__desc">{t.description}</p>
      {!s.assisted && wrong && (
        <div className="guide__warn">
          That looks like <b>{wrong.name}</b> — the current sign is <b>{t.name}</b>.
        </div>
      )}
      {!s.assisted && !wrong && s.hint && <div className="guide__hint">↳ {s.hint}</div>}
      {!s.assisted && !wrong && !s.hint && s.hands === 0 && <div className="guide__hint">↳ Raise both hands in front of the camera</div>}
      {s.assisted && (
        <button className="btn btn--small guide__assist" onClick={() => controller.assistedConfirm()}>
          PERFORM SIGN (NO CAMERA)
        </button>
      )}
      {recentlyConfirmed && <div className="guide__burst" />}
    </aside>
  );
}
