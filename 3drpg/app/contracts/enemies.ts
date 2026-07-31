// ============================================================================
// CORESAPIAN — contracts/enemies.ts
// Enemy definitions, per-tier scaling, boss phases, world bosses.
// XP/damage/HP here are balanced against skills.ts XP curve and items.ts DPS
// (see gdd.md §5–§7 for the math). Pure data.
// ============================================================================

import type { LootTableId } from './items';

// ---------------------------------------------------------------------------
// Per-tier scaling (tier = realm tier 1..9)
//   stat(tier) = base * (1 + PER_TIER * (tier - 1))
// ---------------------------------------------------------------------------

export const TIER_HP_MULT = 0.85;
export const TIER_DMG_MULT = 0.65;
export const TIER_XP_MULT = 1.1;

export function scaleByTier(base: number, perTier: number, tier: number): number {
  return Math.round(base * (1 + perTier * (tier - 1)) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export type EnemyClass = 'draugr' | 'beast' | 'troll' | 'elf' | 'valkyrie' | 'giant' | 'boss' | 'summon';

export interface EnemyBaseStats {
  hp: number;
  damage: number;
  /** m/s */
  speed: number;
  xp: number;
}

export interface AttackPattern {
  id: string;
  name: string;
  /** Preferred engagement range in meters. */
  range: number;
  cooldownSec: number;
  /** Multiplied by enemy damage. */
  damageMult: number;
  /** Telegraph time before the hit lands. */
  windupMs: number;
  /** Optional arc in degrees (melee sweep); omit = single target. */
  arcDeg?: number;
  notes: string;
}

export interface BossPhase {
  /** Becomes active when hp fraction <= threshold. */
  hpThreshold: number;
  name: string;
  /** Speed multiplier for the phase. */
  speedMult: number;
  /** Damage multiplier for the phase. */
  damageMult: number;
  /** Pattern ids newly enabled in this phase. */
  enables: string[];
  /** Optional summon: enemy id + count, fired once on phase entry. */
  summon?: { enemyId: string; count: number };
}

export interface EnemyDef {
  id: string;
  name: string;
  enemyClass: EnemyClass;
  /** Short bestiary line (shown on first encounter). */
  description: string;
  baseStats: EnemyBaseStats;
  armor: number;
  aggroRangeM: number;
  attacks: AttackPattern[];
  lootTable: LootTableId | null;
  boss?: {
    /** Arena leash radius; beyond it the boss resets and heals. */
    arenaRadiusM: number;
    phases: BossPhase[];
    /** Enrage timer in seconds (0 = none). */
    enrageSec: number;
  };
}

// ---------------------------------------------------------------------------
// Base enemies (7)
// ---------------------------------------------------------------------------

export const ENEMIES: Record<string, EnemyDef> = {
  draugr: {
    id: 'draugr',
    name: 'Draugr',
    enemyClass: 'draugr',
    description: 'The barrow-dead walk, jealous of warm blood. Slow, but they do not stop.',
    baseStats: { hp: 60, damage: 8, speed: 3.2, xp: 25 },
    armor: 2,
    aggroRangeM: 18,
    attacks: [
      { id: 'claw', name: 'Grave Claw', range: 1.9, cooldownSec: 1.6, damageMult: 1.0, windupMs: 450, notes: 'Basic swipe.' },
      { id: 'rend', name: 'Rending Grip', range: 2.0, cooldownSec: 6, damageMult: 1.5, windupMs: 800, notes: 'Two-handed grab; heavy telegraph.' },
    ],
    lootTable: 'loot_draugr',
  },

  vargr: {
    id: 'vargr',
    name: 'Vargr',
    enemyClass: 'beast',
    description: 'Realm-wolf, lean as winter. Circles its prey and answers every howl.',
    baseStats: { hp: 40, damage: 6, speed: 6.5, xp: 18 },
    armor: 0,
    aggroRangeM: 24,
    attacks: [
      { id: 'bite', name: 'Snap Bite', range: 1.6, cooldownSec: 1.2, damageMult: 1.0, windupMs: 300, notes: 'Fast lunge.' },
      { id: 'pounce', name: 'Pounce', range: 5.0, cooldownSec: 7, damageMult: 1.4, windupMs: 600, notes: 'Leap from range; knocks the target back 2m.' },
    ],
    lootTable: 'loot_vargr',
  },

  troll: {
    id: 'troll',
    name: 'Troll',
    enemyClass: 'troll',
    description: 'Stone-skinned and sun-shy. Hits like a landslide and thinks like one too.',
    baseStats: { hp: 160, damage: 18, speed: 2.6, xp: 60 },
    armor: 8,
    aggroRangeM: 16,
    attacks: [
      { id: 'smash', name: 'Boulder Smash', range: 2.8, cooldownSec: 2.8, damageMult: 1.0, windupMs: 900, arcDeg: 120, notes: 'Slow sweeping smash.' },
      { id: 'slam', name: 'Ground Slam', range: 3.2, cooldownSec: 9, damageMult: 1.6, windupMs: 1200, arcDeg: 360, notes: 'AoE ring, 4m; dodge through the windup.' },
    ],
    lootTable: 'loot_troll',
  },

  dokkalf: {
    id: 'dokkalf',
    name: 'Dökkálfr',
    enemyClass: 'elf',
    description: 'A dark elf of the under-earth, quick as a bad thought and twice as cruel.',
    baseStats: { hp: 50, damage: 10, speed: 5.0, xp: 30 },
    armor: 1,
    aggroRangeM: 22,
    attacks: [
      { id: 'shank', name: 'Gloom Shank', range: 1.7, cooldownSec: 1.1, damageMult: 1.0, windupMs: 320, notes: 'Rapid stabs.' },
      { id: 'shadowbolt', name: 'Shadow Bolt', range: 14, cooldownSec: 4.5, damageMult: 1.2, windupMs: 700, notes: 'Ranged bolt; strafes between casts.' },
    ],
    lootTable: 'loot_dokkalf',
  },

  valkyrja: {
    id: 'valkyrja',
    name: 'Drowned Valkyrja',
    enemyClass: 'valkyrie',
    description: 'A chooser of the slain who has forgotten her oath. Her spear remembers, and grieves, and kills.',
    baseStats: { hp: 120, damage: 16, speed: 5.5, xp: 75 },
    armor: 6,
    aggroRangeM: 26,
    attacks: [
      { id: 'spear_dance', name: 'Spear Dance', range: 2.4, cooldownSec: 1.4, damageMult: 1.0, windupMs: 380, notes: 'Three-hit combo.' },
      { id: 'sky_lance', name: 'Sky Lance', range: 18, cooldownSec: 6, damageMult: 1.5, windupMs: 800, notes: 'Thrown spear, then dive to retrieve it.' },
      { id: 'oath_wail', name: 'Oath-Wail', range: 6, cooldownSec: 12, damageMult: 0.8, windupMs: 1000, arcDeg: 360, notes: 'Fear pulse: slows the player 30% for 2s.' },
    ],
    lootTable: 'loot_valkyrja',
  },

  hrimthurs: {
    id: 'hrimthurs',
    name: 'Hrímþurs',
    enemyClass: 'giant',
    description: 'A rime-giant, old as the first thaw. Where he stands, the world goes back to ice.',
    baseStats: { hp: 200, damage: 22, speed: 3.0, xp: 90 },
    armor: 10,
    aggroRangeM: 20,
    attacks: [
      { id: 'frost_club', name: 'Frost Club', range: 3.4, cooldownSec: 2.6, damageMult: 1.0, windupMs: 850, arcDeg: 100, notes: 'Massive overhead.' },
      { id: 'breath', name: 'Rime Breath', range: 6, cooldownSec: 8, damageMult: 1.2, windupMs: 900, arcDeg: 60, notes: 'Cone of frost; slows 40% for 2.5s.' },
    ],
    lootTable: 'loot_giant',
  },

  eldjotunn: {
    id: 'eldjotunn',
    name: 'Eldjǫtunn',
    enemyClass: 'giant',
    description: 'A fire-giant of Surtr’s brood, all cinder and appetite.',
    baseStats: { hp: 220, damage: 24, speed: 3.2, xp: 100 },
    armor: 10,
    aggroRangeM: 20,
    attacks: [
      { id: 'cinder_fist', name: 'Cinder Fist', range: 3.2, cooldownSec: 2.4, damageMult: 1.0, windupMs: 800, arcDeg: 100, notes: 'Burning haymaker; adds 3/s burn for 3s.' },
      { id: 'eruption', name: 'Eruption', range: 8, cooldownSec: 10, damageMult: 1.4, windupMs: 1100, notes: 'Ground erupts under the player after 0.8s delay.' },
    ],
    lootTable: 'loot_giant',
  },

  // --- Player summon (from rune_fylgja) -----------------------------------
  summon_fylgja_wolf: {
    id: 'summon_fylgja_wolf',
    name: 'Fylgja Wolf',
    enemyClass: 'summon',
    description: 'A fetch-spirit in wolf shape, bound to your wyrd.',
    baseStats: { hp: 80, damage: 8, speed: 7.0, xp: 0 },
    armor: 0,
    aggroRangeM: 30,
    attacks: [
      { id: 'spirit_bite', name: 'Spirit Bite', range: 1.6, cooldownSec: 1.2, damageMult: 1.0, windupMs: 250, notes: 'Spirit damage.' },
    ],
    lootTable: null,
  },
};

// ---------------------------------------------------------------------------
// Realm bosses (9) — fixed tier; stats are already final (no extra scaling).
// ---------------------------------------------------------------------------

function boss(
  id: string,
  name: string,
  description: string,
  stats: EnemyBaseStats,
  armor: number,
  attacks: AttackPattern[],
  phases: BossPhase[],
  enrageSec = 300,
): EnemyDef {
  return {
    id, name, enemyClass: 'boss', description,
    baseStats: stats, armor, aggroRangeM: 40,
    attacks, lootTable: 'loot_boss',
    boss: { arenaRadiusM: 45, phases, enrageSec },
  };
}

export const REALM_BOSSES: Record<string, EnemyDef> = {
  boss_fenrir: boss(
    'boss_fenrir', 'Fenrir, the Bound Wolf',
    'The chain Gleipnir has frayed to a single thread, and the Wolf is almost free. Almost is enough.',
    { hp: 1400, damage: 20, speed: 6.0, xp: 600 }, 6,
    [
      { id: 'savage', name: 'Savage', range: 2.2, cooldownSec: 1.4, damageMult: 1.0, windupMs: 350, notes: 'Raking bite combo.' },
      { id: 'lunge', name: 'Shadow Lunge', range: 8, cooldownSec: 5, damageMult: 1.4, windupMs: 600, notes: 'Covers 8m instantly.' },
      { id: 'chainwhip', name: 'Chain Whip', range: 4, cooldownSec: 8, damageMult: 1.2, windupMs: 800, arcDeg: 180, notes: 'Broken Gleipnir sweeps a half-circle.' },
    ],
    [
      { hpThreshold: 1.0, name: 'Tethered', speedMult: 1, damageMult: 1, enables: ['savage', 'lunge'] },
      { hpThreshold: 0.6, name: 'The Howl', speedMult: 1.1, damageMult: 1.1, enables: ['chainwhip'], summon: { enemyId: 'vargr', count: 3 } },
      { hpThreshold: 0.3, name: 'Unbound Frenzy', speedMult: 1.3, damageMult: 1.25, enables: [] },
    ],
  ),

  boss_dainn: boss(
    'boss_dainn', 'Dáinn, the Root-Gnawed Stag',
    'One of the four stags of Yggdrasill, maddened by the taste of the severed root.',
    { hp: 1800, damage: 24, speed: 5.5, xp: 800 }, 8,
    [
      { id: 'antler', name: 'Antler Toss', range: 2.4, cooldownSec: 1.6, damageMult: 1.0, windupMs: 450, notes: 'Upward gore; launches the player.' },
      { id: 'charge', name: 'Root-Charge', range: 12, cooldownSec: 6, damageMult: 1.5, windupMs: 800, notes: 'Line charge, 12m; wall-stuns itself if dodged.' },
      { id: 'thornwave', name: 'Thorn Wave', range: 10, cooldownSec: 9, damageMult: 1.2, windupMs: 900, notes: 'Expanding ring of root-thorns.' },
    ],
    [
      { hpThreshold: 1.0, name: 'Gnawing', speedMult: 1, damageMult: 1, enables: ['antler', 'charge'] },
      { hpThreshold: 0.5, name: 'Root-Mad', speedMult: 1.2, damageMult: 1.15, enables: ['thornwave'], summon: { enemyId: 'dokkalf', count: 2 } },
    ],
  ),

  boss_andvari: boss(
    'boss_andvari', 'Andvari, Keeper of the Cursed Hoard',
    'The dvergr who cursed his own gold rather than lose it. The curse kept.',
    { hp: 2200, damage: 28, speed: 4.5, xp: 1000 }, 10,
    [
      { id: 'gilt_edge', name: 'Gilt Edge', range: 2.0, cooldownSec: 1.3, damageMult: 1.0, windupMs: 400, notes: 'Golden dagger flurry.' },
      { id: 'curse', name: "Andvaranaut's Curse", range: 12, cooldownSec: 10, damageMult: 0.6, windupMs: 900, notes: 'Curses: player gold gain becomes damage-over-time for 6s.' },
      { id: 'hoard_nova', name: 'Hoard Nova', range: 8, cooldownSec: 12, damageMult: 1.4, windupMs: 1000, arcDeg: 360, notes: 'Ring of molten coin-shrapnel.' },
    ],
    [
      { hpThreshold: 1.0, name: 'Miser', speedMult: 1, damageMult: 1, enables: ['gilt_edge', 'curse'] },
      { hpThreshold: 0.5, name: 'Dragon-Shape', speedMult: 1.15, damageMult: 1.2, enables: ['hoard_nova'], summon: { enemyId: 'dokkalf', count: 2 } },
    ],
  ),

  boss_thrym: boss(
    'boss_thrym', 'Þrymr, King of the Jǫtnar',
    'He once stole Mjǫllnir and demanded Freyja as its price. He has not learned humility.',
    { hp: 1500, damage: 26, speed: 3.4, xp: 1400 }, 14,
    [
      { id: 'kingsmaul', name: 'King’s Maul', range: 3.6, cooldownSec: 2.2, damageMult: 1.0, windupMs: 800, arcDeg: 120, notes: 'Stolen-hammer swing.' },
      { id: 'shockwave', name: 'Throne Shockwave', range: 12, cooldownSec: 8, damageMult: 1.3, windupMs: 1000, notes: 'Ground wave; jump to avoid.' },
      { id: 'iceboulder', name: 'Ice Boulder', range: 20, cooldownSec: 6, damageMult: 1.2, windupMs: 900, notes: 'Hurled boulder, 3m impact radius.' },
    ],
    [
      { hpThreshold: 1.0, name: 'The King Holds Court', speedMult: 1, damageMult: 1, enables: ['kingsmaul', 'iceboulder'] },
      { hpThreshold: 0.6, name: 'Stolen Thunder', speedMult: 1.1, damageMult: 1.15, enables: ['shockwave'], summon: { enemyId: 'hrimthurs', count: 1 } },
      { hpThreshold: 0.25, name: 'Rage of Utgard', speedMult: 1.25, damageMult: 1.3, enables: [] },
    ],
  ),

  boss_hrimgrimnir: boss(
    'boss_hrimgrimnir', 'Hrímgrímnir, the Rime-Eater',
    'A thurs so old he eats the frost itself, and would eat the summer too.',
    { hp: 3800, damage: 38, speed: 3.2, xp: 1800 }, 16,
    [
      { id: 'rime_fist', name: 'Rime Fist', range: 3.4, cooldownSec: 2.0, damageMult: 1.0, windupMs: 750, notes: 'Freezing blow; slows 30%.' },
      { id: 'spike_field', name: 'Ice Spike Field', range: 10, cooldownSec: 9, damageMult: 1.3, windupMs: 1000, notes: 'Telegraphed spikes erupt in sequence.' },
      { id: 'whiteout', name: 'Whiteout', range: 30, cooldownSec: 16, damageMult: 0.5, windupMs: 1200, notes: 'Blinding fog: player vision to 4m for 6s.' },
    ],
    [
      { hpThreshold: 1.0, name: 'Cold Hunger', speedMult: 1, damageMult: 1, enables: ['rime_fist', 'spike_field'] },
      { hpThreshold: 0.5, name: 'Devouring Winter', speedMult: 1.15, damageMult: 1.2, enables: ['whiteout'], summon: { enemyId: 'draugr', count: 3 } },
    ],
  ),

  boss_logi: boss(
    'boss_logi', 'Logi, Flame of the Third Table',
    'The wildfire that out-ate Loki himself at Utgard-Loki’s table, wearing a giant’s shape.',
    { hp: 4400, damage: 44, speed: 4.0, xp: 2400 }, 14,
    [
      { id: 'emberlash', name: 'Ember Lash', range: 4, cooldownSec: 1.6, damageMult: 1.0, windupMs: 500, arcDeg: 140, notes: 'Whip of flame; adds burn 4/s for 3s.' },
      { id: 'fire_trail', name: 'Fire Trail', range: 0, cooldownSec: 10, damageMult: 0.8, windupMs: 0, notes: 'Passive while moving: leaves burning ground, 3s duration.' },
      { id: 'eruption_ring', name: 'Eruption Ring', range: 12, cooldownSec: 12, damageMult: 1.5, windupMs: 1100, arcDeg: 360, notes: 'Expanding ring of fire pillars.' },
    ],
    [
      { hpThreshold: 1.0, name: 'Hungry Flame', speedMult: 1, damageMult: 1, enables: ['emberlash', 'fire_trail'] },
      { hpThreshold: 0.5, name: 'Third Course', speedMult: 1.2, damageMult: 1.2, enables: ['eruption_ring'], summon: { enemyId: 'eldjotunn', count: 1 } },
    ],
  ),

  boss_gullveig: boss(
    'boss_gullveig', 'Gullveig-Heiðr, the Thrice-Burned',
    'The Vanir burned her three times in Óðinn’s hall, and three times she rose. She will rise for you, too.',
    { hp: 5200, damage: 48, speed: 4.2, xp: 3200 }, 16,
    [
      { id: 'seidr_lash', name: 'Seiðr Lash', range: 3, cooldownSec: 1.5, damageMult: 1.0, windupMs: 450, notes: 'Spirit whip.' },
      { id: 'gold_lust', name: 'Gold-Lust', range: 14, cooldownSec: 10, damageMult: 0.7, windupMs: 900, notes: 'Charm: player attacks slowed 40% for 4s.' },
      { id: 'pyre_bloom', name: 'Pyre Bloom', range: 10, cooldownSec: 12, damageMult: 1.4, windupMs: 1000, notes: 'Three burning runes bloom underfoot.' },
    ],
    [
      { hpThreshold: 1.0, name: 'First Burning', speedMult: 1, damageMult: 1, enables: ['seidr_lash', 'gold_lust'] },
      { hpThreshold: 0.66, name: 'Second Burning', speedMult: 1.15, damageMult: 1.15, enables: ['pyre_bloom'], summon: { enemyId: 'troll', count: 1 } },
      { hpThreshold: 0.33, name: 'Heiðr Triumphant', speedMult: 1.3, damageMult: 1.25, enables: [], summon: { enemyId: 'draugr', count: 2 } },
    ],
  ),

  boss_garmr: boss(
    'boss_garmr', 'Garmr, Hound of the Slain',
    'The blood-caked hound of Gnipahellir. When his chain breaks, the dead walk out and the living walk in.',
    { hp: 6000, damage: 52, speed: 6.2, xp: 4000 }, 18,
    [
      { id: 'soul_bite', name: 'Soul Bite', range: 2.4, cooldownSec: 1.4, damageMult: 1.0, windupMs: 380, notes: 'Bite that wounds max hp (-5% for 20s, stacks 3x).' },
      { id: 'grave_howl', name: 'Grave Howl', range: 20, cooldownSec: 12, damageMult: 0.6, windupMs: 1000, arcDeg: 360, notes: 'Fear: slows 40% for 3s.' },
      { id: 'chain_of_gnipa', name: 'Chain of Gnipa', range: 6, cooldownSec: 8, damageMult: 1.3, windupMs: 800, notes: 'Drags the player to melee range.' },
    ],
    [
      { hpThreshold: 1.0, name: 'The Gate-Keeper', speedMult: 1, damageMult: 1, enables: ['soul_bite', 'chain_of_gnipa'] },
      { hpThreshold: 0.5, name: 'Blood-Slick Muzzle', speedMult: 1.2, damageMult: 1.2, enables: ['grave_howl'], summon: { enemyId: 'draugr', count: 3 } },
    ],
  ),

  boss_loki: boss(
    'boss_loki', 'Loki Laufeyjarson, the Unbound',
    'The trickster, loose from the stone and done with laughing. Ragnarök waits on this duel.',
    { hp: 9000, damage: 60, speed: 5.0, xp: 8000 }, 20,
    [
      { id: 'lie_edge', name: 'Lie-Edge', range: 2.6, cooldownSec: 1.2, damageMult: 1.0, windupMs: 350, notes: 'Twin dagger dance.' },
      { id: 'mirror_image', name: 'Mirror Image', range: 0, cooldownSec: 15, damageMult: 0, windupMs: 600, notes: 'Two illusions with 300 hp; hitting the real Loki dispels both.' },
      { id: 'realm_shift', name: 'Realm Shift', range: 30, cooldownSec: 20, damageMult: 0.8, windupMs: 1000, notes: 'Arena cycles realm hazards: frost fields, fire geysers, mist.' },
      { id: 'venom_drip', name: 'Venom Drip', range: 12, cooldownSec: 8, damageMult: 1.2, windupMs: 800, notes: 'Skaði’s snake, weaponized: poison 6/s for 5s.' },
    ],
    [
      { hpThreshold: 1.0, name: 'The Smiling God', speedMult: 1, damageMult: 1, enables: ['lie_edge', 'venom_drip'] },
      { hpThreshold: 0.66, name: 'Father of Lies', speedMult: 1.1, damageMult: 1.1, enables: ['mirror_image'], summon: { enemyId: 'valkyrja', count: 1 } },
      { hpThreshold: 0.33, name: 'Ragnarök Unwritten', speedMult: 1.2, damageMult: 1.25, enables: ['realm_shift'], summon: { enemyId: 'draugr', count: 2 } },
    ],
    420,
  ),
};

// ---------------------------------------------------------------------------
// World bosses (3) — spawned by server-scheduled world events; HP scales
// +50% per participating player beyond the first (client-side sim, seeded).
// ---------------------------------------------------------------------------

export const WORLD_BOSS_HP_PER_PLAYER = 0.5;

export const WORLD_BOSSES: Record<string, EnemyDef> = {
  wboss_hraesvelgr: boss(
    'wboss_hraesvelgr', 'Hræsvelgr, the Corpse-Swallower',
    'The eagle at the world’s edge whose wingbeats are the wind. When he stoops, whole forests bow.',
    { hp: 7500, damage: 55, speed: 7.0, xp: 3000 }, 18,
    [
      { id: 'talon', name: 'Talon Rake', range: 3, cooldownSec: 1.6, damageMult: 1.0, windupMs: 450, notes: 'Swooping rake.' },
      { id: 'wind_blast', name: 'Wind Blast', range: 24, cooldownSec: 7, damageMult: 1.1, windupMs: 800, notes: 'Gust cone; knocks back 6m.' },
      { id: 'storm_front', name: 'Storm Front', range: 40, cooldownSec: 18, damageMult: 1.3, windupMs: 1200, notes: 'Arena-wide gale with safe pockets.' },
    ],
    [
      { hpThreshold: 1.0, name: 'The Wind Itself', speedMult: 1, damageMult: 1, enables: ['talon', 'wind_blast'] },
      { hpThreshold: 0.5, name: 'Corpse-Swallower', speedMult: 1.15, damageMult: 1.2, enables: ['storm_front'], summon: { enemyId: 'vargr', count: 4 } },
    ],
    600,
  ),

  wboss_nidhogg: boss(
    'wboss_nidhogg', 'Níðhǫggr’s Brood',
    'A lesser serpent gnawing at a surfaced root, dreaming of its father’s malice.',
    { hp: 8000, damage: 58, speed: 5.0, xp: 3200 }, 20,
    [
      { id: 'fang', name: 'Root-Fang', range: 3, cooldownSec: 1.5, damageMult: 1.0, windupMs: 400, notes: 'Piercing fangs; ignores 50% armor.' },
      { id: 'coil_slam', name: 'Coil Slam', range: 8, cooldownSec: 8, damageMult: 1.4, windupMs: 900, arcDeg: 360, notes: 'Body slam, 6m ring.' },
      { id: 'rot_breath', name: 'Rot Breath', range: 10, cooldownSec: 12, damageMult: 1.2, windupMs: 1000, arcDeg: 70, notes: 'Níðhǫggr’s malice: poison 8/s for 4s.' },
    ],
    [
      { hpThreshold: 1.0, name: 'Gnawing', speedMult: 1, damageMult: 1, enables: ['fang', 'coil_slam'] },
      { hpThreshold: 0.5, name: 'Malice Woken', speedMult: 1.2, damageMult: 1.2, enables: ['rot_breath'] },
    ],
    600,
  ),

  wboss_surtr: boss(
    'wboss_surtr', 'Surtr, the Black (Avatar)',
    'Not the fire-lord himself — only the shape his will wears when it walks abroad. It is enough to burn a realm.',
    { hp: 10000, damage: 65, speed: 4.5, xp: 4000 }, 22,
    [
      { id: 'flame_sword', name: 'Sword of Flame', range: 4, cooldownSec: 1.8, damageMult: 1.0, windupMs: 700, arcDeg: 160, notes: 'The sword that outshines the sun.' },
      { id: 'pyroclasm', name: 'Pyroclasm', range: 30, cooldownSec: 14, damageMult: 1.5, windupMs: 1300, arcDeg: 360, notes: 'Arena-wide wave; dodge into the gaps.' },
      { id: 'cinder_rain', name: 'Cinder Rain', range: 24, cooldownSec: 10, damageMult: 1.1, windupMs: 1000, notes: 'Targeted fire geysers, 0.9s delay.' },
    ],
    [
      { hpThreshold: 1.0, name: 'The Herald Walks', speedMult: 1, damageMult: 1, enables: ['flame_sword', 'cinder_rain'] },
      { hpThreshold: 0.6, name: 'Blackened', speedMult: 1.1, damageMult: 1.15, enables: ['pyroclasm'], summon: { enemyId: 'eldjotunn', count: 2 } },
      { hpThreshold: 0.3, name: 'Muspell’s End', speedMult: 1.25, damageMult: 1.3, enables: [] },
    ],
    720,
  ),
};

/** Every enemy lookup (base + realm bosses + world bosses). */
export const ALL_ENEMIES: Record<string, EnemyDef> = {
  ...ENEMIES,
  ...REALM_BOSSES,
  ...WORLD_BOSSES,
};
