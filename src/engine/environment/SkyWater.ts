import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { OUTLINE_LAYER } from '../materials/toon';

/**
 * Anime daytime sky dome + painted lake.
 *
 * SKY  : flat cel-style gradient (deep cerulean zenith → pale cyan horizon)
 *        with crisp-edged cumulus clouds shaded in two tones (white tops,
 *        blue-grey undersides), like a painted animation background.
 * LAKE : real planar reflection of the scene, softly distorted and tinted
 *        blue, mixed with a flat near→far colour gradient, white glint lines
 *        drifting on the surface, fireball light and impact ripples.
 */

const SKY_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform vec3 uZenith, uHorizon, uCloudLit, uCloudShade;
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise3(p); p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }

  float cloudAt(vec3 dir) {
    float h = dir.y;
    vec2 uv = dir.xz / (h + 0.22);
    float n = fbm3(vec3(uv * vec2(0.55, 0.9) + vec2(uTime * 0.006, 0.0), 1.3));
    float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.42, 0.72, h));
    return n * (0.55 + 0.6 * band) - (1.0 - band) * 0.25;
  }

  vec3 skyColor(vec3 dir, bool withSun) {
    float h = dir.y;
    float hp = max(h, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.85, hp), 0.65));
    // faint warm haze right at the horizon
    col = mix(col, uHorizon * vec3(1.04, 1.02, 0.98), (1.0 - smoothstep(0.0, 0.06, hp)) * 0.5);
    if (withSun) {
      float s = max(dot(dir, uSunDir), 0.0);
      col += vec3(1.0, 0.98, 0.9) * smoothstep(0.9985, 0.9992, s) * 1.5;
      col += vec3(0.25, 0.22, 0.15) * pow(s, 60.0);
    }
    if (h > 0.0) {
      // crisp cumulus: hard threshold + 2-tone shading (lit top, shaded base)
      float c = cloudAt(dir);
      float edge = 0.47;
      float inside = smoothstep(edge, edge + 0.012, c);
      float below = smoothstep(edge, edge + 0.012, cloudAt(normalize(dir - vec3(0.0, 0.035, 0.0))));
      float core = smoothstep(edge + 0.1, edge + 0.112, c);
      vec3 cc = mix(uCloudShade, uCloudLit, below);
      cc = mix(cc, uCloudLit * 0.96 + uCloudShade * 0.04, core * 0.5);
      col = mix(col, cc, inside);
    } else {
      col = uHorizon * 0.92;
    }
    return col;
  }
