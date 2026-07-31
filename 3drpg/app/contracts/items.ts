// ============================================================================
// CORESAPIAN — contracts/items.ts
// All item definitions, crafting recipes, loot tables, and upgrade costs.
// Pure data. Numbers are balanced against contracts/enemies.ts (see gdd.md §5).
// ============================================================================

import type { DamageSchool, EquipSlot, ItemKind } from './types';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

interface ItemBase {
  id: string;
  name: string;
  /** Old Norse flavor line + mechanical summary, shown in tooltips. */
  description: string;
  kind: ItemKind;
  /** Power band 1..5 (matches enemy tier bands 1-2, 3-4, 5-6, 7-8, 9). */
  tier: number;
  /** Vendor sell price in gold. */
  sellPrice: number;
  /** Crafting recipe id (RECIPES) if craftable. */
  recipeId?: string;
}

export type WeaponClass = 'axe' | 'sword' | 'hammer';

export interface WeaponDef extends ItemBase {
  kind: 'weapon';
  weaponClass: WeaponClass;
  damage: number;
  /** Swings per second. */
  attackSpeed: number;
  /** Reach in meters. */
  range: number;
  staminaCost: number;
  knockback: number;
}

export interface ShieldDef extends ItemBase {
  kind: 'shield';
  /** Fraction of damage absorbed while blocking (0..1). */
  blockReduction: number;
  /** Multiplier on stamina drained per blocked hit (lower = better). */
  stability: number;
  armor: number;
}

export interface BowDef extends ItemBase {
  kind: 'bow';
  damage: number;
  /** Seconds to full draw. */
  drawTime: number;
  arrowSpeed: number;
  /** Additive crit chance at full draw. */
  critBonus: number;
  range: number;
}

export type RuneSchool = 'fire' | 'ice' | 'storm' | 'spirit';

export type RuneEffect =
  | { type: 'projectile'; speed: number; radius: number }
  | { type: 'cone'; angleDeg: number; range: number }
  | { type: 'nova'; radius: number }
  | { type: 'self_buff'; durationSec: number }
  | { type: 'ground_field'; radius: number; durationSec: number }
  | { type: 'chain'; jumps: number; jumpRange: number }
  | { type: 'heal_over_time'; durationSec: number }
  | { type: 'summon'; creatureId: string; durationSec: number }
  | { type: 'ward'; absorb: number; durationSec: number };

export interface RuneDef extends ItemBase {
  kind: 'rune';
  school: RuneSchool;
  damageSchool: DamageSchool;
  damage: number;
  /** Per-second damage of any burn/frost/echo effect. */
  dotDamage?: number;
  dotDurationSec?: number;
  healAmount?: number;
  wyrdCost: number;
  cooldownSec: number;
  effect: RuneEffect;
}

export interface ArmorDef extends ItemBase {
  kind: 'armor';
  slot: EquipSlot; // head/chest/hands/legs/feet/amulet/ring
  armor: number;
  /** Flat bonus applied on top of armor (e.g. +hp, +crit). */
  bonus?: Partial<{ maxHp: number; maxStamina: number; maxWyrd: number; critChance: number; xpGain: number }>;
}

export interface MaterialDef extends ItemBase {
  kind: 'material';
}

export interface ConsumableDef extends ItemBase {
  kind: 'consumable';
  effect:
    | { type: 'heal'; amount: number; overSec: number }
    | { type: 'restore_stamina'; amount: number }
    | { type: 'restore_wyrd'; amount: number }
    | { type: 'buff_power'; mult: number; durationSec: number }
    | { type: 'buff_defense'; armor: number; durationSec: number }
    | { type: 'regen'; hpPerSec: number; durationSec: number };
}

export type ItemDef = WeaponDef | ShieldDef | BowDef | RuneDef | ArmorDef | MaterialDef | ConsumableDef;

