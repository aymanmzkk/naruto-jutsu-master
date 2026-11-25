import type { SceneContext } from './SceneContext';

/**
 * FIRST PERSON SCENE — the player becomes the young ninja: the camera sits at
 * his eyes, his body is hidden and the webcam-driven hands appear.
 */
export function enterFirstPerson(ctx: SceneContext) {
  const { world } = ctx;
  world.director.cut(world.firstPersonShot());
  world.setFirstPerson(true);
  world.hands.mouthBlend = 0;
  world.hands.overrideWeight = 0;
  world.showSignPose(null);
  world.hands.group.position.set(0, 0, 0);
}

/** Animates the hands towards the mouth (charge phase). */
export async function bringHandsToMouth(ctx: SceneContext, seconds = 1.2) {
  const h = ctx.world.hands;
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    h.mouthBlend = i / steps;
    await ctx.wait(seconds / steps);
  }
}
