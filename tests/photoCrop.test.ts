import { describe, expect, it } from 'vitest';
import { computeHandCrop } from '../src/gestures/illustration/photoCapture';
import { synthesizeHands } from '../src/gestures/SyntheticHand';
import { GESTURE_TEMPLATES } from '../src/gestures/GestureTemplates';

describe('reference photo crop', () => {
  const W = 1280;
  const H = 720;

  for (const id of Object.keys(GESTURE_TEMPLATES)) {
    it(`contains both hands of ${id} inside a square within the frame`, () => {
      const hands = synthesizeHands(GESTURE_TEMPLATES[id].illustration);
      const c = computeHandCrop(hands, W, H);
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sy).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.size).toBeLessThanOrEqual(W + 1e-6);
      expect(c.sy + c.size).toBeLessThanOrEqual(H + 1e-6);
      for (const h of hands) {
        for (const p of h.landmarks) {
          const x = p.x * W;
          const y = p.y * H;
          if (x >= 0 && x <= W && y >= 0 && y <= H) {
            expect(x).toBeGreaterThanOrEqual(c.sx);
            expect(x).toBeLessThanOrEqual(c.sx + c.size);
            expect(y).toBeGreaterThanOrEqual(c.sy);
            expect(y).toBeLessThanOrEqual(c.sy + c.size);
          }
        }
      }
    });
  }

  it('falls back to a centred square without hands', () => {
    expect(computeHandCrop([], W, H)).toEqual({ sx: (W - H) / 2, sy: 0, size: H });
  });
});
