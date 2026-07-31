// ============================================================================
// CORESAPIAN — src/game/engine/player.ts (ENGINE-OWNED)
// The `player` service (src/game/services.ts — frozen seam). Position/look
// getters, teleport, heal, shake, and the FULL incoming-damage pipeline of
// gdd.md §5: armor mitigation curve, variance, shield block (front 120°,
// stamina cost 15 × stability, guard break), parry window (180ms + 40ms per
// sk_war_parry rank, costs 10 stamina), realm-ability resists (after block),
// Hel's Bargain cheat-death, and dodge i-frames.
//
// combat-ai calls damage() to route enemy hits into the local player and
// setBlockState() from its block handling. It reaches the extra methods via
// a structural cast on services.get('player') — cross-agent imports of this
// file are forbidden (gdd §1), the names below are the runtime contract.
// ============================================================================

import { Vector3 } from 'three';
import type { Group } from 'three';

import { ITEMS, UPGRADE_STAT_MULT_PER_LEVEL } from '../../../contracts/items';
import { REALM_ABILITIES, SKILL_NODES } from '../../../contracts/skills';
import { EQUIP_SLOTS } from '../../../contracts/types';
import type { DamageSchool, Vec3 } from '../../../contracts/types';
import type { GameEventBus } from '../events';
import type { PlayerService } from '../services';
import type { UseGameStore } from '../store';
import type { CameraRig } from './cameraRig';
import type { EngineInput } from './input';
import type { PlayerPhysics } from './physics';

// --- gdd.md §5 numbers -------------------------------------------------------
/** Parry: block raised ≤180ms before impact. */
const BASE_PARRY_WINDOW_S = 0.18;
/** gdd §5: sk_war_parry adds +40ms window per rank (contract description). */
const PARRY_WINDOW_PER_RANK_S = 0.04;
/** Parry costs 10 stamina. */
const PARRY_STAMINA_COST = 10;
/** Blocked hit stamina cost = 15 × shield.stability. */
const BLOCK_STAMINA_BASE = 15;
/** Insufficient stamina on a blocked hit → full damage + 1.0s self-stagger. */
const GUARD_BREAK_STAGGER_S = 1.0;
/** Block only applies within the front 120° (cos(60°)). */
const BLOCK_FRONT_COS = 0.5;
/** Engine safety cap so stacked block reduction can't reach invulnerability. */
const MAX_BLOCK_REDUCTION = 0.95;
/** Armor curve: mitigated = raw × 100 / (100 + armor × 2.5). */
const ARMOR_CURVE_BASE = 100;
const ARMOR_CURVE_SCALE = 2.5;
/** Variance: 0.92 + rand × 0.16. */
const VARIANCE_MIN = 0.92;
const VARIANCE_SPAN = 0.16;

/** Extra opts combat-ai may pass (structural superset of the frozen seam). */
export interface PlayerDamageOpts {
  sourceId?: string;
  school?: DamageSchool;
  /** Attacker world position — enables the front-120° block check. */
  sourcePos?: Vec3;
  /** Attacker armor penetration 0..1 (gdd §5 pipeline). */
  armorPen?: number;
}

/** combat-ai → engine block state (deliverable §6). */
export interface BlockState {
  blocking: boolean;
  /** Sim-time seconds when the block was raised (parry window reference). */
  blockRaisedAt: number;
}

export interface EnginePlayerDeps {
  store: UseGameStore;
  events: GameEventBus;
  input: EngineInput;
  physics: PlayerPhysics;
  rig: CameraRig;
  /** Shared sim clock stamped by the engine core each fixed step. */
  clock: { now: number };
}

export class EnginePlayerService implements PlayerService {
  private readonly store: UseGameStore;
  private readonly events: GameEventBus;
  private readonly input: EngineInput;
  private readonly physics: PlayerPhysics;
  private readonly rig: CameraRig;
  private readonly clock: { now: number };

  private block: BlockState = { blocking: false, blockRaisedAt: -Infinity };
  private lastCheatDeathAt = -Infinity;

  /** Wired by the core: taking real damage cancels interact channels. */
  onDamaged: (() => void) | null = null;

  /** Shared channel-state object owned by the interact system. */
  channel: { active: boolean; progress: number } = { active: false, progress: 0 };

