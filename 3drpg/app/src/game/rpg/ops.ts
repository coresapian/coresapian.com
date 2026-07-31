// ============================================================================
// CORESAPIAN — src/game/rpg/ops.ts
// CROSS-AGENT MODULE (addendum exception): ui / combat-ai / world / audio-net
// may import THIS FILE ONLY from the rpg-quests agent.
//
// What lives here:
//  1. Typed inventory-op SHAPES + builders. Server-roundtrip ops match
//     contracts/netcode.ts `InventoryOp` exactly (field `kind`, sent verbatim
//     on the wire). Client-local ops (loot/harvest/quest rewards) have no
//     netcode representation — the frozen protocol has no grant kinds — so the
//     rpg subsystem applies them locally via `applyInventoryAck`.
//  2. The op OUTBOX. The frozen store only tracks pending opIds
//     (`beginOp(opId)`), so payloads are registered here keyed by opId.
//     Transport contract for audio-net:
//       - watch `store.pendingOps`
//       - `getPendingOpPayload(opId)` → payload
//       - `isServerOp(payload)` → send `invop { t:'invop', opId, op: payload }`
//       - on `invack` → `store.applyInventoryAck(opId, ok, snap)` +
//         `releaseOpPayload(opId)`
//       - NEVER send local kinds (`isServerOp` false) — the rpg subsystem
//         settles them locally, synchronously.
//  3. ui-facing gameplay helpers that must be importable by React:
//     `canCraft` / `craftBlockReason` / `getCurrentStation`, shop price helpers
//     (`getShopInfo` / `getBuyPrice` / `getSellPrice` / `isShopOpen`),
//     faction-rank helper, and `requestSpendSkillPoint` (ui may only READ the
//     Progression slice per gdd §2.2 — the write stays inside rpg code here).
// ============================================================================

import type { InventoryOp } from '../../../contracts/netcode';
import type { ItemInstance } from '../../../contracts/types';
import type { CraftStation } from '../../../contracts/items';
import { useGameStore } from '../store';

// ---------------------------------------------------------------------------
// Op shapes
// ---------------------------------------------------------------------------

/** Ops that round-trip to the server (contracts/netcode.ts InventoryOp). */
export type ServerInventoryOp = InventoryOp;

/**
 * Client-local inventory ops. The frozen netcode union has no loot/harvest/
 * reward grant kinds, so these never touch the wire: the rpg subsystem
 * applies them to the Inventory slice and settles them with a local
 * `applyInventoryAck(opId, true, snapshot)`.
 */
export type LocalInventoryOp =
  | { kind: 'loot_item'; itemId: string; qty: number }
  | { kind: 'loot_gold'; amount: number }
  | { kind: 'harvest'; nodeId: string; itemId: string; qty: number }
  | { kind: 'quest_reward'; questId: string; items: { itemId: string; qty: number }[]; gold: number };

export type GameInventoryOp = ServerInventoryOp | LocalInventoryOp;

const SERVER_OP_KINDS: readonly string[] = [
  'consume',
  'equip',
  'unequip',
  'craft',
  'upgrade',
  'inscribe_rune',
  'drop',
  'buy',
  'sell',
];

/** True for ops that must be sent to the server as `invop`. */
export function isServerOp(op: GameInventoryOp): op is ServerInventoryOp {
  return SERVER_OP_KINDS.includes(op.kind);
}

// ---------------------------------------------------------------------------
// Op id + outbox registry
// ---------------------------------------------------------------------------

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const outbox = new Map<string, GameInventoryOp>();

/**
 * Register an op and mark it pending in the store. Returns the opId.
 * This is THE way every agent (ui, combat-ai, world, rpg) originates
 * inventory ops.
 */
export function submitOp(op: GameInventoryOp): string {
  const opId = `op_${uid()}`;
  outbox.set(opId, op);
  useGameStore.getState().beginOp(opId);
  return opId;
}

/** Payload lookup for transport (audio-net) and the local-op processor. */
export function getPendingOpPayload(opId: string): GameInventoryOp | undefined {
  return outbox.get(opId);
}

/** Drop a payload once the op is fully settled (ack applied). */
export function releaseOpPayload(opId: string): void {
  outbox.delete(opId);
}

/**
 * Leak guard: drop payloads whose opId is no longer pending (e.g. a rejected
 * op whose ack path never released). Called periodically by the rpg
 * subsystem; safe to call anytime.
 */
