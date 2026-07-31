// ============================================================================
// CORESAPIAN — src/game/ai/enemyManager.ts (combat-ai)
//
// Owns every live enemy: spawning (realm spawnTable rings, population caps,
// elites, realm/world bosses), the EnemyService registry implementation,
// strike resolution (melee arcs, ranged projectiles, boss signature moves),
// enemy projectiles + ground hazards, loot drops (gold magnet + item
// interactables), boss bars + boss_engaged/disengaged, and death cleanup.
// ============================================================================

import * as THREE from 'three';

import type { AttackPattern } from '../../../contracts/enemies';
import { ALL_ENEMIES, WORLD_BOSS_HP_PER_PLAYER } from '../../../contracts/enemies';
import { ITEMS, LOOT_TABLES } from '../../../contracts/items';
import type { NotificationKind } from '../../../contracts/types';
import type { DamageSchool, RealmId, Vec3 } from '../../../contracts/types';
import { REALMS, getRealmTier } from '../config';
import type { GameEventBus } from '../events';
import type { InteractableService, PlayerService, TerrainService } from '../services';
import type { UseGameStore } from '../store';
import { getFxPool } from '../combat/fx';
import { getPlayerEffects } from '../combat/incoming';
import { buildLootGoldOp, buildLootItemOp, submitOp } from '../rpg/ops';
import { Enemy } from './enemy';
import type { EnemySpawnOptions } from './enemy';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const SPAWN_INTERVAL_SEC = 2.0;
const SPAWN_RING_MIN_M = 40;
const SPAWN_RING_MAX_M = 90;
const DESPAWN_RADIUS_M = 120;
const ELITE_CHANCE = 0.08;
const BOSS_SPAWN_RADIUS_M = 140; // spawn the realm boss when the player nears
const LOOT_TTL_SEC = 60;
const GOLD_MAGNET_RADIUS_M = 2.5;
const CORPSE_CLEANUP_SEC = 3.2;
const ENEMY_PROJECTILE_LIFE_SEC = 6;
const DEAGGRO_ON_DEATH_RADIUS_M = 40; // gdd §11.2

/** Population cap per realm: 10 at t1, up to 16 at t7+. */
function populationCap(realmTier: number): number {
  return 10 + Math.min(6, Math.max(0, realmTier));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnemyProjectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  damage: number;
  school: DamageSchool;
  radius: number;
  sourceId: string;
  life: number;
  fx: { obj: THREE.Object3D; release(): void; isDone(): boolean } | null;
  dot?: { perSec: number; durationSec: number };
}

interface GroundHazard {
  pos: THREE.Vector3;
  radius: number;
  damage: number;
  school: DamageSchool;
  /** Seconds before the hazard goes live (telegraph shows meanwhile). */
  delay: number;
  until: number;
  nextTickAt: number;
  sourceId: string;
  fx: { release(): void; isDone(): boolean } | null;
  dot?: { perSec: number; durationSec: number };
}

/** Player-cast fields that hinder enemies (Niflgrip). */
interface EnemyField {
  pos: THREE.Vector3;
  radius: number;
  dps: number;
  school: DamageSchool;
  slowMult?: number;
  until: number;
  nextTickAt: number;
  fx: { release(): void; isDone(): boolean } | null;
}

interface LootDrop {
  id: string;
  kind: 'gold' | 'item';
  itemId?: string;
  qty?: number;
  amount?: number;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  unregister: (() => void) | null;
  despawnAt: number;
  opStarted: boolean;
}

interface DashState {
  until: number;
  dir: THREE.Vector3;
  speed: number;
  damage: number;
  school: DamageSchool;
  hitDone: boolean;
  stunOnMiss: boolean;
}

export interface EnemyManagerApi {
  readonly events: GameEventBus;
  damageEnemyInternal(enemy: Enemy, amount: number, opts: { school?: DamageSchool; isCrit?: boolean; silent?: boolean }): void;
  despawnEnemy(enemyId: string): void;
  packAlert(packId: string, fromId: string, radius: number, vargrOnly: boolean): void;
  telegraph(pos: Vec3 | THREE.Vector3, radius: number, durationSec: number, color: number): void;
  notify(kind: NotificationKind, text: string): void;
  onBossEngaged(enemy: Enemy): void;
  onBossDisengaged(enemy: Enemy): void;
  resolveStrike(enemy: Enemy, pattern: AttackPattern): void;
  resolveFriendlyStrike(enemy: Enemy, pattern: AttackPattern): void;
  spawnPhaseSummons(boss: Enemy, enemyId: string, count: number): void;
  maybeDropFireTrail(enemy: Enemy, now: number): void;
  nearestHostileTo(pos: THREE.Vector3, range: number): Enemy | null;
  nearestAggroedTo(pos: THREE.Vector3, range: number): Enemy | null;
  snapToTerrain(pos: THREE.Vector3): void;
}

// ---------------------------------------------------------------------------
// Pattern school mapping (contract patterns don't carry a school; flavor map)
// ---------------------------------------------------------------------------

function patternSchool(defId: string, patternId: string): DamageSchool {
  if (defId === 'eldjotunn' || defId === 'boss_logi' || defId === 'wboss_surtr') return 'fire';
  if (defId === 'hrimthurs' || defId === 'boss_hrimgrimnir') return 'ice';
  if (defId === 'boss_thrym') return patternId === 'iceboulder' ? 'ice' : 'physical';
  if (defId === 'dokkalf') return patternId === 'shadowbolt' ? 'spirit' : 'physical';
  if (defId === 'boss_gullveig') return patternId === 'seidr_lash' ? 'spirit' : 'fire';
  if (defId === 'wboss_hraesvelgr') return 'storm';
  return 'physical';
}

