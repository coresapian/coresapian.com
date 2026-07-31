// ============================================================================
// CORESAPIAN — src/game/combat/index.ts (combat-ai)
//
// Pinned subsystem entry (orchestrator addendum v1): player combat.
//   - Melee (tap = light / hold ≥300ms release = heavy), swing fan 120° arc
//   - Shield block (+ riposte tracking off engine parry flags)
//   - Bow (H swaps arms; LMB hold = draw, release = loose; gravity arrows)
//   - Rune magic Q/R/F/V (runes.ts), hotbar consumables 1–4, realm ability C
//   - Stamina/wyrd costs (engine owns regen), hitstop + screen_shake
//   - Attack claims → combat/netClaims.ts (drained by audio-net)
//   - Player death watch (addendum §5), ra_helheim cheat-death
// ============================================================================

import * as THREE from 'three';

import type { AttackClaimMsg } from '../../../contracts/netcode';
import type { BowDef, ConsumableDef, ShieldDef, WeaponDef } from '../../../contracts/items';
import { ITEMS } from '../../../contracts/items';
import { REALM_ABILITIES } from '../../../contracts/skills';
import type { AttackKind, DamageSchool } from '../../../contracts/types';
import type { GameContext, GameSubsystem } from '../Game';
import { REALMS } from '../config';
import type { PlayerService, ServiceRegistry, TerrainService } from '../services';
import type { UseGameStore } from '../store';
import { getEnemyManager } from '../ai/enemyManager';
import type { Enemy } from '../ai/enemy';
import { FxPool, initFxPool, shutdownFxPool } from './fx';
import { PlayerEffects, initPlayerEffects, shutdownPlayerEffects } from './incoming';
import { pushAttackClaim, clearAttackClaims } from './netClaims';
import { executeRuneCast, realmAbilityForRealm } from './runes';
import type { RuneProjectileSpec } from './runes';
import { buildConsumeOp, submitOp } from '../rpg/ops';
import {
  BOW_DRAW_STAMINA_PER_SEC, CONSUMABLE_SHARED_COOLDOWN_SEC,
  HEAVY_ATTACK_STAMINA_MULT, HEAVY_KIND_MULT, HEAVY_RECOVERY_EXTRA_SEC,
  LIGHT_KIND_MULT, RIPOSTE_MULT, RIPOSTE_WINDOW_SEC,
  attackSpeedMult, bowChargeMult, critProfile, hasUllrBlessing, hasWhirlwind,
  meleeArmorPen, meleePowerMult, rangedArmorPen, rangedPowerMult, resolveHit, staminaCostMult,
} from './stats';
import { Viewmodel } from './viewmodel';
import type { ArmsMode } from './viewmodel';

// ---------------------------------------------------------------------------
// Local tuning (feel values not pinned by contracts; documented in summary)
// ---------------------------------------------------------------------------
const HEAVY_HOLD_SEC = 0.3; // gdd §5.2: hold ≥300ms = heavy
const LIGHT_STRIKE_DELAY_SEC = 0.12;
const HEAVY_STRIKE_DELAY_SEC = 0.26;
const MELEE_ARC_DEG = 120; // gdd: swing raycast fan, 120° arc
const ARROW_LIFE_SEC = 5;
const ARROW_GRAVITY = 6; // arrows fly flatter than pure 9.8
const BOW_LOOSE_ATTACK_SPEED = 1.0; // bows: weapon.attackSpeed ≡ 1 in §5.2 formula
const CONSUME_ACK_FALLBACK_SEC = 1.5; // offline dev: apply effect if no ack
const BLOCK_REASSERT_SEC = 0.5;
const CHEAT_DEATH_NOTIFY = "Hel's Bargain holds — death takes payment once.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlayerProjectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  radius: number;
  life: number;
  school: DamageSchool;
  fx: { obj: THREE.Object3D; release(): void; isDone(): boolean } | null;
  resolveHitFor(enemy: Enemy): { amount: number; isCrit: boolean };
  onHitEnemy?(enemy: Enemy): void;
  claim: { attackKind: AttackKind; itemId: string; charge?: number };
  knockback?: number;
}

interface ScheduledStrike {
  at: number;
  kind: 'light' | 'heavy';
}

interface ConsumeOp {
  key: string; // the exact pendingOps entry (JSON)
  itemId: string;
  instanceId: string;
  startedAt: number;
  qtyAtStart: number;
  goneAt: number; // sim time the op was first seen missing from pendingOps
  applied: boolean;
}

interface InputEvent {
  action: string;
  phase: 'down' | 'up';
}

/** Optional engine surface the addendum promises beyond frozen services.ts. */
interface EnginePlayerExtras {
  setBlockState?(state: { blocking: boolean; blockRaisedAt: number | null }): void;
  getViewmodelRoot?(): THREE.Object3D;
}