// ---------------------------------------------------------------------------
// Melee weapons (DPS ≈ 15 / 24 / 34 / 46 / 58 across tiers 1..5)
// ---------------------------------------------------------------------------

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'wpn_seax',
    name: 'Plains Seax',
    description: 'A single-edged blade of the Miðgarðr steadings. Quick, honest steel.',
    kind: 'weapon', weaponClass: 'sword', tier: 1,
    damage: 12, attackSpeed: 1.3, range: 2.2, staminaCost: 10, knockback: 2,
    sellPrice: 15,
  },
  {
    id: 'wpn_axe_skegg',
    name: 'Skeggøx',
    description: 'Bearded axe — hook shields, split helms. The first friend of every feykja.',
    kind: 'weapon', weaponClass: 'axe', tier: 1,
    damage: 15, attackSpeed: 1.0, range: 2.2, staminaCost: 12, knockback: 4,
    sellPrice: 15,
  },
  {
    id: 'wpn_maul',
    name: "Smith's Maul",
    description: 'Forge-hammer turned to grimmer work. Slow, and utterly final.',
    kind: 'weapon', weaponClass: 'hammer', tier: 1,
    damage: 20, attackSpeed: 0.75, range: 2.4, staminaCost: 16, knockback: 8,
    sellPrice: 15,
  },
  {
    id: 'wpn_sword_dvergr',
    name: 'Dvergr Longblade',
    description: 'Folded dvergr steel, edge cooled in cavern springs. It hums near gold.',
    kind: 'weapon', weaponClass: 'sword', tier: 2,
    damage: 18, attackSpeed: 1.35, range: 2.3, staminaCost: 10, knockback: 2,
    sellPrice: 60, recipeId: 'rcp_sword_dvergr',
  },
  {
    id: 'wpn_axe_jotun',
    name: 'Jǫtun Cleaver',
    description: 'A headsman’s axe reforged from a giant’s cooking spit. Frost still clings to it.',
    kind: 'weapon', weaponClass: 'axe', tier: 3,
    damage: 34, attackSpeed: 1.0, range: 2.3, staminaCost: 13, knockback: 5,
    sellPrice: 140, recipeId: 'rcp_axe_jotun',
  },
  {
    id: 'wpn_sword_gramr',
    name: "Gramr's Heir",
    description: 'Pattern-welded after the sword of Sigurðr Fáfnisbani. It remembers the dragon.',
    kind: 'weapon', weaponClass: 'sword', tier: 4,
    damage: 35, attackSpeed: 1.35, range: 2.3, staminaCost: 11, knockback: 3,
    sellPrice: 320, recipeId: 'rcp_sword_gramr',
  },
  {
    id: 'wpn_hammer_thrym',
    name: "Þrymr's Bane",
    description: 'A war-hammer of Utgard iron, quenched in a giant-king’s arrogance.',
    kind: 'weapon', weaponClass: 'hammer', tier: 5,
    damage: 72, attackSpeed: 0.8, range: 2.5, staminaCost: 17, knockback: 10,
    sellPrice: 700, recipeId: 'rcp_hammer_thrym',
  },
];

// ---------------------------------------------------------------------------
// Shields
// ---------------------------------------------------------------------------

export const SHIELDS: readonly ShieldDef[] = [
  {
    id: 'shd_linden',
    name: 'Linden Targe',
    description: 'Linden-wood roundshield, iron boss. It has turned a thousand spears.',
    kind: 'shield', tier: 1,
    blockReduction: 0.5, stability: 1.0, armor: 2,
    sellPrice: 12,
  },
  {
    id: 'shd_dvergr',
    name: 'Dvergr Bulwark',
    description: 'Riveted cavern-steel over oak. The dvergar build walls you can carry.',
    kind: 'shield', tier: 3,
    blockReduction: 0.65, stability: 0.75, armor: 4,
    sellPrice: 150, recipeId: 'rcp_shield_dvergr',
  },
  {
    id: 'shd_svalinn',
    name: "Svalinn's Heir",
    description: 'Named for the shield that stands before the sun. It does not burn.',
    kind: 'shield', tier: 5,
    blockReduction: 0.8, stability: 0.6, armor: 6,
    sellPrice: 650,
  },
];

// ---------------------------------------------------------------------------
// Bows
// ---------------------------------------------------------------------------

