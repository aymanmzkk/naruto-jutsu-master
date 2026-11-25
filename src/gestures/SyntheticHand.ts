import type { Handedness, RawHand, Vec3 } from './types';
import { add3, cross3, DEG2RAD, dot3, norm3, scale3 } from '../utils/math';

/**
 * SYNTHETIC HAND (forward kinematics)
 *
 * Generates anatomically plausible 21-landmark hands from joint angles.
 * Used for:
 *  - the reference illustration of every hand sign (rendered with the same 3D rig)
 *  - template previews in the NUI LAB
 *  - automated tests of the recognizer (tests/gestures.test.ts)
 *
 * It is NEVER used to drive gameplay: during the game the hands come from the webcam.
 *
 * Rig space (right hand, identity pose): fingers point +Y, palm faces +Z,
 * thumb on the +X side. This equals the player's first-person frame
 * (X = player's right, Y = up, Z = towards the player's face).
 */

export interface FingerPose {
  mcp: number;
  pip: number;
  dip: number;
  /** Abduction in degrees, positive = towards the thumb side. */
  spread?: number;
}

export interface ThumbPose {
  /** Swings the thumb across the palm (towards the little finger). */
  fold: number;
  /** Brings the thumb in front of the palm (opposition). */
  flex: number;
  mcp: number;
  ip: number;
}

export type AxisRotation = ['x' | 'y' | 'z', number];

export interface HandPoseSpec {
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
  thumb: ThumbPose;
  /** Rotations applied in order, in the player's frame (degrees). */
  rotations: AxisRotation[];
  /** Wrist position in the player's frame (meters, relative to the chest-centre point). */
  position: [number, number, number];
}

export interface TwoHandPose {
  left: HandPoseSpec | null;
  right: HandPoseSpec | null;
}

/** Rest pose joint positions of a right hand (meters). */
export const REST_JOINTS: Vec3[] = (() => {
  const j: Vec3[] = new Array(21);
  j[0] = { x: 0, y: 0, z: 0 };
  j[1] = { x: 0.024, y: 0.024, z: 0.01 };
  j[5] = { x: 0.027, y: 0.088, z: 0 };
  j[9] = { x: 0.005, y: 0.093, z: 0 };
  j[13] = { x: -0.015, y: 0.087, z: 0 };
  j[17] = { x: -0.032, y: 0.075, z: 0 };
  return j;
})();

export const SEGMENTS = {
  thumb: [0.04, 0.032, 0.027],
  index: [0.041, 0.025, 0.021],
  middle: [0.045, 0.028, 0.023],
  ring: [0.042, 0.027, 0.022],
  pinky: [0.033, 0.02, 0.019],
} as const;

const REST_SPREAD = { index: 4, middle: 0, ring: -4, pinky: -9 };
const THUMB_REST_DIR = norm3({ x: 1, y: 1.05, z: 0.32 });
const THUMB_CURL_TARGET = norm3({ x: -1, y: 0.05, z: 0.35 });

/** Rodrigues rotation of v around unit axis k by angle (degrees). */
export function rotateAxis(v: Vec3, k: Vec3, deg: number): Vec3 {
  const a = deg * DEG2RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kxv = cross3(k, v);
  const kdv = dot3(k, v);
  return {
    x: v.x * c + kxv.x * s + k.x * kdv * (1 - c),
    y: v.y * c + kxv.y * s + k.y * kdv * (1 - c),
    z: v.z * c + kxv.z * s + k.z * kdv * (1 - c),
  };
}

const AXES: Record<'x' | 'y' | 'z', Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

/** Joint positions (rig space, right-handed hand) for a pose, before root transform. */
export function solveRightHandJoints(pose: HandPoseSpec): Vec3[] {
  const j = REST_JOINTS.slice();
  const fingers = ['index', 'middle', 'ring', 'pinky'] as const;
  const bases = { index: 5, middle: 9, ring: 13, pinky: 17 };
  for (const f of fingers) {
    const p = pose[f];
    const spread = REST_SPREAD[f] + (p.spread ?? 0);
    const zAxis = AXES.z;
    const dir0 = rotateAxis(AXES.y, zAxis, spread);
    const flexAxis = rotateAxis(AXES.x, zAxis, spread);
    const seg = SEGMENTS[f];
    const b = bases[f];
    let pos = REST_JOINTS[b];
    let total = 0;
    const angles = [p.mcp, p.pip, p.dip];
    for (let s = 0; s < 3; s++) {
      total += angles[s];
      const d = rotateAxis(dir0, flexAxis, total);
      pos = add3(pos, scale3(d, seg[s]));
      j[b + s + 1] = pos;
    }
  }
  // Thumb
  // The thumb flexes towards the front of the palm and the little-finger side.
  const t = pose.thumb;
  let dir = rotateAxis(THUMB_REST_DIR, AXES.z, t.fold);
  const k = norm3(cross3(dir, THUMB_CURL_TARGET));
  dir = rotateAxis(dir, k, t.flex);
  let pos = REST_JOINTS[1];
  const tAngles = [0, t.mcp, t.ip];
  let acc = 0;
  for (let s = 0; s < 3; s++) {
    acc += tAngles[s];
    const d = rotateAxis(dir, k, acc);
    pos = add3(pos, scale3(d, SEGMENTS.thumb[s]));
    j[2 + s] = pos;
  }
  return j;
}

