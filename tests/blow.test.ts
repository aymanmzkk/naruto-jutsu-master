import { describe, expect, it } from 'vitest';
import { BlowDetector, computeFeatures } from '../src/audio/BlowDetector';
import { DEFAULT_SETTINGS } from '../src/state/settingsStore';

const SR = 48000;
const BINS = 1024;

/** Synthetic analyser buffers: broadband noise (blow) or a harmonic tone (voice). */
function buffers(kind: 'blow' | 'voice' | 'silence', amp: number) {
  const time = new Float32Array(2048);
  const freq = new Float32Array(BINS);
  for (let i = 0; i < time.length; i++) {
    if (kind === 'blow') time[i] = (Math.random() * 2 - 1) * amp;
    else if (kind === 'voice') time[i] = Math.sin((i / SR) * 2 * Math.PI * 220) * amp;
    else time[i] = (Math.random() * 2 - 1) * 0.0005;
  }
  for (let b = 0; b < BINS; b++) {
    const hz = (b * SR) / 2 / BINS;
    if (kind === 'blow') freq[b] = -30 - hz / 600 + Math.random() * 4; // pink-ish broadband
    else if (kind === 'voice') freq[b] = hz % 220 < 25 ? -20 : -105; // harmonics only
    else freq[b] = -110 + Math.random() * 3;
  }
  return { time, freq };
}

function run(det: BlowDetector, kind: 'blow' | 'voice' | 'silence', ms: number, t0: number, amp = 0.35) {
  let fired = false;
  let t = t0;
  for (; t < t0 + ms; t += 16) {
    const { time, freq } = buffers(kind, amp);
    if (det.update(computeFeatures(time, freq, SR), t).fired) fired = true;
  }
  return { fired, t };
}

describe('blow detector', () => {
  const settings = () => DEFAULT_SETTINGS.audio;

  it('detects a sustained broadband blow', () => {
    const det = new BlowDetector(settings);
    let { t } = run(det, 'silence', 1000, 0);
    const r = run(det, 'blow', 600, t);
    expect(r.fired).toBe(true);
    t = r.t;
  });

  it('ignores a loud tonal voice', () => {
    const det = new BlowDetector(settings);
    const { t } = run(det, 'silence', 1000, 0);
    expect(run(det, 'voice', 1500, t, 0.5).fired).toBe(false);
  });

  it('ignores short bursts (claps)', () => {
    const det = new BlowDetector(settings);
    let { t } = run(det, 'silence', 1000, 0);
    for (let i = 0; i < 4; i++) {
      expect(run(det, 'blow', 120, t).fired).toBe(false);
      t = run(det, 'silence', 400, t + 120).t;
    }
  });

  it('flatness separates noise from tones', () => {
    const blow = buffers('blow', 0.3);
    const voice = buffers('voice', 0.3);
    expect(computeFeatures(blow.time, blow.freq, SR).flatness).toBeGreaterThan(0.3);
    expect(computeFeatures(voice.time, voice.freq, SR).flatness).toBeLessThan(0.05);
  });
});
