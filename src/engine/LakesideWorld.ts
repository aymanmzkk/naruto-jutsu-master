import * as THREE from 'three';
import { GameRenderer } from './GameRenderer';
import { CameraDirector, type Shot } from './camera/CameraDirector';
import { MENTOR_SPOT, PLAYER_SPOT, TARGET_SPOT, TrainingGround } from './environment/TrainingGround';
import { FATHER_STYLE, NinjaFigure, SON_STYLE } from './characters/NinjaFigure';
import { FireballEffect } from './effects/FireballEffect';
import { FirstPersonHands } from './characters/FirstPersonHands';
import { ParticleSystem, emberRamp } from './effects/ParticleSystem';
import { softDot } from './effects/textures';
import type { TrackingFrame } from '../gestures/types';
import type { TwoHandPose } from '../gestures/SyntheticHand';
import { rimUniforms, updateRim } from './materials/rimLight';
import { outlineUniforms } from './materials/toon';

/**
 * LAKESIDE WORLD — the complete 3D set of Level 1: environment, the two
 * characters, the fireball effect, the first-person hands and the camera.
 * Scenes (intro, first person, fireball, ending) only direct this world.
 */
export class LakesideWorld {
  readonly gfx: GameRenderer;
  readonly director: CameraDirector;
  readonly ground: TrainingGround;
  readonly son: NinjaFigure;
  readonly father: NinjaFigure;
  readonly fireball: FireballEffect;
  readonly fatherFireball: FireballEffect;
  readonly hands: FirstPersonHands;
  private handsLight: THREE.PointLight;
  private chakra: ParticleSystem;
  private chakraPulse = 0;
  /** Latest tracking frame (null when no webcam). */
  trackingFrame: TrackingFrame | null = null;
  flash = 0;
  fade = 0;
  private tmp = new THREE.Vector3();
  private time = 0;
  private signPoseTarget = 0;
  private assistTarget = 0;
  private assistPose: TwoHandPose | null = null;

  constructor(container: HTMLElement) {
    this.gfx = new GameRenderer(container);
    const { scene, camera } = this.gfx;
    this.ground = new TrainingGround(scene);
    this.director = new CameraDirector(camera);
    this.gfx.onResize((w, h) => {
      this.ground.setReflectionSize(w, h);
      outlineUniforms.uResolution.value.set(w, h);
    });
    // daylight anime look: no sunset rim light
    rimUniforms.uRimStrength.value = 0;

    this.son = new NinjaFigure(SON_STYLE);
    this.son.group.position.copy(PLAYER_SPOT);
    this.son.group.rotation.y = Math.PI;
    this.father = new NinjaFigure(FATHER_STYLE);
    this.father.group.position.copy(MENTOR_SPOT);
    this.father.group.rotation.y = Math.PI - 0.35;
    scene.add(this.son.group, this.father.group);

    this.fireball = new FireballEffect(scene);
    this.fatherFireball = new FireballEffect(scene);

    this.hands = new FirstPersonHands({ anime: true });
    // keep the hands above the bottom HUD (sign bar / breath meter)
    this.hands.overrideLift = 0.07;
    this.hands.trackedAnchorY = -0.14;
    this.hands.group.visible = false;
    camera.add(this.hands.group);
    this.handsLight = new THREE.PointLight('#ffd9b8', 0.6, 1.4, 2);
    this.handsLight.position.set(0.05, 0.12, 0.05);
    camera.add(this.handsLight);

    this.chakra = new ParticleSystem(500, softDot(), THREE.AdditiveBlending, 140);
    camera.add(this.chakra.points);

    this.gfx.onUpdate((dt) => this.update(dt));
    this.director.cut(this.establishingShot());
  }

  /* ----------- shots ----------- */

  establishingShot(): Shot {
    return { position: new THREE.Vector3(7.5, 4.6, 15), target: new THREE.Vector3(-0.5, 1.4, -8), fov: 42 };
  }