/** Full joints of a hand in the player's frame (meters). */
export function solveHandJoints(pose: HandPoseSpec, side: Handedness): Vec3[] {
  let joints = solveRightHandJoints(pose);
  if (side === 'Left') joints = joints.map((p) => ({ x: -p.x, y: p.y, z: p.z }));
  for (const [axis, deg] of pose.rotations) {
    joints = joints.map((p) => rotateAxis(p, AXES[axis], deg));
  }
  const [px, py, pz] = pose.position;
  return joints.map((p) => ({ x: p.x + px, y: p.y + py, z: p.z + pz }));
}

/**
 * Converts joints from the player's frame to what a webcam in front of the
 * player would report (MediaPipe conventions): image landmarks (normalized,
 * not mirrored) and world landmarks (meters around the hand centre).
 */
export function toRawHand(
  jointsPlayer: Vec3[],
  side: Handedness,
  opts: { aspect?: number; cameraDistance?: number; imageScale?: number; centerY?: number } = {},
): RawHand {
  const aspect = opts.aspect ?? 16 / 9;
  const camDist = opts.cameraDistance ?? 0.55;
  const scale = opts.imageScale ?? 1.5;
  const centerY = opts.centerY ?? 0.55;
  // Player frame → camera frame: x_cam = -X, y_cam = -Y, z_cam = Z (+ distance)
  const cam = jointsPlayer.map((p) => ({ x: -p.x, y: -p.y, z: p.z + camDist }));
  const landmarks = cam.map((p) => {
    const persp = camDist / p.z;
    return {
      x: 0.5 + (p.x * scale * persp) / aspect,
      y: centerY + p.y * scale * persp,
      z: (p.z - camDist) * scale,
    };
  });
  const c = cam.reduce((acc, p) => add3(acc, p), { x: 0, y: 0, z: 0 });
  const center = scale3(c, 1 / cam.length);
  const world = cam.map((p) => ({ x: p.x - center.x, y: p.y - center.y, z: p.z - center.z }));
  return { handedness: side, score: 0.98, landmarks, world };
}

export function synthesizeHands(pose: TwoHandPose, aspect = 16 / 9): RawHand[] {
  const out: RawHand[] = [];
  if (pose.left) out.push(toRawHand(solveHandJoints(pose.left, 'Left'), 'Left', { aspect }));
  if (pose.right) out.push(toRawHand(solveHandJoints(pose.right, 'Right'), 'Right', { aspect }));
  return out;
}

/* ---------- Building blocks for poses ---------- */

export const F_STRAIGHT: FingerPose = { mcp: 4, pip: 4, dip: 3 };
export const F_CURLED: FingerPose = { mcp: 82, pip: 100, dip: 62 };
export const F_HALF: FingerPose = { mcp: 25, pip: 38, dip: 22 };
export const T_OPEN: ThumbPose = { fold: -8, flex: 8, mcp: 4, ip: 4 };
export const T_FOLDED: ThumbPose = { fold: 20, flex: 30, mcp: 28, ip: 28 };
export const T_TUCKED: ThumbPose = { fold: 22, flex: 20, mcp: 14, ip: 12 };

export function handPose(
  fingers: { index: FingerPose; middle: FingerPose; ring: FingerPose; pinky: FingerPose },
  thumb: ThumbPose,
  rotations: AxisRotation[],
  position: [number, number, number],
): HandPoseSpec {
  return { ...fingers, thumb, rotations, position };
}

/** Relaxed idle pose used when tracking is lost. */
export const RELAXED_POSE: TwoHandPose = {
  right: handPose(
    { index: { mcp: 18, pip: 22, dip: 10 }, middle: { mcp: 22, pip: 28, dip: 12 }, ring: { mcp: 26, pip: 32, dip: 14 }, pinky: { mcp: 30, pip: 34, dip: 16 } },
    { fold: 5, flex: 18, mcp: 12, ip: 12 },
    [['y', -35], ['x', -50]],
    [0.13, -0.075, 0.02],
  ),
  left: handPose(
    { index: { mcp: 18, pip: 22, dip: 10 }, middle: { mcp: 22, pip: 28, dip: 12 }, ring: { mcp: 26, pip: 32, dip: 14 }, pinky: { mcp: 30, pip: 34, dip: 16 } },
    { fold: 5, flex: 18, mcp: 12, ip: 12 },
    [['y', 35], ['x', -50]],
    [-0.13, -0.075, 0.02],
  ),
};
