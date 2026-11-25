import * as THREE from 'three';
import type { Handedness, Vec3 } from '../../gestures/types';
import { solveRightHandJoints, type HandPoseSpec } from '../../gestures/SyntheticHand';

/**
 * HAND RIG — a procedurally modelled, skinned 3D hand with 16 bones
 * (wrist + 3 per finger), driven by retargeting the 21 MediaPipe landmarks.
 *
 * Retargeting (per frame):
 *   1. Wrist orientation  = frame(wrist, index MCP, middle MCP, pinky MCP)
 *      of the tracked hand × inverse(frame of the rig at rest).
 *   2. Every finger bone  = minimal rotation taking its rest direction to the
 *      tracked direction (joint → child joint), expressed in its parent space.
 *      PIP/DIP joints are constrained to their flexion plane.
 *   3. Bone lengths stay those of the model, so the hand keeps its proportions
 *      while reproducing the player's finger angles and hand orientation.
 */

export const BONE_JOINTS = [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19] as const;
const CHILD: Record<number, number> = { 1: 2, 2: 3, 3: 4, 5: 6, 6: 7, 7: 8, 9: 10, 10: 11, 11: 12, 13: 14, 14: 15, 15: 16, 17: 18, 18: 19, 19: 20 };
const PARENT: Record<number, number> = { 1: 0, 2: 1, 3: 2, 5: 0, 6: 5, 7: 6, 9: 0, 10: 9, 11: 10, 13: 0, 14: 13, 15: 14, 17: 0, 18: 17, 19: 18 };
const BONE_INDEX: Record<number, number> = Object.fromEntries(BONE_JOINTS.map((j, i) => [j, i]));
const CHAINS = [
  [1, 2, 3],
  [5, 6, 7],
  [9, 10, 11],
  [13, 14, 15],
  [17, 18, 19],
];
const PLANAR_JOINTS = new Set([6, 7, 10, 11, 14, 15, 18, 19]);

export const REST_POSE_SPEC: HandPoseSpec = {
  index: { mcp: 0, pip: 0, dip: 0 },
  middle: { mcp: 0, pip: 0, dip: 0 },
  ring: { mcp: 0, pip: 0, dip: 0 },
  pinky: { mcp: 0, pip: 0, dip: 0 },
  thumb: { fold: 0, flex: 0, mcp: 0, ip: 0 },
  rotations: [],
  position: [0, 0, 0],
};

export function restJoints(side: Handedness): Vec3[] {
  const j = solveRightHandJoints(REST_POSE_SPEC);
  return side === 'Left' ? j.map((p) => ({ x: -p.x, y: p.y, z: p.z })) : j;
}

export interface PoseTarget {
  root: THREE.Quaternion;
  local: THREE.Quaternion[];
}

export function createPoseTarget(): PoseTarget {
  return { root: new THREE.Quaternion(), local: BONE_JOINTS.map(() => new THREE.Quaternion()) };
}

