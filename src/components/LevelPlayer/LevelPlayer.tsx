import { useEffect, useRef, useState } from 'react';
import { cropTransform, type JutsuLevelConfig, type LevelDefinition } from '../../game/levels/types';
import { JutsuLevelController } from '../../game/JutsuLevelController';
import { levelStore } from '../../state/levelStore';
import { useStore } from '../../state/createStore';
import { GameHUD } from '../GameHUD/GameHUD';
import { CinematicOverlay } from '../GameHUD/CinematicOverlay';
import { PermissionPanel } from '../GameHUD/PermissionPanel';
import { PauseMenu } from '../GameHUD/PauseMenu';

interface Props {
  level: LevelDefinition;
  videoFile: File | null;
  onExit: () => void;
  onRestart: () => void;
  onComplete: () => void;
}

/** Hosts one run of a level: 3D canvas, the shared <video>, overlays and HUD. */
export function LevelPlayer({ level, videoFile, onExit, onRestart, onComplete }: Props) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [config, setConfig] = useState<JutsuLevelConfig | null>(null);
  const [ctrl, setCtrl] = useState<JutsuLevelController | null>(null);
  const videoVisible = useStore(levelStore, (s) => s.videoVisible);
  const phase = useStore(levelStore, (s) => s.phase);
  const paused = useStore(levelStore, (s) => s.paused);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    let alive = true;
    level.load?.().then((m) => alive && setConfig(m.default));
    return () => {
      alive = false;
    };
  }, [level]);

  useEffect(() => {
    if (!config || !canvasHost.current || !videoRef.current) return;
    const c = new JutsuLevelController({
      container: canvasHost.current,
      video: videoRef.current,
      config,
      videoFile,
      onComplete: () => completeRef.current(),
    });
    setCtrl(c);
    void c.run();
    return () => {
      c.dispose();
      setCtrl(null);
    };
  }, [config, videoFile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ctrl) {
        if (levelStore.get().paused) ctrl.resume();
        else ctrl.pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl]);

  return (
    <div className="screen level-screen">
      <div ref={canvasHost} className="level-screen__canvas" />
      <div className="level-screen__videoclip">
        <div className="level-screen__videocrop" style={config ? (cropTransform(config.video.crop) ?? undefined) : undefined}>
          <video ref={videoRef} className={`level-screen__video ${videoVisible ? 'is-visible' : ''}`} playsInline />
        </div>
      </div>
      <CinematicOverlay controller={ctrl} />
      {config && ctrl && <GameHUD controller={ctrl} config={config} onExit={onExit} />}
      {phase === 'permissions' && ctrl && <PermissionPanel controller={ctrl} />}
      {paused && ctrl && <PauseMenu controller={ctrl} onExit={onExit} onRestart={onRestart} />}
      {phase === 'loading' && <div className="level-screen__loading display">PREPARING THE TRAINING GROUND…</div>}
    </div>
  );
}
