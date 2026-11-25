import { useId } from 'react';
import type { Element } from '../../game/levels/types';

/**
 * Original procedural SVG artwork for every level card (no external images).
 * Each element has its own palette and motif; level 1 shows a lone young
 * ninja on a dock breathing a great fireball over the lake at sunset.
 */

const PALETTES: Record<Element, [string, string, string]> = {
  fire: ['#2a0705', '#c2310e', '#ffb347'],
  water: ['#020c1c', '#0f4f87', '#7fd3ff'],
  lightning: ['#0b0618', '#4b2a9e', '#cfe4ff'],
  wind: ['#04130f', '#1d7a62', '#c4ffe9'],
  earth: ['#140b05', '#6b4520', '#e3b77c'],
  shadow: ['#08080b', '#3a3a48', '#d0d0e0'],
  yin: ['#0c0410', '#5a1a5e', '#f0b0ff'],
  summon: ['#120808', '#7a2a1a', '#ffd7a0'],
};

export function LevelArtwork({ element, seed, hero = false }: { element: Element; seed: number; hero?: boolean }) {
  const id = useId().replace(/:/g, '');
  const [c0, c1, c2] = PALETTES[element];
  return (
    <svg className="level-art" viewBox="0 0 320 400" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c0} />
          <stop offset="0.62" stopColor={c1} />
          <stop offset="1" stopColor={c0} />
        </linearGradient>
        <radialGradient id={`glow${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff6e0" />
          <stop offset="0.25" stopColor={c2} />
          <stop offset="0.6" stopColor={c1} stopOpacity="0.7" />
          <stop offset="1" stopColor={c1} stopOpacity="0" />
        </radialGradient>
        <filter id={`turb${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed={seed} />
          <feDisplacementMap in="SourceGraphic" scale="26" />
        </filter>
        <filter id={`grain${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed + 3} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.18 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <rect width="320" height="400" fill={`url(#sky${id})`} />
      {element === 'fire' && <FireArt id={id} hero={hero} c1={c1} c2={c2} />}
      {element === 'water' && <WaterArt id={id} c1={c1} c2={c2} />}
      {element === 'lightning' && <LightningArt id={id} c2={c2} />}
      {element === 'wind' && <WindArt c2={c2} />}
      {element === 'earth' && <EarthArt c1={c1} c2={c2} />}
      {element === 'shadow' && <ShadowArt c2={c2} />}
      {element === 'summon' && <SummonArt id={id} c2={c2} />}
      {element === 'yin' && <WindArt c2={c2} />}
      <rect width="320" height="400" filter={`url(#grain${id})`} opacity="0.9" />
      <rect width="320" height="400" fill="url(#vignette)" />
    </svg>
  );
}

function Ninja({ x, y, s = 1, breathing = false }: { x: number; y: number; s?: number; breathing?: boolean }) {
  // Original generic silhouette (hooded young ninja performing a seal)
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#080404">
      <ellipse cx="0" cy="-58" rx="9" ry="10" />
      <path d="M-9 -62 l-6 -6 7 1 -2 -8 7 5 3 -9 3 9 6 -6 -1 8 7 -2 -6 7z" />
      <path d="M-11 -48 h22 l4 30 -4 4 h-22 l-4 -4z" />
      <path d="M-10 -16 l-3 30 h6 l3 -26 h8 l3 26 h6 l-3 -30z" />
      {breathing ? <path d="M-11 -44 l12 -8 4 4 -10 8z M11 -44 l-12 -8 -4 4 10 8z" /> : <path d="M-11 -44 l-6 26 5 1 6 -22z M11 -44 l6 26 -5 1 -6 -22z" />}
    </g>
  );
}

function FireArt({ id, hero, c1, c2 }: { id: string; hero: boolean; c1: string; c2: string }) {
  return (
    <g>
      <circle cx="210" cy="190" r="70" fill={c2} opacity="0.55" />
      <circle cx="210" cy="190" r="46" fill="#ffd9a0" opacity="0.65" />
      <path d="M0 230 L40 200 L80 214 L130 180 L170 206 L220 186 L270 210 L320 192 L320 250 L0 250Z" fill="#3b0d0b" opacity="0.85" />
      <rect y="248" width="320" height="152" fill="#170405" />
      <path d="M0 252 H320" stroke={c2} strokeOpacity="0.5" />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect key={i} x={120 + i * 6} y={252 + i * 9} width={70 - i * 3} height="2" fill={c2} opacity={0.35 - i * 0.03} />
      ))}
      {/* the fireball */}
      <g filter={`url(#turb${id})`}>
        <circle cx={hero ? 150 : 170} cy="150" r={hero ? 92 : 70} fill={`url(#glow${id})`} />
        <path d={`M70 235 Q ${hero ? 100 : 110} 200 ${hero ? 120 : 140} 170`} stroke={c2} strokeWidth="18" strokeLinecap="round" opacity="0.8" />
      </g>
      <circle cx={hero ? 150 : 170} cy="150" r="26" fill="#fffbe8" opacity="0.85" />
      {/* dock + ninja */}
      <path d="M0 300 L120 248 L132 250 L20 320Z" fill="#0a0303" />
      <Ninja x={64} y={262} s={0.95} breathing />
      <g fill={c1} opacity="0.7">
        <circle cx="240" cy="90" r="2" />
        <circle cx="270" cy="130" r="1.5" />
        <circle cx="110" cy="70" r="1.8" />
        <circle cx="220" cy="60" r="1.2" />
      </g>
    </g>
  );
}