const _v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** Orthonormal hand frame from four palm landmarks. */
export function palmFrame(p: Vec3[], out = new THREE.Quaternion()) {
  const y = _v(p[9]).sub(_v(p[0])).normalize();
  const lat = _v(p[5]).sub(_v(p[17])).normalize();
  const z = new THREE.Vector3().crossVectors(lat, y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

/* ------------------------------------------------------------------ */
/*                       Procedural skinned mesh                        */
/* ------------------------------------------------------------------ */

class MeshBuilder {
  pos: number[] = [];
  skinIdx: number[] = [];
  skinW: number[] = [];
  idx: number[] = [];
  nailStart = -1;

  vert(p: THREE.Vector3, bones: [number, number][], ) {
    const total = bones.reduce((s, b) => s + b[1], 0) || 1;
    const sorted = bones.filter((b) => b[1] > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4);
    while (sorted.length < 4) sorted.push([0, 0]);
    this.pos.push(p.x, p.y, p.z);
    for (const [b, w] of sorted) {
      this.skinIdx.push(b);
      this.skinW.push(w / total);
    }
    return this.pos.length / 3 - 1;
  }

  /** Connects ring a (n vertices starting at ia) to ring b. */
  bridge(ia: number, ib: number, n: number) {
    for (let j = 0; j < n; j++) {
      const a = ia + j;
      const b = ia + ((j + 1) % n);
      const c = ib + ((j + 1) % n);
      const d = ib + j;
      this.idx.push(a, c, b, a, d, c);
    }
  }
}

const RING = 14;

interface TubeOptions {
  joints: THREE.Vector3[]; // base joint .. tip (4 points)
  radii: number[]; // per joint
  bones: number[]; // bone index for each of the 3 segments
  parentBone: number;
  ref: THREE.Vector3; // palm-normal reference for ring orientation
  flat?: number; // depth/width ratio
}

function addTube(b: MeshBuilder, o: TubeOptions) {
  const { joints, radii, bones, parentBone, ref } = o;
  const flat = o.flat ?? 0.9;
  const stations: { c: THREE.Vector3; t: THREE.Vector3; r: number; w: [number, number][] }[] = [];
  const dirs = [0, 1, 2].map((s) => joints[s + 1].clone().sub(joints[s]).normalize());

  // base extension buried inside the palm
  stations.push({ c: joints[0].clone().addScaledVector(dirs[0], -radii[0] * 0.9), t: dirs[0], r: radii[0] * 0.92, w: [[parentBone, 1]] });

  const K = 5;
  for (let s = 0; s < 3; s++) {
    for (let k = 0; k < K; k++) {
      const u = k / K;
      const c = joints[s].clone().lerp(joints[s + 1], u);
      let t = dirs[s].clone();
      if (k === 0 && s > 0) t = dirs[s].clone().add(dirs[s - 1]).normalize();
      const knuckle = 1 + 0.07 * Math.exp(-((u / 0.13) ** 2)) + 0.03 * Math.exp(-(((u - 1) / 0.13) ** 2));
      const r = THREE.MathUtils.lerp(radii[s], radii[s + 1], u) * knuckle;
      const prev = s === 0 ? parentBone : bones[s - 1];
      const w: [number, number][] = [];
      if (u < 0.28) {
        const pw = 0.5 * (1 - u / 0.28);
        w.push([prev, pw], [bones[s], 1 - pw]);
      } else if (u > 0.72 && s < 2) {
        const nw = 0.5 * ((u - 0.72) / 0.28);
        w.push([bones[s], 1 - nw], [bones[s + 1], nw]);
      } else {
        w.push([bones[s], 1]);
      }
      stations.push({ c, t, r, w });
    }
  }
  // tip and rounded cap
  const tipDir = dirs[2];
  const rt = radii[3];
  const capSteps = [0, 0.38, 0.62, 0.8, 0.92, 0.985, 1];
  for (const a of capSteps) {
    const ang = (a * Math.PI) / 2;
    const c = joints[3].clone().addScaledVector(tipDir, Math.sin(ang) * rt * 0.95);
    stations.push({ c, t: tipDir, r: Math.max(rt * Math.cos(ang), 0.0002), w: [[bones[2], 1]] });
  }

  let prevRing = -1;
  for (const st of stations) {
    const lat = new THREE.Vector3().crossVectors(st.t, ref).normalize();
    const nrm = new THREE.Vector3().crossVectors(lat, st.t).normalize();
    const start = b.pos.length / 3;
    for (let j = 0; j < RING; j++) {
      const th = (j / RING) * Math.PI * 2;
      const p = st.c
        .clone()
        .addScaledVector(lat, Math.cos(th) * st.r)
        .addScaledVector(nrm, Math.sin(th) * st.r * flat * (Math.sin(th) > 0 ? 1.04 : 0.96));
      b.vert(p, st.w);
    }
    if (prevRing >= 0) b.bridge(prevRing, start, RING);
    prevRing = start;
  }
  return { stations, dirs };
}

/** Fingernail patch on the dorsal side of the distal segment. */
function addNail(b: MeshBuilder, dip: THREE.Vector3, tip: THREE.Vector3, r: number, ref: THREE.Vector3, bone: number) {
  const t = tip.clone().sub(dip).normalize();
  const lat = new THREE.Vector3().crossVectors(t, ref).normalize();
  const dorsal = new THREE.Vector3().crossVectors(lat, t).normalize().negate();
  const rows = 5;
  const cols = 6;
  const start = b.pos.length / 3;
  for (let i = 0; i < rows; i++) {
    const u = 0.38 + (i / (rows - 1)) * 0.6;
    const c = dip.clone().lerp(tip, u);
    for (let j = 0; j < cols; j++) {
      const a = (-0.95 + (j / (cols - 1)) * 1.9) * (i === rows - 1 ? 0.92 : 1);
      const p = c
        .clone()
        .addScaledVector(lat, Math.sin(a) * r * 0.98)
        .addScaledVector(dorsal, Math.cos(a) * r * 0.97 + r * 0.07);
      b.vert(p, [[bone, 1]]);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = start + i * cols + j;
      const bb = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      b.idx.push(a, bb, c, a, c, d);
    }
  }
}

function knuckleY(x: number, rest: Vec3[]) {
  const pts = [rest[17], rest[13], rest[9], rest[5]].map((p) => [p.x, p.y]);
  if (x <= pts[0][0]) return pts[0][1] - (pts[0][0] - x) * 0.6;
  if (x >= pts[3][0]) return pts[3][1] - (x - pts[3][0]) * 0.9;
  for (let i = 0; i < 3; i++) {
    if (x >= pts[i][0] && x <= pts[i + 1][0]) {
      const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return pts[2][1];
}

function addPalm(b: MeshBuilder, rest: Vec3[]) {
  const U = 22;
  const rows = [0, 0.12, 0.26, 0.42, 0.58, 0.72, 0.84, 0.93, 1];
  const yBottom = -0.038;
  const fingerBases = [5, 9, 13, 17].map((j) => ({ j, x: rest[j].x }));
  const cmc = _v(rest[1]);
  let prevRing = -1;
  let firstRing = -1;
  const lastRingPts: THREE.Vector3[] = [];
  for (const v of rows) {
    const halfW = v < 0.35 ? THREE.MathUtils.lerp(0.026, 0.04, v / 0.35) : THREE.MathUtils.lerp(0.04, 0.0435, (v - 0.35) / 0.65);
    const halfD = v < 0.4 ? THREE.MathUtils.lerp(0.0165, 0.0142, v / 0.4) : THREE.MathUtils.lerp(0.0142, 0.0108, (v - 0.4) / 0.6);
    const xc = THREE.MathUtils.lerp(0.0, -0.002, v);
    const start = b.pos.length / 3;
    lastRingPts.length = 0;
    for (let j = 0; j < U; j++) {
      const th = (j / U) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const ex = 2 / 2.6;
      const x = xc + halfW * Math.sign(c) * Math.pow(Math.abs(c), ex);
      let z = halfD * Math.sign(s) * Math.pow(Math.abs(s), ex);
      // palm side is fuller (thenar / hypothenar pads)
      if (z > 0) z *= 1.12 + 0.1 * Math.exp(-(((x - 0.018) / 0.014) ** 2)) * (v < 0.7 ? 1 : 0.4);
      const yTop = knuckleY(x, rest) - 0.006;
      const y = THREE.MathUtils.lerp(yBottom, yTop, v);
      const p = new THREE.Vector3(x, y, z);
      const w: [number, number][] = [[0, 1]];
      if (v >= 0.7) {
        let nearest = fingerBases[0];
        for (const f of fingerBases) if (Math.abs(f.x - x) < Math.abs(nearest.x - x)) nearest = f;
        const fw = 0.42 * ((v - 0.7) / 0.3);
        w[0][1] = 1 - fw;
        w.push([BONE_INDEX[nearest.j], fw]);
      }
      const dc = p.distanceTo(cmc);
      if (dc < 0.03 && x > 0.008) {
        const tw = 0.4 * (1 - dc / 0.03);
        w[0][1] = Math.max(0.2, w[0][1] - tw);
        w.push([BONE_INDEX[1], tw]);
      }
      b.vert(p, w);
      lastRingPts.push(p);
    }
    if (prevRing >= 0) b.bridge(prevRing, start, U);
    else firstRing = start;
    prevRing = start;
  }
  // top dome (covered by finger bases)
  const top = new THREE.Vector3(-0.002, knuckleY(-0.002, rest) + 0.001, 0);
  const apex = b.vert(top, [[0, 0.6], [BONE_INDEX[9], 0.4]]);
  for (let j = 0; j < U; j++) b.idx.push(prevRing + j, apex, prevRing + ((j + 1) % U));
  // bottom cap
  const bottom = b.vert(new THREE.Vector3(0, yBottom - 0.004, 0), [[0, 1]]);
  for (let j = 0; j < U; j++) b.idx.push(firstRing + j, firstRing + ((j + 1) % U), bottom);
}

const FINGER_RADII: Record<number, number[]> = {
  1: [0.0158, 0.0122, 0.0108, 0.0094],
  5: [0.0102, 0.0094, 0.0085, 0.0076],
  9: [0.0106, 0.0097, 0.0088, 0.0078],
  13: [0.0099, 0.009, 0.0082, 0.0073],
  17: [0.0088, 0.0079, 0.0071, 0.0064],
};

function buildGeometry(side: Handedness) {
  const rest = restJoints('Right');
  const b = new MeshBuilder();
  addPalm(b, rest);
  const palmRef = new THREE.Vector3(0, 0, 1);
  const thumbRef = new THREE.Vector3(-0.75, 0.05, 0.66).normalize();
  const nails: { dip: THREE.Vector3; tip: THREE.Vector3; r: number; ref: THREE.Vector3; bone: number }[] = [];
  for (const chain of CHAINS) {
    const base = chain[0];
    const joints = [base, chain[1], chain[2], CHILD[chain[2]]].map((j) => _v(rest[j]));
    const isThumb = base === 1;
    const ref = isThumb ? thumbRef : palmRef;
    addTube(b, {
      joints,
      radii: FINGER_RADII[base],
      bones: chain.map((j) => BONE_INDEX[j]),
      parentBone: 0,
      ref,
      flat: isThumb ? 0.86 : 0.9,
    });
    nails.push({ dip: joints[2], tip: joints[3], r: FINGER_RADII[base][3] * 1.02, ref, bone: BONE_INDEX[chain[2]] });
  }
  const skinCount = b.idx.length;
  for (const n of nails) addNail(b, n.dip, n.tip, n.r, n.ref, n.bone);

  let pos = b.pos;
  let idx = b.idx;
  if (side === 'Left') {
    pos = pos.map((v, i) => (i % 3 === 0 ? -v : v));
    idx = idx.slice();
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.skinIdx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.skinW, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.addGroup(0, skinCount, 0);
  g.addGroup(skinCount, idx.length - skinCount, 1);
  return g;
}

/* ------------------------------------------------------------------ */
/*                              Materials                               */
/* ------------------------------------------------------------------ */

export function createSkinMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#d9a283'),
    roughness: 0.56,
    metalness: 0,
    sheen: 0.55,
    sheenColor: new THREE.Color('#ff9a7a'),
    sheenRoughness: 0.55,
    clearcoat: 0.06,
    clearcoatRoughness: 0.7,
  });
  // Cheap subsurface scattering: warm translucent rim on grazing angles.
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float sssRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.4);
       outgoingLight += vec3(0.75, 0.2, 0.12) * sssRim * 0.22;
       #include <opaque_fragment>`,
    );
  };
  return m;
}