  /** First-person camera placed at the son's eyes, looking over the lake. */
  firstPersonShot(): Shot {
    this.son.group.updateMatrixWorld(true);
    const eye = this.son.eyesWorld(new THREE.Vector3());
    eye.z -= 0.05;
    const target = eye.clone().add(new THREE.Vector3(0.02, -0.16, -1).normalize().multiplyScalar(10));
    return { position: eye, target, fov: 58 };
  }

  overShoulderShot(): Shot {
    const p = PLAYER_SPOT.clone().add(new THREE.Vector3(-0.55, 1.62, 1.2));
    return { position: p, target: PLAYER_SPOT.clone().add(new THREE.Vector3(0.1, 1.35, -4)), fov: 40 };
  }

  get target() {
    return TARGET_SPOT;
  }

  /** Mouth position in first person (just below and in front of the camera). */
  firstPersonMouth(out = new THREE.Vector3()) {
    const cam = this.gfx.camera;
    return out.set(0, -0.11, -0.25).applyMatrix4(cam.matrixWorld);
  }

  setFirstPerson(on: boolean) {
    this.hands.group.visible = on;
    this.son.group.visible = !on;
    this.director.handheld = on ? 0.35 : 0.6;
  }

  /**
   * Shows a sign with the first-person hands (assisted mode: no webcam, so
   * the virtual hands perform the confirmed sign). null releases it.
   */
  /**
   * SIGN ASSIST (camera mode): blends the tracked hands into the clean pose
   * of the sign the player is close to (0 = raw tracking … 1 = clean sign),
   * keeping the player's hand location. Removes the jitter and the hands
   * sinking into each other exactly when the player is forming a sign.
   */
  assistSign(pose: TwoHandPose | null, weight: number) {
    if (pose && pose !== this.assistPose) {
      this.assistPose = pose;
      if (this.signPoseTarget === 0) this.hands.setOverride(pose);
    }
    this.assistTarget = pose ? THREE.MathUtils.clamp(weight, 0, 1) : 0;
  }

  showSignPose(pose: TwoHandPose | null) {
    if (pose) this.hands.setOverride(pose);
    this.signPoseTarget = pose ? 1 : 0;
  }

