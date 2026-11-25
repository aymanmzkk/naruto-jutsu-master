import type { LakesideWorld } from '../engine/LakesideWorld';
import type { JutsuLevelConfig, SubtitleLine } from '../game/levels/types';

/** What every scene receives from the level controller. */
export interface SceneContext {
  world: LakesideWorld;
  config: JutsuLevelConfig;
  /** Waits in GAME time (freezes while paused). Resolves early when skipping. */
  wait: (seconds: number) => Promise<void>;
  /** Shows subtitle lines one after another. */
  say: (lines: SubtitleLine[]) => Promise<void>;
  caption: (text: string | null) => void;
  /** True once the player pressed "skip" during the current skippable section. */
  skipping: () => boolean;
}
