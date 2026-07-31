// ============================================================================
// CORESAPIAN — src/game/rpg/shops.ts
// Shop logic: faction-rank price gating (gdd §8.2: ±10% per rank step) and
// keeper-awake state (gdd §8.3: shops close while the keeper sleeps).
// ui renders shop panels from these helpers (via rpg/ops.ts re-exports);
// the server validates buy/sell authoritatively.
// ============================================================================

import type { FactionId } from '../../../contracts/quests';
import { FACTION_RANK_THRESHOLDS, FACTIONS, SHOPS } from '../../../contracts/quests';
import type { ShopDef } from '../../../contracts/quests';
import { ITEMS } from '../../../contracts/items';
import { useGameStore } from '../store';

/** Price adjustment per faction-rank step away from Neutral (gdd §8.2). */
const PRICE_STEP = 0.1;
/** Clamp for both buy and sell multipliers. */
const MIN_MULT = 0.5;
const MAX_MULT = 1.5;

/**
 * Which faction's standing gates which shop. The dvergr smiths answer to the
 * Guild; the Midgard steading trades under Æsir Pact protection.
 */
const SHOP_FACTION: Record<string, FactionId> = {
  shop_eira: 'aesir_pact',
  shop_bjorn: 'aesir_pact',
  shop_brokkr: 'dvergr_guild',
  shop_sindri: 'dvergr_guild',
};

// ---------------------------------------------------------------------------
// Keeper-awake state (pushed by the npc roster each schedule tick)
// ---------------------------------------------------------------------------

const keeperAwake = new Map<string, boolean>();

/** rpg-internal: npc roster reports keeper sleep/wake transitions. */
export function setShopKeeperAwake(shopId: string, awake: boolean): void {
  keeperAwake.set(shopId, awake);
}

/** Shops close while the keeper sleeps (gdd §8.3). Default: open. */
export function isShopOpen(shopId: string): boolean {
  return keeperAwake.get(shopId) ?? true;
}

// ---------------------------------------------------------------------------
// Faction ranks
// ---------------------------------------------------------------------------

/**
 * Rank index 0..5 into FACTION_RANK_THRESHOLDS for a standing value
 * (thresholds [-1000,-300,0,300,800,1500]; index 2 = Neutral).
 */
export function factionRankIndex(standing: number): number {
  let idx = 0;
  for (let i = 0; i < FACTION_RANK_THRESHOLDS.length; i++) {
    if (standing >= FACTION_RANK_THRESHOLDS[i]) idx = i;
  }
  return idx;
}

/** Neutral rank index in FACTION_RANK_THRESHOLDS (threshold 0). */
const NEUTRAL_RANK = FACTION_RANK_THRESHOLDS.indexOf(0);

export interface ShopInfo {
  def: ShopDef;
  factionId: FactionId;
  factionName: string;
  standing: number;
  rankIndex: number;
  rankTitle: string;
  /** Multiply stock buy prices by this (better standing → cheaper). */
  buyMult: number;
  /** Multiply item sell prices by this (better standing → better payouts). */
  sellMult: number;
  isOpen: boolean;
}

function clampMult(m: number): number {
  return Math.min(MAX_MULT, Math.max(MIN_MULT, m));
}

/** Full shop display/pricing context for ui. */
export function getShopInfo(shopId: string): ShopInfo | null {
  const def = SHOPS[shopId];
  if (!def) return null;
  const factionId = SHOP_FACTION[shopId] ?? 'aesir_pact';
  const faction = FACTIONS[factionId];
  const standing = useGameStore.getState().factions[factionId] ?? 0;
  const rankIndex = factionRankIndex(standing);
  const step = rankIndex - NEUTRAL_RANK;
  return {
    def,
    factionId,
    factionName: faction.name,
    standing,
    rankIndex,
    rankTitle: faction.ranks[rankIndex] ?? faction.ranks[NEUTRAL_RANK],
    buyMult: clampMult(1 - PRICE_STEP * step),
    sellMult: clampMult(1 + PRICE_STEP * step),
    isOpen: isShopOpen(shopId),
  };
}

/** Rank-adjusted buy price for a stock entry (integer gold). */
export function getBuyPrice(shopId: string, itemId: string): number | null {
  const info = getShopInfo(shopId);
  if (!info) return null;
  const entry = info.def.stock.find((s) => s.itemId === itemId);
  if (!entry) return null;
  return Math.max(1, Math.round(entry.price * info.buyMult));
}

/** Rank-adjusted sell price for an inventory item (integer gold). */
export function getSellPrice(shopId: string, itemId: string): number | null {
  const info = getShopInfo(shopId);
  const item = ITEMS[itemId];
  if (!info || !item) return null;
  return Math.max(1, Math.round(item.sellPrice * info.sellMult));
}
