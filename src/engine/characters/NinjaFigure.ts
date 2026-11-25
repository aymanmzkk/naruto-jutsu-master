import * as THREE from 'three';
import { emblemTexture } from '../effects/textures';
import { withRim } from '../materials/rimLight';
import { addOutlines, toonMat } from '../materials/toon';

/**
 * NINJA FIGURE — original stylised characters for the third-person shots
 * and the fallback cinematic (a young clan ninja and his father).
 * Rendered in an anime cel-shaded style: 3-tone toon shading, ink outlines
 * (inverted hull) and anime eyes, so they sit next to hand-drawn footage.
 * Built procedurally: tapered limbs, layered clothing (scarf, vest, long
 * coat, leg wraps), a cloth headband with a steel plate engraved with the
 * clan emblem, a face with eyes/brows, hands with fingers, and a warm
 * sunset rim light on every material.
 *
 * Arms are posed by AIM DIRECTIONS (upper arm and forearm directions in
 * torso space), which makes poses easy to author and blend:
 * shoulder = rotation(down → upper), elbow = rotation(down → forearm).
 */

export type FigurePose = 'idle' | 'seal' | 'breath' | 'point' | 'armsCrossed' | 'release';

type V = [number, number, number];
interface ArmDirs {
  upper: V;
  fore: V;
}
interface PoseDef {
  L: ArmDirs;
  R: ArmDirs;
  head: V;
  spine: number;
}

const mirror = (a: ArmDirs): ArmDirs => ({ upper: [-a.upper[0], a.upper[1], a.upper[2]], fore: [-a.fore[0], a.fore[1], a.fore[2]] });
const sym = (left: ArmDirs, head: V = [0, 0, 0], spine = 0): PoseDef => ({ L: left, R: mirror(left), head, spine });

// Left arm directions (torso space: +X = character's left, +Y up, +Z forward)
const POSES: Record<FigurePose, PoseDef> = {
  idle: sym({ upper: [0.13, -1, 0.02], fore: [0.06, -1, 0.16] }),
  seal: sym({ upper: [0.3, -0.7, 0.62], fore: [-0.85, 0.35, 0.4] }, [0.12, 0, 0], 0.04),
  breath: sym({ upper: [0.15, -0.1, 1], fore: [-0.223, 0.189, -0.065] }, [-0.08, 0, 0], -0.06),
  release: sym({ upper: [0.28, -0.8, 0.5], fore: [-0.25, -0.15, 0.95] }, [-0.04, 0, 0], -0.1),
  point: {
    L: { upper: [0.13, -1, 0.02], fore: [0.06, -1, 0.16] },
    R: { upper: [-0.05, -0.12, 1], fore: [0.02, -0.02, 1] },
    head: [0, -0.12, 0],
    spine: 0,
  },
  armsCrossed: {
    L: { upper: [0.25, -0.85, 0.35], fore: [-0.95, 0.12, 0.28] },
    R: { upper: [-0.25, -0.85, 0.3], fore: [0.95, 0.18, 0.2] },
    head: [0.04, 0, 0],
    spine: 0,
  },
};

export interface FigureStyle {
  height: number;
  build: number;
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  robe?: string;
  vest?: string;
  scarf?: string;
  headband: string;
  eyes: string;
  beard?: boolean;
  hairStyle: 'spiky' | 'short';
}

