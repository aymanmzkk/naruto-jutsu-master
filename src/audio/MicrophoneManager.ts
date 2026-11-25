import { BlowDetector, computeFeatures, type BlowState } from './BlowDetector';
import { settingsStore } from '../state/settingsStore';
import { createStore } from '../state/createStore';

/**
 * MICROPHONE MANAGER — Web Audio API input.
 * getUserMedia(audio) → MediaStreamSource → AnalyserNode → features every
 * animation frame → BlowDetector. Browser noise suppression / AGC are
 * disabled on purpose: they would remove exactly the "wind noise" we need.
 */

export type MicStatus = 'idle' | 'requesting' | 'running' | 'error';

export interface MicState {
  status: MicStatus;
  error: string | null;
  blow: BlowState;
  blowCount: number;
}

const EMPTY_BLOW: BlowState = {
  db: -100,
  flatness: 0,
  lowRatio: 0,
  noiseFloorDb: -60,
  thresholdDb: -38,
  intensity: 0,
  blowing: false,
  sustain: 0,
  peak: 0,
};

type BlowListener = (state: BlowState) => void;

export class MicrophoneManager {
  readonly state = createStore<MicState>({ status: 'idle', error: null, blow: EMPTY_BLOW, blowCount: 0 });
  readonly detector = new BlowDetector(() => settingsStore.get().audio);
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timeBuf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private freqBuf: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private raf = 0;
  private blowListeners = new Set<BlowListener>();
  private lastUiUpdate = 0;

  onBlow(fn: BlowListener) {
    this.blowListeners.add(fn);
    return () => {
      this.blowListeners.delete(fn);
    };
  }

  private starting: Promise<boolean> | null = null;

  /** Starts the microphone (concurrent calls share the same pending request). */
  start(): Promise<boolean> {
    if (this.state.get().status === 'running') return Promise.resolve(true);
    if (!this.starting) {
      this.starting = this.doStart().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async doStart(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state.set({ status: 'error', error: 'Microphone not supported in this browser.' });
      return false;
    }
    try {
      this.state.set({ status: 'requesting', error: null });
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
      this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.35;
      this.source.connect(this.analyser);
      this.timeBuf = new Float32Array(this.analyser.fftSize);
      this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
      this.detector.reset();
      this.state.set({ status: 'running', error: null });
      this.loop();
      return true;
    } catch (err) {
      const e = err as DOMException;
      const msg =
        e.name === 'NotAllowedError' || e.name === 'SecurityError'
          ? 'The browser blocked the microphone (permission denied or not allowed in this window).'
          : e.name === 'NotFoundError'
            ? 'No microphone was found (or Windows is not letting the browser use it).'
            : e.name === 'NotReadableError'
              ? 'The microphone could not be started: it may be in use by another application.'
              : e.message || 'Microphone error.';
      this.state.set({ status: 'error', error: msg });
      return false;
    }
  }

  private loop = () => {
    if (!this.analyser || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    this.analyser.getFloatFrequencyData(this.freqBuf);
    const now = performance.now();
    const features = computeFeatures(this.timeBuf, this.freqBuf, this.ctx.sampleRate);
    const { state, fired } = this.detector.update(features, now);
    if (fired) {
      this.state.set({ blowCount: this.state.get().blowCount + 1 });
      this.blowListeners.forEach((l) => l(state));
    }
    if (now - this.lastUiUpdate > 50 || fired) {
      this.lastUiUpdate = now;
      this.state.set({ blow: state });
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Latest (un-throttled) detector state. */
  get current(): BlowState {
    return this.state.get().blow;
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.state.set({ status: 'idle', blow: EMPTY_BLOW });
  }
}

let mic: MicrophoneManager | null = null;
export function getMicrophone(): MicrophoneManager {
  if (!mic) mic = new MicrophoneManager();
  return mic;
}