export const BOWS: readonly BowDef[] = [
  {
    id: 'bow_ash',
    name: 'Ashwood Bow',
    description: 'Cut from a sapling of the World-Tree’s lesser kin. True and patient.',
    kind: 'bow', tier: 2,
    damage: 14, drawTime: 0.8, arrowSpeed: 38, critBonus: 0.05, range: 42,
    sellPrice: 55, recipeId: 'rcp_bow_ash',
  },
  {
    id: 'bow_ydalir',
    name: 'Bow of Ýdalir',
    description: 'Strung in the yew-dales of Ullr’s hall. At full draw it whispers the shot.',
    kind: 'bow', tier: 4,
    damage: 30, drawTime: 1.0, arrowSpeed: 46, critBonus: 0.1, range: 55,
    sellPrice: 340, recipeId: 'rcp_bow_ydalir',
  },
];

// ---------------------------------------------------------------------------
// Runes (inscribed into the Q/R/F/V loadout; four galdr schools)
// ---------------------------------------------------------------------------

export const RUNES: readonly RuneDef[] = [
  // --- Eldr (fire) ---
  {
    id: 'rune_eldr_bolt',
    name: 'Eldrbóltr',
    description: 'ᛖ — a bolt of living fire. The first galdr every seiðmaðr learns, and the last many foes see.',
    kind: 'rune', tier: 1, school: 'fire', damageSchool: 'fire',
    damage: 22, wyrdCost: 12, cooldownSec: 2.5,
    effect: { type: 'projectile', speed: 30, radius: 0.6 },
    sellPrice: 40, recipeId: 'rcp_rune_eldr_bolt',
  },
  {
    id: 'rune_bruni_wave',
    name: 'Brunavǫr',
    description: 'ᛒ — a fan of flame that sets the wound alight. Burns 4/s for 3s.',
    kind: 'rune', tier: 2, school: 'fire', damageSchool: 'fire',
    damage: 18, dotDamage: 4, dotDurationSec: 3, wyrdCost: 20, cooldownSec: 8,
    effect: { type: 'cone', angleDeg: 60, range: 7 },
    sellPrice: 90,
  },
  {
    id: 'rune_logi_nova',
    name: 'Loga-Nova',
    description: 'ᛚ — the fire that ate Utgard’s table, in a single breath. Ring of flame, 5m.',
    kind: 'rune', tier: 4, school: 'fire', damageSchool: 'fire',
    damage: 34, wyrdCost: 30, cooldownSec: 14,
    effect: { type: 'nova', radius: 5 },
    sellPrice: 260,
  },
  // --- Íss (ice) ---
  {
    id: 'rune_iss_shard',
    name: 'Ískǫstr',
    description: 'ᛁ — a shard of Niflheimr’s first ice. Slows the struck by 40% for 2.5s.',
    kind: 'rune', tier: 1, school: 'ice', damageSchool: 'ice',
    damage: 16, wyrdCost: 10, cooldownSec: 2,
    effect: { type: 'projectile', speed: 34, radius: 0.5 },
    sellPrice: 40, recipeId: 'rcp_rune_iss_shard',
  },
  {
    id: 'rune_kald_bjorg',
    name: 'Kaldbjǫrg',
    description: 'ᚲ — rime-armor for 20s: +30 armor, and attackers take 6 frost in answer.',
    kind: 'rune', tier: 3, school: 'ice', damageSchool: 'ice',
    damage: 6, wyrdCost: 24, cooldownSec: 25,
    effect: { type: 'self_buff', durationSec: 20 },
    sellPrice: 160,
  },
  {
    id: 'rune_nifl_grasp',
    name: 'Niflgrip',
    description: 'ᚾ — the mist-world’s hand closes on the field. 6m field, 60% slow, 6s.',
    kind: 'rune', tier: 4, school: 'ice', damageSchool: 'ice',
    damage: 8, wyrdCost: 26, cooldownSec: 16,
    effect: { type: 'ground_field', radius: 6, durationSec: 6 },
    sellPrice: 240,
  },
  // --- Veðr (storm) ---
  {
    id: 'rune_gnista',
    name: 'Gnista',
    description: 'ᚷ — a spark struck from Þórr’s cartwheel. Near-instant, near-free.',
    kind: 'rune', tier: 1, school: 'storm', damageSchool: 'storm',
    damage: 14, wyrdCost: 8, cooldownSec: 1.2,
    effect: { type: 'projectile', speed: 60, radius: 0.4 },
    sellPrice: 40,
  },
  {
    id: 'rune_thundarr',
    name: 'Þundarr',
    description: 'ᚦ — thunder walks between foes. Chains to 3 targets within 8m.',
    kind: 'rune', tier: 3, school: 'storm', damageSchool: 'storm',
    damage: 26, wyrdCost: 22, cooldownSec: 9,
    effect: { type: 'chain', jumps: 3, jumpRange: 8 },
    sellPrice: 170,
  },
  // --- Andi (spirit) ---
  {
    id: 'rune_laekning',
    name: 'Lækning',
    description: 'ᛚᛁ — Eir’s mercy, spoken aloud. Restores 35 health over 3s.',
    kind: 'rune', tier: 2, school: 'spirit', damageSchool: 'spirit',
    damage: 0, healAmount: 35, wyrdCost: 25, cooldownSec: 12,
    effect: { type: 'heal_over_time', durationSec: 3 },
    sellPrice: 100,
  },
  {
    id: 'rune_fylgja',
    name: 'Fylgja',
    description: 'ᚠ — call your fetch-wolf. Fights beside you for 20s (8 damage/1.2s).',
    kind: 'rune', tier: 3, school: 'spirit', damageSchool: 'spirit',
    damage: 8, wyrdCost: 35, cooldownSec: 40,
    effect: { type: 'summon', creatureId: 'summon_fylgja_wolf', durationSec: 20 },
    sellPrice: 200,
  },
  {
    id: 'rune_vordr',
    name: 'Vǫrðr',
    description: 'ᚹ — a watchman of woven wyrd. Absorbs 40 damage for 10s.',
    kind: 'rune', tier: 4, school: 'spirit', damageSchool: 'spirit',
    damage: 0, wyrdCost: 20, cooldownSec: 30,
    effect: { type: 'ward', absorb: 40, durationSec: 10 },
    sellPrice: 220,
  },
];

