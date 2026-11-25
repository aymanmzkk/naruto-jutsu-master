import type { FingerName } from './types';
import type { HandPoint } from './HandGeometry';
import {
  F_CURLED,
  F_STRAIGHT,
  T_FOLDED,
  T_TUCKED,
  handPose,
  type TwoHandPose,
} from './SyntheticHand';

/**
 * GESTURE TEMPLATES — configurable definition of every hand sign.
 *
 * Each template describes, per hand, the expected state of every finger and
 * (optionally) the pointing direction, plus two-hand relations (distances
 * normalised by palm size, relative angle between hands). Nothing here uses
 * pixel coordinates, so recognition works for any hand size / webcam distance.
 *
 * Tweak thresholds, hold times or expectations here (or live in the NUI LAB).
 * The signs are game adaptations of the traditional seals, designed so a
 * single webcam can tell them apart reliably.
 */

export type FingerExpectation = 'extended' | 'bent' | 'partial' | 'notBent' | 'notExtended' | 'any';

export interface AngleRange {
  /** Degrees from "up" in the image (0 = up, 90 = sideways, 180 = down). */
  min: number;
  max: number;
  weight?: number;
  hint?: string;
}

export interface HandRequirement {
  fingers: Partial<Record<FingerName, FingerExpectation>>;
  /** Overall hand direction (wrist → middle knuckle). */
  handAngle?: AngleRange;
  /** Direction of one specific finger. */
  fingerAngle?: AngleRange & { finger: FingerName };
}

export type Relation =
  | {
      kind: 'distance';
      /** Point on the hand matched to the LEFT requirement. */
      a: HandPoint;
      /** Point on the hand matched to the RIGHT requirement. */
      b: HandPoint;
      /** Max distance in palm-size units. */
      max?: number;
      /** Min distance in palm-size units. */
      min?: number;
      weight: number;
      hint: string;
    }
  | {
      kind: 'handsAngle';
      /** Angle between both hand directions (degrees, 0..180). */
      min: number;
      max: number;
      weight: number;
      hint: string;
    };

export interface GestureTemplate {
  id: string;
  /** English name of the seal. */
  name: string;
  /** Romanised Japanese name. */
  japanese: string;
  kanji: string;
  /** How to perform it (shown in the guide). */
  description: string;
  left: HandRequirement;
  right: HandRequirement;
  /** Accept the configuration with left/right swapped. */
  mirrorable: boolean;
  relations: Relation[];
  /** Allow recognition when one hand is hidden behind the other (with a confidence penalty). */
  singleHand?: { allowed: boolean; penalty: number };
  /** Confidence (0..1) required to start validating the sign. */
  threshold: number;
  /** The sign must stay above threshold for this long (ms). */
  holdMs: number;
  /** Reference pose, drawn as the SVG sign illustration (and used by the tests). */
  illustration: TwoHandPose;
  /** Viewing angle of the illustration (degrees), mirror view. */
  view?: { yaw: number; pitch: number };
}

