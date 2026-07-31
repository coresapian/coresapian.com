// ============================================================================
// CORESAPIAN — src/game/combat/stats.ts (combat-ai)
//
// Pure combat math: skill aggregation from the store's skills slice and the
// gdd.md §5 damage pipeline. No three, no store imports — fully testable.
//
//   rawDamage   = sourceDamage × upgradeMult × powerMults × kindMult × chargeMult
//   mitigated   = rawDamage × (100 / (100 + effectiveArmor × 2.5))
//   effectiveArmor = max(0, targetArmor × (1 − attackerArmorPen))
//   final       = mitigated × variance × critMult
//   variance    = 0.92 + rand × 0.16
// ============================================================================

import { UPGRADE_STAT_MULT_PER_LEVEL } from '../../../contracts/items';
import type { RuneSchool } from '../../../contracts/items';
import { SKILL_NODES } from '../../../contracts/skills';
import type { StatKey } from '../../../contracts/skills';
import { BASE_STATS } from '../../../contracts/types';

// ---------------------------------------------------------------------------
// gdd §5 tuning constants (values live in the GDD; no contract file exports
// them, so they are named here exactly once).
// ---------------------------------------------------------------------------

export const LIGHT_KIND_MULT = 1.0;
export const HEAVY_KIND_MULT = 1.8;
export const HEAVY_RECOVERY_EXTRA_SEC = 0.25;
export const BOW_CHARGE_MIN_MULT = 0.4; // chargeMult = 0.4 + 0.6 × charge
export const BOW_CHARGE_SPAN = 0.6;
export const VARIANCE_FLOOR = 0.92;
export const VARIANCE_SPAN = 0.16;
export const ARMOR_CURVE_DIVISOR = 100;
export const ARMOR_CURVE_FACTOR = 2.5;
export const RIPOSTE_MULT = 1.5; // +50% next hit within 1.5s of a parry
export const RIPOSTE_WINDOW_SEC = 1.5;
export const HEAVY_ATTACK_STAMINA_MULT = 1.8;
export const BOW_DRAW_STAMINA_PER_SEC = 5;
export const DODGE_STAMINA_COST = 20;
export const CONSUMABLE_SHARED_COOLDOWN_SEC = 1.0;
export const SEI_ECHO_CHANCE_PER_RANK = 0.07;

// ---------------------------------------------------------------------------
// Skill aggregation
// ---------------------------------------------------------------------------

export type SkillsMap = Record<string, number>;

function rank(skills: SkillsMap, id: string): number {
  return skills[id] ?? 0;
}

/**
 * Aggregate a StatKey over the player's purchased skill ranks.
 * add => sum(perRank × rank); mult => product(perRank^rank).
 */
export function aggregateStat(skills: SkillsMap, stat: StatKey): { add: number; mult: number } {
  let add = 0;
  let mult = 1;
  for (const [nodeId, r] of Object.entries(skills)) {
    if (!r) continue;
    const node = SKILL_NODES[nodeId];
    if (!node) continue;
    for (const fx of node.effects) {
      if (fx.stat !== stat) continue;
      if (fx.op === 'add') add += fx.perRank * r;
      else mult *= Math.pow(fx.perRank, r);
    }
  }
  return { add, mult };
}

/** Player attack-speed multiplier (skills only; base is 1 per BASE_STATS). */
export function attackSpeedMult(skills: SkillsMap): number {
  return aggregateStat(skills, 'attackSpeed').mult;
}

/** Player armor penetration (fraction 0..1) for melee hits. */
export function meleeArmorPen(skills: SkillsMap): number {
  return aggregateStat(skills, 'armorPen').add;
}

/** Bow armor penetration: sk_hun_precision only (+0.1/rank). */
export function rangedArmorPen(skills: SkillsMap): number {
  return rank(skills, 'sk_hun_precision') * 0.1;
}

/** Rune cooldown multiplier (sk_sei_galdr). */
export function runeCooldownMult(skills: SkillsMap): number {
  return aggregateStat(skills, 'cooldown').mult;
}

