import type { JutsuLevelController } from '../../game/JutsuLevelController';
import { settingsStore, updateSettings } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';
import { Toggle } from '../Settings/SettingsControls';
import { IconExit, IconPlay, IconReplay } from '../Icons';

export function PauseMenu({ controller, onExit, onRestart }: { controller: JutsuLevelController; onExit: () => void; onRestart: () => void }) {
  const d = useStore(settingsStore, (s) => s.debug);
  return (
    <div className="modal-backdrop">
      <div className="modal panel pause" role="dialog" aria-label="Paused">
        <div className="pause__kanji kanji">止</div>
        <h2 className="display">PAUSED</h2>
        <div className="pause__actions">
          <button className="btn btn--primary" onClick={() => controller.resume()}>
            <IconPlay width={16} height={16} /> RESUME
          </button>
          <button className="btn" onClick={onRestart}>
            <IconReplay width={16} height={16} /> RESTART LEVEL
          </button>
          <button className="btn btn--ghost" onClick={onExit}>
            <IconExit width={16} height={16} /> EXIT TO LEVEL SELECT
          </button>
        </div>
        <div className="pause__opts">
          <Toggle label="Show hand landmarks" checked={d.showLandmarks} onChange={(v) => updateSettings('debug', { showLandmarks: v, showConnections: v })} />
          <Toggle label="Recognition debug overlay" checked={d.showDebugOverlay} onChange={(v) => updateSettings('debug', { showDebugOverlay: v })} />
          <Toggle label="Mute" checked={d.muted} onChange={(v) => updateSettings('debug', { muted: v })} />
        </div>
      </div>
    </div>
  );
}