const ALL_BENT = { index: 'bent', middle: 'bent', ring: 'bent', pinky: 'bent' } as const;
const ALL_EXTENDED = { index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended' } as const;
const TWO_FINGERS = { index: 'extended', middle: 'extended', ring: 'bent', pinky: 'bent' } as const;
/** Folded fingers of the Boar seal (knuckles bent, tips tucked). */
const BOAR_F = { mcp: 35, pip: 90, dip: 50 };

export const SNAKE: GestureTemplate = {
  id: 'snake',
  name: 'Snake',
  japanese: 'Mi',
  kanji: '巳',
  description: 'Clasp your hands with the fingers interlocked, wrists together, pointing up.',
  left: { fingers: { ...ALL_BENT, thumb: 'any' }, handAngle: { min: 0, max: 100, weight: 1, hint: 'Keep your clasped hands pointing up' } },
  right: { fingers: { ...ALL_BENT, thumb: 'any' }, handAngle: { min: 0, max: 100, weight: 1, hint: 'Keep your clasped hands pointing up' } },
  mirrorable: false,
  relations: [{ kind: 'distance', a: 'palm', b: 'palm', max: 1.45, weight: 2.2, hint: 'Press your hands together' }],
  singleHand: { allowed: true, penalty: 0.12 },
  threshold: 0.74,
  holdMs: 520,
  view: { yaw: 0, pitch: 34 },
  illustration: {
    right: handPose({ index: F_CURLED, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_TUCKED, [['y', -90], ['x', -80]], [0.021, -0.05, 0]),
    left: handPose({ index: F_CURLED, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_TUCKED, [['y', 90], ['x', -80]], [-0.021, -0.05, 0.004]),
  },
};

export const RAM: GestureTemplate = {
  id: 'ram',
  name: 'Ram',
  japanese: 'Hitsuji',
  kanji: '未',
  description: 'Raise the index and middle fingers of one hand; the other hand closes its fingers around their base.',
  left: { fingers: { ...ALL_BENT } },
  right: {
    fingers: { ...TWO_FINGERS },
    fingerAngle: { finger: 'index', min: 0, max: 50, weight: 1.2, hint: 'Point the two raised fingers upward' },
  },
  mirrorable: true,
  relations: [{ kind: 'distance', a: 'palm', b: 'palm', max: 1.7, weight: 1.6, hint: 'Bring the raised fingers onto your fist' }],
  singleHand: { allowed: true, penalty: 0.16 },
  threshold: 0.74,
  holdMs: 480,
  view: { yaw: 18, pitch: 8 },
  illustration: {
    right: handPose({ index: F_STRAIGHT, middle: { ...F_STRAIGHT, spread: 7 }, ring: F_CURLED, pinky: F_CURLED }, T_FOLDED, [['y', -150]], [0.012, 0.0, -0.035]),
    left: handPose({ index: F_CURLED, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_FOLDED, [['y', 140], ['x', -10]], [-0.02, -0.075, 0.0]),
  },
};

export const MONKEY: GestureTemplate = {
  id: 'monkey',
  name: 'Monkey',
  japanese: 'Saru',
  kanji: '申',
  description: 'Both hands flat and sideways, one laid on top of the other, fingers pointing the same way.',
  left: { fingers: { ...ALL_EXTENDED }, handAngle: { min: 50, max: 130, weight: 1.4, hint: 'Turn your flat hands sideways' } },
  right: { fingers: { ...ALL_EXTENDED }, handAngle: { min: 50, max: 130, weight: 1.4, hint: 'Turn your flat hands sideways' } },
  mirrorable: false,
  relations: [
    { kind: 'handsAngle', min: 0, max: 45, weight: 1.6, hint: 'Point both hands the same way' },
    { kind: 'distance', a: 'palm', b: 'palm', max: 1.4, weight: 1.6, hint: 'Lay one hand on top of the other' },
  ],
  // the top hand often hides the bottom one from the webcam
  singleHand: { allowed: true, penalty: 0.14 },
  threshold: 0.74,
  holdMs: 480,
  view: { yaw: 0, pitch: 22 },
  illustration: {
    right: handPose({ index: F_STRAIGHT, middle: F_STRAIGHT, ring: F_STRAIGHT, pinky: F_STRAIGHT }, T_TUCKED, [['z', 90], ['x', 90]], [0.1, -0.035, 0]),
    left: handPose({ index: F_STRAIGHT, middle: F_STRAIGHT, ring: F_STRAIGHT, pinky: F_STRAIGHT }, T_TUCKED, [['z', 90], ['x', -90]], [0.085, -0.062, 0.004]),
  },
};

export const BOAR: GestureTemplate = {
  id: 'boar',
  name: 'Boar',
  japanese: 'I',
  kanji: '亥',
  description: 'Bend both wrists so your hands point down, fold the fingers and press the knuckles together.',
  left: {
    fingers: {},
    handAngle: { min: 115, max: 180, weight: 2.2, hint: 'Bend your wrists so your hands point down' },
  },
  right: {
    fingers: {},
    handAngle: { min: 115, max: 180, weight: 2.2, hint: 'Bend your wrists so your hands point down' },
  },
  mirrorable: false,
  relations: [{ kind: 'distance', a: 'middleMcp', b: 'middleMcp', max: 1.2, weight: 1.6, hint: 'Press your knuckles together' }],
  singleHand: { allowed: false, penalty: 0 },
  threshold: 0.74,
  holdMs: 480,
  view: { yaw: 0, pitch: 10 },
  illustration: {
    right: handPose({ index: BOAR_F, middle: BOAR_F, ring: BOAR_F, pinky: BOAR_F }, T_TUCKED, [['z', 180], ['y', -62]], [0.036, 0.06, 0]),
    left: handPose({ index: BOAR_F, middle: BOAR_F, ring: BOAR_F, pinky: BOAR_F }, T_TUCKED, [['z', 180], ['y', 62]], [-0.036, 0.06, 0]),
  },
};

export const HORSE: GestureTemplate = {
  id: 'horse',
  name: 'Horse',
  japanese: 'Uma',
  kanji: '午',
  description: 'Touch the tips of both index fingers to form a triangle pointing up; fold and interlock the other fingers.',
  left: {
    fingers: { index: 'extended', middle: 'bent', ring: 'bent', pinky: 'bent' },
    fingerAngle: { finger: 'index', min: 0, max: 70, weight: 1, hint: 'Point your index fingers upward' },
  },
  right: {
    fingers: { index: 'extended', middle: 'bent', ring: 'bent', pinky: 'bent' },
    fingerAngle: { finger: 'index', min: 0, max: 70, weight: 1, hint: 'Point your index fingers upward' },
  },
  mirrorable: false,
  relations: [
    { kind: 'distance', a: 'indexTip', b: 'indexTip', max: 0.85, weight: 1.8, hint: 'Touch your index fingertips together' },
    { kind: 'distance', a: 'palm', b: 'palm', max: 2.2, weight: 0.8, hint: 'Bring your hands together' },
  ],
  threshold: 0.72,
  holdMs: 480,
  view: { yaw: 0, pitch: 6 },
  illustration: {
    right: handPose({ index: F_STRAIGHT, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_TUCKED, [['z', 28]], [0.058, -0.09, 0]),
    left: handPose({ index: F_STRAIGHT, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_TUCKED, [['z', -28]], [-0.058, -0.09, 0.006]),
  },
};

export const TIGER: GestureTemplate = {
  id: 'tiger',
  name: 'Tiger',
  japanese: 'Tora',
  kanji: '寅',
  description: 'Both hands raise index and middle fingers pressed together and pointing up; ring and little fingers interlock.',
  left: {
    fingers: { ...TWO_FINGERS },
    fingerAngle: { finger: 'index', min: 0, max: 50, weight: 1.2, hint: 'Point your raised fingers straight up' },
  },
  right: {
    fingers: { ...TWO_FINGERS },
    fingerAngle: { finger: 'index', min: 0, max: 50, weight: 1.2, hint: 'Point your raised fingers straight up' },
  },
  mirrorable: false,
  relations: [
    { kind: 'distance', a: 'indexTip', b: 'indexTip', max: 0.8, weight: 1.8, hint: 'Press your raised fingers together' },
    { kind: 'distance', a: 'palm', b: 'palm', max: 1.3, weight: 1.2, hint: 'Clasp your hands closer' },
  ],
  singleHand: { allowed: true, penalty: 0.18 },
  threshold: 0.75,
  holdMs: 560,
  view: { yaw: 58, pitch: 10 },
  illustration: {
    right: handPose({ index: F_STRAIGHT, middle: { ...F_STRAIGHT, spread: 6 }, ring: F_CURLED, pinky: F_CURLED }, T_TUCKED, [['y', -90]], [0.017, -0.06, 0]),
    left: handPose({ index: F_STRAIGHT, middle: { ...F_STRAIGHT, spread: 6 }, ring: F_CURLED, pinky: F_CURLED }, T_TUCKED, [['y', 90]], [-0.017, -0.06, 0]),
  },
};

/** Registry of every known sign. Future levels add their own templates here. */
export const GESTURE_TEMPLATES: Record<string, GestureTemplate> = {
  snake: SNAKE,
  ram: RAM,
  monkey: MONKEY,
  boar: BOAR,
  horse: HORSE,
  tiger: TIGER,
};

export function registerTemplate(t: GestureTemplate) {
  GESTURE_TEMPLATES[t.id] = t;
}

export function getTemplate(id: string): GestureTemplate {
  const t = GESTURE_TEMPLATES[id];
  if (!t) throw new Error(`Unknown gesture template "${id}"`);
  return t;
}
