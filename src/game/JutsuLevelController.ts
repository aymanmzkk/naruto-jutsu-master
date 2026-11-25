import { LakesideWorld } from '../engine/LakesideWorld';
import { VideoManager } from '../video/VideoManager';
import { getHandTracker } from '../gestures/HandTracker';
import { getMicrophone } from '../audio/MicrophoneManager';
import { GestureSequence, type SequenceEvent } from '../gestures/GestureSequence';
import type { TrackingFrame } from '../gestures/types';
import { Sound, type LoopHandle } from '../audio/SoundEngine';
import { levelStore, initialLevelState, type LevelPhase } from '../state/levelStore';
import { settingsStore } from '../state/settingsStore';
import type { JutsuLevelConfig, SubtitleLine, VideoConfig } from './levels/types';
import type { SceneContext } from '../scenes/SceneContext';
import { playFallbackIntro, zoomIntoPlayer } from '../scenes/IntroScene';
import { bringHandsToMouth, enterFirstPerson } from '../scenes/FirstPersonScene';
import { playFireball } from '../scenes/FireballScene';
import { playFallbackEnding, zoomOutToThirdPerson } from '../scenes/EndingScene';
import { clamp } from '../utils/math';
import { getTemplate } from '../gestures/GestureTemplates';
import { setCompletionArt } from '../state/completionArt';

class Cancelled extends Error {}

export interface ControllerOptions {
  container: HTMLElement;
  video: HTMLVideoElement;
  config: JutsuLevelConfig;
  /** Optional video picked by the user (overrides the file in /public). */
  videoFile?: File | null;
  onComplete: () => void;
}

/**
 * JUTSU LEVEL CONTROLLER — the level's phase machine.
 *
 *  MENU → intro (anime video, or original 3D cinematic) → video pauses →
 *  zoom into the character → first person → sensors (webcam + mic) →
 *  hand-sign sequence → hands to mouth + blow → Great Fireball →
 *  zoom out to third person → original video resumes at the saved time →
 *  completion.
 *
 * Generic: everything level-specific comes from JutsuLevelConfig.
 */
export class JutsuLevelController {
  readonly world: LakesideWorld;
  private vm: VideoManager;
  private seq: GestureSequence;
  private clock = 0;
  private disposed = false;
  private skipRequested = false;
  private skippable = false;
  private hasVideo = false;
  private sensorsResolve: (() => void) | null = null;
  private signsResolve: (() => void) | null = null;
  private fireResolve: ((power: number) => void) | null = null;
  private unsubs: (() => void)[] = [];
  private videoPlaying = false;
  private stepStartedAt = 0;
  private lastHudPush = 0;
  private charge: LoopHandle | null = null;
  private ctx: SceneContext;
  private video: VideoConfig;
  private devSkipSigns = false;
  /** Sign assist: keep the confirmed sign's clean pose on screen briefly. */
  private assistHoldId: string | null = null;
  private assistHoldUntil = 0;

  constructor(private o: ControllerOptions) {
    this.world = new LakesideWorld(o.container);
    this.vm = new VideoManager(o.video);
    this.seq = new GestureSequence(o.config.sequence);
    const v = settingsStore.get().video;
    const base = o.config.video;
    this.video = {
      ...base,
      introStart: v.introStart ?? base.introStart,
      pauseAt: v.pauseAt ?? base.pauseAt,
      resumeAt: v.resumeAt ?? base.resumeAt,
      endAt: v.endAt ?? base.endAt,
      focus: { x: v.focusX ?? base.focus.x, y: v.focusY ?? base.focus.y, zoom: base.focus.zoom },
    };
    this.world.gfx.onUpdate((dt) => {
      this.clock += dt;
    });
    this.ctx = {
      world: this.world,
      config: o.config,
      wait: (s) => this.wait(s),
      say: (lines) => this.say(lines),
      caption: (text) => levelStore.set({ caption: text }),
      skipping: () => this.skipRequested,
    };
    levelStore.set({
      ...initialLevelState,
      signIds: o.config.sequence,
      signTotal: o.config.sequence.length,
      stats: { ...initialLevelState.stats, startedAt: performance.now() },
    });
  }

