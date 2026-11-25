import * as THREE from 'three';
import { easeInOutCubic } from '../../utils/math';

/**
 * CAMERA DIRECTOR — cinematic camera moves.
 *  • moveTo(): eased transition of position / look-at / fov
 *  • followPath(): Catmull-Rom path with its own look-at path
 *  • track(): follow a moving target every frame (fireball)
 *  • shake(): trauma-based noise shake (Squirrel Eiserloh's model)
 * Shake is applied on top of the base transform, so it never accumulates.
 */

export interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov?: number;
  roll?: number;
}

interface Move {
  from: Shot;
  to: Shot;
  duration: number;
  t: number;
  ease: (t: number) => number;
  resolve: () => void;
  posCurve?: THREE.Curve<THREE.Vector3>;
  lookCurve?: THREE.Curve<THREE.Vector3>;
}

export class CameraDirector {
  readonly base: Shot;
  private move: Move | null = null;
  private trauma = 0;
  private time = 0;
  private trackFn: ((dt: number, shot: Shot) => void) | null = null;
  /** Subtle hand-held breathing motion amount. */
  handheld = 0.6;
  private extraRoll = 0;
  private aberrationOut = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.base = {
      position: camera.position.clone(),
      target: new THREE.Vector3(0, 0, -1).add(camera.position),
      fov: camera.fov,
      roll: 0,
    };
  }

  /** Instantly cuts to a shot. */
  cut(shot: Shot) {
    this.move?.resolve();
    this.move = null;
    this.trackFn = null;
    this.base.position.copy(shot.position);
    this.base.target.copy(shot.target);
    this.base.fov = shot.fov ?? this.base.fov;
    this.base.roll = shot.roll ?? 0;
  }

  moveTo(shot: Shot, duration: number, ease = easeInOutCubic): Promise<void> {
    this.trackFn = null;
    this.move?.resolve();
    return new Promise((resolve) => {
      this.move = {
        from: this.snapshot(),
        to: { ...shot, fov: shot.fov ?? this.base.fov, roll: shot.roll ?? 0 },
        duration,
        t: 0,
        ease,
        resolve,
      };
    });
  }

  followPath(pos: THREE.Curve<THREE.Vector3>, look: THREE.Curve<THREE.Vector3>, duration: number, fovTo?: number, ease = easeInOutCubic) {
    this.trackFn = null;
    this.move?.resolve();
    return new Promise<void>((resolve) => {
      const from = this.snapshot();
      this.move = {
        from,
        to: { position: pos.getPoint(1), target: look.getPoint(1), fov: fovTo ?? from.fov, roll: 0 },
        duration,
        t: 0,
        ease,
        resolve,
        posCurve: pos,
        lookCurve: look,
      };
    });
  }

  /** Per-frame custom tracking (cleared by the next move/cut). */
  track(fn: (dt: number, shot: Shot) => void) {
    this.move?.resolve();
    this.move = null;
    this.trackFn = fn;
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  roll(rad: number) {
    this.extraRoll = rad;
  }

  /** Current chromatic aberration contribution from shake (for post FX). */
  get aberration() {
    return this.aberrationOut;
  }

  private snapshot(): Shot {
    return {
      position: this.base.position.clone(),
      target: this.base.target.clone(),
      fov: this.base.fov,
      roll: this.base.roll,
    };
  }

  update(dt: number) {
    this.time += dt;
    if (this.move) {
      const m = this.move;
      m.t = Math.min(1, m.t + dt / m.duration);
      const k = m.ease(m.t);
      if (m.posCurve && m.lookCurve) {
        this.base.position.copy(m.posCurve.getPoint(k));
        this.base.target.copy(m.lookCurve.getPoint(k));
      } else {
        this.base.position.lerpVectors(m.from.position, m.to.position, k);
        this.base.target.lerpVectors(m.from.target, m.to.target, k);
      }
      this.base.fov = THREE.MathUtils.lerp(m.from.fov!, m.to.fov!, k);
      this.base.roll = THREE.MathUtils.lerp(m.from.roll ?? 0, m.to.roll ?? 0, k);
      if (m.t >= 1) {
        this.move = null;
        m.resolve();
      }
    } else if (this.trackFn) {
      this.trackFn(dt, this.base);
    }

    const cam = this.camera;
    cam.position.copy(this.base.position);
    // hand-held breathing
    const h = this.handheld;
    cam.position.x += Math.sin(this.time * 0.9) * 0.004 * h;
    cam.position.y += Math.sin(this.time * 1.3 + 1.1) * 0.005 * h;
    const target = this.base.target.clone();

    // trauma shake
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const s = this.trauma * this.trauma;
    const n = (seed: number) =>
      Math.sin(this.time * 31.7 + seed) * 0.5 + Math.sin(this.time * 57.3 + seed * 2.1) * 0.3 + Math.sin(this.time * 89.1 + seed * 3.7) * 0.2;
    cam.position.x += n(1) * 0.09 * s;
    cam.position.y += n(2) * 0.07 * s;
    target.x += n(3) * 0.35 * s;
    target.y += n(4) * 0.3 * s;
    this.aberrationOut = s * 0.012;

    cam.lookAt(target);
    cam.rotateZ((this.base.roll ?? 0) + this.extraRoll + n(5) * 0.05 * s);
    if (Math.abs(cam.fov - (this.base.fov ?? 55)) > 0.01) {
      cam.fov = this.base.fov ?? 55;
      cam.updateProjectionMatrix();
    }
  }
}