function servicesOf(ctx: GameContext): ServiceRegistry | null {
  return (ctx as GameContext & { services?: ServiceRegistry }).services ?? null;
}

// ---------------------------------------------------------------------------
// Subsystem
// ---------------------------------------------------------------------------

export function createCombatSubsystem(): GameSubsystem {
  let ctx: GameContext | null = null;
  let fx: FxPool | null = null;
  let effects: PlayerEffects | null = null;
  let viewmodel: Viewmodel | null = null;
  let vmFallbackRoot: THREE.Group | null = null;
  const unsubs: (() => void)[] = [];

  // Sim clock
  let simNow = 0;

  // Input queue (filled by InputService callbacks, drained in fixedUpdate)
  const inputQueue: InputEvent[] = [];

  // Combat state
  let armsMode: ArmsMode = 'melee';
  let attackPressAt = -1;
  let meleeCooldownUntil = 0;
  const scheduledStrikes: ScheduledStrike[] = [];
  let blocking = false;
  let blockRaisedAtMs: number | null = null;
  let blockReassertAt = 0;
  let drawing = false;
  let drawStartedAt = 0;
  let drawCharge = 0;
  let bowCooldownUntil = 0;
  const runeCooldownUntil = [0, 0, 0, 0];
  let consumableCooldownUntil = 0;
  let realmAbilityUntil = 0;
  let abilityNoticeAt = 0;
  let staminaNoticeAt = 0;
  const consumeOps = new Map<string, ConsumeOp>();
  const projectiles: PlayerProjectile[] = [];
  let cheatDeathAt = -1e9;
  let drawFovBlend = 0;
  let baseFov = 80;
  let lastEquipKey = '';
  let lastPlayerPos = new THREE.Vector3();
  let playerMoving = false;

  // ---------------------------------------------------------------- helpers

  const store = (): UseGameStore => {
    if (!ctx) throw new Error('[combat] used before init');
    return ctx.store;
  };

  const playerSvc = (): (PlayerService & EnginePlayerExtras) | null =>
    (servicesOf(ctx as GameContext)?.get('player') ?? null) as (PlayerService & EnginePlayerExtras) | null;

  const terrainSvc = (): TerrainService | null => servicesOf(ctx as GameContext)?.get('terrain') ?? null;

  function spendStamina(amount: number): boolean {
    const s = store().getState();
    if (s.vitals.stamina < amount) return false;
    s.setVitals({ stamina: s.vitals.stamina - amount });
    return true;
  }

  function staminaExhaustedNotice(): void {
    if (simNow - staminaNoticeAt > 2) {
      staminaNoticeAt = simNow;
      store().getState().notify('warning', 'You are winded — stamina too low.');
      ctx?.events.emit('play_sfx', { sfxId: 'sfx.ui.error' });
    }
  }

  function equippedWeapon(): { def: WeaponDef; upgradeLevel: number } | null {
    const inst = store().getState().equipment.weapon;
    if (!inst) return null;
    const def = ITEMS[inst.itemId];
    if (!def || def.kind !== 'weapon') return null;
    return { def: def as WeaponDef, upgradeLevel: inst.upgradeLevel };
  }

  function equippedShield(): ShieldDef | null {
    const inst = store().getState().equipment.shield;
    if (!inst) return null;
    const def = ITEMS[inst.itemId];
    return def && def.kind === 'shield' ? (def as ShieldDef) : null;
  }

  /** The usable bow: weapon slot holding a bow, else first bow in inventory. */
  function usableBow(): { def: BowDef; upgradeLevel: number } | null {
    const s = store().getState();
    const slotInst = s.equipment.weapon;
    if (slotInst) {
      const def = ITEMS[slotInst.itemId];
      if (def && def.kind === 'bow') return { def: def as BowDef, upgradeLevel: slotInst.upgradeLevel };
    }
    for (const inst of s.items) {
      const def = ITEMS[inst.itemId];
      if (def && def.kind === 'bow') return { def: def as BowDef, upgradeLevel: inst.upgradeLevel };
    }
    return null;
  }

  function camDir(): THREE.Vector3 {
    const d = new THREE.Vector3();
    (ctx as GameContext).camera.getWorldDirection(d);
    return d.normalize();
  }

  function eyePos(): THREE.Vector3 {
    return (ctx as GameContext).camera.position.clone();
  }

  function playerFeet(): THREE.Vector3 {
    return playerSvc()?.getPosition() ?? eyePos().add(new THREE.Vector3(0, -1.7, 0));
  }

  function pushClaim(c: Omit<AttackClaimMsg, 't' | 'claimId' | 'clientTime'> & { charge?: number }): void {
    pushAttackClaim({
      ...c,
      claimId: `atk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      clientTime: Date.now(),
    });
  }

  // ---------------------------------------------------------------- blocking

  function setBlocking(next: boolean): void {
    const player = playerSvc();
    if (next) {
      if (!equippedShield() || armsMode !== 'melee') return;
      if (blocking) return;
      blocking = true;
      blockRaisedAtMs = performance.now();
      player?.setBlockState?.({ blocking: true, blockRaisedAt: blockRaisedAtMs });
      viewmodel?.setBlocking(true);
    } else {
      if (!blocking) return;
      blocking = false;
      blockRaisedAtMs = null;
      player?.setBlockState?.({ blocking: false, blockRaisedAt: null });
      viewmodel?.setBlocking(false);
    }
  }

  // ---------------------------------------------------------------- melee

  function tryStartAttack(): void {
    if (armsMode !== 'melee') return;
    if (attackPressAt >= 0) return;
    if (simNow < meleeCooldownUntil) return;
    attackPressAt = simNow;
  }

  function releaseAttack(): void {
    if (attackPressAt < 0) return;
    const held = simNow - attackPressAt;
    attackPressAt = -1;
    if (armsMode !== 'melee') return;
    if (simNow < meleeCooldownUntil) return;

    const weapon = equippedWeapon();
    if (!weapon) return;
    const s = store().getState();
    const kind: 'light' | 'heavy' = held >= HEAVY_HOLD_SEC ? 'heavy' : 'light';

    const costMult = staminaCostMult(s.skills);
    const cost = weapon.def.staminaCost * costMult * (kind === 'heavy' ? HEAVY_ATTACK_STAMINA_MULT : 1);
    if (!spendStamina(cost)) {
      staminaExhaustedNotice();
      return;
    }

    const slowMult = effects?.attackSlowMult() ?? 1;
    const cd = 1 / (weapon.def.attackSpeed * attackSpeedMult(s.skills) * slowMult);
    meleeCooldownUntil = simNow + cd + (kind === 'heavy' ? HEAVY_RECOVERY_EXTRA_SEC : 0);

    viewmodel?.triggerSwing(kind);
    ctx?.events.emit('play_sfx', { sfxId: kind === 'light' ? 'sfx.swing.light' : 'sfx.swing.heavy' });
    scheduledStrikes.push({
      at: simNow + (kind === 'light' ? LIGHT_STRIKE_DELAY_SEC : HEAVY_STRIKE_DELAY_SEC),
      kind,
    });
  }

  function resolveMeleeStrike(kind: 'light' | 'heavy'): void {
    const weapon = equippedWeapon();
    const manager = getEnemyManager();
    if (!weapon || !manager || !ctx) return;
    const s = store().getState();
    const origin = eyePos();
    const flatDir = camDir().setY(0).normalize();
    const targets = manager.enemiesInArc(origin, flatDir, weapon.def.range + 0.4, MELEE_ARC_DEG);
    if (targets.length === 0) return;

    const whirlwind = kind === 'heavy' && hasWhirlwind(s.skills);
    const hitList = whirlwind ? targets : targets.slice(0, 1);
    const feet = playerFeet();
    const kindMult = kind === 'heavy' ? HEAVY_KIND_MULT : LIGHT_KIND_MULT;
    let landed = false;

    for (const enemy of hitList) {
      const powerMult =
        meleePowerMult(s.skills, { playerHpFrac: s.vitals.hp / s.vitals.maxHp, targetHpFrac: enemy.hpFrac }) *
        (effects?.powerBuffMult() ?? 1) *
        (effects?.consumeRiposteMult(RIPOSTE_MULT) ?? 1);
      const hit = resolveHit({
        sourceDamage: weapon.def.damage,
        upgradeLevel: weapon.upgradeLevel,
        kindMult,
        chargeMult: 1,
        powerMult,
        crit: critProfile(s.skills, { gearCritChance: gearCritChanceFromEquipment() }),
        armorPen: meleeArmorPen(s.skills),
        targetArmor: enemy.def.armor,
      });
      const dir = camDir();
      manager.playerHitEnemy(enemy.id, hit.amount, {
        school: 'physical',
        isCrit: hit.isCrit,
        knockback: weapon.def.knockback * (kind === 'heavy' ? 1.6 : 1),
        fromPos: feet,
      });
      pushClaim({
        attackKind: kind,
        itemId: weapon.def.id,
        targetId: enemy.id,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        dir: { x: dir.x, y: dir.y, z: dir.z },
      });
      landed = true;
    }

    if (landed) {
      effects?.markDealtDamage();
      viewmodel?.triggerHitstop(); // 60ms hitstop
      ctx.events.emit('screen_shake', {
        intensity: kind === 'heavy' ? 0.45 : 0.22,
        durationMs: 60,
      });
    }
  }

  function gearCritChanceFromEquipment(): number {
    const s = store().getState();
    let crit = 0;
    for (const inst of Object.values(s.equipment)) {
      if (!inst) continue;
      const def = ITEMS[inst.itemId];
      if (def && def.kind === 'armor' && def.bonus?.critChance) crit += def.bonus.critChance;
    }
    return crit;
  }

  // ---------------------------------------------------------------- bow

  function startDraw(): void {
    if (armsMode !== 'bow') return;
    const bow = usableBow();
    if (!bow) return;
    if (drawing || simNow < bowCooldownUntil) return;
    drawing = true;
    drawStartedAt = simNow;
    drawCharge = 0;
    ctx?.events.emit('play_sfx', { sfxId: 'sfx.bow.draw' });
  }

  function looseArrow(force = false): void {
    if (!drawing) return;
    drawing = false;
    viewmodel?.setDraw(null);
    const bow = usableBow();
    const manager = getEnemyManager();
    if (!bow || !manager || !ctx) return;
    const charge = drawCharge;
    if (charge < 0.12 && !force) return; // accidental tap: no arrow

    const s = store().getState();
    const slowMult = effects?.attackSlowMult() ?? 1;
    bowCooldownUntil = simNow + 1 / (BOW_LOOSE_ATTACK_SPEED * attackSpeedMult(s.skills) * slowMult);

    const origin = eyePos();
    const dir = camDir();
    const upgradeLevel = bow.upgradeLevel;
    const def = bow.def;
    const chargeMult = bowChargeMult(charge);
    const outOfCombatCrit = hasUllrBlessing(s.skills) && (effects?.isOutOfCombat() ?? false);
    const skills = s.skills;

    const spec: PlayerProjectile = {
      pos: origin.clone().addScaledVector(dir, 0.4),
      vel: dir.clone().multiplyScalar(def.arrowSpeed),
      gravity: ARROW_GRAVITY,
      radius: 0.25,
      life: ARROW_LIFE_SEC,
      school: 'physical',
      fx: fx?.acquireProjectile(0xd8cfa8, 0.9) ?? null,
      resolveHitFor: (enemy) => {
        const st = store().getState();
        const distance = enemy.pos.distanceTo(playerFeet());
        const powerMult =
          rangedPowerMult(skills, { distanceM: distance, targetIsBeast: enemy.def.enemyClass === 'beast' }) *
          (effects?.powerBuffMult() ?? 1) *
          (effects?.consumeRiposteMult(RIPOSTE_MULT) ?? 1);
        return resolveHit({
          sourceDamage: def.damage,
          upgradeLevel,
          kindMult: 1,
          chargeMult,
          powerMult,
          crit: critProfile(st.skills, {
            gearCritChance: gearCritChanceFromEquipment(),
            bowCharge: charge,
            bowCritBonus: def.critBonus,
          }),
          armorPen: rangedArmorPen(st.skills),
          targetArmor: enemy.def.armor,
          forceCrit: outOfCombatCrit,
        });
      },
      claim: { attackKind: 'bow', itemId: def.id, charge },
      knockback: 1.5,
    };
    if (spec.fx) spec.fx.obj.position.copy(spec.pos);
    projectiles.push(spec);
    effects?.markDealtDamage();
    ctx.events.emit('play_sfx', { sfxId: 'sfx.bow.release' });
  }

  // ---------------------------------------------------------------- runes

  function tryCastRune(slot: number): void {
    const manager = getEnemyManager();
    if (!ctx || !manager || !effects) return;
    if (simNow < runeCooldownUntil[slot]) return;
    const result = executeRuneCast(slot, {
      now: simNow,
      store: store(),
      events: ctx.events,
      camera: ctx.camera,
      playerPos: playerFeet(),
      effects,
      manager,
    }, {
      spawnRuneProjectile: (spec: RuneProjectileSpec) => {
        const p: PlayerProjectile = {
          pos: spec.origin.clone().addScaledVector(spec.dir, 0.5),
          vel: spec.dir.clone().multiplyScalar(spec.speed),
          gravity: 0,
          radius: spec.radius,
          life: ARROW_LIFE_SEC,
          school: spec.school,
          fx: fx?.acquireProjectile(spec.color, 1.4) ?? null,
          resolveHitFor: spec.resolveHitFor,
          onHitEnemy: spec.onHitEnemy,
          claim: { attackKind: 'rune', itemId: spec.claimItemId },
        };
        if (p.fx) p.fx.obj.position.copy(p.pos);
        projectiles.push(p);
      },
      pushClaim: (claim) => pushAttackClaim(claim),
    });

    if (!result.ok) {
      if (result.reason === 'wyrd') {
        store().getState().notify('warning', 'Not enough wyrd.');
        ctx.events.emit('play_sfx', { sfxId: 'sfx.ui.error' });
      }
      return;
    }
    runeCooldownUntil[slot] = simNow + result.cooldownSec;
    if (result.school) viewmodel?.triggerCast(result.school);
    effects.markDealtDamage();
  }

  // ---------------------------------------------------------------- hotbar

  /** First 4 consumable stacks in inventory (gdd §4 slot order). */
  function hotbarConsumables(): { instanceId: string; def: ConsumableDef }[] {
    const s = store().getState();
    const out: { instanceId: string; def: ConsumableDef }[] = [];
    for (const inst of s.items) {
      const def = ITEMS[inst.itemId];
      if (def && def.kind === 'consumable') {
        out.push({ instanceId: inst.instanceId, def: def as ConsumableDef });
        if (out.length >= 4) break;
      }
    }
    return out;
  }

  function tryConsume(slot: number): void {
    if (simNow < consumableCooldownUntil) return;
    const entry = hotbarConsumables()[slot];
    if (!entry) return;
    // Canonical op layer (rpg/ops.ts): server-roundtrip consume op.
    const s = store().getState();
    const stack = s.items.find((i) => i.instanceId === entry.instanceId);
    if (!stack) return;
    const key = submitOp(buildConsumeOp(entry.instanceId));
    consumeOps.set(key, {
      key, itemId: entry.def.id, instanceId: entry.instanceId,
      startedAt: simNow, qtyAtStart: stack.qty, goneAt: 0, applied: false,
    });
    consumableCooldownUntil = simNow + CONSUMABLE_SHARED_COOLDOWN_SEC;
  }

  function applyConsumableEffect(itemId: string): void {
    const def = ITEMS[itemId];
    if (!def || def.kind !== 'consumable' || !effects || !ctx) return;
    const s = store().getState();
    const fx = def.effect;
    switch (fx.type) {
      case 'heal':
        effects.addHoT(fx.amount, fx.overSec);
        ctx.events.emit('play_sfx', { sfxId: 'sfx.heal' });
        break;
      case 'regen':
        effects.addRegen(fx.hpPerSec, fx.durationSec);
        ctx.events.emit('play_sfx', { sfxId: 'sfx.heal' });
        break;
      case 'restore_stamina':
        s.setVitals({ stamina: Math.min(s.vitals.maxStamina, s.vitals.stamina + fx.amount) });
        ctx.events.emit('play_sfx', { sfxId: 'sfx.ui.equip' });
        break;
      case 'restore_wyrd':
        s.setVitals({ wyrd: Math.min(s.vitals.maxWyrd, s.vitals.wyrd + fx.amount) });
        ctx.events.emit('play_sfx', { sfxId: 'sfx.ui.equip' });
        break;
      case 'buff_power':
        effects.addPowerBuff(fx.mult, fx.durationSec);
        ctx.events.emit('play_sfx', { sfxId: 'sfx.ui.equip' });
        break;
      case 'buff_defense':
        effects.addArmorBuff(fx.armor, fx.durationSec);
        ctx.events.emit('play_sfx', { sfxId: 'sfx.ui.equip' });
        break;
    }
  }

  /** Watch consume ops. Apply the effect exactly once when:
   *   1. the stack is observed consumed (authoritative ack path), or
   *   2. offline: the op stays pending past the fallback (no transport), or
   *  If the op leaves pendingOps with no consumption observed, the server
   *  rejected it — drop the op without applying. */
  function watchConsumeOps(): void {
    const s = store().getState();
    for (const op of consumeOps.values()) {
      if (op.applied) continue;
      const pending = s.pendingOps.includes(op.key);
      const stack = s.items.find((i) => i.instanceId === op.instanceId);
      const consumed = !stack || stack.qty < op.qtyAtStart;
      if (consumed) {
        op.applied = true;
        applyConsumableEffect(op.itemId);
        continue;
      }
      if (!pending) {
        if (op.goneAt === 0) op.goneAt = simNow;
        // Grace window for the post-ack snapshot to land.
        if (simNow - op.goneAt > 0.4) op.applied = true; // rejected: no effect
        continue;
      }
      if (simNow - op.startedAt > CONSUME_ACK_FALLBACK_SEC) {
        op.applied = true; // offline dev: apply optimistically, exactly once
        applyConsumableEffect(op.itemId);
      }
    }
    // Drop finished ops after a grace period.
    for (const [key, op] of consumeOps) {
      if (op.applied && simNow - op.startedAt > 5) consumeOps.delete(key);
    }
  }

  // ---------------------------------------------------------------- realm ability

  function tryRealmAbility(): void {
    if (!ctx) return;
    if (simNow < realmAbilityUntil) return;
    const terrain = terrainSvc();
    const realm = terrain?.realmId ?? 'midgard';
    const cfg = REALMS[realm];
    const s = store().getState();
    const active = realmAbilityForRealm(cfg?.realmAbilityId, s.realmAbilities);
    if (!active) {
      if (simNow - abilityNoticeAt > 5) {
        abilityNoticeAt = simNow;
        const ability = cfg ? REALM_ABILITIES[cfg.realmAbilityId] : undefined;
        s.notify(
          'info',
          ability && s.realmAbilities.includes(ability.id)
            ? `${ability.name} flows through you always.`
            : 'No realm ability answers you here yet.',
        );
      }
      return;
    }
    // Ljós-Step: blink forward.
    const player = playerSvc();
    if (!player) return;
    const dir = camDir().setY(0).normalize();
    const dest = playerFeet().addScaledVector(dir, active.rangeM);
    const t = terrainSvc();
    if (t) dest.y = t.sampleHeight(dest.x, dest.z);
    fx?.spawnImpact(playerFeet().add(new THREE.Vector3(0, 1, 0)), 0xfff2c8, 8, 3);
    player.teleport({ x: dest.x, y: dest.y, z: dest.z });
    fx?.spawnImpact(dest.clone().add(new THREE.Vector3(0, 1, 0)), 0xfff2c8, 8, 3);
    realmAbilityUntil = simNow + active.cooldownSec;
    ctx.events.emit('play_sfx', { sfxId: 'sfx.portal.travel', volume: 0.5 });
  }

  // ---------------------------------------------------------------- input dispatch

  function dispatchInput(ev: InputEvent): void {
    const s = store().getState();
    // Menus swallow gameplay input (engine keeps cursor unlocked there anyway).
    if (s.activeMenu !== 'none' || s.dead) return;

    switch (ev.action) {
      case 'attack':
        if (ev.phase === 'down') {
          if (armsMode === 'melee') tryStartAttack();
          else startDraw();
        } else {
          if (armsMode === 'melee') releaseAttack();
          else looseArrow();
        }
        break;
      case 'block':
        setBlocking(ev.phase === 'down');
        break;
      case 'swapArms':
        if (ev.phase === 'down') toggleArms();
        break;
      case 'rune1': case 'rune2': case 'rune3': case 'rune4':
        if (ev.phase === 'down') tryCastRune(Number(ev.action.slice(-1)) - 1);
        break;
      case 'hotbar1': case 'hotbar2': case 'hotbar3': case 'hotbar4':
        if (ev.phase === 'down') tryConsume(Number(ev.action.slice(-1)) - 1);
        break;
      case 'realmAbility':
        if (ev.phase === 'down') tryRealmAbility();
        break;
      case 'dodge':
        if (ev.phase === 'down') {
          // Engine owns the dodge roll, i-frames AND the stamina cost
          // (reconciliation: engine charges DODGE_STAMINA_COST — do not
          // double-charge here).
          ctx?.events.emit('play_sfx', { sfxId: 'sfx.dodge' });
        }
        break;
    }
  }

  function toggleArms(): void {
    if (armsMode === 'melee') {
      if (!usableBow()) {
        store().getState().notify('info', 'No bow at your side.');
        return;
      }
      armsMode = 'bow';
      setBlocking(false);
    } else {
      armsMode = 'melee';
      if (drawing) {
        drawing = false; // stowing the bow cancels the draw (no arrow spent)
        drawCharge = 0;
        viewmodel?.setDraw(null);
      }
    }
    viewmodel?.setArmsMode(armsMode);
    ctx?.events.emit('play_sfx', { sfxId: 'sfx.ui.equip' });
  }

  function cancelTransientStates(): void {
    attackPressAt = -1;
    scheduledStrikes.length = 0;
    if (drawing) {
      drawing = false;
      drawCharge = 0;
      viewmodel?.setDraw(null);
    }
    setBlocking(false);
  }

  // ---------------------------------------------------------------- death watch

  function deathWatch(): void {
    const s = store().getState();
    if (s.dead || s.vitals.hp > 0) return;
    // ra_helheim: Hel's Bargain — cheat death (cooldown from skills.ts).
    const bargain = REALM_ABILITIES['ra_helheim'];
    const cheatCd = bargain?.effect.type === 'passive_cheat_death' ? bargain.effect.cooldownSec : 600;
    if (s.realmAbilities.includes('ra_helheim') && simNow - cheatDeathAt >= cheatCd) {
      cheatDeathAt = simNow;
      s.setVitals({ hp: 1 });
      s.notify('warning', CHEAT_DEATH_NOTIFY);
      ctx?.events.emit('play_sfx', { sfxId: 'sfx.cast.spirit' });
      return;
    }
    // Guard on the dead flag: if the engine already handled it, don't double.
    if (store().getState().dead) return;
    s.setDead(true);
    ctx?.events.emit('player_died', { sourceId: effects?.getLastDamageSource() ?? 'unknown' });
  }

  // ---------------------------------------------------------------- projectiles

  function tickProjectiles(dt: number): void {
    const manager = getEnemyManager();
    const terrain = terrainSvc();
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      let dead = p.life <= 0;

      if (!dead && manager) {
        const enemies = manager.listAlive();
        for (const enemy of enemies) {
          if (enemy.dead || enemy.friendly) continue;
          const center = enemy.pos.clone();
          center.y += enemy.rig.height * 0.55;
          if (p.pos.distanceTo(center) <= enemy.rig.radius + p.radius) {
            const hit = p.resolveHitFor(enemy);
            manager.playerHitEnemy(enemy.id, hit.amount, {
              school: p.school, isCrit: hit.isCrit,
              knockback: p.knockback, fromPos: p.pos,
            });
            p.onHitEnemy?.(enemy);
            if (p.claim.attackKind === 'bow') {
              const dir = p.vel.clone().normalize();
              pushClaim({
                attackKind: 'bow', itemId: p.claim.itemId, targetId: enemy.id,
                origin: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
                dir: { x: dir.x, y: dir.y, z: dir.z },
                charge: p.claim.charge,
              });
            }
            effects?.markDealtDamage();
            fx?.spawnImpact(p.pos, p.school === 'physical' ? 0xd8cfa8 : 0xffffff, 7, 3);
            ctx?.events.emit('play_sfx', {
              sfxId: p.claim.attackKind === 'bow' ? 'sfx.arrow.hit' : 'sfx.enemy.hit',
              position: p.pos,
            });
            dead = true;
            break;
          }
        }
      }

      if (!dead && terrain && p.pos.y <= terrain.sampleHeight(p.pos.x, p.pos.z) + 0.05) {
        fx?.spawnImpact(p.pos, 0x9a8f6a, 5, 2);
        dead = true;
      }

      if (dead) {
        p.fx?.release();
        projectiles.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- loadout sync

  function refreshLoadout(force = false): void {
    const s = store().getState();
    const bow = usableBow();
    const key = [
      s.equipment.weapon?.instanceId ?? '',
      s.equipment.weapon?.upgradeLevel ?? 0,
      s.equipment.shield?.instanceId ?? '',
      bow?.def.id ?? '',
    ].join('|');
    if (!force && key === lastEquipKey) return;
    lastEquipKey = key;
    const weapon = equippedWeapon();
    viewmodel?.setLoadout(weapon?.def ?? null, equippedShield(), bow?.def ?? null);
  }

  // ---------------------------------------------------------------- subsystem

  return {
    id: 'combat',

    init(c: GameContext): void {
      ctx = c;
      const services = servicesOf(c);

      fx = initFxPool(c.scene);
      effects = initPlayerEffects(c.store, () => playerSvc());
      // Kaldbjǫrg thorns → frost damage back at the attacker.
      effects.onThorns = (enemyId, amount) => {
        getEnemyManager()?.damageEnemy(enemyId, amount, { school: 'ice' });
      };

      viewmodel = new Viewmodel();
      const player = playerSvc();
      const vmRoot = player?.getViewmodelRoot?.();
      if (vmRoot) {
        viewmodel.attach(vmRoot);
      } else {
        // Fallback: own camera-synced root (engine seam absent).
        vmFallbackRoot = new THREE.Group();
        c.scene.add(vmFallbackRoot);
        viewmodel.attach(vmFallbackRoot);
      }
      refreshLoadout(true);

      // Input bindings (queued; drained in fixedUpdate).
      const input = services?.get('input') ?? null;
      if (!input) console.warn('[combat] input service unavailable at init');
      const watched = [
        'attack', 'block', 'swapArms', 'realmAbility', 'dodge',
        'rune1', 'rune2', 'rune3', 'rune4',
        'hotbar1', 'hotbar2', 'hotbar3', 'hotbar4',
      ] as const;
      if (input) {
        for (const action of watched) {
          unsubs.push(
            input.onAction(action, (phase) => {
              inputQueue.push({ action, phase });
              if (inputQueue.length > 32) inputQueue.splice(0, inputQueue.length - 32);
            }),
          );
        }
      }

      // Parry / block feedback from the engine damage pipeline.
      unsubs.push(
        c.events.on('player_hurt', (p) => {
          const fxPool = fx;
          if (p.parried) {
            effects?.grantRiposte(RIPOSTE_WINDOW_SEC);
            fxPool?.spawnParryRing(playerFeet());
            c.events.emit('play_sfx', { sfxId: 'sfx.parry' });
          } else if (p.blocked) {
            const sparkPos = eyePos().addScaledVector(camDir(), 0.7);
            fxPool?.spawnBlockSpark(sparkPos);
            c.events.emit('play_sfx', { sfxId: 'sfx.block' });
          }
        }),
      );

      // Equipment changes rebuild the viewmodel.
      unsubs.push(
        c.store.subscribe(() => refreshLoadout()),
      );

      baseFov = c.camera.fov; // engine owns the camera; we only offset it
      lastPlayerPos = playerFeet();
    },

    fixedUpdate(dt: number): void {
      if (!ctx || !effects) return;
      simNow += dt;
      const s = store().getState();

      // Drain queued input.
      for (let i = 0; i < inputQueue.length; i++) dispatchInput(inputQueue[i]);
      inputQueue.length = 0;

      // Menus/death cancel held actions.
      if (s.activeMenu !== 'none' || s.dead) {
        cancelTransientStates();
      }

      // Held melee attack: reaching the heavy threshold while held shows the
      // heavy windup early (viewmodel only — the release resolves the kind).
      if (attackPressAt >= 0 && armsMode === 'melee') {
        // nothing else; resolve on release
      }

      // Bow draw: charge up + stamina drain.
      if (drawing && armsMode === 'bow') {
        const bow = usableBow();
        if (!bow || s.activeMenu !== 'none' || s.dead) {
          drawing = false;
          drawCharge = 0;
          viewmodel?.setDraw(null);
        } else {
          const drawTime = bow.def.drawTime / attackSpeedMult(s.skills);
          drawCharge = Math.min(1, (simNow - drawStartedAt) / Math.max(0.05, drawTime));
          const drain = BOW_DRAW_STAMINA_PER_SEC * dt;
          if (s.vitals.stamina <= 0.5) {
            looseArrow(true); // spent: loose at whatever charge we have
          } else {
            s.setVitals({ stamina: Math.max(0, s.vitals.stamina - drain) });
          }
        }
      }

      // Scheduled melee strikes land.
      for (let i = scheduledStrikes.length - 1; i >= 0; i--) {
        if (simNow >= scheduledStrikes[i].at) {
          const strike = scheduledStrikes[i];
          scheduledStrikes.splice(i, 1);
          if (s.activeMenu === 'none' && !s.dead) resolveMeleeStrike(strike.kind);
        }
      }

      // Re-assert block state for late-initialized engines.
      if (blocking && simNow >= blockReassertAt) {
        blockReassertAt = simNow + BLOCK_REASSERT_SEC;
        playerSvc()?.setBlockState?.({ blocking: true, blockRaisedAt: blockRaisedAtMs });
      }

      effects.tick(dt);
      tickProjectiles(dt);
      watchConsumeOps();
      deathWatch();
    },

    update(dt: number, _alpha: number): void {
      if (!ctx || !viewmodel) return;
      const c = ctx;

      // FX pool + projectile visuals.
      fx?.update(dt, c.camera);
      for (const p of projectiles) {
        if (p.fx && !p.fx.isDone()) p.fx.obj.position.copy(p.pos);
      }

      // Fallback camera mount (engine seam absent).
      if (vmFallbackRoot) {
        vmFallbackRoot.position.copy(c.camera.position);
        vmFallbackRoot.quaternion.copy(c.camera.quaternion);
      }

      // Movement heuristic for viewmodel bob.
      const feet = playerFeet();
      playerMoving = feet.distanceTo(lastPlayerPos) / Math.max(dt, 1e-4) > 0.6;
      lastPlayerPos.copy(feet);

      // Bow FOV zoom: −10 at full draw (gdd §5.2). Base FOV is tracked from
      // the engine camera whenever we are not drawing.
      const drawTarget = drawing ? 1 : 0;
      drawFovBlend += (drawTarget - drawFovBlend) * Math.min(1, dt * 6);
      const cam = c.camera;
      if (drawFovBlend < 0.02 && !drawing) baseFov = cam.fov; // follow engine
      const targetFov = baseFov - 10 * drawFovBlend;
      if (Math.abs(cam.fov - targetFov) > 0.05) {
        cam.fov = targetFov;
        cam.updateProjectionMatrix();
      }

      viewmodel.setDraw(drawing ? drawCharge : null);
      viewmodel.update(dt, { moving: playerMoving });
    },

    dispose(): void {
      for (const u of unsubs) u();
      unsubs.length = 0;
      // Restore FOV if we were mid-draw.
      if (ctx) {
        ctx.camera.fov = baseFov;
        ctx.camera.updateProjectionMatrix();
      }
      for (const p of projectiles) p.fx?.release();
      projectiles.length = 0;
      clearAttackClaims();
      viewmodel?.dispose();
      viewmodel = null;
      vmFallbackRoot?.parent?.remove(vmFallbackRoot);
      vmFallbackRoot = null;
      shutdownPlayerEffects();
      shutdownFxPool();
      effects = null;
      fx = null;
      ctx = null;
    },
  };
}
