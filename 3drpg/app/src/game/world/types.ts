// ============================================================================
// CORESAPIAN — src/game/world/types.ts
// Internal shared types for the world subsystem. Not a cross-agent seam.
// ============================================================================

import type * as THREE from 'three';

import type { GameContext } from '../Game';
import type { Collider, Interactable, ServiceRegistry, Services } from '../services';
import type { RealmConfig } from '../../../contracts/realms';

/**
 * GameContext + the service registry pinned by integration addendum §2.
 * `services` is typed optional so the world still boots (degraded, visuals
 * only) if a future engine build omits the registry; the real engine always
 * provides it before subsystem init.
 */
export type WorldContext = GameContext & { services?: ServiceRegistry };

/** A piece of a realm build that may animate and must be disposable. */
export interface RealmModule {
  update?(dt: number, elapsed: number): void;
  dispose(): void;
}

/**
 * Handed to every realm builder (props, portals, nodes). Terrain is built
 * first, so `sampleHeight` is always available; `colliders` is the shared
 * static-collider list surfaced through the TerrainService.
 */
export interface RealmBuildCtx {
  readonly ctx: WorldContext;
  readonly config: RealmConfig;
  /** Root group for the realm — everything generated parents here. */
  readonly root: THREE.Group;
  sampleHeight(x: number, z: number): number;
  /** Terrain slope estimate (0 flat .. ~1 cliff) at a point. */
  sampleSlope(x: number, z: number): number;
  /** Shared mutable static collider list (props/nodes push into this). */
  readonly colliders: Collider[];
  /** Register an engine interactable; unregistration is tracked for teardown. */
  interact(item: Interactable): void;
}

/** Safe service lookup — never throws, resolved fresh at each call site. */
export function getService<K extends keyof Services>(
  ctx: WorldContext,
  key: K,
): Services[K] | undefined {
  return ctx.services?.get(key);
}
