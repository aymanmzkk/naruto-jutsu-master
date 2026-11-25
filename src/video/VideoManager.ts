/**
 * VIDEO MANAGER — drives ONE <video> element for the whole level:
 *
 *   load(src) → playSegment(start, pauseAt)  ⇒ pauses frame-accurately and
 *   stores `savedTime` = video.currentTime  ⇒ gameplay ⇒ resume() continues
 *   from exactly `savedTime` (or a configured resume timestamp) until `endAt`
 *   or the natural end of the file.
 *
 * Frame accuracy uses requestVideoFrameCallback (mediaTime of each decoded
 * frame) with a requestAnimationFrame fallback.
 */

type VFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export type SegmentResult = 'paused' | 'ended' | 'error' | 'aborted';

export class VideoManager {
  private v: VFCVideo;
  /** Exact playback position stored when the intro paused. */
  savedTime: number | null = null;
  private watchId = 0;
  private rafId = 0;
  private aborted = false;
  private externalPause = false;
  private objectUrl: string | null = null;

  constructor(el: HTMLVideoElement) {
    this.v = el as VFCVideo;
    this.v.playsInline = true;
    this.v.preload = 'auto';
  }

  get element() {
    return this.v;
  }

  /** Duration in seconds (Infinity for streams / files without duration metadata). */
  get duration() {
    const d = this.v.duration;
    return Number.isNaN(d) ? 0 : d;
  }

  get currentTime() {
    return this.v.currentTime;
  }

  /** Loads a URL or a user-selected File. Resolves false if the asset is missing/unplayable. */
  load(src: string | File, timeoutMs = 6000): Promise<boolean> {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    const url = typeof src === 'string' ? src : (this.objectUrl = URL.createObjectURL(src));
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.v.removeEventListener('loadedmetadata', onMeta);
        this.v.removeEventListener('error', onErr);
        resolve(ok);
      };
      const onMeta = () => {
        if (Number.isFinite(this.v.duration)) return finish(this.duration > 0);
        // Files without duration metadata (e.g. WebM screen recordings): force
        // the browser to scan to the end so currentTime/duration are reliable.
        clearTimeout(timer);
        this.resolveDuration().then(() => finish(this.duration > 0));
      };
      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.v.addEventListener('loadedmetadata', onMeta);
      this.v.addEventListener('error', onErr);
      this.v.src = url;
      this.v.load();
    });
  }

  private resolveDuration(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.v.removeEventListener('durationchange', onDur);
        // wait until the seek back to the start has really finished
        this.v.addEventListener('seeked', () => resolve(), { once: true });
        this.v.currentTime = 0;
        setTimeout(resolve, 1500);
      };
      const onDur = () => {
        if (Number.isFinite(this.v.duration) && this.v.duration > 0) done();
      };
      this.v.addEventListener('durationchange', onDur);
      this.v.currentTime = 1e101;
      setTimeout(done, 4000);
    });
  }

  private seek(t: number): Promise<void> {
    return new Promise((resolve) => {
      if (Math.abs(this.v.currentTime - t) < 0.01) return resolve();
      const onSeeked = () => resolve();
      this.v.addEventListener('seeked', onSeeked, { once: true });
      this.v.currentTime = t;
      setTimeout(resolve, 1500);
    });
  }

  private async safePlay(): Promise<boolean> {
    try {
      await this.v.play();
      return true;
    } catch {
      // Autoplay with sound blocked → retry muted (the user can unmute).
      try {
        this.v.muted = true;
        await this.v.play();
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Plays from `start` and pauses precisely at `pauseAt` (seconds).
   * Resolves 'paused' (savedTime set), 'ended' if the file ended first.
   */
  async playSegment(start: number, pauseAt: number | null): Promise<SegmentResult> {
    this.aborted = false;
    this.savedTime = null;
    const stopAt = pauseAt === null ? Infinity : Math.min(pauseAt, Math.max(0, this.duration - 0.05));
    await this.seek(Math.max(0, start));
    if (!(await this.safePlay())) return 'error';
    return this.watch(stopAt, true);
  }

  /**
   * Resumes after gameplay. By default continues from the exact saved time;
   * `from` lets the level skip ahead (e.g. past the anime's own fireball).
   */
  async resume(from: number | null = null, endAt: number | null = null): Promise<SegmentResult> {
    this.aborted = false;
    const t = from ?? this.savedTime ?? this.v.currentTime;
    if (Math.abs(this.v.currentTime - t) > 0.02) await this.seek(t);
    if (import.meta.env.DEV) console.info(`[video] resume from ${t.toFixed(3)}s (saved ${this.savedTime?.toFixed(3)})`);
    if (!(await this.safePlay())) {
      if (import.meta.env.DEV) console.warn('[video] resume: play() rejected');
      return 'error';
    }
    const r = await this.watch(endAt ?? Infinity, false);
    if (import.meta.env.DEV) console.info(`[video] ending segment finished: ${r} at ${this.v.currentTime.toFixed(3)}s`);
    return r;
  }

  private watch(stopAt: number, save: boolean): Promise<SegmentResult> {
    return new Promise((resolve) => {
      const check = (mediaTime: number) => {
        if (this.aborted) return resolve('aborted');
        const frame = 1 / 30;
        if (mediaTime >= stopAt - frame * 0.5) {
          this.v.pause();
          // A busy or throttled page can deliver the frame callback late and
          // overshoot (possibly past a scene cut): snap back to the pause point.
          // (also for the end point, so the last frame never shows the next shot)
          if (Number.isFinite(stopAt) && this.v.currentTime - stopAt > frame * 1.5) {
            if (import.meta.env.DEV) console.info(`[video] overshot stop by ${(this.v.currentTime - stopAt).toFixed(3)}s, seeking back`);
            void this.seek(Math.max(0, stopAt - frame)).then(() => {
              if (save) this.savedTime = this.v.currentTime;
              resolve(save ? 'paused' : 'ended');
            });
            return;
          }
          if (save) this.savedTime = this.v.currentTime;
          return resolve(save ? 'paused' : 'ended');
        }
        if (this.v.ended && !this.v.seeking) return resolve('ended');
        schedule();
      };
      const schedule = () => {
        if (this.v.requestVideoFrameCallback) {
          this.watchId = this.v.requestVideoFrameCallback((_n, meta) => check(meta.mediaTime));
          // rVFC does not fire while paused; also poll with rAF to catch 'ended'
          cancelAnimationFrame(this.rafId);
          this.rafId = requestAnimationFrame(() => {
            if (this.v.ended && !this.v.seeking && !this.externalPause) {
              this.v.cancelVideoFrameCallback?.(this.watchId);
              check(this.v.currentTime);
            }
          });
        } else {
          this.rafId = requestAnimationFrame(() => check(this.v.currentTime));
        }
      };
      const onEnded = () => {
        if (!this.aborted && !this.v.seeking) resolve('ended');
      };
      this.v.addEventListener('ended', onEnded, { once: true });
      schedule();
    });
  }

  /** Game pause (keeps position). */
  pause() {
    this.externalPause = true;
    this.v.pause();
  }

  unpause() {
    this.externalPause = false;
    if (this.v.paused && !this.v.ended) this.safePlay();
  }

  fadeVolume(to: number, ms: number) {
    const from = this.v.volume;
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / ms);
      this.v.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  abort() {
    this.aborted = true;
    this.v.cancelVideoFrameCallback?.(this.watchId);
    cancelAnimationFrame(this.rafId);
    this.v.pause();
  }

  dispose() {
    this.abort();
    this.v.removeAttribute('src');
    this.v.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}
