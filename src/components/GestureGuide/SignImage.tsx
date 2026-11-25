import { getTemplate } from '../../gestures/GestureTemplates';
import { getSignCredit, getSignPhoto, signPhotoStore } from '../../state/signPhotos';
import { useStore } from '../../state/createStore';
import { SignIllustration } from './SignIllustration';

/**
 * Reference picture of a sign. Priority: the player's own photo (NUI LAB),
 * then the bundled real-hand reference image (with its licence credit),
 * then the generated drawing.
 */
export function SignImage({ id, className = '', labels = true, credit = true }: { id: string; className?: string; labels?: boolean; credit?: boolean }) {
  const t = getTemplate(id);
  const src = useStore(signPhotoStore, (s) => getSignPhoto(s, id));
  const cr = useStore(signPhotoStore, (s) => getSignCredit(s, id));
  const lineArt = !!src && src.toLowerCase().endsWith('.svg');
  return (
    <div className={`sign-image ${src ? 'has-photo' : ''} ${lineArt ? 'is-lineart' : ''} ${className}`}>
      {src ? (
        <img className="sign-image__photo" src={src} alt={`Hands performing the ${t.name} sign`} draggable={false} />
      ) : (
        <>
          <span className="sign-image__kanji kanji" aria-hidden>
            {t.kanji}
          </span>
          <SignIllustration id={id} labels={labels} />
        </>
      )}
      {credit && cr && (
        <a className="sign-image__credit" href={cr.source} target="_blank" rel="noreferrer" title={`${cr.title} by ${cr.author}, ${cr.license} (Wikimedia Commons)`}>
          {cr.author} · {cr.license}
        </a>
      )}
    </div>
  );
}
