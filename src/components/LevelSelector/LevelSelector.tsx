import type { CSSProperties, MouseEvent } from 'react';
import { LEVELS } from '../../game/levels/registry';
import type { LevelDefinition } from '../../game/levels/types';
import { LevelArtwork } from './LevelArtwork';
import { IconLock, IconPlay } from '../Icons';
import { Sound } from '../../audio/SoundEngine';

function LevelCard({ level, onPlay, index }: { level: LevelDefinition; onPlay: (id: number) => void; index: number }) {
  const locked = level.locked;
  const tilt = (e: MouseEvent<HTMLElement>) => {
    if (locked) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.setProperty('--rx', `${-y * 8}deg`);
    e.currentTarget.style.setProperty('--ry', `${x * 10}deg`);
    e.currentTarget.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
    e.currentTarget.style.setProperty('--my', `${(y + 0.5) * 100}%`);
  };
  const reset = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  };
  return (
    <article
      className={`level-card ${locked ? 'is-locked' : 'is-open'}`}
      style={{ '--i': index } as CSSProperties}
      onMouseMove={tilt}
      onMouseLeave={reset}
      onMouseEnter={() => !locked && Sound.hover()}
      onClick={() => !locked && onPlay(level.id)}
      aria-disabled={locked}
    >
      <div className="level-card__art">
        <LevelArtwork element={level.element} seed={level.id * 7} hero={level.id === 1} />
        <div className="level-card__shine" />
      </div>
      <div className="level-card__num display">{String(level.id).padStart(2, '0')}</div>
      <div className="level-card__kanji kanji">{level.kanji}</div>
      <div className="level-card__body">
        <h3 className="level-card__title">{level.title}</h3>
        <p className="level-card__sub">{level.subtitle}</p>
        <div className="level-card__meta">
          <span className="level-card__pips" aria-label={`Difficulty ${level.difficulty} of 5`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <i key={i} className={i < level.difficulty ? 'on' : ''} />
            ))}
          </span>
          <span>{level.signCount} signs</span>
        </div>
        {!locked ? (
          <button
            className="btn btn--primary btn--small level-card__play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(level.id);
            }}
          >
            <IconPlay width={16} height={16} /> PLAY
          </button>
        ) : (
          <div className="level-card__soon">COMING SOON</div>
        )}
      </div>
      {locked && (
        <div className="level-card__lock" aria-label="Locked">
          <IconLock />
        </div>
      )}
    </article>
  );
}

export function LevelSelector({ onPlay }: { onPlay: (id: number) => void }) {
  return (
    <section className="level-grid" aria-label="Level selection">
      {LEVELS.map((l, i) => (
        <LevelCard key={l.id} level={l} onPlay={onPlay} index={i} />
      ))}
    </section>
  );
}
