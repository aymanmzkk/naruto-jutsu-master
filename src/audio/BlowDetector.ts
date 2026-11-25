import type { AudioSettings } from '../state/settingsStore';
import { clamp, invLerp } from '../utils/math';

/**
 * BLOW DETECTOR — approximate airflow detection from microphone audio.
 *
 * IMPORTANT: a microphone cannot measure airflow. Blowing on a microphone
 * produces loud, broadband, noise-like turbulence concentrated in the low
 * frequencies. We detect that acoustic signature:
 *
 *   1. Level (RMS, dBFS) must exceed an absolute threshold AND an adaptive
 *      noise floor + margin (so a noisy room does not trigger it).
 *   2. Spectral flatness must be high → noise-like, not voice/music (tonal).
 *   3. Low-frequency energy ratio must be significant (wind rumble).
 *   4. The signature must be SUSTAINED for `blowMinDurationMs`
 *      (rejects claps, knocks and single spikes).
 */

export interface AudioFeatures {
  /** RMS level in dBFS (-100..0). */
  db: number;
  /** Spectral flatness 0..1 (1 = white noise). */
  flatness: number;
  /** Fraction of spectral energy below ~700 Hz. */
  lowRatio: number;
}

export interface BlowState {
  db: number;
  flatness: number;
  lowRatio: number;
  noiseFloorDb: number;
  /** Effective trigger level (dBFS). */
  thresholdDb: number;
  /** 0..1 normalised intensity for the UI meter. */
  intensity: number;
  /** Signature currently present. */
  blowing: boolean;
  /** 0..1 progress of the sustain requirement. */
  sustain: number;
  /** Strongest intensity reached during the current/last blow. */
  peak: number;
}

/** Computes features from analyser buffers (pure function, unit-testable). */
export function computeFeatures(time: Float32Array, freq: Float32Array, sampleRate: number): AudioFeatures {
  let sum = 0;
  for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
  const rms = Math.sqrt(sum / time.length);
  const db = rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;

  // freq is in dB (AnalyserNode.getFloatFrequencyData). Convert to power.
  const binHz = sampleRate / 2 / freq.length;
  const startBin = Math.max(1, Math.floor(80 / binHz));
  const endBin = Math.min(freq.length - 1, Math.floor(6000 / binHz));
  const lowEnd = Math.floor(700 / binHz);
  let logSum = 0;
  let linSum = 0;
  let low = 0;
  let n = 0;
  for (let i = startBin; i <= endBin; i++) {
    const p = Math.pow(10, Math.max(-140, freq[i]) / 10) + 1e-14;
    logSum += Math.log(p);
    linSum += p;
    if (i <= lowEnd) low += p;
    n++;
  }
  const geo = Math.exp(logSum / n);
  const arith = linSum / n;
  return { db, flatness: clamp(geo / arith), lowRatio: linSum > 0 ? low / linSum : 0 };
}

export class BlowDetector {
  private noiseFloor = -60;
  private sustainMs = 0;
  private lastTime: number | null = null;
  private triggered = false;
  private peak = 0;
  private releaseMs = 0;

  constructor(private getSettings: () => AudioSettings) {}

  reset() {
    this.sustainMs = 0;
    this.lastTime = null;
    this.triggered = false;
    this.peak = 0;
    this.releaseMs = 0;
  }

  /** Re-arms the detector after a blow was consumed. */
  rearm() {
    this.triggered = false;
    this.sustainMs = 0;
    this.peak = 0;
  }

  /**
   * Feeds one analysis window. Returns the state and `fired=true` exactly
   * once when a valid blow is recognised.
   */
  update(f: AudioFeatures, now: number): { state: BlowState; fired: boolean } {
    const s = this.getSettings();
    const dt = this.lastTime === null ? 16 : clamp(now - this.lastTime, 0, 100);
    this.lastTime = now;

    const thresholdDb = Math.max(s.blowThresholdDb, this.noiseFloor + s.blowMarginDb);
    const loud = f.db >= thresholdDb;
    const noisy = f.flatness >= s.blowMinFlatness;
    const windy = f.lowRatio >= 0.12;
    const blowing = loud && noisy && windy;

    // Adaptive noise floor: follow quiet levels quickly, loud levels very slowly.
    if (!blowing) {
      const rate = f.db < this.noiseFloor ? 0.08 : 0.004;
      this.noiseFloor += (f.db - this.noiseFloor) * rate * (dt / 16);
      this.noiseFloor = clamp(this.noiseFloor, -90, -25);
    }

    const intensity = clamp(invLerp(thresholdDb - 18, thresholdDb + 22, f.db));
    let fired = false;
    if (blowing) {
      this.sustainMs += dt;
      this.releaseMs = 0;
      this.peak = Math.max(this.peak, intensity);
      if (!this.triggered && this.sustainMs >= s.blowMinDurationMs) {
        this.triggered = true;
        fired = true;
      }
    } else {
      // brief dips (breath fluctuations) do not reset immediately
      this.releaseMs += dt;
      if (this.releaseMs > 140) this.sustainMs = Math.max(0, this.sustainMs - dt * 2);
    }

    return {
      fired,
      state: {
        db: f.db,
        flatness: f.flatness,
        lowRatio: f.lowRatio,
        noiseFloorDb: this.noiseFloor,
        thresholdDb,
        intensity,
        blowing,
        sustain: clamp(this.sustainMs / s.blowMinDurationMs),
        peak: this.peak,
      },
    };
  }
}
