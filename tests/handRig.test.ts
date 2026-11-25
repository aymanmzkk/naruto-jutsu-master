import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GESTURE_TEMPLATES } from '../src/gestures/GestureTemplates';
import { handPose, solveHandJoints, synthesizeHands, F_CURLED, F_HALF, T_FOLDED, type HandPoseSpec } from '../src/gestures/SyntheticHand';
import { TrackingPipeline, handChirality } from '../src/gestures/TrackingPipeline';
import { DEFAULT_SETTINGS } from '../src/state/settingsStore';
import { HandRig, BONE_JOINTS } from '../src/engine/characters/HandRig';
import type { Handedness, Vec3 } from '../src/gestures/types';

const fist = handPose({ index: F_CURLED, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_FOLDED, [['y', 30], ['x', -20]], [0, 0, 0]);
const half = handPose({ index: F_HALF, middle: F_HALF, ring: F_HALF, pinky: F_HALF }, T_FOLDED, [['z', 70]], [0, 0, 0]);

describe('geometric handedness', () => {
  it('is positive for right hands and negative for left hands, in player and webcam frames', () => {
    for (const pose of [fist, half]) {
      const right = solveHandJoints(pose, 'Right');
      const left = solveHandJoints(pose, 'Left');
      expect(handChirality(right)).toBeGreaterThan(0.3);
      expect(handChirality(left)).toBeLessThan(-0.3);
      // same sign in MediaPipe's world-landmark frame (camera in front of the player)
      const [rawL, rawR] = synthesizeHands({ left: pose, right: pose });
      expect(handChirality(rawR.world)).toBeGreaterThan(0.3);
      expect(handChirality(rawL.world)).toBeLessThan(-0.3);
    }
  });

  it('auto-corrects inverted MediaPipe labels', () => {
    const pipe = new TrackingPipeline(() => ({ ...DEFAULT_SETTINGS.recognition, smoothingMinCutoff: 1000, smoothingBeta: 0 }));
    const pose = {
      left: handPose({ index: F_CURLED, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_FOLDED, [], [-0.12, 0, 0]),
      right: handPose({ index: F_HALF, middle: F_HALF, ring: F_HALF, pinky: F_HALF }, T_FOLDED, [], [0.12, 0, 0]),
    };
    // labels swapped, as an unmirrored webcam can produce
    const swapped = synthesizeHands(pose).map((h) => ({ ...h, handedness: (h.handedness === 'Left' ? 'Right' : 'Left') as Handedness }));
    let frame = pipe.process(swapped, 0, 1280, 720, { fps: 30, inferenceMs: 10 });
    for (let i = 1; i < 30; i++) frame = pipe.process(swapped, i * 33, 1280, 720, { fps: 30, inferenceMs: 10 });
    expect(pipe.labelsInverted).toBe(true);
    // the true right hand (half-bent fingers, placed at +x) ends up in the Right slot
    expect(handChirality(frame.right!.world)).toBeGreaterThan(0.3);
    expect(handChirality(frame.left!.world)).toBeLessThan(-0.3);

    // correct labels are left alone
    const pipe2 = new TrackingPipeline(() => ({ ...DEFAULT_SETTINGS.recognition }));
    for (let i = 0; i < 30; i++) pipe2.process(synthesizeHands(pose), i * 33, 1280, 720, { fps: 30, inferenceMs: 10 });
    expect(pipe2.labelsInverted).toBe(false);
  });
});

/** Max angle (deg) between each rig bone and the corresponding input bone. */
function retargetError(spec: HandPoseSpec, side: Handedness) {
  const joints = solveHandJoints(spec, side);
  const rig = new HandRig(side);
  rig.apply(rig.solve(joints), new THREE.Vector3(joints[0].x, joints[0].y, joints[0].z));
  rig.group.updateMatrixWorld(true);
  const world = new Map<number, THREE.Vector3>();
  BONE_JOINTS.forEach((j, i) => world.set(j, new THREE.Vector3().setFromMatrixPosition(rig.bones[i].matrixWorld)));
  // fingertips: rest offset from the last bone
  for (const [last, tip] of [
    [3, 4],
    [7, 8],
    [11, 12],
    [15, 16],
    [19, 20],
  ]) {
    const off = new THREE.Vector3(rig.rest[tip].x - rig.rest[last].x, rig.rest[tip].y - rig.rest[last].y, rig.rest[tip].z - rig.rest[last].z);
    world.set(tip, off.applyMatrix4(rig.bones[BONE_JOINTS.indexOf(last as (typeof BONE_JOINTS)[number])].matrixWorld));
  }
  const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
  let max = 0;
  let worst = '';
  for (const [a, b] of [
    [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12], [13, 14], [14, 15], [15, 16], [17, 18], [18, 19], [19, 20],
  ]) {
    const want = v(joints[b]).sub(v(joints[a])).normalize();
    const got = world.get(b)!.clone().sub(world.get(a)!).normalize();
    const deg = THREE.MathUtils.radToDeg(want.angleTo(got));
    if (deg > max) {
      max = deg;
      worst = `${a}-${b}`;
    }
  }
  rig.dispose();
  return { max, worst };
}

describe('3D hand retargeting', () => {
  for (const t of Object.values(GESTURE_TEMPLATES)) {
    for (const side of ['Left', 'Right'] as const) {
      const spec = side === 'Left' ? t.illustration.left : t.illustration.right;
      if (!spec) continue;
      it(`reproduces ${t.id} (${side}) within 10°`, () => {
        const { max, worst } = retargetError(spec, side);
        expect(max, `worst bone ${worst}`).toBeLessThan(10);
      });
    }
  }
});

describe('first-person hand placement', () => {
  it('reproduces the real distance between the hands at any camera distance', async () => {
    const { FirstPersonHands } = await import('../src/engine/characters/FirstPersonHands');
    const { toRawHand } = await import('../src/gestures/SyntheticHand');
    const pose = {
      left: handPose({ index: F_HALF, middle: F_HALF, ring: F_HALF, pinky: F_HALF }, T_FOLDED, [], [-0.07, 0, 0]),
      right: handPose({ index: F_HALF, middle: F_HALF, ring: F_HALF, pinky: F_HALF }, T_FOLDED, [], [0.07, 0, 0]),
    };
    const realGap = 0.14;
    for (const cameraDistance of [0.4, 0.55, 0.8]) {
      const pipe = new TrackingPipeline(() => ({ ...DEFAULT_SETTINGS.recognition, smoothingMinCutoff: 1000, smoothingBeta: 0 }));
      const raw = [
        toRawHand(solveHandJoints(pose.left, 'Left'), 'Left', { cameraDistance }),
        toRawHand(solveHandJoints(pose.right, 'Right'), 'Right', { cameraDistance }),
      ];
      const hands = new FirstPersonHands();
      for (let i = 0; i < 60; i++) hands.update(pipe.process(raw, i * 33, 1280, 720, { fps: 30, inferenceMs: 10 }), 1 / 30, i * 33);
      const sides = (hands as unknown as { sides: Record<Handedness, { rig: HandRig }> }).sides;
      const gap = sides.Right.rig.root.position.x - sides.Left.rig.root.position.x;
      expect(Math.abs(gap - realGap), `camera at ${cameraDistance} m: gap ${gap.toFixed(3)}`).toBeLessThan(0.02);
      hands.dispose();
    }
  });
});

describe('stable virtual hands', () => {
  const flat = handPose({ index: F_HALF, middle: F_HALF, ring: F_HALF, pinky: F_HALF }, T_FOLDED, [], [0, 0, 0]);
  const settings = () => ({ ...DEFAULT_SETTINGS.recognition, smoothingMinCutoff: 1000, smoothingBeta: 0 });

  it('keeps hand identities when MediaPipe swaps the labels for a frame', async () => {
    const { toRawHand } = await import('../src/gestures/SyntheticHand');
    const pipe = new TrackingPipeline(settings);
    // open hands (weak shape evidence): only the temporal tracking can fix a swap
    const open = handPose({ index: { mcp: 4, pip: 4, dip: 3 }, middle: { mcp: 4, pip: 4, dip: 3 }, ring: { mcp: 4, pip: 4, dip: 3 }, pinky: { mcp: 4, pip: 4, dip: 3 } }, T_FOLDED, [], [0, 0, 0]);
    const L = toRawHand(solveHandJoints({ ...open, position: [-0.1, 0, 0] }, 'Left'), 'Left');
    const R = toRawHand(solveHandJoints({ ...open, position: [0.1, 0, 0] }, 'Right'), 'Right');
    for (let i = 0; i < 5; i++) pipe.process([L, R], i * 33, 1280, 720, { fps: 30, inferenceMs: 10 });
    const swapped = [{ ...L, handedness: 'Right' as Handedness }, { ...R, handedness: 'Left' as Handedness }];
    const f = pipe.process(swapped, 5 * 33, 1280, 720, { fps: 30, inferenceMs: 10 });
    expect(f.right!.landmarks[0].x).toBeCloseTo(R.landmarks[0].x, 3);
    expect(f.left!.landmarks[0].x).toBeCloseTo(L.landmarks[0].x, 3);
  });

  it('relabels a lone curled hand from its shape', async () => {
    const { toRawHand } = await import('../src/gestures/SyntheticHand');
    const pipe = new TrackingPipeline(settings);
    const R = toRawHand(solveHandJoints(fist, 'Right'), 'Left'); // wrong label
    const f = pipe.process([R], 0, 1280, 720, { fps: 30, inferenceMs: 10 });
    expect(f.right).not.toBeNull();
    expect(f.left).toBeNull();
  });

  it('ignores a single-frame orientation glitch', async () => {
    const { FirstPersonHands } = await import('../src/engine/characters/FirstPersonHands');
    const { toRawHand } = await import('../src/gestures/SyntheticHand');
    const pipe = new TrackingPipeline(settings);
    const hands = new FirstPersonHands();
    const sides = (hands as unknown as { sides: Record<Handedness, { rig: HandRig }> }).sides;
    const good = toRawHand(solveHandJoints({ ...flat, position: [0.08, 0, 0] }, 'Right'), 'Right');
    const bad = toRawHand(solveHandJoints({ ...flat, rotations: [['y', 170]], position: [0.08, 0, 0] }, 'Right'), 'Right');
    let t = 0;
    for (let i = 0; i < 40; i++) hands.update(pipe.process([good], (t += 33), 1280, 720, { fps: 30, inferenceMs: 10 }), 1 / 30, t);
    const before = sides.Right.rig.root.quaternion.clone();
    hands.update(pipe.process([bad], (t += 33), 1280, 720, { fps: 30, inferenceMs: 10 }), 1 / 30, t);
    hands.update(pipe.process([good], (t += 33), 1280, 720, { fps: 30, inferenceMs: 10 }), 1 / 30, t);
    const deg = THREE.MathUtils.radToDeg(before.angleTo(sides.Right.rig.root.quaternion));
    expect(deg).toBeLessThan(3);
    hands.dispose();
  });

  it('sign assist places the clean sign around the real hands', async () => {
    const { FirstPersonHands } = await import('../src/engine/characters/FirstPersonHands');
    const { toRawHand } = await import('../src/gestures/SyntheticHand');
    const pipe = new TrackingPipeline(settings);
    const hands = new FirstPersonHands();
    const sides = (hands as unknown as { sides: Record<Handedness, { rig: HandRig }> }).sides;
    const tiger = GESTURE_TEMPLATES.tiger.illustration;
    hands.setOverride(tiger);
    hands.overrideFollowTracking = true;
    hands.overrideWeight = 1;
    const raw = [
      toRawHand(solveHandJoints({ ...flat, position: [-0.15, 0.05, 0] }, 'Left'), 'Left'),
      toRawHand(solveHandJoints({ ...flat, position: [0.05, 0.05, 0] }, 'Right'), 'Right'),
    ];
    let t = 0;
    for (let i = 0; i < 90; i++) hands.update(pipe.process(raw, (t += 33), 1280, 720, { fps: 30, inferenceMs: 10 }), 1 / 30, t);
    const l = sides.Left.rig.root.position;
    const r = sides.Right.rig.root.position;
    // relative arrangement = the sign's own arrangement (no interpenetration)
    const want = new THREE.Vector3(...tiger.right!.position).sub(new THREE.Vector3(...tiger.left!.position));
    expect(r.clone().sub(l).distanceTo(want)).toBeLessThan(0.01);
    // and the pair stays where the real hands are (left of centre here)
    expect((l.x + r.x) / 2).toBeLessThan(-0.02);
    hands.dispose();
  });
});
