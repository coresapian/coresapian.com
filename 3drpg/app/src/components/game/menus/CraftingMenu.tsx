// ============================================================================
// CORESAPIAN — Crafting (game.md S8, gdd §7.2). Recipes from contracts
// RECIPES grouped by station; have/need materials; disabled reasons;
// craft via beginOp(buildCraftOp) — server-authoritative. Station context:
// forge/alchemy recipes note their station (the Dvergr Craft realm ability
// lifts the requirement); the server validates the op.
// ============================================================================

import { useMemo, useState } from 'react';

import type { CraftStation, Recipe } from '../../../../contracts/items';
import { ITEMS, RECIPES } from '../../../../contracts/items';
import { useGameStore } from '@/game/store';
import { buildCraftOp, submitOp } from '../gameOps';
import { ItemIcon, rarityOf } from '../itemVisual';
import { MenuAction, MenuShell } from './menuShared';

const STATION_ORDER: { id: CraftStation; label: string; rune: string }[] = [
  { id: 'forge', label: 'FORGE', rune: 'ᚨ' },
  { id: 'alchemy', label: 'ALCHEMY', rune: 'ᚹ' },
  { id: 'none', label: 'FIELD CRAFT', rune: 'ᚠ' },
];

export default function CraftingMenu() {
  const items = useGameStore((s) => s.items);
  const level = useGameStore((s) => s.level);
  const realmAbilities = useGameStore((s) => s.realmAbilities);
  const pendingOps = useGameStore((s) => s.pendingOps);
  const setMenu = useGameStore((s) => s.setMenu);
  const [openId, setOpenId] = useState<string | null>(null);

  const craftAnywhere = realmAbilities.includes('ra_svartalfheim');

  const stock = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of items) map.set(inst.itemId, (map.get(inst.itemId) ?? 0) + inst.qty);
    return map;
  }, [items]);

  const byStation = useMemo(() => {
    const groups = new Map<CraftStation, Recipe[]>();
    for (const s of STATION_ORDER) groups.set(s.id, []);
    for (const r of Object.values(RECIPES)) groups.get(r.station)?.push(r);
    for (const list of groups.values()) list.sort((a, b) => a.minLevel - b.minLevel);
    return groups;
  }, []);

  const gateFor = (r: Recipe): { ok: boolean; reason: string | null } => {
    if (level < r.minLevel) return { ok: false, reason: `REQUIRES LEVEL ${r.minLevel}` };
    for (const req of r.requires) {
      const have = stock.get(req.itemId) ?? 0;
      if (have < req.qty) {
        return { ok: false, reason: `MISSING ${ITEMS[req.itemId]?.name.toUpperCase() ?? req.itemId}` };
      }
    }
    return { ok: true, reason: null };
  };

  return (
    <MenuShell title="CRAFT & FORGE" rune="ᚲ" keyHint="TAB → CRAFT" onClose={() => setMenu('none')}>
      <div className="p-5">
        <p className="font-norse mb-4 text-sm text-bone-dim">
          Steel is folded with ash and patience. Forge and alchemy work ask for their stations
          {craftAnywhere ? (
            <span className="text-phosphor"> — but the Dvergr Craft lets you smith anywhere.</span>
          ) : (
            '.'
          )}
        </p>

        {STATION_ORDER.map(({ id, label, rune }) => {
          const list = byStation.get(id) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={id} className="mb-6">
              <header className="mb-2 flex items-center gap-2 border-b border-iron pb-1">
                <span className="font-runic text-phosphor">{rune}</span>
                <span className="micro text-bone">{label}</span>
                {id !== 'none' && (
                  <span className="micro text-ash">· REQUIRES {label} STATION</span>
                )}
              </header>
              <div className="flex flex-col gap-1.5">
                {list.map((r) => {
                  const result = ITEMS[r.result.itemId];
                  if (!result) return null;
                  const rarity = rarityOf(result.tier);
                  const gate = gateFor(r);
                  const open = openId === r.id;
                  const busy = pendingOps.length > 0;
                  return (
                    <div key={r.id} className="border border-iron/70 bg-stone/40">
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : r.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-stone/70"
                      >
                        <span className={`flex h-9 w-9 items-center justify-center border ${rarity.border} bg-abyss/60`}>
                          <ItemIcon def={result} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-bone">
                            {result.name}
                            {r.result.qty > 1 ? ` ×${r.result.qty}` : ''}
                          </span>
                          <span className="micro text-ash">
                            LVL {r.minLevel} · <span className={rarity.text}>{rarity.label}</span>
                          </span>
                        </span>
                        {!gate.ok && <span className="micro text-blood-hi">{gate.reason}</span>}
                      </button>
                      {open && (
                        <div className="border-t border-iron/60 px-3 py-2">
                          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                            {r.requires.map((req) => {
                              const have = stock.get(req.itemId) ?? 0;
                              const enough = have >= req.qty;
                              return (
                                <span
                                  key={req.itemId}
                                  className={`stat text-[11px] ${enough ? 'text-bone-dim' : 'text-blood-hi'}`}
                                >
                                  {ITEMS[req.itemId]?.name ?? req.itemId} {have}/{req.qty}
                                </span>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-3">
                            <MenuAction
                              label={busy ? 'FORGING…' : 'CRAFT'}
                              disabled={!gate.ok || busy}
                              title={gate.reason ?? `Craft ${result.name}`}
                              onClick={() => submitOp(buildCraftOp(r.id))}
                            />
                            <span className="text-[11px] italic text-ash">{result.description}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </MenuShell>
  );
}
