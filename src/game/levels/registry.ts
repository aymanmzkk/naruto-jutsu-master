import type { LevelDefinition } from './types';

/** The 10 levels of the game. Only Level 1 is playable for now. */
export const LEVELS: LevelDefinition[] = [
  {
    id: 1,
    title: 'Katon: Gōkakyū no Jutsu',
    subtitle: 'Fire Release: Great Fireball Technique',
    kanji: '火遁',
    element: 'fire',
    difficulty: 2,
    signCount: 6,
    locked: false,
    load: () => import('./Level1/config'),
  },
  { id: 2, title: 'Suiton: Suiryūdan no Jutsu', subtitle: 'Water Release: Water Dragon Bullet', kanji: '水遁', element: 'water', difficulty: 4, signCount: 8, locked: true },
  { id: 3, title: 'Chidori', subtitle: 'One Thousand Birds', kanji: '千鳥', element: 'lightning', difficulty: 3, signCount: 3, locked: true },
  { id: 4, title: 'Fūton: Daitoppa', subtitle: 'Wind Release: Great Breakthrough', kanji: '風遁', element: 'wind', difficulty: 2, signCount: 4, locked: true },
  { id: 5, title: 'Doton: Doryūheki', subtitle: 'Earth Release: Earth-Style Wall', kanji: '土遁', element: 'earth', difficulty: 3, signCount: 5, locked: true },
  { id: 6, title: 'Kage Bunshin no Jutsu', subtitle: 'Shadow Clone Technique', kanji: '影分身', element: 'shadow', difficulty: 2, signCount: 1, locked: true },
  { id: 7, title: 'Katon: Hōsenka no Jutsu', subtitle: 'Fire Release: Phoenix Sage Fire', kanji: '鳳仙火', element: 'fire', difficulty: 3, signCount: 5, locked: true },
  { id: 8, title: 'Raiton: Raikyū', subtitle: 'Lightning Release: Lightning Ball', kanji: '雷遁', element: 'lightning', difficulty: 4, signCount: 6, locked: true },
  { id: 9, title: 'Kuchiyose no Jutsu', subtitle: 'Summoning Technique', kanji: '口寄せ', element: 'summon', difficulty: 4, signCount: 5, locked: true },
  { id: 10, title: 'Fūton: Rasen Shuriken', subtitle: 'Wind Release: Spiralling Shuriken', kanji: '螺旋', element: 'wind', difficulty: 5, signCount: 7, locked: true },
];

export const getLevel = (id: number) => LEVELS.find((l) => l.id === id);