  /** Visual feedback when a sign is confirmed: chakra sparks around the hands. */
  pulseChakra(color = new THREE.Color('#ffb15a')) {
    this.chakraPulse = 1;
    this.handsLight.color.copy(color);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.04 + Math.random() * 0.1;
      this.chakra.emit({
        position: new THREE.Vector3(Math.cos(a) * r, -0.12 + Math.sin(a) * r * 0.8, -0.4),
        velocity: new THREE.Vector3(Math.cos(a) * 0.25, 0.25 + Math.random() * 0.35, Math.sin(a) * 0.1),
        life: 0.6 + Math.random() * 0.6,
        size: 0.03,
        sizeEnd: 0.005,
        ramp: emberRamp,
        drag: 2,
        buoyancy: 0.2,
        intensity: 2.2,
      });
    }
  }

  private update(dt: number) {
    this.time += dt;
    this.director.update(dt);
    updateRim(this.gfx.camera, this.ground.sunDir);
    this.son.update(dt);
    this.father.update(dt);
    this.fireball.update(dt);
    this.fatherFireball.update(dt);
    const f = this.fireball.intensity >= this.fatherFireball.intensity ? this.fireball : this.fatherFireball;
    this.ground.update(dt, f.position.y > -50 ? f.light.position : undefined, Math.max(this.fireball.intensity, this.fatherFireball.intensity));
    if (this.hands.group.visible) {
      const h = this.hands;
      const target = Math.max(this.signPoseTarget, this.assistTarget);
      // assisted (no camera) poses are placed in front of the chest; the
      // sign assist keeps the pair where the player's real hands are
      h.overrideFollowTracking = this.signPoseTarget === 0;
      const rate = target > h.overrideWeight ? 10 : 5;
      h.overrideWeight += (target - h.overrideWeight) * (1 - Math.exp(-rate * dt));
      if (target === 0 && h.overrideWeight < 0.002) h.overrideWeight = 0;
      h.update(this.trackingFrame, dt, performance.now());
    }
    this.chakra.update(dt);
    this.chakraPulse = Math.max(0, this.chakraPulse - dt * 2.5);
    this.handsLight.intensity = 0.6 + this.chakraPulse * 2.5 + this.fireball.intensity * 0.4;
    const u = this.gfx.uniforms;
    u.uAberration.value = this.director.aberration * 0.6;
    this.flash = Math.max(0, this.flash - dt * 2.6);
    u.uFlash.value = this.flash;
    u.uFade.value = this.fade;
    this.gfx.bloom.strength = 0.22 + Math.max(this.fireball.intensity, this.fatherFireball.intensity) * 0.2;
    void this.tmp;
  }

  /**
   * Renders an illustrated "hero shot" for the completion screen: the young
   * ninja (original design) seen from behind in a low angle, releasing the
   * Great Fireball over the lake, in the level's cel-shaded anime style.
   * Returns a JPEG data URL (or null if the capture failed).
   */
  captureHeroShot(width = 900, height = 1080): string | null {
    const gfx = this.gfx;
    const r = gfx.renderer;
    const cam = gfx.camera;
    const canvas = r.domElement;
    const pr = r.getPixelRatio();
    const prevVisibility = canvas.style.visibility;
    try {
      canvas.style.visibility = 'hidden';
      // stage: the son releasing the fire, father out of frame, no FP hands
      this.setFirstPerson(false);
      this.son.group.visible = true;
      this.son.group.rotation.y = Math.PI;
      this.father.group.visible = false;
      for (const p of this.ground.endPosts) p.visible = false;
      this.son.setPose('breath', 1000);
      for (let i = 0; i < 12; i++) this.son.update(1 / 30);
      this.son.group.updateMatrixWorld(true);
      this.fatherFireball.reset();
      this.fireball.reset();
      const mouth = this.son.mouthWorld(new THREE.Vector3());
      const dir = TARGET_SPOT.clone().sub(mouth).normalize();
      this.fireball.launch({ origin: mouth, direction: dir, target: TARGET_SPOT.clone(), power: 1 });
      for (let i = 0; i < 56; i++) this.fireball.update(1 / 60);
      this.ground.update(0, this.fireball.light.position, 1);

      // low three-quarter back view: ninja on the left, fireball filling the sky
      const head = PLAYER_SPOT.clone().add(new THREE.Vector3(0, 1.45, 0));
      cam.position.copy(head).add(new THREE.Vector3(1.25, -0.75, 3.3));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.fireball.position.clone().add(new THREE.Vector3(-0.4, 0.9, 0)));
      cam.fov = 50;
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      r.setSize(width / pr, height / pr, false);
      gfx.composer.setSize(width / pr, height / pr);
      gfx.bloom.resolution.set(width / 2, height / 2);
      gfx.uniforms.uResolution.value.set(width, height);
      outlineUniforms.uResolution.value.set(width, height);
      this.ground.setReflectionSize(width, height);
      const u = gfx.uniforms;
      u.uFade.value = 0;
      u.uFlash.value = 0;
      u.uAberration.value = 0;
      u.uVignette.value = 0.22;
      updateRim(cam, this.ground.sunDir);
      gfx.composer.render(1 / 60);
      const url = canvas.toDataURL('image/jpeg', 0.9);
      return url.length > 1000 ? url : null;
    } catch (e) {
      console.warn('[completion] hero shot failed', e);
      return null;
    } finally {
      this.gfx.uniforms.uVignette.value = 0.12;
      for (const p of this.ground.endPosts) p.visible = true;
      this.fireball.reset();
      gfx.resize();
      canvas.style.visibility = prevVisibility;
    }
  }

  start() {
    this.gfx.start();
  }

  dispose() {
    this.hands.dispose();
    this.fireball.dispose();
    this.fatherFireball.dispose();
    this.chakra.dispose();
    this.gfx.dispose();
  }
}
