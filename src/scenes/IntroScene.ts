import * as THREE from 'three';
import type { SceneContext } from './SceneContext';
import { MENTOR_SPOT, PLAYER_SPOT } from '../engine/environment/TrainingGround';
import { Sound } from '../audio/SoundEngine';
import { easeInOutSine } from '../utils/math';

/**
 * INTRO SCENE — original 3D cinematic used when the anime video is missing:
 * the father explains and demonstrates the technique over the lake, then the
 * camera moves towards his son and dives into first person.
 */
export async function playFallbackIntro(ctx: SceneContext) {
  const { world } = ctx;
  const d = world.director;
  world.son.setPose('idle');
  world.father.setPose('armsCrossed');

  // 1. Establishing shot
  d.cut({ position: new THREE.Vector3(-8, 6.5, 18), target: new THREE.Vector3(3, 1.2, -10), fov: 40 });
  void d.moveTo({ position: new THREE.Vector3(-5.2, 3.2, 9.5), target: new THREE.Vector3(2.5, 1.3, -6), fov: 38 }, 9, easeInOutSine);
  ctx.caption(ctx.config.cinematic.location);
  await ctx.wait(2.4);
  ctx.caption(null);
  await ctx.say(ctx.config.cinematic.introA.slice(0, 1));
  if (ctx.skipping()) return;

  // 2. Father close shot
  const fatherHead = MENTOR_SPOT.clone().add(new THREE.Vector3(0, 1.62, 0));
  d.cut({ position: fatherHead.clone().add(new THREE.Vector3(1.9, -0.2, 0.9)), target: fatherHead.clone().add(new THREE.Vector3(-0.6, -0.1, -1.2)), fov: 34 });
  void d.moveTo({ position: fatherHead.clone().add(new THREE.Vector3(1.6, -0.15, 0.6)), target: fatherHead.clone().add(new THREE.Vector3(-0.6, -0.05, -1.4)), fov: 32 }, 5, easeInOutSine);
  world.father.setPose('idle');
  await ctx.say(ctx.config.cinematic.introA.slice(1, 2));
  if (ctx.skipping()) return;

  // 3. Father performs the signs
  world.father.setPose('seal', 6);
  d.cut({ position: MENTOR_SPOT.clone().add(new THREE.Vector3(-2.4, 1.3, -1.6)), target: MENTOR_SPOT.clone().add(new THREE.Vector3(0, 1.35, 0)), fov: 34 });
  const signs = ['巳 Snake', '未 Ram', '申 Monkey', '亥 Boar', '午 Horse', '寅 Tiger'];
  const line = ctx.config.cinematic.introA[2];
  void ctx.say([line]);
  for (const s of signs) {
    ctx.caption(s);
    Sound.click();
    world.father.setPose(Math.random() < 0.5 ? 'seal' : 'breath', 9);
    await ctx.wait(0.62);
    world.father.setPose('seal', 9);
    await ctx.wait(0.08);
    if (ctx.skipping()) return;
  }
  ctx.caption(null);

  // 4. Demonstration fireball over the lake
  world.father.setPose('breath', 5);
  d.cut({ position: MENTOR_SPOT.clone().add(new THREE.Vector3(-3.2, 1.3, 4.2)), target: MENTOR_SPOT.clone().add(new THREE.Vector3(2.2, 1.6, -6)), fov: 46 });
  await ctx.wait(0.7);
  const mouth = world.father.mouthWorld();
  const dir = world.target.clone().add(new THREE.Vector3(16, 1.0, 8)).sub(mouth).normalize();
  const roar = Sound.fireRoar();
  Sound.fireIgnite();
  world.fatherFireball.launch({
    origin: mouth,
    direction: dir,
    target: world.target.clone().add(new THREE.Vector3(16, 1.0, 8)),
    power: 0.8,
    onImpact: () => {
      Sound.explosion(0.7);
      world.director.shake(0.35);
      world.ground.ripple(world.target);
      roar.stop(1500);
    },
  });
  world.director.shake(0.25);
  await ctx.wait(1.0);
  world.father.setPose('release', 3);
  void d.moveTo({ position: MENTOR_SPOT.clone().add(new THREE.Vector3(-4.5, 3.0, 7.5)), target: world.target.clone().add(new THREE.Vector3(14, 2, 6)), fov: 48 }, 3.5);
  await ctx.wait(4.5);
  if (ctx.skipping()) return;

  // 5. Son reaction & father's last words
  world.father.setPose('idle', 2);
  const sonHead = PLAYER_SPOT.clone().add(new THREE.Vector3(0, 1.42, 0));
  d.cut({ position: sonHead.clone().add(new THREE.Vector3(-1.9, -0.1, -0.9)), target: sonHead.clone().add(new THREE.Vector3(0.5, 0.05, -0.4)), fov: 32 });
  await ctx.say(ctx.config.cinematic.introB.slice(0, 1));
  d.cut({ position: PLAYER_SPOT.clone().add(new THREE.Vector3(-0.6, 1.6, 2.2)), target: MENTOR_SPOT.clone().add(new THREE.Vector3(0, 1.45, 0)), fov: 36 });
  world.father.setPose('point', 3);
  await ctx.say(ctx.config.cinematic.introB.slice(1));
}

/**
 * Camera dives from behind the son into his eyes (3D version of
 * "zoom into the character"). Ends at the first-person shot.
 */
export async function zoomIntoPlayer(ctx: SceneContext, fromBehind = true) {
  const { world } = ctx;
  const d = world.director;
  world.son.setPose('idle');
  world.father.setPose('armsCrossed');
  if (fromBehind) d.cut(world.overShoulderShot());
  const fp = world.firstPersonShot();
  const eye = fp.position.clone();
  let done = false;
  const move = d.moveTo({ position: fp.position.clone().add(new THREE.Vector3(0, 0.02, 0.35)), target: fp.target, fov: 50 }, 2.2, easeInOutSine);
  void move.then(() => (done = true));
  // hide the body (behind a short flash) before the camera reaches the head
  while (!done && !ctx.skipping()) {
    if (world.son.group.visible && world.gfx.camera.position.distanceTo(eye) < 0.8) {
      world.son.group.visible = false;
      world.flash = Math.max(world.flash, 0.45);
      Sound.whoosh(0.7, 0.35);
    }
    await ctx.wait(1 / 60);
  }
  await move;
  world.flash = Math.max(world.flash, 0.6);
}
