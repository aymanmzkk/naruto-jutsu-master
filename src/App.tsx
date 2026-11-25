import { useCallback, useEffect, useState } from 'react';
import { MainMenu } from './components/MainMenu/MainMenu';
import { LevelPlayer } from './components/LevelPlayer/LevelPlayer';
import { NUILab } from './components/NUILab/NUILab';
import { CompletionScreen } from './components/Completion/CompletionScreen';
import { CinematicTransition } from './components/Transition/CinematicTransition';
import { Sound } from './audio/SoundEngine';
import { getLevel } from './game/levels/registry';
import { levelStore, type LevelStats } from './state/levelStore';
import { getPickedVideo } from './state/videoPick';
import { discoverSignFiles } from './state/signPhotos';
import { GESTURE_TEMPLATES } from './gestures/GestureTemplates';

type Screen =
  | { name: 'menu' }
  | { name: 'transition'; levelId: number }
  | { name: 'level'; levelId: number; run: number }
  | { name: 'complete'; levelId: number; stats: LevelStats }
  | { name: 'lab' };


export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });

  useEffect(() => {
    void discoverSignFiles(Object.keys(GESTURE_TEMPLATES));
  }, []);

  // Browsers only allow audio after a user gesture.
  useEffect(() => {
    const unlock = () => {
      Sound.unlock();
      if (screenRef.name === 'menu') void Sound.playMusic('menu');
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    screenRef = screen;
    if (screen.name === 'menu' || screen.name === 'lab') void Sound.playMusic('menu');
  }, [screen]);

  const openLevel = useCallback((id: number) => {
    Sound.taiko();
    Sound.whoosh(1.2, 0.5);
    Sound.stopMusic(1500);
    setScreen({ name: 'transition', levelId: id });
  }, []);

  const level = 'levelId' in screen ? getLevel(screen.levelId) : undefined;

  return (
    <>
      {screen.name === 'menu' && <MainMenu onPlay={openLevel} onLab={() => setScreen({ name: 'lab' })} />}
      {screen.name === 'lab' && <NUILab onExit={() => setScreen({ name: 'menu' })} />}
      {screen.name === 'transition' && level && (
        <CinematicTransition level={level} onDone={() => setScreen({ name: 'level', levelId: level.id, run: Date.now() })} />
      )}
      {screen.name === 'level' && level && (
        <LevelPlayer
          key={screen.run}
          level={level}
          videoFile={getPickedVideo()}
          onExit={() => setScreen({ name: 'menu' })}
          onRestart={() => setScreen({ name: 'level', levelId: level.id, run: Date.now() })}
          onComplete={() => setScreen({ name: 'complete', levelId: level.id, stats: levelStore.get().stats })}
        />
      )}
      {screen.name === 'complete' && level && (
        <CompletionScreen
          level={level}
          stats={screen.stats}
          onReplay={() => setScreen({ name: 'level', levelId: level.id, run: Date.now() })}
          onMenu={() => setScreen({ name: 'menu' })}
        />
      )}
    </>
  );
}

let screenRef: Screen = { name: 'menu' };
