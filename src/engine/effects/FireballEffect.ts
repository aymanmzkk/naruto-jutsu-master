import * as THREE from 'three';
import { ParticleSystem, emberRamp, fireRamp, smokeRamp, steamRamp } from './ParticleSystem';
import { flameSprite, smokeSprite, softDot } from './textures';
import { easeOutCubic } from '../../utils/math';

/**
 * GREAT FIREBALL — the visual highlight.
 *
 *  breath   : a cone of flame streams from the caster's mouth and gathers
 *             into a growing sphere of fire
 *  travel   : the fireball flies over the lake, trailing flames, smoke and
 *             embers, lighting the environment (dynamic point light)
 *  impact   : flash, shockwave ring on the water, explosion burst, steam
 *  burn     : afterglow fires and embers that slowly die out
 *
 * The core is a noise-displaced sphere with an animated fbm shader
 * (volumetric look), plus an additive halo, so it is a real 3D effect.
 */

const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.02; a *= 0.5; } return s; }
`;

function makeCoreMaterial(layer: 'inner' | 'outer') {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uOpacity: { value: 1 }, uFlow: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFlow;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vDisp;
      ${NOISE_GLSL}
      void main() {
        vec3 p = position;
        float d = fbm(normalize(p) * 1.6 + uFlow * 0.15 + vec3(0.0, -uTime * 1.4, uTime * 0.6));
        float amp = ${layer === 'outer' ? '0.32' : '0.12'};
        p += normal * d * amp;
        // stretch backwards along the flight direction (comet-like)
        float back = max(0.0, -dot(normalize(p), normalize(uFlow + vec3(1e-4))));
        p -= normalize(uFlow + vec3(1e-4)) * back * back * ${layer === 'outer' ? '0.55' : '0.2'} * min(1.0, length(uFlow) * 0.08);
        vDisp = d;
        vPos = p;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = normalize(-mv.xyz);
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uHeat;
      uniform float uOpacity;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vDisp;
      ${NOISE_GLSL}
      vec3 ramp(float t) {
        // anime fire palette: deep red edge → orange → yellow → pale core
        vec3 c0 = vec3(0.55, 0.05, 0.0);
        vec3 c1 = vec3(0.86, 0.16, 0.0);
        vec3 c2 = vec3(1.0, 0.36, 0.02);
        vec3 c3 = vec3(1.0, 0.62, 0.06);
        vec3 c4 = vec3(1.0, 0.9, 0.45);
        if (t < 0.25) return mix(c0, c1, t / 0.25);
        if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
        if (t < 0.78) return mix(c2, c3, (t - 0.5) / 0.28);
        return mix(c3, c4, (t - 0.78) / 0.22);
      }
      void main() {
        vec3 q = vPos * 1.5 + vec3(0.0, -uTime * 2.4, uTime * 0.8);
        float n = fbm(q);
        // ridged turbulence → bright flame filaments over darker billows
        float ridge = 1.0 - abs(fbm(q * 1.9 + n * 1.3));
        ridge = pow(ridge, 3.0);
        float fres = pow(clamp(1.0 - abs(dot(vNormal, vView)), 0.0, 1.0), ${layer === 'outer' ? '1.3' : '2.0'});
        float t = clamp(0.36 + n * 0.55 + ridge * 0.5 + vDisp * 0.3 - fres * 0.4, 0.0, 1.0) * uHeat;
        ${
          layer === 'outer'
            ? `// additive flame tongues around the body
        // cel flame tongues: 3 flat colour bands, hard edge
        // cel flame tongues licking around the silhouette
        vec3 col = ramp(floor(t * 3.0) / 3.0 + 0.1);
        float a = step(0.55, t) * smoothstep(0.3, 0.55, fres);`
            : `// opaque body of fire: dark billows + HDR-hot filaments (bloom)
        // anime fire body: 4 flat colour bands, crisp silhouette
        float tq = floor(t * 4.0) / 4.0 + 0.14;
        vec3 col = ramp(tq);
        float a = step(0.1, t) * step(fres, 0.93);`
        }
        gl_FragColor = vec4(col, a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: layer === 'outer' ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export type FireballPhase = 'idle' | 'breath' | 'travel' | 'impact' | 'burn' | 'done';

export interface LaunchOptions {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  target: THREE.Vector3;
  power?: number;
  onImpact?: () => void;
  onDone?: () => void;
}

export class FireballEffect {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  readonly flashLight: THREE.PointLight;
  phase: FireballPhase = 'idle';
  private core = new THREE.Group();
  private inner: THREE.Mesh;
  private outer: THREE.Mesh;
  private halo: THREE.Sprite;
  private fire: ParticleSystem;
  private smoke: ParticleSystem;
  private embers: ParticleSystem;
  private shock: THREE.Mesh;
  private opts: LaunchOptions | null = null;
  private t = 0;
  private phaseT = 0;
  private radius = 0.1;
  private power = 1;
  private velocity = new THREE.Vector3();
  private start = new THREE.Vector3();
  private impactPoint = new THREE.Vector3();
  readonly position = new THREE.Vector3();
  /** 0..1, how much light the fire emits (for water reflections, UI). */
  intensity = 0;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private impactFired = false;

  constructor(scene: THREE.Scene) {
    this.inner = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), makeCoreMaterial('inner'));
    this.outer = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 5), makeCoreMaterial('outer'));
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot(), color: '#ff4a08', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.16, fog: false }),
    );
    this.halo.scale.setScalar(6);
    this.halo.visible = false; // no soft glow halo in the daylight anime look
    this.core.add(this.inner, this.outer, this.halo);
    this.core.visible = false;
    this.group.add(this.core);

    // solid cel flames (normal blending): additive glow washes out against a bright day sky
    this.fire = new ParticleSystem(2600, flameSprite(1), THREE.NormalBlending, 700);
    this.fire.material.uniforms.uGain.value = 3.6;
    this.smoke = new ParticleSystem(900, smokeSprite(2), THREE.NormalBlending, 700);
    this.embers = new ParticleSystem(900, softDot(), THREE.AdditiveBlending, 260);
    this.smoke.points.renderOrder = 1;
    this.fire.points.renderOrder = 2;
    this.embers.points.renderOrder = 3;
    this.group.add(this.smoke.points, this.fire.points, this.embers.points);

    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform float uT; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0; float ring = smoothstep(uT - 0.18, uT, r) * (1.0 - smoothstep(uT, uT + 0.04, r));
        vec3 c = mix(vec3(1.0,0.4,0.08), vec3(1.0,0.85,0.6), ring); gl_FragColor = vec4(c * 2.0, ring * (1.0 - uT) * 0.9); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.visible = false;
    this.group.add(this.shock);

    this.light = new THREE.PointLight('#ff7a2a', 0, 140, 1.25);
    this.flashLight = new THREE.PointLight('#ffd2a0', 0, 220, 1.1);
    this.group.add(this.light, this.flashLight);
    scene.add(this.group);
  }

  get busy() {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  launch(o: LaunchOptions) {
    this.opts = o;
    this.power = o.power ?? 1;
    this.phase = 'breath';
    this.phaseT = 0;
    this.radius = 0.15;
    this.start.copy(o.origin);
    this.position.copy(o.origin).addScaledVector(o.direction, 3.4);
    this.velocity.copy(o.direction).multiplyScalar(2.2);
    this.core.visible = true;
    this.shock.visible = false;
    this.impactFired = false;
    this.fire.clear();
    this.smoke.clear();
    this.embers.clear();
  }

  reset() {
    this.phase = 'idle';
    this.core.visible = false;
    this.shock.visible = false;
    this.fire.clear();
    this.smoke.clear();
    this.embers.clear();
    this.light.intensity = 0;
    this.flashLight.intensity = 0;
    this.intensity = 0;
  }

  private rand(v: THREE.Vector3, s: number) {
    return v.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  private emitStream(dt: number) {
    const o = this.opts!;
    const n = Math.floor(dt * 260);
    for (let i = 0; i < n; i++) {
      const spread = this.rand(this.tmpV2, 0.5);
      const v = this.tmpV.copy(o.direction).multiplyScalar(10 + Math.random() * 6).add(spread.multiplyScalar(3.5));
      this.fire.emit({
        position: this.tmpV2.copy(o.origin).addScaledVector(o.direction, 1.0 + Math.random() * 0.5),
        velocity: v.clone(),
        life: 0.35 + Math.random() * 0.35,
        size: 0.14,
        sizeEnd: 0.8 + Math.random() * 0.6,
        ramp: fireRamp,
        drag: 2.4,
        buoyancy: 1.5,
        intensity: 0.24,
      });
    }
  }

  private emitTrail(dt: number) {
    const R = this.radius;
    // comet tail: flames peel off the back half of the ball and stay behind it
    const back = this.tmpV2.copy(this.velocity).normalize().negate();
    const nFire = Math.floor(dt * 170 * this.power);
    for (let i = 0; i < nFire; i++) {
      const dir = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).normalize();
      if (dir.dot(back) < 0) dir.addScaledVector(back, -2 * dir.dot(back));
      const p = this.tmpV.copy(this.position).addScaledVector(dir, R * (0.75 + Math.random() * 0.3));
      const v = dir.clone().multiplyScalar(1.2 + Math.random() * 1.6).addScaledVector(this.velocity, 0.05);
      this.fire.emit({ position: p.clone(), velocity: v, life: 0.45 + Math.random() * 0.55, size: R * 0.55, sizeEnd: R * 1.35, ramp: fireRamp, drag: 1.4, buoyancy: 2.5, intensity: 0.15 });
    }
    const nSmoke = Math.floor(dt * 55 * this.power);
    for (let i = 0; i < nSmoke; i++) {
      const dir = this.rand(this.tmpV2, 2).normalize();
      const p = this.tmpV.copy(this.position).addScaledVector(dir, R * 0.9);
      this.smoke.emit({ position: p.clone(), velocity: dir.multiplyScalar(0.8).setY(1.2), life: 2.2 + Math.random() * 1.5, size: R * 1.4, sizeEnd: R * 4.5, ramp: smokeRamp, drag: 0.9, buoyancy: 0.9 });
    }
    const nEmb = Math.floor(dt * 120);
    for (let i = 0; i < nEmb; i++) {
      const dir = this.rand(this.tmpV2, 2).normalize();
      this.embers.emit({
        position: this.tmpV.copy(this.position).addScaledVector(dir, R).clone(),
        velocity: dir.multiplyScalar(3 + Math.random() * 5).setY(2 + Math.random() * 3),
        life: 0.8 + Math.random() * 1.4,
        size: 0.12,
        sizeEnd: 0.03,
        ramp: emberRamp,
        drag: 0.8,
        buoyancy: -2.5,
        intensity: 2,
      });
    }
  }

  private explode() {
    const P = this.impactPoint.copy(this.position);
    const R = this.radius;
    for (let i = 0; i < 450 * this.power; i++) {
      const dir = this.rand(this.tmpV2, 2).normalize();
      dir.y = Math.abs(dir.y) * 0.8 + 0.1;
      this.fire.emit({
        position: this.tmpV.copy(P).addScaledVector(dir, R * Math.random() * 0.8).clone(),
        velocity: dir.clone().multiplyScalar(6 + Math.random() * 16),
        life: 0.7 + Math.random() * 1.1,
        size: R * 0.7,
        sizeEnd: R * 2.4,
        ramp: fireRamp,
        drag: 2.6,
        buoyancy: 3,
        intensity: 0.34,
      });
    }
    for (let i = 0; i < 160; i++) {
      const dir = this.rand(this.tmpV2, 2).normalize();
      dir.y = Math.abs(dir.y);
      this.smoke.emit({
        position: this.tmpV.copy(P).addScaledVector(dir, R).clone(),
        velocity: dir.clone().multiplyScalar(2 + Math.random() * 4).setY(2 + Math.random() * 3),
        life: 3.5 + Math.random() * 3,
        size: R * 2,
        sizeEnd: R * 7,
        ramp: smokeRamp,
        drag: 0.7,
        buoyancy: 0.6,
      });
    }
    for (let i = 0; i < 360; i++) {
      const dir = this.rand(this.tmpV2, 2).normalize();
      dir.y = Math.abs(dir.y) + 0.3;
      this.embers.emit({
        position: P.clone(),
        velocity: dir.clone().multiplyScalar(8 + Math.random() * 22),
        life: 1.4 + Math.random() * 2,
        size: 0.22,
        sizeEnd: 0.04,
        ramp: emberRamp,
        drag: 0.6,
        buoyancy: -6,
        intensity: 2.5,
      });
    }
    // steam from the water surface
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R * 3;
      this.smoke.emit({
        position: new THREE.Vector3(P.x + Math.cos(a) * r, 0.3, P.z + Math.sin(a) * r),
        velocity: new THREE.Vector3(Math.cos(a) * 1.5, 1.5 + Math.random() * 2, Math.sin(a) * 1.5),
        life: 3 + Math.random() * 3,
        size: R * 1.2,
        sizeEnd: R * 5,
        ramp: steamRamp,
        drag: 0.6,
        buoyancy: 0.5,
      });
    }
    this.shock.position.set(P.x, 0.08, P.z);
    this.shock.visible = true;
    this.flashLight.position.copy(P);
  }

  update(dt: number) {
    this.t += dt;
    this.phaseT += dt;
    const o = this.opts;
    for (const m of [this.inner, this.outer]) {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = this.t;
      u.uFlow.value.copy(this.velocity);
    }

    if (o && this.phase === 'breath') {
      this.emitStream(dt);
      const k = Math.min(1, this.phaseT / 1.1);
      this.radius = 0.2 + easeOutCubic(k) * 2.3 * this.power;
      this.position.copy(o.origin).addScaledVector(o.direction, 3.4 + k * (this.radius + 3.2));
      if (this.phaseT > 1.1) {
        this.phase = 'travel';
        this.phaseT = 0;
        this.start.copy(this.position);
      }
    } else if (o && this.phase === 'travel') {
      if (this.phaseT < 0.35) this.emitStream(dt * (1 - this.phaseT / 0.35));
      const total = this.start.distanceTo(o.target);
      const dur = 2.3;
      const k = Math.min(1, this.phaseT / dur);
      const e = k * k * (2.2 - 1.2 * k); // accelerate then settle
      const prev = this.tmpV.copy(this.position);
      this.position.lerpVectors(this.start, o.target, e);
      this.position.y += Math.sin(k * Math.PI) * total * 0.04;
      this.velocity.copy(this.position).sub(prev).divideScalar(Math.max(dt, 1e-3));
      this.radius = (2.5 + k * 1.4) * this.power;
      this.emitTrail(dt);
      if (k >= 1) {
        this.phase = 'impact';
        this.phaseT = 0;
        this.explode();
      }
    } else if (this.phase === 'impact') {
      const k = Math.min(1, this.phaseT / 0.55);
      this.radius = (3.9 + k * 4) * this.power;
      const op = 1 - k;
      (this.inner.material as THREE.ShaderMaterial).uniforms.uOpacity.value = op;
      (this.outer.material as THREE.ShaderMaterial).uniforms.uOpacity.value = op;
      (this.halo.material as THREE.SpriteMaterial).opacity = 0.16 * op;
      const sk = Math.min(1, this.phaseT / 1.6);
      this.shock.scale.setScalar(4 + sk * 60);
      (this.shock.material as THREE.ShaderMaterial).uniforms.uT.value = 0.25 + sk * 0.75;
      this.flashLight.intensity = 1100 * Math.exp(-this.phaseT * 5) * this.power;
      if (!this.impactFired) {
        this.impactFired = true;
        o?.onImpact?.();
      }
      if (this.phaseT > 1.6) {
        this.phase = 'burn';
        this.phaseT = 0;
        this.core.visible = false;
        this.shock.visible = false;
      }
    } else if (this.phase === 'burn') {
      const life = 1 - Math.min(1, this.phaseT / 7);
      const n = Math.floor(dt * 160 * life);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 5;
        this.fire.emit({
          position: new THREE.Vector3(this.impactPoint.x + Math.cos(a) * r, 0.2 + Math.random() * 1.5, this.impactPoint.z + Math.sin(a) * r),
          velocity: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6),
          life: 0.6 + Math.random() * 0.8,
          size: 1.1,
          sizeEnd: 2.6,
          ramp: fireRamp,
          drag: 1,
          buoyancy: 2,
          intensity: 0.4 * life,
        });
      }
      if (Math.random() < dt * 30 * life) {
        this.smoke.emit({
          position: this.impactPoint.clone().setY(2.5),
          velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.6, (Math.random() - 0.5) * 0.8),
          life: 5,
          size: 3,
          sizeEnd: 11,
          ramp: smokeRamp,
          drag: 0.4,
          buoyancy: 0.3,
        });
      }
      this.flashLight.intensity = 0;
      if (this.phaseT > 7.5 && this.fire.count === 0) {
        this.phase = 'done';
        o?.onDone?.();
      }
    }

    // core visuals
    this.core.position.copy(this.position);
    this.core.scale.setScalar(this.radius);
    this.halo.scale.setScalar(4.2);
    const heat = this.phase === 'breath' ? 0.85 + Math.min(0.15, this.phaseT * 0.2) : 1;
    (this.inner.material as THREE.ShaderMaterial).uniforms.uHeat.value = heat;
    (this.outer.material as THREE.ShaderMaterial).uniforms.uHeat.value = heat;
    if (this.phase === 'breath' || this.phase === 'travel') {
      (this.inner.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 1;
      (this.outer.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 1;
      (this.halo.material as THREE.SpriteMaterial).opacity = 0.16;
    }

    // dynamic light
    let li = 0;
    if (this.phase === 'breath') li = 0.4 + this.phaseT * 0.5;
    else if (this.phase === 'travel') li = 1;
    else if (this.phase === 'impact') li = 1.3 - this.phaseT * 0.3;
    else if (this.phase === 'burn') li = Math.max(0, 0.6 * (1 - this.phaseT / 7));
    li *= 0.85 + Math.sin(this.t * 31) * 0.08 + Math.sin(this.t * 13) * 0.07;
    this.intensity = li;
    this.light.intensity = li * 240 * this.power;
    this.light.position.copy(this.phase === 'burn' ? this.tmpV.copy(this.impactPoint).setY(2) : this.position);

    this.fire.update(dt);
    this.smoke.update(dt);
    this.embers.update(dt);
  }

  dispose() {
    this.fire.dispose();
    this.smoke.dispose();
    this.embers.dispose();
    this.group.removeFromParent();
  }
}
