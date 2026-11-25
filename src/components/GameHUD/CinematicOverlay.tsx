import { levelStore } from '../../state/levelStore';
import { useStore } from '../../state/createStore';
import type { JutsuLevelController } from '../../game/JutsuLevelController';
import { IconSkip } from '../Icons';

/** Letterbox bars, subtitles, captions, big centre prompts and the skip button. */
export function CinematicOverlay({ controller }: { controller: JutsuLevelController | null }) {
  const letterbox = useStore(levelStore, (s) => s.letterbox);
  const subtitle = useStore(levelStore, (s) => s.subtitle);
  const caption = useStore(levelStore, (s) => s.caption);
  const center = useStore(levelStore, (s) => s.centerMessage);
  const skippable = useStore(levelStore, (s) => s.skippable);
  const paused = useStore(levelStore, (s) => s.paused);
  return (
    <div className="cine" aria-live="polite">
      <div className={`cine__bar cine__bar--top ${letterbox ? 'is-on' : ''}`} />
      <div className={`cine__bar cine__bar--bottom ${letterbox ? 'is-on' : ''}`} />
      {caption && (
        <div className="cine__caption display" key={caption}>
          {caption}
        </div>
      )}
      {subtitle && (
        <div className="cine__subtitle" key={subtitle.text}>
          <span className="cine__speaker">{subtitle.speaker}</span>
          <span className="cine__text">{subtitle.text}</span>
        </div>
      )}
      {center && (
        <div className="cine__center display" key={center}>
          {center.split('...').map((part, i, arr) => (
            <span key={i} style={{ animationDelay: `${i * 0.6}s` }}>
              {part}
              {i < arr.length - 1 ? '...' : ''}
            </span>
          ))}
        </div>
      )}
      {skippable && controller && !paused && (
        <button className="btn btn--ghost btn--small cine__skip" onClick={() => controller.skip()}>
          SKIP <IconSkip width={14} height={14} />
        </button>
      )}
    </div>
  );
}
