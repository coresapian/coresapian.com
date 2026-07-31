// ============================================================================
// CORESAPIAN — Shop panel (game.md S13; gdd §8.2): buy/sell lists from
// contracts SHOPS with faction-rank price modifiers (±10% per rank step),
// merchant mood chip, ops via beginOp(buildBuyOp/buildSellOp).
// ============================================================================

import { useMemo } from 'react';
import { Coins, X } from 'lucide-react';

import { ITEMS } from '../../../contracts/items';
import type { FactionId } from '../../../contracts/quests';
import { FACTION_RANK_THRESHOLDS, FACTIONS, NPCS, SHOPS } from '../../../contracts/quests';
import { useGameStore } from '@/game/store';
import { buildBuyOp, buildSellOp, isInstancePending, submitOp } from './gameOps';
import { ItemIcon, rarityOf } from './itemVisual';
import { useUiAux } from './uiAux';

/** Which faction's standing sways each merchant's prices. */
const SHOP_FACTION: Record<string, FactionId> = {
  shop_eira: 'aesir_pact',
  shop_bjorn: 'aesir_pact',
  shop_brokkr: 'dvergr_guild',
  shop_sindri: 'dvergr_guild',
};

const NEUTRAL_RANK = 2; // index of the 0-threshold rank

function rankIndex(points: number): number {
  let idx = 0;
  for (let i = 0; i < FACTION_RANK_THRESHOLDS.length; i++) {
    if (points >= FACTION_RANK_THRESHOLDS[i]!) idx = i;
  }
  return Math.min(FACTION_RANK_THRESHOLDS.length - 1, idx);
}

export default function ShopPanel() {
  const shopId = useUiAux((s) => s.shopId);
  const npcId = useUiAux((s) => s.shopNpcId);
  const closeShop = useUiAux((s) => s.closeShop);

  const items = useGameStore((s) => s.items);
  const gold = useGameStore((s) => s.gold);
  const factions = useGameStore((s) => s.factions);
  const pendingOps = useGameStore((s) => s.pendingOps);

  const shop = shopId ? SHOPS[shopId] : undefined;
  const npc = npcId ? NPCS[npcId] : undefined;

  const { mult, rankName, factionName } = useMemo(() => {
    const factionId = shopId ? SHOP_FACTION[shopId] : undefined;
    if (!factionId) return { mult: 1, rankName: 'Neutral', factionName: null as string | null };
    const points = factions[factionId] ?? 0;
    const rank = rankIndex(points);
    const m = Math.min(1.3, Math.max(0.7, 1 - 0.1 * (rank - NEUTRAL_RANK)));
    return {
      mult: m,
      rankName: FACTIONS[factionId].ranks[rank] ?? 'Neutral',
      factionName: FACTIONS[factionId].name,
    };
  }, [shopId, factions]);

  const sellables = useMemo(
    () =>
      items.filter((inst) => {
        const def = ITEMS[inst.itemId];
        return def && def.sellPrice > 0;
      }),
    [items],
  );

  if (!shop) return null;

  const moodGood = mult < 1;
  const moodBad = mult > 1;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center pb-6">
      <div className="panel pointer-events-auto w-[min(96vw,860px)]">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-iron px-5 py-2.5">
          <span className="font-runic text-lg text-phosphor">ᚺ</span>
          <div>
            <div className="font-norse text-base text-bone">{shop.name}</div>
            <div className="micro text-ash">{npc ? `${npc.name} · ` : ''}HACKSILVER TALKS</div>
          </div>
          {factionName && (
            <span
              className={`chip ml-2 ${moodGood ? 'border-soul/60 text-soul' : moodBad ? 'border-blood/60 text-blood-hi' : 'border-iron text-ash'}`}
              title={`${factionName} standing: ${rankName}`}
            >
              {rankName.toUpperCase()} · {moodGood ? `−${Math.round((1 - mult) * 100)}%` : moodBad ? `+${Math.round((mult - 1) * 100)}%` : 'FAIR'} PRICES
            </span>
          )}
          <span className="stat ml-auto flex items-center gap-1.5 text-sm text-phosphor">
            <Coins size={13} /> {gold.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={closeShop}
            aria-label="Leave the counter"
            className="flex h-7 w-7 items-center justify-center border border-iron text-ash transition-colors hover:border-blood hover:text-blood-hi"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex max-h-[46vh]">
          {/* buy */}
          <div className="min-w-0 flex-1 overflow-y-auto border-r border-iron p-3">
            <div className="micro mb-2 text-ash">THEIR WARES</div>
            {shop.stock.map((entry) => {
              const def = ITEMS[entry.itemId];
              if (!def) return null;
              const price = Math.max(1, Math.round(entry.price * mult));
              const afford = gold >= price;
              const rarity = rarityOf(def.tier);
              return (
                <div
                  key={entry.itemId}
                  className="mb-1 flex items-center gap-2 border border-iron/60 bg-stone/40 px-2 py-1.5"
                >
                  <span className={`flex h-8 w-8 flex-none items-center justify-center border ${rarity.border} bg-abyss/60`}>
                    <ItemIcon def={def} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-bone">{def.name}</span>
                    <span className="micro text-ash">
                      {entry.qty !== undefined ? `STOCK ${entry.qty} · ` : ''}
                      <span className={rarity.text}>{rarity.label}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={!afford || pendingOps.length > 0}
                    title={afford ? `Buy ${def.name}` : 'Not enough hacksilver'}
                    onClick={() => npcId && submitOp(buildBuyOp(npcId, entry.itemId, 1))}
                    className={`stat flex-none border px-2 py-1 text-[11px] transition-colors ${
                      afford
                        ? 'border-phosphor/60 text-phosphor hover:bg-phosphor/10'
                        : 'cursor-not-allowed border-iron text-ash'
                    }`}
                  >
                    {price}ᚺ
                  </button>
                </div>
              );
            })}
          </div>

          {/* sell */}
          <div className="min-w-0 flex-1 overflow-y-auto p-3">
            <div className="micro mb-2 text-ash">YOUR PACK — THEY PAY</div>
            {sellables.length === 0 && (
              <p className="font-norse px-1 text-sm text-ash">Nothing they would weigh.</p>
            )}
            {sellables.map((inst) => {
              const def = ITEMS[inst.itemId]!;
              const pending = isInstancePending(inst.instanceId);
              return (
                <div
                  key={inst.instanceId}
                  className="mb-1 flex items-center gap-2 border border-iron/60 bg-stone/40 px-2 py-1.5"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center border border-iron bg-abyss/60">
                    <ItemIcon def={def} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-bone">
                      {def.name}
                      {inst.qty > 1 ? ` ×${inst.qty}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending || pendingOps.length > 0}
                    title={`Sell one ${def.name}`}
                    onClick={() => submitOp(buildSellOp(inst.instanceId, 1))}
                    className={`stat flex-none border px-2 py-1 text-[11px] transition-colors ${
                      pending
                        ? 'cursor-wait border-iron text-ash'
                        : 'border-bone/40 text-bone-dim hover:border-phosphor hover:text-phosphor'
                    }`}
                  >
                    +{def.sellPrice}ᚺ
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