// ---------------------------------------------------------------------------
// Armor & jewelry
// ---------------------------------------------------------------------------

export const ARMORS: readonly ArmorDef[] = [
  {
    id: 'arm_leather_cap',
    name: 'Leðrhúfa',
    description: 'Boiled-leather cap. Better than a bare skull, barely.',
    kind: 'armor', tier: 1, slot: 'head', armor: 3, sellPrice: 10,
  },
  {
    id: 'arm_wolfhide',
    name: 'Vargfell Kyrtill',
    description: 'Wolfhide tunic, still warm with the pack’s anger.',
    kind: 'armor', tier: 1, slot: 'chest', armor: 5, sellPrice: 14,
  },
  {
    id: 'arm_jotun_gauntlets',
    name: 'Jǫtun Gauntlets',
    description: 'Scaled mitts of giant-leather. Grip like a mountain’s.',
    kind: 'armor', tier: 2, slot: 'hands', armor: 4, sellPrice: 55,
  },
  {
    id: 'arm_dvergr_plate',
    name: 'Dvergr Brynja',
    description: 'Cavern-forged rings over hammered plate. The dvergar do not make it twice.',
    kind: 'armor', tier: 3, slot: 'chest', armor: 14, sellPrice: 180, recipeId: 'rcp_dvergr_plate',
  },
  {
    id: 'arm_hel_boots',
    name: 'Hel-walk Boots',
    description: 'Soles that have crossed Gjallarbrú and returned. Quiet as the grave.',
    kind: 'armor', tier: 3, slot: 'feet', armor: 6, sellPrice: 120,
  },
  {
    id: 'arm_aesir_greaves',
    name: 'Æsir Greaves',
    description: 'War-gear of the high halls, sized down for mortal legs.',
    kind: 'armor', tier: 4, slot: 'legs', armor: 10, sellPrice: 300,
  },
  {
    id: 'arm_valkyr_helm',
    name: 'Valkyrja Helm',
    description: 'Swan-feather crest, oath-bound brow. It remembers every chooser who wore it.',
    kind: 'armor', tier: 5, slot: 'head', armor: 12, sellPrice: 620, recipeId: 'rcp_helm_valkyr',
  },
  {
    id: 'amu_yggr',
    name: "Yggr's Charm",
    description: 'A knot of nine runes. The wise learn faster: +10% experience.',
    kind: 'armor', tier: 3, slot: 'amulet', armor: 0,
    bonus: { xpGain: 0.1 }, sellPrice: 200, recipeId: 'rcp_amu_yggr',
  },
  {
    id: 'ring_draupnir',
    name: "Draupnir's Shard",
    description: 'One dropped link of Óðinn’s drip-ring. +8 max wyrd.',
    kind: 'armor', tier: 4, slot: 'ring', armor: 0,
    bonus: { maxWyrd: 8 }, sellPrice: 380,
  },
];

