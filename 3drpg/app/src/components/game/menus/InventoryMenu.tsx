// ============================================================================
// CORESAPIAN — Inventory & equipment (game.md S6, gdd §7.1). Grid from
// store.items, 9 equipment slots from the server-acked store.equipment
// mirror (contracts EQUIP_SLOTS), click-to-equip via beginOp(buildEquipOp) —
// server-authoritative (addendum §5/§6). Offline = unrecorded tag.
// ============================================================================

import { useMemo, useState } from 'react';
import {
  CircleDot,
  Coins,
  Footprints,
  Gem,
  Hand,
  HardHat,
  Shield,
  Shirt,
  Sword,
} from 'lucide-react';

import { ITEMS, upgradeCost, upgradeGold } from '../../../../contracts/items';
import type { EquipSlot, ItemInstance } from '../../../../contracts/types';
import { EQUIP_SLOTS, MAX_UPGRADE_LEVEL, RUNE_SLOT_KEYS } from '../../../../contracts/types';
import { useGameStore } from '@/game/store';
import {
  buildConsumeOp,
  buildDropOp,
  buildEquipOp,
  buildInscribeRuneOp,
  buildUnequipOp,
  buildUpgradeOp,
  isInstancePending,
  submitOp,
} from '../gameOps';
import { ItemIcon, rarityOf } from '../itemVisual';
import { ItemTooltip, MenuAction, MenuShell } from './menuShared';

const SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: 'MAIN HAND',
  shield: 'OFF HAND',
  head: 'HEAD',
  chest: 'CHEST',
  hands: 'HANDS',
  legs: 'LEGS',
  feet: 'FEET',
  amulet: 'AMULET',
  ring: 'RING',
};

const SLOT_ICON: Record<EquipSlot, typeof Sword> = {
  weapon: Sword,
  shield: Shield,
  head: HardHat,
  chest: Shirt,
  hands: Hand,
  legs: Footprints,
  feet: Footprints,
  amulet: Gem,
  ring: CircleDot,
};

/** The equipment slot a def equips into. */
function slotFor(defId: string): EquipSlot | null {
  const def = ITEMS[defId];
  if (!def) return null;
  if (def.kind === 'weapon' || def.kind === 'bow') return 'weapon';
  if (def.kind === 'shield') return 'shield';
  if (def.kind === 'armor') return def.slot;
  return null;
}

interface Selection {
  inst: ItemInstance;
  equippedSlot: EquipSlot | null;
}

