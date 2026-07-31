// ============================================================================
// api/game/combat.ts — attack-claim validation + authoritative damage.
// Mirrors the client pipeline (gdd.md §5) with server-side sanity:
//   - range    (+ATTACK_RANGE_TOLERANCE_M grace, origin vs tracked position)
//   - cooldown (-ATTACK_COOLDOWN_SLACK_MS slack, per weapon attackSpeed etc.)
//   - plausibility (item exists, matches attackKind, is equipped/inscribed)
// PvE enemy identity is recovered from targetId (enemy def ids are stable
// contract strings; local entity ids embed them). XP uses enemies.ts values,
// scaled by the player's realm tier for base enemies, flat for bosses.
// ============================================================================

import type { AttackKind, DamageSchool, RealmId, Vec3 } from "@contracts/types";
import type { AttackClaimMsg, InventorySnapshot, ProgressionSnapshot } from "@contracts/netcode";
import { ATTACK_COOLDOWN_SLACK_MS, ATTACK_RANGE_TOLERANCE_M, MAX_STEP_PER_INPUT_M } from "@contracts/netcode";
import type { BowDef, RuneDef, WeaponDef } from "@contracts/items";
import { ITEMS } from "@contracts/items";
import type { EnemyDef } from "@contracts/enemies";
import { ALL_ENEMIES, TIER_XP_MULT, scaleByTier } from "@contracts/enemies";
import { realmTier } from "@contracts/realms";
import { computeArmor, computeOffense, computeXpMult, mitigate, upgradeMult } from "./character";

/** Heavy attacks add +0.25s recovery on top of the swing cooldown (gdd §5.2). */
const HEAVY_RECOVERY_MS = 250;
/** kindMult: light 1.0 / heavy 1.8 (gdd §5). */
const HEAVY_KIND_MULT = 1.8;
/** Bow chargeMult = 0.4 + 0.6 * charge (gdd §5). */
const BOW_CHARGE_BASE = 0.4;
const BOW_CHARGE_SPAN = 0.6;

export interface PlayerTargetInfo {
  pos: Vec3;
  realm: RealmId;
  armor: number;
}

export interface AttackContext {
  now: number;
  playerPos: Vec3;
  realm: RealmId;
  inventory: InventorySnapshot;
  progression: ProgressionSnapshot;
  /** Per-item last-accepted-attack timestamps (session state). */
  lastAttackAt: Map<string, number>;
  /** Resolve an online player target (same-shard PvP); null when not a player. */
  resolvePlayerTarget: (targetId: string) => PlayerTargetInfo | null;
}

export type AttackTargetKind = "player" | "enemy" | "none";

