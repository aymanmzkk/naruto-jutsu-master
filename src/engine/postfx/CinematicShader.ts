import * as THREE from 'three';

/**
 * Final cinematic grade (linear HDR, before tone mapping): saturation,
 * multiplicative split toning (teal shadows / warm highlights), contrast
 * around mid grey, soft vignette, very light multiplicative film grain,
 * chromatic aberration driven by camera shake / impacts, fade and flash.
 */
export const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.12 },
    uGrain: { value: 0.0 },
    uAberration: { value: 0.0012 },
    uFade: { value: 0 },
    uFlash: { value: 0 },
    uSaturation: { value: 1.06 },
    uWarmth: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uFade, uFlash, uSaturation, uWarmth;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec2 off = dir * uAberration * (0.5 + d * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col = max(col, 0.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      // split toning, multiplicative (this pass runs on linear HDR, before
      // tone mapping): teal-ish shadows, warm highlights
      float hi = smoothstep(0.06, 0.7, l);
      col *= mix(vec3(0.99, 1.0, 1.02), vec3(1.0 + uWarmth * 2.0, 1.0 + uWarmth * 0.5, 1.0 - uWarmth * 1.6), hi);
      // contrast around mid grey
      col = pow(col / 0.18 + 1e-6, vec3(1.02)) * 0.18;
      float vig = smoothstep(0.95, 0.25, d * (1.0 + uVignette));
      col *= mix(1.0, vig, uVignette * 1.3);
      // multiplicative grain: same perceived strength in darks and lights
      float g = hash(vUv * uResolution + fract(uTime * 13.7)) - 0.5;
      col *= 1.0 + g * uGrain * 2.0;
      col = mix(col, vec3(1.0, 0.93, 0.82), uFlash);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Runs before bloom: removes NaN/Inf pixels and clamps extreme HDR values.
 * Without it, one overflowing pixel (explosion flash) is spread by the bloom
 * blur over the whole screen and the frame turns black.
 */
export const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), 1.0);
    }
  `,
};
