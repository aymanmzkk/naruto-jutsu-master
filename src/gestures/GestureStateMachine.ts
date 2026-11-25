import { ScoreSmoother } from './GestureSmoothing';
import type { TemplateMatch } from './GestureRecognizer';
import type { GestureTemplate } from './GestureTemplates';
import { clamp } from '../utils/math';

/**
 * GESTURE STATE MACHINE — temporal validation of gestures.
 *
 *   NO_HANDS ──hands appear──▶ SEARCHING ──conf ≥ enter──▶ HOLDING
 *       ▲                          ▲                         │ conf stays ≥ exit
 *       └── hands lost > grace ────┤                         ▼ for holdMs
 *                                  └──── COOLDOWN ◀──── CONFIRMED (event fired once)
 *
 *  • Score smoothing (EMA) removes single-frame spikes.
 *  • Hysteresis (enter / exit thresholds) prevents flickering.
 *  • Temporal stability: a gesture must be held for `holdMs`.
 *  • Debouncing: after a confirmation, a cooldown + "release" requirement
 *    prevents the same gesture from being counted twice.
 *  • Short tracking losses (< lossGraceMs) pause the hold instead of resetting it.
 */

export type GesturePhase = 'NO_HANDS' | 'SEARCHING' | 'HOLDING' | 'CONFIRMED' | 'COOLDOWN';

export interface StateMachineParams {
  thresholdOffset: number;
  holdMultiplier: number;
  cooldownMs: number;
  lossGraceMs: number;
}

export type GestureEvent =
  | { type: 'confirmed'; id: string; confidence: number }
  | { type: 'wrong'; id: string; expected: string }
  | { type: 'hands-lost' }
  | { type: 'hands-found' };

export interface GestureSnapshot {
  phase: GesturePhase;
  /** Sign being validated (target in sequence mode, best candidate in free mode). */
  candidateId: string | null;
  /** Smoothed confidence of the candidate. */
  confidence: number;
  /** Required confidence for the candidate. */
  threshold: number;
  /** 0..1 progress of the stability hold. */
  holdProgress: number;
  /** Best scoring template overall. */
  bestId: string | null;
  bestConfidence: number;
  /** Smoothed confidence of every template. */
  confidences: Record<string, number>;
  /** Correction tip when the user is close but not there yet. */
  hint: string | null;
  /** Another sign currently being performed instead of the target. */
  wrongId: string | null;
  handsVisible: number;
}

const HYSTERESIS = 0.08;
const WRONG_HOLD_MS = 650;
const HINT_DELAY_MS = 1100;

export class GestureStateMachine {
  private smoother = new ScoreSmoother(110);
  private phase: GesturePhase = 'NO_HANDS';
  private hold = 0;
  private candidate: string | null = null;
  private lastTime: number | null = null;
  private lostFor = 0;
  private cooldownUntil = 0;
  private lastConfirmed: string | null = null;
  private released = true;
  private wrongTimer = 0;
  private wrongEmitted: string | null = null;
  private wrongClearTimer = 0;
  private hintTimer = 0;
  private hadHands = false;

  constructor(
    private getTemplate: (id: string) => GestureTemplate,
    private getParams: () => StateMachineParams,
  ) {}

  thresholdFor(id: string) {
    return clamp(this.getTemplate(id).threshold + this.getParams().thresholdOffset, 0.3, 0.98);
  }

  holdFor(id: string) {
    return this.getTemplate(id).holdMs * this.getParams().holdMultiplier;
  }

  reset() {
    this.smoother.reset();
    this.phase = 'NO_HANDS';
    this.hold = 0;
    this.candidate = null;
    this.lastTime = null;
    this.lostFor = 0;
    this.cooldownUntil = 0;
    this.lastConfirmed = null;
    this.released = true;
    this.wrongTimer = 0;
    this.wrongEmitted = null;
    this.hintTimer = 0;
  }

