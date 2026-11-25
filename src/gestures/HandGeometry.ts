import {
  FINGER_CHAINS,
  FINGERS,
  LM,
  type FingerAnalysis,
  type FingerName,
  type FingerState,
  type HandAnalysis,
  type RawHand,
  type Vec2,
  type Vec3,
} from './types';
import { angle2, angle3, clamp, cross3, dist2, dist3, invLerp, norm2, norm3, scale3, sub2, sub3 } from '../utils/math';

/**
 * HAND GEOMETRY
 * Converts 21 raw landmarks into camera-distance-independent features:
 *  - joint flexion angles (from 3D world landmarks, in degrees)
 *  - a continuous curl value per finger (0 straight → 1 fully curled)
 *  - a discrete finger state (extended / partial / bent)
 *  - finger and hand pointing directions, palm normal
 *  - palm size, used to normalise every 2D distance between hands
 */

export interface GeometryParams {
  extendedMax: number;
  bentMin: number;
}

const UP: Vec2 = { x: 0, y: -1 }; // image space: y grows downward

export function fingerStateFromCurl(curl: number, p: GeometryParams): FingerState {
  if (curl <= p.extendedMax) return 'extended';
  if (curl >= p.bentMin) return 'bent';
  return 'partial';
}

/** Curl of one of the four long fingers, combining joint angles and a distance ratio. */
function longFingerCurl(w: Vec3[], chain: readonly number[]) {
  const [mcp, pip, dip, tip] = chain;
  const wrist = w[LM.WRIST];
  const mcpAngle = angle3(sub3(w[mcp], wrist), sub3(w[pip], w[mcp]));
  const pipAngle = angle3(sub3(w[pip], w[mcp]), sub3(w[dip], w[pip]));
  const dipAngle = angle3(sub3(w[dip], w[pip]), sub3(w[tip], w[dip]));

  // Angle based curl: a straight finger sums ≈ 0–30°, a closed fist ≈ 200°+.
  const angleCurl = clamp((mcpAngle * 0.6 + pipAngle + dipAngle - 28) / 175);

  // Distance ratio: an extended fingertip is much farther from the wrist than its PIP joint.
  const ratio = dist3(w[tip], wrist) / Math.max(1e-6, dist3(w[pip], wrist));
  const distCurl = invLerp(1.42, 0.95, ratio);

  return {
    curl: clamp(angleCurl * 0.65 + distCurl * 0.35),
    angles: { mcp: mcpAngle, pip: pipAngle, dip: dipAngle },
  };
}

/** The thumb moves very differently: combine its bend with how far its tip is from the palm. */
function thumbCurl(w: Vec3[], palmSize3D: number) {
  const [cmc, mcp, ip, tip] = FINGER_CHAINS.thumb;
  const cmcAngle = angle3(sub3(w[cmc], w[LM.WRIST]), sub3(w[mcp], w[cmc]));
  const mcpAngle = angle3(sub3(w[mcp], w[cmc]), sub3(w[ip], w[mcp]));
  const ipAngle = angle3(sub3(w[ip], w[mcp]), sub3(w[tip], w[ip]));
  const bendCurl = clamp((mcpAngle + ipAngle - 25) / 110);

  // Folded thumbs rest close to the index/middle knuckles or the palm centre.
  const palmCenter = scale3(
    {
      x: w[LM.WRIST].x + w[LM.INDEX_MCP].x + w[LM.MIDDLE_MCP].x + w[LM.PINKY_MCP].x,
      y: w[LM.WRIST].y + w[LM.INDEX_MCP].y + w[LM.MIDDLE_MCP].y + w[LM.PINKY_MCP].y,
      z: w[LM.WRIST].z + w[LM.INDEX_MCP].z + w[LM.MIDDLE_MCP].z + w[LM.PINKY_MCP].z,
    },
    0.25,
  );
  const tipToPalm = Math.min(dist3(w[tip], w[LM.MIDDLE_MCP]), dist3(w[tip], palmCenter)) / palmSize3D;
  const tipToIndexMcp = dist3(w[tip], w[LM.INDEX_MCP]) / palmSize3D;
  const distCurl = invLerp(0.95, 0.6, Math.min(tipToPalm, tipToIndexMcp * 1.1));

  return {
    curl: clamp(bendCurl * 0.4 + distCurl * 0.6),
    angles: { mcp: cmcAngle, pip: mcpAngle, dip: ipAngle },
  };
}

