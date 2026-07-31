// ============================================================================
// CORESAPIAN — src/game/ai/enemy.ts (combat-ai)
//
// Enemy entity: FSM per gdd §7.1
//   idle → patrol → alert → chase → attack → recover → flee
// plus leash/deaggro full-heal, elite variants, per-type movement flavor
// (vargr circling + pack howls), telegraphed attacks, and boss machinery
// (arena leash, hp-threshold phases, summons, enrage).
// The manager (enemyManager.ts) owns spawning, strikes, projectiles, loot.
// ============================================================================

import * as THREE from 'three';

import type { AttackPattern, EnemyDef } from '../../../contracts/enemies';
import { scaleByTier, TIER_DMG_MULT, TIER_HP_MULT, TIER_XP_MULT } from '../../../contracts/enemies';
import type { DamageSchool, Vec3 } from '../../../contracts/types';
import { buildEnemyRig } from './meshes';
import type { EnemyRig } from './meshes';
import type { EnemyManagerApi } from './enemyManager';

// ---------------------------------------------------------------------------
// Tuning (gdd §7.1 values; unnamed feel constants are local to this file)
// ---------------------------------------------------------------------------

export const LEASH_RADIUS_M = 60;
const ALERT_SEC = 0.5;
const RECOVER_SEC = 0.45;
const FLEE_HP_FRAC = 0.2;
const FLEE_SEC = 5;
const WANDER_RADIUS_M = 7;
const HOWL_COOLDOWN_SEC = 12;
const HOWL_RADIUS_M = 40;
const PACK_AGGRO_RADIUS_M = 25;
const CORPSE_SEC = 3;
const STRIKE_RANGE_GRACE_M = 0.5;

export type EnemyState =
  | 'idle' | 'patrol' | 'alert' | 'chase' | 'attack' | 'recover' | 'flee' | 'return' | 'dead';

export interface EnemySpawnOptions {
  elite?: boolean;
  /** Stat tier (defaults to current realm tier via getRealmTier). */
  tier?: number;
  friendly?: boolean;
  durationSec?: number;
  hpOverride?: number;
  isIllusion?: boolean;
  eventId?: string;
  arenaCenter?: Vec3;
  packId?: string;
}

interface Windup {
  pattern: AttackPattern;
  endsAt: number;
}

interface ActiveDot {
  perSec: number;
  until: number;
  school: DamageSchool;
  nextTickAt: number;
}

interface ActiveSlow {
  mult: number;
  until: number;
}

let enemySeq = 0;

export class Enemy {
  readonly id: string;
  readonly def: EnemyDef;
  readonly tier: number;
  readonly elite: boolean;
  readonly friendly: boolean;
  readonly isIllusion: boolean;
  readonly eventId?: string;
  readonly packId?: string;
  readonly arenaCenter?: THREE.Vector3;

  readonly rig: EnemyRig;
  readonly pos = new THREE.Vector3();
  yaw = 0;

  state: EnemyState = 'idle';
  stateT = 0;
  hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly speed: number;
  readonly xp: number;

  aggro = false;
  diedAt = 0;
  corpseT = 0;
  expiresAt = Infinity;

  private readonly home = new THREE.Vector3();
  private readonly wanderTarget = new THREE.Vector3();
  private wanderAt = 0;
  private readonly cooldowns = new Map<string, number>();
  private windup: Windup | null = null;
  private recoverUntil = 0;
  private staggerUntil = 0;
  private readonly dots: ActiveDot[] = [];
  private readonly slows: ActiveSlow[] = [];
  private readonly knock = new THREE.Vector3();
  private circleDir = 1;
  private circleAt = 0;
  private lastHowlAt = -999;

  // Boss machinery
  phaseIdx = 0;
  engagedAt = 0;
  engaged = false;
  enraged = false;
  private readonly summonsFired = new Set<number>();

  // Animation
  private walkPhase = 0;
  private animT = 0;