export const SON_STYLE: FigureStyle = {
  height: 1.58,
  build: 0.9,
  shirt: '#1f2a44',
  pants: '#2a2c35',
  skin: '#e2bea8',
  hair: '#141018',
  scarf: '#c8361f',
  headband: '#22325a',
  eyes: '#3a2416',
  hairStyle: 'spiky',
};
export const FATHER_STYLE: FigureStyle = {
  height: 1.84,
  build: 1.15,
  shirt: '#20232c',
  pants: '#25262c',
  skin: '#d2aa92',
  hair: '#141218',
  robe: '#2e2b36',
  vest: '#3b4434',
  headband: '#1c1c22',
  eyes: '#22160e',
  beard: true,
  hairStyle: 'short',
};

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Capsule-like limb segment that tapers from r0 (top) to r1 (bottom). */
function limb(r0: number, r1: number, len: number, mat: THREE.Material) {
  const pts: THREE.Vector2[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r1, -len / 2 - Math.cos(a) * r1));
  }
  for (let i = n; i >= 0; i--) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r0, len / 2 + Math.cos(a) * r0));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function bandTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4ded2';
  g.fillRect(0, 0, 64, 128);
  for (let y = -20; y < 140; y += 11) {
    g.save();
    g.translate(0, y);
    g.rotate(-0.18);
    g.fillStyle = 'rgba(90,80,70,0.35)';
    g.fillRect(-10, 0, 90, 1.5);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(-10, 3, 90, 2);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sphere sculpted into an anime head: narrow jaw, pointed chin, flatter back. */
function animeHeadGeometry() {
  const R = 0.105;
  const g = new THREE.SphereGeometry(R, 40, 30);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const ny = y / R;
    if (ny < 0.15) {
      const t = Math.min(1, (0.15 - ny) / 1.15); // 0 at cheekbones → 1 at the chin
      x *= 1 - 0.5 * t * t;
      z *= z > 0 ? 1 - 0.12 * t : 1 - 0.55 * t;
      z += t * t * 0.022; // chin forward
      y -= t * t * 0.03; // longer face
    }
    if (z < 0) z *= 0.92;
    p.setXYZ(i, x * 0.9, y * 1.04, z);
  }
  g.computeVertexNormals();
  return g;
}

const toon = (params: THREE.MeshToonMaterialParameters) => toonMat(params, 3);

interface ArmState {
  upper: THREE.Vector3;
  fore: THREE.Vector3;
}

