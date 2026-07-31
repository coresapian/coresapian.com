// ============================================================================
// CORESAPIAN — src/components/site/realmMeta.ts
// Presentation-only realm theming for the codex pages, keyed to contract
// RealmId. Game facts live in /contracts; this file carries the design.md
// §2.2 accent system, chapter runes/epithets (realms.md), particle moods and
// world-tree map geometry. Import contract data separately.
// ============================================================================

import type { RealmId } from '../../../contracts/types';
import type { ParticleMode } from './Particles';

export interface RealmMeta {
  id: RealmId;
  rune: string;
  epithet: string;
  /** design.md §2.2 accent + glow hexes (also exposed as CSS vars in index.css) */
  accent: string;
  glow: string;
  accentVar: string;
  accentRgbVar: string;
  /** realms.md chapter underlay particle mood */
  particles: ParticleMode;
  /** Ambient-audio chip descriptive line (recipe id comes from contracts). */
  ambient: string;
  /** World-tree map node position (viewBox 0..1000). */
  map: { x: number; y: number; anchorY: number };
}

export const REALM_ORDER: RealmId[] = [
  'midgard',
  'alfheim',
  'svartalfheim',
  'jotunheim',
  'niflheim',
  'muspelheim',
  'vanaheim',
  'helheim',
  'asgard',
];

export const REALM_META: Record<RealmId, RealmMeta> = {
  midgard: {
    id: 'midgard', rune: 'ᛗ', epithet: 'The Mist-Girdled World',
    accent: '#6FA287', glow: '#9FD0B4',
    accentVar: 'var(--realm-midgard)', accentRgbVar: 'var(--realm-midgard-rgb)',
    particles: 'fog',
    ambient: 'pine wind · fjord water · distant ravens',
    map: { x: 500, y: 430, anchorY: 430 },
  },
  alfheim: {
    id: 'alfheim', rune: 'ᚨ', epithet: 'Light Unspent',
    accent: '#F0D060', glow: '#FFF0B0',
    accentVar: 'var(--realm-alfheim)', accentRgbVar: 'var(--realm-alfheim-rgb)',
    particles: 'motes',
    ambient: 'wordless choir pads · harp-like harmonics',
    map: { x: 745, y: 215, anchorY: 235 },
  },
  svartalfheim: {
    id: 'svartalfheim', rune: 'ᛊ', epithet: 'The Forge Below',
    accent: '#9A6FE0', glow: '#C9A8FF',
    accentVar: 'var(--realm-svartalfheim)', accentRgbVar: 'var(--realm-svartalfheim-rgb)',
    particles: 'sparks',
    ambient: 'forge rhythm · crystal resonance · mine-cart clatter',
    map: { x: 700, y: 660, anchorY: 625 },
  },
  jotunheim: {
    id: 'jotunheim', rune: 'ᛁ', epithet: 'Where Mountains Walk',
    accent: '#A8C6DA', glow: '#D8ECF8',
    accentVar: 'var(--realm-jotunheim)', accentRgbVar: 'var(--realm-jotunheim-rgb)',
    particles: 'snow',
    ambient: 'blizzard howl · deep ice cracks',
    map: { x: 765, y: 440, anchorY: 452 },
  },
  niflheim: {
    id: 'niflheim', rune: 'ᚾ', epithet: 'Mist Before Memory',
    accent: '#6FA8E8', glow: '#9FD8FF',
    accentVar: 'var(--realm-niflheim)', accentRgbVar: 'var(--realm-niflheim-rgb)',
    particles: 'glitter',
    ambient: 'crystalline drones · water droplets echoing',
    map: { x: 300, y: 670, anchorY: 640 },
  },
  muspelheim: {
    id: 'muspelheim', rune: 'ᛋ', epithet: 'The First Fire',
    accent: '#F0703C', glow: '#FFB37A',
    accentVar: 'var(--realm-muspelheim)', accentRgbVar: 'var(--realm-muspelheim-rgb)',
    particles: 'embers',
    ambient: 'lava rumble · ember hiss · distant war-drums',
    map: { x: 235, y: 440, anchorY: 452 },
  },
  vanaheim: {
    id: 'vanaheim', rune: 'ᚹ', epithet: 'The Green Wild',
    accent: '#8FBE50', glow: '#C0E888',
    accentVar: 'var(--realm-vanaheim)', accentRgbVar: 'var(--realm-vanaheim-rgb)',
    particles: 'pollen',
    ambient: 'leaves · bees · distant horns · stream',
    map: { x: 255, y: 215, anchorY: 235 },
  },
  helheim: {
    id: 'helheim', rune: 'ᚺ', epithet: 'The Pale Gate',
    accent: '#7FB89A', glow: '#A8E8C8',
    accentVar: 'var(--realm-helheim)', accentRgbVar: 'var(--realm-helheim-rgb)',
    particles: 'wisps',
    ambient: 'low drones · whispers · wind over ash',
    map: { x: 500, y: 825, anchorY: 790 },
  },
  asgard: {
    id: 'asgard', rune: 'ᛖ', epithet: 'The Golden Perch',
    accent: '#E8C86A', glow: '#FFE9A8',
    accentVar: 'var(--realm-asgard)', accentRgbVar: 'var(--realm-asgard-rgb)',
    particles: 'gold',
    ambient: 'storm wind · distant thunder · hall-song',
    map: { x: 500, y: 105, anchorY: 125 },
  },
};

/** Roman numerals for act/chapter labels (1..9). */
export function toRoman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n - 1] ?? String(n);
}

/** Chapter sigils used as kicker-row rune strings. */
export const ALL_REALM_RUNES = REALM_ORDER.map((id) => REALM_META[id].rune).join('');