/** Stamina-cost multiplier on weapon swings (sk_war_whirlwind). */
export function staminaCostMult(skills: SkillsMap): number {
  return aggregateStat(skills, 'staminaCost').mult;
}

/** sk_sei_echo: chance to skip a rune cooldown entirely. */
export function echoSkipChance(skills: SkillsMap): number {
  return rank(skills, 'sk_sei_echo') * SEI_ECHO_CHANCE_PER_RANK;
}

/** Summon duration multiplier (sk_sei_spiritbond). */
export function summonDurationMult(skills: SkillsMap): number {
  return aggregateStat(skills, 'summonDuration').mult;
}

/** sk_hun_silent: enemy aggro-range multiplier vs this player. */
export function aggroRangeMult(skills: SkillsMap): number {
  return Math.pow(0.85, rank(skills, 'sk_hun_silent'));
}

/** sk_war_parry: extra parry window in ms (+40ms/rank per gdd §5). */
export function parryWindowBonusMs(skills: SkillsMap): number {
  return rank(skills, 'sk_war_parry') * 40;
}

/** sk_hun_ullr: first shot out of combat always crits (rank gate). */
export function hasUllrBlessing(skills: SkillsMap): boolean {
  return rank(skills, 'sk_hun_ullr') >= 1;
}

/** Whirlwind (sk_war_whirlwind): heavy attacks hit every foe in reach. */
export function hasWhirlwind(skills: SkillsMap): boolean {
  return rank(skills, 'sk_war_whirlwind') >= 1;
}

/** Damage multiplier the seidr school-adept nodes give one rune school. */
export function spellSchoolMult(skills: SkillsMap, school: RuneSchool): number {
  const nodeId =
    school === 'fire'
      ? 'sk_sei_eldr'
      : school === 'ice'
        ? 'sk_sei_iss'
        : school === 'storm'
          ? 'sk_sei_vedr'
          : 'sk_sei_andi';
  const node = SKILL_NODES[nodeId];
  if (!node) return 1;
  let mult = 1;
  const r = rank(skills, nodeId);
  for (const fx of node.effects) {
    if (fx.op === 'mult') mult *= Math.pow(fx.perRank, r);
  }
  return mult;
}

/** Melee power multiplier from warrior nodes, given current fight context. */
export function meleePowerMult(
  skills: SkillsMap,
  ctx: { playerHpFrac: number; targetHpFrac: number },
): number {
  let mult = aggregateStat(skills, 'meleeDamage').mult;
  // sk_war_heavy is folded into meleeDamage above (mult per rank).
  // sk_war_berserk: +12%/rank only below 30% hp — remove the unconditional
  // contribution and re-apply conditionally (its effect stat is meleeDamage).
  const berserkR = rank(skills, 'sk_war_berserk');
  if (berserkR > 0) {
    mult /= Math.pow(1.12, berserkR);
    if (ctx.playerHpFrac < 0.3) mult *= Math.pow(1.12, berserkR);
  }
  // sk_war_execute: +20%/rank only vs targets under 25% hp.
  const executeR = rank(skills, 'sk_war_execute');
  if (executeR > 0) {
    mult /= Math.pow(1.2, executeR);
    if (ctx.targetHpFrac < 0.25) mult *= Math.pow(1.2, executeR);
  }
  return mult;
}

/** Ranged power multiplier from hunter nodes, given shot context. */
export function rangedPowerMult(
  skills: SkillsMap,
  ctx: { distanceM: number; targetIsBeast: boolean },
): number {
  let mult = aggregateStat(skills, 'rangedDamage').mult;
  // sk_hun_longshot: +8%/rank only beyond 20m.
  const longshotR = rank(skills, 'sk_hun_longshot');
  if (longshotR > 0) {
    mult /= Math.pow(1.08, longshotR);
    if (ctx.distanceM > 20) mult *= Math.pow(1.08, longshotR);
  }
  // sk_hun_beastslayer: +10%/rank only vs beasts.
  const beastR = rank(skills, 'sk_hun_beastslayer');
  if (beastR > 0) {
    mult /= Math.pow(1.1, beastR);
    if (ctx.targetIsBeast) mult *= Math.pow(1.1, beastR);
  }
  return mult;
}