  constructor(deps: EnginePlayerDeps) {
    this.store = deps.store;
    this.events = deps.events;
    this.input = deps.input;
    this.physics = deps.physics;
    this.rig = deps.rig;
    this.clock = deps.clock;
  }

  // ------------------------------------------------------------ PlayerService

  getPosition(out?: Vector3): Vector3 {
    return this.physics.getPosition(out);
  }

  getYaw(): number {
    return this.input.getYaw();
  }

  getPitch(): number {
    return this.input.getPitch();
  }

  isGrounded(): boolean {
    return this.physics.isGrounded();
  }

  teleport(pos: Vec3, yaw?: number): void {
    this.physics.teleport(pos);
    if (yaw !== undefined) this.input.setLook(yaw);
  }

  heal(amount: number): void {
    if (amount <= 0) return;
    const s = this.store.getState();
    if (s.dead) return;
    const v = s.vitals;
    if (v.hp >= v.maxHp) return;
    s.setVitals({ hp: Math.min(v.maxHp, v.hp + amount) });
  }

  shake(intensity: number, durationMs: number): void {
    this.events.emit('screen_shake', { intensity, durationMs });
  }

  // --------------------------------------------------- combat-ai ↔ engine seam

  /**
   * combat-ai drives block state from its shield handling. `blockRaisedAt`
   * is expected in engine sim-clock seconds (ctx.time.now); implausible
   * values are re-stamped so the parry window can't break cross-clock.
   */
  setBlockState(state: { blocking: boolean; blockRaisedAt?: number }): void {
    if (state.blocking && !this.block.blocking) {
      const t = state.blockRaisedAt;
      const plausible = typeof t === 'number' && Number.isFinite(t) && Math.abs(this.clock.now - t) <= 5;
      this.block = { blocking: true, blockRaisedAt: plausible ? (t as number) : this.clock.now };
    } else if (!state.blocking) {
      this.block = { blocking: false, blockRaisedAt: -Infinity };
    }
  }

  isBlocking(): boolean {
    return this.block.blocking && this.getShield() !== null;
  }

  isSprinting(): boolean {
    return this.physics.isSprinting();
  }

  /** True while dodge-roll i-frames are up (gdd §4: 300ms). */
  isDodging(): boolean {
    return this.physics.isDodging();
  }

  isStaggered(): boolean {
    return this.physics.isStaggered();
  }

  /** Mount point combat-ai populates with weapon/shield/bow viewmodels. */
  getViewmodelRoot(): Group {
    return this.rig.getViewmodelRoot();
  }

  // -------------------------------------------------------- damage pipeline

