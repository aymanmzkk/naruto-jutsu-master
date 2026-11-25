import { useEffect, useState } from 'react';
import type { LevelDefinition } from '../../game/levels/types';
import type { LevelStats } from '../../state/levelStore';
import { MenuBackground } from '../MainMenu/MenuBackground';
import { IconGrid, IconReplay } from '../Icons';
import { Sound } from '../../audio/SoundEngine';
import { getCompletionArt } from '../../state/completionArt';

/** Optional artwork supplied by the user; otherwise an original illustration is drawn. */
const CUSTOM_ART = `${import.meta.env.BASE_URL}assets/images/level1-completion.png`;

function rank(stats: LevelStats) {
  const total = stats.signsDoneAt && stats.startedAt ? stats.signDurations.reduce((a, b) => a + b, 0) : 0;
  const avgConf = stats.confidences.length ? stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length : 0;
  let score = 100;
  score -= Math.max(0, total - 25) * 1.2;
  score -= stats.wrongCount * 6;
  score += (avgConf - 0.8) * 60;
  return { grade: score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 55 ? 'B' : 'C', total, avgConf };
}

function OriginalIllustration() {
  // Original artwork: a young ninja silhouette performing the final seal before a great fireball.
  return (
    <svg className="done__art" viewBox="0 0 400 480" aria-label="Young ninja releasing a great fireball">
      <defs>
        <radialGradient id="dfire" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="0.2" stopColor="#ffd27a" />
          <stop offset="0.5" stopColor="#ff7a1a" />
          <stop offset="0.8" stopColor="#b3200f" stopOpacity="0.6" />
          <stop offset="1" stopColor="#5e0f10" stopOpacity="0" />
        </radialGradient>
        <filter id="dturb">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="4">
            <animate attributeName="baseFrequency" values="0.018;0.024;0.018" dur="6s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="34" />
        </filter>
        <linearGradient id="dfade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#0b0709" />
        </linearGradient>
      </defs>
      <g filter="url(#dturb)">
        <circle cx="200" cy="190" r="185" fill="url(#dfire)" />
      </g>
      <circle cx="200" cy="190" r="60" fill="#fff4d6" opacity="0.75" />
      <g fill="#0a0405" transform="translate(200 470)">
        {/* body */}
        <path d="M-70 0 C-66 -70 -58 -120 -44 -150 L44 -150 C58 -120 66 -70 70 0Z" />
        {/* shoulders & raised arms forming the seal in front of the mouth */}
        <path d="M-44 -150 C-70 -150 -82 -170 -70 -200 L-30 -232 L-14 -222 L-46 -190 C-50 -176 -46 -164 -36 -160Z" />
        <path d="M44 -150 C70 -150 82 -170 70 -200 L30 -232 L14 -222 L46 -190 C50 -176 46 -164 36 -160Z" />
        <path d="M-16 -224 L-6 -262 L6 -262 L16 -224 L4 -214 L-4 -214Z" />
        {/* head */}
        <ellipse cx="0" cy="-292" rx="32" ry="36" />
        <path d="M-34 -300 L-50 -322 L-28 -316 L-36 -346 L-12 -326 L-4 -356 L8 -328 L30 -348 L24 -318 L48 -324 L34 -300Z" />
        <path d="M-22 -180 L22 -180 L18 -150 L-18 -150Z" />
      </g>
      <rect width="400" height="480" fill="url(#dfade)" />
    </svg>
  );
}

export function CompletionScreen({ level, stats, onReplay, onMenu }: { level: LevelDefinition; stats: LevelStats; onReplay: () => void; onMenu: () => void }) {
  const [custom, setCustom] = useState(false);
  const [rendered] = useState(getCompletionArt);
  useEffect(() => {
    fetch(CUSTOM_ART, { method: 'HEAD' })
      .then((r) => setCustom(r.ok && (r.headers.get('content-type') ?? '').startsWith('image')))
      .catch(() => setCustom(false));
    Sound.sequenceComplete();
    void Sound.playMusic('menu');
  }, []);
  const r = rank(stats);
  const avgSign = stats.signDurations.length ? r.total / stats.signDurations.length : 0;
  return (
    <main className="screen done screen-enter">
      <MenuBackground />
      <div className="done__fire" aria-hidden />
      <div className="done__grid">
        <div className="done__visual">
          {custom ? (
            <img className="done__art done__art--img" src={CUSTOM_ART} alt="Level completion artwork" />
          ) : rendered ? (
            <div className="done__art done__art--shot">
              <img src={rendered} alt="The young ninja releasing the Great Fireball over the lake" />
              <div className="done__art-caption kanji">豪火球</div>
            </div>
          ) : (
            <OriginalIllustration />
          )}
          <div className="done__stamp kanji" aria-label="Completed">
            完
          </div>
        </div>
        <section className="done__content">
          <div className="done__level display">LEVEL {String(level.id).padStart(2, '0')} · CLEARED</div>
          <h1 className="done__title display">JUTSU COMPLETED</h1>
          <div className="done__kanji kanji">火遁・豪火球の術</div>
          <h2 className="done__sub">Katon: Gōkakyū no Jutsu</h2>
          <div className="done__stats">
            <div className="done__rank">
              <span className="display">RANK</span>
              <b className="display">{r.grade}</b>
            </div>
            <dl>
              <div>
                <dt>Signs performed</dt>
                <dd>{stats.signDurations.length} / 6</dd>
              </div>
              <div>
                <dt>Sequence time</dt>
                <dd>{r.total.toFixed(1)} s</dd>
              </div>
              <div>
                <dt>Average per sign</dt>
                <dd>{avgSign.toFixed(1)} s</dd>
              </div>
              <div>
                <dt>Avg. confidence</dt>
                <dd>{Math.round(r.avgConf * 100)}%</dd>
              </div>
              <div>
                <dt>Wrong signs</dt>
                <dd>{stats.wrongCount}</dd>
              </div>
              <div>
                <dt>Breath power</dt>
                <dd>{Math.round(stats.blowPeak * 100)}%</dd>
              </div>
            </dl>
          </div>
          <div className="done__progress">
            <span className="display">TRAINING PROGRESS</span>
            <div className="done__pips">
              {Array.from({ length: 10 }).map((_, i) => (
                <i key={i} className={i === 0 ? 'on' : ''} />
              ))}
            </div>
            <span>1 / 10</span>
          </div>
          <div className="done__actions">
            <button className="btn btn--primary" onClick={onReplay}>
              <IconReplay width={18} height={18} /> REPLAY LEVEL
            </button>
            <button className="btn" onClick={onMenu}>
              <IconGrid width={18} height={18} /> LEVEL SELECTION
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
