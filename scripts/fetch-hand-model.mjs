// OPTIONAL: downloads the official MediaPipe hand landmarker model into
// public/models so the game works fully offline. Without it, the game loads
// the same model from Google's MediaPipe model storage at runtime.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'models', 'hand_landmarker.task');

console.log('Downloading', URL_MODEL);
const res = await fetch(URL_MODEL);
if (!res.ok) {
  console.error('Download failed:', res.status, res.statusText);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, buf);
console.log(`Saved ${(buf.length / 1e6).toFixed(1)} MB to public/models/hand_landmarker.task`);
