// ============================================================================
// CORESAPIAN — contracts/realms.ts
// Per-realm world generation + gameplay configuration. Data-driven: the world
// agent renders from this, the audio agent maps ambientAudioId to recipes in
// design/audio-recipes.md, combat/ai agents read spawnTable + bossEnemyId.
// Pure TypeScript, no deps beyond contract-relative imports.
// ============================================================================

import type { RealmId, Vec3 } from './types';

// ---------------------------------------------------------------------------
// World geometry constants (each realm is a procedural island disc)
// ---------------------------------------------------------------------------

export const WORLD_RADIUS_M = 200;
export const WORLD_SEED_BASE = 1337;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export interface RealmPalette {
  sky: string;
  horizon: string;
  fog: string;
  ambient: string;
  sun: string;
  ground: string;
  /** UI/HUD accent — matches the site design system realm accents. */
  accent: string;
}

export interface TerrainParams {
  /** Max hill height in meters. */
  amplitude: number;
  /** Base simplex frequency (1/meters). */
  frequency: number;
  octaves: number;
  /** 0 = fully shaped by noise, 1 = flattened toward sea level (exponent mix). */
  flatness: number;
  seed: number;
}

export interface PropSet {
  /** Procedural prop archetype ids (world agent owns the meshes). */
  kinds: string[];
  /** Instances per 100x100m cell, average. */
  densityPer100m: number;
}

export interface SpawnEntry {
  /** Enemy def id from contracts/enemies.ts. */
  enemyId: string;
  /** Relative spawn weight. */
  weight: number;
  /** Realm tier the enemy spawns at (drives per-tier stat scaling). */
  tier: number;
  packMin: number;
  packMax: number;
}

export interface ResourceNodeSet {
  kind: 'wood' | 'ore' | 'crystal' | 'herb';
  /** Primary material itemId yielded (contracts/items.ts). */
  itemId: string;
  densityPer100m: number;
  yieldMin: number;
  yieldMax: number;
}

export interface PortalDef {
  to: RealmId;
  /** Position relative to realm center, y resolved against terrain. */
  offset: Vec3;
  label: string;
}

export interface RealmConfig {
  id: RealmId;
  displayName: string;
  oldNorse: string;
  /** Unlock order, 1..9. Also the default enemy tier. */
  tier: number;
  description: string;
  palette: RealmPalette;
  /** Exponential fog density range; day/night and weather lerp within it. */
  fogDensityMin: number;
  fogDensityMax: number;
  terrain: TerrainParams;
  trees: PropSet;
  rocks: PropSet;
  crystals: PropSet;
  spawnTable: SpawnEntry[];
  resourceNodes: ResourceNodeSet[];
  /** Recipe id in design/audio-recipes.md (e.g. 'drone.midgard'). */
  ambientAudioId: string;
  portals: PortalDef[];
  /** Player arrival point, relative to realm center. */
  spawnOffset: Vec3;
  bossEnemyId: string;
  bossName: string;
  bossArenaOffset: Vec3;
  /** Realm ability unlocked on chapter completion (contracts/skills.ts). */
  realmAbilityId: string;
  /** Main-campaign chapter quest id (contracts/quests.ts). */
  chapterQuestId: string;
}

// ---------------------------------------------------------------------------
// The Nine Realms
// ---------------------------------------------------------------------------

