import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSky, createWater } from './SkyWater';
import { softDot, stoneTexture, woodTexture } from '../effects/textures';
import { rng } from '../../utils/math';
import { withRim } from '../materials/rimLight';
import { addOutline, addOutlines, toonMat } from '../materials/toon';

/**
 * TRAINING GROUND — the clan's lakeside training dock at dusk.
 * Anime daytime look (cel shading + ink outlines everywhere): a sunny
 * meadow around a reflective lake, round-crowned trees mixed with cedars,
 * wooden dock, stone lanterns, a rocky islet with a small torii gate
 * (fireball target), four hazy blue hill layers and light distance haze.
 */

export const DOCK_Y = 0.55;
/** Where the player character stands (end of the dock). */
export const PLAYER_SPOT = new THREE.Vector3(0, DOCK_Y, -2.4);
/** Where the mentor stands. */
export const MENTOR_SPOT = new THREE.Vector3(1.35, DOCK_Y, 0.4);
/** Fireball destination above the lake. */
export const TARGET_SPOT = new THREE.Vector3(3, 3.2, -52);

const LAKE_C = new THREE.Vector2(0, -62);
const LAKE_R = new THREE.Vector2(58, 72);

function lakeD(x: number, z: number) {
  const dx = (x - LAKE_C.x) / LAKE_R.x;
  const dz = (z - LAKE_C.y) / LAKE_R.y;
  return Math.sqrt(dx * dx + dz * dz);
}

