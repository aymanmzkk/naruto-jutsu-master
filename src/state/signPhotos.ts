import { createStore } from './createStore';

/**
 * REFERENCE PHOTOS of each hand sign.
 * Priority shown in the guide:
 *   1. photo captured / uploaded by the player in the NUI LAB (saved in the browser)
 *   2. image file in /public/assets/signs/<signId>.jpg|png|webp
 *   3. the SVG drawing (fallback)
 */

const PREFIX = 'jutsu-master.signphoto.';

export interface SignCredit {
  file: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
}

export interface SignPhotoState {
  /** Captured / uploaded photos (data URLs). */
  photos: Record<string, string>;
  /** Image files found in /public/assets/signs. */
  files: Record<string, string>;
  /** Attribution of bundled images (from /public/assets/signs/credits.json). */
  credits: Record<string, SignCredit>;
}

function loadSaved(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

export const signPhotoStore = createStore<SignPhotoState>({
  photos: typeof localStorage === 'undefined' ? {} : loadSaved(),
  files: {},
  credits: {},
});

export function getSignPhoto(s: SignPhotoState, id: string): string | null {
  return s.photos[id] || s.files[id] || null;
}

/** Credit to display, only when the bundled file (not the player's photo) is shown. */
export function getSignCredit(s: SignPhotoState, id: string): SignCredit | null {
  return !s.photos[id] && s.files[id] ? s.credits[id] ?? null : null;
}

/** Saves a photo for a sign. Returns false if the browser storage is full/unavailable. */
export function saveSignPhoto(id: string, dataUrl: string): boolean {
  let persisted = true;
  try {
    localStorage.setItem(PREFIX + id, dataUrl);
  } catch {
    persisted = false; // still shown for this session
  }
  signPhotoStore.set((s) => ({ photos: { ...s.photos, [id]: dataUrl } }));
  return persisted;
}

export function removeSignPhoto(id: string) {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
  signPhotoStore.set((s) => {
    const photos = { ...s.photos };
    delete photos[id];
    return { photos };
  });
}

let discovered = false;
/**
 * Looks once for reference images: first the entries of
 * /public/assets/signs/credits.json, then <id>.jpg|jpeg|png|webp|svg files.
 */
export async function discoverSignFiles(ids: string[]) {
  if (discovered) return;
  discovered = true;
  const base = `${import.meta.env.BASE_URL}assets/signs/`;
  const files: Record<string, string> = {};
  let credits: Record<string, SignCredit> = {};
  try {
    const res = await fetch(`${base}credits.json`);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      credits = (await res.json()) as Record<string, SignCredit>;
      for (const [id, c] of Object.entries(credits)) if (c?.file) files[id] = base + c.file;
    }
  } catch {
    /* no credits file */
  }
  await Promise.all(
    ids.map(async (id) => {
      if (files[id]) return;
      for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'svg']) {
        const url = `${import.meta.env.BASE_URL}assets/signs/${id}.${ext}`;
        try {
          const res = await fetch(url, { method: 'HEAD' });
          if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image')) {
            files[id] = url;
            return;
          }
        } catch {
          /* offline / missing */
        }
      }
    }),
  );
  if (Object.keys(files).length) signPhotoStore.set({ files, credits });
}