export class NinjaFigure {
  readonly group = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private shoulder = { L: new THREE.Group(), R: new THREE.Group() };
  private elbow = { L: new THREE.Group(), R: new THREE.Group() };
  private arms: Record<'L' | 'R', ArmState> = {
    L: { upper: new THREE.Vector3(), fore: new THREE.Vector3() },
    R: { upper: new THREE.Vector3(), fore: new THREE.Vector3() },
  };
  private headRot = new THREE.Vector3();
  private spineX = 0;
  private target: PoseDef = POSES.idle;
  private t = Math.random() * 10;
  private cloth: { obj: THREE.Object3D; base: THREE.Euler; amp: number; phase: number }[] = [];
  poseSpeed = 4;
  readonly mouth = new THREE.Object3D();
  readonly eyes = new THREE.Object3D();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(readonly style: FigureStyle) {
    const s = style.height / 1.7;
    const b = style.build;
    const cloth = (color: string, _rough = 0.88, side: THREE.Side = THREE.FrontSide) => withRim(toon({ color, side }), 0.45, 5);
    const shirt = cloth(style.shirt);
    const pants = cloth(style.pants);
    const skin = withRim(toon({ color: style.skin }), 0.3, 5);
    const hair = withRim(toon({ color: style.hair }), 0.6, 4);
    const bandTex = bandTexture();
    const wrap = withRim(toon({ color: '#ffffff', map: bandTex }), 0.35, 5);
    const sandal = cloth('#17161a', 0.75);
    const dark = new THREE.MeshBasicMaterial({ color: '#0d0a0c' });
    const white = new THREE.MeshBasicMaterial({ color: '#ece4dc' });
    const iris = new THREE.MeshBasicMaterial({ color: style.eyes });
    const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const steel = withRim(toon({ color: '#c3c7cf' }), 0.5);
    const headbandMat = cloth(style.headband, 0.8, THREE.DoubleSide);

    const root = new THREE.Group();
    root.scale.setScalar(s);
    this.group.add(root);

    /* ---------------- legs ---------------- */
    for (const x of [-0.1, 0.1]) {
      const thigh = limb(0.095 * b, 0.075 * b, 0.3, pants);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.072 * b, 16, 12), pants);
      knee.position.set(x * b, 0.52, 0.005);
      root.add(knee);
      thigh.position.set(x * b, 0.71, 0);
      const shin = limb(0.07 * b, 0.058 * b, 0.28, pants);
      shin.position.set(x * b, 0.32, 0);
      const wrapM = new THREE.Mesh(new THREE.CylinderGeometry(0.064 * b, 0.06 * b, 0.16, 16), wrap);
      wrapM.position.set(x * b, 0.15, 0);
      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.045 * b, 0.13, 4, 10), sandal);
      foot.rotation.x = Math.PI / 2;
      foot.scale.set(1.15, 1, 0.6);
      foot.position.set(x * b, 0.035, 0.05);
      foot.castShadow = true;
      root.add(thigh, shin, wrapM, foot);
    }

    /* ---------------- torso ---------------- */
    this.spine.position.y = 0.92;
    root.add(this.spine);
    const torsoProfile = [
      [0.0, -0.02],
      [0.14, 0.0],
      [0.152, 0.12],
      [0.168, 0.3],
      [0.19, 0.45],
      [0.18, 0.53],
      [0.12, 0.585],
      [0.06, 0.61],
    ].map(([x, y]) => new THREE.Vector2(x * b, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 28), shirt);
    torso.scale.z = 0.68;
    torso.castShadow = true;
    this.spine.add(torso);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * b, 0.095 * b, 0.11, 20, 1, true), cloth(style.shirt, 0.88, THREE.DoubleSide));
    collar.position.y = 0.6;
    this.spine.add(collar);

    // clan emblem on the back
    const emblem = new THREE.Mesh(
      new THREE.PlaneGeometry(0.19 * b, 0.19 * b),
      new THREE.MeshStandardMaterial({ map: emblemTexture(), transparent: true, roughness: 0.8 }),
    );
    emblem.position.set(0, 0.37, -0.128 * b);
    emblem.rotation.y = Math.PI;
    this.spine.add(emblem);

    // belt + sash knot
    const beltMat = cloth('#3a2b22', 0.8);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.152 * b, 0.026, 8, 32), beltMat);
    belt.rotation.x = Math.PI / 2;
    belt.scale.y = 0.7;
    belt.position.y = 0.05;
    this.spine.add(belt);
    const hemProfile = [
      [0.15, 0.06],
      [0.17, -0.06],
      [0.2, -0.2],
    ].map(([x, y]) => new THREE.Vector2(x * b, y));
    const hem = new THREE.Mesh(new THREE.LatheGeometry(hemProfile, 28), cloth(style.shirt, 0.88, THREE.DoubleSide));
    hem.scale.z = 0.74;
    hem.castShadow = true;
    this.spine.add(hem);

    if (style.vest) {
      // tactical vest: a thicker shell over the chest with a high collar and pouches
      const vestMat = cloth(style.vest, 0.82);
      const vestProfile = [
        [0.155, 0.1],
        [0.172, 0.22],
        [0.19, 0.36],
        [0.205, 0.46],
        [0.19, 0.54],
        [0.13, 0.59],
      ].map(([x, y]) => new THREE.Vector2(x * b, y));
      const vest = new THREE.Mesh(new THREE.LatheGeometry(vestProfile, 28), vestMat);
      vest.scale.z = 0.72;
      vest.castShadow = true;
      this.spine.add(vest);
      const vCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.085 * b, 0.11 * b, 0.075, 24, 1, true), cloth(style.vest, 0.82, THREE.DoubleSide));
      vCollar.position.y = 0.6;
      this.spine.add(vCollar);
      for (const x of [-0.08, 0.08]) {
        const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.075 * b, 0.085, 0.035), vestMat);
        pouch.position.set(x * b, 0.3, 0.145 * b);
        pouch.castShadow = true;
        this.spine.add(pouch);
      }
    }

    if (style.robe) {
      const robeProfile = [
        [0.21, 0.55],
        [0.215, 0.3],
        [0.235, 0.0],
        [0.275, -0.35],
        [0.31, -0.64],
      ].map(([x, y]) => new THREE.Vector2(x * b, y));
      const robe = new THREE.Mesh(new THREE.LatheGeometry(robeProfile, 32, Math.PI * 0.6, Math.PI * 1.8), cloth(style.robe, 0.9, THREE.DoubleSide));
      robe.scale.z = 0.78;
      robe.castShadow = true;
      this.spine.add(robe);
    }

    if (style.scarf) {
      // long scarf: a thick loop around the neck + two tails flowing behind
      const scarfMat = cloth(style.scarf, 0.9, THREE.DoubleSide);
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.085 * b, 0.034, 10, 28), scarfMat);
      loop.rotation.x = Math.PI / 2 + 0.15;
      loop.position.set(0, 0.6, -0.005);
      loop.castShadow = true;
      this.spine.add(loop);
      for (const [x, len, ph] of [
        [-0.045, 0.5, 0],
        [0.04, 0.38, 1.7],
      ] as const) {
        const pivot = new THREE.Group();
        pivot.position.set(x * b, 0.6, -0.1 * b);
        const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.075, len, 1, 6), scarfMat);
        tail.position.y = -len / 2;
        tail.castShadow = true;
        pivot.add(tail);
        pivot.rotation.set(0.28, 0, x * 1.5);
        this.spine.add(pivot);
        this.cloth.push({ obj: pivot, base: pivot.rotation.clone(), amp: 0.12, phase: ph });
      }
    }

    /* ---------------- head ---------------- */
    this.head.position.y = 0.66;
    this.spine.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.11, 14), skin);
    neck.position.y = 0.02;
    this.head.add(neck);
    // one smooth anime-style head: round cranium tapering to a pointed chin
    // (a single surface, so the cel shading has no seams across the face)
    const skull = new THREE.Mesh(animeHeadGeometry(), skin);
    skull.position.y = 0.145;
    skull.castShadow = true;
    this.head.add(skull);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), skin);
      ear.scale.set(0.5, 1, 0.75);
      ear.position.set(side * 0.093, 0.138, -0.004);
      this.head.add(ear);
      // eyes: white, iris, highlight
      const eyeG = new THREE.Group();
      eyeG.position.set(side * 0.036, 0.148, 0.0935);
      eyeG.rotation.set(0, side * 0.24, 0);
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.018, 18, 12), white);
      sclera.scale.set(1.3, 0.85, 0.38);
      const ir = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 16, 12), iris);
      ir.scale.set(0.85, 1.05, 0.35);
      ir.position.set(side * -0.002, -0.001, 0.0055);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 8), dark);
      pupil.scale.set(0.9, 1.1, 0.3);
      pupil.position.set(side * -0.002, -0.001, 0.0082);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), shine);
      glint.position.set(side * -0.0045 + 0.002, 0.004, 0.0095);
      // thick upper lash line, flicked up at the outer corner
      const lash = new THREE.Mesh(new THREE.CapsuleGeometry(0.0026, 0.036, 3, 6), dark);
      lash.rotation.z = Math.PI / 2 + side * 0.18;
      lash.position.set(side * 0.002, 0.0135, 0.005);
      eyeG.add(sclera, ir, pupil, glint, lash);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.032, 3, 6), hair);
      brow.rotation.order = 'ZYX';
      brow.position.set(side * 0.037, 0.178, 0.096);
      brow.rotation.z = Math.PI / 2 + side * (style.hairStyle === 'short' ? 0.22 : 0.1);
      this.head.add(eyeG, brow);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.024, 8), skin);
    nose.rotation.x = Math.PI / 2 + 0.25;
    nose.position.set(0, 0.127, 0.104);
    const mouthLine = new THREE.Mesh(new THREE.CapsuleGeometry(0.002, 0.022, 2, 6), new THREE.MeshStandardMaterial({ color: '#7a3c34', roughness: 0.6 }));
    mouthLine.rotation.z = Math.PI / 2;
    mouthLine.position.set(0, 0.097, 0.097);
    this.head.add(nose, mouthLine);
    if (style.beard) {
      // short chin beard + sideburns (leaves the mouth visible)
      const goatee = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 10), hair);
      goatee.rotation.x = Math.PI + 0.35;
      goatee.position.set(0, 0.052, 0.098);
      this.head.add(goatee);
      for (const side of [-1, 1]) {
        const burn = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.05, 3, 6), hair);
        burn.position.set(side * 0.084, 0.118, 0.035);
        burn.rotation.set(0.25, 0, side * 0.12);
        this.head.add(burn);
      }
    }
    this.addHair(hair, style.hairStyle);

    // headband: cloth ring + engraved steel plate + two tails at the back
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.028, 32, 1, true), headbandMat);
    band.scale.set(0.93, 1, 1.03);
    band.position.set(0, 0.19, 0.0);
    band.rotation.x = -0.12;
    this.head.add(band);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.032, 0.006), steel);
    plate.position.set(0, 0.196, 0.101);
    plate.rotation.x = -0.12;
    this.head.add(plate);
    const engraving = new THREE.Mesh(
      new THREE.PlaneGeometry(0.026, 0.026),
      new THREE.MeshStandardMaterial({ map: emblemTexture(), transparent: true, roughness: 0.5, color: '#4a4d55' }),
    );
    engraving.position.set(0, 0.1965, 0.1045);
    engraving.rotation.x = -0.12;
    this.head.add(engraving);
    for (const [x, ph] of [
      [-0.012, 0.6],
      [0.014, 2.2],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.185, -0.098);
      const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.16, 1, 4), headbandMat);
      tail.position.y = -0.08;
      pivot.add(tail);
      pivot.rotation.set(0.55, 0, x * 18);
      this.head.add(pivot);
      this.cloth.push({ obj: pivot, base: pivot.rotation.clone(), amp: 0.2, phase: ph });
    }

    this.mouth.position.set(0, 0.1, 0.12);
    this.eyes.position.set(0, 0.155, 0.09);
    this.head.add(this.mouth, this.eyes);

    /* ---------------- arms ---------------- */
    const sleeveMat = style.robe ? cloth(style.robe, 0.9) : shirt;
    for (const side of ['L', 'R'] as const) {
      const sgn = side === 'L' ? 1 : -1;
      const sh = this.shoulder[side];
      const el = this.elbow[side];
      sh.position.set(sgn * 0.205 * b, 0.5, 0);
      this.spine.add(sh);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.062 * b, 18, 12), sleeveMat);
      cap.castShadow = true;
      sh.add(cap);
      const upper = limb(0.058 * b, 0.048 * b, 0.2, sleeveMat);
      upper.position.y = -0.14;
      sh.add(upper);
      el.position.y = -0.29;
      sh.add(el);
      const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.05 * b, 14, 10), sleeveMat);
      el.add(elbowBall);
      const fore = limb(0.047 * b, 0.038 * b, 0.19, wrap);
      fore.position.y = -0.125;
      el.add(fore);
      el.add(this.makeHand(skin, sgn, b));
      const st = this.arms[side];
      const def = POSES.idle[side];
      st.upper.set(...def.upper).normalize();
      st.fore.set(...def.fore).normalize();
    }
    addOutlines(root, 2.2);
    this.applyArms();
  }

  /** Hand with palm, four slightly curled fingers and a thumb. */
  private makeHand(skin: THREE.Material, sgn: number, b: number) {
    const hand = new THREE.Group();
    hand.position.y = -0.255;
    hand.scale.setScalar(b);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), skin);
    palm.scale.set(0.95, 1.15, 0.5);
    palm.position.y = -0.025;
    palm.castShadow = true;
    hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.017;
      const len = [0.036, 0.042, 0.04, 0.031][i];
      const f = new THREE.Group();
      f.position.set(x, -0.062, 0.002);
      f.rotation.x = 0.35 + i * 0.05;
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0078, len, 4, 8), skin);
      seg.position.y = -len / 2;
      seg.castShadow = true;
      f.add(seg);
      hand.add(f);
    }
    const thumb = new THREE.Group();
    thumb.position.set(sgn * 0.028, -0.03, 0.012);
    thumb.rotation.set(0.5, 0, sgn * 0.75);
    const tseg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.032, 4, 8), skin);
    tseg.position.y = -0.02;
    thumb.add(tseg);
    hand.add(thumb);
    return hand;
  }

  private addHair(mat: THREE.Material, style: 'spiky' | 'short') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.114, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
    cap.scale.set(0.96, 1.08, 1.06);
    cap.position.set(0, 0.16, -0.008);
    cap.rotation.x = -0.3;
    cap.castShadow = true;
    this.head.add(cap);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.106, 20, 14), mat);
    back.scale.set(0.96, 1.0, 0.82);
    back.position.set(0, 0.142, -0.032);
    this.head.add(back);

    if (style === 'spiky') {
      // layered spikes sweeping back and up
      const rows = [
        { n: 9, y: 0.235, r: 0.05, len: 0.11, tilt: 0.85 },
        { n: 11, y: 0.2, r: 0.085, len: 0.12, tilt: 0.45 },
        { n: 9, y: 0.135, r: 0.098, len: 0.1, tilt: -0.05 },
      ];
      rows.forEach((row, ri) => {
        for (let i = 0; i < row.n; i++) {
          const a = (i / row.n) * Math.PI * 2 + ri * 0.3;
          if (Math.cos(a) > 0.45) continue; // keep the face clear
          const len = row.len * (0.8 + (((i * 37 + ri * 11) % 9) / 9) * 0.5);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, len, 7), mat);
          cone.position.set(Math.sin(a) * row.r, row.y, Math.cos(a) * row.r - 0.015);
          const out = new THREE.Vector3(Math.sin(a), row.tilt, Math.cos(a) - 0.55).normalize();
          cone.quaternion.setFromUnitVectors(UP, out);
          cone.castShadow = true;
          this.head.add(cone);
        }
      });
      // side locks framing the face
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const lock = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1 - k * 0.012, 6), mat);
          lock.position.set(side * (0.088 + k * 0.004), 0.17 - k * 0.012, 0.045 - k * 0.03);
          lock.quaternion.setFromUnitVectors(UP, new THREE.Vector3(side * 0.25, -1, 0.15).normalize());
          lock.castShadow = true;
          this.head.add(lock);
        }
      }
      // bangs over the forehead (above the headband)
      for (let i = -2; i <= 2; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.085, 6), mat);
        f.position.set(i * 0.027, 0.24, 0.083);
        f.quaternion.setFromUnitVectors(UP, new THREE.Vector3(i * 0.22, -0.75, 0.6).normalize());
        this.head.add(f);
      }
    } else {
      // short, swept-back hair with a small tied tail
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        if (Math.cos(a) > 0.5) continue;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 6), mat);
        cone.position.set(Math.sin(a) * 0.088, 0.205, Math.cos(a) * 0.088 - 0.012);
        cone.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.sin(a), 0.35, Math.cos(a) - 0.6).normalize());
        this.head.add(cone);
      }
      const tie = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), mat);
      tie.scale.set(1, 0.8, 1.2);
      tie.position.set(0, 0.215, -0.1);
      this.head.add(tie);
    }
  }

  setPose(p: FigurePose, speed = 4) {
    this.target = POSES[p];
    this.poseSpeed = speed;
  }

  private applyArms() {
    for (const side of ['L', 'R'] as const) {
      const st = this.arms[side];
      const sh = this.shoulder[side];
      sh.quaternion.setFromUnitVectors(DOWN, st.upper);
      // forearm direction expressed in the shoulder's local frame
      this.tmpQ.copy(sh.quaternion).invert();
      this.tmpV.copy(st.fore).applyQuaternion(this.tmpQ).normalize();
      this.elbow[side].quaternion.setFromUnitVectors(DOWN, this.tmpV);
    }
    this.head.rotation.set(this.headRot.x, this.headRot.y, this.headRot.z);
    this.spine.rotation.x = this.spineX;
  }

  update(dt: number) {
    this.t += dt;
    const k = 1 - Math.exp(-this.poseSpeed * dt);
    for (const side of ['L', 'R'] as const) {
      const st = this.arms[side];
      const def = this.target[side];
      st.upper.lerp(this.tmpV.set(...def.upper).normalize(), k).normalize();
      st.fore.lerp(this.tmpV.set(...def.fore).normalize(), k).normalize();
    }
    this.headRot.lerp(this.tmpV.set(...this.target.head), k);
    this.spineX += (this.target.spine - this.spineX) * k;
    this.applyArms();
    const br = Math.sin(this.t * 1.7) * 0.012;
    this.spine.scale.set(1 + br * 0.4, 1 + br * 0.3, 1 + br);
    this.head.rotation.x += Math.sin(this.t * 0.6) * 0.015;
    // cloth flutter in the lake breeze
    for (const c of this.cloth) {
      const w = Math.sin(this.t * 2.3 + c.phase) * 0.6 + Math.sin(this.t * 5.1 + c.phase * 2) * 0.4;
      c.obj.rotation.set(c.base.x + Math.abs(w) * c.amp, c.base.y + w * c.amp * 0.5, c.base.z + w * c.amp * 0.4);
    }
  }

  mouthWorld(out = new THREE.Vector3()) {
    return this.mouth.getWorldPosition(out);
  }

  eyesWorld(out = new THREE.Vector3()) {
    return this.eyes.getWorldPosition(out);
  }
}