  /* ------------------------------------------------------------ utils */

  private phase(p: LevelPhase, extra: Partial<typeof initialLevelState> = {}) {
    levelStore.set({ phase: p, ...extra });
  }

  private wait(seconds: number): Promise<void> {
    const until = this.clock + seconds;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.disposed) return reject(new Cancelled());
        if (this.clock >= until || (this.skippable && this.skipRequested)) return resolve();
        requestAnimationFrame(check);
      };
      check();
    });
  }

  private async say(lines: SubtitleLine[]) {
    for (const l of lines) {
      if (this.skipRequested && this.skippable) break;
      levelStore.set({ subtitle: { speaker: l.speaker, text: l.text } });
      await this.wait(l.duration);
      levelStore.set({ subtitle: null });
      await this.wait(0.25);
    }
  }

  /* ------------------------------------------------------------ public controls */

  pause() {
    if (levelStore.get().phase === 'complete') return;
    this.world.gfx.paused = true;
    if (this.videoPlaying) this.vm.pause();
    levelStore.set({ paused: true });
  }

  resume() {
    this.world.gfx.paused = false;
    if (this.videoPlaying) this.vm.unpause();
    levelStore.set({ paused: false });
  }

  skip() {
    if (!this.skippable) return;
    this.skipRequested = true;
    if (this.videoPlaying) this.vm.abort();
  }

  /** Called by the permission panel. */
  async enableSensors(): Promise<boolean> {
    Sound.unlock();
    const tracker = getHandTracker();
    const ok = await tracker.start();
    // microphone is optional at this point: failure only shows the fallback button later
    void getMicrophone().start();
    if (ok) this.sensorsResolve?.();
    return ok;
  }

  /** No webcam: continue with clearly-labelled assisted mode. */
  useAssistedMode() {
    levelStore.set({ assisted: true });
    void getMicrophone().start();
    this.sensorsResolve?.();
  }

  assistedConfirm() {
    if (!levelStore.get().assisted || levelStore.get().phase !== 'signs') return;
    this.handleSequenceEvents(this.seq.forceAdvance());
  }

  /** Fallback when no microphone is available. */
  releaseFireManually() {
    this.fireResolve?.(0.95);
  }

  /* ------------------------------------------------------------ main flow */

  async run() {
    try {
      this.world.start();
      // DEV ONLY: ?dev=charge jumps to the breath phase (assisted), to iterate on effects.
      const devJump = import.meta.env.DEV ? new URLSearchParams(location.search).get('dev') : null;
      if (import.meta.env.DEV) (window as unknown as { __level: unknown }).__level = this;
      if (devJump === 'video-charge') {
        this.hasVideo = await this.vm.load(this.o.videoFile ?? this.video.src);
        this.vm.element.currentTime = this.video.pauseAt;
        this.vm.savedTime = this.video.pauseAt;
        this.o.video.style.opacity = '0';
      }
      if (devJump === 'charge' || devJump === 'video-charge') {
        levelStore.set({ videoMissing: true, assisted: true });
        enterFirstPerson(this.ctx);
        this.sensorsResolve = null;
        this.devSkipSigns = true;
      } else {
        await this.introduction();
      }
      await this.gameplay();
      await this.finale();
      this.phase('complete', { letterbox: false, subtitle: null, videoVisible: false });
      // illustrated hero shot of the jutsu for the completion screen
      setCompletionArt(this.world.captureHeroShot());
      this.o.onComplete();
    } catch (e) {
      if (!(e instanceof Cancelled)) console.error(e);
    }
  }

  private async introduction() {
    const ve = this.o.video;
    this.phase('loading');
    this.hasVideo = await this.vm.load(this.o.videoFile ?? this.video.src);
    if (this.disposed) throw new Cancelled();

    if (this.hasVideo) {
      // ---------- original anime video ----------
      Sound.stopMusic(600);
      this.world.gfx.renderEnabled = false;
      ve.style.transition = 'opacity 0.8s ease';
      ve.style.transform = 'none';
      ve.style.filter = 'none';
      ve.style.opacity = '1';
      ve.volume = 1;
      this.skippable = true;
      this.phase('intro-video', { videoVisible: true, letterbox: false, skippable: true });
      this.videoPlaying = true;
      const result = await this.vm.playSegment(this.video.introStart, this.video.pauseAt);
      this.videoPlaying = false;
      if (this.disposed) throw new Cancelled();
      if (result === 'error') {
        this.hasVideo = false;
        ve.style.opacity = '0';
        levelStore.set({ videoVisible: false, videoMissing: true });
      } else {
        if (result === 'aborted' || result === 'ended') {
          // skipped: jump to the pause frame
          const t = Math.min(this.video.pauseAt, Math.max(0, this.vm.duration - 0.1));
          this.vm.element.currentTime = t;
          this.vm.savedTime = t;
          await new Promise((r) => setTimeout(r, 120));
        }
        this.skippable = false;
        this.skipRequested = false;
        this.phase('zoom-in', { skippable: false });
        await this.zoomIntoVideoFrame();
      }
    }

    if (!this.hasVideo) {
      // ---------- original 3D cinematic fallback ----------
      levelStore.set({ videoMissing: true, videoVisible: false });
      void Sound.playMusic('level');
      Sound.startAmbience();
      this.skippable = true;
      this.phase('intro-cinematic', { letterbox: true, skippable: true });
      this.world.fade = 1;
      this.fadeIn(1.2);
      await playFallbackIntro(this.ctx);
      levelStore.set({ subtitle: null, caption: null });
      this.skippable = false;
      this.skipRequested = false;
      this.phase('zoom-in', { skippable: false });
      await zoomIntoPlayer(this.ctx);
    }
    enterFirstPerson(this.ctx);
    this.phase('permissions', { letterbox: false, subtitle: null });
  }

  private fadeIn(seconds: number) {
    const start = this.clock;
    const tick = () => {
      if (this.disposed) return;
      const k = clamp((this.clock - start) / seconds);
      this.world.fade = 1 - k;
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  /** Paused anime frame → zoom into the character → first-person 3D. */
  private async zoomIntoVideoFrame() {
    const ve = this.o.video;
    const f = this.video.focus;
    enterFirstPerson(this.ctx);
    this.world.gfx.renderEnabled = true;
    ve.style.transformOrigin = `${f.x * 100}% ${f.y * 100}%`;
    ve.style.transition = 'transform 2.2s cubic-bezier(0.55, 0, 0.85, 0.35), filter 2.2s ease-in, opacity 0.9s ease 1.4s';
    // force layout so the transition starts from the current state
    void ve.offsetWidth;
    ve.style.transform = `scale(${f.zoom})`;
    ve.style.filter = 'blur(5px) brightness(1.6) saturate(1.2)';
    ve.style.opacity = '0';
    Sound.whoosh(1.8, 0.4);
    await this.wait(1.9);
    this.world.flash = 0.85;
    await this.wait(0.6);
    levelStore.set({ videoVisible: false });
    void Sound.playMusic('level');
    Sound.startAmbience();
  }

  private async gameplay() {
    // ---------- sensors ----------
    const tracker = getHandTracker();
    this.unsubs.push(tracker.onFrame((f) => this.onTrackingFrame(f)));
    if (!tracker.isRunning && !this.devSkipSigns) {
      // auto-start if the camera permission was already granted
      let granted = false;
      try {
        const st = await navigator.permissions?.query({ name: 'camera' as PermissionName });
        granted = st?.state === 'granted';
      } catch {
        /* permissions API unsupported */
      }
      const waitSensors = new Promise<void>((r) => (this.sensorsResolve = r));
      if (granted) void this.enableSensors();
      await waitSensors;
    }
    if (this.disposed) throw new Cancelled();

    // ---------- hand signs ----------
    this.seq.reset();
    this.stepStartedAt = performance.now();
    const signsDone = new Promise<void>((r) => (this.signsResolve = r));
    this.phase('signs', { signIndex: 0 });
    if (this.devSkipSigns) for (let i = 0; i < this.seq.total; i++) this.handleSequenceEvents(this.seq.forceAdvance());
    await signsDone;
    levelStore.set({ stats: { ...levelStore.get().stats, signsDoneAt: performance.now() } });
    Sound.sequenceComplete();
    this.world.pulseChakra();
    await this.wait(0.6);
    this.world.showSignPose(null);
    this.world.assistSign(null, 0);

    // ---------- charge: hands to the mouth, blow ----------
    this.phase('charge', { centerMessage: this.o.config.activation.prompt, hint: null, wrongId: null });
    this.charge = Sound.chakraCharge();
    await bringHandsToMouth(this.ctx, 1.1);
    const mic = getMicrophone();
    // Never block on the permission prompt: the fallback button appears if the
    // microphone fails, is still pending after a few seconds, or hears nothing.
    void mic.start().then(() => mic.detector.rearm());
    mic.detector.rearm();
    const firePower = new Promise<number>((r) => (this.fireResolve = r));
    const chargeStart = this.clock;
    const needFallback = () => {
      const st = mic.state.get().status;
      const waited = this.clock - chargeStart;
      return st === 'error' || (st !== 'running' && waited > 4) || waited > 12;
    };
    const micUnsub = mic.state.subscribe(() => {
      const s = mic.state.get();
      levelStore.set({
        blowIntensity: Math.round(s.blow.intensity * 100) / 100,
        blowSustain: Math.round(s.blow.sustain * 100) / 100,
        showFireFallback: needFallback(),
      });
      this.charge?.setIntensity?.(s.blow.intensity);
    });
    const blowUnsub = mic.onBlow((b) => this.fireResolve?.(clamp(0.85 + b.peak * 0.35, 0.85, 1.2)));
    const fallbackTimer = setInterval(() => {
      if (needFallback()) levelStore.set({ showFireFallback: true });
    }, 500);
    const power = await firePower;
    clearInterval(fallbackTimer);
    micUnsub();
    blowUnsub();
    this.charge?.stop(300);
    levelStore.set({
      centerMessage: null,
      showFireFallback: false,
      stats: { ...levelStore.get().stats, blowPeak: mic.state.get().blow.peak },
    });

    // ---------- fireball ----------
    this.phase('fireball');
    await playFireball(this.ctx, power);
  }

  private async finale() {
    const ve = this.o.video;
    this.phase('zoom-out', { letterbox: true });
    const zoomOut = zoomOutToThirdPerson(this.ctx, 5.5);
    if (this.hasVideo) {
      // crossfade into the paused anime frame during the last part of the pull-back
      await this.wait(3.6);
      const f = this.video.focus;
      ve.style.transition = 'none';
      ve.style.transformOrigin = `${f.x * 100}% ${f.y * 100}%`;
      ve.style.transform = `scale(${f.zoom * 0.8})`;
      ve.style.filter = 'blur(3px) brightness(1.2)';
      ve.style.opacity = '0';
      levelStore.set({ videoVisible: true });
      void ve.offsetWidth;
      ve.style.transition = 'opacity 1.6s ease, transform 3.2s cubic-bezier(0.2, 0.6, 0.3, 1), filter 2s ease';
      ve.style.opacity = '1';
      ve.style.transform = 'scale(1)';
      ve.style.filter = 'none';
      Sound.stopMusic(2000);
      Sound.stopAmbience(2500);
      await zoomOut;
      await this.wait(0.4);
      this.world.gfx.renderEnabled = false;
      // ---------- resume the original video exactly where it paused ----------
      this.skippable = true;
      this.phase('ending-video', { letterbox: false, skippable: true });
      ve.volume = 0;
      this.vm.fadeVolume(1, 1200);
      this.videoPlaying = true;
      await this.vm.resume(this.video.resumeAt, this.video.endAt);
      this.videoPlaying = false;
      this.skippable = false;
      ve.style.transition = 'opacity 1s ease';
      ve.style.opacity = '0';
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      await zoomOut;
      this.phase('ending-cinematic', { letterbox: true });
      await playFallbackEnding(this.ctx);
    }
  }

  /* ------------------------------------------------------------ tracking */

  private onTrackingFrame(frame: TrackingFrame) {
    this.world.trackingFrame = frame;
    const st = levelStore.get();
    if (st.phase !== 'signs' || st.paused || st.assisted) {
      if (!st.assisted) this.world.assistSign(null, 0);
      if (st.handsVisible !== frame.hands.length) levelStore.set({ handsVisible: frame.hands.length });
      return;
    }
    const u = this.seq.update(frame);
    this.handleSequenceEvents(u.events);
    const now = performance.now();
    this.updateSignAssist(u.snapshot, now);
    if (now - this.lastHudPush > 45 || u.events.length) {
      this.lastHudPush = now;
      const s = u.snapshot;
      levelStore.set({
        signPhase: s.phase,
        confidence: Math.round(s.confidence * 100) / 100,
        threshold: s.threshold,
        holdProgress: Math.round(s.holdProgress * 100) / 100,
        bestId: s.bestId,
        hint: s.hint,
        wrongId: s.wrongId,
        handsVisible: s.handsVisible,
      });
    }
  }

  /**
   * Sign assist: the closer the player gets to the expected sign (confidence
   * approaching the threshold), the more the virtual hands take its clean
   * pose; after a confirmation the sign is held for a moment.
   */
  private updateSignAssist(s: { candidateId: string | null; confidence: number; threshold: number; handsVisible: number }, now: number) {
    let id: string | null = null;
    let w = 0;
    if (this.assistHoldId && now < this.assistHoldUntil) {
      id = this.assistHoldId;
      w = 1;
    } else if (s.candidateId && s.handsVisible > 0) {
      id = s.candidateId;
      const lo = s.threshold - 0.24;
      const hi = s.threshold - 0.04;
      const k = clamp((s.confidence - lo) / (hi - lo), 0, 1);
      w = k * k * (3 - 2 * k);
    }
    this.world.assistSign(id ? getTemplate(id).illustration : null, w);
  }

  private handleSequenceEvents(events: SequenceEvent[]) {
    for (const e of events) {
      if (e.type === 'advanced') {
        const stats = levelStore.get().stats;
        const now = performance.now();
        Sound.signConfirm(e.index);
        this.world.pulseChakra();
        // camera: hold the confirmed sign's clean pose for a moment
        if (!levelStore.get().assisted) {
          this.assistHoldId = e.id;
          this.assistHoldUntil = now + 700;
        }
        // no webcam: the virtual hands perform the confirmed sign
        if (levelStore.get().assisted) {
          const id = this.o.config.sequence[e.index];
          if (id) this.world.showSignPose(getTemplate(id).illustration);
        }
        levelStore.set({
          signIndex: e.index + 1,
          confirmPulse: now,
          hint: null,
          wrongId: null,
          holdProgress: 0,
          stats: {
            ...stats,
            signDurations: [...stats.signDurations, (now - this.stepStartedAt) / 1000],
            confidences: [...stats.confidences, e.confidence],
          },
        });
        this.stepStartedAt = now;
      } else if (e.type === 'wrong') {
        Sound.wrong();
        const stats = levelStore.get().stats;
        levelStore.set({ wrongPulse: performance.now(), stats: { ...stats, wrongCount: stats.wrongCount + 1 } });
      } else if (e.type === 'completed') {
        this.signsResolve?.();
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.unsubs.forEach((u) => u());
    this.charge?.stop(100);
    this.vm.dispose();
    this.world.dispose();
    getHandTracker().stop();
    getMicrophone().stop();
    Sound.stopAmbience(500);
    this.sensorsResolve = null;
    this.signsResolve = null;
    this.fireResolve = null;
  }
}
