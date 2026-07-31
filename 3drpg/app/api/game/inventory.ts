// ============================================================================
// api/game/inventory.ts — server-authoritative inventory operations.
// Pure functions: validate an InventoryOp against contracts data and mutate a
// draft InventorySnapshot. The gateway clones before applying, so a rejected
// op (or a failed persist) never leaks a partial mutation.
// Rules come from contracts/items.ts (recipes, prices, consume, upgrades) and
// contracts/quests.ts (NPC shops). Nothing here trusts the client.
// ============================================================================

import type { EquipSlot, ItemInstance, RealmId } from "@contracts/types";
import { EQUIP_SLOTS, MAX_UPGRADE_LEVEL } from "@contracts/types";
import type { InventoryOp, InventorySnapshot } from "@contracts/netcode";
import { ATTACK_COOLDOWN_SLACK_MS } from "@contracts/netcode";
import { ITEMS, RECIPES, upgradeCost, upgradeGold } from "@contracts/items";
import { NPCS, SHOPS } from "@contracts/quests";

/** gdd.md §5.2 — shared 1.0s consumable use cooldown (server-enforced). */
export const CONSUME_COOLDOWN_MS = 1000;
/** Anti-abuse cap on a single buy/sell/drop quantity. */
export const MAX_OP_QTY = 999;

export interface InvopContext {
  /** Player's current realm (buy is only valid at a keeper in your realm). */
  realm: RealmId;
  /** Player level (recipe minLevel gate). */
  level: number;
  now: number;
  /** Last accepted consume timestamp (shared cooldown), session state. */
  lastConsumeAt: number;
}

export interface InvopOutcome {
  ok: boolean;
  reason?: string;
  /** Updated consume-cooldown timestamp when a consume was accepted. */
  lastConsumeAt?: number;
}

// ---------------------------------------------------------------------------
// Instance helpers
// ---------------------------------------------------------------------------

type InstanceRef = { where: "items"; index: number } | { where: "equipment"; slot: EquipSlot };

function findInstance(inv: InventorySnapshot, instanceId: string): InstanceRef | null {
  const index = inv.items.findIndex((i) => i.instanceId === instanceId);
  if (index >= 0) return { where: "items", index };
  for (const slot of EQUIP_SLOTS) {
    if (inv.equipment[slot]?.instanceId === instanceId) return { where: "equipment", slot };
  }
  return null;
}

function getInstance(inv: InventorySnapshot, ref: InstanceRef): ItemInstance {
  return ref.where === "items" ? inv.items[ref.index] : (inv.equipment[ref.slot] as ItemInstance);
}

function countByItemId(inv: InventorySnapshot, itemId: string): number {
  let n = 0;
  for (const i of inv.items) if (i.itemId === itemId) n += i.qty;
  return n;
}

/** Add qty of itemId, merging into an existing matching stack when possible. */
function addItems(inv: InventorySnapshot, itemId: string, qty: number, upgradeLevel = 0): void {
  const stack = inv.items.find((i) => i.itemId === itemId && i.upgradeLevel === upgradeLevel);
  if (stack) {
    stack.qty += qty;
    return;
  }
  inv.items.push({ instanceId: crypto.randomUUID(), itemId, qty, upgradeLevel });
}

/** Decrement a bag stack; removes it at zero. */
function removeFromStack(inv: InventorySnapshot, index: number, qty: number): void {
  const inst = inv.items[index];
  inst.qty -= qty;
  if (inst.qty <= 0) inv.items.splice(index, 1);
}

/** Consume qty spread across bag stacks of itemId (caller validated total). */
function consumeByItemId(inv: InventorySnapshot, itemId: string, qty: number): void {
  let left = qty;
  for (let i = inv.items.length - 1; i >= 0 && left > 0; i--) {
    const inst = inv.items[i];
    if (inst.itemId !== itemId) continue;
    const take = Math.min(inst.qty, left);
    inst.qty -= take;
    left -= take;
    if (inst.qty <= 0) inv.items.splice(i, 1);
  }
}

/** Detach exactly one unit from a bag stack as its own instance. */
function peelOne(inv: InventorySnapshot, index: number): ItemInstance {
  const inst = inv.items[index];
  if (inst.qty > 1) {
    inst.qty -= 1;
    return { instanceId: crypto.randomUUID(), itemId: inst.itemId, qty: 1, upgradeLevel: inst.upgradeLevel };
  }
  inv.items.splice(index, 1);
  return inst;
}

function validQty(qty: unknown): qty is number {
  return typeof qty === "number" && Number.isInteger(qty) && qty >= 1 && qty <= MAX_OP_QTY;
}

const ok = (extra?: Partial<InvopOutcome>): InvopOutcome => ({ ok: true, ...extra });
const fail = (reason: string): InvopOutcome => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// The op dispatcher
// ---------------------------------------------------------------------------