// ---------------------------------------------------------------------------
// Materials (15)
// ---------------------------------------------------------------------------

export const MATERIALS: readonly MaterialDef[] = [
  { id: 'mat_wood', name: 'Ash Wood', description: 'Straight-grained ash, kin to Yggdrasill.', kind: 'material', tier: 1, sellPrice: 2 },
  { id: 'mat_stone', name: 'Fieldstone', description: 'Grey bone of the mountains.', kind: 'material', tier: 1, sellPrice: 1 },
  { id: 'mat_iron', name: 'Bog Iron', description: 'Rust-red ore drawn from the mires.', kind: 'material', tier: 1, sellPrice: 4 },
  { id: 'mat_steel', name: 'Dvergr Steel', description: 'Iron folded with ash and patience.', kind: 'material', tier: 2, sellPrice: 12, recipeId: 'rcp_steel' },
  { id: 'mat_pelt', name: 'Vargr Pelt', description: 'Thick winter coat of the realm-wolves.', kind: 'material', tier: 1, sellPrice: 5 },
  { id: 'mat_hide', name: 'Trollhide', description: 'Tough as an old grudge.', kind: 'material', tier: 3, sellPrice: 14 },
  { id: 'mat_bone', name: 'Rune-carved Bone', description: 'Bone that remembers the knife’s lesson.', kind: 'material', tier: 1, sellPrice: 3 },
  { id: 'mat_ash', name: 'Draugr Ash', description: 'What remains when the walking dead are unmade. Feeds the forge.', kind: 'material', tier: 1, sellPrice: 4 },
  { id: 'mat_crystal', name: 'Ljóssteinn', description: 'Sun-crystal; holds a mote of captured day.', kind: 'material', tier: 2, sellPrice: 16 },
  { id: 'mat_ember', name: 'Eimyrja Ember', description: 'A coal that refuses to die.', kind: 'material', tier: 4, sellPrice: 18 },
  { id: 'mat_rime', name: 'Rimefrost Shard', description: 'Frost from before the world had summers.', kind: 'material', tier: 4, sellPrice: 18 },
  { id: 'mat_essence', name: 'Spirit Essence', description: 'Distilled andi — the breath between worlds.', kind: 'material', tier: 4, sellPrice: 22 },
  { id: 'mat_sap', name: 'Yggdrasill Sap', description: 'Amber blood of the World-Tree, gathered where roots surface.', kind: 'material', tier: 3, sellPrice: 12 },
  { id: 'mat_gold', name: "Andvari's Gold", description: 'Cursed, certainly. Spend it quickly.', kind: 'material', tier: 4, sellPrice: 40 },
  { id: 'mat_herb', name: 'Nine-Herb Bundle', description: 'The leech-book’s charm: mugwort, waybread, and seven more.', kind: 'material', tier: 1, sellPrice: 3 },
];

// ---------------------------------------------------------------------------
// Consumables (7)
// ---------------------------------------------------------------------------

