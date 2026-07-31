// ============================================================================
// CORESAPIAN — src/game/combat/incoming.ts (combat-ai)
//
// Player-side combat effects owned by the combat subsystem:
//   - armor/power buffs (Kaldbjǫrg, consumables), HoTs, wards (Vǫrðr)
//   - enemy-applied DoTs (burn / poison / bleed)
//   - riposte buff (earned from engine-flagged parries)
//   - the incoming-damage pre-filter every enemy hit routes through
//
// The ai subsystem calls `getPlayerEffects()?.routeToPlayer(raw, opts)` for
// each enemy strike. The pre-filter applies ward absorb → buff armor curve →
// realm-ability resists (gdd §5: "resists apply after block"), then hands the
// remainder to engine `player.damage`, which applies equipment armor + block
// math. Engine armor and buff armor therefore compose without double-counting.
// ============================================================================

import type { DamageSchool } from '../../../contracts/types';
import { REALM_ABILITIES } from '../../../contracts/skills';
import type { UseGameStore } from '../store';
import type { PlayerService } from '../services';
import { armorCurveMultiplier } from './stats';

// ---------------------------------------------------------------------------

interface TimedBuff {
  id: string;
  kind: 'armor' | 'power';
  amount: number; // armor: flat; power: multiplier
  expiresAt: number;
  /** Kaldbjǫrg: frost damage dealt back to attackers while this buff lives. */
  thornsDamage?: number;
}

interface TimedRegen {
  id: string;
  kind: 'hot' | 'dot';
  perSec: number;
  expiresAt: number;
  school: DamageSchool; // dots only (hots heal)
  sourceId?: string;
  /** DoT tick batching: damage accumulates and lands every DOT_TICK_SEC. */
  nextTickAt?: number;
}

const DOT_TICK_SEC = 0.5;

export interface WardState {
  absorbRemaining: number;
  expiresAt: number;
}

interface AttackSlow {
  mult: number;
  expiresAt: number;
}

export class PlayerEffects {
  private now = 0;
  private buffs: TimedBuff[] = [];
  private regens: TimedRegen[] = [];
  private ward: WardState | null = null;
  private riposteUntil = -1;
  private attackSlows: AttackSlow[] = [];
  private nextId = 1;

  /** Last time (module clock) the player took or dealt damage — ullr check. */
  private lastTakenAt = -999;
  private lastDealtAt = -999;
  private lastSourceId = 'unknown';

  /** Set by combat/index: thorns retaliation (Kaldbjǫrg) hits the attacker. */
  onThorns: ((enemyId: string, amount: number) => void) | null = null;

  private readonly store: UseGameStore;
  private readonly getPlayer: () => PlayerService | null;

  constructor(store: UseGameStore, getPlayer: () => PlayerService | null) {
    this.store = store;
    this.getPlayer = getPlayer;
  }

  getNow(): number {
    return this.now;
  }

  getLastDamageSource(): string {
    return this.lastSourceId;
  }

  markDealtDamage(): void {
    this.lastDealtAt = this.now;
  }

  /** True when no damage dealt or taken in the last 5s (sk_hun_ullr). */
  isOutOfCombat(): boolean {
    return this.now - Math.max(this.lastTakenAt, this.lastDealtAt) > 5;
  }

  // ------------------------------------------------------------- buffs

  addArmorBuff(amount: number, durationSec: number, thornsDamage = 0): void {
    this.buffs.push({
      id: `b${this.nextId++}`, kind: 'armor', amount,
      expiresAt: this.now + durationSec,
      thornsDamage: thornsDamage > 0 ? thornsDamage : undefined,
    });
  }

  addPowerBuff(mult: number, durationSec: number): void {
    this.buffs.push({ id: `b${this.nextId++}`, kind: 'power', amount: mult, expiresAt: this.now + durationSec });
  }

  /** Combined outgoing-damage multiplier from active power buffs. */
  powerBuffMult(): number {
    let mult = 1;
    for (const b of this.buffs) if (b.kind === 'power') mult *= b.amount;
    return mult;
  }

  private buffArmor(): number {
    let armor = 0;
    for (const b of this.buffs) if (b.kind === 'armor') armor += b.amount;
    return armor;
  }

  private thornsDamage(): number {
    let dmg = 0;
    for (const b of this.buffs) if (b.thornsDamage) dmg += b.thornsDamage;
    return dmg;
  }

  // ------------------------------------------------------------- heals

  /** Heal-over-time (Lækning, meads, rations). Vitals write: ours. */
  addHoT(totalAmount: number, durationSec: number): void {
    this.regens.push({
      id: `r${this.nextId++}`, kind: 'hot',
      perSec: totalAmount / Math.max(0.01, durationSec),
      expiresAt: this.now + durationSec, school: 'spirit',
    });
  }

  addRegen(hpPerSec: number, durationSec: number): void {
    this.regens.push({
      id: `r${this.nextId++}`, kind: 'hot',
      perSec: hpPerSec, expiresAt: this.now + durationSec, school: 'spirit',
    });
  }

  // ------------------------------------------------------------- dots

  /** Enemy-applied DoT. ra_muspelheim grants burn (fire) immunity. */
  addDoT(perSec: number, durationSec: number, school: DamageSchool, sourceId?: string): void {
    if (perSec <= 0) return;
    const s = this.store.getState();
    if (school === 'fire' && s.realmAbilities.includes('ra_muspelheim')) return;
    this.regens.push({
      id: `r${this.nextId++}`, kind: 'dot',
      perSec, expiresAt: this.now + durationSec, school, sourceId,
    });
  }