export function createNailMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e9b9a8'),
    roughness: 0.25,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });
}

/* ------------------------------------------------------------------ */
/*                                Rig                                   */
/* ------------------------------------------------------------------ */

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _d = new THREE.Vector3();

export class HandRig {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  readonly rest: Vec3[];
  private restFrameInv: THREE.Quaternion;
  private restDirs = new Map<number, THREE.Vector3>();
  private scratch = createPoseTarget();

  constructor(
    readonly side: Handedness,
    materials?: THREE.Material[],
  ) {
    this.rest = restJoints(side);
    this.restFrameInv = palmFrame(this.rest).invert();
    for (const j of BONE_JOINTS) {
      if (j === 0) continue;
      this.restDirs.set(j, _v(this.rest[CHILD[j]]).sub(_v(this.rest[j])).normalize());
    }
    const geometry = buildGeometry(side);
    this.mesh = new THREE.SkinnedMesh(geometry, materials ?? [createSkinMaterial(), createNailMaterial()]);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.bones = BONE_JOINTS.map((j) => {
      const bone = new THREE.Bone();
      bone.name = `joint_${j}`;
      if (j !== 0) {
        const p = this.rest[PARENT[j]];
        bone.position.set(this.rest[j].x - p.x, this.rest[j].y - p.y, this.rest[j].z - p.z);
      }
      return bone;
    });
    for (const j of BONE_JOINTS) {
      if (j === 0) continue;
      this.bones[BONE_INDEX[PARENT[j]]].add(this.bones[BONE_INDEX[j]]);
    }
    this.mesh.add(this.bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.group.add(this.mesh);
  }

  get root() {
    return this.bones[0];
  }

  /**
   * Computes bone rotations reproducing the given 21 joint positions
   * (player frame: X right, Y up, Z towards the player).
   */
  solve(joints: Vec3[], out: PoseTarget = createPoseTarget()): PoseTarget {
    palmFrame(joints, out.root).multiply(this.restFrameInv);
    for (const chain of CHAINS) {
      _q.copy(out.root);
      for (const j of chain) {
        const c = CHILD[j];
        _d.set(joints[c].x - joints[j].x, joints[c].y - joints[j].y, joints[c].z - joints[j].z).normalize();
        _qi.copy(_q).invert();
        _d.applyQuaternion(_qi);
        if (PLANAR_JOINTS.has(j)) {
          _d.x *= 0.35;
          _d.normalize();
        }
        const local = out.local[BONE_INDEX[j]];
        local.setFromUnitVectors(this.restDirs.get(j)!, _d);
        _q.multiply(local);
      }
    }
    return out;
  }

  /** Applies a pose immediately. */
  apply(pose: PoseTarget, rootPos?: THREE.Vector3) {
    this.root.quaternion.copy(pose.root);
    for (let i = 1; i < this.bones.length; i++) this.bones[i].quaternion.copy(pose.local[i]);
    if (rootPos) this.root.position.copy(rootPos);
  }

  /** Smoothly moves towards a pose (frame-rate independent). */
  dampTo(pose: PoseTarget, rootPos: THREE.Vector3, dt: number, rotSharpness = 22, posSharpness = 18) {
    const kr = 1 - Math.exp(-rotSharpness * dt);
    const kp = 1 - Math.exp(-posSharpness * dt);
    this.root.quaternion.slerp(pose.root, kr);
    for (let i = 1; i < this.bones.length; i++) this.bones[i].quaternion.slerp(pose.local[i], kr);
    this.root.position.lerp(rootPos, kp);
  }

  /** Convenience: pose from joints at once. */
  setFromJoints(joints: Vec3[], rootPos: THREE.Vector3) {
    this.apply(this.solve(joints, this.scratch), rootPos);
  }

  dispose() {
    this.mesh.geometry.dispose();
    const mats = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    mats.forEach((m) => m.dispose());
    this.mesh.skeleton.dispose();
  }
}

/** Blends two pose targets (slerp) into `out`. */
export function blendPoses(a: PoseTarget, b: PoseTarget, t: number, out: PoseTarget) {
  out.root.copy(a.root).slerp(b.root, t);
  for (let i = 0; i < out.local.length; i++) out.local[i].copy(a.local[i]).slerp(b.local[i], t);
  return out;
}
