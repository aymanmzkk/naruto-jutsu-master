/**
 * LEVEL ARCHITECTURE
 *
 * A level is pure data (LevelDefinition) + an optional lazily-loaded module.
 * Locked levels only need a definition (card artwork, names). To unlock a new
 * jutsu: create game/levels/LevelN/config.ts with its sign sequence, video
 * timing, activation and cinematic lines, register any new gesture template,
 * implement its effect (like FireballEffect) and set `load` in the registry.
 * The core engine (tracker, recognizer, sequence, HUD, video manager) is reused
 * unchanged.
 */

export type Element = 'fire' | 'water' | 'lightning' | 'wind' | 'earth' | 'shadow' | 'yin' | 'summon';

export interface LevelDefinition {
  id: number;
  /** Romanised jutsu name. */
  title: string;
  /** English translation. */
  subtitle: string;
  kanji: string;
  element: Element;
  difficulty: 1 | 2 | 3 | 4 | 5;
  signCount: number;
  locked: boolean;
  /** Lazily loaded playable content. */
  load?: () => Promise<{ default: JutsuLevelConfig }>;
}

export interface SubtitleLine {
  speaker: string;
  text: string;
  /** Seconds the line stays on screen. */
  duration: number;
}

export interface VideoConfig {
  /** Path inside /public, e.g. /assets/videos/level1.mp4 */
  src: string;
  /** Where the intro starts (s). */
  introStart: number;
  /** Exact moment the intro pauses for gameplay (s). */
  pauseAt: number;
  /** Where the video continues after gameplay. null = exactly where it paused. */
  resumeAt: number | null;
  /** Where the ending stops. null = end of file. */
  endAt: number | null;
  /** Point of the frame the camera zooms into (0..1) — the character. */
  focus: { x: number; y: number; zoom: number };
  /**
   * Optional crop (fractions of the frame) for clips that contain unwanted
   * borders, e.g. a screen recording with the web player's control bar.
   */
  crop?: { top?: number; right?: number; bottom?: number; left?: number };
}

/** CSS transform that scales the kept part of the frame to fill the screen. */
export function cropTransform(crop: VideoConfig['crop']) {
  const t = crop?.top ?? 0;
  const r = crop?.right ?? 0;
  const b = crop?.bottom ?? 0;
  const l = crop?.left ?? 0;
  const k = Math.max(1 / Math.max(0.2, 1 - t - b), 1 / Math.max(0.2, 1 - l - r));
  if (k <= 1.0001) return null;
  const ox = l + r > 0 ? l / (l + r) : 0.5;
  const oy = t + b > 0 ? t / (t + b) : 0.5;
  return { transform: `scale(${k})`, transformOrigin: `${ox * 100}% ${oy * 100}%` };
}

export interface ActivationConfig {
  type: 'blow';
  prompt: string;
}

export interface JutsuLevelConfig {
  id: number;
  title: string;
  subtitle: string;
  kanji: string;
  /** Ordered gesture template ids. */
  sequence: string[];
  video: VideoConfig;
  activation: ActivationConfig;
  /** Fallback cinematic lines (used when the video asset is missing). */
  cinematic: {
    location: string;
    introA: SubtitleLine[];
    introB: SubtitleLine[];
    outro: SubtitleLine[];
  };
}
