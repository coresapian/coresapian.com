// ============================================================================
// CORESAPIAN — src/game/combat/runes.ts (combat-ai)
//
// Rune magic (Q/R/F/V) per contracts/items.ts RUNES + gdd §5.4:
//   projectiles (bolt/shard/spark), cones, novas, ground fields, self buffs,
//   HoT, ward, Fylgja summon, Þundarr chain lightning.
// Wyrd costs + per-item cooldowns (reduced by sk_sei_galdr; sk_sei_echo can
// skip the cooldown). Damage flows through the exact gdd §5 pipeline.
// ============================================================================

import * as THREE from 'three';

import type { RuneDef } from '../../../contracts/items';
import { ITEMS } from '../../../contracts/items';
import type { DamageSchool } from '../../../contracts/types';
import { REALM_ABILITIES } from '../../../contracts/skills';
import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';
import type { Enemy } from '../ai/enemy';
import type { EnemyManager } from '../ai/enemyManager';
import type { PlayerEffects } from './incoming';
import type { AttackClaim } from './netClaims';
import {
  critProfile, echoSkipChance, resolveHit, runeCooldownMult,
  spellSchoolMult, summonDurationMult,
} from './stats';

const RUNE_PROJECTILE_COLORS: Record<string, number> = {
  fire: 0xff7a33,
  ice: 0x9fdcff,
  storm: 0xbfe8ff,
  spirit: 0x9dffc8,
};

function runeProjectileColor(school: string): number {
  return RUNE_PROJECTILE_COLORS[school] ?? 0xffffff;
}

// ---------------------------------------------------------------------------
// Prose-pinned riders (values exist only in item descriptions; see summary):
//   Ískǫstr slows 40% for 2.5s · Kaldbjǫrg +30 armor · Niflgrip 60% slow
// ---------------------------------------------------------------------------
const ISS_SHARD_SLOW_MULT = 0.6;
const ISS_SHARD_SLOW_SEC = 2.5;
const KALDBJORG_ARMOR = 30;
const NIFLGRIP_SLOW_MULT = 0.4;

// ---------------------------------------------------------------------------

export interface RuneProjectileSpec {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  radius: number;
  color: number;
  school: DamageSchool;
  resolveHitFor(enemy: Enemy): { amount: number; isCrit: boolean };
  onHitEnemy(enemy: Enemy): void;
  claimItemId: string;
}

export interface RuneCastHooks {
  spawnRuneProjectile(spec: RuneProjectileSpec): void;
  pushClaim(claim: AttackClaim): void;
}

export interface RuneCastContext {
  now: number;
  store: UseGameStore;
  events: GameEventBus;
  camera: THREE.PerspectiveCamera;
  playerPos: THREE.Vector3;
  effects: PlayerEffects;
  manager: EnemyManager;
}

export interface RuneCastResult {
  ok: boolean;
  /** Cooldown to arm on this slot (0 when echo skips it). */
  cooldownSec: number;
  school?: DamageSchool;
  /** Why the cast failed ('no_rune' | 'wyrd' | 'cooldown'). */
  reason?: string;
}

function camDir(camera: THREE.PerspectiveCamera): THREE.Vector3 {
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  return d.normalize();
}

function runeHitResolver(ctx: RuneCastContext, def: RuneDef): (enemy: Enemy) => { amount: number; isCrit: boolean } {
  return (enemy) => {
    const s = ctx.store.getState();
    const powerMult =
      spellSchoolMult(s.skills, def.school) *
      ctx.effects.powerBuffMult() *
      ctx.effects.consumeRiposteMult(1.5);
    return resolveHit({
      sourceDamage: def.damage,
      upgradeLevel: 0,
      kindMult: 1,
      chargeMult: 1,
      powerMult,
      crit: critProfile(s.skills, { runeCast: true, gearCritChance: gearCrit(s) }),
      armorPen: 0,
      targetArmor: enemy.def.armor,
    });
  };
}

