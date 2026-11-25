import { useEffect, useRef, useState } from 'react';
import { getHandTracker } from '../../gestures/HandTracker';
import { GESTURE_TEMPLATES, getTemplate } from '../../gestures/GestureTemplates';
import { matchTemplate } from '../../gestures/GestureRecognizer';
import { computeHandCrop, fileToSquarePhoto, renderCrop } from '../../gestures/illustration/photoCapture';
import { getSignPhoto, removeSignPhoto, saveSignPhoto, signPhotoStore } from '../../state/signPhotos';
import { settingsStore } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';
import { SignImage } from '../GestureGuide/SignImage';
import { WebcamPreview } from '../WebcamPreview/WebcamPreview';
import { Sound } from '../../audio/SoundEngine';

const IDS = Object.keys(GESTURE_TEMPLATES);

/**
 * REFERENCE PHOTOS — the player photographs their own hands performing each
 * sign (webcam, 3-second countdown, automatic crop around the detected hands,
 * mirrored like the guide). The game guide then shows these real photos.
 */
export function ReferencePhotos() {
  const tracker = getHandTracker();
  const running = useStore(tracker.state, (s) => s.status === 'running');
  const photos = useStore(signPhotoStore, (s) => s);
  const [countdown, setCountdown] = useState<{ id: string; n: number } | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const capture = (id: string) => {
    const v = tracker.video;
    if (!v.videoWidth) {
      setMsg({ text: 'The webcam is not ready yet.', ok: false });
      return;
    }
    const f = tracker.latest;
    const hands = f?.hands ?? [];
    const crop = computeHandCrop(hands, v.videoWidth, v.videoHeight);
    const persisted = saveSignPhoto(id, renderCrop(v, crop));
    const t = getTemplate(id);
    const conf = f ? matchTemplate(t, f.left, f.right, settingsStore.get().recognition).confidence : 0;
    Sound.signConfirm(IDS.indexOf(id));
    const good = conf >= t.threshold;
    setMsg({
      ok: good,
      text:
        `${t.name} photo saved` +
        (hands.length ? ` — recognised at ${Math.round(conf * 100)}%` : ' — no hands detected, whole frame used') +
        (good ? '.' : '. The sign did not match well: you can capture it again.') +
        (persisted ? '' : ' (Browser storage is full: kept for this session only.)'),
    });
  };

  useEffect(() => {
    if (!countdown) return;
    if (countdown.n === 0) {
      capture(countdown.id);
      setCountdown(null);
      return;
    }
    Sound.click();
    const timer = setTimeout(() => setCountdown({ ...countdown, n: countdown.n - 1 }), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const start = (id: string) => {
    if (!running) {
      setMsg({ text: 'Press START TRACKING (webcam panel) first, then capture.', ok: false });
      return;
    }
    setMsg(null);
    setCountdown({ id, n: 3 });
  };

  const upload = async (id: string, file: File | undefined) => {
    if (!file) return;
    try {
      const data = await fileToSquarePhoto(file);
      const persisted = saveSignPhoto(id, data);
      setMsg({ ok: true, text: `${getTemplate(id).name} picture uploaded.${persisted ? '' : ' (Browser storage is full: kept for this session only.)'}` });
    } catch {
      setMsg({ ok: false, text: 'That file is not an image the browser can read.' });
    }
  };

  return (
    <section className="lab-card panel refphotos">
      <div className="panel-title">REFERENCE PHOTOS · YOUR OWN HANDS</div>
      <p className="lab-note">
        Photograph your hands doing each sign. Press <b>CAPTURE</b>, form the sign during the 3-second countdown, and the photo is cropped around your hands
        automatically. The in-game guide then shows your photos instead of the drawings.
      </p>
      {msg && <div className={`refphotos__msg ${msg.ok ? 'is-ok' : 'is-warn'}`}>{msg.text}</div>}
      <div className="refphotos__grid">
        {IDS.map((id) => {
          const t = getTemplate(id);
          const own = !!photos.photos[id];
          const has = !!getSignPhoto(photos, id);
          return (
            <div key={id} className="refphotos__item">
              <SignImage id={id} labels={false} className="refphotos__img" />
              <div className="refphotos__name">
                <span className="kanji">{t.kanji}</span> {t.name}
                <small>{own ? 'your photo' : photos.credits[id] && has ? 'reference' : has ? 'image file' : 'drawing'}</small>
              </div>
              <div className="refphotos__btns">
                <button className="btn btn--small btn--primary" onClick={() => start(id)} disabled={!!countdown}>
                  CAPTURE
                </button>
                <button className="btn btn--small btn--ghost" onClick={() => fileInputs.current[id]?.click()}>
                  UPLOAD
                </button>
                {own && (
                  <button className="btn btn--small btn--ghost" onClick={() => removeSignPhoto(id)} title="Remove your photo">
                    ✕
                  </button>
                )}
                <input
                  ref={(el) => {
                    fileInputs.current[id] = el;
                  }}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    void upload(id, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {countdown && (
        <div className="refphotos__overlay" role="dialog" aria-label="Capturing reference photo">
          <div className="refphotos__panel panel">
            <div className="refphotos__ov-head">
              <div>
                <div className="display refphotos__ov-title">FORM THE {getTemplate(countdown.id).name.toUpperCase()} SIGN</div>
                <div className="lab-note">{getTemplate(countdown.id).description}</div>
              </div>
              <div className="refphotos__count display" key={countdown.n}>
                {countdown.n}
              </div>
            </div>
            <div className="refphotos__ov-body">
              <WebcamPreview className="webcam--lab" />
              <SignImage id={countdown.id} className="refphotos__ov-ref" />
            </div>
            <button className="btn btn--ghost btn--small" onClick={() => setCountdown(null)}>
              CANCEL
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
