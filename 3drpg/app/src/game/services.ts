// ============================================================================
// CORESAPIAN — src/game/services.ts
// FROZEN integration seam (orchestrator addendum v1). Nobody modifies this file.
//
// Cross-agent runtime wiring: providers register services into
// `ctx.services` during their subsystem's init(); consumers resolve them with
// `ctx.services.get(...)` — NEVER cache a service reference across frames
// (world re-registers `terrain` on every realm change).
//
// Providers:  player → engine · interactables → engine · input → engine
//             terrain → world · enemies → combat-ai
// ============================================================================

import type * as THREE from "three";
import type { RealmId, Vec3, DamageSchool } from "../../contracts/types";

export type Collider =
  | { kind: "sphere"; x: number; y: number; z: number; r: number }
  | { kind: "cylinder"; x: number; z: number; r: number; y0: number; y1: number }
  | { kind: "box"; min: Vec3; max: Vec3 };

/** engine → everyone: local player capsule + camera state. */
export interface PlayerService {
  /** World-space FEET position of the player capsule. */
  getPosition(out?: THREE.Vector3): THREE.Vector3;
  getYaw(): number;
  getPitch(): number;
  isGrounded(): boolean;
  teleport(pos: Vec3, yaw?: number): void;
  /** Route damage INTO the local player (enemy hits resolved by combat-ai). */
  damage(amount: number, opts?: { sourceId?: string; school?: DamageSchool }): void;
  heal(amount: number): void;
  /** Camera shake shorthand (also emits screen_shake). */
  shake(intensity: number, durationMs: number): void;
}

/** world → engine/others: active-realm terrain queries. Re-registered on realm change. */
export interface TerrainService {
  readonly realmId: RealmId;
  sampleHeight(x: number, z: number): number;
  getColliders(): Collider[];
  getSpawnPoint(): Vec3;
}

export type InteractableKind = "npc" | "portal" | "loot" | "node" | "prop";

export interface Interactable {
  id: string;
  kind: InteractableKind;
  /** e.g. "E — Talk to Hulda". */
  prompt: string;
  position: THREE.Vector3;
  radius: number;
  /** Channel time in ms (portals 1200, harvest nodes 1500); taking damage cancels. */
  channelMs?: number;
  isAvailable?(): boolean;
  onInteract(): void;
}

/** engine owns the registry; world / rpg-quests / combat-ai register their entities. */
export interface InteractableService {
  register(item: Interactable): () => void;
}

/**
 * engine → combat/rpg: locked action names —
 * "attack" "block" "interact" "jump" "sprint" "dodge" "swapArms" "realmAbility"
 * "rune1" "rune2" "rune3" "rune4" "hotbar1" "hotbar2" "hotbar3" "hotbar4"
 */
export interface InputService {
  isDown(action: string): boolean;
  onAction(action: string, cb: (phase: "down" | "up") => void): () => void;
}

/** combat-ai → rpg-quests / world: enemy lifecycle hooks. */
export interface EnemyService {
  damageEnemy(enemyId: string, amount: number, opts?: { school?: DamageSchool; isCrit?: boolean }): void;
  spawnEnemy(enemyType: string, pos: Vec3, opts?: { elite?: boolean; realmTier?: number }): string;
  despawnEnemy(enemyId: string): void;
}

/** world → everyone: realm state + travel (portal travel and server-restore both use travelTo). */
export interface RealmService {
  current(): RealmId;
  /** Derived from quest completion per contracts/quests chapter rewards (+ midgard always). */
  isUnlocked(id: RealmId): boolean;
  /** Full realm switch: terrain/sky/prop regen + player move + realm_change event. */
  travelTo(id: RealmId, opts?: { spawnOverride?: Vec3 }): void;
}

export interface Services {
  player: PlayerService;
  terrain: TerrainService;
  interactables: InteractableService;
  input: InputService;
  enemies: EnemyService;
  realms: RealmService;
}

export type ServiceKey = keyof Services;

export class ServiceRegistry {
  private readonly map = new Map<ServiceKey, unknown>();

  register<K extends ServiceKey>(key: K, svc: Services[K]): void {
    this.map.set(key, svc);
  }

  get<K extends ServiceKey>(key: K): Services[K] | undefined {
    return this.map.get(key) as Services[K] | undefined;
  }

  require<K extends ServiceKey>(key: K): Services[K] {
    const s = this.get(key);
    if (!s) throw new Error(`[game] missing service: ${String(key)}`);
    return s;
  }
}
