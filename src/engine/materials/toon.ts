import * as THREE from 'three';

/**
 * ANIME LOOK — shared cel-shading helpers.
 *
 *  • toonMat(): MeshToonMaterial with a hard 3-tone light ramp (flat light /
 *    mid / shadow bands, like hand-painted animation cels).
 *  • Ink outlines: an "inverted hull" (back faces) pushed outwards in SCREEN
 *    space, so every line has the same pixel width at any distance, like a
 *    drawn line. Works for meshes, InstancedMesh and SkinnedMesh.
 *  • Outlines live on OUTLINE_LAYER: the main camera renders them, the lake's
 *    reflection camera does not (cheaper, and reflections look painted).
 */

export const OUTLINE_LAYER = 1;
export const outlineUniforms = { uResolution: { value: new THREE.Vector2(1280, 720) } };

const ramps = new Map<string, THREE.DataTexture>();
/** `steps` = 2/3/4 tones, or explicit light levels (0..255) from shadow to light. */
export function toonRamp(steps: number | number[] = 3) {
  const key = String(steps);
  let t = ramps.get(key);
  if (!t) {
    const levels = Array.isArray(steps) ? steps : steps === 2 ? [110, 255] : steps === 4 ? [60, 130, 200, 255] : [85, 175, 255];
    const data = new Uint8Array(levels.length * 4);
    levels.forEach((v, i) => data.set([v, v, v, 255], i * 4));
    t = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    ramps.set(key, t);
  }
  return t;
}

export function toonMat(params: THREE.MeshToonMaterialParameters = {}, steps: number | number[] = 3) {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(steps), ...params });
}

const outlineMats = new Map<string, THREE.MeshBasicMaterial>();
/** Ink outline material, `px` = line width in (drawing-buffer) pixels. */
export function outlineMaterial(px = 2, color = '#1b1416') {
  const key = `${px}|${color}`;
  let m = outlineMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uResolution = outlineUniforms.uResolution;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uResolution;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            #ifdef USE_SKINNING
              vec3 oN = objectNormal;
            #else
              vec3 oN = normal;
            #endif
            #ifdef USE_INSTANCING
              oN = mat3(instanceMatrix) * oN;
            #endif
            vec4 clipN = projectionMatrix * vec4(normalize(mat3(modelViewMatrix) * oN), 0.0);
            vec2 dir = clipN.xy;
            float l = length(dir);
            if (l > 1e-5) gl_Position.xy += (dir / l) * ${px.toFixed(2)} * 2.0 / uResolution * gl_Position.w;
          }`,
        );
      // skinning needs the skinned normal: make sure the normal chunks run
      if (!sh.vertexShader.includes('#include <skinnormal_vertex>')) {
        sh.vertexShader = sh.vertexShader.replace(
          '#include <skinbase_vertex>',
          '#include <skinbase_vertex>\n#include <beginnormal_vertex>\n#include <skinnormal_vertex>',
        );
      }
    };
    m.customProgramCacheKey = () => `ink-outline-${px}`;
    outlineMats.set(key, m);
  }
  return m;
}

/**
 * Geometry restricted to one material group (shares the vertex buffers):
 * e.g. outline only the skin of the hand, not the fingernail patches.
 */
export function groupGeometry(g: THREE.BufferGeometry, groupIndex = 0) {
  const grp = g.groups[groupIndex];
  if (!grp || !g.index) return g;
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.setIndex(new THREE.BufferAttribute((g.index.array as Uint16Array | Uint32Array).slice(grp.start, grp.start + grp.count), 1));
  return out;
}

/** Adds an ink outline to one mesh (handles instanced and skinned meshes). */
export function addOutline(mesh: THREE.Mesh, px = 2, color?: string, geometry?: THREE.BufferGeometry) {
  const mat = outlineMaterial(px, color);
  const geo = geometry ?? mesh.geometry;
  let line: THREE.Mesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const inst = mesh as THREE.InstancedMesh;
    const o = new THREE.InstancedMesh(geo, mat, inst.count);
    o.instanceMatrix = inst.instanceMatrix;
    o.frustumCulled = false;
    line = o;
  } else if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const sk = mesh as THREE.SkinnedMesh;
    const o = new THREE.SkinnedMesh(geo, mat);
    o.bind(sk.skeleton, sk.bindMatrix);
    o.frustumCulled = false;
    line = o;
  } else {
    line = new THREE.Mesh(geo, mat);
  }
  line.castShadow = false;
  line.receiveShadow = false;
  line.layers.set(OUTLINE_LAYER);
  line.renderOrder = mesh.renderOrder;
  mesh.add(line);
  return line;
}

/** Outlines every solid mesh under `root` (skips planes, transparent and tiny parts). */
export function addOutlines(root: THREE.Object3D, px = 2, minRadius = 0.012) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.layers.mask === 1 << OUTLINE_LAYER) return;
    const g = m.geometry;
    if (g.type === 'PlaneGeometry') return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || mat.transparent || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if ((g.boundingSphere?.radius ?? 0) < minRadius) return;
    meshes.push(m);
  });
  for (const m of meshes) addOutline(m, px);
}
