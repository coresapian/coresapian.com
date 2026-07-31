// ============================================================================
// CORESAPIAN — src/game/rpg/crafting.ts
// Crafting validation per gdd §6.3. Local pre-check only: ui renders
// availability from `canCraft`, the SERVER validates authoritatively on the
// `craft` invop. Numbers come from contracts/items.ts.
// ============================================================================

import type { ItemInstance } from '../../../contracts/types';
import type { CraftStation } from '../../../contracts/items';
import { ITEMS, RECIPES } from '../../../contracts/items';
import { useGameStore } from '../store';

/** Realm ability that removes station requirements (skills.ts). */
const CRAFT_ANYWHERE_ABILITY = 'ra_svartalfheim';

/** Total qty of an itemId across the inventory. */
export function countItem(items: readonly ItemInstance[], itemId: string): number {
  let total = 0;
  for (const it of items) {
    if (it.itemId === itemId) total += it.qty;
  }
  return total;
}

/**
 * Station rule (gdd §6.3): 'none' crafts anywhere; 'forge' / 'alchemy' need a
 * matching station, waived by the ra_svartalfheim realm ability.
 */
export function stationAllows(
  recipeStation: CraftStation,
  station: CraftStation,
  realmAbilities: readonly string[],
): boolean {
  if (recipeStation === 'none') return true;
  if (realmAbilities.includes(CRAFT_ANYWHERE_ABILITY)) return true;
  return station === recipeStation;
}

/**
 * Why a recipe cannot be crafted right now, or null if it can.
 * Message text is composed from contract data (recipe/material names) so ui
 * can drop it straight into a notification.
 */
export function craftBlockReason(
  recipeId: string,
  items: readonly ItemInstance[],
  station: CraftStation,
): string | null {
  const recipe = RECIPES[recipeId];
  if (!recipe) return 'Unknown recipe.';
  const state = useGameStore.getState();

  if (state.level < recipe.minLevel) {
    const resultName = ITEMS[recipe.result.itemId]?.name ?? recipe.result.itemId;
    return `${resultName} requires level ${recipe.minLevel}.`;
  }
  if (!stationAllows(recipe.station, station, state.realmAbilities)) {
    const stationName = recipe.station === 'forge' ? 'a forge' : 'an alchemy station';
    return `Requires ${stationName}.`;
  }
  for (const req of recipe.requires) {
    const have = countItem(items, req.itemId);
    if (have < req.qty) {
      const matName = ITEMS[req.itemId]?.name ?? req.itemId;
      return `Missing ${matName} (${have}/${req.qty}).`;
    }
  }
  return null;
}

/** True when the recipe can be crafted here/now (see craftBlockReason). */
export function canCraft(
  recipeId: string,
  items: readonly ItemInstance[],
  station: CraftStation,
): boolean {
  return craftBlockReason(recipeId, items, station) === null;
}
