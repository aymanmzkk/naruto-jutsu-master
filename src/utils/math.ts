import type { Vec2, Vec3 } from '../gestures/types';

export const clamp = (v: number, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

/** Frame-rate independent exponential damping factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len3 = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
/** Angle between two vectors in degrees. */
export const angle3 = (a: Vec3, b: Vec3) => {
  const d = dot3(a, b) / ((len3(a) * len3(b)) || 1);
  return Math.acos(clamp(d, -1, 1)) * RAD2DEG;
};

export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const len2 = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Unsigned angle between two 2D vectors, degrees. */
export const angle2 = (a: Vec2, b: Vec2) => {
  const d = (a.x * b.x + a.y * b.y) / ((len2(a) * len2(b)) || 1);
  return Math.acos(clamp(d, -1, 1)) * RAD2DEG;
};

/** Deterministic pseudo random generator (mulberry32) for procedural content. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInQuad = (t: number) => t * t;
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
