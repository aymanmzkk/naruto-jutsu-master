import { describe, expect, it } from 'vitest';
import { GESTURE_TEMPLATES } from '../src/gestures/GestureTemplates';
import { synthesizeHands, handPose, F_STRAIGHT, F_CURLED, T_OPEN, T_FOLDED, type TwoHandPose } from '../src/gestures/SyntheticHand';
import { TrackingPipeline } from '../src/gestures/TrackingPipeline';
import { DEFAULT_SETTINGS } from '../src/state/settingsStore';
import { matchTemplate } from '../src/gestures/GestureRecognizer';
import { GestureSequence } from '../src/gestures/GestureSequence';
import { GestureStateMachine } from '../src/gestures/GestureStateMachine';
import { getTemplate } from '../src/gestures/GestureTemplates';
import type { TrackingFrame } from '../src/gestures/types';

const params = DEFAULT_SETTINGS.recognition;

function frameFor(pose: TwoHandPose, time = 0, scale = 1): TrackingFrame {
  const pipe = new TrackingPipeline(() => ({ ...params, smoothingMinCutoff: 1000, smoothingBeta: 0 }));
  const raw = synthesizeHands(pose).map((h) => ({
    ...h,
    // simulate a different camera distance: everything shrinks around the image centre
    landmarks: h.landmarks.map((p) => ({ x: 0.5 + (p.x - 0.5) * scale, y: 0.5 + (p.y - 0.5) * scale, z: p.z })),
  }));
  return pipe.process(raw, time, 1280, 720, { fps: 30, inferenceMs: 10 });
}

const ids = Object.keys(GESTURE_TEMPLATES);

describe('finger state analysis', () => {
  it('detects extended and bent fingers from synthetic landmarks', () => {
    const f = frameFor({
      right: handPose({ index: F_STRAIGHT, middle: F_STRAIGHT, ring: F_CURLED, pinky: F_CURLED }, T_FOLDED, [], [0.1, 0, 0]),
      left: handPose({ index: F_CURLED, middle: F_CURLED, ring: F_CURLED, pinky: F_CURLED }, T_OPEN, [], [-0.1, 0, 0]),
    });
    expect(f.right!.fingers.index.state).toBe('extended');
    expect(f.right!.fingers.middle.state).toBe('extended');
    expect(f.right!.fingers.ring.state).toBe('bent');
    expect(f.right!.fingers.pinky.state).toBe('bent');
    expect(f.right!.fingers.thumb.state).not.toBe('extended');
    expect(f.left!.fingers.index.state).toBe('bent');
    expect(f.left!.fingers.thumb.state).toBe('extended');
    expect(f.right!.fingers.index.angleFromUp).toBeLessThan(20);
  });
});

describe('template discrimination', () => {
  for (const id of ids) {
    it(`reference pose of ${id} is recognised as ${id} (and nothing else)`, () => {
      const frame = frameFor(GESTURE_TEMPLATES[id].illustration);
      expect(frame.hands.length).toBe(2);
      const scores = ids.map((other) => ({
        id: other,
        c: matchTemplate(GESTURE_TEMPLATES[other], frame.left, frame.right, params).confidence,
      }));
      const own = scores.find((s) => s.id === id)!;
      const msg = scores.map((s) => `${s.id}=${s.c.toFixed(2)}`).join(' ');
      expect(own.c, msg).toBeGreaterThanOrEqual(GESTURE_TEMPLATES[id].threshold + 0.05);
      for (const s of scores) {
        if (s.id === id) continue;
        expect(s.c, `${id} vs ${s.id}: ${msg}`).toBeLessThan(GESTURE_TEMPLATES[s.id].threshold - 0.05);
      }
    });
  }

  it('is invariant to camera distance (hands appear 40% smaller)', () => {
    for (const id of ids) {
      const frame = frameFor(GESTURE_TEMPLATES[id].illustration, 0, 0.6);
      const c = matchTemplate(GESTURE_TEMPLATES[id], frame.left, frame.right, params).confidence;
      expect(c, id).toBeGreaterThanOrEqual(GESTURE_TEMPLATES[id].threshold);
    }
  });

  it('explains what to correct', () => {
    // Tiger with ring fingers extended
    const pose = structuredClone(GESTURE_TEMPLATES.tiger.illustration);
    pose.right!.ring = F_STRAIGHT;
    pose.right!.pinky = F_STRAIGHT;
    const frame = frameFor(pose);
    const m = matchTemplate(GESTURE_TEMPLATES.tiger, frame.left, frame.right, params);
    expect(m.confidence).toBeLessThan(GESTURE_TEMPLATES.tiger.threshold);
    expect(m.weakest?.hint).toMatch(/Fold your right (ring|little) finger/);
  });
});

describe('state machine & sequence', () => {
  const p = { ...params };

  it('requires the sign to be held for holdMs before confirming', () => {
    const sm = new GestureStateMachine(getTemplate, () => p);
    const frame = frameFor(GESTURE_TEMPLATES.snake.illustration);
    const seq = new GestureSequence(['snake']);
    const matches = seq.recognizer.evaluate(frame);
    let confirmedAt = -1;
    for (let t = 0; t <= 1500; t += 33) {
      const { events } = sm.update(matches, 2, t, 'snake');
      if (events.some((e) => e.type === 'confirmed')) {
        confirmedAt = t;
        break;
      }
    }
    expect(confirmedAt).toBeGreaterThanOrEqual(GESTURE_TEMPLATES.snake.holdMs);
    expect(confirmedAt).toBeLessThan(GESTURE_TEMPLATES.snake.holdMs + 300);
  });

  it('does not advance on a wrong sign and reports it', () => {
    const seq = new GestureSequence(['snake', 'ram']);
    const wrong = GESTURE_TEMPLATES.tiger.illustration;
    const events: string[] = [];
    for (let t = 0; t <= 2500; t += 33) {
      const f = { ...frameFor(wrong, t), time: t };
      const u = seq.update(f);
      u.events.forEach((e) => events.push(e.type));
    }
    expect(seq.index).toBe(0);
    expect(events).not.toContain('advanced');
  });

  it('completes the full Great Fireball sequence in order', () => {
    const order = ['snake', 'ram', 'monkey', 'boar', 'horse', 'tiger'];
    const seq = new GestureSequence(order);
    let t = 0;
    for (const id of order) {
      const start = seq.index;
      for (let i = 0; i < 90 && seq.index === start; i++) {
        t += 33;
        seq.update({ ...frameFor(GESTURE_TEMPLATES[id].illustration, t), time: t });
      }
      expect(seq.index, `stuck at ${id}`).toBe(start + 1);
      // brief transition with no hands between signs
      for (let i = 0; i < 6; i++) {
        t += 33;
        seq.update({ time: t, hands: [], left: null, right: null });
      }
    }
    expect(seq.complete).toBe(true);
  });

  it('survives a short tracking loss without resetting the hold', () => {
    const sm = new GestureStateMachine(getTemplate, () => p);
    const seq = new GestureSequence(['tiger']);
    const matches = seq.recognizer.evaluate(frameFor(GESTURE_TEMPLATES.tiger.illustration));
    const empty = new Map();
    let t = 0;
    for (; t < 300; t += 33) sm.update(matches, 2, t, 'tiger');
    const before = sm.update(matches, 2, t, 'tiger').snapshot.holdProgress;
    for (let i = 0; i < 5; i++) sm.update(empty, 0, (t += 33), 'tiger'); // ~165ms gap < grace
    const after = sm.update(matches, 2, (t += 33), 'tiger').snapshot.holdProgress;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
