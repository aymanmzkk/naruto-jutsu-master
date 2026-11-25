import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Handedness, RawHand, TrackerErrorCode, TrackerStatus, TrackingFrame } from './types';
import { TrackingPipeline } from './TrackingPipeline';
import { settingsStore } from '../state/settingsStore';
import { createStore } from '../state/createStore';

/**
 * HAND TRACKER — webcam + MediaPipe Hand Landmarker (21 landmarks × 2 hands).
 *
 *  • Requests the webcam (getUserMedia) and handles every permission error.
 *  • Loads the WASM runtime from /public (offline) with CDN fallback, and the
 *    model from /public/models with fallback to Google's model storage.
 *  • Runs inference once per NEW video frame (requestVideoFrameCallback),
 *    never blocking React; results are pushed to subscribers.
 *  • A single shared instance is used by the game and the NUI LAB.
 */

const LOCAL_WASM = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const LOCAL_MODEL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface TrackerState {
  status: TrackerStatus;
  error: TrackerErrorCode | null;
  errorMessage: string | null;
  fps: number;
  inferenceMs: number;
  handsVisible: number;
  delegate: 'GPU' | 'CPU' | null;
  modelSource: 'local' | 'cdn' | null;
}

type FrameListener = (frame: TrackingFrame) => void;

async function assetExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

export class HandTracker {
  readonly state = createStore<TrackerState>({
    status: 'idle',
    error: null,
    errorMessage: null,
    fps: 0,
    inferenceMs: 0,
    handsVisible: 0,
    delegate: null,
    modelSource: null,
  });

  readonly video: HTMLVideoElement;
  stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private loadingLandmarker: Promise<HandLandmarker> | null = null;
  private listeners = new Set<FrameListener>();
  private pipeline = new TrackingPipeline(() => settingsStore.get().recognition);
  private running = false;
  private rafId = 0;
  private vfcId = 0;
  private lastVideoTime = -1;
  private fpsWindow: number[] = [];
  private lastFrame: TrackingFrame | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  get latest() {
    return this.lastFrame;
  }

  onFrame(fn: FrameListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Requests the webcam and starts tracking. Safe to call several times. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    if (!window.isSecureContext) {
      this.fail('insecure-context', 'The webcam needs a secure context (https or localhost).');
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('no-camera', 'This browser does not support webcam access.');
      return false;
    }
    try {
      if (!this.stream) {
        this.state.set({ status: 'requesting-camera', error: null, errorMessage: null });
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 60 } },
          audio: false,
        });
        this.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          this.fail('camera-busy', 'The webcam was disconnected.');
          this.stop();
        });
      }
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => undefined);
      if (this.video.readyState < 2) {
        await new Promise<void>((resolve) => this.video.addEventListener('loadeddata', () => resolve(), { once: true }));
      }
    } catch (err) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        this.fail('permission-denied', 'The browser blocked the camera (permission denied or not allowed in this window).');
      } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
        this.fail('no-camera', 'No webcam was found (or Windows is not letting the browser use it).');
      } else if (e.name === 'NotReadableError' || e.name === 'AbortError') {
        this.fail('camera-busy', 'The webcam could not be started: it may be in use by another application.');
      } else {
        this.fail('unknown', e.message || 'Unknown camera error.');
      }
      return false;
    }

    try {
      this.state.set({ status: 'loading-model' });
      this.landmarker = await this.loadLandmarker();
    } catch (err) {
      console.error(err);
      this.fail('model-failed', 'The hand tracking model could not be loaded. Check your internet connection.');
      return false;
    }

    this.running = true;
    this.pipeline.reset();
    this.state.set({ status: 'running', error: null, errorMessage: null });
    this.schedule();
    return true;
  }

  /** Loads (once) the MediaPipe Hand Landmarker. Exposed so the NUI LAB can pre-warm it. */
  loadLandmarker(): Promise<HandLandmarker> {
    if (this.landmarker) return Promise.resolve(this.landmarker);
    if (this.loadingLandmarker) return this.loadingLandmarker;
    this.loadingLandmarker = (async () => {
      const wasmBase = (await assetExists(`${LOCAL_WASM}/vision_wasm_internal.wasm`)) ? LOCAL_WASM : CDN_WASM;
      const fileset = await FilesetResolver.forVisionTasks(wasmBase);
      const localModel = await assetExists(LOCAL_MODEL);
      const modelAssetPath = localModel ? LOCAL_MODEL : CDN_MODEL;
      this.state.set({ modelSource: localModel ? 'local' : 'cdn' });
      const create = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        const lm = await create('GPU');
        this.state.set({ delegate: 'GPU' });
        return lm;
      } catch (gpuErr) {
        console.warn('GPU delegate unavailable, falling back to CPU', gpuErr);
        const lm = await create('CPU');
        this.state.set({ delegate: 'CPU' });
        return lm;
      }
    })();
    this.loadingLandmarker.catch(() => {
      this.loadingLandmarker = null;
    });
    return this.loadingLandmarker;
  }

  private schedule() {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.vfcId = v.requestVideoFrameCallback(() => this.tick());
    } else {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick() {
    if (!this.running || !this.landmarker) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      let result: HandLandmarkerResult | null = null;
      try {
        result = this.landmarker.detectForVideo(v, now);
      } catch (err) {
        // A single failed inference must never crash the game.
        console.warn('Hand inference failed', err);
      }
      const inferenceMs = performance.now() - now;
      this.fpsWindow.push(now);
      while (this.fpsWindow.length && now - this.fpsWindow[0] > 1000) this.fpsWindow.shift();
      const fps = this.fpsWindow.length;

      const raw: RawHand[] = [];
      if (result) {
        for (let i = 0; i < result.landmarks.length; i++) {
          const cat = result.handedness?.[i]?.[0];
          raw.push({
            handedness: (cat?.categoryName === 'Left' ? 'Left' : 'Right') as Handedness,
            score: cat?.score ?? 0,
            landmarks: result.landmarks[i].map((p) => ({ x: p.x, y: p.y, z: p.z })),
            world: (result.worldLandmarks[i] ?? result.landmarks[i]).map((p) => ({ x: p.x, y: p.y, z: p.z })),
          });
        }
      }
      const frame = this.pipeline.process(raw, now, v.videoWidth, v.videoHeight, { fps, inferenceMs });
      this.lastFrame = frame;
      const s = this.state.get();
      if (s.handsVisible !== frame.hands.length || Math.abs(s.fps - fps) >= 2 || Math.abs(s.inferenceMs - inferenceMs) > 3) {
        this.state.set({ handsVisible: frame.hands.length, fps, inferenceMs: Math.round(inferenceMs * 10) / 10 });
      }
      for (const l of this.listeners) {
        try {
          l(frame);
        } catch (err) {
          console.error('Tracking listener failed', err);
        }
      }
    }
    this.schedule();
  }

  /** Stops inference and releases the webcam. */
  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
    if (this.vfcId && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.vfcId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastFrame = null;
    this.lastVideoTime = -1;
    const s = this.state.get();
    if (s.status !== 'error') this.state.set({ status: 'idle', handsVisible: 0, fps: 0 });
  }

  get isRunning() {
    return this.running;
  }

  private fail(code: TrackerErrorCode, message: string) {
    this.state.set({ status: 'error', error: code, errorMessage: message });
  }
}

/** Shared tracker instance (one webcam, one model). */
let instance: HandTracker | null = null;
export function getHandTracker(): HandTracker {
  if (!instance) instance = new HandTracker();
  return instance;
}