// DoT riders per pattern (per-second + duration), from the pattern notes in
// contracts/enemies.ts — those numbers exist only in prose, so they are
// pinned here once (see summary).
function patternDot(defId: string, patternId: string): { perSec: number; durationSec: number } | undefined {
  if (defId === 'eldjotunn' && patternId === 'cinder_fist') return { perSec: 3, durationSec: 3 };
  if (defId === 'boss_logi' && patternId === 'emberlash') return { perSec: 4, durationSec: 3 };
  if (defId === 'boss_loki' && patternId === 'venom_drip') return { perSec: 6, durationSec: 5 };
  if (defId === 'wboss_nidhogg' && patternId === 'rot_breath') return { perSec: 8, durationSec: 4 };
  return undefined;
}

// Ranged patterns → enemy projectile speeds (no contract field; feel values).
const PROJECTILE_SPEED: Record<string, number> = {
  shadowbolt: 16, sky_lance: 24, iceboulder: 17, venom_drip: 18,
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class EnemyManager implements EnemyManagerApi {
  readonly events: GameEventBus;
  private readonly store: UseGameStore;
  private readonly scene: THREE.Scene;
  private readonly getService: {
    player: () => PlayerService | null;
    terrain: () => TerrainService | null;
    interactables: () => InteractableService | null;
  };

  private readonly enemies = new Map<string, Enemy>();
  private readonly projectiles: EnemyProjectile[] = [];
  private readonly hazards: GroundHazard[] = [];
  private readonly enemyFields: EnemyField[] = [];
  private readonly lootDrops: LootDrop[] = [];
  private readonly dashes = new Map<string, DashState>();

  private simNow = 0;
  private spawnTimer = 2;
  private lootSeq = 0;
  private realmId: RealmId | null = null;
  private engagedBossId: string | null = null;
  private lastFireTrailAt = 0;

  constructor(opts: {
    scene: THREE.Scene;
    store: UseGameStore;
    events: GameEventBus;
    services: {
      player: () => PlayerService | null;
      terrain: () => TerrainService | null;
      interactables: () => InteractableService | null;
    };
  }) {
    this.scene = opts.scene;
    this.store = opts.store;
    this.events = opts.events;
    this.getService = opts.services;
  }

  private interactables(): InteractableService | null {
    return this.getService.interactables();
  }

  // ------------------------------------------------------------ queries

  listAlive(): Enemy[] {
    const out: Enemy[] = [];
    for (const e of this.enemies.values()) if (!e.dead) out.push(e);
    return out;
  }

  getById(id: string): Enemy | null {
    return this.enemies.get(id) ?? null;
  }

  /** Enemies whose body sphere intersects a horizontal arc fan. */
  enemiesInArc(origin: THREE.Vector3, forward: THREE.Vector3, range: number, arcDeg: number): Enemy[] {
    const fwd = forward.clone().setY(0).normalize();
    const half = (arcDeg / 2) * (Math.PI / 180);
    const out: Enemy[] = [];
    for (const e of this.enemies.values()) {
      if (e.dead || e.friendly) continue;
      const to = e.pos.clone().sub(origin);
      to.y = 0;
      const dist = to.length() - e.rig.radius;
      if (dist > range) continue;
      // Vertical sanity: ignore targets far above/below the swing plane.
      if (Math.abs(e.pos.y - origin.y) > 3) continue;
      const angle = to.lengthSq() < 0.0001 ? 0 : Math.acos(Math.max(-1, Math.min(1, to.normalize().dot(fwd))));
      if (angle <= half) out.push(e);
    }
    // Closest first.
    out.sort((a, b) => a.pos.distanceTo(origin) - b.pos.distanceTo(origin));
    return out;
  }

  nearestHostileTo(pos: THREE.Vector3, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of this.enemies.values()) {
      if (e.dead || e.friendly || e.isIllusion) continue;
      const d = e.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  nearestAggroedTo(pos: THREE.Vector3, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of this.enemies.values()) {
      if (e.dead || e.friendly || !e.aggro) continue;
      const d = e.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Nearest hostile to the player within `range`, preferring view direction. */
  nearestForChain(origin: THREE.Vector3, forward: THREE.Vector3, range: number, excludeIds: Set<string>): Enemy | null {
    const fwd = forward.clone().setY(0).normalize();
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies.values()) {
      if (e.dead || e.friendly || excludeIds.has(e.id)) continue;
      const to = e.pos.clone().sub(origin);
      const d = to.length();
      if (d > range) continue;
      const alignment = d > 0.001 ? to.normalize().setY(0).dot(fwd) : 1;
      const score = d * (1.5 - Math.max(0, alignment)); // prefer close + centered
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  snapToTerrain(pos: THREE.Vector3): void {
    const terrain = this.getService.terrain();
    if (terrain) pos.y = terrain.sampleHeight(pos.x, pos.z);
  }

  // ------------------------------------------------------------ spawning

  /** EnemyService: spawn an enemy of any def id at a position. */
  spawnEnemy(enemyType: string, pos: Vec3, opts?: { elite?: boolean; realmTier?: number }): string {
    const def = ALL_ENEMIES[enemyType];
    if (!def) {
      console.warn(`[ai] unknown enemy type "${enemyType}"`);
      return '';
    }
    const realm = this.getService.terrain()?.realmId ?? this.realmId ?? 'midgard';
    const tier = opts?.realmTier ?? getRealmTier(realm);
    const enemy = this.addEnemy(def.id, pos, { elite: opts?.elite, tier });
    return enemy.id;
  }

  addEnemy(defId: string, pos: Vec3, opts: EnemySpawnOptions = {}): Enemy {
    const def = ALL_ENEMIES[defId];
    if (!def) throw new Error(`[ai] unknown enemy def "${defId}"`);
    const realm = this.getService.terrain()?.realmId ?? this.realmId ?? 'midgard';
    const realmTier = getRealmTier(realm);
    const spawnPos = { ...pos };
    const tmp = new THREE.Vector3(spawnPos.x, spawnPos.y, spawnPos.z);
    this.snapToTerrain(tmp);
    spawnPos.y = tmp.y;

    // World bosses gain +50% hp per extra participating player (nearby orbs).
    if (defId.startsWith('wboss_') && opts.hpOverride === undefined) {
      const s = this.store.getState();
      let participants = 1;
      for (const rp of Object.values(s.remotePlayers)) {
        const dx = rp.position.x - spawnPos.x;
        const dz = rp.position.z - spawnPos.z;
        if (dx * dx + dz * dz < 80 * 80) participants++;
      }
      opts = { ...opts, hpOverride: Math.round(def.baseStats.hp * (1 + WORLD_BOSS_HP_PER_PLAYER * (participants - 1))) };
    }

    const enemy = new Enemy(def, spawnPos, opts, realmTier, this.scene);
    this.enemies.set(enemy.id, enemy);
    return enemy;
  }

  despawnEnemy(enemyId: string): void {
    const e = this.enemies.get(enemyId);
    if (!e) return;
    if (this.engagedBossId === e.id) this.onBossDisengaged(e);
    e.dispose();
    this.enemies.delete(enemyId);
    this.dashes.delete(enemyId);
  }

  /** Fylgja summon (rune_fylgja): a friendly wolf at the player's side. */
  summonFylgja(pos: Vec3, durationSec: number): string {
    const wolf = this.addEnemy('summon_fylgja_wolf', pos, {
      friendly: true,
      tier: 1, // Fylgja fights at its printed stats (8 dmg / 1.2s bite)
    });
    wolf.expiresAt = this.simNow + durationSec;
    return wolf.id;
  }

  /** Loki's Mirror Image: two 300hp illusions flanking the real one. */
  spawnIllusions(loki: Enemy): void {
    for (const side of [-1, 1]) {
      const pos = { x: loki.pos.x + side * 2.4, y: loki.pos.y, z: loki.pos.z + 1.2 };
      const ill = this.addEnemy('boss_loki', pos, { isIllusion: true, hpOverride: 300, tier: 1 });
      ill.forceAggro();
    }
  }

  /** Hitting the real Loki dispels both mirror images. */
  private dispelIllusions(): void {
    for (const e of [...this.enemies.values()]) {
      if (e.isIllusion) this.despawnEnemy(e.id);
    }
  }

  spawnPhaseSummons(boss: Enemy, enemyId: string, count: number): void {
    const tier = boss.tier;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const pos = {
        x: boss.pos.x + Math.cos(a) * 4,
        y: boss.pos.y,
        z: boss.pos.z + Math.sin(a) * 4,
      };
      const add = this.addEnemy(enemyId, pos, { tier, packId: `summon_${boss.id}` });
      add.forceAggro();
    }
    this.events.emit('play_sfx', { sfxId: 'sfx.cast.spirit', position: boss.pos });
  }

  packAlert(packId: string, fromId: string, radius: number, vargrOnly: boolean): void {
    const from = this.enemies.get(fromId);
    if (!from) return;
    for (const e of this.enemies.values()) {
      if (e.id === fromId || e.dead || e.friendly) continue;
      if (vargrOnly && e.def.id !== 'vargr') continue;
      if (!vargrOnly && packId && e.packId !== packId) continue;
      if (e.pos.distanceTo(from.pos) <= radius) e.forceAggro();
    }
  }

  // ------------------------------------------------------------ damage

  /** Central enemy-damage entry (player hits, dots, thorns, fields). */
  damageEnemyInternal(enemy: Enemy, amount: number, opts: { school?: DamageSchool; isCrit?: boolean; silent?: boolean; fromPos?: THREE.Vector3; knockback?: number }): void {
    if (enemy.dead) return;
    const school = opts.school ?? 'physical';
    enemy.applyDamage(amount, opts);
    // Hitting one packmate pulls the pack (gdd §7.2 pack tactics).
    if (!opts.silent && enemy.packId && !enemy.friendly) {
      this.packAlert(enemy.packId, enemy.id, 25, false);
    }
    const fxPos = enemy.pos.clone();
    fxPos.y += enemy.rig.height * 0.72;
    if (!opts.silent) {
      this.events.emit('damage_number', {
        amount: Math.round(amount * 10) / 10,
        isCrit: opts.isCrit === true,
        school,
        position: fxPos,
        killed: false,
      });
      this.events.emit('play_sfx', { sfxId: 'sfx.enemy.hit', position: fxPos, volume: 0.6 });
    }
    // Hitting the real Loki dispels his mirror images.
    if (enemy.def.id === 'boss_loki' && !enemy.isIllusion) this.dispelIllusions();
    // Boss bar mirrors hp while engaged.
    if (enemy.isBoss && this.engagedBossId === enemy.id) {
      this.store.getState().setBossBar({ name: enemy.def.name, hp: enemy.hp, maxHp: enemy.maxHp });
    }
    if (enemy.hp <= 0) this.killEnemy(enemy, amount, school, opts.isCrit === true, fxPos);
  }

  /** Frozen EnemyService surface for world/rpg agents. */
  damageEnemy(enemyId: string, amount: number, opts?: { school?: DamageSchool; isCrit?: boolean }): void {
    const e = this.enemies.get(enemyId);
    if (e) this.damageEnemyInternal(e, amount, opts ?? {});
  }

  /** Combat-side hit with knockback context; returns post-hit state. */
  playerHitEnemy(enemyId: string, amount: number, opts: { school?: DamageSchool; isCrit?: boolean; knockback?: number; fromPos?: THREE.Vector3 }): { killed: boolean; hp: number; maxHp: number } | null {
    const e = this.enemies.get(enemyId);
    if (!e || e.dead) return null;
    this.damageEnemyInternal(e, amount, opts);
    return { killed: e.dead, hp: e.hp, maxHp: e.maxHp };
  }

  applyDotTo(enemyId: string, perSec: number, durationSec: number, school: DamageSchool): void {
    this.enemies.get(enemyId)?.applyDot(perSec, durationSec, school, this.simNow);
  }

  applySlowTo(enemyId: string, mult: number, durationSec: number): void {
    this.enemies.get(enemyId)?.applySlow(mult, durationSec, this.simNow);
  }

  /** Niflgrip-style field: slows + chips enemies standing inside. */
  addEnemyField(opts: { pos: THREE.Vector3; radius: number; durationSec: number; dps: number; school: DamageSchool; slowMult?: number }): void {
    const fx = getFxPool()?.groundField(opts.pos, opts.radius, opts.durationSec, opts.school === 'ice' ? 0x9fdcff : 0xffffff) ?? null;
    this.enemyFields.push({
      pos: opts.pos.clone(), radius: opts.radius, dps: opts.dps, school: opts.school,
      slowMult: opts.slowMult, until: this.simNow + opts.durationSec,
      nextTickAt: this.simNow + 0.5, fx,
    });
  }

  private killEnemy(enemy: Enemy, killingBlow: number, school: DamageSchool, isCrit: boolean, fxPos: THREE.Vector3): void {
    enemy.die(this.simNow);
    this.events.emit('damage_number', {
      amount: Math.round(killingBlow * 10) / 10,
      isCrit, school, position: fxPos, killed: true,
    });
    this.events.emit('play_sfx', { sfxId: enemy.isBoss ? 'sfx.boss.roar' : 'sfx.enemy.die', position: fxPos });
    if (!enemy.friendly && !enemy.isIllusion) {
      // XP: rpg-quests owns Progression writes (addendum §6).
      const source = enemy.isBoss ? `boss:${enemy.def.id}` : enemy.def.id;
      this.events.emit('xp_gain', { amount: enemy.xp, source });
      this.spawnLoot(enemy);
    }
    if (enemy.isBoss && this.engagedBossId === enemy.id) {
      this.onBossDisengaged(enemy);
    }
  }

  // ------------------------------------------------------------ strikes

  telegraph(pos: Vec3 | THREE.Vector3, radius: number, durationSec: number, color: number): void {
    const p = pos instanceof THREE.Vector3 ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    this.snapToTerrain(p);
    getFxPool()?.telegraph(p, radius, durationSec, color);
  }

  notify(kind: NotificationKind, text: string): void {
    this.store.getState().notify(kind, text);
  }

  /** Player-facing damage route (ward → buff armor → resists → engine). */
  private hitPlayer(raw: number, sourceId: string, school: DamageSchool, dot?: { perSec: number; durationSec: number }): void {
    const variance = 0.92 + Math.random() * 0.16;
    const amount = Math.round(raw * variance * 10) / 10;
    getPlayerEffects()?.routeToPlayer(amount, { sourceId, school });
    if (dot) getPlayerEffects()?.addDoT(dot.perSec, dot.durationSec, school, sourceId);
  }

  /** Resolve one enemy attack pattern at the end of its windup. */
  resolveStrike(enemy: Enemy, pattern: AttackPattern): void {
    const player = this.getService.player();
    const fx = getFxPool();
    const playerPos = player?.getPosition();
    const dmgBase = enemy.damage * pattern.damageMult * enemy.currentDamageMult();
    const school = patternSchool(enemy.def.id, pattern.id);
    const dot = patternDot(enemy.def.id, pattern.id);
    const strikePos = enemy.pos.clone();
    strikePos.y += enemy.rig.height * 0.6;

    const hitConnect = (): boolean => {
      if (!playerPos) return false;
      const dist = enemy.pos.distanceTo(playerPos);
      const arc = pattern.arcDeg ?? 130;
      if (arc >= 360) return dist <= pattern.range + 0.6;
      if (dist > pattern.range + 0.6) return false;
      const toPlayer = playerPos.clone().sub(enemy.pos).setY(0).normalize();
      const facing = new THREE.Vector3(Math.sin(enemy.yaw), 0, Math.cos(enemy.yaw));
      const cosHalf = Math.cos((arc / 2) * (Math.PI / 180));
      return toPlayer.dot(facing) >= cosHalf;
    };

    const meleeImpact = () => {
      if (hitConnect()) {
        this.hitPlayer(dmgBase, enemy.id, school, dot);
        this.events.emit('play_sfx', { sfxId: 'sfx.hit.flesh', position: playerPos });
      }
      fx?.spawnImpact(strikePos, school === 'fire' ? 0xff7a33 : school === 'ice' ? 0x9fdcff : 0xd8cfa8, 6, 2.6);
    };

    switch (pattern.id) {
      // --- simple melee arcs ---
      default: {
        if (PROJECTILE_SPEED[pattern.id]) {
          this.spawnEnemyProjectile(enemy, pattern, dmgBase, school, PROJECTILE_SPEED[pattern.id], dot);
        } else {
          meleeImpact();
        }
        break;
      }

      case 'slam': // troll 360° ground slam
      case 'coil_slam':
      case 'hoard_nova':
      case 'chainwhip':
      case 'grave_howl':
      case 'oath_wail': {
        meleeImpact();
        if (enemy.rig.height > 2.4) this.events.emit('screen_shake', { intensity: 0.35, durationMs: 120 });
        break;
      }

      case 'shockwave': { // Þrymr: jump to avoid
        const grounded = player?.isGrounded() ?? true;
        if (playerPos && enemy.pos.distanceTo(playerPos) <= pattern.range + 0.5 && grounded) {
          this.hitPlayer(dmgBase, enemy.id, school);
          this.events.emit('play_sfx', { sfxId: 'sfx.hit.flesh', position: playerPos });
        }
        this.events.emit('screen_shake', { intensity: 0.5, durationMs: 160 });
        break;
      }

      case 'pounce':
      case 'lunge':
      case 'charge': { // dash attacks; Dáinn wall-stuns on a miss
        const dir = playerPos ? playerPos.clone().sub(enemy.pos).setY(0).normalize() : new THREE.Vector3(Math.sin(enemy.yaw), 0, Math.cos(enemy.yaw));
        this.dashes.set(enemy.id, {
          until: this.simNow + 0.28,
          dir,
          speed: pattern.range / 0.28,
          damage: dmgBase,
          school,
          hitDone: false,
          stunOnMiss: pattern.id === 'charge',
        });
        break;
      }

      case 'chain_of_gnipa': { // drag the player to melee range
        if (playerPos && player && enemy.pos.distanceTo(playerPos) <= pattern.range + 2) {
          const toward = playerPos.clone().sub(enemy.pos).setY(0).normalize();
          const dest = enemy.pos.clone().addScaledVector(toward, 1.8);
          this.snapToTerrain(dest);
          player.teleport({ x: dest.x, y: dest.y, z: dest.z });
          this.hitPlayer(dmgBase, enemy.id, school);
          this.events.emit('play_sfx', { sfxId: 'sfx.hit.flesh', position: playerPos });
        }
        break;
      }

      case 'eruption': // eldjotunn: delayed ground burst under the player
        if (playerPos) this.addHazard(playerPos, 3, dmgBase, school, 0.8, enemy.id, dot);
        break;

      case 'spike_field': { // hrimgrimnir: spikes erupt in sequence toward player
        if (playerPos) {
          const dir = playerPos.clone().sub(enemy.pos).setY(0).normalize();
          for (let i = 0; i < 3; i++) {
            const p = enemy.pos.clone().addScaledVector(dir, 2.2 + i * 2.2);
            this.addHazard(p, 2, dmgBase, school, 0.3 + i * 0.28, enemy.id);
          }
        }
        break;
      }

      case 'thornwave': { // dainn: expanding ring of root-thorns
        for (let i = 0; i < 3; i++) {
          this.addHazard(enemy.pos, 2.5 + i * 2.4, dmgBase, school, 0.25 + i * 0.3, enemy.id);
        }
        break;
      }

      case 'pyre_bloom': { // gullveig: three burning runes underfoot
        if (playerPos) {
          for (let i = 0; i < 3; i++) {
            const p = playerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
            this.addHazard(p, 2.2, dmgBase, school, 0.35 + i * 0.35, enemy.id, { perSec: 4, durationSec: 3 });
          }
        }
        break;
      }

      case 'cinder_rain': { // surtr: targeted fire geysers
        if (playerPos) {
          for (let i = 0; i < 3; i++) {
            const p = playerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
            this.addHazard(p, 2.5, dmgBase, 'fire', 0.9, enemy.id);
          }
        }
        break;
      }

      case 'eruption_ring': { // logi: ring of fire pillars
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const p = enemy.pos.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6));
          this.addHazard(p, 2, dmgBase, 'fire', 0.5, enemy.id);
        }
        break;
      }

      case 'pyroclasm': { // surtr: arena wave with a safe wedge
        if (playerPos) {
          const gapAngle = Math.random() * Math.PI * 2;
          const toPlayer = Math.atan2(playerPos.x - enemy.pos.x, playerPos.z - enemy.pos.z);
          let diff = Math.abs(toPlayer - gapAngle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          const inSafeGap = diff < 0.6; // ~35° wedge
          if (enemy.pos.distanceTo(playerPos) <= pattern.range + 1 && !inSafeGap) {
            this.hitPlayer(dmgBase, enemy.id, 'fire', { perSec: 4, durationSec: 3 });
          }
          getFxPool()?.telegraph(enemy.pos, pattern.range * 0.5, 0.5, 0xff5a26);
          this.events.emit('screen_shake', { intensity: 0.5, durationMs: 200 });
        }
        break;
      }

      case 'storm_front': { // hraesvelgr: gale with one safe pocket
        if (playerPos) {
          const pocket = enemy.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));
          this.snapToTerrain(pocket);
          getFxPool()?.groundField(pocket, 3, 2.5, 0x9fdcff);
          if (enemy.pos.distanceTo(playerPos) <= pattern.range + 2 && playerPos.distanceTo(pocket) > 3) {
            this.hitPlayer(dmgBase, enemy.id, 'storm');
          }
        }
        break;
      }

      case 'curse': { // andvari: gold-curse DoT
        if (playerPos && enemy.pos.distanceTo(playerPos) <= pattern.range + 2) {
          this.hitPlayer(dmgBase, enemy.id, school, { perSec: 2, durationSec: 6 });
          this.notify('warning', "Andvaranaut's curse grips your gold!");
        }
        break;
      }

      case 'gold_lust': { // gullveig: charm — player attack speed −40%, 4s
        if (playerPos && enemy.pos.distanceTo(playerPos) <= pattern.range + 2) {
          this.hitPlayer(dmgBase, enemy.id, school);
          getPlayerEffects()?.addAttackSlow(0.6, 4);
        }
        break;
      }

      case 'whiteout': { // hrimgrimnir: blinding fog (vision fx owned by world)
        if (playerPos && enemy.pos.distanceTo(playerPos) <= pattern.range + 4) {
          this.hitPlayer(dmgBase, enemy.id, 'ice');
          this.notify('warning', 'The Whiteout swallows the world — fight by sound!');
          this.events.emit('screen_shake', { intensity: 0.3, durationMs: 400 });
        }
        break;
      }

      case 'mirror_image': { // loki: two illusions
        this.spawnIllusions(enemy);
        this.events.emit('play_sfx', { sfxId: 'sfx.cast.spirit', position: enemy.pos });
        break;
      }

      case 'realm_shift': { // loki: roaming realm hazards in the arena
        const center = enemy.arenaCenter ?? enemy.pos;
        const schools: DamageSchool[] = ['ice', 'fire', 'storm'];
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * 10;
          const p = center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
          this.addHazard(p, 3, dmgBase, schools[i % schools.length], 0.6 + i * 0.4, enemy.id);
        }
        this.notify('info', 'The arena shifts between realms!');
        break;
      }
    }
  }

  /** Fylgja (and future summons) striking hostiles. Only enemies already
   *  fighting the player are valid — summons never pull fresh packs. */
  resolveFriendlyStrike(enemy: Enemy, pattern: AttackPattern): void {
    const target = this.nearestAggroedTo(enemy.pos, pattern.range + 1.2);
    if (!target) return;
    const dmg = enemy.damage * pattern.damageMult;
    this.damageEnemyInternal(target, dmg, { school: 'spirit', fromPos: enemy.pos });
    getFxPool()?.spawnImpact(target.pos.clone().setY(target.pos.y + 1), 0x9fdcff, 5, 2.2);
  }

  maybeDropFireTrail(enemy: Enemy, now: number): void {
    if (now - this.lastFireTrailAt < 0.5) return;
    this.lastFireTrailAt = now;
    const trailDmg = enemy.damage * 0.8 * enemy.currentDamageMult();
    this.addHazard(enemy.pos, 1.6, trailDmg, 'fire', 0, enemy.id, { perSec: 4, durationSec: 3 }, 3);
  }

  private addHazard(
    at: THREE.Vector3, radius: number, damage: number, school: DamageSchool,
    delay: number, sourceId: string,
    dot?: { perSec: number; durationSec: number },
    durationSec = 0.6,
  ): void {
    const pos = at.clone();
    this.snapToTerrain(pos);
    const color = school === 'fire' ? 0xff5a26 : school === 'ice' ? 0x9fdcff : school === 'storm' ? 0xbfe8ff : 0xd8a0ff;
    const fxPool = getFxPool();
    const fx = fxPool
      ? delay > 0.05
        ? fxPool.telegraph(pos, radius, delay, color)
        : fxPool.groundField(pos, radius, durationSec, color)
      : null;
    this.hazards.push({
      pos, radius, damage, school, delay, sourceId,
      until: this.simNow + delay + durationSec,
      nextTickAt: this.simNow + delay,
      fx, dot,
    });
  }

  private spawnEnemyProjectile(enemy: Enemy, pattern: AttackPattern, damage: number, school: DamageSchool, speed: number, dot?: { perSec: number; durationSec: number }): void {
    const player = this.getService.player();
    const playerPos = player?.getPosition();
    if (!playerPos) return;
    const origin = enemy.pos.clone();
    origin.y += enemy.rig.height * 0.7;
    // Aim at the chest with a touch of lead.
    const target = playerPos.clone();
    target.y += 1.2;
    const dir = target.sub(origin).normalize();
    const fx = getFxPool()?.acquireProjectile(
      school === 'fire' ? 0xff7a33 : school === 'ice' ? 0x9fdcff : school === 'storm' ? 0xbfe8ff : 0xb080ff,
      1.6,
    ) ?? null;
    if (fx) fx.obj.position.copy(origin);
    this.projectiles.push({
      pos: origin, vel: dir.multiplyScalar(speed),
      gravity: pattern.id === 'iceboulder' ? 9.8 : 0,
      damage, school, radius: 0.5, sourceId: enemy.id,
      life: ENEMY_PROJECTILE_LIFE_SEC, fx, dot,
    });
    this.events.emit('play_sfx', { sfxId: 'sfx.cast.storm', position: enemy.pos, volume: 0.5 });
  }

  // ------------------------------------------------------------ loot

  private spawnLoot(enemy: Enemy): void {
    const basePos = enemy.pos.clone();
    // Gold auto-magnet drop on every kill (amount derived from xp value —
    // no contract field exists; pinned here, see summary).
    const goldAmount = Math.max(2, Math.round(enemy.xp * 0.35 * (enemy.isBoss ? 5 : 1)));
    this.addLootDrop('gold', basePos, { amount: goldAmount });

    const tableId = enemy.def.lootTable;
    if (!tableId) return;
    const table = LOOT_TABLES[tableId];
    if (!table) return;
    for (const entry of table) {
      if (Math.random() > entry.chance) continue;
      const qty = entry.qtyMin + Math.floor(Math.random() * (entry.qtyMax - entry.qtyMin + 1));
      const offset = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6);
      this.addLootDrop('item', basePos.clone().add(offset), { itemId: entry.itemId, qty });
    }
  }

  private addLootDrop(kind: 'gold' | 'item', pos: THREE.Vector3, data: { amount?: number; itemId?: string; qty?: number }): void {
    const id = `loot_${++this.lootSeq}`;
    const color = kind === 'gold' ? 0xffd76a : 0x9fd4ff;
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(kind === 'gold' ? 0.14 : 0.17, 0),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.9,
        roughness: 0.3, metalness: 0.2, flatShading: true,
      }),
    );
    const p = pos.clone();
    this.snapToTerrain(p);
    p.y += 0.45;
    mesh.position.copy(p);
    this.scene.add(mesh);

    const itemName = data.itemId ? ITEMS[data.itemId]?.name ?? data.itemId : null;
    const drop: LootDrop = {
      id, kind, itemId: data.itemId, qty: data.qty, amount: data.amount,
      pos: p, mesh, unregister: null,
      despawnAt: this.simNow + LOOT_TTL_SEC,
      opStarted: false,
    };

    const interactables = this.interactables();
    if (kind === 'item' && interactables) {
      // Items: E-to-pickup (addendum §6); gold uses the auto-magnet check below.
      drop.unregister = interactables.register({
        id,
        kind: 'loot',
        prompt: `E — Take ${itemName}${(data.qty ?? 1) > 1 ? ` ×${data.qty}` : ''}`,
        position: p.clone(),
        radius: 2.5,
        onInteract: () => this.collectLoot(drop),
      });
    }
    this.lootDrops.push(drop);
  }

  private collectLoot(drop: LootDrop): void {
    if (drop.opStarted) return;
    drop.opStarted = true;
    // Canonical op layer (rpg/ops.ts): loot grants are client-local ops,
    // settled synchronously by the rpg subsystem.
    submitOp(
      drop.kind === 'gold'
        ? buildLootGoldOp(drop.amount ?? 0)
        : buildLootItemOp(drop.itemId ?? '', drop.qty ?? 1),
    );
    this.events.emit('play_sfx', { sfxId: 'sfx.loot', position: drop.pos });
    this.removeLootDrop(drop);
  }

  private removeLootDrop(drop: LootDrop): void {
    drop.unregister?.();
    drop.mesh.geometry.dispose();
    (drop.mesh.material as THREE.Material).dispose();
    drop.mesh.parent?.remove(drop.mesh);
    const idx = this.lootDrops.indexOf(drop);
    if (idx >= 0) this.lootDrops.splice(idx, 1);
  }

  // ------------------------------------------------------------ boss hooks

  onBossEngaged(enemy: Enemy): void {
    if (this.engagedBossId === enemy.id) return;
    this.engagedBossId = enemy.id;
    this.events.emit('boss_engaged', { enemyId: enemy.id, name: enemy.def.name });
    this.events.emit('play_sfx', { sfxId: 'sfx.boss.roar', position: enemy.pos });
    this.store.getState().setBossBar({ name: enemy.def.name, hp: enemy.hp, maxHp: enemy.maxHp });
  }

  onBossDisengaged(enemy: Enemy): void {
    if (this.engagedBossId !== enemy.id) return;
    this.engagedBossId = null;
    this.events.emit('boss_disengaged', { enemyId: enemy.id });
    this.store.getState().setBossBar(null);
  }

  // ------------------------------------------------------------ sim tick

  fixedUpdate(dt: number): void {
    this.simNow += dt;
    const now = this.simNow;
    const player = this.getService.player();
    const playerPos = player?.getPosition() ?? new THREE.Vector3();
    const store = this.store.getState();
    const terrain = this.getService.terrain();
    const realm = terrain?.realmId ?? this.realmId ?? 'midgard';
    this.realmId = realm;

    // Population maintenance + boss spawns.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL_SEC;
      this.maintainPopulation(realm, playerPos);
    }

    const ctx = {
      now, dt,
      playerPos,
      playerAlive: !store.dead,
      aggroRangeMult: aggroMultFromSkills(store.skills),
      manager: this as EnemyManagerApi,
    };

    for (const e of [...this.enemies.values()]) {
      // Far culling (never bosses/engaged/friendly).
      if (!e.isBoss && !e.friendly && !e.aggro && e.pos.distanceTo(playerPos) > DESPAWN_RADIUS_M) {
        this.despawnEnemy(e.id);
        continue;
      }
      // Boss spawn/reset driven by proximity to the arena.
      if (e.isBoss && !e.isIllusion) e.tryEngage({ now, playerPos, manager: this });
      e.tick(ctx);
      // Corpse cleanup.
      if (e.dead && now - e.diedAt > CORPSE_CLEANUP_SEC) {
        this.despawnEnemy(e.id);
      }
    }

    this.tickDashes(ctx, dt);
    this.tickProjectiles(dt, playerPos);
    this.tickHazards(dt, playerPos);
    this.tickEnemyFields(dt);
    this.tickLoot(dt, playerPos);
  }

  /** Weighted spawn from the realm's spawnTable in a ring around the player. */
  private maintainPopulation(realm: RealmId, playerPos: THREE.Vector3): void {
    const cfg = REALMS[realm];
    if (!cfg) return;
    const tier = getRealmTier(realm);

    // Realm boss at its arena when the player approaches.
    const arena = new THREE.Vector3(cfg.bossArenaOffset.x, cfg.bossArenaOffset.y, cfg.bossArenaOffset.z);
    this.snapToTerrain(arena);
    const bossAlive = [...this.enemies.values()].some((e) => e.def.id === cfg.bossEnemyId);
    if (!bossAlive && playerPos.distanceTo(arena) < BOSS_SPAWN_RADIUS_M) {
      this.addEnemy(cfg.bossEnemyId, arena, { arenaCenter: arena, tier });
    }

    // Count ambient hostiles (not bosses, summons, or event spawns).
    let ambient = 0;
    for (const e of this.enemies.values()) {
      if (!e.dead && !e.isBoss && !e.friendly && !e.eventId && !e.isIllusion) ambient++;
    }
    const cap = populationCap(tier);
    if (ambient >= cap || cfg.spawnTable.length === 0) return;

    // Weighted pick.
    let totalWeight = 0;
    for (const entry of cfg.spawnTable) totalWeight += entry.weight;
    let roll = Math.random() * totalWeight;
    let entry = cfg.spawnTable[0];
    for (const e of cfg.spawnTable) {
      roll -= e.weight;
      if (roll <= 0) { entry = e; break; }
    }

    const packSize = entry.packMin + Math.floor(Math.random() * (entry.packMax - entry.packMin + 1));
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_RING_MIN_M + Math.random() * (SPAWN_RING_MAX_M - SPAWN_RING_MIN_M);
    const center = new THREE.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      0,
      playerPos.z + Math.sin(angle) * dist,
    );
    const packId = `pack_${Math.floor(this.simNow)}_${Math.floor(Math.random() * 1e6)}`;
    for (let i = 0; i < packSize && ambient + i < cap; i++) {
      const pos = {
        x: center.x + (Math.random() - 0.5) * 6,
        y: 0,
        z: center.z + (Math.random() - 0.5) * 6,
      };
      this.addEnemy(entry.enemyId, pos, {
        elite: Math.random() < ELITE_CHANCE,
        tier: entry.tier,
        packId,
      });
    }
  }

  private tickDashes(ctx: { now: number; playerPos: THREE.Vector3 }, dt: number): void {
    for (const [id, dash] of [...this.dashes]) {
      const e = this.enemies.get(id);
      if (!e || e.dead || ctx.now >= dash.until) {
        if (e && !e.dead && !dash.hitDone && dash.stunOnMiss) {
          e.applyStagger(2, ctx.now); // Dáinn wall-stun
          this.events.emit('play_sfx', { sfxId: 'sfx.hit.armor', position: e.pos });
        }
        this.dashes.delete(id);
        continue;
      }
      e.pos.addScaledVector(dash.dir, dash.speed * dt);
      this.snapToTerrain(e.pos);
      if (!dash.hitDone && e.pos.distanceTo(ctx.playerPos) < 1.4) {
        dash.hitDone = true;
        this.hitPlayer(dash.damage, e.id, dash.school);
        this.events.emit('play_sfx', { sfxId: 'sfx.hit.flesh', position: ctx.playerPos });
      }
    }
  }

  private tickProjectiles(dt: number, playerPos: THREE.Vector3): void {
    const terrain = this.getService.terrain();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      let dead = p.life <= 0;

      // Player capsule test.
      if (!dead) {
        const dx = p.pos.x - playerPos.x;
        const dz = p.pos.z - playerPos.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz < p.radius + 0.5 && p.pos.y > playerPos.y - 0.2 && p.pos.y < playerPos.y + 1.9) {
          this.hitPlayer(p.damage, p.sourceId, p.school, p.dot);
          this.events.emit('play_sfx', { sfxId: 'sfx.hit.flesh', position: playerPos });
          dead = true;
        }
      }
      // Terrain hit.
      if (!dead && terrain && p.pos.y <= terrain.sampleHeight(p.pos.x, p.pos.z) + 0.1) {
        getFxPool()?.spawnImpact(p.pos, p.school === 'fire' ? 0xff7a33 : 0x9fdcff, 6, 2.4);
        dead = true;
      }
      if (dead) {
        p.fx?.release();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private tickHazards(dt: number, playerPos: THREE.Vector3): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (this.simNow >= h.until) {
        h.fx?.release();
        this.hazards.splice(i, 1);
        continue;
      }
      if (h.delay > 0) {
        h.delay -= dt;
        continue;
      }
      if (this.simNow < h.nextTickAt) continue;
      h.nextTickAt = this.simNow + 0.5;
      const dx = playerPos.x - h.pos.x;
      const dz = playerPos.z - h.pos.z;
      if (Math.hypot(dx, dz) <= h.radius && Math.abs(playerPos.y - h.pos.y) < 3) {
        this.hitPlayer(h.damage, h.sourceId, h.school, h.dot);
        getFxPool()?.spawnImpact(playerPos.clone().setY(playerPos.y + 1), h.school === 'fire' ? 0xff7a33 : 0x9fdcff, 6, 2.6);
      }
    }
  }

  private tickEnemyFields(dt: number): void {
    for (let i = this.enemyFields.length - 1; i >= 0; i--) {
      const f = this.enemyFields[i];
      if (this.simNow >= f.until) {
        f.fx?.release();
        this.enemyFields.splice(i, 1);
        continue;
      }
      const tickNow = this.simNow >= f.nextTickAt;
      if (tickNow) f.nextTickAt = this.simNow + 0.5;
      if (!tickNow) continue;
      for (const e of this.enemies.values()) {
        if (e.dead || e.friendly) continue;
        const dx = e.pos.x - f.pos.x;
        const dz = e.pos.z - f.pos.z;
        if (Math.hypot(dx, dz) > f.radius) continue;
        if (f.slowMult !== undefined) e.applySlow(f.slowMult, 0.6, this.simNow);
        if (f.dps > 0) {
          this.damageEnemyInternal(e, f.dps * 0.5, { school: f.school, silent: true });
        }
      }
      void dt;
    }
  }

  private tickLoot(dt: number, playerPos: THREE.Vector3): void {
    for (let i = this.lootDrops.length - 1; i >= 0; i--) {
      const drop = this.lootDrops[i];
      if (this.simNow >= drop.despawnAt) {
        this.removeLootDrop(drop);
        continue;
      }
      drop.mesh.rotation.y += dt * 2.4;
      drop.mesh.position.y = drop.pos.y + Math.sin(this.simNow * 2.5 + i) * 0.07;
      // Gold auto-magnet (gdd §4: 2.5m).
      if (drop.kind === 'gold' && !drop.opStarted) {
        if (drop.pos.distanceTo(playerPos) <= GOLD_MAGNET_RADIUS_M) {
          this.collectLoot(drop);
        }
      }
    }
  }

  // ------------------------------------------------------------ frame

  update(dt: number, camera: THREE.Camera): void {
    for (const e of this.enemies.values()) e.updateVisual(dt, camera);
    // Projectile visuals follow their sim positions.
    for (const p of this.projectiles) {
      if (p.fx && !p.fx.isDone()) p.fx.obj.position.copy(p.pos);
    }
  }

  // ------------------------------------------------------------ lifecycle

  /** Realm switch: tear down all local entities; population rebuilds. */
  resetForRealm(): void {
    for (const e of [...this.enemies.values()]) this.despawnEnemy(e.id);
    for (const p of this.projectiles) p.fx?.release();
    this.projectiles.length = 0;
    for (const h of this.hazards) h.fx?.release();
    this.hazards.length = 0;
    for (const f of this.enemyFields) f.fx?.release();
    this.enemyFields.length = 0;
    for (const l of [...this.lootDrops]) this.removeLootDrop(l);
    this.dashes.clear();
    this.spawnTimer = SPAWN_INTERVAL_SEC;
    this.realmId = null;
  }

  /** Player died (gdd §11.2): enemies within 40m deaggro, arenas reset. */
  onPlayerDied(): void {
    const playerPos = this.getService.player()?.getPosition();
    if (!playerPos) return;
    for (const e of this.enemies.values()) {
      if (e.dead || e.friendly) continue;
      if (e.pos.distanceTo(playerPos) <= DEAGGRO_ON_DEATH_RADIUS_M || e.isBoss) {
        if (e.isBoss && e.engaged) this.onBossDisengaged(e);
        e.deaggro();
      }
    }
    for (const p of this.projectiles) p.fx?.release();
    this.projectiles.length = 0;
    for (const h of this.hazards) h.fx?.release();
    this.hazards.length = 0;
  }

  dispose(): void {
    this.resetForRealm();
    this.enemies.clear();
  }
}

// ---------------------------------------------------------------------------
// sk_hun_silent: enemy aggro range −15%/rank (ai-side rank lookup per skills.ts)
// ---------------------------------------------------------------------------

function aggroMultFromSkills(skills: Record<string, number>): number {
  const rank = skills['sk_hun_silent'] ?? 0;
  return Math.pow(0.85, rank);
}

// ---------------------------------------------------------------------------
// Module singleton — combat imports this to resolve hits against enemies.
// ============================================================================

let manager: EnemyManager | null = null;

export function setEnemyManager(m: EnemyManager | null): void {
  manager = m;
}

export function getEnemyManager(): EnemyManager | null {
  return manager;
}
