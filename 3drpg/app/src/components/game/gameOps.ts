// ============================================================================
// CORESAPIAN — ui op-layer shim (integration reconciliation)
//
// The canonical inventory-op layer lives in `src/game/rpg/ops.ts`
// (rpg-quests agent, addendum §5). This module re-exports it so existing ui
// import sites (`../gameOps`) keep working with zero drift between the
// builders React uses and the payloads the transport/server see.
// ============================================================================

import { useGameStore } from '@/game/store';
import {
  getPendingOpPayload,
  submitOp as submitCanonical,
} from '../../game/rpg/ops';

export {
  buildConsumeOp,
  buildEquipOp,
  buildUnequipOp,
  buildCraftOp,
  buildUpgradeOp,
  buildBuyOp,
  buildSellOp,
  buildInscribeRuneOp,
  buildDropOp,
  buildLootItemOp,
  buildLootGoldOp,
  buildHarvestOp,
  buildQuestRewardOp,
  isServerOp,
  getPendingOpPayload,
} from '../../game/rpg/ops';

export type { GameInventoryOp, ServerInventoryOp, LocalInventoryOp } from '../../game/rpg/ops';

/**
 * Submit an op built by one of the re-exported builders. Returns the opId
 * (truthy) — call sites that treated the old boolean the same way keep
 * working (non-empty string is truthy).
 */
export function submitOp(op: Parameters<typeof submitCanonical>[0]): string {
  return submitCanonical(op);
}

/** True while an op involving this item instance is awaiting its ack. */
export function isInstancePending(instanceId: string): boolean {
  const { pendingOps } = useGameStore.getState();
  for (const opId of pendingOps) {
    const payload = getPendingOpPayload(opId);
    if (payload && 'instanceId' in payload && payload.instanceId === instanceId) return true;
  }
  return false;
}