export const CONSUMABLES: readonly ConsumableDef[] = [
  {
    id: 'con_mead_s',
    name: "Healer's Mead",
    description: 'Honey-wine cut with nine herbs. Restores 40 health over 3s.',
    kind: 'consumable', tier: 1,
    effect: { type: 'heal', amount: 40, overSec: 3 },
    sellPrice: 8, recipeId: 'rcp_mead_s',
  },
  {
    id: 'con_mead_l',
    name: 'Gjöll Mead',
    description: 'Brewed strong as the river of the dead. Restores 120 health over 4s.',
    kind: 'consumable', tier: 3,
    effect: { type: 'heal', amount: 120, overSec: 4 },
    sellPrice: 30,
  },
  {
    id: 'con_tonic',
    name: 'Vigor Tonic',
    description: 'Bitter as a skald’s review. Restores 60 stamina instantly.',
    kind: 'consumable', tier: 1,
    effect: { type: 'restore_stamina', amount: 60 },
    sellPrice: 8, recipeId: 'rcp_tonic',
  },
  {
    id: 'con_elixir',
    name: 'Wyrd Elixir',
    description: 'Tastes of fate, faintly of apples. Restores 50 wyrd instantly.',
    kind: 'consumable', tier: 2,
    effect: { type: 'restore_wyrd', amount: 50 },
    sellPrice: 12, recipeId: 'rcp_elixir',
  },
  {
    id: 'con_rage',
    name: 'Berserkr Draught',
    description: 'The bear-shirt’s secret: +25% power for 20s. Do not operate a longship afterward.',
    kind: 'consumable', tier: 3,
    effect: { type: 'buff_power', mult: 1.25, durationSec: 20 },
    sellPrice: 35,
  },
  {
    id: 'con_ward',
    name: 'Vǫrðr Candle',
    description: 'Burns with a pale, watchful flame. +20 armor for 60s.',
    kind: 'consumable', tier: 2,
    effect: { type: 'buff_defense', armor: 20, durationSec: 60 },
    sellPrice: 22,
  },
  {
    id: 'con_rations',
    name: 'Travel Rations',
    description: 'Hard bread, harder cheese. Restores 3 health/s for 20s.',
    kind: 'consumable', tier: 1,
    effect: { type: 'regen', hpPerSec: 3, durationSec: 20 },
    sellPrice: 6,
  },
];

// ---------------------------------------------------------------------------
// Master item index
// ---------------------------------------------------------------------------

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  [...WEAPONS, ...SHIELDS, ...BOWS, ...RUNES, ...ARMORS, ...MATERIALS, ...CONSUMABLES].map(
    (d) => [d.id, d],
  ),
) as Record<string, ItemDef>;

// ---------------------------------------------------------------------------
// Crafting recipes (15)
// ---------------------------------------------------------------------------

export type CraftStation = 'forge' | 'alchemy' | 'none';

export interface Recipe {
  id: string;
  result: { itemId: string; qty: number };
  requires: { itemId: string; qty: number }[];
  station: CraftStation;
  /** Minimum character level to craft. */
  minLevel: number;
}

