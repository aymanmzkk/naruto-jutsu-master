import { settingsStore } from '../state/settingsStore';

/**
 * SOUND ENGINE — every sound of the game is synthesised in real time with the
 * Web Audio API (no audio files required). Optional files placed in
 * /public/assets/audio override the procedural music:
 *    menu-theme.mp3   → main menu music
 *    level-theme.mp3  → in-level ambience/music
 */

export interface LoopHandle {
  stop: (fadeMs?: number) => void;
  setIntensity?: (v: number) => void;
}

// "In" (Miyako-bushi) scale on D — the classic Japanese pentatonic colour.
const SCALE_HZ = [146.83, 155.56, 196.0, 220.0, 233.08, 293.66, 311.13, 392.0, 440.0, 466.16, 587.33];

class SoundEngineImpl {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private plucks = new Map<number, AudioBuffer>();
  private music: LoopHandle | null = null;
  private musicKind: string | null = null;
  private ambience: LoopHandle | null = null;
  private lastHover = 0;

  /** Must be called from a user gesture (click) — browsers block audio before that. */
  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  private init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.makeNoise(3);
    this.applyVolumes();
    settingsStore.subscribe(() => this.applyVolumes());
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const d = settingsStore.get().debug;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(d.muted ? 0 : 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(d.musicVolume, t, 0.05);
    this.ambBus.gain.setTargetAtTime(d.musicVolume * 0.9, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(d.sfxVolume, t, 0.05);
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Karplus–Strong plucked string, precomputed (koto-like timbre). */
  private pluck(freq: number): AudioBuffer {
    const key = Math.round(freq * 100);
    const cached = this.plucks.get(key);
    if (cached) return cached;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.8);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % period;
      const v = 0.4985 * (ring[idx] + ring[next]);
      out[i] = ring[idx];
      ring[idx] = v;
      idx = next;
    }
    this.plucks.set(key, buf);
    return buf;
  }

