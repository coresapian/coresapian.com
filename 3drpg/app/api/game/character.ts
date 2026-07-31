// ============================================================================
// api/game/character.ts — server-side derived character stats.
// Mirrors the client combat math (gdd.md §5/§6) using ONLY contracts data so
// the server can validate claims and stay authoritative for xp/level/vitals.
// ============================================================================

import type { PlayerVitals } from "@contracts/types";
import { BASE_STATS, BASE_VITALS, VITALS_PER_LEVEL } from "@contracts/types";
import type { InventorySnapshot, ProgressionSnapshot } from "@contracts/netcode";
import { ITEMS, UPGRADE_STAT_MULT_PER_LEVEL } from "@contracts/items";
import { LEVEL_CAP, SKILL_NODES, SKILL_POINTS_PER_LEVEL, totalXpForLevel } from "@contracts/skills";
import type { StatKey } from "@contracts/skills";

// ---------------------------------------------------------------------------
// Skill aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate one stat across the character's skilled nodes.
 * op 'add'  => base += perRank * rank
 * op 'mult' => base *= perRank ^ rank   (adds apply first, then mults)
 * Unknown node ids and over-max ranks are clamped (defensive: client-sent
 * skill maps are never trusted blindly).
 */
export function statWithSkills(skills: Record<string, number>, stat: StatKey, base: number): number {
  let add = 0;
  let mult = 1;
  for (const [nodeId, rawRank] of Object.entries(skills)) {
    const node = SKILL_NODES[nodeId];
    if (!node) continue;
    const rank = Math.max(0, Math.min(node.maxRank, Math.floor(rawRank) || 0));
    if (rank === 0) continue;
    for (const fx of node.effects) {
      if (fx.stat !== stat) continue;
      if (fx.op === "add") add += fx.perRank * rank;
      else mult *= Math.pow(fx.perRank, rank);
    }
  }
  return (base + add) * mult;
}

/** Smith upgrade multiplier on an item's base stats (+8%/level). */
export function upgradeMult(upgradeLevel: number): number {
  return 1 + upgradeLevel * UPGRADE_STAT_MULT_PER_LEVEL;
}

// ---------------------------------------------------------------------------
// Vitals (server owns max values — store-api VitalsSlice)
// ---------------------------------------------------------------------------

/** Max vitals from level + skills + equipped armor bonuses. */
export function computeMaxVitals(
  progression: ProgressionSnapshot,
  inventory: InventorySnapshot,
): Pick<PlayerVitals, "maxHp" | "maxStamina" | "maxWyrd"> {
  const lvl = Math.max(1, progression.level);
  let hpBonus = 0;
  let staminaBonus = 0;
  let wyrdBonus = 0;
  for (const inst of Object.values(inventory.equipment)) {
    if (!inst) continue;
    const def = ITEMS[inst.itemId];
    if (!def || def.kind !== "armor" || !def.bonus) continue;
    hpBonus += def.bonus.maxHp ?? 0;
    staminaBonus += def.bonus.maxStamina ?? 0;
    wyrdBonus += def.bonus.maxWyrd ?? 0;
  }
  const skills = progression.skills;
  return {
    maxHp: Math.round(
      statWithSkills(skills, "maxHp", BASE_VITALS.maxHp + VITALS_PER_LEVEL.hp * (lvl - 1) + hpBonus),
    ),
    maxStamina: Math.round(
      statWithSkills(
        skills,
        "maxStamina",
        BASE_VITALS.maxStamina + VITALS_PER_LEVEL.stamina * (lvl - 1) + staminaBonus,
      ),
    ),
    maxWyrd: Math.round(
      statWithSkills(skills, "maxWyrd", BASE_VITALS.maxWyrd + VITALS_PER_LEVEL.wyrd * (lvl - 1) + wyrdBonus),
    ),
  };
}

/** Total armor from equipment (+ upgrades) and skills — used for PvP mitigation. */
export function computeArmor(progression: ProgressionSnapshot, inventory: InventorySnapshot): number {
  let armor = 0;
  for (const inst of Object.values(inventory.equipment)) {
    if (!inst) continue;
    const def = ITEMS[inst.itemId];
    if (!def) continue;
    if (def.kind === "armor") armor += def.armor * upgradeMult(inst.upgradeLevel);
    if (def.kind === "shield") armor += def.armor * upgradeMult(inst.upgradeLevel);
  }
  return statWithSkills(progression.skills, "armor", armor);
}

/** Global xp gain multiplier (gear xpGain + ra_asgard + skill adds). */
export function computeXpMult(progression: ProgressionSnapshot, inventory: InventorySnapshot): number {
  let add = statWithSkills(progression.skills, "xpGain", 0);
  for (const inst of Object.values(inventory.equipment)) {
    if (!inst) continue;
    const def = ITEMS[inst.itemId];
    if (def && def.kind === "armor" && def.bonus?.xpGain) add += def.bonus.xpGain;
  }
  let mult = 1 + add;
  if (progression.realmAbilities.includes("ra_asgard")) mult *= 1.15; // ra_asgard: passive_xp 1.15
  return mult;
}

// ---------------------------------------------------------------------------
// Offense
// ---------------------------------------------------------------------------

export interface OffenseStats {
  /** Global power multiplier for the given attack kind. */
  power: number;
  critChance: number;
  critMultiplier: number;
  /** Player attack-speed multiplier (weapon swings only). */
  attackSpeed: number;
  /** Rune cooldown multiplier (< 1 = faster). */
  cooldown: number;
}

export function computeOffense(progression: ProgressionSnapshot, kindStat: StatKey): OffenseStats {
  const skills = progression.skills;
  return {
    power: statWithSkills(skills, kindStat, 1),
    critChance: statWithSkills(skills, "critChance", BASE_STATS.critChance),
    critMultiplier: statWithSkills(skills, "critMultiplier", BASE_STATS.critMultiplier),
    attackSpeed: statWithSkills(skills, "attackSpeed", 1),
    cooldown: statWithSkills(skills, "cooldown", 1),
  };
}

// ---------------------------------------------------------------------------
// XP / leveling (contracts/skills.ts curve; xp is CUMULATIVE total)
// ---------------------------------------------------------------------------

export interface LevelUpResult {
  level: number;
  skillPointsGained: number;
  leveled: boolean;
}

/** Derive level from cumulative xp; returns new level and points gained. */
export function levelForXp(xp: number, currentLevel: number): LevelUpResult {
  let level = Math.max(1, currentLevel);
  while (level < LEVEL_CAP && xp >= totalXpForLevel(level + 1)) level++;
  const gained = Math.max(0, level - Math.max(1, currentLevel));
  return { level, skillPointsGained: gained * SKILL_POINTS_PER_LEVEL, leveled: gained > 0 };
}

// ---------------------------------------------------------------------------
// Damage pipeline (gdd.md §5, mirrored server-side for authoritative results)
// ---------------------------------------------------------------------------

/** damage = raw * (100 / (100 + armor * 2.5)) — armor already pen-adjusted by caller. */
export function mitigate(raw: number, effectiveArmor: number): number {
  const armor = Math.max(0, effectiveArmor);
  return raw * (100 / (100 + armor * 2.5));
}