export const REALMS: Record<RealmId, RealmConfig> = {
  midgard: {
    id: 'midgard',
    displayName: 'Midgard',
    oldNorse: 'Miðgarðr',
    tier: 1,
    description:
      'The middle enclosure, realm of humankind. Mist-drowned pine forests, fjord mist, standing stones raised by forgotten hands. The first threads of the Unraveling show here: the dead walk as draugr and the wolves grow bold.',
    palette: {
      sky: '#8FB4D9',
      horizon: '#C7D8E4',
      fog: '#A9C3CF',
      ambient: '#5E7A8C',
      sun: '#FFE9C4',
      ground: '#3F6B3A',
      accent: '#6FA287',
    },
    fogDensityMin: 0.006,
    fogDensityMax: 0.014,
    terrain: { amplitude: 14, frequency: 0.012, octaves: 4, flatness: 0.45, seed: WORLD_SEED_BASE + 1 },
    trees: { kinds: ['pine_tall', 'pine_gnarled', 'birch'], densityPer100m: 9 },
    rocks: { kinds: ['boulder_moss', 'standing_stone', 'rune_stone'], densityPer100m: 3 },
    crystals: { kinds: [], densityPer100m: 0 },
    spawnTable: [
      { enemyId: 'draugr', weight: 60, tier: 1, packMin: 2, packMax: 4 },
      { enemyId: 'vargr', weight: 40, tier: 1, packMin: 2, packMax: 3 },
    ],
    resourceNodes: [
      { kind: 'wood', itemId: 'mat_wood', densityPer100m: 5, yieldMin: 2, yieldMax: 4 },
      { kind: 'ore', itemId: 'mat_iron', densityPer100m: 2, yieldMin: 2, yieldMax: 4 },
      { kind: 'herb', itemId: 'mat_herb', densityPer100m: 3, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.midgard',
    portals: [{ to: 'alfheim', offset: { x: 62, y: 0, z: -40 }, label: 'Gate of Ljós' }],
    spawnOffset: { x: 0, y: 0, z: 24 },
    bossEnemyId: 'boss_fenrir',
    bossName: 'Fenrir, the Bound Wolf',
    bossArenaOffset: { x: -110, y: 0, z: -96 },
    realmAbilityId: 'ra_midgard',
    chapterQuestId: 'q_main_1',
  },

  alfheim: {
    id: 'alfheim',
    displayName: 'Alfheim',
    oldNorse: 'Álfheimr',
    tier: 2,
    description:
      'Home of the ljósálfar, luminous beyond mortal measure. Golden birch woods and floating light-motes — but the light is dimming, and in the shadowed hollows the dökkálfar stir.',
    palette: {
      sky: '#D8EBFF',
      horizon: '#FFF4D6',
      fog: '#EAF2E2',
      ambient: '#A8C8A0',
      sun: '#FFF6D8',
      ground: '#6FA858',
      accent: '#F0D060',
    },
    fogDensityMin: 0.004,
    fogDensityMax: 0.009,
    terrain: { amplitude: 10, frequency: 0.014, octaves: 4, flatness: 0.55, seed: WORLD_SEED_BASE + 2 },
    trees: { kinds: ['gold_birch', 'lumen_willow'], densityPer100m: 11 },
    rocks: { kinds: ['pale_stone', 'mote_shard'], densityPer100m: 2 },
    crystals: { kinds: ['light_mote', 'sun_crystal'], densityPer100m: 3 },
    spawnTable: [
      { enemyId: 'dokkalf', weight: 55, tier: 2, packMin: 2, packMax: 4 },
      { enemyId: 'vargr', weight: 25, tier: 2, packMin: 2, packMax: 3 },
      { enemyId: 'draugr', weight: 20, tier: 2, packMin: 2, packMax: 3 },
    ],
    resourceNodes: [
      { kind: 'wood', itemId: 'mat_wood', densityPer100m: 6, yieldMin: 2, yieldMax: 4 },
      { kind: 'crystal', itemId: 'mat_crystal', densityPer100m: 3, yieldMin: 1, yieldMax: 2 },
      { kind: 'herb', itemId: 'mat_herb', densityPer100m: 4, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.alfheim',
    portals: [
      { to: 'midgard', offset: { x: -58, y: 0, z: 44 }, label: 'Gate of Miðgarðr' },
      { to: 'svartalfheim', offset: { x: 64, y: 0, z: -36 }, label: 'Descent of the Dvergar' },
    ],
    spawnOffset: { x: -44, y: 0, z: 30 },
    bossEnemyId: 'boss_dainn',
    bossName: 'Dáinn, the Root-Gnawed Stag',
    bossArenaOffset: { x: 104, y: 0, z: 92 },
    realmAbilityId: 'ra_alfheim',
    chapterQuestId: 'q_main_2',
  },

  svartalfheim: {
    id: 'svartalfheim',
    displayName: 'Svartalfheim',
    oldNorse: 'Svartálfaheimr',
    tier: 3,
    description:
      'The deep halls of the dvergar. Bioluminescent caverns, crystal veins, and forges that have burned since before the Æsir had names. Something has curdled in the dark: Andvari’s cursed gold calls to greedy hands.',
    palette: {
      sky: '#1B1830',
      horizon: '#2E2848',
      fog: '#241F3C',
      ambient: '#4A3E70',
      sun: '#8F7FD8',
      ground: '#332C4C',
      accent: '#9A6FE0',
    },
    fogDensityMin: 0.010,
    fogDensityMax: 0.020,
    terrain: { amplitude: 22, frequency: 0.02, octaves: 5, flatness: 0.3, seed: WORLD_SEED_BASE + 3 },
    trees: { kinds: ['glow_fungus_tall', 'cave_root'], densityPer100m: 7 },
    rocks: { kinds: ['basalt_spire', 'forge_rubble'], densityPer100m: 4 },
    crystals: { kinds: ['vein_crystal_purple', 'vein_crystal_teal'], densityPer100m: 5 },
    spawnTable: [
      { enemyId: 'dokkalf', weight: 50, tier: 3, packMin: 2, packMax: 4 },
      { enemyId: 'troll', weight: 35, tier: 3, packMin: 1, packMax: 2 },
      { enemyId: 'draugr', weight: 15, tier: 3, packMin: 2, packMax: 3 },
    ],
    resourceNodes: [
      { kind: 'ore', itemId: 'mat_iron', densityPer100m: 5, yieldMin: 2, yieldMax: 4 },
      { kind: 'crystal', itemId: 'mat_crystal', densityPer100m: 4, yieldMin: 1, yieldMax: 3 },
      { kind: 'wood', itemId: 'mat_wood', densityPer100m: 1, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.svartalfheim',
    portals: [
      { to: 'alfheim', offset: { x: -60, y: 0, z: 40 }, label: 'Ascent to Ljós' },
      { to: 'jotunheim', offset: { x: 62, y: 0, z: -42 }, label: 'Gate of Stone' },
    ],
    spawnOffset: { x: -42, y: 0, z: 28 },
    bossEnemyId: 'boss_andvari',
    bossName: 'Andvari, Keeper of the Cursed Hoard',
    bossArenaOffset: { x: 96, y: 0, z: -104 },
    realmAbilityId: 'ra_svartalfheim',
    chapterQuestId: 'q_main_3',
  },

  jotunheim: {
    id: 'jotunheim',
    displayName: 'Jötunheim',
    oldNorse: 'Jǫtunheimr',
    tier: 4,
    description:
      'The stone-cold east, stronghold of the jǫtnar. Jagged peaks, frozen ruins of Utgard, and a wind that speaks in old threats. King Þrymr hoards a realm-seal among his stolen treasures.',
    palette: {
      sky: '#B9D4E8',
      horizon: '#E4F0F8',
      fog: '#C9DCEA',
      ambient: '#7E99B2',
      sun: '#F4F9FF',
      ground: '#DDE8F0',
      accent: '#A8C6DA',
    },
    fogDensityMin: 0.008,
    fogDensityMax: 0.024,
    terrain: { amplitude: 34, frequency: 0.01, octaves: 5, flatness: 0.2, seed: WORLD_SEED_BASE + 4 },
    trees: { kinds: ['frost_pine', 'dead_larch'], densityPer100m: 4 },
    rocks: { kinds: ['glacier_spike', 'rune_monolith', 'frozen_ruin'], densityPer100m: 5 },
    crystals: { kinds: ['rime_crystal'], densityPer100m: 3 },
    spawnTable: [
      { enemyId: 'hrimthurs', weight: 45, tier: 4, packMin: 1, packMax: 2 },
      { enemyId: 'troll', weight: 30, tier: 4, packMin: 1, packMax: 2 },
      { enemyId: 'vargr', weight: 25, tier: 4, packMin: 2, packMax: 4 },
    ],
    resourceNodes: [
      { kind: 'crystal', itemId: 'mat_rime', densityPer100m: 4, yieldMin: 1, yieldMax: 3 },
      { kind: 'ore', itemId: 'mat_iron', densityPer100m: 3, yieldMin: 2, yieldMax: 4 },
      { kind: 'wood', itemId: 'mat_wood', densityPer100m: 2, yieldMin: 1, yieldMax: 3 },
    ],
    ambientAudioId: 'drone.jotunheim',
    portals: [
      { to: 'svartalfheim', offset: { x: -58, y: 0, z: 46 }, label: 'Descent of the Dvergar' },
      { to: 'niflheim', offset: { x: 60, y: 0, z: -44 }, label: 'Gate of Mist' },
    ],
    spawnOffset: { x: -40, y: 0, z: 32 },
    bossEnemyId: 'boss_thrym',
    bossName: 'Þrymr, King of the Jǫtnar',
    bossArenaOffset: { x: 118, y: 0, z: 64 },
    realmAbilityId: 'ra_jotunheim',
    chapterQuestId: 'q_main_4',
  },

  niflheim: {
    id: 'niflheim',
    displayName: 'Niflheim',
    oldNorse: 'Niflheimr',
    tier: 5,
    description:
      'The primordial mist-world, older than gods. Glowing blue ice caves, fog banks that swallow sound, and aurora that bleeds across a sunless sky. Memory itself grows thin here.',
    palette: {
      sky: '#4A5E70',
      horizon: '#7A93A6',
      fog: '#5F7488',
      ambient: '#4E6A80',
      sun: '#BFE0F0',
      ground: '#5C7080',
      accent: '#6FA8E8',
    },
    fogDensityMin: 0.014,
    fogDensityMax: 0.032,
    terrain: { amplitude: 18, frequency: 0.016, octaves: 5, flatness: 0.35, seed: WORLD_SEED_BASE + 5 },
    trees: { kinds: ['ice_encased_pine'], densityPer100m: 2 },
    rocks: { kinds: ['blue_ice_spire', 'frozen_wave'], densityPer100m: 5 },
    crystals: { kinds: ['nifl_crystal', 'aurora_shard'], densityPer100m: 5 },
    spawnTable: [
      { enemyId: 'draugr', weight: 50, tier: 5, packMin: 3, packMax: 5 },
      { enemyId: 'hrimthurs', weight: 35, tier: 5, packMin: 1, packMax: 2 },
      { enemyId: 'dokkalf', weight: 15, tier: 5, packMin: 2, packMax: 3 },
    ],
    resourceNodes: [
      { kind: 'crystal', itemId: 'mat_rime', densityPer100m: 5, yieldMin: 1, yieldMax: 3 },
      { kind: 'crystal', itemId: 'mat_crystal', densityPer100m: 2, yieldMin: 1, yieldMax: 2 },
      { kind: 'herb', itemId: 'mat_herb', densityPer100m: 2, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.niflheim',
    portals: [
      { to: 'jotunheim', offset: { x: -56, y: 0, z: 44 }, label: 'Gate of Stone' },
      { to: 'muspelheim', offset: { x: 62, y: 0, z: -40 }, label: 'Gate of Ember' },
    ],
    spawnOffset: { x: -40, y: 0, z: 30 },
    bossEnemyId: 'boss_hrimgrimnir',
    bossName: 'Hrímgrímnir, the Rime-Eater',
    bossArenaOffset: { x: 96, y: 0, z: 100 },
    realmAbilityId: 'ra_niflheim',
    chapterQuestId: 'q_main_5',
  },

  muspelheim: {
    id: 'muspelheim',
    displayName: 'Muspelheim',
    oldNorse: 'Múspellsheimr',
    tier: 6,
    description:
      'The burning south, domain of Surtr’s fire-sons. Lava braids across obsidian fields, ember storms rake the ash, and every oath spoken here is tested by flame.',
    palette: {
      sky: '#3A1608',
      horizon: '#7A2E10',
      fog: '#57220E',
      ambient: '#8A3A18',
      sun: '#FFB37A',
      ground: '#1E120C',
      accent: '#F0703C',
    },
    fogDensityMin: 0.008,
    fogDensityMax: 0.018,
    terrain: { amplitude: 26, frequency: 0.013, octaves: 5, flatness: 0.25, seed: WORLD_SEED_BASE + 6 },
    trees: { kinds: ['charred_trunk'], densityPer100m: 2 },
    rocks: { kinds: ['obsidian_spire', 'lava_rock', 'basalt_column'], densityPer100m: 6 },
    crystals: { kinds: ['ember_crystal'], densityPer100m: 4 },
    spawnTable: [
      { enemyId: 'eldjotunn', weight: 55, tier: 6, packMin: 1, packMax: 2 },
      { enemyId: 'draugr', weight: 25, tier: 6, packMin: 2, packMax: 4 },
      { enemyId: 'troll', weight: 20, tier: 6, packMin: 1, packMax: 2 },
    ],
    resourceNodes: [
      { kind: 'crystal', itemId: 'mat_ember', densityPer100m: 5, yieldMin: 1, yieldMax: 3 },
      { kind: 'ore', itemId: 'mat_iron', densityPer100m: 3, yieldMin: 2, yieldMax: 4 },
      { kind: 'ore', itemId: 'mat_gold', densityPer100m: 1, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.muspelheim',
    portals: [
      { to: 'niflheim', offset: { x: -60, y: 0, z: 42 }, label: 'Gate of Mist' },
      { to: 'vanaheim', offset: { x: 58, y: 0, z: -46 }, label: 'Gate of the Vanir' },
    ],
    spawnOffset: { x: -42, y: 0, z: 30 },
    bossEnemyId: 'boss_logi',
    bossName: 'Logi, Flame of the Third Table',
    bossArenaOffset: { x: 108, y: 0, z: 84 },
    realmAbilityId: 'ra_muspelheim',
    chapterQuestId: 'q_main_6',
  },

  vanaheim: {
    id: 'vanaheim',
    displayName: 'Vanaheim',
    oldNorse: 'Vanaheimr',
    tier: 7,
    description:
      'The verdant west, old home of the Vanir — gods of harvest, sea and seiðr. Overgrown groves and golden haze; the earth here remembers every seed ever planted, and lately it remembers them angrily.',
    palette: {
      sky: '#A8D8B0',
      horizon: '#E8F0C8',
      fog: '#BCD8B0',
      ambient: '#6F9860',
      sun: '#FFE8A8',
      ground: '#3E7038',
      accent: '#8FBE50',
    },
    fogDensityMin: 0.005,
    fogDensityMax: 0.012,
    terrain: { amplitude: 12, frequency: 0.015, octaves: 4, flatness: 0.5, seed: WORLD_SEED_BASE + 7 },
    trees: { kinds: ['ancient_oak', 'golden_ash', 'vine_tree'], densityPer100m: 13 },
    rocks: { kinds: ['moss_menhir', 'root_tangle'], densityPer100m: 3 },
    crystals: { kinds: ['seed_crystal'], densityPer100m: 2 },
    spawnTable: [
      { enemyId: 'troll', weight: 40, tier: 7, packMin: 1, packMax: 2 },
      { enemyId: 'vargr', weight: 35, tier: 7, packMin: 3, packMax: 5 },
      { enemyId: 'draugr', weight: 25, tier: 7, packMin: 2, packMax: 4 },
    ],
    resourceNodes: [
      { kind: 'herb', itemId: 'mat_herb', densityPer100m: 6, yieldMin: 1, yieldMax: 3 },
      { kind: 'wood', itemId: 'mat_wood', densityPer100m: 6, yieldMin: 2, yieldMax: 4 },
      { kind: 'crystal', itemId: 'mat_sap', densityPer100m: 3, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.vanaheim',
    portals: [
      { to: 'muspelheim', offset: { x: -58, y: 0, z: 44 }, label: 'Gate of Ember' },
      { to: 'helheim', offset: { x: 62, y: 0, z: -40 }, label: 'Gate of the Slain' },
    ],
    spawnOffset: { x: -40, y: 0, z: 30 },
    bossEnemyId: 'boss_gullveig',
    bossName: 'Gullveig-Heiðr, the Thrice-Burned',
    bossArenaOffset: { x: 100, y: 0, z: 96 },
    realmAbilityId: 'ra_vanaheim',
    chapterQuestId: 'q_main_7',
  },

  helheim: {
    id: 'helheim',
    displayName: 'Helheim',
    oldNorse: 'Helheimr',
    tier: 8,
    description:
      'The grey halls beyond Gjallarbrú, where the inglorious dead drift like ash. Pale green soul-lights, dead trees, and the howl of Garmr at the gate. Even the valkyries who fall here forget their oaths.',
    palette: {
      sky: '#1C2028',
      horizon: '#38404C',
      fog: '#2A3038',
      ambient: '#3C4A48',
      sun: '#9FD8C0',
      ground: '#272E36',
      accent: '#7FB89A',
    },
    fogDensityMin: 0.012,
    fogDensityMax: 0.028,
    terrain: { amplitude: 16, frequency: 0.014, octaves: 4, flatness: 0.4, seed: WORLD_SEED_BASE + 8 },
    trees: { kinds: ['dead_tree', 'bone_tree'], densityPer100m: 5 },
    rocks: { kinds: ['grave_slab', 'soul_cairn'], densityPer100m: 4 },
    crystals: { kinds: ['soul_wisp_crystal'], densityPer100m: 3 },
    spawnTable: [
      { enemyId: 'draugr', weight: 50, tier: 8, packMin: 3, packMax: 5 },
      { enemyId: 'valkyrja', weight: 35, tier: 8, packMin: 1, packMax: 2 },
      { enemyId: 'vargr', weight: 15, tier: 8, packMin: 2, packMax: 4 },
    ],
    resourceNodes: [
      { kind: 'crystal', itemId: 'mat_essence', densityPer100m: 4, yieldMin: 1, yieldMax: 2 },
      { kind: 'herb', itemId: 'mat_herb', densityPer100m: 2, yieldMin: 1, yieldMax: 2 },
      { kind: 'ore', itemId: 'mat_gold', densityPer100m: 1, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.helheim',
    portals: [
      { to: 'vanaheim', offset: { x: -60, y: 0, z: 42 }, label: 'Gate of the Vanir' },
      { to: 'asgard', offset: { x: 60, y: 0, z: -44 }, label: 'Bifröst Anchor' },
    ],
    spawnOffset: { x: -42, y: 0, z: 30 },
    bossEnemyId: 'boss_garmr',
    bossName: 'Garmr, Hound of the Slain',
    bossArenaOffset: { x: 112, y: 0, z: 76 },
    realmAbilityId: 'ra_helheim',
    chapterQuestId: 'q_main_8',
  },

  asgard: {
    id: 'asgard',
    displayName: 'Asgard',
    oldNorse: 'Ásgarðr',
    tier: 9,
    description:
      'The high enclosure of the Æsir — golden halls and storm-lit ramparts, now besieged from within. The Bifröst burns with wrong colors. At its heart waits the Unbound One, smiling.',
    palette: {
      sky: '#E8C88A',
      horizon: '#FFEFC8',
      fog: '#D8BC88',
      ambient: '#9A8A6A',
      sun: '#FFF2CC',
      ground: '#7A7468',
      accent: '#E8C86A',
    },
    fogDensityMin: 0.003,
    fogDensityMax: 0.009,
    terrain: { amplitude: 20, frequency: 0.011, octaves: 4, flatness: 0.35, seed: WORLD_SEED_BASE + 9 },
    trees: { kinds: ['golden_yew', 'storm_oak'], densityPer100m: 5 },
    rocks: { kinds: ['marble_ruin', 'bifrost_shard_rock'], densityPer100m: 4 },
    crystals: { kinds: ['bifrost_crystal'], densityPer100m: 3 },
    spawnTable: [
      { enemyId: 'valkyrja', weight: 55, tier: 9, packMin: 1, packMax: 3 },
      { enemyId: 'eldjotunn', weight: 25, tier: 9, packMin: 1, packMax: 2 },
      { enemyId: 'draugr', weight: 20, tier: 9, packMin: 3, packMax: 4 },
    ],
    resourceNodes: [
      { kind: 'crystal', itemId: 'mat_crystal', densityPer100m: 4, yieldMin: 1, yieldMax: 3 },
      { kind: 'ore', itemId: 'mat_gold', densityPer100m: 2, yieldMin: 1, yieldMax: 2 },
      { kind: 'crystal', itemId: 'mat_essence', densityPer100m: 2, yieldMin: 1, yieldMax: 2 },
    ],
    ambientAudioId: 'drone.asgard',
    portals: [{ to: 'helheim', offset: { x: -58, y: 0, z: 44 }, label: 'Bifröst Anchor' }],
    spawnOffset: { x: -40, y: 0, z: 32 },
    bossEnemyId: 'boss_loki',
    bossName: 'Loki Laufeyjarson, the Unbound',
    bossArenaOffset: { x: 96, y: 0, z: -88 },
    realmAbilityId: 'ra_asgard',
    chapterQuestId: 'q_main_9',
  },
};

/** Realm the local player always spawns into on first load. */
export const HOME_REALM: RealmId = 'midgard';

export function realmTier(id: RealmId): number {
  return REALMS[id].tier;
}