`;

function skyUniforms(sunDir: THREE.Vector3) {
  return {
    uSunDir: { value: sunDir.clone().normalize() },
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color('#2a74d6') },
    uHorizon: { value: new THREE.Color('#bfe4f7') },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudShade: { value: new THREE.Color('#a9bfd8') },
  };
}

export function createSky(sunDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    uniforms: skyUniforms(sunDir),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() { gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0); }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 64, 32), mat);
  // Drawn after the other opaque objects (it sits at the far plane), so the
  // cloud shader only runs where the sky is actually visible.
  mesh.renderOrder = 50;
  mesh.frustumCulled = false;
  return { mesh, uniforms: mat.uniforms };
}

export function createWater(sunDir: THREE.Vector3, fogColor: THREE.Color, fogDensity: number) {
  const geo = new THREE.PlaneGeometry(900, 900, 200, 200);
  const reflector = new Reflector(geo, { textureWidth: 1024, textureHeight: 576, clipBias: 0.002, multisample: 4 });
  reflector.rotation.x = -Math.PI / 2;
  const base = reflector.material as THREE.ShaderMaterial;
  const textureMatrix = base.uniforms.textureMatrix.value as THREE.Matrix4;
  const reflTex = reflector.getRenderTarget().texture;

  // ink outlines are not drawn in the reflection
  const renderReflection = reflector.onBeforeRender;
  reflector.onBeforeRender = function (renderer, scene, camera, ...rest) {
    reflector.getReflectionCamera(camera).layers.disable(OUTLINE_LAYER);
    renderReflection.call(this, renderer, scene, camera, ...rest);
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...skyUniforms(sunDir),
      tReflect: { value: reflTex },
      textureMatrix: { value: textureMatrix },
      uNear: { value: new THREE.Color('#1f6fb0') },
      uFar: { value: new THREE.Color('#6fb7e3') },
      uFirePos: { value: new THREE.Vector3(0, -100, 0) },
      uFireIntensity: { value: 0 },
      uRippleCenter: { value: new THREE.Vector2(0, -50) },
      uRippleTime: { value: -10 },
      uFogColor: { value: fogColor },
      uFogDensity: { value: fogDensity },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform mat4 textureMatrix;
      varying vec3 vWorld;
      varying vec4 vReflUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += sin(dot(w.xz, vec2(0.17, 0.09)) + uTime * 0.8) * 0.015 + sin(dot(w.xz, vec2(-0.08, 0.15)) - uTime * 0.6) * 0.015;
        vWorld = w.xyz;
        vReflUv = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tReflect;
      uniform vec3 uNear, uFar;
      varying vec3 vWorld;
      varying vec4 vReflUv;
      uniform vec3 uFirePos;
      uniform float uFireIntensity;
      uniform vec2 uRippleCenter;
      uniform float uRippleTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      ${SKY_GLSL}

      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;
        float t = uTime;

        // gentle painted ripples (two slow noise layers), fading with distance
        float fade = exp(-dist * 0.02);
        vec3 q = vec3(p * 0.45, t * 0.25);
        float n0 = noise3(q), nx = noise3(q + vec3(0.1, 0.0, 0.0)), nz = noise3(q + vec3(0.0, 0.1, 0.0));
        vec2 g = vec2(nx - n0, nz - n0) * 1.4 * (0.3 + 0.7 * fade);

        // impact ripples
        float rt = uTime - uRippleTime;
        float ring = 0.0;
        if (rt > 0.0 && rt < 9.0) {
          vec2 d = p - uRippleCenter;
          float r = length(d);
          float wave = sin(r * 1.6 - rt * 9.0) * exp(-abs(r - rt * 6.0) * 0.25) * exp(-rt * 0.35);
          g += normalize(d + 1e-4) * wave * 0.25;
          ring = smoothstep(0.55, 0.75, wave);
        }
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

        // reflection, softly distorted and tinted towards the water colour
        vec4 ruv = vReflUv;
        ruv.xy += N.xz * 0.06 * ruv.w;
        vec3 refl = texture2DProj(tReflect, ruv).rgb;

        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.08 + 0.92 * pow(1.0 - ndv, 4.0);
        vec3 water = mix(uNear, uFar, smoothstep(4.0, 150.0, dist));
        vec3 col = mix(water, refl * vec3(0.78, 0.9, 1.0), clamp(fres * 0.9 + 0.12, 0.0, 0.85));

        // white glint lines drifting on the surface (cel-style highlights)
        // short dashes (stretched sideways), only in the middle distance
        float stretch = noise3(vec3(p.x * 0.35 + t * 0.05, p.y * 2.2, t * 0.2));
        float glint = smoothstep(0.86, 0.88, stretch) * smoothstep(120.0, 35.0, dist) * smoothstep(6.0, 14.0, dist);
        col = mix(col, vec3(0.95, 0.98, 1.0), glint * 0.7);
        col = mix(col, vec3(1.0), ring * 0.6);

        // fireball light on the water
        if (uFireIntensity > 0.001) {
          vec3 L = uFirePos - vWorld;
          float ld = length(L);
          float atten = uFireIntensity / (1.0 + ld * ld * 0.005);
          col += vec3(1.0, 0.5, 0.12) * atten * 0.25;
          vec3 Hf = normalize(L / ld + V);
          col += vec3(1.0, 0.7, 0.3) * step(0.985, max(dot(N, Hf), 0.0)) * atten * 0.8;
        }

        float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fog * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  base.dispose();
  reflector.material = mat;
  reflector.receiveShadow = false;

  /** Keeps the reflection at half the screen resolution. */
  const setSize = (w: number, h: number) => {
    reflector.getRenderTarget().setSize(Math.max(256, Math.round(w * 0.5)), Math.max(144, Math.round(h * 0.5)));
  };
  return { mesh: reflector as THREE.Mesh, uniforms: mat.uniforms, setSize };
}
