import * as THREE from 'three';
import type { HandAnalysis, Handedness, TrackingFrame, Vec2, Vec3 } from '../../gestures/types';
import { RELAXED_POSE, solveHandJoints, type TwoHandPose } from '../../gestures/SyntheticHand';
import { HandRig, blendPoses, createPoseTarget, type PoseTarget } from './HandRig';
import { clamp } from '../../utils/math';
import { addOutline, groupGeometry, toonMat } from '../materials/toon';

/**
 * FIRST-PERSON HANDS — the player's two virtual hands, attached to the camera.
 *
 * Real-time mapping from the webcam:
 *   • Finger & wrist rotations : retargeted from MediaPipe WORLD landmarks
 *   • Hand position (x, y)     : wrist position in the image, converted to
 *                                METRES with the hand's own scale (real palm
 *                                length ÷ palm length in the image), the same
 *                                in x and y — so the distance between your two
 *                                hands is reproduced: hands that touch in real
 *                                life touch in the game, at any camera distance
 *   • Hand depth               : apparent palm size (closer to the webcam ⇒
 *                                hand extended further away from the eyes)
 * Smoothing: One Euro filter on landmarks + damped slerp on every bone.
 * Tracking loss: pose is held briefly, then eases to a relaxed idle pose.
 */

/** Offset between the player-frame chest point and the camera (eyes). */
export const CHEST_OFFSET = new THREE.Vector3(0, -0.17, -0.41);

const toPlayerFrame = (w: Vec3[]): Vec3[] => w.map((p) => ({ x: -p.x, y: -p.y, z: p.z }));

interface SideState {
  rig: HandRig;
  tracked: PoseTarget;
  /** This frame's solve, before glitch rejection. */
  candidate: PoseTarget;
  candidatePos: THREE.Vector3;
  /** Consecutive frames rejected as tracking glitches. */
  glitchFrames: number;
  fallback: PoseTarget;
  override: PoseTarget;
  mouth: PoseTarget;
  blended: PoseTarget;
  trackedPos: THREE.Vector3;
  fallbackPos: THREE.Vector3;
  overridePos: THREE.Vector3;
  mouthPos: THREE.Vector3;
  finalPos: THREE.Vector3;
  weight: number; // tracked weight
  lastSeen: number;
  hasTracking: boolean;
  sleeve: THREE.Group;
  elbow: THREE.Vector3;
}

export interface FirstPersonHandsOptions {
  /** Cel-shaded skin + ink outline (anime look of the 3D level). */
  anime?: boolean;
  sleeveColor?: string;
  wrapColor?: string;
}

function makeWrapTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    // headless (tests): plain white placeholder
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d4cb';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 18) {
    g.fillStyle = 'rgba(80,70,60,0.35)';
    g.save();
    g.translate(0, y);
    g.rotate(-0.12);
    g.fillRect(-10, 0, 90, 2);
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, y + 4, 64, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FirstPersonHands {
  readonly group = new THREE.Group();
  private sides: Record<Handedness, SideState>;
  /** 0 = follow tracking, 1 = hands brought in front of the mouth. */
  mouthBlend = 0;
  /** Weight of a scripted / preview pose (NUI LAB template preview, cinematics). */
  overrideWeight = 0;
  private overridePose: TwoHandPose | null = null;
  /** Small idle sway so the view feels alive. */
  private t = 0;
  private wrapTex: THREE.Texture;
  private sleeveMat: THREE.MeshStandardMaterial;
  private wrapMat: THREE.MeshStandardMaterial;
  /**
   * When true, a scripted/override pose keeps the player's tracked location:
   * the pair is placed around the midpoint of the real hands, with the exact
   * relative arrangement of the sign (used by the "sign assist" in game).
   */
  overrideFollowTracking = false;
  /** Raises scripted sign poses (in-game the bottom HUD covers chest height). */
  overrideLift = 0;
  /** Vertical anchor of tracked hands in view (metres below the eyes). */
  trackedAnchorY = -0.2;
  /** Metres per aspect-corrected image unit (smoothed), from the tracked palm. */
  private metric = 0.5;
  private anime: boolean;

  constructor(opts: FirstPersonHandsOptions = {}) {
    this.wrapTex = makeWrapTexture();
    this.anime = !!opts.anime;
    this.sleeveMat = opts.anime
      ? (toonMat({ color: opts.sleeveColor ?? '#2a3352' }) as unknown as THREE.MeshStandardMaterial)
      : new THREE.MeshStandardMaterial({ color: opts.sleeveColor ?? '#1b1e2b', roughness: 0.92 });
    this.wrapMat = opts.anime
      ? (toonMat({ color: opts.wrapColor ?? '#ffffff', map: this.wrapTex }) as unknown as THREE.MeshStandardMaterial)
      : new THREE.MeshStandardMaterial({ color: opts.wrapColor ?? '#ffffff', map: this.wrapTex, roughness: 0.95 });
    const make = (side: Handedness): SideState => {
      // anime skin: light peach with one soft shadow tone, thin brown line art
      const rig = opts.anime
        ? new HandRig(side, [toonMat({ color: '#f7d3b8' }, [190, 255]), toonMat({ color: '#fbe2d8' }, [205, 255])])
        : new HandRig(side);
      if (opts.anime) addOutline(rig.mesh, 1.5, '#5a3426', groupGeometry(rig.mesh.geometry, 0)); // skin only, not the nails
      this.group.add(rig.group);
      const sleeve = this.makeSleeve();
      this.group.add(sleeve);
      return {
        rig,
        tracked: createPoseTarget(),
        candidate: createPoseTarget(),
        candidatePos: new THREE.Vector3(),
        glitchFrames: 0,
        fallback: createPoseTarget(),
        override: createPoseTarget(),
        mouth: createPoseTarget(),
        blended: createPoseTarget(),
        trackedPos: new THREE.Vector3(),
        fallbackPos: new THREE.Vector3(),
        overridePos: new THREE.Vector3(),
        mouthPos: new THREE.Vector3(),
        finalPos: new THREE.Vector3(),
        weight: 0,
        lastSeen: -1e9,
        hasTracking: false,
        sleeve,
        elbow: new THREE.Vector3(side === 'Right' ? 0.24 : -0.24, -0.42, -0.06),
      };
    };
    this.sides = { Left: make('Left'), Right: make('Right') };

    // Precompute idle (relaxed) pose and the "hands at the mouth" pose.
    for (const side of ['Left', 'Right'] as const) {
      const s = this.sides[side];
      const spec = side === 'Left' ? RELAXED_POSE.left! : RELAXED_POSE.right!;
      s.rig.solve(solveHandJoints(spec, side), s.fallback);
      s.fallbackPos.set(spec.position[0], spec.position[1], spec.position[2]).add(CHEST_OFFSET);
      s.rig.apply(s.fallback, s.fallbackPos);
      s.trackedPos.copy(s.fallbackPos);
    }
    this.setMouthPose();
  }

  private makeSleeve() {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.05, 1, 18, 1, true), this.sleeveMat);
    arm.position.y = -0.5;
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.034, 0.11, 18, 1, true), this.wrapMat);
    wrap.position.y = -0.055;
    wrap.name = 'wrap';
    arm.name = 'arm';
    g.add(arm, wrap);
    if (this.anime) {
      addOutline(arm, 1.5, '#1b1416');
      addOutline(wrap, 1.2, '#5a4a40');
    }
    return g;
  }

  /** Pose used when the jutsu is charged: tiger seal in front of the mouth. */
  private setMouthPose() {
    const tigerSpec = (side: Handedness) => ({
      index: { mcp: 4, pip: 4, dip: 3 },
      middle: { mcp: 4, pip: 4, dip: 3, spread: 3 },
      ring: { mcp: 82, pip: 100, dip: 62 },
      pinky: { mcp: 82, pip: 100, dip: 62 },
      thumb: { fold: 22, flex: 20, mcp: 14, ip: 12 },
      rotations: [['y', side === 'Right' ? -72 : 72], ['x', -52]] as [('x' | 'y' | 'z'), number][],
      position: [side === 'Right' ? 0.018 : -0.018, 0, 0] as [number, number, number],
    });
    for (const side of ['Left', 'Right'] as const) {
      const s = this.sides[side];
      s.rig.solve(solveHandJoints(tigerSpec(side), side), s.mouth);
      s.mouthPos.set(side === 'Right' ? 0.026 : -0.026, -0.19, -0.3);
    }
  }

  /** Scripted pose (e.g. reference sign preview). */
  setOverride(pose: TwoHandPose | null) {
    this.overridePose = pose;
    if (!pose) return;
    for (const side of ['Left', 'Right'] as const) {
      const spec = side === 'Left' ? pose.left : pose.right;
      const s = this.sides[side];
      if (!spec) {
        blendPoses(s.fallback, s.fallback, 0, s.override);
        s.overridePos.copy(s.fallbackPos);
        continue;
      }
      s.rig.solve(solveHandJoints(spec, side), s.override);
      s.overridePos.set(spec.position[0], spec.position[1] + this.overrideLift, spec.position[2]).add(CHEST_OFFSET);
    }
  }

  /**
   * Maps the tracked hands to first-person camera space.
   * The pair's midpoint is anchored in view (gently scaled so hands stay on
   * screen); each hand's offset from that midpoint uses the true metric scale.
   */
  private mapPositions(frame: TrackingFrame) {
    const hands = [frame.left, frame.right].filter((h): h is HandAnalysis => !!h);
    let k = 0;
    let n = 0;
    for (const h of hands) {
      const w = h.world;
      const palm3D = Math.hypot(w[9].x - w[0].x, w[9].y - w[0].y, w[9].z - w[0].z);
      if (h.palmSize > 0.02 && palm3D > 0.03) {
        k += palm3D / h.palmSize;
        n++;
      }
    }
    if (n) this.metric += (clamp(k / n, 0.25, 1.3) - this.metric) * 0.12;
    const aspect = frame.videoWidth > 0 && frame.videoHeight > 0 ? frame.videoWidth / frame.videoHeight : 16 / 9;
    const wristOf = (h: HandAnalysis): Vec2 => h.points2D[0];
    const mid = { x: 0, y: 0 };
    for (const h of hands) {
      mid.x += wristOf(h).x / hands.length;
      mid.y += wristOf(h).y / hands.length;
    }
    const absK = Math.min(this.metric, 0.5);
    const out = new Map<Handedness, THREE.Vector3>();
    for (const h of hands) {
      const p = wristOf(h);
      const depth = clamp((h.palmSize - 0.22) * 0.7, -0.07, 0.12);
      out.set(
        h.handedness,
        new THREE.Vector3(
          -(mid.x - 0.5 * aspect) * absK - (p.x - mid.x) * this.metric,
          -(mid.y - 0.58) * absK + this.trackedAnchorY - (p.y - mid.y) * this.metric,
          -0.4 - depth,
        ),
      );
    }
    return out;
  }

  isTracked(side: Handedness) {
    return this.sides[side].hasTracking;
  }

  update(frame: TrackingFrame | null, dt: number, now: number) {
    this.t += dt;
    const positions = frame && (frame.left || frame.right) ? this.mapPositions(frame) : null;
    const sides = ['Left', 'Right'] as const;

    // ---- 1. tracking input, with glitch rejection ----
    for (const side of sides) {
      const s = this.sides[side];
      const h = frame ? (side === 'Left' ? frame.left : frame.right) : null;
      if (!h) continue;
      s.rig.solve(toPlayerFrame(h.world), s.candidate);
      const p = positions?.get(side);
      if (p) s.candidatePos.copy(p);
      else s.candidatePos.copy(s.trackedPos);
      // A real hand cannot flip its orientation or teleport between two
      // frames: such single frames are MediaPipe mistakes (typically when the
      // hands overlap). Ignore them unless they persist.
      const flip = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(s.candidate.root.dot(s.tracked.root)))));
      const jump = s.candidatePos.distanceTo(s.trackedPos);
      const wasTracked = now - s.lastSeen < 200;
      if (wasTracked && (flip > 70 || jump > 0.16) && s.glitchFrames < 4) {
        s.glitchFrames++;
      } else {
        s.glitchFrames = 0;
        s.tracked.root.copy(s.candidate.root);
        for (let i = 0; i < s.tracked.local.length; i++) s.tracked.local[i].copy(s.candidate.local[i]);
        s.trackedPos.copy(s.candidatePos);
      }
      s.lastSeen = now;
    }

    // hands close together → partial occlusion → noisier landmarks: smooth more
    const both = this.sides.Left.hasTracking && this.sides.Right.hasTracking;
    const handGap = both ? this.sides.Left.trackedPos.distanceTo(this.sides.Right.trackedPos) : 1;
    const closeness = both ? THREE.MathUtils.clamp((0.16 - handGap) / 0.1, 0, 1) : 0;
    const rotSharpness = THREE.MathUtils.lerp(15, 8, closeness);
    const posSharpness = THREE.MathUtils.lerp(14, 9, closeness);

    // override placement that follows the real hands (sign assist)
    let follow: THREE.Vector3 | null = null;
    if (this.overrideFollowTracking && this.overridePose && both) {
      const trackedMid = this.sides.Left.trackedPos.clone().add(this.sides.Right.trackedPos).multiplyScalar(0.5);
      const overrideMid = this.sides.Left.overridePos.clone().add(this.sides.Right.overridePos).multiplyScalar(0.5);
      follow = trackedMid.sub(overrideMid);
    }

    // ---- 2. blend layers and drive the rigs ----
    for (const side of sides) {
      const s = this.sides[side];
      const recentlySeen = now - s.lastSeen < 320;
      s.hasTracking = recentlySeen;
      const targetW = recentlySeen ? 1 : 0;
      s.weight += (targetW - s.weight) * (1 - Math.exp(-(recentlySeen ? 10 : 3.2) * dt));

      // tracked ⟷ relaxed
      const pose = blendPoses(s.fallback, s.tracked, s.weight, s.blended);
      s.finalPos.copy(s.fallbackPos).lerp(s.trackedPos, s.weight);
      // idle breathing sway
      s.finalPos.y += Math.sin(this.t * 1.6 + (side === 'Left' ? 0 : 0.6)) * 0.004 * (1 - s.weight * 0.6);

      // scripted override (sign preview / sign assist)
      if (this.overridePose && this.overrideWeight > 0) {
        blendPoses(pose, s.override, this.overrideWeight, pose);
        const target = follow ? s.overridePos.clone().add(follow) : s.overridePos;
        s.finalPos.lerp(target, this.overrideWeight);
      }
      // bring hands to the mouth (orientation partially, position fully)
      if (this.mouthBlend > 0) {
        pose.root.slerp(s.mouth.root, this.mouthBlend * 0.75);
        if (s.weight < 0.5) for (let i = 1; i < pose.local.length; i++) pose.local[i].slerp(s.mouth.local[i], this.mouthBlend);
        s.finalPos.lerp(s.mouthPos, this.mouthBlend);
      }
    }

    // ---- 3. keep the two palms from sinking into each other (free movement only) ----
    const free = 1 - Math.max(this.overrideWeight, this.mouthBlend);
    if (both && free > 0.05) {
      const L = this.sides.Left.finalPos;
      const R = this.sides.Right.finalPos;
      const MIN = 0.07;
      const d = L.distanceTo(R);
      if (d < MIN) {
        const dir = d > 1e-4 ? R.clone().sub(L).normalize() : new THREE.Vector3(1, 0, 0);
        const push = ((MIN - d) / 2) * free;
        L.addScaledVector(dir, -push);
        R.addScaledVector(dir, push);
      }
    }

    for (const side of sides) {
      const s = this.sides[side];
      s.rig.dampTo(s.blended, s.finalPos, dt, rotSharpness, posSharpness);
      this.updateSleeve(s);
    }
  }

  private updateSleeve(s: SideState) {
    const wrist = s.rig.root.position;
    // forearm end slightly behind the wrist, along the hand's -Y axis
    const back = new THREE.Vector3(0, -0.035, 0).applyQuaternion(s.rig.root.quaternion).add(wrist);
    const dir = back.clone().sub(s.elbow);
    const len = Math.max(0.05, dir.length());
    s.sleeve.position.copy(back);
    s.sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const arm = s.sleeve.getObjectByName('arm')!;
    arm.scale.set(1, len, 1);
    arm.position.y = -len / 2 - 0.02;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  dispose() {
    for (const side of ['Left', 'Right'] as const) {
      this.sides[side].rig.dispose();
      this.sides[side].sleeve.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
    }
    this.sleeveMat.dispose();
    this.wrapMat.dispose();
    this.wrapTex.dispose();
  }
}