  /**
   * @param target sign expected by the sequence, or null for "free" recognition (NUI LAB).
   */
  update(
    matches: Map<string, TemplateMatch>,
    handsVisible: number,
    now: number,
    target: string | null,
  ): { snapshot: GestureSnapshot; events: GestureEvent[] } {
    const events: GestureEvent[] = [];
    const dt = this.lastTime === null ? 16 : clamp(now - this.lastTime, 0, 120);
    this.lastTime = now;
    const params = this.getParams();

    // 1. Smooth confidences
    const confidences: Record<string, number> = {};
    let bestId: string | null = null;
    let bestConf = 0;
    for (const [id, m] of matches) {
      const c = this.smoother.update(id, handsVisible > 0 ? m.confidence : 0, dt);
      confidences[id] = c;
      if (c > bestConf) {
        bestConf = c;
        bestId = id;
      }
    }

    // 2. Tracking loss handling
    if (handsVisible === 0) {
      this.lostFor += dt;
      if (this.lostFor > params.lossGraceMs) {
        if (this.hadHands) events.push({ type: 'hands-lost' });
        this.hadHands = false;
        this.phase = 'NO_HANDS';
        this.hold = 0;
        this.hintTimer = 0;
        this.wrongTimer = 0;
        if (!target) this.candidate = null;
      }
      return { snapshot: this.snapshot(confidences, bestId, bestConf, target, handsVisible, null, null), events };
    }
    if (!this.hadHands) events.push({ type: 'hands-found' });
    this.hadHands = true;
    this.lostFor = 0;
    if (this.phase === 'NO_HANDS') this.phase = 'SEARCHING';

    // 3. Release detection for debouncing (same gesture must drop before it can count again)
    if (this.lastConfirmed) {
      const c = confidences[this.lastConfirmed] ?? 0;
      if (c < this.thresholdFor(this.lastConfirmed) - HYSTERESIS) this.released = true;
    }

    // 4. Cooldown
    if (this.phase === 'COOLDOWN' || this.phase === 'CONFIRMED') {
      if (now < this.cooldownUntil) {
        this.phase = 'COOLDOWN';
        return { snapshot: this.snapshot(confidences, bestId, bestConf, target, handsVisible, null, null), events };
      }
      this.phase = 'SEARCHING';
      this.hold = 0;
    }

    // 5. Candidate selection
    let candidate: string | null = target;
    if (!target) {
      candidate = bestId && bestConf >= this.thresholdFor(bestId) ? bestId : this.phase === 'HOLDING' ? this.candidate : null;
    }
    if (candidate !== this.candidate) {
      this.candidate = candidate;
      this.hold = 0;
    }

    let hint: string | null = null;
    let wrongId: string | null = null;

    if (candidate) {
      const conf = confidences[candidate] ?? 0;
      const enter = this.thresholdFor(candidate);
      const exit = enter - HYSTERESIS;
      const blocked = candidate === this.lastConfirmed && !this.released;
      const above = !blocked && (conf >= enter || (this.phase === 'HOLDING' && conf >= exit));

      if (above) {
        this.phase = 'HOLDING';
        this.hold += dt;
        this.hintTimer = 0;
        if (this.hold >= this.holdFor(candidate)) {
          events.push({ type: 'confirmed', id: candidate, confidence: conf });
          this.phase = 'CONFIRMED';
          this.cooldownUntil = now + params.cooldownMs;
          this.lastConfirmed = candidate;
          this.released = false;
          this.hold = 0;
          this.wrongTimer = 0;
          this.wrongEmitted = null;
        }
      } else {
        // decay instead of instant reset: tolerates one or two noisy frames
        this.hold = Math.max(0, this.hold - dt * 2);
        this.phase = this.hold > 0 ? 'HOLDING' : 'SEARCHING';

        if (target) {
          // Hint when close but not matching
          if (conf >= 0.25) {
            this.hintTimer += dt;
            if (this.hintTimer >= HINT_DELAY_MS) hint = matches.get(target)?.weakest?.hint ?? null;
          } else {
            this.hintTimer = 0;
          }
        }
      }

      // 6. Wrong sign detection (sequence mode)
      if (target && bestId && bestId !== target) {
        const bestEnter = this.thresholdFor(bestId);
        if (bestConf >= bestEnter && conf < exit) {
          this.wrongTimer += dt;
          this.wrongClearTimer = 0;
          if (this.wrongTimer >= WRONG_HOLD_MS) {
            wrongId = bestId;
            if (this.wrongEmitted !== bestId && bestId !== this.lastConfirmed) {
              events.push({ type: 'wrong', id: bestId, expected: target });
              this.wrongEmitted = bestId;
            }
          }
        } else {
          this.wrongTimer = 0;
          this.wrongClearTimer += dt;
          if (this.wrongClearTimer > 500) this.wrongEmitted = null;
        }
      }
    } else {
      this.phase = 'SEARCHING';
    }

    if (target && !hint && handsVisible === 1) {
      const t = this.getTemplate(target);
      if (!t.singleHand?.allowed) hint = 'Show both hands to the camera';
    }

    return { snapshot: this.snapshot(confidences, bestId, bestConf, target, handsVisible, hint, wrongId), events };
  }

  private snapshot(
    confidences: Record<string, number>,
    bestId: string | null,
    bestConf: number,
    target: string | null,
    handsVisible: number,
    hint: string | null,
    wrongId: string | null,
  ): GestureSnapshot {
    const id = target ?? this.candidate;
    return {
      phase: this.phase,
      candidateId: id,
      confidence: id ? confidences[id] ?? 0 : 0,
      threshold: id ? this.thresholdFor(id) : 0,
      holdProgress: id ? clamp(this.hold / this.holdFor(id)) : 0,
      bestId,
      bestConfidence: bestConf,
      confidences,
      hint,
      wrongId,
      handsVisible,
    };
  }
}
