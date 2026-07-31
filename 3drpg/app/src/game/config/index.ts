// ============================================================================
// CORESAPIAN — src/game/config/index.ts (SCAFFOLD-OWNED, FROZEN)
// Static game configuration: realm helpers re-exported from contracts/realms,
// simulation constants, and the GameConfig bundle handed to every subsystem
// via GameContext (gdd.md §3.2).
// ============================================================================

import type { RealmId } from '../../../contracts/types';
import { REALM_IDS } from '../../../contracts/types';
import type { RealmConfig } from '../../../contracts/realms';
import { HOME_REALM, REALMS, realmTier } from '../../../contracts/realms';

// ---------------------------------------------------------------------------
// Simulation constants (gdd.md §3.3 — fixed 60Hz timestep)
// ---------------------------------------------------------------------------

/** Fixed simulation step (60 Hz). */
export const SIM_DT = 1 / 60;
/** Max catch-up steps per frame before the remainder is dropped. */
export const MAX_SIM_STEPS = 5;

// ---------------------------------------------------------------------------
// Realm helpers
// ---------------------------------------------------------------------------

/** Unlock/story order of the nine realms (tier = index + 1). */
export const REALM_ORDER: readonly RealmId[] = REALM_IDS;

/** Realm config lookup — throws on an unknown id (ids are compile-time). */
export function getRealm(id: RealmId): RealmConfig {
  return REALMS[id];
}

/** Realm tier (1..9) = unlock order; drives enemy scaling. */
export function getRealmTier(id: RealmId): number {
  return realmTier(id);
}

// ---------------------------------------------------------------------------
// GameConfig — the frozen config bundle on GameContext
// ---------------------------------------------------------------------------

export interface GameConfig {
  readonly realms: typeof REALMS;
  readonly realmOrder: readonly RealmId[];
  readonly homeRealm: RealmId;
  readonly simDt: number;
  readonly maxSimSteps: number;
  getRealm(id: RealmId): RealmConfig;
  getRealmTier(id: RealmId): number;
}

export const GAME_CONFIG: GameConfig = {
  realms: REALMS,
  realmOrder: REALM_ORDER,
  homeRealm: HOME_REALM,
  simDt: SIM_DT,
  maxSimSteps: MAX_SIM_STEPS,
  getRealm,
  getRealmTier,
};

// Re-exports so engine-side agents have one import site for realm data.
export { REALMS, HOME_REALM, realmTier } from '../../../contracts/realms';
export type { RealmConfig } from '../../../contracts/realms';
export type { RealmId } from '../../../contracts/types';
export { REALM_IDS } from '../../../contracts/types';
export { mulberry32, createSimplex2D, fbm } from './noise';
export type { Simplex2D, FbmOptions } from './noise';
export { clamp, lerp, damp, smoothstep } from './math';