function WaterArt({ id, c1, c2 }: { id: string; c1: string; c2: string }) {
  return (
    <g>
      <g filter={`url(#turb${id})`} fill="none" strokeLinecap="round">
        <path d="M40 300 C 60 160 220 220 200 120 C 190 70 120 80 140 130" stroke={c2} strokeWidth="22" opacity="0.8" />
        <path d="M60 320 C 90 200 250 240 240 140" stroke={c1} strokeWidth="14" opacity="0.9" />
      </g>
      {Array.from({ length: 6 }).map((_, i) => (
        <path key={i} d={`M0 ${300 + i * 16} q 40 -14 80 0 t 80 0 t 80 0 t 80 0`} stroke={c2} strokeOpacity={0.5 - i * 0.07} fill="none" strokeWidth="3" />
      ))}
    </g>
  );
}

function LightningArt({ id, c2 }: { id: string; c2: string }) {
  return (
    <g filter={`url(#turb${id})`}>
      <path d="M170 30 L130 170 L175 165 L120 360" stroke={c2} strokeWidth="6" fill="none" />
      <path d="M150 120 L210 180 L180 190 L240 260" stroke={c2} strokeWidth="3" fill="none" opacity="0.7" />
      <circle cx="140" cy="250" r="50" fill={c2} opacity="0.25" />
    </g>
  );
}

function WindArt({ c2 }: { c2: string }) {
  return (
    <g fill="none" stroke={c2} strokeLinecap="round">
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${40 + i * 10} ${120 + i * 50} c 60 -40 160 -40 200 10 c 30 40 -30 70 -60 40`} strokeWidth={6 - i} opacity={0.75 - i * 0.12} />
      ))}
    </g>
  );
}

function EarthArt({ c1, c2 }: { c1: string; c2: string }) {
  return (
    <g>
      {Array.from({ length: 5 }).map((_, i) => (
        <path key={i} d={`M${20 + i * 58} 330 l20 -${120 + (i % 2) * 60} l26 ${10 + i * 4} l12 ${110 + (i % 3) * 30}z`} fill={i % 2 ? c1 : '#2a1a0c'} stroke={c2} strokeOpacity="0.3" />
      ))}
      <rect y="320" width="320" height="80" fill="#0d0703" />
    </g>
  );
}

function ShadowArt({ c2 }: { c2: string }) {
  return (
    <g>
      {[-1, 0, 1].map((i) => (
        <g key={i} opacity={i === 0 ? 1 : 0.45}>
          <Ninja x={160 + i * 70} y={300} s={1.6 - Math.abs(i) * 0.25} />
        </g>
      ))}
      <circle cx="160" cy="140" r="60" fill={c2} opacity="0.12" />
    </g>
  );
}

function SummonArt({ id, c2 }: { id: string; c2: string }) {
  return (
    <g>
      <g filter={`url(#turb${id})`} fill={c2} opacity="0.35">
        <circle cx="120" cy="200" r="60" />
        <circle cx="200" cy="180" r="70" />
        <circle cx="160" cy="250" r="55" />
      </g>
      <rect x="80" y="300" width="160" height="26" rx="12" fill="#e8d6b0" />
      <rect x="70" y="296" width="18" height="34" rx="6" fill="#8a2a1a" />
      <rect x="232" y="296" width="18" height="34" rx="6" fill="#8a2a1a" />
    </g>
  );
}

/** Shared gradient defs (rendered once in the page). */
export function ArtDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.75" />
        </radialGradient>
      </defs>
    </svg>
  );
}
