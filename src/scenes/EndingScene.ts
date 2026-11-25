import * as THREE from 'three';
import type { SceneContext } from './SceneContext';
import { PLAYER_SPOT } from '../engine/environment/TrainingGround';
import { easeInOutSine } from '../utils/math';

/**
 * ENDING SCENE
 *  zoomOutToThirdPerson(): the camera physically pulls back out of the
 *  player's eyes along a spline, revealing the young ninja from behind with
 *  the burning lake ahead — the bridge back to the original anime footage.
 *  playFallbackEnding(): original 3D ending when no video is available.
 */
export async function zoomOutToThirdPerson(ctx: SceneContext, seconds = 5.5) {
  const { world } = ctx;
  const d = world.director;
  world.setFirstPerson(false);
  world.son.setPose('release', 50);
  world.son.update(0.1);
  world.son.setPose('idle', 0.6);

  const eye = d.base.position.clone();
  const look = d.base.target.clone();
  const p1 = PLAYER_SPOT.clone().add(new THREE.Vector3(0.15, 1.55, 0.6));
  const p2 = PLAYER_SPOT.clone().add(new THREE.Vector3(-0.9, 1.9, 2.6));
  const p3 = PLAYER_SPOT.clone().add(new THREE.Vector3(-2.6, 2.7, 5.8));
  const posCurve = new THREE.CatmullRomCurve3([eye, p1, p2, p3]);
  const lookCurve = new THREE.CatmullRomCurve3([
    look,
    world.target.clone().add(new THREE.Vector3(-2, 0, 0)),
    PLAYER_SPOT.clone().add(new THREE.Vector3(0, 1.2, -6)),
    PLAYER_SPOT.clone().add(new THREE.Vector3(0.6, 1.1, -10)),
  ]);
  await d.followPath(posCurve, lookCurve, seconds, 44, easeInOutSine);
}

export async function playFallbackEnding(ctx: SceneContext) {
  const { world } = ctx;
  const d = world.director;
  const lines = ctx.config.cinematic.outro;
  world.father.setPose('armsCrossed', 2);
  // backlit two-shot from behind: both silhouettes against the burning islet
  d.cut({ position: PLAYER_SPOT.clone().add(new THREE.Vector3(2.9, 1.9, 7.4)), target: PLAYER_SPOT.clone().add(new THREE.Vector3(0.4, 1.2, -10)), fov: 34 });
  void d.moveTo({ position: PLAYER_SPOT.clone().add(new THREE.Vector3(2.4, 1.8, 6.2)), target: PLAYER_SPOT.clone().add(new THREE.Vector3(0.4, 1.3, -10)), fov: 32 }, 8, easeInOutSine);
  await ctx.say(lines.slice(0, 2));
  // the son answers: profile silhouette against the sunset
  const sonHead = PLAYER_SPOT.clone().add(new THREE.Vector3(0, 1.4, 0));
  world.son.group.rotation.y = Math.PI - 0.5;
  d.cut({ position: sonHead.clone().add(new THREE.Vector3(-2.0, -0.15, -1.2)), target: sonHead.clone().add(new THREE.Vector3(0.4, 0.05, -0.3)), fov: 32 });
  await ctx.say(lines.slice(2));
  // final wide shot: silhouettes against the burning lake
  world.son.group.rotation.y = Math.PI;
  d.cut({ position: new THREE.Vector3(-3.5, 1.4, 6.5), target: new THREE.Vector3(1, 1.6, -10), fov: 40 });
  void d.moveTo({ position: new THREE.Vector3(-4.5, 2.4, 9.5), target: new THREE.Vector3(1, 2.2, -14), fov: 42 }, 6, easeInOutSine);
  await ctx.wait(3.5);
  for (let i = 0; i <= 30; i++) {
    world.fade = i / 30;
    await ctx.wait(1.5 / 30);
  }
}
