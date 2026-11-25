import { useId, useMemo } from 'react';
import { drawHands } from '../../gestures/illustration/HandDrawing';
import { getTemplate } from '../../gestures/GestureTemplates';

/** Mixes two hex colours. */
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const SKIN_NEAR = '#f6cdb0';
const SKIN_FAR = '#d19776';
const OUTLINE = '#3b2116';
const SLEEVE = '#1d2133';
const CUFF = { Left: '#4fc3ff', Right: '#ff8a3c' } as const;

/**
 * SVG instruction drawing of a hand sign (mirror view: your left hand is on
 * the left). Generated from the sign template's reference pose.
 */
export function SignIllustration({ id, labels = true }: { id: string; labels?: boolean }) {
  const t = getTemplate(id);
  const uid = useId().replace(/:/g, '');
  const drawing = useMemo(() => drawHands(t.illustration, t.view), [t]);
  const [vx, vy, vw, vh] = drawing.viewBox;
  const u = drawing.unit;

  return (
    <svg className="sign-svg" viewBox={`${vx} ${vy} ${vw} ${vh}`} role="img" aria-label={`${t.name} hand sign`}>
      <defs>
        <linearGradient id={`sk${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#5a2a14" stopOpacity="0.16" />
        </linearGradient>
        <filter id={`sh${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy={u * 0.8} stdDeviation={u * 1.2} floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>
      <g filter={`url(#sh${uid})`}>
        {drawing.layers.map((l, i) => {
          const fill =
            l.kind === 'sleeve' ? mix(SLEEVE, '#0b0c14', l.shade * 0.5) : l.kind === 'cuff' ? CUFF[l.side] : mix(SKIN_NEAR, SKIN_FAR, l.shade * 0.85);
          return (
            <g key={i}>
              {/* outline pass (union of all shapes of the layer) */}
              {l.shapes.map((d, k) => (
                <path key={`o${k}`} d={d} fill={OUTLINE} stroke={OUTLINE} strokeWidth={u * 1.9} strokeLinejoin="round" />
              ))}
              {/* fill pass */}
              {l.shapes.map((d, k) => (
                <path key={`f${k}`} d={d} fill={fill} />
              ))}
              {l.kind === 'skin' && l.shapes.map((d, k) => <path key={`g${k}`} d={d} fill={`url(#sk${uid})`} />)}
              {l.details.map((dl, k) =>
                dl.fill === 'nail' ? (
                  <path
                    key={`d${k}`}
                    d={dl.d}
                    transform={dl.transform}
                    fill="#fbe3d6"
                    stroke={OUTLINE}
                    strokeOpacity={0.55}
                    strokeWidth={u * dl.width * 0.7}
                    opacity={dl.opacity}
                  />
                ) : (
                  <path key={`d${k}`} d={dl.d} transform={dl.transform} fill="none" stroke={OUTLINE} strokeWidth={u * dl.width} strokeLinecap="round" opacity={dl.opacity} />
                ),
              )}
            </g>
          );
        })}
      </g>
      {labels &&
        drawing.labels.map((lb) => (
          <g key={lb.side} transform={`translate(${lb.x} ${lb.y})`}>
            <circle r={u * 4.2} fill={CUFF[lb.side]} stroke="#120a08" strokeWidth={u * 0.8} />
            <text y={u * 1.6} textAnchor="middle" fontSize={u * 4.6} fontWeight={700} fontFamily="Rajdhani, sans-serif" fill="#120a08">
              {lb.side === 'Left' ? 'L' : 'R'}
            </text>
          </g>
        ))}
    </svg>
  );
}
