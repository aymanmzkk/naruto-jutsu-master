import * as THREE from 'three';
import { rng } from '../../utils/math';

/** Procedural canvas textures (no image files needed). */

const cache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Soft round particle. */
export function softDot() {
  return canvasTexture('dot', 64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  });
}

/** Turbulent flame / smoke puff (white, tinted in shader). */
export function puff(seed = 1) {
  return canvasTexture(`puff${seed}`, 128, 128, (g) => {
    const r = rng(seed * 977);
    g.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 30;
      const x = 64 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d;
      const rad = 14 + r() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(255,255,255,${0.22 + r() * 0.2})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    // fade edges so sprites never show square borders
    const mask = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = mask;
    g.fillRect(0, 0, 128, 128);
  });
}

/** Tileable-ish value noise + fbm used to paint the sprite textures. */
function noiseField(seed: number, size: number) {
  const r = rng(seed);
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x: number, y: number) => g[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const n = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number, oct = 5) => {
    let s = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      s += n(x * f, y * f) * amp;
      f *= 2;
      amp *= 0.5;
    }
    return s;
  };
}

function pixelTexture(key: string, size: number, fn: (u: number, v: number) => [number, number]) {
  return canvasTexture(key, size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [lum, a] = fn((x + 0.5) / size, (y + 0.5) / size);
        const i = (y * size + x) * 4;
        const l = Math.max(0, Math.min(255, lum * 255));
        img.data[i] = l;
        img.data[i + 1] = l;
        img.data[i + 2] = l;
        img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/**
 * Flame sprite: wispy turbulent tongues with a hot core (white; tinted by
 * the particle colour ramp). Brightness varies inside, so stacked sprites
 * read as fire with structure instead of a flat blob.
 */
export function flameSprite(seed = 1) {
  const fbm = noiseField(seed * 131 + 7, 64);
  return pixelTexture(`flame${seed}`, 128, (u, v) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    // domain warp for licking tongues
    const w = fbm(u * 5 + 3, v * 5) * 2.2;
    const n = fbm(u * 7 + w, v * 7 - w * 0.6);
    const fall = Math.max(0, 1 - r * r);
    const shape = n * 1.35 * fall + fall * 0.25;
    const a = Math.max(0, Math.min(1, (shape - 0.38) * 2.6));
    // posterised (cel) flame: two tones, hard-edged alpha steps
    const lum = shape > 0.62 ? 1 : 0.62;
    const aq = a < 0.3 ? 0 : a < 0.72 ? 0.6 : 1;
    return [lum, aq];
  });
}

/** Billowing smoke sprite: soft lumpy edges and inner density variation. */
export function smokeSprite(seed = 2) {
  const fbm = noiseField(seed * 71 + 3, 64);
  return pixelTexture(`smoke${seed}`, 128, (u, v) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const n = fbm(u * 4, v * 4);
    const fall = Math.max(0, 1 - r);
    const d = Math.max(0, Math.min(1, (n * 1.5 * Math.pow(fall, 0.7) - 0.28) * 1.8));
    // cel smoke: lit / shaded tone, stepped alpha
    const lum = fbm(u * 5 + 2.5, v * 5 - 1.5) > 0.5 ? 1 : 0.78;
    const a = d * Math.pow(fall, 0.6);
    return [lum, a < 0.18 ? 0 : a < 0.5 ? 0.55 : 0.9];
  });
}

/** Wood planks texture. */
export function woodTexture() {
  const t = canvasTexture('wood', 256, 256, (g) => {
    const r = rng(42);
    g.fillStyle = '#5b3a24';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      const y = r() * 256;
      g.strokeStyle = `rgba(${30 + r() * 30},${18 + r() * 14},${10},${0.25 + r() * 0.3})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5);
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(25,14,8,0.5)';
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 4 + r() * 6, 2 + r() * 3, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Stone texture. */
export function stoneTexture() {
  const t = canvasTexture('stone', 256, 256, (g) => {
    const r = rng(7);
    g.fillStyle = '#6c6866';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      const v = 70 + r() * 70;
      g.fillStyle = `rgba(${v},${v - 4},${v - 8},${0.25 + r() * 0.3})`;
      g.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 4);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(60,80,50,${r() * 0.25})`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 4 + r() * 18, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Original clan emblem: a red flame inside a ring (fictional). */
export function emblemTexture() {
  return canvasTexture('emblem', 256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.lineWidth = 14;
    g.strokeStyle = '#f2ece2';
    g.beginPath();
    g.arc(128, 128, 96, 0, Math.PI * 2);
    g.stroke();
    const grd = g.createLinearGradient(128, 40, 128, 210);
    grd.addColorStop(0, '#ffb347');
    grd.addColorStop(0.5, '#e8401c');
    grd.addColorStop(1, '#9c1010');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(128, 46);
    g.bezierCurveTo(150, 92, 192, 110, 176, 160);
    g.bezierCurveTo(166, 196, 136, 208, 128, 208);
    g.bezierCurveTo(98, 208, 72, 186, 78, 150);
    g.bezierCurveTo(82, 126, 104, 120, 102, 92);
    g.bezierCurveTo(116, 108, 120, 128, 116, 140);
    g.bezierCurveTo(136, 120, 140, 88, 128, 46);
    g.fill();
  });
}