export interface AttackOutcome {
  accepted: boolean;
  /** 'range' | 'cooldown' | 'implausible' | 'no_target' */
  reason?: string;
  amount?: number;
  school?: DamageSchool;
  targetKind?: AttackTargetKind;
  /** Enemy def when the target resolved to a known enemy. */
  enemy?: EnemyDef;
  xpAwarded?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Longest enemy-def id contained in the client's targetId (exact match wins). */
export function enemyFromTargetId(targetId: string): EnemyDef | null {
  if (Object.prototype.hasOwnProperty.call(ALL_ENEMIES, targetId)) return ALL_ENEMIES[targetId];
  let best: EnemyDef | null = null;
  for (const [id, def] of Object.entries(ALL_ENEMIES)) {
    if (targetId.includes(id) && (!best || id.length > best.id.length)) best = def;
  }
  return best;
}

/** Effective engagement range of a rune from its effect shape (contracts). */
function runeRangeM(def: RuneDef): number {
  const fx = def.effect;
  switch (fx.type) {
    case "projectile":
      return fx.speed * 2; // ~2s flight time
    case "cone":
      return fx.range;
    case "nova":
      return fx.radius;
    case "ground_field":
      return fx.radius;
    case "chain":
      return fx.jumpRange * fx.jumps;
    default:
      return 0; // self_buff / heal_over_time / summon / ward — self-targeted
  }
}

function weaponRangeM(def: WeaponDef | BowDef | RuneDef): number {
  if (def.kind === "rune") return runeRangeM(def);
  return def.range;
}

/** Minimum ms between accepted uses of this item for the given attack kind. */
function cooldownMs(def: WeaponDef | BowDef | RuneDef, kind: AttackKind, attackSpeedMult: number, cooldownMult: number): number {
  if (def.kind === "weapon") {
    const base = 1000 / (def.attackSpeed * Math.max(0.1, attackSpeedMult));
    return kind === "heavy" ? base + HEAVY_RECOVERY_MS : base;
  }
  if (def.kind === "bow") return def.drawTime * 1000;
  return def.cooldownSec * 1000 * Math.max(0.1, cooldownMult);
}

// ---------------------------------------------------------------------------
// Validation + damage
// ---------------------------------------------------------------------------

export function validateAttack(claim: AttackClaimMsg, ctx: AttackContext): AttackOutcome {
  // --- structural plausibility ---------------------------------------------
  if (
    !finite(claim.origin?.x) ||
    !finite(claim.origin?.y) ||
    !finite(claim.origin?.z) ||
    !finite(claim.dir?.x) ||
    !finite(claim.dir?.y) ||
    !finite(claim.dir?.z)
  ) {
    return { accepted: false, reason: "implausible" };
  }
  const charge = claim.charge === undefined ? 1 : claim.charge;
  if (!finite(charge) || charge < 0 || charge > 1) return { accepted: false, reason: "implausible" };

  const def = ITEMS[claim.itemId];
  if (!def) return { accepted: false, reason: "implausible" };
  const kindMatches =
    ((claim.attackKind === "light" || claim.attackKind === "heavy") && def.kind === "weapon") ||
    (claim.attackKind === "bow" && def.kind === "bow") ||
    (claim.attackKind === "rune" && def.kind === "rune");
  if (!kindMatches) return { accepted: false, reason: "implausible" };

  // The item must actually be in hand (weapon/bow) or inscribed (rune).
  let equippedInstance = null as null | { upgradeLevel: number };
  if (def.kind === "weapon" || def.kind === "bow") {
    const eq = ctx.inventory.equipment.weapon;
    if (!eq || eq.itemId !== def.id) return { accepted: false, reason: "implausible" };
    equippedInstance = eq;
  } else if (def.kind === "rune") {
    if (!ctx.inventory.runeLoadout.includes(def.id)) return { accepted: false, reason: "implausible" };
    equippedInstance = { upgradeLevel: 0 };
  }

  const kindStat = claim.attackKind === "rune" ? "spellDamage" : claim.attackKind === "bow" ? "rangedDamage" : "meleeDamage";
  const offense = computeOffense(ctx.progression, kindStat);

  // --- cooldown (-slack) ----------------------------------------------------
  const interval = cooldownMs(def, claim.attackKind, offense.attackSpeed, offense.cooldown);
  const lastAt = ctx.lastAttackAt.get(def.id) ?? -Infinity;
  if (ctx.now - lastAt < interval - ATTACK_COOLDOWN_SLACK_MS) {
    return { accepted: false, reason: "cooldown" };
  }

  // --- origin range vs tracked position -------------------------------------
  if (dist(claim.origin, ctx.playerPos) > MAX_STEP_PER_INPUT_M + ATTACK_RANGE_TOLERANCE_M) {
    return { accepted: false, reason: "range" };
  }

  // --- target resolution ------------------------------------------------------
  let targetKind: AttackTargetKind = "none";
  let enemy: EnemyDef | null = null;
  let targetArmor = 0;
  let playerTarget: PlayerTargetInfo | null = null;

  if (claim.targetId) {
    playerTarget = ctx.resolvePlayerTarget(claim.targetId);
    if (playerTarget) {
      if (playerTarget.realm !== ctx.realm) return { accepted: false, reason: "no_target" };
      const range = weaponRangeM(def) + ATTACK_RANGE_TOLERANCE_M;
      if (range > 0 && dist(claim.origin, playerTarget.pos) > range) {
        return { accepted: false, reason: "range" };
      }
      targetKind = "player";
      targetArmor = playerTarget.armor;
    } else {
      enemy = enemyFromTargetId(claim.targetId);
      targetKind = enemy ? "enemy" : "none";
      targetArmor = enemy?.armor ?? 0;
    }
  }

  // --- authoritative damage (gdd §5 pipeline) --------------------------------
  const kindMult = claim.attackKind === "heavy" ? HEAVY_KIND_MULT : 1;
  const chargeMult = def.kind === "bow" ? BOW_CHARGE_BASE + BOW_CHARGE_SPAN * charge : 1;
  const upMult = upgradeMult(equippedInstance?.upgradeLevel ?? 0);
  const raw = def.damage * upMult * offense.power * kindMult * chargeMult;

  let critChance = offense.critChance;
  if (def.kind === "bow") critChance += def.critBonus * charge; // additive at full draw
  const isCrit = Math.random() < critChance;
  const critMult = isCrit ? offense.critMultiplier : 1;
  const variance = 0.92 + Math.random() * 0.16;

  const amount = Math.max(0, Math.round(mitigate(raw, targetArmor) * variance * critMult));
  const school: DamageSchool = def.kind === "rune" ? def.damageSchool : "physical";

  // --- xp (enemies.ts; realm-tier scaled for base enemies, flat for bosses) --
  let xpAwarded = 0;
  if (enemy) {
    const base =
      enemy.enemyClass === "boss"
        ? enemy.baseStats.xp
        : scaleByTier(enemy.baseStats.xp, TIER_XP_MULT, realmTier(ctx.realm));
    xpAwarded = Math.round(base * computeXpMult(ctx.progression, ctx.inventory));
  }

  ctx.lastAttackAt.set(def.id, ctx.now);
  return { accepted: true, amount, school, targetKind, enemy: enemy ?? undefined, xpAwarded };
}

/** Re-export for the gateway (PvP victim mitigation). */
export { computeArmor };