/**
 * Converts normalized image landmarks to an aspect-corrected 2D space where
 * one unit horizontally equals one unit vertically (x scaled by width/height).
 */
export function toAspectSpace(landmarks: Vec3[], aspect: number): Vec2[] {
  return landmarks.map((p) => ({ x: p.x * aspect, y: p.y }));
}

/** Robust apparent palm size (survives foreshortening when the hand rotates). */
export function palmSize2D(p: Vec2[]): number {
  const a = dist2(p[LM.WRIST], p[LM.MIDDLE_MCP]);
  const b = dist2(p[LM.INDEX_MCP], p[LM.PINKY_MCP]) * 1.45;
  const c = dist2(p[LM.WRIST], p[LM.INDEX_MCP]) * 1.05;
  const d = dist2(p[LM.WRIST], p[LM.PINKY_MCP]) * 1.15;
  return Math.max(a, b, c, d, 1e-4);
}

export function analyzeHand(raw: RawHand, aspect: number, params: GeometryParams): HandAnalysis {
  const w = raw.world;
  const p2 = toAspectSpace(raw.landmarks, aspect);
  const palmSize3D = Math.max(dist3(w[LM.WRIST], w[LM.MIDDLE_MCP]), 1e-4);

  const fingers = {} as Record<FingerName, FingerAnalysis>;
  for (const name of FINGERS) {
    const chain = FINGER_CHAINS[name];
    const { curl, angles } = name === 'thumb' ? thumbCurl(w, palmSize3D) : longFingerCurl(w, chain);
    const base = name === 'thumb' ? p2[chain[1]] : p2[chain[0]];
    const direction = norm2(sub2(p2[chain[3]], base));
    fingers[name] = {
      name,
      curl,
      state: fingerStateFromCurl(curl, params),
      angles,
      direction,
      angleFromUp: angle2(direction, UP),
    };
  }

  const palmCenter: Vec2 = {
    x: (p2[LM.WRIST].x + p2[LM.INDEX_MCP].x + p2[LM.MIDDLE_MCP].x + p2[LM.RING_MCP].x + p2[LM.PINKY_MCP].x) / 5,
    y: (p2[LM.WRIST].y + p2[LM.INDEX_MCP].y + p2[LM.MIDDLE_MCP].y + p2[LM.RING_MCP].y + p2[LM.PINKY_MCP].y) / 5,
  };
  const direction = norm2(sub2(p2[LM.MIDDLE_MCP], p2[LM.WRIST]));

  // Palm normal: for the subject's right hand, (index-wrist) × (pinky-wrist) points out of the palm.
  const n = norm3(cross3(sub3(w[LM.INDEX_MCP], w[LM.WRIST]), sub3(w[LM.PINKY_MCP], w[LM.WRIST])));
  const palmNormal = raw.handedness === 'Right' ? n : scale3(n, -1);

  return {
    handedness: raw.handedness,
    score: raw.score,
    landmarks: raw.landmarks,
    world: raw.world,
    points2D: p2,
    fingers,
    palmCenter,
    palmSize: palmSize2D(p2),
    direction,
    angleFromUp: angle2(direction, UP),
    palmNormal,
  };
}

/** Named points that templates can reference in two-hand relations. */
export type HandPoint =
  | 'wrist'
  | 'palm'
  | 'thumbTip'
  | 'indexTip'
  | 'middleTip'
  | 'ringTip'
  | 'pinkyTip'
  | 'indexMcp'
  | 'middleMcp';

export function handPoint(h: HandAnalysis, point: HandPoint): Vec2 {
  switch (point) {
    case 'palm':
      return h.palmCenter;
    case 'wrist':
      return h.points2D[LM.WRIST];
    case 'thumbTip':
      return h.points2D[LM.THUMB_TIP];
    case 'indexTip':
      return h.points2D[LM.INDEX_TIP];
    case 'middleTip':
      return h.points2D[LM.MIDDLE_TIP];
    case 'ringTip':
      return h.points2D[LM.RING_TIP];
    case 'pinkyTip':
      return h.points2D[LM.PINKY_TIP];
    case 'indexMcp':
      return h.points2D[LM.INDEX_MCP];
    case 'middleMcp':
      return h.points2D[LM.MIDDLE_MCP];
  }
}
