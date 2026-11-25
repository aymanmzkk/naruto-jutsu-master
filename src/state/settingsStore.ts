import { createStore } from './createStore';

/**
 * Every tunable parameter of the NUI pipeline lives here. The game and the
 * NUI LAB read the SAME store, so thresholds adjusted in the lab are exactly
 * the ones used during gameplay. Values persist in localStorage.
 */
export interface RecognitionSettings {
  /** Curl below this → finger considered EXTENDED (0..1). */
  extendedMax: number;
  /** Curl above this → finger considered BENT (0..1). */
  bentMin: number;
  /** Softness of every score transition. Higher = more tolerant to different hands. */
  tolerance: number;
  /** Multiplies every distance limit in the templates (camera distance / hand size tolerance). */
  distanceTolerance: number;
  /** Global offset added to each template's confidence threshold (-0.2 .. +0.2). */
  thresholdOffset: number;
  /** Multiplies each template's minimum stable time. */
  holdMultiplier: number;
  /** Debounce after a confirmed sign (ms). */
  cooldownMs: number;
  /** How long hands may disappear before the hold is reset (ms). */
  lossGraceMs: number;
  /** One Euro filter: minimum cutoff (Hz). Lower = smoother, more latency. */
  smoothingMinCutoff: number;
  /** One Euro filter: speed coefficient. Higher = more responsive on fast moves. */
  smoothingBeta: number;
  /** Swap Left/Right labels returned by MediaPipe (only needed for unusual cameras). */
  swapHandedness: boolean;
}

export interface AudioSettings {
  /** Minimum level (dBFS) for a blow. */
  blowThresholdDb: number;
  /** Required margin above the adaptive noise floor (dB). */
  blowMarginDb: number;
  /** Sustain time required (ms). */
  blowMinDurationMs: number;
  /** Minimum spectral flatness (noise-likeness, 0..1). Voice/music are tonal → low flatness. */
  blowMinFlatness: number;
}

export interface VideoSettings {
  /** Optional overrides of the level config timestamps (seconds). null = use config. */
  introStart: number | null;
  pauseAt: number | null;
  resumeAt: number | null;
  endAt: number | null;
  /** Zoom focus point inside the paused frame (0..1) and zoom amount. */
  focusX: number | null;
  focusY: number | null;
}

export interface DebugSettings {
  showLandmarks: boolean;
  showConnections: boolean;
  showDebugOverlay: boolean;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

export interface Settings {
  recognition: RecognitionSettings;
  audio: AudioSettings;
  video: VideoSettings;
  debug: DebugSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  recognition: {
    extendedMax: 0.34,
    bentMin: 0.56,
    tolerance: 1,
    distanceTolerance: 1,
    thresholdOffset: 0,
    holdMultiplier: 1,
    cooldownMs: 550,
    lossGraceMs: 350,
    smoothingMinCutoff: 1.4,
    smoothingBeta: 0.03,
    swapHandedness: false,
  },
  audio: {
    blowThresholdDb: -38,
    blowMarginDb: 14,
    blowMinDurationMs: 320,
    blowMinFlatness: 0.18,
  },
  video: {
    introStart: null,
    pauseAt: null,
    resumeAt: null,
    endAt: null,
    focusX: null,
    focusY: null,
  },
  debug: {
    showLandmarks: true,
    showConnections: true,
    showDebugOverlay: false,
    musicVolume: 0.55,
    sfxVolume: 0.85,
    muted: false,
  },
};

const STORAGE_KEY = 'jutsu-master.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      recognition: { ...DEFAULT_SETTINGS.recognition, ...parsed.recognition },
      audio: { ...DEFAULT_SETTINGS.audio, ...parsed.audio },
      video: { ...DEFAULT_SETTINGS.video, ...parsed.video },
      debug: { ...DEFAULT_SETTINGS.debug, ...parsed.debug },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(typeof localStorage === 'undefined' ? DEFAULT_SETTINGS : load());

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsStore.get()));
  } catch {
    /* storage unavailable (private mode) – settings stay in memory */
  }
});

export function updateSettings<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) {
  const s = settingsStore.get();
  settingsStore.set({ [section]: { ...s[section], ...patch } } as Partial<Settings>);
}

export function resetSettings(section?: keyof Settings) {
  if (!section) {
    settingsStore.set(DEFAULT_SETTINGS);
    return;
  }
  settingsStore.set({ [section]: DEFAULT_SETTINGS[section] } as Partial<Settings>);
}