export const RECIPES: Record<string, Recipe> = {
  rcp_steel: {
    id: 'rcp_steel', result: { itemId: 'mat_steel', qty: 1 },
    requires: [{ itemId: 'mat_iron', qty: 2 }, { itemId: 'mat_ash', qty: 1 }],
    station: 'forge', minLevel: 3,
  },
  rcp_sword_dvergr: {
    id: 'rcp_sword_dvergr', result: { itemId: 'wpn_sword_dvergr', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 6 }, { itemId: 'mat_wood', qty: 3 }, { itemId: 'mat_crystal', qty: 1 }],
    station: 'forge', minLevel: 6,
  },
  rcp_axe_jotun: {
    id: 'rcp_axe_jotun', result: { itemId: 'wpn_axe_jotun', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 8 }, { itemId: 'mat_hide', qty: 4 }, { itemId: 'mat_crystal', qty: 2 }],
    station: 'forge', minLevel: 12,
  },
  rcp_sword_gramr: {
    id: 'rcp_sword_gramr', result: { itemId: 'wpn_sword_gramr', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 10 }, { itemId: 'mat_gold', qty: 4 }, { itemId: 'mat_essence', qty: 2 }, { itemId: 'mat_crystal', qty: 1 }],
    station: 'forge', minLevel: 18,
  },
  rcp_hammer_thrym: {
    id: 'rcp_hammer_thrym', result: { itemId: 'wpn_hammer_thrym', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 14 }, { itemId: 'mat_gold', qty: 6 }, { itemId: 'mat_ember', qty: 4 }, { itemId: 'mat_essence', qty: 2 }],
    station: 'forge', minLevel: 26,
  },
  rcp_shield_dvergr: {
    id: 'rcp_shield_dvergr', result: { itemId: 'shd_dvergr', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 6 }, { itemId: 'mat_wood', qty: 4 }, { itemId: 'mat_bone', qty: 2 }],
    station: 'forge', minLevel: 10,
  },
  rcp_bow_ash: {
    id: 'rcp_bow_ash', result: { itemId: 'bow_ash', qty: 1 },
    requires: [{ itemId: 'mat_wood', qty: 5 }, { itemId: 'mat_pelt', qty: 3 }, { itemId: 'mat_bone', qty: 2 }],
    station: 'none', minLevel: 5,
  },
  rcp_bow_ydalir: {
    id: 'rcp_bow_ydalir', result: { itemId: 'bow_ydalir', qty: 1 },
    requires: [{ itemId: 'mat_wood', qty: 8 }, { itemId: 'mat_gold', qty: 4 }, { itemId: 'mat_essence', qty: 3 }, { itemId: 'mat_sap', qty: 2 }],
    station: 'none', minLevel: 20,
  },
  rcp_dvergr_plate: {
    id: 'rcp_dvergr_plate', result: { itemId: 'arm_dvergr_plate', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 10 }, { itemId: 'mat_hide', qty: 4 }],
    station: 'forge', minLevel: 14,
  },
  rcp_helm_valkyr: {
    id: 'rcp_helm_valkyr', result: { itemId: 'arm_valkyr_helm', qty: 1 },
    requires: [{ itemId: 'mat_steel', qty: 8 }, { itemId: 'mat_gold', qty: 4 }, { itemId: 'mat_essence', qty: 4 }],
    station: 'forge', minLevel: 28,
  },
  rcp_amu_yggr: {
    id: 'rcp_amu_yggr', result: { itemId: 'amu_yggr', qty: 1 },
    requires: [{ itemId: 'mat_crystal', qty: 3 }, { itemId: 'mat_essence', qty: 2 }, { itemId: 'mat_gold', qty: 2 }],
    station: 'alchemy', minLevel: 15,
  },
  rcp_mead_s: {
    id: 'rcp_mead_s', result: { itemId: 'con_mead_s', qty: 2 },
    requires: [{ itemId: 'mat_herb', qty: 2 }, { itemId: 'mat_sap', qty: 1 }],
    station: 'alchemy', minLevel: 1,
  },
  rcp_tonic: {
    id: 'rcp_tonic', result: { itemId: 'con_tonic', qty: 2 },
    requires: [{ itemId: 'mat_herb', qty: 2 }, { itemId: 'mat_rime', qty: 1 }],
    station: 'alchemy', minLevel: 8,
  },
  rcp_elixir: {
    id: 'rcp_elixir', result: { itemId: 'con_elixir', qty: 2 },
    requires: [{ itemId: 'mat_essence', qty: 1 }, { itemId: 'mat_sap', qty: 1 }],
    station: 'alchemy', minLevel: 10,
  },
  rcp_rune_eldr_bolt: {
    id: 'rcp_rune_eldr_bolt', result: { itemId: 'rune_eldr_bolt', qty: 1 },
    requires: [{ itemId: 'mat_ember', qty: 2 }, { itemId: 'mat_crystal', qty: 1 }],
    station: 'alchemy', minLevel: 4,
  },
  rcp_rune_iss_shard: {
    id: 'rcp_rune_iss_shard', result: { itemId: 'rune_iss_shard', qty: 1 },
    requires: [{ itemId: 'mat_rime', qty: 2 }, { itemId: 'mat_crystal', qty: 1 }],
    station: 'alchemy', minLevel: 4,
  },
};

// ---------------------------------------------------------------------------
// Equipment upgrade costs (blacksmith, +1..+5)
// Each level: gold = GOLD_BASE * tier * nextLevel; steel = nextLevel;
// +1 crystal per level from +3 upward. Stat gain: +8% base stats per level.
// ---------------------------------------------------------------------------

