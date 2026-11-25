import type { FingerName, HandAnalysis, TrackingFrame } from './types';
import { FINGERS } from './types';
import { handPoint } from './HandGeometry';
import type { AngleRange, FingerExpectation, GestureTemplate, HandRequirement, Relation } from './GestureTemplates';
import { angle2, clamp, dist2, smoothstep } from '../utils/math';
import type { RecognitionSettings } from '../state/settingsStore';

/**
 * GESTURE RECOGNIZER
 *
 * Compares the analysed hands of a frame with every template and returns a
 * confidence (0..1) per template, plus a breakdown of every feature so the
 * UI can explain what to correct.
 *
 *   confidence = weightedMean(features) × (0.55 + 0.45 × worstFeature)
 *
 * The second factor makes a single clearly-wrong feature (e.g. a finger that
 * should be folded) sink the score even when everything else matches.
 */

export interface FeatureScore {
  label: string;
  score: number;
  weight: number;
  hint: string;
}

export interface TemplateMatch {
  id: string;
  confidence: number;
  /** Feature breakdown of the best assignment. */
  features: FeatureScore[];
  /** Feature that most needs correcting. */
  weakest: FeatureScore | null;
  /** Hands used ('both' | 'single' | 'none'). */
  mode: 'both' | 'single' | 'none';
  /** Whether left/right requirements were swapped to match (mirrorable templates). */
  swapped: boolean;
}

export type RecognitionParams = Pick<RecognitionSettings, 'extendedMax' | 'bentMin' | 'tolerance' | 'distanceTolerance'>;

const FINGER_LABEL: Record<FingerName, string> = {
  thumb: 'thumb',
  index: 'index finger',
  middle: 'middle finger',
  ring: 'ring finger',
  pinky: 'little finger',
};

export function scoreFinger(curl: number, exp: FingerExpectation, p: RecognitionParams): number {
  const s = 0.085 * p.tolerance;
  const e = p.extendedMax;
  const b = p.bentMin;
  switch (exp) {
    case 'extended':
      return 1 - smoothstep(e, e + 2 * s, curl);
    case 'bent':
      return smoothstep(b - 2 * s, b, curl);
    case 'partial':
      return Math.min(smoothstep(e - 2 * s, e, curl), 1 - smoothstep(b, b + 2 * s, curl));
    case 'notBent':
      return 1 - smoothstep(b - s, b + s, curl);
    case 'notExtended':
      return smoothstep(e - s, e + s, curl);
    case 'any':
      return 1;
  }
}

export function scoreAngle(angle: number, r: AngleRange, tolerance: number): number {
  const falloff = 28 * tolerance;
  if (angle >= r.min && angle <= r.max) return 1;
  const d = angle < r.min ? r.min - angle : angle - r.max;
  return clamp(1 - d / falloff);
}

function expectationVerb(exp: FingerExpectation) {
  switch (exp) {
    case 'extended':
    case 'notBent':
      return 'Straighten';
    case 'bent':
    case 'notExtended':
      return 'Fold';
    case 'partial':
      return 'Half-bend';
    default:
      return 'Adjust';
  }
}

function scoreHand(hand: HandAnalysis, req: HandRequirement, side: string, p: RecognitionParams, out: FeatureScore[]) {
  for (const f of FINGERS) {
    const exp = req.fingers[f];
    if (!exp || exp === 'any') continue;
    out.push({
      label: `${side} ${f}: ${exp}`,
      score: scoreFinger(hand.fingers[f].curl, exp, p),
      weight: f === 'thumb' ? 0.7 : 1,
      hint: `${expectationVerb(exp)} your ${side.toLowerCase()} ${FINGER_LABEL[f]}`,
    });
  }
  if (req.handAngle) {
    out.push({
      label: `${side} hand direction`,
      score: scoreAngle(hand.angleFromUp, req.handAngle, p.tolerance),
      weight: req.handAngle.weight ?? 1.2,
      hint: req.handAngle.hint ?? 'Rotate your hand',
    });
  }
  if (req.fingerAngle) {
    const fa = req.fingerAngle;
    out.push({
      label: `${side} ${fa.finger} direction`,
      score: scoreAngle(hand.fingers[fa.finger].angleFromUp, fa, p.tolerance),
      weight: fa.weight ?? 1,
      hint: fa.hint ?? `Point your ${FINGER_LABEL[fa.finger]} correctly`,
    });
  }
}

