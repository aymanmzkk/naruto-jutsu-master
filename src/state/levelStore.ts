import { createStore } from './createStore';

export type LevelPhase =
  | 'loading'
  | 'intro-video'
  | 'intro-cinematic'
  | 'zoom-in'
  | 'permissions'
  | 'signs'
  | 'charge'
  | 'fireball'
  | 'zoom-out'
  | 'ending-video'
  | 'ending-cinematic'
  | 'complete';

export interface LevelStats {
  startedAt: number;
  signsDoneAt: number;
  signDurations: number[];
  confidences: number[];
  wrongCount: number;
  blowPeak: number;
}

export interface LevelHudState {
  phase: LevelPhase;
  paused: boolean;
  /** Cinematic overlays */
  letterbox: boolean;
  subtitle: { speaker: string; text: string } | null;
  caption: string | null;
  centerMessage: string | null;
  skippable: boolean;
  /** Video layer */
  videoVisible: boolean;
  videoMissing: boolean;
  /** Gesture sequence */
  signIndex: number;
  signTotal: number;
  signIds: string[];
  signPhase: string;
  confidence: number;
  threshold: number;
  holdProgress: number;
  bestId: string | null;
  hint: string | null;
  wrongId: string | null;
  confirmPulse: number;
  wrongPulse: number;
  handsVisible: number;
  /** Activation */
  blowIntensity: number;
  blowSustain: number;
  blowReady: boolean;
  showFireFallback: boolean;
  assisted: boolean;
  stats: LevelStats;
}

export const initialLevelState: LevelHudState = {
  phase: 'loading',
  paused: false,
  letterbox: true,
  subtitle: null,
  caption: null,
  centerMessage: null,
  skippable: false,
  videoVisible: false,
  videoMissing: false,
  signIndex: 0,
  signTotal: 6,
  signIds: [],
  signPhase: 'NO_HANDS',
  confidence: 0,
  threshold: 0.75,
  holdProgress: 0,
  bestId: null,
  hint: null,
  wrongId: null,
  confirmPulse: 0,
  wrongPulse: 0,
  handsVisible: 0,
  blowIntensity: 0,
  blowSustain: 0,
  blowReady: false,
  showFireFallback: false,
  assisted: false,
  stats: { startedAt: 0, signsDoneAt: 0, signDurations: [], confidences: [], wrongCount: 0, blowPeak: 0 },
};

export const levelStore = createStore<LevelHudState>(initialLevelState);