export const UPGRADE_STAT_MULT_PER_LEVEL = 0.08;
export const UPGRADE_GOLD_BASE = 25;
export const UPGRADE_STEEL_PER_LEVEL = 1;
export const UPGRADE_CRYSTAL_FROM_LEVEL = 3;

export function upgradeCost(tier: number, nextLevel: number): { itemId: string; qty: number }[] {
  const out: { itemId: string; qty: number }[] = [
    { itemId: 'mat_steel', qty: nextLevel * UPGRADE_STEEL_PER_LEVEL },
  ];
  if (nextLevel >= UPGRADE_CRYSTAL_FROM_LEVEL) out.push({ itemId: 'mat_crystal', qty: 1 });
  return out;
}

export function upgradeGold(tier: number, nextLevel: number): number {
  return UPGRADE_GOLD_BASE * tier * nextLevel;
}

// ---------------------------------------------------------------------------
// Loot tables (per enemy class; boss table used by all realm/world bosses)
// chance is independent per entry; qty is inclusive [min,max].
// ---------------------------------------------------------------------------

export interface LootEntry {
  itemId: string;
  chance: number;
  qtyMin: number;
  qtyMax: number;
}

export type LootTableId =
  | 'loot_draugr'
  | 'loot_vargr'
  | 'loot_troll'
  | 'loot_dokkalf'
  | 'loot_valkyrja'
  | 'loot_giant'
  | 'loot_boss';

export const LOOT_TABLES: Record<LootTableId, LootEntry[]> = {
  loot_draugr: [
    { itemId: 'mat_ash', chance: 0.6, qtyMin: 1, qtyMax: 2 },
    { itemId: 'mat_bone', chance: 0.35, qtyMin: 1, qtyMax: 1 },
    { itemId: 'mat_gold', chance: 0.08, qtyMin: 1, qtyMax: 1 },
    { itemId: 'con_mead_s', chance: 0.08, qtyMin: 1, qtyMax: 1 },
  ],
  loot_vargr: [
    { itemId: 'mat_pelt', chance: 0.7, qtyMin: 1, qtyMax: 2 },
    { itemId: 'mat_bone', chance: 0.3, qtyMin: 1, qtyMax: 1 },
  ],
  loot_troll: [
    { itemId: 'mat_hide', chance: 0.65, qtyMin: 1, qtyMax: 2 },
    { itemId: 'mat_stone', chance: 0.4, qtyMin: 2, qtyMax: 3 },
    { itemId: 'con_tonic', chance: 0.1, qtyMin: 1, qtyMax: 1 },
  ],
  loot_dokkalf: [
    { itemId: 'mat_essence', chance: 0.45, qtyMin: 1, qtyMax: 1 },
    { itemId: 'mat_crystal', chance: 0.25, qtyMin: 1, qtyMax: 1 },
    { itemId: 'con_elixir', chance: 0.08, qtyMin: 1, qtyMax: 1 },
  ],
  loot_valkyrja: [
    { itemId: 'mat_essence', chance: 0.6, qtyMin: 1, qtyMax: 2 },
    { itemId: 'mat_gold', chance: 0.2, qtyMin: 1, qtyMax: 1 },
    { itemId: 'con_mead_l', chance: 0.1, qtyMin: 1, qtyMax: 1 },
  ],
  loot_giant: [
    { itemId: 'mat_rime', chance: 0.5, qtyMin: 1, qtyMax: 2 },
    { itemId: 'mat_ember', chance: 0.5, qtyMin: 1, qtyMax: 2 },
    { itemId: 'mat_hide', chance: 0.3, qtyMin: 1, qtyMax: 1 },
    { itemId: 'mat_gold', chance: 0.15, qtyMin: 1, qtyMax: 2 },
  ],
  loot_boss: [
    { itemId: 'mat_gold', chance: 1.0, qtyMin: 3, qtyMax: 6 },
    { itemId: 'mat_essence', chance: 0.8, qtyMin: 2, qtyMax: 4 },
    { itemId: 'mat_crystal', chance: 0.5, qtyMin: 1, qtyMax: 3 },
    { itemId: 'con_mead_l', chance: 0.5, qtyMin: 1, qtyMax: 2 },
  ],
};
