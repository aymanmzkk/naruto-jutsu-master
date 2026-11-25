import type { JutsuLevelConfig } from '../types';

/**
 * LEVEL 1 — Katon: Gōkakyū no Jutsu (Fire Release: Great Fireball Technique)
 *
 * VIDEO TIMESTAMPS: set these to match YOUR video file (seconds).
 * They can also be adjusted at runtime from Main Menu → Settings → Video,
 * which overrides these defaults without editing code.
 */
const config: JutsuLevelConfig = {
  id: 1,
  title: 'Katon: Gōkakyū no Jutsu',
  subtitle: 'Fire Release: Great Fireball Technique',
  kanji: '火遁・豪火球の術',
  sequence: ['snake', 'ram', 'monkey', 'boar', 'horse', 'tiger'],
  video: {
    src: `${import.meta.env.BASE_URL}assets/videos/level1.mp4`,
    // Timings for the bundled clip (43.9 s): wide shot → close-up of father
    // and son; the lesson with the hands starts at 14.8 s and the fireball
    // over the lake ends around 30 s; the clip is cut at 41.15 s. The player performs the signs and the
    // fireball in between, then the clip resumes on the calm lake.
    introStart: 0,
    pauseAt: 14.7,
    resumeAt: 30.0,
    // the last shot (41.2 s →) shows the web player's bar and the mouse cursor
    endAt: 41.15,
    focus: { x: 0.31, y: 0.42, zoom: 2.4 },
    // the clip is a screen recording: hide the web player's control bar
    crop: { bottom: 0.085 },
  },
  activation: {
    type: 'blow',
    prompt: 'TAKE A BREATH... AND RELEASE THE FIRE!',
  },
  // Original dialogue for the fallback cinematic (shown when no video is provided).
  cinematic: {
    location: 'The clan training lake · Afternoon',
    introA: [
      { speaker: 'Father', text: 'Every child of our clan comes to this dock once. Today it is your turn.', duration: 4.2 },
      { speaker: 'Father', text: 'Fire is not thrown with the hands. It is shaped in the chest... and released with the breath.', duration: 4.6 },
      { speaker: 'Father', text: 'Watch the signs. Snake, Ram, Monkey, Boar, Horse... Tiger.', duration: 4.2 },
    ],
    introB: [
      { speaker: 'Son', text: '...', duration: 1.6 },
      { speaker: 'Father', text: 'Hold each sign until your chakra settles. Rushing them only scatters the flame.', duration: 4.4 },
      { speaker: 'Father', text: 'Now. Show me.', duration: 2.6 },
    ],
    outro: [
      { speaker: 'Father', text: '...On the first attempt.', duration: 3.0 },
      { speaker: 'Father', text: 'Remember this heat. The fire answers only to those who keep their resolve.', duration: 4.6 },
      { speaker: 'Son', text: 'Yes, Father.', duration: 2.4 },
    ],
  },
};

export default config;
