import * as THREE from 'three';

/**
 * Sunset rim light shared by every lit material of the set.
 * At dusk most shots look towards the low sun, so objects are backlit:
 * this adds the warm glowing edge you get on silhouettes against the sky
 * (strongest when the camera faces the sun, faint otherwise).
 */
export const rimUniforms = {
  uSunView: { value: new THREE.Vector3(0, 0, -1) },
  uRimColor: { value: new THREE.Color('#ff9b5c') },
  uRimStrength: { value: 1 },
};

const tmp = new THREE.Vector3();

/** Call once per frame (sun direction is converted to view space). */
export function updateRim(camera: THREE.Camera, sunDirWorld: THREE.Vector3) {
  camera.updateMatrixWorld();
  tmp.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
  rimUniforms.uSunView.value.copy(tmp);
}

/** Adds the rim term to a MeshStandard / MeshPhysical / MeshLambert material. */
export function withRim<T extends THREE.Material>(mat: T, strength = 1, power = 3): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uSunView = rimUniforms.uSunView;
    shader.uniforms.uRimColor = rimUniforms.uRimColor;
    shader.uniforms.uRimStrength = rimUniforms.uRimStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rimV = normalize(vViewPosition);
          float rimF = pow(1.0 - clamp(dot(normal, rimV), 0.0, 1.0), ${power.toFixed(2)});
          float rimBack = clamp(dot(-rimV, uSunView), 0.0, 1.0);
          outgoingLight += uRimColor * rimF * (0.06 + 1.3 * rimBack * rimBack * rimBack) * ${strength.toFixed(3)} * uRimStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey()}|rim${strength}|${power}`;
  return mat;
}