  constructor(def: EnemyDef, pos: Vec3, opts: EnemySpawnOptions, realmTier: number, scene: THREE.Scene) {
    this.def = def;
    this.id = `en_${++enemySeq}`;
    this.elite = opts.elite === true;
    // Elites fight one tier up (gdd §7.1).
    this.tier = (opts.tier ?? realmTier) + (this.elite ? 1 : 0);
    this.friendly = opts.friendly === true;
    this.isIllusion = opts.isIllusion === true;
    this.eventId = opts.eventId;
    this.packId = opts.packId;
    this.arenaCenter = opts.arenaCenter ? new THREE.Vector3(opts.arenaCenter.x, opts.arenaCenter.y, opts.arenaCenter.z) : undefined;

    // Boss stats are already final (enemies.ts: "no extra scaling").
    const isBossDef = def.boss !== undefined;
    this.maxHp = opts.hpOverride ?? (isBossDef ? def.baseStats.hp : scaleByTier(def.baseStats.hp, TIER_HP_MULT, this.tier));
    this.hp = this.maxHp;
    this.damage = isBossDef ? def.baseStats.damage : scaleByTier(def.baseStats.damage, TIER_DMG_MULT, this.tier);
    this.speed = def.baseStats.speed;
    this.xp = isBossDef ? def.baseStats.xp : scaleByTier(def.baseStats.xp, TIER_XP_MULT, this.tier);

    this.pos.set(pos.x, pos.y, pos.z);
    this.home.copy(this.pos);
    this.wanderTarget.copy(this.pos);
    this.yaw = Math.random() * Math.PI * 2;

    this.rig = buildEnemyRig(def.id, this.elite);
    this.rig.root.position.copy(this.pos);
    scene.add(this.rig.root);
    if (def.boss) this.rig.setBarVisible(true);
  }

  get isBoss(): boolean {
    return this.def.boss !== undefined;
  }

  get dead(): boolean {
    return this.state === 'dead';
  }

  get hpFrac(): number {
    return this.hp / this.maxHp;
  }

  /** Effective walk speed after slows and boss phase multipliers. */
  private effectiveSpeed(): number {
    let mult = 1;
    for (const s of this.slows) mult *= s.mult;
    if (this.isBoss) mult *= this.currentPhaseSpeedMult();
    return this.speed * mult;
  }

  private currentPhaseSpeedMult(): number {
    const phases = this.def.boss?.phases;
    if (!phases || phases.length === 0) return 1;
    return phases[Math.min(this.phaseIdx, phases.length - 1)].speedMult;
  }

  currentDamageMult(): number {
    let mult = 1;
    const phases = this.def.boss?.phases;
    if (phases && phases.length > 0) mult *= phases[Math.min(this.phaseIdx, phases.length - 1)].damageMult;
    if (this.enraged) mult *= 1.5; // gdd §7.2: enrage +50%
    if (this.isIllusion) mult *= 0.25;
    return mult;
  }

  /** Patterns currently usable (bosses gate on reached phases). */
  enabledPatterns(): AttackPattern[] {
    const boss = this.def.boss;
    if (!boss) return this.def.attacks;
    const enabled = new Set<string>();
    for (let i = 0; i <= Math.min(this.phaseIdx, boss.phases.length - 1); i++) {
      for (const id of boss.phases[i].enables) enabled.add(id);
    }
    return this.def.attacks.filter((a) => enabled.has(a.id));
  }

  // ------------------------------------------------------------------ combat

