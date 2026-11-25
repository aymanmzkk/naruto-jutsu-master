import * as THREE from 'three';

/**
 * Pooled GPU-rendered particle system (CPU simulation, one draw call).
 * Each particle has a color ramp over its life, size over life, drag,
 * buoyancy and per-particle rotation of the sprite.
 */

export type ColorRamp = (t: number, out: THREE.Color) => { color: THREE.Color; alpha: number };

export interface EmitOptions {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  size: number;
  sizeEnd: number;
  ramp: ColorRamp;
  drag?: number;
  buoyancy?: number;
  intensity?: number;
}

const vertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aRot;
  varying vec4 vColor;
  varying float vRot;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uScale / max(0.05, -mv.z), 360.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uGain;
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = mat2(c, -s, s, c) * uv + 0.5;
    vec4 tex = texture2D(uMap, uv);
    gl_FragColor = vec4(vColor.rgb * tex.rgb * uGain, vColor.a * tex.a);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private alive = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private drag: Float32Array;
  private buoy: Float32Array;
  private inten: Float32Array;
  private rot: Float32Array;
  private rotSpeed: Float32Array;
  private ramps: ColorRamp[];
  private aPos: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aColor: THREE.BufferAttribute;
  private aRot: THREE.BufferAttribute;
  private tmp = new THREE.Color();
  readonly material: THREE.ShaderMaterial;

  constructor(max: number, map: THREE.Texture, blending: THREE.Blending, scale = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.buoy = new Float32Array(max);
    this.inten = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotSpeed = new Float32Array(max);
    this.ramps = new Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aRot', this.aRot);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: scale }, uGain: { value: 1 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  get count() {
    return this.alive;
  }

  emit(o: EmitOptions) {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    this.pos[i * 3] = o.position.x;
    this.pos[i * 3 + 1] = o.position.y;
    this.pos[i * 3 + 2] = o.position.z;
    this.vel[i * 3] = o.velocity.x;
    this.vel[i * 3 + 1] = o.velocity.y;
    this.vel[i * 3 + 2] = o.velocity.z;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.size0[i] = o.size;
    this.size1[i] = o.sizeEnd;
    this.drag[i] = o.drag ?? 1;
    this.buoy[i] = o.buoyancy ?? 0;
    this.inten[i] = o.intensity ?? 1;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.rotSpeed[i] = (Math.random() - 0.5) * 2;
    this.ramps[i] = o.ramp;
  }

  private kill(i: number) {
    const last = --this.alive;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size0[i] = this.size0[last];
    this.size1[i] = this.size1[last];
    this.drag[i] = this.drag[last];
    this.buoy[i] = this.buoy[last];
    this.inten[i] = this.inten[last];
    this.rot[i] = this.rot[last];
    this.rotSpeed[i] = this.rotSpeed[last];
    this.ramps[i] = this.ramps[last];
  }

  update(dt: number) {
    for (let i = this.alive - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.buoy[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.rot[i] += this.rotSpeed[i] * dt;
    }
    const P = this.aPos.array as Float32Array;
    const S = this.aSize.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    const R = this.aRot.array as Float32Array;
    for (let i = 0; i < this.alive; i++) {
      const t = this.age[i] / this.life[i];
      P[i * 3] = this.pos[i * 3];
      P[i * 3 + 1] = this.pos[i * 3 + 1];
      P[i * 3 + 2] = this.pos[i * 3 + 2];
      S[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const { color, alpha } = this.ramps[i](t, this.tmp);
      C[i * 4] = color.r * this.inten[i];
      C[i * 4 + 1] = color.g * this.inten[i];
      C[i * 4 + 2] = color.b * this.inten[i];
      C[i * 4 + 3] = alpha;
      R[i] = this.rot[i];
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aRot.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.alive);
  }

  clear() {
    this.alive = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/* ---- color ramps ---- */

const FIRE_STOPS: [number, number, number, number, number][] = [
  // t, r, g, b, alpha  — hot yellow core → orange → deep red → gone
  [0.0, 1.0, 0.72, 0.32, 0.0],
  [0.07, 1.0, 0.55, 0.16, 0.95],
  [0.28, 1.0, 0.34, 0.05, 0.85],
  [0.55, 0.85, 0.16, 0.02, 0.55],
  // flames stay red while they fade out (they are drawn solid, not additive)
  [0.8, 0.62, 0.08, 0.01, 0.25],
  [1.0, 0.5, 0.05, 0.0, 0.0],
];

export const fireRamp: ColorRamp = (t, out) => {
  let i = 0;
  while (i < FIRE_STOPS.length - 2 && t > FIRE_STOPS[i + 1][0]) i++;
  const a = FIRE_STOPS[i];
  const b = FIRE_STOPS[i + 1];
  const k = (t - a[0]) / (b[0] - a[0]);
  out.setRGB(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
  return { color: out, alpha: a[4] + (b[4] - a[4]) * k };
};

export const smokeRamp: ColorRamp = (t, out) => {
  // starts lit from below by the fire (warm brown), cools to dark grey
  // daylight anime smoke: warm brown-grey near the fire, then light grey
  const warm = Math.max(0, 1 - t * 4);
  const v = 0.55 + 0.12 * t;
  out.setRGB(v + warm * 0.1, v * 0.97 - warm * 0.08, v * 0.98 - warm * 0.15);
  // appears only once the fireball has moved on (never covers it), then fades
  const alpha = t < 0.22 ? 0 : t < 0.36 ? ((t - 0.22) / 0.14) * 0.5 : 0.5 * Math.pow(1 - (t - 0.36) / 0.64, 1.2);
  return { color: out, alpha };
};

export const emberRamp: ColorRamp = (t, out) => {
  out.setRGB(1.0, 0.55 - t * 0.35, 0.15 - t * 0.1);
  return { color: out, alpha: (1 - t) * (0.6 + 0.4 * Math.sin(t * 40)) };
};

export const steamRamp: ColorRamp = (t, out) => {
  out.setRGB(0.85, 0.88, 0.92);
  const alpha = t < 0.1 ? (t / 0.1) * 0.2 : 0.2 * Math.pow(1 - (t - 0.1) / 0.9, 1.3);
  return { color: out, alpha };
};