  /**
   * Full gdd §5 mitigation for damage INTO the local player:
   * armor curve → variance → parry/block → resists → cheat-death.
   */
  damage(amount: number, opts?: PlayerDamageOpts): void {
    if (amount <= 0) return;
    const s = this.store.getState();
    if (s.dead) return;
    const now = this.clock.now;

    // Dodge roll i-frames (gdd §4: 300ms).
    if (this.physics.isInIFrames()) {
      this.events.emit('player_hurt', { amount: 0, blocked: false, parried: false });
      return;
    }

    // --- armor mitigation (equipment armor + Járnskin ranks, upgrade mult) ---
    let armor = 0;
    for (const slot of EQUIP_SLOTS) {
      const item = s.equipment[slot];
      if (!item) continue;
      const def = ITEMS[item.itemId];
      if (!def || (def.kind !== 'armor' && def.kind !== 'shield')) continue;
      armor += def.armor * (1 + item.upgradeLevel * UPGRADE_STAT_MULT_PER_LEVEL);
    }
    armor += this.skillBonus('armor');
    const effectiveArmor = Math.max(0, armor * (1 - (opts?.armorPen ?? 0)));
    let dmg = amount * (ARMOR_CURVE_BASE / (ARMOR_CURVE_BASE + effectiveArmor * ARMOR_CURVE_SCALE));

    // --- variance ---
    dmg *= VARIANCE_MIN + Math.random() * VARIANCE_SPAN;

    // --- parry / block (shield required, attacker within front 120°) ---
    let blocked = false;
    let parried = false;
    const shield = this.getShield();
    if (this.block.blocking && shield && this.attackerInFront(opts?.sourcePos)) {
      const parryWindow =
        BASE_PARRY_WINDOW_S +
        PARRY_WINDOW_PER_RANK_S * (this.store.getState().skills['sk_war_parry'] ?? 0);
      if (now - this.block.blockRaisedAt <= parryWindow) {
        // Parry: 0 damage, 10 stamina. Attacker stagger + defender riposte
        // are applied by combat-ai listening to player_hurt (gdd §5).
        parried = true;
        dmg = 0;
        this.spendStaminaFlat(PARRY_STAMINA_COST);
      } else {
        const cost = BLOCK_STAMINA_BASE * shield.stability;
        const stamina = this.store.getState().vitals.stamina;
        if (stamina >= cost) {
          blocked = true;
          const reduction = Math.min(
            MAX_BLOCK_REDUCTION,
            shield.blockReduction + this.skillBonus('blockReduction'),
          );
          dmg *= 1 - reduction;
          this.spendStaminaFlat(cost);
        } else {
          // Guard break: full damage + 1.0s self-stagger; stamina bottoms out.
          this.spendStaminaFlat(stamina);
          this.physics.stagger(GUARD_BREAK_STAGGER_S);
        }
      }
    }

    // --- resists apply after block (gdd §5): realm abilities only ---
    if (opts?.school) {
      for (const id of this.store.getState().realmAbilities) {
        const ability = REALM_ABILITIES[id];
        if (!ability) continue;
        const effect = ability.effect;
        if (effect.type === 'passive_resist' && effect.school === opts.school) {
          dmg *= 1 - effect.amount;
        }
      }
    }

    // --- apply, with Hel's Bargain cheat-death (600s cooldown) ---
    const vitals = this.store.getState().vitals;
    let hp = vitals.hp - dmg;
    if (hp <= 0) {
      const bargain = REALM_ABILITIES['ra_helheim'];
      const cooldown = bargain.effect.type === 'passive_cheat_death' ? bargain.effect.cooldownSec : 0;
      if (
        this.store.getState().realmAbilities.includes('ra_helheim') &&
        now - this.lastCheatDeathAt >= cooldown
      ) {
        this.lastCheatDeathAt = now;
        hp = 1;
        dmg = Math.max(0, vitals.hp - 1);
      }
    }
    hp = Math.max(0, hp);
    this.store.getState().setVitals({ hp });

    if (dmg > 0) this.onDamaged?.(); // damage cancels interact channels

    this.events.emit('player_hurt', { amount: dmg, blocked, parried });

    // Engine owns the death edge to avoid a race (deliverable §6 / addendum §5
    // handshake: combat-ai may also watch hp, whoever sees it first wins).
    if (hp <= 0 && !this.store.getState().dead) {
      this.store.getState().setDead(true);
      this.events.emit('player_died', { sourceId: opts?.sourceId ?? 'unknown' });
    }
  }

  // ------------------------------------------------------------------ helpers

  private getShield() {
    const item = this.store.getState().equipment.shield;
    if (!item) return null;
    const def = ITEMS[item.itemId];
    return def && def.kind === 'shield' ? def : null;
  }

  /** Sum of additive skill effects for a stat (contract-driven, no dupes). */
  private skillBonus(stat: 'armor' | 'blockReduction'): number {
    const skills = this.store.getState().skills;
    let bonus = 0;
    for (const [nodeId, rank] of Object.entries(skills)) {
      if (rank <= 0) continue;
      const node = SKILL_NODES[nodeId];
      if (!node) continue;
      for (const effect of node.effects) {
        if (effect.stat === stat && effect.op === 'add') bonus += effect.perRank * rank;
      }
    }
    return bonus;
  }

  private attackerInFront(sourcePos?: Vec3): boolean {
    if (!sourcePos) return true; // no direction info — treat as frontal
    const feet = this.physics.getPosition();
    const dx = sourcePos.x - feet.x;
    const dz = sourcePos.z - feet.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const yaw = this.input.getYaw();
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    return (fwdX * dx + fwdZ * dz) / len >= BLOCK_FRONT_COS;
  }

  /** Flat stamina spend that ignores the regen-delay bookkeeping of physics
   *  (block/parry costs are combat spends; physics' store diff picks them up
   *  as "last spend" for regen delay on the next fixed step). */
  private spendStaminaFlat(amount: number): void {
    if (amount <= 0) return;
    const s = this.store.getState();
    s.setVitals({ stamina: Math.max(0, s.vitals.stamina - amount) });
  }
}
