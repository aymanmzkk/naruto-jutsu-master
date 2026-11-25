import type { Vec3 } from '../types';

/**
 * Webcam reference-photo capture: crops a square around the detected hands
 * (from the 21 landmarks of each hand) and mirrors it, so the photo looks
 * exactly like the mirrored webcam preview and the guide.
 */

export interface CropRect {
  sx: number;
  sy: number;
  size: number;
}

/**
 * Square crop (in video pixels) containing every landmark with margin.
 * Falls back to a centred square when no hands are detected.
 */
export function computeHandCrop(hands: { landmarks: Vec3[] }[], vw: number, vh: number, margin = 0.32): CropRect {
  const full = Math.min(vw, vh);
  if (!hands.length) return { sx: (vw - full) / 2, sy: (vh - full) / 2, size: full };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const h of hands) {
    for (const p of h.landmarks) {
      minX = Math.min(minX, p.x * vw);
      maxX = Math.max(maxX, p.x * vw);
      minY = Math.min(minY, p.y * vh);
      maxY = Math.max(maxY, p.y * vh);
    }
  }
  const box = Math.max(maxX - minX, maxY - minY);
  const size = Math.min(full, Math.max(box * (1 + 2 * margin), full * 0.38));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = Math.min(Math.max(cx - size / 2, 0), vw - size);
  const sy = Math.min(Math.max(cy - size / 2, 0), vh - size);
  return { sx, sy, size };
}

/** Draws a mirrored square crop of an image/video into a JPEG data URL. */
export function renderCrop(source: CanvasImageSource, crop: CropRect, out = 480, mirror = true, quality = 0.86): string {
  const c = document.createElement('canvas');
  c.width = out;
  c.height = out;
  const g = c.getContext('2d')!;
  if (mirror) {
    g.translate(out, 0);
    g.scale(-1, 1);
  }
  g.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, out, out);
  return c.toDataURL('image/jpeg', quality);
}

/** Loads a user-selected image file and returns a centred square JPEG (not mirrored). */
export function fileToSquarePhoto(file: File, out = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const data = renderCrop(img, { sx: (img.naturalWidth - s) / 2, sy: (img.naturalHeight - s) / 2, size: s }, out, false);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a valid image'));
    };
    img.src = url;
  });
}