  applyDamage(amount: number, opts: { school?: DamageSchool; isCrit?: boolean; fromPos?: THREE.Vector3; knockback?: number }): void {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - amount);
    this.rig.setHealthFrac(this.hpFrac);
    if (!this.isBoss) this.rig.setBarVisible(this.hp < this.maxHp);
    // Getting hit pulls aggro even from stealthy attackers.
    if (!this.friendly && this.hp > 0) this.forceAggro();
    if (opts.knockback && opts.fromPos && !this.isBoss) {
      const dir = this.pos.clone().sub(opts.fromPos).setY(0).normalize();
      this.knock.addScaledVector(dir, opts.knockback * 0.35);
    }
  }

  applyDot(perSec: number, durationSec: number, school: DamageSchool, now: number): void {
    if (this.dead) return;
    this.dots.push({ perSec, until: now + durationSec, school, nextTickAt: now + 0.5 });
  }

  applySlow(mult: number, durationSec: number, now: number): void {
    this.slows.push({ mult, until: now + durationSec });
  }

  applyStagger(durationSec: number, now: number): void {
    this.staggerUntil = Math.max(this.staggerUntil, now + durationSec);
    if (this.windup) this.cancelWindup();
  }

  forceAggro(): void {
    if (this.dead || this.friendly) return;
    if (!this.aggro) {
      this.aggro = true;
      if (this.state === 'idle' || this.state === 'patrol' || this.state === 'return' || this.state === 'flee') {
        this.setState('alert');
      }
    }
  }

  deaggro(): void {
    this.aggro = false;
    this.hp = this.maxHp; // gdd §7.1: deaggro heals to full
    this.rig.setHealthFrac(1);
    if (!this.isBoss) this.rig.setBarVisible(false);
    this.cancelWindup();
    this.setState('return');
  }

  die(now: number): void {
    if (this.dead) return;
    this.setState('dead');
    this.diedAt = now;
    this.corpseT = CORPSE_SEC;
    this.cancelWindup();
    this.rig.setBarVisible(false);
  }

  private setState(s: EnemyState): void {
    if (this.state === 'dead') return;
    this.state = s;
    this.stateT = 0;
  }

  private cancelWindup(): void {
    this.windup = null;
  }

  /** Currently winding up an attack? */
  get isWindingUp(): boolean {
    return this.windup !== null;
  }

  // ------------------------------------------------------------------ tick

  tick(ctx: {
    now: number; dt: number;
    playerPos: THREE.Vector3;
    playerAlive: boolean;
    aggroRangeMult: number;
    manager: EnemyManagerApi;
  }): void {
    const { now, dt, manager } = ctx;

    if (this.state === 'dead') {
      this.corpseT -= dt;
      // Corpse fade: sink + shrink over CORPSE_SEC.
      const t = Math.max(0, this.corpseT / CORPSE_SEC);
      this.rig.root.scale.setScalar((this.elite ? 1.15 : 1) * (0.6 + 0.4 * t));
      this.rig.root.position.y = this.pos.y - (1 - t) * 0.6;
      return;
    }

    // DoT ticks
    if (this.dots.length) {
      for (let i = this.dots.length - 1; i >= 0; i--) {
        const d = this.dots[i];
        if (now > d.until) { this.dots.splice(i, 1); continue; }
        if (now >= d.nextTickAt) {
          d.nextTickAt = now + 0.5;
          manager.damageEnemyInternal(this, d.perSec * 0.5, { school: d.school, silent: true });
          if (this.dead) return;
        }
      }
    }
    if (this.slows.length) {
      for (let i = this.slows.length - 1; i >= 0; i--) {
        if (now > this.slows[i].until) this.slows.splice(i, 1);
      }
    }

    // Summon lifetime
    if (now >= this.expiresAt) {
      manager.despawnEnemy(this.id);
      return;
    }

    const distToPlayer = this.pos.distanceTo(ctx.playerPos);
    const distToHome = this.pos.distanceTo(this.home);

    if (this.friendly) {
      this.tickFriendly(ctx, distToPlayer);
      return;
    }

    // Boss enrage timer (from engagement).
    if (this.isBoss && this.engaged && !this.enraged && this.def.boss!.enrageSec > 0) {
      if (now - this.engagedAt >= this.def.boss!.enrageSec) {
        this.enraged = true;
        manager.events.emit('play_sfx', { sfxId: 'sfx.boss.roar', position: this.pos });
        manager.notify('warning', `${this.def.name} is enraged!`);
      }
    }

    // Boss phase transitions.
    if (this.isBoss) this.tickBossPhases(ctx);

    // Leash / arena reset.
    if (this.isBoss) {
      const arena = this.arenaCenter ?? this.home;
      const leash = this.def.boss!.arenaRadiusM;
      if (this.engaged && ctx.playerPos.distanceTo(arena) > leash) {
        // Player fled the arena: reset.
        this.engaged = false;
        this.enraged = false;
        this.phaseIdx = 0;
        this.summonsFired.clear();
        manager.onBossDisengaged(this);
        this.deaggro();
        return;
      }
    } else if (this.aggro && distToHome > LEASH_RADIUS_M) {
      this.deaggro();
      return;
    }

    // Stagger locks the FSM.
    if (now < this.staggerUntil) {
      this.applyKnockback(dt);
      this.faceToward(ctx.playerPos, dt, 4);
      return;
    }

    const canSeePlayer = ctx.playerAlive && distToPlayer <= this.def.aggroRangeM * ctx.aggroRangeMult * (this.isBoss ? 1.5 : 1);

    switch (this.state) {
      case 'idle': {
        if (canSeePlayer) { this.enterAlert(ctx); break; }
        if (now >= this.wanderAt) {
          this.wanderAt = now + 4 + Math.random() * 5;
          this.wanderTarget.set(
            this.home.x + (Math.random() - 0.5) * 2 * WANDER_RADIUS_M,
            this.home.y,
            this.home.z + (Math.random() - 0.5) * 2 * WANDER_RADIUS_M,
          );
          this.setState('patrol');
        }
        break;
      }
      case 'patrol': {
        if (canSeePlayer) { this.enterAlert(ctx); break; }
        const arrived = this.moveToward(this.wanderTarget, this.effectiveSpeed() * 0.4, dt, manager);
        if (arrived) this.setState('idle');
        break;
      }
      case 'alert': {
        this.faceToward(ctx.playerPos, dt, 8);
        if (this.stateT >= ALERT_SEC) this.setState(this.aggro ? 'chase' : 'idle');
        break;
      }
      case 'chase': {
        if (!ctx.playerAlive) { this.deaggro(); break; }
        this.tickChase(ctx, distToPlayer);
        break;
      }
      case 'attack': {
        this.faceToward(ctx.playerPos, dt, 6);
        if (this.windup && now >= this.windup.endsAt) {
          const pattern = this.windup.pattern;
          this.windup = null;
          manager.resolveStrike(this, pattern);
          this.recoverUntil = now + RECOVER_SEC;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        if (now >= this.recoverUntil) this.setState('chase');
        break;
      }
      case 'flee': {
        const away = this.pos.clone().sub(ctx.playerPos).setY(0).normalize().multiplyScalar(10).add(this.pos);
        this.moveToward(away, this.effectiveSpeed(), dt, manager);
        this.faceToward(away, dt, 6);
        if (this.stateT >= FLEE_SEC) {
          if (distToPlayer > 30) this.deaggro();
          else this.setState('chase');
        }
        break;
      }
      case 'return': {
        const arrived = this.moveToward(this.home, this.effectiveSpeed(), dt, manager);
        if (arrived) this.setState('idle');
        break;
      }
    }

    this.applyKnockback(dt);
  }

  private enterAlert(ctx: { now: number; manager: EnemyManagerApi }): void {
    this.aggro = true;
    this.setState('alert');
    // Pack aggro: nearby packmates answer; vargr howl pulls the wider pack.
    if (this.packId) {
      ctx.manager.packAlert(this.packId, this.id, PACK_AGGRO_RADIUS_M, false);
    }
    if (this.def.id === 'vargr' && ctx.now - this.lastHowlAt > HOWL_COOLDOWN_SEC) {
      this.lastHowlAt = ctx.now;
      ctx.manager.packAlert(this.packId ?? '', this.id, HOWL_RADIUS_M, true);
      ctx.manager.events.emit('play_sfx', { sfxId: 'sfx.boss.roar', position: this.pos, volume: 0.25 });
    }
  }

  private tickChase(ctx: {
    now: number; dt: number; playerPos: THREE.Vector3; manager: EnemyManagerApi;
  }, distToPlayer: number): void {
    const { now, dt, playerPos, manager } = ctx;

    // Beasts flee when badly hurt.
    if (this.def.enemyClass === 'beast' && !this.isBoss && this.hpFrac < FLEE_HP_FRAC) {
      this.setState('flee');
      return;
    }

    // Try to start an attack.
    if (now >= this.recoverUntil) {
      const pattern = this.pickPattern(distToPlayer, now);
      if (pattern) {
        this.beginWindup(pattern, ctx);
        return;
      }
    }

    // Vargr circles at 8–12m while pounce is on cooldown.
    if (this.def.id === 'vargr' && distToPlayer < 12 && distToPlayer > 4) {
      const pounceReady = (this.cooldowns.get('pounce') ?? 0) <= now;
      if (!pounceReady) {
        if (now > this.circleAt) {
          this.circleAt = now + 1.5 + Math.random() * 2;
          if (Math.random() < 0.4) this.circleDir *= -1;
        }
        const toPlayer = playerPos.clone().sub(this.pos).setY(0).normalize();
        const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(this.circleDir);
        // Hold the 8–12m band while circling.
        if (distToPlayer < 8) strafe.addScaledVector(toPlayer, -0.7);
        else if (distToPlayer > 12) strafe.addScaledVector(toPlayer, 0.7);
        const target = this.pos.clone().addScaledVector(strafe.normalize(), 3);
        this.moveToward(target, this.effectiveSpeed() * 0.75, dt, manager);
        this.faceToward(playerPos, dt, 8);
        return;
      }
    }

    // Close to melee reach of the nearest enabled pattern (or hold at range
    // for casters waiting on a ranged cooldown).
    const meleeReach = this.minEnabledMeleeRange();
    if (distToPlayer > meleeReach) {
      this.moveToward(playerPos, this.effectiveSpeed(), dt, manager);
      this.faceToward(playerPos, dt, 8);
      // Logi's fire trail: burning ground left behind while moving.
      if (this.def.id === 'boss_logi' && this.engaged) manager.maybeDropFireTrail(this, now);
    } else {
      this.faceToward(playerPos, dt, 8);
    }
  }

  private minEnabledMeleeRange(): number {
    let min = Infinity;
    for (const p of this.enabledPatterns()) {
      if (p.range <= 4 && (!p.arcDeg || p.arcDeg < 360)) min = Math.min(min, p.range);
    }
    return min === Infinity ? 2 : min;
  }

  private pickPattern(distToPlayer: number, now: number): AttackPattern | null {
    const candidates = this.enabledPatterns().filter((p) => {
      if ((this.cooldowns.get(p.id) ?? 0) > now) return false;
      if (p.id === 'fire_trail') return false; // passive, handled while moving
      if (p.range <= 0) return distToPlayer <= 6; // self-centered effects
      return distToPlayer <= p.range + STRIKE_RANGE_GRACE_M;
    });
    if (candidates.length === 0) return null;
    // Prefer longer-range specials when at range; else random weighted by cd.
    candidates.sort((a, b) => {
      const aRanged = a.range > 5 ? 1 : 0;
      const bRanged = b.range > 5 ? 1 : 0;
      if (distToPlayer > 5 && aRanged !== bRanged) return bRanged - aRanged;
      return Math.random() - 0.5;
    });
    return candidates[0];
  }

  private beginWindup(pattern: AttackPattern, ctx: { now: number; playerPos: THREE.Vector3; manager: EnemyManagerApi }): void {
    const durSec = Math.max(0.05, pattern.windupMs / 1000);
    this.windup = { pattern, endsAt: ctx.now + durSec };
    this.cooldowns.set(pattern.id, ctx.now + pattern.cooldownSec);
    this.setState('attack');
    // Ground-decal telegraph: arcs centered on self; ranged aimed at the
    // player's current ground.
    const isAoE = (pattern.arcDeg ?? 0) >= 120 || pattern.range > 6;
    if (isAoE && pattern.id !== 'whiteout') {
      const at = pattern.range > 6 && (pattern.arcDeg ?? 0) < 120
        ? ctx.playerPos
        : this.pos;
      const radius = pattern.range > 6 ? Math.min(4, pattern.range * 0.3) : Math.max(2, pattern.range);
      ctx.manager.telegraph(at, radius, durSec, this.isBoss ? 0xff3c1e : 0xff5a3c);
    }
  }

  // ------------------------------------------------------------------ boss

  private tickBossPhases(ctx: { now: number; manager: EnemyManagerApi }): void {
    const boss = this.def.boss!;
    const phases = boss.phases;
    const next = this.phaseIdx + 1;
    if (next >= phases.length) return;
    if (this.hpFrac <= phases[next].hpThreshold) {
      this.phaseIdx = next;
      const phase = phases[next];
      ctx.manager.events.emit('play_sfx', { sfxId: 'sfx.boss.roar', position: this.pos });
      ctx.manager.notify('warning', `${this.def.name} — ${phase.name}`);
      if (phase.summon && !this.summonsFired.has(next)) {
        this.summonsFired.add(next);
        ctx.manager.spawnPhaseSummons(this, phase.summon.enemyId, phase.summon.count);
      }
    }
  }

  /** Boss engagement check, called by the manager when the player is near. */
  tryEngage(ctx: { now: number; playerPos: THREE.Vector3; manager: EnemyManagerApi }): void {
    if (!this.isBoss || this.engaged || this.dead) return;
    const arena = this.arenaCenter ?? this.home;
    if (ctx.playerPos.distanceTo(arena) <= this.def.boss!.arenaRadiusM) {
      this.engaged = true;
      this.engagedAt = ctx.now;
      this.forceAggro();
      ctx.manager.onBossEngaged(this);
    }
  }

  // ------------------------------------------------------------------ friendly

  private tickFriendly(ctx: {
    now: number; dt: number; playerPos: THREE.Vector3; playerAlive: boolean; manager: EnemyManagerApi;
  }, distToPlayer: number): void {
    const { now, dt, playerPos, manager } = ctx;
    // Fylgja: chase foes already fighting the player (never pulls fresh packs).
    const target = manager.nearestAggroedTo(playerPos, 30);
    if (this.windup) {
      if (now >= this.windup.endsAt) {
        const pattern = this.windup.pattern;
        this.windup = null;
        manager.resolveFriendlyStrike(this, pattern);
        this.recoverUntil = now + RECOVER_SEC;
      }
      return;
    }
    if (target) {
      const d = this.pos.distanceTo(target.pos);
      const bite = this.def.attacks[0];
      if (d <= bite.range + STRIKE_RANGE_GRACE_M && now >= this.recoverUntil && (this.cooldowns.get(bite.id) ?? 0) <= now) {
        this.windup = { pattern: bite, endsAt: now + Math.max(0.05, bite.windupMs / 1000) };
        this.cooldowns.set(bite.id, now + bite.cooldownSec);
      } else if (d > bite.range) {
        this.moveToward(target.pos, this.effectiveSpeed(), dt, manager);
        this.faceToward(target.pos, dt, 8);
      } else {
        this.faceToward(target.pos, dt, 8);
      }
    } else if (distToPlayer > 3.5) {
      this.moveToward(playerPos, this.effectiveSpeed(), dt, manager);
      this.faceToward(playerPos, dt, 8);
    }
  }

  // ------------------------------------------------------------------ motion

  /** Move toward a target point; returns true when arrived (<0.4m). */
  private moveToward(target: THREE.Vector3, speed: number, dt: number, manager: EnemyManagerApi): boolean {
    const dir = target.clone().sub(this.pos);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 0.4) return true;
    dir.normalize();
    this.pos.addScaledVector(dir, Math.min(speed * dt, dist));
    manager.snapToTerrain(this.pos);
    this.walkPhase += speed * dt * 2.2;
    if (speed > 0.1) {
      const targetYaw = Math.atan2(dir.x, dir.z);
      this.yaw = lerpAngle(this.yaw, targetYaw, Math.min(1, dt * 6));
    }
    return dist - speed * dt < 0.4;
  }

  private faceToward(target: THREE.Vector3, dt: number, rate: number): void {
    const dir = target.clone().sub(this.pos);
    if (dir.lengthSq() < 0.001) return;
    const targetYaw = Math.atan2(dir.x, dir.z);
    this.yaw = lerpAngle(this.yaw, targetYaw, Math.min(1, dt * rate));
  }

  private applyKnockback(dt: number): void {
    if (this.knock.lengthSq() < 0.0001) return;
    this.pos.addScaledVector(this.knock, dt * 4);
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
  }

  // ------------------------------------------------------------------ visuals

  /** Per-frame visual update (render loop, not sim). */
  updateVisual(dt: number, camera: THREE.Camera): void {
    this.animT += dt;
    const p = this.parts;
    if (!this.dead) {
      this.rig.root.position.copy(this.pos);
      this.rig.root.rotation.y = this.yaw;
      // Walk bob + leg swing
      const moving = this.state === 'chase' || this.state === 'patrol' || this.state === 'return' || this.state === 'flee';
      const swing = moving ? Math.sin(this.walkPhase) : 0;
      if (p.body) p.body.position.y = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(this.animT * 1.6) * 0.02;
      for (let i = 0; i < 4; i++) {
        const leg = p[`leg${i}`];
        if (leg) leg.rotation.x = swing * 0.55 * (i % 2 === 0 ? 1 : -1);
      }
      // Wings flap / hover
      const flap = Math.sin(this.animT * (this.def.id === 'wboss_hraesvelgr' ? 6 : 2.4)) * 0.5;
      if (p.wingL) p.wingL.rotation.z = 0.25 + flap;
      if (p.wingR) p.wingR.rotation.z = -0.25 - flap;
      if (p.tail) p.tail.rotation.z = Math.sin(this.animT * 3) * 0.25;
      // Windup: raise the right arm; strike snaps it down.
      if (p.armR) {
        if (this.windup) {
          p.armR.rotation.x = Math.max(-2.1, p.armR.rotation.x - dt * 7);
        } else {
          p.armR.rotation.x += (0 - p.armR.rotation.x) * Math.min(1, dt * 12);
        }
      }
      if (p.armL) {
        const target = this.windup ? -0.9 : 0;
        p.armL.rotation.x += (target - p.armL.rotation.x) * Math.min(1, dt * 8);
      }
      if (p.jaw) p.jaw.rotation.x = this.windup ? 0.5 : Math.max(0, p.jaw.rotation.x - dt * 3);
      if (p.head) p.head.rotation.x = this.state === 'alert' ? Math.sin(this.animT * 10) * 0.06 : 0;
    } else {
      // Corpse keel-over.
      this.rig.root.rotation.z = Math.min(Math.PI / 2, this.rig.root.rotation.z + dt * 2.2);
    }
    // Health bar billboards are sprites (auto-facing); nothing to do here, but
    // keep bar above any scaling.
    void camera;
  }

  private get parts(): Record<string, THREE.Object3D> {
    return this.rig.parts;
  }

  dispose(): void {
    this.rig.dispose();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