// ---------------------------------------------------------------------------
// Crit
// ---------------------------------------------------------------------------

export interface CritProfile {
  chance: number;
  mult: number;
}

/** Base crit from BASE_STATS + skill crit nodes + gear crit bonus. */
export function critProfile(
  skills: SkillsMap,
  opts?: { gearCritChance?: number; runeCast?: boolean; bowCharge?: number; bowCritBonus?: number },
): CritProfile {
  const agg = aggregateStat(skills, 'critChance');
  let chance = BASE_STATS.critChance + agg.add + (opts?.gearCritChance ?? 0);
  if (opts?.runeCast) chance += rank(skills, 'sk_sei_volva') * 0.06;
  if (opts?.bowCharge !== undefined && opts?.bowCritBonus) {
    chance += opts.bowCritBonus * opts.bowCharge; // full bonus only at full draw
  }
  const multAgg = aggregateStat(skills, 'critMultiplier');
  return { chance, mult: BASE_STATS.critMultiplier + multAgg.add };
}

// ---------------------------------------------------------------------------
// The §5 pipeline
// ---------------------------------------------------------------------------

export interface HitInput {
  /** Weapon/rune/bow base damage (contract value). */
  sourceDamage: number;
  /** ItemInstance.upgradeLevel (0..5). */
  upgradeLevel: number;
  /** light 1.0 / heavy 1.8 / bow & rune 1.0. */
  kindMult: number;
  /** Bow charge multiplier (0.4 + 0.6 × charge); 1 for non-bow. */
  chargeMult: number;
  /** All situational power multipliers folded in (skills, buffs, riposte). */
  powerMult: number;
  crit: CritProfile;
  /** 0..1 attacker armor penetration. */
  armorPen: number;
  /** Target armor (enemy def armor; 0 for unarmored). */
  targetArmor: number;
  /** Forces a crit (sk_hun_ullr first shot out of combat). */
  forceCrit?: boolean;
}

export interface HitResult {
  amount: number;
  isCrit: boolean;
}

/** Resolve one outgoing hit exactly per gdd.md §5. `rand` injectable for tests. */
export function resolveHit(input: HitInput, rand: () => number = Math.random): HitResult {
  const upgradeMult = 1 + input.upgradeLevel * UPGRADE_STAT_MULT_PER_LEVEL;
  const raw = input.sourceDamage * upgradeMult * input.powerMult * input.kindMult * input.chargeMult;
  const effectiveArmor = Math.max(0, input.targetArmor * (1 - input.armorPen));
  const mitigated = raw * (ARMOR_CURVE_DIVISOR / (ARMOR_CURVE_DIVISOR + effectiveArmor * ARMOR_CURVE_FACTOR));
  const isCrit = input.forceCrit === true || rand() < input.crit.chance;
  const variance = VARIANCE_FLOOR + rand() * VARIANCE_SPAN;
  const final = mitigated * variance * (isCrit ? input.crit.mult : 1);
  return { amount: Math.max(1, Math.round(final * 10) / 10), isCrit };
}

/** Incoming-side armor curve (used for buff-armor pre-filtering; gdd §5). */
export function armorCurveMultiplier(effectiveArmor: number): number {
  return ARMOR_CURVE_DIVISOR / (ARMOR_CURVE_DIVISOR + Math.max(0, effectiveArmor) * ARMOR_CURVE_FACTOR);
}

/** Bow charge multiplier (gdd §5: 0.4 + 0.6 × charge). */
export function bowChargeMult(charge: number): number {
  const c = charge < 0 ? 0 : charge > 1 ? 1 : charge;
  return BOW_CHARGE_MIN_MULT + BOW_CHARGE_SPAN * c;
}
