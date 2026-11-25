import { useState } from 'react';
import type { JutsuLevelController } from '../../game/JutsuLevelController';
import { getHandTracker } from '../../gestures/HandTracker';
import { getMicrophone } from '../../audio/MicrophoneManager';
import { useStore } from '../../state/createStore';
import { IconCamera, IconMic } from '../Icons';
import { DeviceHelp } from '../DeviceHelp/DeviceHelp';

/** "Chakra sensors": asks for webcam + microphone, explains why, handles errors. */
export function PermissionPanel({ controller }: { controller: JutsuLevelController }) {
  const tracker = getHandTracker();
  const t = useStore(tracker.state, (s) => s);
  const mic = useStore(getMicrophone().state, (s) => s.status);
  const [busy, setBusy] = useState(false);
  const loading = busy || t.status === 'requesting-camera' || t.status === 'loading-model';

  return (
    <div className="perm">
      <div className="perm__card panel">
        <div className="perm__kanji kanji">気</div>
        <h2 className="display">AWAKEN YOUR CHAKRA SENSORS</h2>
        <p className="perm__lead">
          You are now the young ninja on the dock. Your real hands control his hands: the webcam tracks 21 points on each hand, and the microphone hears your breath.
        </p>
        <ul className="perm__list">
          <li>
            <IconCamera />
            <div>
              <b>Camera</b>
              <span>Hand tracking runs locally in your browser (MediaPipe). No video leaves your computer.</span>
            </div>
            <span className={`dot ${t.status === 'running' ? 'dot--ok' : t.status === 'error' ? 'dot--bad' : loading ? 'dot--warn dot--pulse' : ''}`} />
          </li>
          <li>
            <IconMic />
            <div>
              <b>Microphone</b>
              <span>Used only at the end: blow to release the fire. Optional — a button replaces it if unavailable.</span>
            </div>
            <span className={`dot ${mic === 'running' ? 'dot--ok' : mic === 'error' ? 'dot--bad' : mic === 'requesting' ? 'dot--warn dot--pulse' : ''}`} />
          </li>
        </ul>
        {t.status === 'error' && <div className="perm__error">{t.errorMessage}</div>}
        {(t.status === 'error' || mic === 'error') && <DeviceHelp device={t.status === 'error' ? 'camera' : 'microphone'} />}
        <div className="perm__actions">
          <button
            className="btn btn--primary"
            disabled={loading}
            onClick={async () => {
              setBusy(true);
              await controller.enableSensors();
              setBusy(false);
            }}
          >
            {t.status === 'loading-model' ? 'LOADING HAND MODEL…' : loading ? 'WAITING FOR PERMISSION…' : t.status === 'error' ? 'RETRY' : 'ENABLE CAMERA & MICROPHONE'}
          </button>
          {t.status === 'error' && (
            <button className="btn btn--ghost btn--small" onClick={() => controller.useAssistedMode()}>
              CONTINUE WITHOUT CAMERA (ASSISTED MODE)
            </button>
          )}
        </div>
        <p className="perm__tip">Tip: sit about an arm's length from the webcam, with good light in front of you and both hands visible.</p>
      </div>
    </div>
  );
}