function scoreRelation(L: HandAnalysis, R: HandAnalysis, rel: Relation, p: RecognitionParams): FeatureScore {
  const palm = (L.palmSize + R.palmSize) / 2;
  if (rel.kind === 'distance') {
    const d = dist2(handPoint(L, rel.a), handPoint(R, rel.b)) / palm;
    let score = 1;
    if (rel.max !== undefined) {
      const lim = rel.max * p.distanceTolerance;
      score = Math.min(score, 1 - smoothstep(lim, lim * (1 + 0.6 * p.tolerance), d));
    }
    if (rel.min !== undefined) {
      const lim = rel.min / p.distanceTolerance;
      score = Math.min(score, smoothstep(lim * (1 - 0.5 * p.tolerance), lim, d));
    }
    return { label: `distance ${rel.a}↔${rel.b} = ${d.toFixed(2)}`, score, weight: rel.weight, hint: rel.hint };
  }
  const a = angle2(L.direction, R.direction);
  return {
    label: `angle between hands = ${a.toFixed(0)}°`,
    score: scoreAngle(a, { min: rel.min, max: rel.max }, p.tolerance),
    weight: rel.weight,
    hint: rel.hint,
  };
}

function combine(features: FeatureScore[]): { confidence: number; weakest: FeatureScore | null } {
  let sw = 0;
  let s = 0;
  let worst: FeatureScore | null = null;
  for (const f of features) {
    if (f.weight <= 0) continue;
    sw += f.weight;
    s += f.score * f.weight;
    if (!worst || f.score * Math.sqrt(f.weight) < worst.score * Math.sqrt(worst.weight)) worst = f;
  }
  if (sw === 0) return { confidence: 0, weakest: null };
  const mean = s / sw;
  const min = worst ? worst.score : 1;
  return { confidence: clamp(mean * (0.55 + 0.45 * min)), weakest: worst };
}

export function matchTemplate(
  tpl: GestureTemplate,
  left: HandAnalysis | null,
  right: HandAnalysis | null,
  p: RecognitionParams,
): TemplateMatch {
  if (left && right) {
    const assign = (swap: boolean): TemplateMatch => {
      const features: FeatureScore[] = [];
      // When swapped, the template's "left" requirement is evaluated on the right hand.
      const hL = swap ? right : left;
      const hR = swap ? left : right;
      scoreHand(hL, tpl.left, swap ? 'Right' : 'Left', p, features);
      scoreHand(hR, tpl.right, swap ? 'Left' : 'Right', p, features);
      for (const rel of tpl.relations) features.push(scoreRelation(hL, hR, rel, p));
      const { confidence, weakest } = combine(features);
      return { id: tpl.id, confidence, features, weakest, mode: 'both', swapped: swap };
    };
    const direct = assign(false);
    if (!tpl.mirrorable) return direct;
    const swapped = assign(true);
    return swapped.confidence > direct.confidence ? swapped : direct;
  }

  const only = left ?? right;
  if (!only) return { id: tpl.id, confidence: 0, features: [], weakest: null, mode: 'none', swapped: false };
  if (!tpl.singleHand?.allowed) {
    return {
      id: tpl.id,
      confidence: 0,
      features: [{ label: 'second hand missing', score: 0, weight: 1, hint: 'Show both hands to the camera' }],
      weakest: { label: 'second hand missing', score: 0, weight: 1, hint: 'Show both hands to the camera' },
      mode: 'single',
      swapped: false,
    };
  }
  // One hand may hide behind the other: accept whichever requirement it matches best.
  const side = only.handedness;
  const candidates = [tpl.left, tpl.right].map((req) => {
    const f: FeatureScore[] = [];
    scoreHand(only, req, side, p, f);
    return { f, ...combine(f) };
  });
  const best = candidates[0].confidence >= candidates[1].confidence ? candidates[0] : candidates[1];
  return {
    id: tpl.id,
    confidence: clamp(best.confidence - (tpl.singleHand.penalty ?? 0.15)),
    features: best.f,
    weakest: best.weakest,
    mode: 'single',
    swapped: false,
  };
}

export class GestureRecognizer {
  constructor(
    private templates: GestureTemplate[],
    private getParams: () => RecognitionParams,
  ) {}

  setTemplates(t: GestureTemplate[]) {
    this.templates = t;
  }

  getTemplates() {
    return this.templates;
  }

  /** Scores every template for the given frame. */
  evaluate(frame: Pick<TrackingFrame, 'left' | 'right'>): Map<string, TemplateMatch> {
    const p = this.getParams();
    const out = new Map<string, TemplateMatch>();
    for (const t of this.templates) out.set(t.id, matchTemplate(t, frame.left, frame.right, p));
    return out;
  }
}