function gearCrit(s: ReturnType<UseGameStore['getState']>): number {
  let crit = 0;
  for (const inst of Object.values(s.equipment)) {
    if (!inst) continue;
    const def = ITEMS[inst.itemId];
    if (def && def.kind === 'armor' && def.bonus?.critChance) crit += def.bonus.critChance;
  }
  return crit;
}

/** Cast the rune in loadout `slot`. Caller handles wyrd spend + cooldown arm. */
export function executeRuneCast(slot: number, ctx: RuneCastContext, hooks: RuneCastHooks): RuneCastResult {
  const s = ctx.store.getState();
  const runeId = s.runeLoadout[slot];
  if (!runeId) return { ok: false, cooldownSec: 0, reason: 'no_rune' };
  const def = ITEMS[runeId];
  if (!def || def.kind !== 'rune') return { ok: false, cooldownSec: 0, reason: 'no_rune' };
  const rune = def as RuneDef;

  if (s.vitals.wyrd < rune.wyrdCost) return { ok: false, cooldownSec: 0, reason: 'wyrd' };

  // Spend wyrd (combat-ai owns costs).
  s.setVitals({ wyrd: Math.max(0, s.vitals.wyrd - rune.wyrdCost) });

  // Cooldown: sk_sei_galdr mult; sk_sei_echo may skip it entirely.
  let cooldownSec = rune.cooldownSec * runeCooldownMult(s.skills);
  if (Math.random() < echoSkipChance(s.skills)) {
    cooldownSec = 0;
    ctx.events.emit('play_sfx', { sfxId: 'sfx.cast.spirit', volume: 0.5 });
  }

  const origin = ctx.camera.position.clone();
  const dir = camDir(ctx.camera);
  const resolveFor = runeHitResolver(ctx, rune);

  const claimBase = {
    attackKind: 'rune' as const,
    itemId: rune.id,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
    clientTime: Date.now(),
  };
  let claimSeq = 0;
  const pushHitClaim = (targetId?: string) => {
    hooks.pushClaim({
      ...claimBase,
      claimId: `rune_${rune.id}_${Date.now()}_${claimSeq++}`,
      targetId,
    });
  };

  switch (rune.effect.type) {
    case 'projectile': {
      const fx = rune.effect;
      hooks.spawnRuneProjectile({
        origin, dir,
        speed: fx.speed,
        radius: fx.radius,
        color: runeProjectileColor(rune.school),
        school: rune.damageSchool,
        resolveHitFor: resolveFor,
        onHitEnemy: (enemy) => {
          if (rune.id === 'rune_iss_shard') {
            ctx.manager.applySlowTo(enemy.id, ISS_SHARD_SLOW_MULT, ISS_SHARD_SLOW_SEC);
          }
          if (rune.dotDamage && rune.dotDurationSec) {
            ctx.manager.applyDotTo(enemy.id, rune.dotDamage, rune.dotDurationSec, rune.damageSchool);
          }
          pushHitClaim(enemy.id);
        },
        claimItemId: rune.id,
      });
      break;
    }

    case 'cone': {
      const fx = rune.effect;
      const flatDir = dir.clone().setY(0).normalize();
      const targets = ctx.manager.enemiesInArc(origin, flatDir, fx.range, fx.angleDeg);
      for (const enemy of targets) {
        const hit = resolveFor(enemy);
        ctx.manager.playerHitEnemy(enemy.id, hit.amount, { school: rune.damageSchool, isCrit: hit.isCrit, fromPos: ctx.playerPos });
        if (rune.dotDamage && rune.dotDurationSec) {
          ctx.manager.applyDotTo(enemy.id, rune.dotDamage, rune.dotDurationSec, rune.damageSchool);
        }
        pushHitClaim(enemy.id);
      }
      ctx.events.emit('play_sfx', { sfxId: `sfx.cast.${rune.school}`, position: ctx.playerPos });
      break;
    }

    case 'nova': {
      const fx = rune.effect;
      const targets = ctx.manager.enemiesInArc(ctx.playerPos, new THREE.Vector3(0, 0, 1), fx.radius, 360);
      for (const enemy of targets) {
        const hit = resolveFor(enemy);
        ctx.manager.playerHitEnemy(enemy.id, hit.amount, { school: rune.damageSchool, isCrit: hit.isCrit, fromPos: ctx.playerPos, knockback: 3 });
        if (rune.dotDamage && rune.dotDurationSec) {
          ctx.manager.applyDotTo(enemy.id, rune.dotDamage, rune.dotDurationSec, rune.damageSchool);
        }
        pushHitClaim(enemy.id);
      }
      ctx.events.emit('play_sfx', { sfxId: `sfx.cast.${rune.school}`, position: ctx.playerPos });
      ctx.events.emit('screen_shake', { intensity: 0.25, durationMs: 90 });
      break;
    }

    case 'chain': {
      const fx = rune.effect;
      const hitIds = new Set<string>();
      let from = ctx.playerPos.clone();
      let searchDir = dir;
      for (let jump = 0; jump < fx.jumps; jump++) {
        const target = ctx.manager.nearestForChain(from, searchDir, jump === 0 ? 14 : fx.jumpRange, hitIds);
        if (!target) break;
        hitIds.add(target.id);
        const hit = resolveFor(target);
        ctx.manager.playerHitEnemy(target.id, hit.amount, { school: rune.damageSchool, isCrit: hit.isCrit, fromPos: from });
        pushHitClaim(target.id);
        from = target.pos.clone();
        searchDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      }
      ctx.events.emit('play_sfx', { sfxId: 'sfx.cast.storm', position: ctx.playerPos });
      break;
    }

    case 'ground_field': {
      const fx = rune.effect;
      // Place the field on the terrain 10m ahead of the camera.
      const at = ctx.playerPos.clone().addScaledVector(dir.clone().setY(0).normalize(), 10);
      ctx.manager.addEnemyField({
        pos: at, radius: fx.radius, durationSec: fx.durationSec,
        dps: rune.damage, school: rune.damageSchool, slowMult: NIFLGRIP_SLOW_MULT,
      });
      pushHitClaim(undefined);
      ctx.events.emit('play_sfx', { sfxId: `sfx.cast.${rune.school}`, position: at });
      break;
    }

    case 'self_buff': {
      // Kaldbjǫrg: rime-armor + frost thorns (rune.damage is the thorns hit).
      ctx.effects.addArmorBuff(KALDBJORG_ARMOR, rune.effect.durationSec, rune.damage);
      pushHitClaim(undefined);
      ctx.events.emit('play_sfx', { sfxId: `sfx.cast.${rune.school}` });
      break;
    }

    case 'heal_over_time': {
      ctx.effects.addHoT(rune.healAmount ?? 0, rune.effect.durationSec);
      pushHitClaim(undefined);
      ctx.events.emit('play_sfx', { sfxId: 'sfx.heal' });
      break;
    }

    case 'ward': {
      ctx.effects.addWard(rune.effect.absorb, rune.effect.durationSec);
      pushHitClaim(undefined);
      ctx.events.emit('play_sfx', { sfxId: `sfx.cast.${rune.school}` });
      break;
    }

    case 'summon': {
      const fx = rune.effect;
      const duration = fx.durationSec * summonDurationMult(s.skills);
      const at = ctx.playerPos.clone().addScaledVector(dir.clone().setY(0).normalize(), 2);
      ctx.manager.summonFylgja({ x: at.x, y: at.y, z: at.z }, duration);
      pushHitClaim(undefined);
      ctx.events.emit('play_sfx', { sfxId: `sfx.cast.${rune.school}` });
      break;
    }
  }

  return { ok: true, cooldownSec, school: rune.damageSchool };
}

/** Realm ability (C): only ra_alfheim (Ljós-Step) is an active; rest passive. */
export function realmAbilityForRealm(realmAbilityId: string | undefined, unlocked: string[]): { type: 'active_blink'; rangeM: number; cooldownSec: number } | null {
  if (!realmAbilityId || !unlocked.includes(realmAbilityId)) return null;
  const ability = REALM_ABILITIES[realmAbilityId];
  if (!ability) return null;
  if (ability.effect.type === 'active_blink') return ability.effect;
  return null;
}
