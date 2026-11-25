import type { Vec3 } from './types';

/**
 * One Euro Filter (Casiez et al., CHI 2012).
 * An adaptive low-pass filter: heavy smoothing when the hand is still
 * (removes jitter) and low latency when the hand moves fast.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    public minCutoff = 1.2,
    public beta = 0.02,
    public dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = tMs;
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

/** Smooths a full set of 21 3D landmarks (63 independent One Euro filters). */
export class LandmarkSmoother {
  private filters: OneEuroFilter[] = [];

  constructor(
    private count = 21,
    minCutoff = 1.2,
    beta = 0.02,
  ) {
    for (let i = 0; i < count * 3; i++) this.filters.push(new OneEuroFilter(minCutoff, beta));
  }

  configure(minCutoff: number, beta: number) {
    for (const f of this.filters) {
      f.minCutoff = minCutoff;
      f.beta = beta;
    }
  }

  apply(points: Vec3[], tMs: number): Vec3[] {
    const out: Vec3[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const p = points[i];
      out[i] = {
        x: this.filters[i * 3].filter(p.x, tMs),
        y: this.filters[i * 3 + 1].filter(p.y, tMs),
        z: this.filters[i * 3 + 2].filter(p.z, tMs),
      };
    }
    return out;
  }

  reset() {
    for (const f of this.filters) f.reset();
  }
}

/** Frame-rate independent exponential moving average for scalar scores. */
export class ScoreSmoother {
  private values = new Map<string, number>();
  constructor(public timeConstantMs = 110) {}

  update(key: string, value: number, dtMs: number): number {
    const prev = this.values.get(key);
    if (prev === undefined) {
      this.values.set(key, value);
      return value;
    }
    const a = 1 - Math.exp(-dtMs / Math.max(1, this.timeConstantMs));
    const next = prev + (value - prev) * a;
    this.values.set(key, next);
    return next;
  }

  get(key: string) {
    return this.values.get(key) ?? 0;
  }

  reset() {
    this.values.clear();
  }
}
