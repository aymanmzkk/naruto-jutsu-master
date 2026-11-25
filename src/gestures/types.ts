/**
 * Core types shared by the whole Natural User Interface pipeline:
 *   webcam → MediaPipe (21 landmarks / hand) → smoothing → geometry analysis
 *   → template scoring → temporal state machine → sequence progress.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The person's real hand (already corrected for camera mirroring). */
export type Handedness = 'Left' | 'Right';

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGERS)[number];

/** MediaPipe Hand Landmarker indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Landmark chains for each finger (base joint → tip). */
export const FINGER_CHAINS: Record<FingerName, [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

/** Skeleton connections used for drawing. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** One detected hand, straight out of the tracker (after handedness correction). */
export interface RawHand {
  handedness: Handedness;
  /** Handedness classification score (0..1). */
  score: number;
  /** 21 normalized image landmarks: x,y in [0,1] (raw, NOT mirrored), z relative depth. */
  landmarks: Vec3[];
  /** 21 world landmarks in meters, origin at the hand centre, camera-aligned axes. */
  world: Vec3[];
}

export type FingerState = 'extended' | 'partial' | 'bent';

export interface FingerAnalysis {
  name: FingerName;
  /** 0 = perfectly straight, 1 = fully curled. */
  curl: number;
  state: FingerState;
  /** Joint flexion angles in degrees (0 = straight). For the thumb, mcp=CMC→MCP, pip=MCP, dip=IP. */
  angles: { mcp: number; pip: number; dip: number };
  /** 2D pointing direction of the finger in image space (aspect corrected, y down). */
  direction: Vec2;
  /** Angle between the finger direction and "up" in the image, degrees (0 = up, 180 = down). */
  angleFromUp: number;
}

export interface HandAnalysis {
  handedness: Handedness;
  score: number;
  /** Smoothed normalized landmarks (raw camera orientation). */
  landmarks: Vec3[];
  /** Smoothed world landmarks (meters). */
  world: Vec3[];
  /** Aspect-corrected 2D points (x scaled by width/height) used for scale-invariant relations. */
  points2D: Vec2[];
  fingers: Record<FingerName, FingerAnalysis>;
  /** Palm centre (aspect-corrected image space). */
  palmCenter: Vec2;
  /** Apparent palm size in aspect-corrected image units (robust to foreshortening). */
  palmSize: number;
  /** Hand direction wrist → middle knuckle (2D, unit). */
  direction: Vec2;
  /** 0 = fingers point up, 180 = fingers point down. */
  angleFromUp: number;
  /** Palm normal in camera space (world landmarks), pointing out of the palm. */
  palmNormal: Vec3;
}

export interface TrackingFrame {
  /** performance.now() timestamp in ms. */
  time: number;
  hands: HandAnalysis[];
  left: HandAnalysis | null;
  right: HandAnalysis | null;
  videoWidth: number;
  videoHeight: number;
  /** Tracker throughput (frames analysed per second). */
  fps: number;
  /** Duration of the last MediaPipe inference (ms). */
  inferenceMs: number;
}

export type TrackerStatus =
  | 'idle'
  | 'requesting-camera'
  | 'loading-model'
  | 'running'
  | 'paused'
  | 'error';

export type TrackerErrorCode =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'insecure-context'
  | 'model-failed'
  | 'unknown';
