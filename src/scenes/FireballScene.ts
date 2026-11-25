import * as THREE from 'three';
import type { SceneContext } from './SceneContext';
import { Sound } from '../audio/SoundEngine';

/**
 * FIREBALL SCENE — first-person launch of the Great Fireball.
 * The camera stays at the player's eyes but tracks the fireball with a
 * telephoto push (fov) and a small dolly; hands drop out of frame; slow
 * motion, flash and shake sell the impact.
 */
export async function playFireball(ctx: SceneContext, power = 1) {
  const { world } = ctx;
  const d = world.director;
  const gfx = world.gfx;
  const origin = world.firstPersonMouth();
  const dir = world.target.clone().sub(origin).normalize();

  Sound.fireIgnite();
  const roar = Sound.fireRoar();
  d.shake(0.55);
  world.flash = 0.12;

  let impacted = false;
  world.fireball.launch({
    origin,
    direction: dir,
    target: world.target.clone(),
    power,
    onImpact: () => {
      impacted = true;
      Sound.explosion(power);
      roar.stop(2500);
      d.shake(0.95);
      world.flash = 0.3;
      world.ground.ripple(world.target);
      gfx.timeScale = 0.32;
      setTimeout(() => (gfx.timeScale = 1), 900);
    },
  });

  // Breath: the camera recoils slightly while the hands release the seal.
  world.hands.mouthBlend = 0.75;
  const base = { position: d.base.position.clone(), target: d.base.target.clone(), fov: d.base.fov ?? 58 };
  let t = 0;
  const handsDrop = new THREE.Vector3(0, -0.35, 0.05);
  d.track((dt, shot) => {
    t += dt;
    const fb = world.fireball;
    roar.setIntensity?.(Math.min(1, fb.intensity));
    // keep looking at the fireball, push the lens, dolly forward a little
    const follow = Math.min(1, t / 1.6);
    shot.target.lerpVectors(base.target, fb.position, follow * 0.92);
    const dolly = Math.min(1, Math.max(0, (t - 0.8) / 2.6));
    shot.position.copy(base.position).addScaledVector(dir.clone().setY(0).normalize(), dolly * 2.2);
    shot.fov = THREE.MathUtils.lerp(base.fov, 44, Math.min(1, Math.max(0, (t - 0.6) / 2.4)));
    // hands release and fall out of view
    const drop = Math.min(1, Math.max(0, (t - 0.9) / 0.9));
    world.hands.group.position.copy(handsDrop).multiplyScalar(drop * drop);
    world.hands.mouthBlend = 0.75 * (1 - drop);
  });

  // wait for the impact
  while (!impacted) await ctx.wait(0.05);
  // watch the fire burn on the lake
  await ctx.wait(2.6);
  world.hands.group.visible = false;
}