export default function InventoryMenu() {
  const items = useGameStore((s) => s.items);
  const equipment = useGameStore((s) => s.equipment);
  const gold = useGameStore((s) => s.gold);
  const runeLoadout = useGameStore((s) => s.runeLoadout);
  const status = useGameStore((s) => s.status);
  const pendingOps = useGameStore((s) => s.pendingOps);
  const setMenu = useGameStore((s) => s.setMenu);

  const [selected, setSelected] = useState<Selection | null>(null);
  const selectedDef = selected ? ITEMS[selected.inst.itemId] : undefined;

  // Material stock counts (for upgrade cost display).
  const stock = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of items) map.set(inst.itemId, (map.get(inst.itemId) ?? 0) + inst.qty);
    return map;
  }, [items]);

  const gridCells = Math.max(32, Math.ceil((items.length + 4) / 8) * 8);

  const upgradeInfo = useMemo(() => {
    if (!selected || !selectedDef) return null;
    const kind = selectedDef.kind;
    if (kind !== 'weapon' && kind !== 'bow' && kind !== 'shield' && kind !== 'armor') return null;
    const next = selected.inst.upgradeLevel + 1;
    if (next > MAX_UPGRADE_LEVEL) return null;
    const goldCost = upgradeGold(selectedDef.tier, next);
    const mats = upgradeCost(selectedDef.tier, next).map((m) => ({
      ...m,
      name: ITEMS[m.itemId]?.name ?? m.itemId,
      have: stock.get(m.itemId) ?? 0,
    }));
    const affordable = gold >= goldCost && mats.every((m) => m.have >= m.qty);
    return { next, goldCost, mats, affordable };
  }, [selected, selectedDef, gold, stock]);

  return (
    <MenuShell title="PACK & PANOPLY" rune="ᛁ" keyHint="TAB" onClose={() => setMenu('none')}>
      <div className="flex gap-5 p-5">
        {/* equipment column */}
        <div className="w-[176px] flex-none">
          <div className="micro mb-2 text-ash">WORN</div>
          <div className="grid grid-cols-2 gap-2">
            {EQUIP_SLOTS.map((slot) => {
              const inst = equipment[slot];
              const def = inst ? ITEMS[inst.itemId] : undefined;
              const SlotIcon = SLOT_ICON[slot];
              const isSel = selected?.inst.instanceId === inst?.instanceId && inst != null;
              return (
                <button
                  key={slot}
                  type="button"
                  title={def ? `${SLOT_LABEL[slot]} — ${def.name}` : SLOT_LABEL[slot]}
                  onClick={() =>
                    inst ? setSelected(isSel ? null : { inst, equippedSlot: slot }) : undefined
                  }
                  className={`flex h-16 w-full flex-col items-center justify-center gap-1 border transition-colors ${
                    inst
                      ? `${isSel ? 'border-phosphor' : 'border-iron'} bg-stone/80 hover:border-phosphor`
                      : 'border-dashed border-iron/60 text-iron-2'
                  }`}
                >
                  {def ? (
                    <span className="text-bone">
                      <ItemIcon def={def} size={18} />
                    </span>
                  ) : (
                    <SlotIcon size={16} />
                  )}
                  <span className="micro text-[7px] text-ash">{SLOT_LABEL[slot]}</span>
                </button>
              );
            })}
          </div>

          {/* rune loadout strip */}
          <div className="micro mb-2 mt-4 text-ash">INSCRIBED RUNES</div>
          <div className="grid grid-cols-4 gap-1">
            {runeLoadout.map((id, i) => {
              const def = id ? ITEMS[id] : undefined;
              return (
                <div
                  key={RUNE_SLOT_KEYS[i]}
                  title={def ? def.name : `${RUNE_SLOT_KEYS[i]} — empty`}
                  className={`flex h-9 items-center justify-center border ${
                    def ? 'border-iron bg-stone/80' : 'border-dashed border-iron/60'
                  }`}
                >
                  {def ? (
                    <ItemIcon def={def} size={14} />
                  ) : (
                    <span className="micro text-[8px] text-iron-2">{RUNE_SLOT_KEYS[i]}</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-2 border border-iron bg-stone/60 px-3 py-2">
            <Coins size={13} className="text-phosphor" />
            <span className="stat text-sm text-phosphor">{gold.toLocaleString()}</span>
            <span className="micro text-ash">HACKSILVER</span>
          </div>
          {status !== 'connected' && (
            <div className="micro mt-2 text-blood-hi">OFFLINE — UNRECORDED</div>
          )}
        </div>

        {/* grid column */}
        <div className="min-w-0 flex-1">
          <div className="micro mb-2 text-ash">PACK ({items.length})</div>
          <div className="grid grid-cols-8 gap-1.5">
            {Array.from({ length: gridCells }, (_, i) => {
              const inst = items[i];
              if (!inst) {
                return (
                  <div key={`empty-${i}`} className="h-12 w-12 border border-dashed border-iron/40" />
                );
              }
              const def = ITEMS[inst.itemId];
              if (!def) return null;
              const rarity = rarityOf(def.tier);
              const pending = pendingOps.length > 0 && isInstancePending(inst.instanceId);
              const isSel = selected?.inst.instanceId === inst.instanceId;
              return (
                <button
                  key={inst.instanceId}
                  type="button"
                  onClick={() =>
                    setSelected(isSel ? null : { inst, equippedSlot: null })
                  }
                  title={def.name}
                  className={`relative flex h-12 w-12 items-center justify-center border bg-stone/80 transition-all hover:-translate-y-0.5 ${
                    isSel ? 'border-phosphor' : rarity.border
                  } ${pending ? 'animate-[glow-breathe_1s_ease-in-out_infinite] opacity-50' : ''}`}
                >
                  <span className="text-bone">
                    <ItemIcon def={def} size={18} />
                  </span>
                  {inst.qty > 1 && (
                    <span className="stat absolute bottom-0 right-0.5 text-[9px] text-bone">
                      {inst.qty}
                    </span>
                  )}
                  {inst.upgradeLevel > 0 && (
                    <span className="stat absolute right-0.5 top-0.5 text-[8px] text-phosphor">
                      +{inst.upgradeLevel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* selection detail */}
          <div className="mt-4 min-h-[120px] border border-iron bg-abyss/50 p-4">
            {selected && selectedDef ? (
              <ItemTooltip
                def={selectedDef}
                inst={selected.inst}
                equipped={selected.equippedSlot !== null}
                actions={
                  <>
                    {selected.equippedSlot ? (
                      <MenuAction
                        label="UNEQUIP"
                        onClick={() => submitOp(buildUnequipOp(selected.equippedSlot!))}
                      />
                    ) : (
                      slotFor(selected.inst.itemId) && (
                        <MenuAction
                          label="EQUIP"
                          onClick={() =>
                            submitOp(
                              buildEquipOp(selected.inst.instanceId, slotFor(selected.inst.itemId)!),
                            )
                          }
                        />
                      )
                    )}
                    {!selected.equippedSlot && selectedDef.kind === 'consumable' && (
                      <MenuAction
                        label="USE"
                        onClick={() => submitOp(buildConsumeOp(selected.inst.instanceId))}
                      />
                    )}
                    {!selected.equippedSlot &&
                      selectedDef.kind === 'rune' &&
                      RUNE_SLOT_KEYS.map((key, i) => (
                        <MenuAction
                          key={key}
                          label={`ᚱ ${key}`}
                          title={`Inscribe into ${key}`}
                          onClick={() => submitOp(buildInscribeRuneOp(selected.inst.instanceId, i))}
                        />
                      ))}
                    {upgradeInfo && (
                      <MenuAction
                        label={`FORGE +${upgradeInfo.next} (${upgradeInfo.goldCost}ᚺ)`}
                        title={
                          upgradeInfo.affordable
                            ? 'Blacksmith upgrade'
                            : `Needs ${upgradeInfo.goldCost} gold + ${upgradeInfo.mats
                                .map((m) => `${m.qty} ${m.name}`)
                                .join(', ')}`
                        }
                        disabled={!upgradeInfo.affordable}
                        onClick={() => submitOp(buildUpgradeOp(selected.inst.instanceId))}
                      />
                    )}
                    <MenuAction
                      label="DROP"
                      title="Cast it upon the ground"
                      onClick={() => {
                        submitOp(buildDropOp(selected.inst.instanceId, 1));
                        setSelected(null);
                      }}
                    />
                  </>
                }
              />
            ) : (
              <p className="font-norse text-sm text-ash">
                Choose an object from the pack to inspect it.
              </p>
            )}
            {upgradeInfo && (
              <div className="micro mt-2 text-ash">
                FORGE COST: {upgradeInfo.goldCost} GOLD
                {upgradeInfo.mats.map((m) => (
                  <span key={m.itemId} className={m.have >= m.qty ? 'text-bone-dim' : 'text-blood-hi'}>
                    {' '}
                    · {m.name.toUpperCase()} {m.have}/{m.qty}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </MenuShell>
  );
}