function valueNoise(seed: number) {
  const r = rng(seed);
  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = r();
  const h = (x: number, z: number) => perm[(((x * 73856093) ^ (z * 19349663)) >>> 0) % 512];
  return (x: number, z: number) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const u = xf * xf * (3 - 2 * xf);
    const v = zf * zf * (3 - 2 * zf);
    const a = h(xi, zi);
    const b = h(xi + 1, zi);
    const c = h(xi, zi + 1);
    const d = h(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const noise = valueNoise(11);
const fbm = (x: number, z: number) => {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    s += noise(x * f, z * f) * a;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
};

export function terrainHeight(x: number, z: number) {
  const d = lakeD(x, z);
  let h = (d - 1) * 9;
  h += (fbm(x * 0.04, z * 0.04) - 0.5) * 6 * Math.min(1, Math.max(0, d - 0.9) * 2);
  if (d > 1.6) h += (d - 1.6) * 18 * fbm(x * 0.015 + 3, z * 0.015);
  // flat clearing at the dock entrance
  const clear = Math.exp(-((x * x) / 60 + ((z - 14) * (z - 14)) / 90));
  h = h * (1 - clear) + 0.35 * clear;
  return Math.max(-6, h);
}

export class TrainingGround {
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3(-0.45, 0.72, 0.5).normalize();
  readonly fogColor = new THREE.Color('#c4e2f2');
  readonly fogDensity = 0.0034;
  private sky: ReturnType<typeof createSky>;
  private water: ReturnType<typeof createWater>;
  private mist: THREE.ShaderMaterial;
  private fireflies: THREE.Points;
  private fireflyBase: Float32Array;
  private lanternLights: THREE.PointLight[] = [];
  /** The two posts at the end of the dock (hidden for the completion hero shot). */
  readonly endPosts: THREE.Object3D[] = [];
  readonly sun: THREE.DirectionalLight;
  private time = 0;

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.FogExp2(this.fogColor, this.fogDensity);
    scene.background = new THREE.Color('#bfe4f7');

    this.sky = createSky(this.sunDir);
    this.water = createWater(this.sunDir, this.fogColor, this.fogDensity);
    this.group.add(this.sky.mesh, this.water.mesh);

    // Lights
    const hemi = new THREE.HemisphereLight('#e2f0ff', '#7da558', 1.15);
    this.group.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff7ea', 2.4);
    this.sun.position.copy(this.sunDir).multiplyScalar(60);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 10;
    sc.far = 120;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.group.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#d6e6ff', 0.35);
    fill.position.set(6, 10, 14);
    this.group.add(fill);

    this.group.add(this.buildTerrain());
    this.group.add(this.buildMountains());
    this.group.add(this.buildForest());
    const dock = this.buildDock();
    addOutlines(dock, 1.5);
    const rocks = this.buildRocks();
    addOutlines(rocks, 1.5);
    const islet = this.buildIslet();
    addOutlines(islet, 1.6);
    this.group.add(dock, rocks, islet);
    this.buildLanterns();
    this.mist = this.buildMist();
    const ff = this.buildFireflies();
    this.fireflies = ff.points;
    this.fireflyBase = ff.base;
    this.fireflies.visible = false; // daytime
    this.group.add(this.fireflies);
    scene.add(this.group);
  }

  private buildTerrain() {
    const geo = new THREE.PlaneGeometry(520, 520, 220, 220);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -40);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const cGrass = new THREE.Color('#5fae40');
    const cDark = new THREE.Color('#3f8a31');
    const cSand = new THREE.Color('#d6c294');
    const cMud = new THREE.Color('#5d7a52');
    const cLight = new THREE.Color('#86c955');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = fbm(x * 0.2, z * 0.2);
      if (h < -0.2) c.copy(cMud);
      else if (h < 0.6) c.copy(cSand).lerp(cGrass, Math.max(0, h / 0.6) * 0.6);
      else if (n > 0.62) c.copy(cLight);
      else c.copy(cGrass).lerp(cDark, n < 0.38 ? 0.8 : 0);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, withRim(toonMat({ vertexColors: true }), 0.25));
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildMountains() {
    const g = new THREE.Group();
    // far layers are lighter and hazier (aerial perspective)
    const layers = [
      { r: 185, h: 46, color: '#3f8150', haze: 0.08, seed: 3, sharp: 1.2 },
      { r: 250, h: 78, color: '#4f8c7c', haze: 0.3, seed: 5, sharp: 1.6 },
      { r: 330, h: 122, color: '#6d9cb8', haze: 0.48, seed: 9, sharp: 2.0 },
      { r: 440, h: 175, color: '#8db3d0', haze: 0.62, seed: 13, sharp: 2.4 },
    ];
    const sunAz = Math.atan2(this.sunDir.x, -this.sunDir.z);
    layers.forEach((L, li) => {
      const segs = 900;
      const positions: number[] = [];
      const hAttr: number[] = [];
      const n = valueNoise(L.seed);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.sin(a) * L.r;
        const z = Math.cos(a) * L.r - 60;
        // ridged multi-octave profile: broad massifs + sharp peaks + rocky detail
        let ridge = 0;
        let amp = 1;
        let f = 0.045;
        let norm = 0;
        for (let o = 0; o < 5; o++) {
          const v = 1 - Math.abs(n(i * f, 3 + o * 7) * 2 - 1);
          ridge += Math.pow(v, L.sharp) * amp;
          norm += amp;
          amp *= 0.5;
          f *= 2.15;
        }
        ridge /= norm;
        const broad = n(i * 0.012, 41);
        let h = L.h * (0.18 + 0.82 * (ridge * 0.65 + broad * 0.45));
        // lower the range where the sun sets so it stays visible
        let da = Math.abs(Math.atan2(x, -(z + 60)) - sunAz);
        da = Math.min(da, Math.PI * 2 - da);
        h *= 0.42 + 0.58 * Math.min(1, da * 2.4);
        positions.push(x, -4, z, x, h, z);
        hAttr.push(0, 1);
      }
      const idx: number[] = [];
      for (let i = 0; i < segs; i++) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('aH', new THREE.Float32BufferAttribute(hAttr, 1));
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(L.color) },
          uHaze: { value: L.haze },
          uHazeCol: { value: new THREE.Color('#c4e2f2') },
          uSunHaze: { value: new THREE.Color('#d8eef9') },
          uSunDir: { value: this.sunDir },
          uRim: { value: new THREE.Color('#000000') },
        },
        vertexShader: /* glsl */ `
          attribute float aH;
          varying float vH;
          varying vec3 vW;
          void main() {
            vH = aH;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor, uHazeCol, uSunHaze, uSunDir, uRim;
          uniform float uHaze;
          varying float vH;
          varying vec3 vW;
          float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n2(vec2 p) {
            vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y);
          }
          void main() {
            vec3 d = normalize(vW - cameraPosition);
            float toSun = max(dot(normalize(d.xz), normalize(uSunDir.xz)), 0.0);
            // rocky gullies running down the slopes
            float ang = atan(vW.x, vW.z + 60.0);
            float gul = n2(vec2(ang * 260.0, vW.y * 0.05)) * 0.5 + n2(vec2(ang * 900.0, vW.y * 0.2)) * 0.5;
            vec3 col = uColor * (0.85 + 0.2 * vH) * (0.92 + 0.12 * step(0.55, gul));
            // haze: layer distance + valley mist at the bottom, warmer towards the sun
            float haze = uHaze + (1.0 - uHaze) * pow(1.0 - vH, 2.6) * 0.75;
            vec3 hz = mix(uHazeCol, uSunHaze, pow(toSun, 5.0));
            col = mix(col, hz, clamp(haze, 0.0, 1.0));
            // sunlit ridgeline
            col += uRim * smoothstep(0.9, 1.0, vH) * pow(toSun, 7.0) * 0.9 * (1.0 - uHaze * 0.5);
            gl_FragColor = vec4(col, 1.0);
          }`,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = -5 + li;
      mesh.frustumCulled = false;
      g.add(mesh);
    });
    return g;
  }

  /** Stylised cedar: jagged drooping tiers, shaded darker inside. */
  private treeGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    const paint = (geo: THREE.BufferGeometry, color: string, shadeFn: (x: number, y: number, z: number) => number) => {
      const col = new THREE.Color(color);
      const p = geo.attributes.position as THREE.BufferAttribute;
      const arr: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const k = shadeFn(p.getX(i), p.getY(i), p.getZ(i));
        arr.push(col.r * k, col.g * k, col.b * k);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
      return geo.index ? geo.toNonIndexed() : geo;
    };
    const trunk = new THREE.CylinderGeometry(0.1, 0.24, 3.4, 7);
    trunk.translate(0, 1.7, 0);
    parts.push(paint(trunk, '#6e4a30', () => 1));
    const tiers = 6;
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1);
      const radius = 2.15 - k * 1.65;
      const height = 2.5 - k * 0.9;
      const y0 = 1.5 + k * 5.6;
      const segs = 11;
      const cone = new THREE.ConeGeometry(radius, height, segs, 2, false);
      const p = cone.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const ring = (height / 2 - y) / height; // 0 at apex, 1 at the bottom ring
        if (ring > 0.01) {
          // deterministic in the angle, so side and bottom-cap vertices that
          // share a position move together (no cracks)
          const ang = Math.round(Math.atan2(z, x) * 1000) / 1000;
          const hA = Math.abs(Math.sin(ang * 12.9898 + t * 78.233) * 43758.5453) % 1;
          const hB = Math.abs(Math.sin(ang * 39.346 + t * 11.135) * 24634.6345) % 1;
          const branch = 0.78 + 0.22 * Math.abs(Math.sin(ang * segs * 0.5)) + (hA - 0.5) * 0.12;
          const s = ring > 0.99 ? branch : 1 + (branch - 1) * ring;
          p.setX(i, x * s);
          p.setZ(i, z * s);
          p.setY(i, y - ring * ring * 0.45 * (0.7 + hB * 0.6)); // drooping branch tips
        }
      }
      cone.computeVertexNormals();
      // soft "blob" normals: point away from the tree axis and a bit up
      const nrm = cone.attributes.normal as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      const n0 = new THREE.Vector3();
      for (let i = 0; i < nrm.count; i++) {
        v.set(p.getX(i), 0.55, p.getZ(i)).normalize();
        n0.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).lerp(v, 0.6).normalize();
        nrm.setXYZ(i, n0.x, n0.y, n0.z);
      }
      cone.translate(0, y0 + height / 2, 0);
      const tierColor = ['#2b6a35', '#307339', '#367d3e', '#3b8643', '#418f48', '#47984d'][t];
      parts.push(
        paint(cone, tierColor, (x, y, z) => {
          const rad = Math.hypot(x, z) / radius;
          return 0.7 + 0.35 * Math.min(1, rad) + (y - y0) * 0.02;
        }),
      );
    }
    return mergeGeometries(parts)!;
  }

  /** Round-crowned broadleaf tree: lumpy canopy blobs with soft dome normals. */
  private broadleafGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    const paint = (geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => THREE.Color) => {
      const p = geo.attributes.position as THREE.BufferAttribute;
      const arr: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const c = fn(p.getX(i), p.getY(i), p.getZ(i));
        arr.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
      return geo.index ? geo.toNonIndexed() : geo;
    };
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 3.6, 8);
    trunk.translate(0, 1.8, 0);
    const bark = new THREE.Color('#6b4630');
    parts.push(paint(trunk, () => bark));
    const centre = new THREE.Vector3(0, 4.4, 0);
    const blobs: [number, number, number, number][] = [
      [0, 4.3, 0, 1.75],
      [1.15, 3.85, 0.45, 1.2],
      [-1.2, 3.9, -0.35, 1.25],
      [0.35, 5.35, -0.2, 1.25],
      [-0.45, 3.7, 1.15, 1.1],
      [0.55, 3.75, -1.2, 1.1],
      [-0.75, 5.0, 0.6, 1.0],
    ];
    const dark = new THREE.Color('#2f7a32');
    const mid = new THREE.Color('#46a03d');
    const light = new THREE.Color('#71c24f');
    const c = new THREE.Color();
    blobs.forEach(([x, y, z, r], k) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const j = 0.88 + 0.24 * (Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1);
        p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
      }
      g.translate(x, y, z);
      g.computeVertexNormals();
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      const n0 = new THREE.Vector3();
      for (let i = 0; i < nrm.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(centre).normalize();
        n0.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).lerp(v, 0.75).normalize();
        nrm.setXYZ(i, n0.x, n0.y, n0.z);
      }
      parts.push(
        paint(g, (_x, yy) => {
          const t = THREE.MathUtils.clamp((yy - 2.8) / 3.4, 0, 1);
          return t < 0.5 ? c.copy(dark).lerp(mid, t * 2) : c.copy(mid).lerp(light, (t - 0.5) * 2);
        }),
      );
    });
    return mergeGeometries(parts)!;
  }

  private buildForest() {
    const group = new THREE.Group();
    const r = rng(1234);
    const place = (count: number, accept: (d: number) => boolean) => {
      const out: { m: THREE.Matrix4; c: THREE.Color }[] = [];
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      let tries = 0;
      while (out.length < count && tries < 30000) {
        tries++;
        const x = (r() - 0.5) * 280;
        const z = -60 + (r() - 0.5) * 320;
        const d = lakeD(x, z);
        if (d < 1.06 || d > 2.7 || !accept(d)) continue;
        if (Math.abs(x) < 7 && z > 3 && z < 26) continue; // keep the dock path clear
        const h = terrainHeight(x, z);
        if (h < 0.3) continue;
        const sc = 0.75 + r() * 1.0 + (d - 1) * 0.6;
        p.set(x, h - 0.25, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
        s.set(sc * (0.85 + r() * 0.3), sc * (0.85 + r() * 0.4), sc * (0.85 + r() * 0.3));
        out.push({
          m: new THREE.Matrix4().compose(p, q, s),
          c: new THREE.Color().setHSL(0.27 + (r() - 0.5) * 0.06, 0.25, 0.5 + (r() - 0.5) * 0.12).multiplyScalar(1.9),
        });
      }
      return out;
    };
    const make = (geo: THREE.BufferGeometry, items: { m: THREE.Matrix4; c: THREE.Color }[]) => {
      const inst = new THREE.InstancedMesh(geo, toonMat({ vertexColors: true }), items.length);
      items.forEach((it, i) => {
        inst.setMatrixAt(i, it.m);
        inst.setColorAt(i, it.c);
      });
      inst.castShadow = false;
      inst.receiveShadow = false;
      addOutline(inst, 1.4);
      group.add(inst);
    };
    // broadleaf trees around the shore, cedars further up the slopes
    make(this.broadleafGeometry(), place(430, (d) => d < 2.0 || r() < 0.4));
    make(this.treeGeometry(), place(220, (d) => d > 1.5));
    return group;
  }

  private buildDock() {
    const g = new THREE.Group();
    const wood = woodTexture().clone();
    wood.needsUpdate = true;
    wood.repeat.set(1, 4);
    const plankMats = ['#c9a27a', '#bd946c', '#d2ae86', '#b48a62'].map((c) =>
      withRim(toonMat({ map: wood, color: c }), 0.7),
    );
    const postMat = withRim(toonMat({ map: woodTexture(), color: '#6e5040' }), 0.7);
    const zStart = 12;
    const zEnd = -3.4;
    const r = rng(77);
    for (let z = zStart; z > zEnd; z -= 0.36) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.5 + (r() - 0.5) * 0.08, 0.07, 0.32), plankMats[Math.floor(r() * plankMats.length)]);
      plank.position.set((r() - 0.5) * 0.04, DOCK_Y - 0.035 + (r() - 0.5) * 0.012, z);
      plank.rotation.y = (r() - 0.5) * 0.012;
      plank.castShadow = true;
      plank.receiveShadow = true;
      g.add(plank);
    }
    for (const x of [-1.15, 1.15]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, zStart - zEnd), postMat);
      beam.position.set(x, DOCK_Y - 0.16, (zStart + zEnd) / 2);
      beam.receiveShadow = true;
      g.add(beam);
      for (let z = zStart - 0.5; z > zEnd; z -= 2.6) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.2, 8), postMat);
        post.position.set(x * 1.02, DOCK_Y - 1.4, z);
        post.castShadow = true;
        g.add(post);
      }
    }
    // end posts sticking up
    for (const x of [-1.2, 1.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.0, 8), postMat);
      post.position.set(x, DOCK_Y + 0.35, zEnd + 0.15);
      post.castShadow = true;
      this.endPosts.push(post);
      g.add(post);
    }
    return g;
  }

  private buildRocks() {
    const g = new THREE.Group();
    const mat = withRim(toonMat({ map: stoneTexture(), color: '#8a8480' }), 0.5);
    const r = rng(99);
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const d = 1.0 + r() * 0.12;
      const x = LAKE_C.x + Math.sin(a) * LAKE_R.x * d;
      const z = LAKE_C.y + Math.cos(a) * LAKE_R.y * d;
      if (Math.abs(x) < 4 && z > 0) continue;
      const geo = new THREE.DodecahedronGeometry(0.6 + r() * 1.6, 0);
      geo.scale(1, 0.55 + r() * 0.4, 1);
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(x, terrainHeight(x, z) - 0.1, z);
      rock.rotation.set(r(), r() * 6, r());
      rock.receiveShadow = true;
      g.add(rock);
    }
    return g;
  }

  /** Rocky islet in the lake with a small torii gate: the fireball's target. */
  private buildIslet() {
    const g = new THREE.Group();
    const mat = withRim(toonMat({ map: stoneTexture(), vertexColors: true }), 0.6);
    const moss = new THREE.Color('#5fa846');
    const rock = new THREE.Color('#a8a39a');
    const r = rng(5);
    const cx = TARGET_SPOT.x;
    const cz = TARGET_SPOT.z - 6;
    const addRock = (x: number, y: number, z: number, size: number, flat = 1) => {
      const geo = new THREE.DodecahedronGeometry(size, 1);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (0.8 + r() * 0.4), p.getY(k) * (0.6 + r() * 0.5) * flat, p.getZ(k) * (0.8 + r() * 0.4));
      geo.computeVertexNormals();
      const nrm = geo.attributes.normal as THREE.BufferAttribute;
      const cols: number[] = [];
      const c = new THREE.Color();
      for (let k = 0; k < p.count; k++) {
        c.copy(rock).lerp(moss, Math.min(1, Math.max(0, nrm.getY(k) - 0.35) * 1.4));
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(r() * 0.4, r() * 6, r() * 0.4);
      m.castShadow = true;
      g.add(m);
    };
    // central plateau + surrounding boulders
    addRock(cx, -0.6, cz, 4.2, 0.45);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.5;
      const d = 3.2 + r() * 2.4;
      addRock(cx + Math.cos(a) * d, -0.4 + r() * 0.6, cz + Math.sin(a) * d * 0.8, 1.0 + r() * 1.6);
    }
    // small torii gate facing the dock
    const red = withRim(toonMat({ color: '#d63a22' }), 0.8);
    const black = withRim(toonMat({ color: '#2b2326' }), 0.6);
    const torii = new THREE.Group();
    for (const x of [-1.45, 1.45]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 4.2, 14), red);
      pillar.position.set(x, 2.1, 0);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.35, 14), black);
      foot.position.set(x, 0.17, 0);
      torii.add(pillar, foot);
    }
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.24, 0.2), red);
    nuki.position.y = 3.25;
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.26, 0.38), black);
    kasagi.position.y = 4.32;
    const shimaki = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.22, 0.32), red);
    shimaki.position.y = 4.08;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.16), red);
    tab.position.y = 3.68;
    torii.add(nuki, kasagi, shimaki, tab);
    // upturned ends of the top beam
    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.38), black);
      end.position.set(sx * 2.45, 4.4, 0);
      end.rotation.z = sx * 0.28;
      torii.add(end);
    }
    torii.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    torii.position.set(cx - 0.6, 1.05, cz + 1.2);
    torii.rotation.y = 0.06;
    g.add(torii);
    // a few small cedars on the islet
    const treeGeo = this.treeGeometry();
    const treeMat = withRim(toonMat({ vertexColors: true }), 0.6, 2.4);
    const spots: [number, number, number][] = [
      [3.2, -1.6, 0.55],
      [-3.4, -2.4, 0.7],
      [1.0, -3.6, 0.85],
      [-1.5, -3.2, 0.5],
    ];
    for (const [dx, dz, sc] of spots) {
      const t = new THREE.Mesh(treeGeo, treeMat);
      t.position.set(cx + dx, 0.6, cz + dz);
      t.material = treeMat;
      t.scale.setScalar(sc);
      t.rotation.y = r() * 6;
      g.add(t);
    }
    return g;
  }

  /** Low drifting mist over the far half of the lake. */
  private buildMist() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#eef7fc') },
        uSun: { value: new THREE.Color('#ffffff') },
        uSunDir: { value: this.sunDir },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor, uSun, uSunDir;
        varying vec3 vW;
        float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 p = vW.xz * 0.025 + vec2(uTime * 0.01, 0.0);
          float n = n2(p) * 0.55 + n2(p * 2.3 + 4.0) * 0.3 + n2(p * 5.1 - uTime * 0.02) * 0.15;
          float d = length(vW - cameraPosition);
          float a = smoothstep(0.35, 0.8, n) * smoothstep(12.0, 45.0, d) * (1.0 - smoothstep(160.0, 260.0, d));
          vec3 v = normalize(vW - cameraPosition);
          float toSun = max(dot(normalize(v.xz), normalize(uSunDir.xz)), 0.0);
          vec3 col = mix(uColor, uSun, pow(toSun, 6.0)) * 0.9;
          gl_FragColor = vec4(col, a * 0.16);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    for (const [y, sc] of [
      [1.1, 1],
      [2.4, 1.15],
    ] as const) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(260 * sc, 220 * sc), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, y, -95);
      plane.renderOrder = 4;
      this.group.add(plane);
    }
    return mat;
  }

  private buildLanterns() {
    const stone = withRim(toonMat({ map: stoneTexture(), color: '#9a948c' }), 0.6);
    const glow = toonMat({ color: '#f4ead2' });
    const spots = [new THREE.Vector3(-2.2, 0, 11.5), new THREE.Vector3(2.2, 0, 11.5), new THREE.Vector3(-1.9, 0, 4)];
    for (const s of spots) {
      const h = terrainHeight(s.x, s.z);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.25, 6), stone);
      base.position.y = 0.12;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.9, 6), stone);
      pillar.position.y = 0.7;
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.12, 6), stone);
      plate.position.y = 1.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), glow);
      box.position.y = 1.42;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.32, 6), stone);
      roof.position.y = 1.72;
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), stone);
      top.position.y = 1.92;
      g.add(base, pillar, plate, box, roof, top);
      g.position.set(s.x, s.z < 6 ? DOCK_Y - 0.55 + h * 0 : h, s.z);
      if (s.z < 6) g.position.y = Math.max(h, 0.3);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      const light = new THREE.PointLight('#ff9a4a', 4, 9, 2);
      light.position.set(s.x, g.position.y + 1.45, s.z);
      void light; // daytime: lanterns are not lit
      addOutlines(g, 1.6);
      this.group.add(g);
    }
  }

  private buildFireflies() {
    const count = 260;
    const r = rng(31);
    const base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = 3 + r() * 40;
      base[i * 3] = Math.sin(a) * d;
      base[i * 3 + 1] = 0.4 + r() * 4;
      base[i * 3 + 2] = Math.cos(a) * d * 0.8 - 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
    const mat = new THREE.PointsMaterial({
      map: softDot(),
      color: '#ffcf6a',
      size: 0.16,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return { points, base };
  }

  /** Called every frame. firePos/fireIntensity feed the water reflections. */
  update(dt: number, firePos?: THREE.Vector3, fireIntensity = 0) {
    this.time += dt;
    const t = this.time;
    this.sky.uniforms.uTime.value = t;
    this.water.uniforms.uTime.value = t;
    this.mist.uniforms.uTime.value = t;
    if (firePos) this.water.uniforms.uFirePos.value.copy(firePos);
    this.water.uniforms.uFireIntensity.value = fireIntensity;
    const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.fireflyBase[i * 3];
      const by = this.fireflyBase[i * 3 + 1];
      const bz = this.fireflyBase[i * 3 + 2];
      pos.setXYZ(i, bx + Math.sin(t * 0.3 + i) * 0.8, by + Math.sin(t * 0.7 + i * 1.7) * 0.35, bz + Math.cos(t * 0.25 + i * 0.6) * 0.8);
    }
    pos.needsUpdate = true;
    (this.fireflies.material as THREE.PointsMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.15;
    this.lanternLights.forEach((l, i) => {
      l.intensity = 3.6 + Math.sin(t * 9 + i * 3) * 0.25 + Math.sin(t * 23 + i) * 0.15;
    });
  }

  /** Reflection render target follows the canvas size. */
  setReflectionSize(w: number, h: number) {
    this.water.setSize(w, h);
  }

  ripple(center: THREE.Vector3) {
    this.water.uniforms.uRippleCenter.value.set(center.x, center.z);
    this.water.uniforms.uRippleTime.value = this.time;
  }
}
