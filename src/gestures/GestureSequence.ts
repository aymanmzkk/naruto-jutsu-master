import type { TrackingFrame } from './types';
import { GestureRecognizer, type TemplateMatch } from './GestureRecognizer';
import { GestureStateMachine, type GestureEvent, type GestureSnapshot } from './GestureStateMachine';
import { getTemplate, type GestureTemplate } from './GestureTemplates';
import { settingsStore } from '../state/settingsStore';

/**
 * GESTURE SEQUENCE — recognises an ordered list of hand signs (a jutsu).
 * Wires the recognizer and the state machine together; the target of the
 * state machine is always the current sign, so the sequence only advances
 * when the correct sign is held stably.
 */

export type SequenceEvent =
  | GestureEvent
  | { type: 'advanced'; index: number; id: string; confidence: number }
  | { type: 'completed' };

export interface SequenceUpdate {
  snapshot: GestureSnapshot;
  matches: Map<string, TemplateMatch>;
  events: SequenceEvent[];
  index: number;
  total: number;
  complete: boolean;
}

export class GestureSequence {
  readonly recognizer: GestureRecognizer;
  readonly machine: GestureStateMachine;
  private idx = 0;
  private done = false;

  constructor(
    public readonly signIds: string[],
    templates: GestureTemplate[] = signIds.map(getTemplate),
  ) {
    const unique = Array.from(new Map(templates.map((t) => [t.id, t])).values());
    this.recognizer = new GestureRecognizer(unique, () => settingsStore.get().recognition);
    this.machine = new GestureStateMachine(getTemplate, () => settingsStore.get().recognition);
  }

  get index() {
    return this.idx;
  }
  get total() {
    return this.signIds.length;
  }
  get complete() {
    return this.done;
  }
  get currentId(): string | null {
    return this.done ? null : this.signIds[this.idx];
  }

  reset() {
    this.idx = 0;
    this.done = false;
    this.machine.reset();
  }

  /** Jump to a step (NUI LAB debug control). */
  goTo(index: number) {
    this.idx = Math.max(0, Math.min(this.signIds.length - 1, index));
    this.done = false;
    this.machine.reset();
  }

  /**
   * Assisted mode only (no webcam available): advances one step manually.
   * Clearly labelled in the UI — never used when the camera works.
   */
  forceAdvance(): SequenceEvent[] {
    if (this.done) return [];
    const id = this.signIds[this.idx];
    const out: SequenceEvent[] = [{ type: 'advanced', index: this.idx, id, confidence: 1 }];
    this.idx++;
    if (this.idx >= this.signIds.length) {
      this.done = true;
      out.push({ type: 'completed' });
    }
    this.machine.reset();
    return out;
  }

  update(frame: Pick<TrackingFrame, 'left' | 'right' | 'hands' | 'time'>): SequenceUpdate {
    const matches = this.recognizer.evaluate(frame);
    const { snapshot, events } = this.machine.update(matches, frame.hands.length, frame.time, this.currentId);
    const out: SequenceEvent[] = [...events];
    for (const e of events) {
      if (e.type === 'confirmed' && !this.done && e.id === this.currentId) {
        out.push({ type: 'advanced', index: this.idx, id: e.id, confidence: e.confidence });
        this.idx++;
        if (this.idx >= this.signIds.length) {
          this.done = true;
          this.idx = this.signIds.length;
          out.push({ type: 'completed' });
        }
      }
    }
    return { snapshot, matches, events: out, index: this.idx, total: this.total, complete: this.done };
  }
}

/** Free recognition (no target): used by the NUI LAB "live gesture" panel. */
export class FreeGestureRecognizer {
  readonly recognizer: GestureRecognizer;
  readonly machine: GestureStateMachine;

  constructor(templates: GestureTemplate[]) {
    this.recognizer = new GestureRecognizer(templates, () => settingsStore.get().recognition);
    this.machine = new GestureStateMachine(getTemplate, () => settingsStore.get().recognition);
  }

  update(frame: Pick<TrackingFrame, 'left' | 'right' | 'hands' | 'time'>) {
    const matches = this.recognizer.evaluate(frame);
    const r = this.machine.update(matches, frame.hands.length, frame.time, null);
    return { ...r, matches };
  }
}
