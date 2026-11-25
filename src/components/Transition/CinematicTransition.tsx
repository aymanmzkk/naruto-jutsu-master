import { useEffect } from 'react';
import type { LevelDefinition } from '../../game/levels/types';

/** Title card between the menu and a level: ink wipe, kanji stroke, title. */
export function CinematicTransition({ level, onDone }: { level: LevelDefinition; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="transition" role="presentation" onClick={onDone}>
      <div className="transition__wipe" />
      <div className="transition__bars" />
      <div className="transition__content">
        <div className="transition__level display">LEVEL {String(level.id).padStart(2, '0')}</div>
        <div className="transition__kanji kanji">{level.id === 1 ? '火遁・豪火球の術' : level.kanji}</div>
        <h1 className="transition__title display">{level.title}</h1>
        <p className="transition__sub">{level.subtitle}</p>
      </div>
      <div className="transition__embers" />
    </div>
  );
}