export function applyInventoryOp(
  inv: InventorySnapshot,
  op: InventoryOp,
  ctx: InvopContext,
): InvopOutcome {
  switch (op.kind) {
    case "consume": {
      const ref = findInstance(inv, op.instanceId);
      if (!ref || ref.where !== "items") return fail("invalid_op");
      const inst = getInstance(inv, ref);
      const def = ITEMS[inst.itemId];
      if (!def || def.kind !== "consumable") return fail("invalid_op");
      // Shared 1.0s use cooldown, with the protocol slack for jitter.
      if (ctx.now - ctx.lastConsumeAt < CONSUME_COOLDOWN_MS - ATTACK_COOLDOWN_SLACK_MS) {
        return fail("cooldown");
      }
      removeFromStack(inv, ref.index, 1);
      return ok({ lastConsumeAt: ctx.now });
    }

    case "equip": {
      const slot = op.slot as EquipSlot;
      if (!EQUIP_SLOTS.includes(slot)) return fail("invalid_op");
      const ref = findInstance(inv, op.instanceId);
      if (!ref || ref.where !== "items") return fail("invalid_op");
      const inst = getInstance(inv, ref);
      const def = ITEMS[inst.itemId];
      if (!def) return fail("invalid_op");
      const fits =
        (def.kind === "weapon" && slot === "weapon") ||
        (def.kind === "bow" && slot === "weapon") ||
        (def.kind === "shield" && slot === "shield") ||
        (def.kind === "armor" && def.slot === slot);
      if (!fits) return fail("invalid_op");
      const one = peelOne(inv, ref.index);
      const previous = inv.equipment[slot];
      inv.equipment[slot] = one;
      if (previous) inv.items.push(previous);
      return ok();
    }

    case "unequip": {
      const slot = op.slot as EquipSlot;
      if (!EQUIP_SLOTS.includes(slot)) return fail("invalid_op");
      const inst = inv.equipment[slot];
      if (!inst) return fail("invalid_op");
      inv.equipment[slot] = null;
      const stack = inv.items.find((i) => i.itemId === inst.itemId && i.upgradeLevel === inst.upgradeLevel);
      if (stack) stack.qty += inst.qty;
      else inv.items.push(inst);
      return ok();
    }

    case "craft": {
      const recipe = RECIPES[op.recipeId];
      if (!recipe) return fail("invalid_op");
      if (!ITEMS[recipe.result.itemId]) return fail("invalid_op");
      if (ctx.level < recipe.minLevel) return fail("min_level");
      // Station rules ('forge'/'alchemy' proximity) are enforced client-side
      // at the interactable; the server enforces the material/level economy.
      for (const req of recipe.requires) {
        if (countByItemId(inv, req.itemId) < req.qty) return fail("insufficient_materials");
      }
      for (const req of recipe.requires) consumeByItemId(inv, req.itemId, req.qty);
      addItems(inv, recipe.result.itemId, recipe.result.qty);
      return ok();
    }

    case "upgrade": {
      const ref = findInstance(inv, op.instanceId);
      if (!ref) return fail("invalid_op");
      const inst = getInstance(inv, ref);
      const def = ITEMS[inst.itemId];
      if (!def || (def.kind !== "weapon" && def.kind !== "shield" && def.kind !== "bow" && def.kind !== "armor")) {
        return fail("invalid_op");
      }
      if (inst.upgradeLevel >= MAX_UPGRADE_LEVEL) return fail("max_upgrade");
      const nextLevel = inst.upgradeLevel + 1;
      const materials = upgradeCost(def.tier, nextLevel);
      for (const mat of materials) {
        if (countByItemId(inv, mat.itemId) < mat.qty) return fail("insufficient_materials");
      }
      const gold = upgradeGold(def.tier, nextLevel);
      if (inv.gold < gold) return fail("insufficient_gold");
      for (const mat of materials) consumeByItemId(inv, mat.itemId, mat.qty);
      inv.gold -= gold;
      if (ref.where === "items" && inst.qty > 1) {
        // Upgrading one unit of a stack: peel it off as its own instance.
        const one = peelOne(inv, ref.index);
        one.upgradeLevel = nextLevel;
        inv.items.push(one);
      } else {
        inst.upgradeLevel = nextLevel;
      }
      return ok();
    }

    case "inscribe_rune": {
      const ref = findInstance(inv, op.instanceId);
      if (!ref || ref.where !== "items") return fail("invalid_op");
      const inst = getInstance(inv, ref);
      const def = ITEMS[inst.itemId];
      if (!def || def.kind !== "rune") return fail("invalid_op");
      const slot = op.runeSlot;
      if (!Number.isInteger(slot) || slot < 0 || slot > 3) return fail("invalid_op");
      // Inscribing consumes the runestone (contracts/types.ts RuneLoadout).
      removeFromStack(inv, ref.index, 1);
      inv.runeLoadout[slot] = def.id;
      return ok();
    }

    case "drop": {
      const ref = findInstance(inv, op.instanceId);
      if (!ref || ref.where !== "items") return fail("invalid_op");
      const inst = getInstance(inv, ref);
      if (!validQty(op.qty) || op.qty > inst.qty) return fail("invalid_op");
      removeFromStack(inv, ref.index, op.qty);
      return ok();
    }

    case "buy": {
      const npc = NPCS[op.npcId];
      if (!npc || !npc.shopId) return fail("invalid_op");
      if (npc.realm !== ctx.realm) return fail("invalid_op"); // keeper is in another realm
      const shop = SHOPS[npc.shopId];
      const entry = shop?.stock.find((s) => s.itemId === op.itemId);
      if (!entry) return fail("invalid_op");
      if (!validQty(op.qty)) return fail("invalid_op");
      const cost = entry.price * op.qty;
      if (inv.gold < cost) return fail("insufficient_gold");
      inv.gold -= cost;
      addItems(inv, entry.itemId, op.qty);
      return ok();
    }

    case "sell": {
      const ref = findInstance(inv, op.instanceId);
      if (!ref || ref.where !== "items") return fail("invalid_op");
      const inst = getInstance(inv, ref);
      const def = ITEMS[inst.itemId];
      if (!def) return fail("invalid_op");
      if (!validQty(op.qty) || op.qty > inst.qty) return fail("invalid_op");
      inv.gold += def.sellPrice * op.qty;
      removeFromStack(inv, ref.index, op.qty);
      return ok();
    }

    default:
      return fail("invalid_op");
  }
}