export function sweepOrphanPayloads(): void {
  const pending = new Set(useGameStore.getState().pendingOps);
  for (const opId of outbox.keys()) {
    if (!pending.has(opId)) outbox.delete(opId);
  }
}

// ---------------------------------------------------------------------------
// Server op builders (contracts/netcode.ts InventoryOp kinds)
// ---------------------------------------------------------------------------

export function buildConsumeOp(instanceId: string): ServerInventoryOp {
  return { kind: 'consume', instanceId };
}

export function buildEquipOp(instanceId: string, slot: string): ServerInventoryOp {
  return { kind: 'equip', instanceId, slot };
}

export function buildUnequipOp(slot: string): ServerInventoryOp {
  return { kind: 'unequip', slot };
}

export function buildInscribeRuneOp(instanceId: string, runeSlot: number): ServerInventoryOp {
  return { kind: 'inscribe_rune', instanceId, runeSlot };
}

export function buildDropOp(instanceId: string, qty: number): ServerInventoryOp {
  return { kind: 'drop', instanceId, qty };
}

export function buildCraftOp(recipeId: string): ServerInventoryOp {
  return { kind: 'craft', recipeId };
}

export function buildUpgradeOp(instanceId: string): ServerInventoryOp {
  return { kind: 'upgrade', instanceId };
}

export function buildBuyOp(npcId: string, itemId: string, qty: number): ServerInventoryOp {
  return { kind: 'buy', npcId, itemId, qty };
}

export function buildSellOp(instanceId: string, qty: number): ServerInventoryOp {
  return { kind: 'sell', instanceId, qty };
}

// ---------------------------------------------------------------------------
// Local op builders (settled client-side by the rpg subsystem)
// ---------------------------------------------------------------------------

/** Item pickup from a corpse/chest (combat-ai loot interactables call this). */
export function buildLootItemOp(itemId: string, qty: number): LocalInventoryOp {
  return { kind: 'loot_item', itemId, qty };
}

/** Gold auto-magnet pickup (combat-ai loot interactables call this). */
export function buildLootGoldOp(amount: number): LocalInventoryOp {
  return { kind: 'loot_gold', amount };
}

/**
 * Resource-node harvest grant (world's node interactables call this after a
 * successful channel). `nodeId` is the world's node instance id.
 */
export function buildHarvestOp(nodeId: string, itemId: string, qty: number): LocalInventoryOp {
  return { kind: 'harvest', nodeId, itemId, qty };
}

/** Quest reward gold+items (rpg quest runtime; also used for dialogue grants). */
export function buildQuestRewardOp(
  questId: string,
  items: { itemId: string; qty: number }[],
  gold: number,
): LocalInventoryOp {
  return { kind: 'quest_reward', questId, items, gold };
}

// ---------------------------------------------------------------------------
// Crafting + station helpers (implemented in crafting.ts, re-exported so ui
// has a single import site). Station rule per gdd §6.3.
// ---------------------------------------------------------------------------

export { canCraft, craftBlockReason } from './crafting';

let stationProvider: () => CraftStation = () => 'none';

/** rpg-internal: the npc roster pushes the station the player stands near. */
export function setStationProvider(fn: () => CraftStation): void {
  stationProvider = fn;
}

/** ui: which crafting station (if any) the player is currently at. */
export function getCurrentStation(): CraftStation {
  return stationProvider();
}

// ---------------------------------------------------------------------------
// Shop helpers (implemented in shops.ts, re-exported for ui)
// ---------------------------------------------------------------------------

export {
  getShopInfo,
  getBuyPrice,
  getSellPrice,
  isShopOpen,
  factionRankIndex,
} from './shops';

// ---------------------------------------------------------------------------
// Progression writes ui is not allowed to do directly (gdd §2.2 matrix:
// Progression W = rpg-quests). Validated against contracts/skills.ts.
// ---------------------------------------------------------------------------

/**
 * Spend a skill point on a node. Validates requires/maxRank/cost via the
 * store action (which implements contracts/skills.ts rules). Returns true on
 * success.
 */
export function requestSpendSkillPoint(nodeId: string): boolean {
  return useGameStore.getState().spendSkillPoint(nodeId);
}

// Re-exported so ui/combat-ai can type inventory reads without touching
// contracts' netcode module directly.
export type { ItemInstance };
