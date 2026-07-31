// ============================================================================
// CORESAPIAN — src/game/rpg/inventory.ts
// Local inventory op processor + stack helpers.
//
// The frozen Inventory slice is server-authoritative with no local mutation
// action, and the frozen netcode has no loot/harvest/reward grant op kinds —
// so client-local ops (see rpg/ops.ts) are settled HERE: compute the new
// snapshot from current state + op, then `applyInventoryAck(opId, true, …)`.
// Server ops are untouched (audio-net owns their round-trip).
// ============================================================================

import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';
import type { ItemInstance } from '../../../contracts/types';
import type { InventorySnapshot } from '../../../contracts/netcode';
import { ITEMS } from '../../../contracts/items';
import { getPendingOpPayload, isServerOp, releaseOpPayload } from './ops';

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Kinds that are wieldable/wearable: one instance per unit so they can be
 *  equipped/upgraded individually. Everything else stacks freely. */
const INSTANCE_PER_UNIT = new Set(['weapon', 'shield', 'bow', 'armor', 'rune']);

/**
 * Add `qty` of `itemId` to an item list (returns a NEW list). Stacks onto an
 * existing un-upgraded instance for stackable kinds; creates one instance per
 * unit for equippable kinds.
 */
export function addItems(
  items: readonly ItemInstance[],
  itemId: string,
  qty: number,
): ItemInstance[] {
  const def = ITEMS[itemId];
  const next = items.map((it) => ({ ...it }));
  if (def && INSTANCE_PER_UNIT.has(def.kind)) {
    for (let i = 0; i < qty; i++) {
      next.push({ instanceId: uid(), itemId, qty: 1, upgradeLevel: 0 });
    }
    return next;
  }
  const existing = next.find((it) => it.itemId === itemId && it.upgradeLevel === 0);
  if (existing) {
    existing.qty += qty;
  } else {
    next.push({ instanceId: uid(), itemId, qty, upgradeLevel: 0 });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Local op processor
// ---------------------------------------------------------------------------

export interface InventoryRuntime {
  dispose(): void;
}

/**
 * Watches `store.pendingOps` and settles every client-local op synchronously.
 * Also emits the loot/grant notifications + sfx for those ops (central, so
 * every caller — combat-ai loot, world harvest, quest rewards — behaves the
 * same).
 */
export function createInventoryRuntime(store: UseGameStore, events: GameEventBus): InventoryRuntime {
  let processing = false;

  const notifyLoot = (kind: 'loot', text: string, sfxId: string): void => {
    store.getState().notify(kind, text);
    events.emit('play_sfx', { sfxId });
  };

  const settle = (opId: string): void => {
    const payload = getPendingOpPayload(opId);
    if (!payload || isServerOp(payload)) return;

    const s = store.getState();
    let items = s.items;
    let gold = s.gold;

    switch (payload.kind) {
      case 'loot_item': {
        items = addItems(items, payload.itemId, payload.qty);
        const name = ITEMS[payload.itemId]?.name ?? payload.itemId;
        notifyLoot('loot', `+${payload.qty} ${name}`, 'sfx.loot');
        break;
      }
      case 'loot_gold': {
        gold += payload.amount;
        notifyLoot('loot', `+${payload.amount} gold`, 'sfx.loot');
        break;
      }
      case 'harvest': {
        items = addItems(items, payload.itemId, payload.qty);
        const name = ITEMS[payload.itemId]?.name ?? payload.itemId;
        notifyLoot('loot', `+${payload.qty} ${name}`, 'sfx.harvest');
        break;
      }
      case 'quest_reward': {
        for (const grant of payload.items) {
          items = addItems(items, grant.itemId, grant.qty);
        }
        gold += payload.gold;
        // Silent: the quest-completed toast already covers the reward.
        break;
      }
    }

    const snapshot: InventorySnapshot = {
      revision: s.revision, // server owns revision; local grants don't bump it
      gold,
      items,
      equipment: s.equipment,
      runeLoadout: s.runeLoadout,
    };
    releaseOpPayload(opId);
    s.applyInventoryAck(opId, true, snapshot);
  };

  const process = (): void => {
    if (processing) return;
    processing = true;
    try {
      // Snapshot the list: settling mutates pendingOps (re-entrant subscribe).
      for (const opId of [...store.getState().pendingOps]) {
        settle(opId);
      }
    } finally {
      processing = false;
    }
  };

  const unsub = store.subscribe(process);
  process(); // settle anything already pending (e.g. restored session)

  return {
    dispose() {
      unsub();
    },
  };
}
