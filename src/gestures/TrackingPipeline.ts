import type { HandAnalysis, Handedness, RawHand, TrackingFrame, Vec3 } from './types';
import { LandmarkSmoother } from './GestureSmoothing';
import { analyzeHand } from './HandGeometry';
import type { RecognitionSettings } from '../state/settingsStore';

/**
 * Turns raw MediaPipe detections into a clean TrackingFrame:
 *  1. Handedness correction & disambiguation (two hands with the same label),
 *     with automatic detection of inverted labels from the hand's 3D shape
 *  2. Per-hand One Euro smoothing of image + world landmarks
 *  3. Geometry analysis (finger curls, angles, directions, palm size)
 */
/**
 * Geometric handedness of a set of 3D hand landmarks (any right-handed frame:
 * MediaPipe world landmarks or the player frame).
 * The knuckle line (pinky → index MCP) crossed with the hand axis (wrist →
 * middle MCP) points OUT OF THE PALM for a right hand and out of the back for a
 * left hand; fingers always curl towards the palm. So the mean curl of the four
 * fingers along that normal is > 0 for a right hand and < 0 for a left hand.
 * Returns roughly -1..1; values near 0 mean "flat hand, undecidable".
 */
export function handChirality(w: Vec3[]): number {
  const sub = (a: Vec3, b: Vec3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const lat = sub(w[5], w[17]);
  const up = sub(w[9], w[0]);
  const n = { x: lat.y * up.z - lat.z * up.y, y: lat.z * up.x - lat.x * up.z, z: lat.x * up.y - lat.y * up.x };
  const nl = Math.hypot(n.x, n.y, n.z) || 1;
  let s = 0;
  for (const [mcp, tip] of [
    [5, 8],
    [9, 12],
    [13, 16],
    [17, 20],
  ]) {
    const d = sub(w[tip], w[mcp]);
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    s += (d.x * n.x + d.y * n.y + d.z * n.z) / (dl * nl);
  }
  return s / 4;
}

export class TrackingPipeline {
  /**
   * Running agreement between MediaPipe's handedness labels and the hand's 3D
   * shape (+1 agree … -1 inverted). MediaPipe assumes a mirrored selfie image;
   * depending on the input its labels can come out swapped, which would drive
   * the virtual LEFT hand with the player's RIGHT hand (palm/thumb reversed).
   */
  private labelVote = 0;
  /** True when the labels were detected as inverted (auto-corrected). */
  labelsInverted = false;
  private smoothers: Record<Handedness, { img: LandmarkSmoother; world: LandmarkSmoother; lastSeen: number }> = {
    Left: { img: new LandmarkSmoother(), world: new LandmarkSmoother(), lastSeen: -1 },
    Right: { img: new LandmarkSmoother(), world: new LandmarkSmoother(), lastSeen: -1 },
  };

  constructor(private getSettings: () => RecognitionSettings) {}

  reset() {
    for (const k of ['Left', 'Right'] as const) {
      this.smoothers[k].img.reset();
      this.smoothers[k].world.reset();
      this.smoothers[k].lastSeen = -1;
      this.lastWrist[k] = null;
    }
  }

  /** Votes with clearly bent hands only; hysteresis avoids flip-flopping. */
  private updateLabelVote(raw: RawHand[]) {
    for (const h of raw) {
      if (h.score < 0.6) continue;
      const c = handChirality(h.world);
      if (Math.abs(c) < 0.28) continue;
      const agree = (h.handedness === 'Right' ? 1 : -1) * Math.sign(c);
      this.labelVote = Math.max(-1, Math.min(1, this.labelVote * 0.94 + agree * 0.06));
    }
    if (!this.labelsInverted && this.labelVote < -0.35) this.labelsInverted = true;
    else if (this.labelsInverted && this.labelVote > 0.35) this.labelsInverted = false;
  }

  process(
    raw: RawHand[],
    time: number,
    videoWidth: number,
    videoHeight: number,
    stats: { fps: number; inferenceMs: number },
  ): TrackingFrame {
    const s = this.getSettings();
    const aspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    this.updateLabelVote(raw);
    const hands = this.assignHandedness(raw, s.swapHandedness !== this.labelsInverted, time);

    const analysed: HandAnalysis[] = [];
    for (const h of hands) {
      const slot = this.smoothers[h.handedness];
      // A hand that reappears after a gap must not be blended with its old position.
      if (slot.lastSeen < 0 || time - slot.lastSeen > 250) {
        slot.img.reset();
        slot.world.reset();
      }
      slot.lastSeen = time;
      slot.img.configure(s.smoothingMinCutoff, s.smoothingBeta);
      slot.world.configure(s.smoothingMinCutoff, s.smoothingBeta);
      const smoothed: RawHand = {
        ...h,
        landmarks: slot.img.apply(h.landmarks, time),
        world: slot.world.apply(h.world, time),
      };
      analysed.push(analyzeHand(smoothed, aspect, s));
    }

    return {
      time,
      hands: analysed,
      left: analysed.find((h) => h.handedness === 'Left') ?? null,
      right: analysed.find((h) => h.handedness === 'Right') ?? null,
      videoWidth,
      videoHeight,
      fps: stats.fps,
      inferenceMs: stats.inferenceMs,
    };
  }

  /**
   * Robust left/right assignment, frame to frame:
   *  1. MediaPipe label (+ manual swap / auto-detected inversion)
   *  2. strong geometric evidence (fingers clearly curled) overrides the label
   *     of that hand
   *  3. otherwise the hands keep their identity over time: if swapping the two
   *     labels matches the previous wrist positions much better, swap them
   *     (MediaPipe often exchanges labels when hands touch or overlap)
   *  4. two hands with the same label are resolved by evidence, then by
   *     previous positions, then by image position
   */
  private lastWrist: Record<Handedness, { x: number; y: number; t: number } | null> = { Left: null, Right: null };

  private assignHandedness(raw: RawHand[], swap: boolean, time = 0): RawHand[] {
    const flip = (h: Handedness): Handedness => (h === 'Left' ? 'Right' : 'Left');
    const STRONG = 0.45;
    let hands = raw.slice(0, 2).map((h) => ({ ...h, handedness: (swap ? flip(h.handedness) : h.handedness) as Handedness }));
    const chir = hands.map((h) => handChirality(h.world));
    const strong = chir.map((c) => Math.abs(c) > STRONG);
    hands = hands.map((h, i) => (strong[i] ? { ...h, handedness: (chir[i] > 0 ? 'Right' : 'Left') as Handedness } : h));

    const prevOk = (k: Handedness) => {
      const p = this.lastWrist[k];
      return p && time - p.t < 400 ? p : null;
    };
    const dist = (h: RawHand, k: Handedness) => {
      const p = prevOk(k);
      return p ? Math.hypot(h.landmarks[0].x - p.x, h.landmarks[0].y - p.y) : NaN;
    };

    if (hands.length === 2) {
      const [a, b] = hands;
      if (a.handedness === b.handedness) {
        let aIsRight: boolean;
        if (strong[0] !== strong[1]) {
          // the hand with real evidence keeps its label
          aIsRight = strong[0] ? a.handedness === 'Right' : b.handedness !== 'Right';
        } else if (prevOk('Left') && prevOk('Right')) {
          aIsRight = dist(a, 'Right') + dist(b, 'Left') < dist(a, 'Left') + dist(b, 'Right');
        } else {
          aIsRight = a.landmarks[0].x < b.landmarks[0].x; // subject's right = image left
        }
        hands = [
          { ...a, handedness: aIsRight ? 'Right' : 'Left' },
          { ...b, handedness: aIsRight ? 'Left' : 'Right' },
        ];
      } else if (!strong[0] && !strong[1] && prevOk('Left') && prevOk('Right')) {
        const keep = dist(a, a.handedness) + dist(b, b.handedness);
        const swapped = dist(a, flip(a.handedness)) + dist(b, flip(b.handedness));
        if (swapped < keep * 0.5 && keep > 0.06) {
          hands = [
            { ...a, handedness: flip(a.handedness) },
            { ...b, handedness: flip(b.handedness) },
          ];
        }
      }
    } else if (hands.length === 1 && !strong[0]) {
      // a lone hand keeps the identity of the hand that was where it is now
      const h = hands[0];
      const own = dist(h, h.handedness);
      const other = dist(h, flip(h.handedness));
      if (!Number.isNaN(other) && (Number.isNaN(own) ? other < 0.08 : other < own * 0.5 && own > 0.06)) {
        hands = [{ ...h, handedness: flip(h.handedness) }];
      }
    }

    for (const h of hands) this.lastWrist[h.handedness] = { x: h.landmarks[0].x, y: h.landmarks[0].y, t: time };
    return hands;
  }
}