  // ------------------------------------------------------------- ward

  addWard(absorb: number, durationSec: number): void {
    // Fresh ward replaces the old (no stacking shields in the sagas).
    this.ward = { absorbRemaining: absorb, expiresAt: this.now + durationSec };
  }

  getWardAbsorb(): number {
    return this.ward?.absorbRemaining ?? 0;
  }

  // ------------------------------------------------------------- riposte

  /** Engine flagged a parry (player_hurt {parried:true}) → +50% next hit. */
  grantRiposte(windowSec: number): void {
    this.riposteUntil = this.now + windowSec;
  }

  /** Multiplier for the next outgoing hit; consumes the riposte if active. */
  consumeRiposteMult(activeMult: number): number {
    if (this.riposteUntil > this.now) {
      this.riposteUntil = -1;
      return activeMult;
    }
    return 1;
  }

  hasRiposte(): boolean {
    return this.riposteUntil > this.now;
  }

  // ------------------------------------------------------------- debuffs

  /** Enemy charms (Gullveig's Gold-Lust): player attack cooldowns × 1/mult. */
  addAttackSlow(mult: number, durationSec: number): void {
    this.attackSlows.push({ mult, expiresAt: this.now + durationSec });
  }

  /** Combined attack-speed multiplier from active charms (<1 = slowed). */
  attackSlowMult(): number {
    let mult = 1;
    for (const s of this.attackSlows) mult *= s.mult;
    return mult;
  }

  // ------------------------------------------------------------- damage in

  /**
   * Route one enemy hit into the local player. Applies (in order):
   *   1. ward absorb (Vǫrðr)            2. buff-armor curve (Kaldbjǫrg, candle)
   *   3. realm-ability school resists    4. engine pipeline (armor/block/parry)
   */
  routeToPlayer(raw: number, opts: { sourceId?: string; school?: DamageSchool }): void {
    const player = this.getPlayer();
    if (!player || raw <= 0) return;
    if (this.store.getState().dead) return; // no grinding the corpse
    const school = opts.school ?? 'physical';
    let amount = raw;

    if (this.ward && this.ward.absorbRemaining > 0) {
      const absorbed = Math.min(this.ward.absorbRemaining, amount);
      this.ward.absorbRemaining -= absorbed;
      amount -= absorbed;
      if (this.ward.absorbRemaining <= 0) this.ward = null;
    }

    const bonusArmor = this.buffArmor();
    if (bonusArmor > 0) amount *= armorCurveMultiplier(bonusArmor);

    const s = this.store.getState();
    for (const abilityId of s.realmAbilities) {
      const ability = REALM_ABILITIES[abilityId];
      if (ability?.effect.type === 'passive_resist' && ability.effect.school === school) {
        amount *= 1 - ability.effect.amount;
      }
    }

    if (opts.sourceId) this.lastSourceId = opts.sourceId;
    this.lastTakenAt = this.now;

    // Kaldbjǫrg thorns: attackers take frost in answer (rune damage = 6).
    const thorns = this.thornsDamage();
    if (thorns > 0 && opts.sourceId && this.onThorns) {
      this.onThorns(opts.sourceId, thorns);
    }

    if (amount > 0) player.damage(amount, { sourceId: opts.sourceId, school });
  }

  // ------------------------------------------------------------- tick

  tick(dt: number): void {
    this.now += dt;
    const s = this.store.getState();

    if (this.buffs.length) this.buffs = this.buffs.filter((b) => b.expiresAt > this.now);
    if (this.attackSlows.length) this.attackSlows = this.attackSlows.filter((s) => s.expiresAt > this.now);
    if (this.ward && this.ward.expiresAt <= this.now) this.ward = null;

    if (this.regens.length) {
      let hpDelta = 0;
      const keep: TimedRegen[] = [];
      for (const r of this.regens) {
        if (r.expiresAt <= this.now) continue;
        keep.push(r);
        if (r.kind === 'hot') {
          hpDelta += r.perSec * dt;
        } else {
          // Batch DoT ticks: accumulate and land every DOT_TICK_SEC so the
          // engine damage path (and player_hurt) is not hammered at 60Hz.
          if (r.nextTickAt === undefined) r.nextTickAt = this.now + DOT_TICK_SEC;
          if (this.now >= r.nextTickAt) {
            r.nextTickAt = this.now + DOT_TICK_SEC;
            this.routeToPlayer(r.perSec * DOT_TICK_SEC, { sourceId: r.sourceId, school: r.school });
          }
        }
      }
      this.regens = keep;
      if (hpDelta > 0 && !s.dead) {
        const v = s.vitals;
        const healed = Math.min(v.maxHp, v.hp + hpDelta);
        if (healed !== v.hp) s.setVitals({ hp: healed });
      }
    }
  }

  dispose(): void {
    this.buffs = [];
    this.regens = [];
    this.ward = null;
    this.attackSlows = [];
    this.onThorns = null;
  }
}

// ---------------------------------------------------------------------------
// Module singleton (combat init creates it; ai resolves it lazily per tick).
// ============================================================================

let effects: PlayerEffects | null = null;

export function initPlayerEffects(store: UseGameStore, getPlayer: () => PlayerService | null): PlayerEffects {
  effects?.dispose();
  effects = new PlayerEffects(store, getPlayer);
  return effects;
}

export function getPlayerEffects(): PlayerEffects | null {
  return effects;
}

export function shutdownPlayerEffects(): void {
  effects?.dispose();
  effects = null;
}