  private noiseSource(loop = false) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    src.loopStart = Math.random();
    return src;
  }

  private env(g: GainNode, t: number, attack: number, peak: number, decay: number) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private get ready() {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  /* ---------------- UI ---------------- */

  hover() {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastHover < 60) return;
    this.lastHover = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1320, t);
    o.frequency.exponentialRampToValueAtTime(1760, t + 0.05);
    this.env(g, t, 0.005, 0.05, 0.09);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  click() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.woodBlock(t, 0.35, 1);
  }

  /** Hyoshigi-like wooden clap. */
  private woodBlock(t: number, gain: number, pitch: number) {
    const ctx = this.ctx!;
    const n = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900 * pitch;
    bp.Q.value = 6;
    const g = ctx.createGain();
    this.env(g, t, 0.001, gain, 0.07);
    n.connect(bp).connect(g).connect(this.sfxBus);
    n.start(t);
    n.stop(t + 0.12);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(820 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(520 * pitch, t + 0.08);
    const og = ctx.createGain();
    this.env(og, t, 0.001, gain * 0.5, 0.1);
    o.connect(og).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  private bell(t: number, freq: number, gain: number, decay = 1.6) {
    const ctx = this.ctx!;
    const partials = [1, 2.76, 5.4, 8.93];
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * p;
      const g = ctx.createGain();
      this.env(g, t, 0.003, gain / (i + 1.4), decay / (i * 0.6 + 1));
      o.connect(g);
      g.connect(this.sfxBus);
      g.connect(this.reverbSend);
      o.start(t);
      o.stop(t + decay + 0.1);
    });
  }

  /* ---------------- Gameplay SFX ---------------- */

  signConfirm(step: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.woodBlock(t, 0.55, 1 + step * 0.04);
    this.bell(t + 0.02, SCALE_HZ[5 + (step % 6)], 0.18, 1.4);
  }

  wrong() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.22, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    o.connect(lp).connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  sequenceComplete() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [5, 7, 8, 10].forEach((n, i) => this.bell(t + i * 0.09, SCALE_HZ[n], 0.16, 2.2));
    this.taiko(t, 0.8);
  }

  taiko(t = this.ctx?.currentTime ?? 0, gain = 0.9) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.45);
    const g = ctx.createGain();
    this.env(g, t, 0.004, gain, 0.7);
    o.connect(g);
    g.connect(this.sfxBus);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 0.9);
    const n = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    this.env(ng, t, 0.002, gain * 0.35, 0.12);
    n.connect(lp).connect(ng).connect(this.sfxBus);
    n.start(t);
    n.stop(t + 0.2);
  }

  whoosh(duration = 0.9, gain = 0.4) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + duration * 0.6);
    bp.frequency.exponentialRampToValueAtTime(500, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + duration * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    n.connect(bp).connect(g);
    g.connect(this.sfxBus);
    g.connect(this.reverbSend);
    n.start(t);
    n.stop(t + duration + 0.05);
  }

  /** Rising chakra drone while the player charges the jutsu. */
  chakraCharge(): LoopHandle {
    if (!this.ready) return { stop: () => undefined };
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.32, t + 1.2);
    out.connect(this.sfxBus);
    out.connect(this.reverbSend);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.linearRampToValueAtTime(900, t + 6);
    lp.Q.value = 5;
    lp.connect(out);
    const oscs = [55, 55.4, 82.4].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      return o;
    });
    const n = this.noiseSource(true);
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 500;
    const ng = ctx.createGain();
    ng.gain.value = 0.12;
    n.connect(nbp).connect(ng).connect(out);
    n.start(t);
    return {
      setIntensity: (v: number) => {
        const now = ctx.currentTime;
        lp.frequency.setTargetAtTime(250 + v * 1600, now, 0.08);
        ng.gain.setTargetAtTime(0.1 + v * 0.6, now, 0.05);
      },
      stop: (fadeMs = 400) => {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fadeMs / 4000);
        const end = now + fadeMs / 1000 + 0.3;
        oscs.forEach((o) => o.stop(end));
        n.stop(end);
      },
    };
  }

  fireIgnite() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.whoosh(1.1, 0.7);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.8);
    const g = ctx.createGain();
    this.env(g, t, 0.02, 0.6, 0.9);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 1.1);
  }

  /** Sustained fire roar with random crackles; intensity follows the fireball. */
  fireRoar(): LoopHandle {
    if (!this.ready) return { stop: () => undefined };
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.75, t + 0.25);
    out.connect(this.sfxBus);
    out.connect(this.reverbSend);
    const n = this.noiseSource(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(lp.frequency);
    n.connect(lp).connect(out);
    n.start(t);
    lfo.start(t);
    let alive = true;
    const crackle = () => {
      if (!alive || !this.ctx) return;
      const now = ctx.currentTime;
      const c = this.noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2000 + Math.random() * 3000;
      const cg = ctx.createGain();
      this.env(cg, now, 0.001, 0.08 + Math.random() * 0.15, 0.03 + Math.random() * 0.05);
      c.connect(hp).connect(cg).connect(out);
      c.start(now);
      c.stop(now + 0.1);
      setTimeout(crackle, 30 + Math.random() * 120);
    };
    crackle();
    return {
      setIntensity: (v: number) => {
        lp.frequency.setTargetAtTime(400 + v * 1400, ctx.currentTime, 0.1);
      },
      stop: (fadeMs = 800) => {
        alive = false;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fadeMs / 4000);
        n.stop(now + fadeMs / 1000 + 0.5);
        lfo.stop(now + fadeMs / 1000 + 0.5);
      },
    };
  }

  explosion(power = 1) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.6);
    const g = ctx.createGain();
    this.env(g, t, 0.01, 1.0 * power, 2.0);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 2.2);
    const n = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 2.5);
    const ng = ctx.createGain();
    this.env(ng, t, 0.005, 0.9 * power, 2.8);
    n.connect(lp).connect(ng);
    ng.connect(this.sfxBus);
    ng.connect(this.reverbSend);
    n.start(t);
    n.stop(t + 3);
  }

  /* ---------------- Music & ambience ---------------- */

  private async fileLoop(url: string, bus: GainNode): Promise<LoopHandle | null> {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('audio')) return null;
    } catch {
      return null;
    }
    const ctx = this.ctx!;
    const el = new Audio(url);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(bus);
    await el.play().catch(() => undefined);
    g.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
    return {
      stop: (fadeMs = 800) => {
        g.gain.setTargetAtTime(0, ctx.currentTime, fadeMs / 4000);
        setTimeout(() => el.pause(), fadeMs + 200);
      },
    };
  }

  async playMusic(kind: 'menu' | 'level') {
    if (!this.ready) return;
    if (this.musicKind === kind && this.music) return;
    this.music?.stop(1200);
    this.musicKind = kind;
    const file = await this.fileLoop(`${import.meta.env.BASE_URL}assets/audio/${kind}-theme.mp3`, this.musicBus);
    if (this.musicKind !== kind) {
      file?.stop(0);
      return;
    }
    this.music = file ?? (kind === 'menu' ? this.generativeMenu() : this.generativeLevel());
  }

  stopMusic(fadeMs = 1200) {
    this.music?.stop(fadeMs);
    this.music = null;
    this.musicKind = null;
  }

  /** Dark ambient drone + koto plucks + distant taiko, generated forever. */
  private generativeMenu(): LoopHandle {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5, t + 3);
    out.connect(this.musicBus);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.connect(out);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start(t);
    const drones = [73.42, 73.9, 110.0, 146.83].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 3 ? 0.05 : 0.11;
      o.connect(g).connect(lp);
      o.start(t);
      return o;
    });
    let alive = true;
    let step = 0;
    const phrase = [5, 7, 8, 7, 5, 4, 2, 4, 5, 9, 8, 7];
    const tick = () => {
      if (!alive || !this.ctx) return;
      const now = ctx.currentTime + 0.05;
      const r = Math.random();
      if (r < 0.82) {
        const idx = Math.random() < 0.65 ? phrase[step % phrase.length] : Math.floor(Math.random() * SCALE_HZ.length);
        const src = ctx.createBufferSource();
        src.buffer = this.pluck(SCALE_HZ[idx]);
        const g = ctx.createGain();
        g.gain.value = 0.14 + Math.random() * 0.08;
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.2 - 0.6;
        src.connect(g).connect(pan);
        pan.connect(out);
        pan.connect(this.reverbSend);
        src.start(now);
        if (Math.random() < 0.25) {
          const src2 = ctx.createBufferSource();
          src2.buffer = this.pluck(SCALE_HZ[Math.max(0, idx - 3)]);
          const g2 = ctx.createGain();
          g2.gain.value = 0.08;
          src2.connect(g2).connect(this.reverbSend);
          src2.connect(g2).connect(out);
          src2.start(now + 0.18);
        }
        step++;
      }
      if (step % 8 === 0 && Math.random() < 0.6) this.taikoTo(out, now, 0.35);
      setTimeout(tick, 420 + Math.random() * 900);
    };
    setTimeout(tick, 1200);
    return {
      stop: (fadeMs = 1200) => {
        alive = false;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fadeMs / 4000);
        const end = now + fadeMs / 1000 + 0.5;
        drones.forEach((o) => o.stop(end));
        lfo.stop(end);
      },
    };
  }

  private taikoTo(dest: AudioNode, t: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.4);
    const g = ctx.createGain();
    this.env(g, t, 0.004, gain, 0.6);
    o.connect(g).connect(dest);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 0.8);
  }

  /** Low tension bed for the level: drone + slow pulse. */
  private generativeLevel(): LoopHandle {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.35, t + 4);
    out.connect(this.musicBus);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.connect(out);
    const drones = [36.71, 55.0, 73.42].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.1;
      o.connect(g).connect(lp);
      o.start(t);
      return o;
    });
    let alive = true;
    const pulse = () => {
      if (!alive || !this.ctx) return;
      const now = ctx.currentTime + 0.05;
      this.taikoTo(out, now, 0.22);
      if (Math.random() < 0.5) {
        const src = ctx.createBufferSource();
        src.buffer = this.pluck(SCALE_HZ[Math.floor(Math.random() * 5) + 5]);
        const g = ctx.createGain();
        g.gain.value = 0.07;
        src.connect(g).connect(this.reverbSend);
        src.start(now + 0.5);
      }
      setTimeout(pulse, 2600 + Math.random() * 1600);
    };
    setTimeout(pulse, 2000);
    return {
      stop: (fadeMs = 1500) => {
        alive = false;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fadeMs / 4000);
        drones.forEach((o) => o.stop(now + fadeMs / 1000 + 0.5));
      },
    };
  }

  /** Lakeside dusk: wind, water lapping and crickets. */
  startAmbience() {
    if (!this.ready || this.ambience) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.6, t + 3);
    out.connect(this.ambBus);
    // wind
    const wind = this.noiseSource(true);
    const wbp = ctx.createBiquadFilter();
    wbp.type = 'bandpass';
    wbp.frequency.value = 420;
    wbp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.12;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.11;
    const wlg = ctx.createGain();
    wlg.gain.value = 0.07;
    wl.connect(wlg).connect(wg.gain);
    wind.connect(wbp).connect(wg).connect(out);
    // water
    const water = this.noiseSource(true);
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 300;
    const waterG = ctx.createGain();
    waterG.gain.value = 0.1;
    const lap = ctx.createOscillator();
    lap.frequency.value = 0.35;
    const lapG = ctx.createGain();
    lapG.gain.value = 0.08;
    lap.connect(lapG).connect(waterG.gain);
    water.connect(wlp).connect(waterG).connect(out);
    wind.start(t);
    water.start(t);
    wl.start(t);
    lap.start(t);
    let alive = true;
    const cricket = () => {
      if (!alive || !this.ctx) return;
      const now = ctx.currentTime;
      const f = 4200 + Math.random() * 900;
      const chirps = 2 + Math.floor(Math.random() * 3);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      pan.connect(out);
      for (let i = 0; i < chirps; i++) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        this.env(g, now + i * 0.07, 0.005, 0.018, 0.04);
        o.connect(g).connect(pan);
        o.start(now + i * 0.07);
        o.stop(now + i * 0.07 + 0.06);
      }
      setTimeout(cricket, 300 + Math.random() * 1400);
    };
    cricket();
    this.ambience = {
      stop: (fadeMs = 1500) => {
        alive = false;
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0.0001, now, fadeMs / 4000);
        const end = now + fadeMs / 1000 + 0.5;
        [wind, water, wl, lap].forEach((n) => n.stop(end));
        this.ambience = null;
      },
    };
  }

  stopAmbience(fadeMs = 1500) {
    this.ambience?.stop(fadeMs);
    this.ambience = null;
  }
}

export const Sound = new SoundEngineImpl();
