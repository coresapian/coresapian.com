// ============================================================================
// CORESAPIAN — Hotbar (gdd §4: slots 1–4 = first 4 consumables in inventory;
// count badges). Click = beginOp(buildConsumeOp) per addendum §5/§6.
// ============================================================================

import { useMemo } from 'react';

import { ITEMS } from '../../../../contracts/items';
import type { ItemInstance } from '../../../../contracts/types';
import { useGameStore } from '@/game/store';
import { buildConsumeOp, isInstancePending, submitOp } from '../gameOps';
import { ItemIcon } from '../itemVisual';

function consumableEffectText(itemId: string): string {
  const def = ITEMS[itemId];
  if (!def || def.kind !== 'consumable') return '';
  const e = def.effect;
  switch (e.type) {
    case 'heal':
      return `+${e.amount} HP over ${e.overSec}s`;
    case 'restore_stamina':
      return `+${e.amount} stamina`;
    case 'restore_wyrd':
      return `+${e.amount} wyrd`;
    case 'buff_power':
      return `+${Math.round((e.mult - 1) * 100)}% power ${e.durationSec}s`;
    case 'buff_defense':
      return `+${e.armor} armor ${e.durationSec}s`;
    case 'regen':
      return `+${e.hpPerSec} HP/s ${e.durationSec}s`;
    default:
      return '';
  }
}

export default function Hotbar() {
  const items = useGameStore((s) => s.items);
  const pendingOps = useGameStore((s) => s.pendingOps);

  const consumables = useMemo(
    () =>
      items
        .filter((it) => ITEMS[it.itemId]?.kind === 'consumable')
        .slice(0, 4) as ItemInstance[],
    [items],
  );

  const slots: (ItemInstance | null)[] = [0, 1, 2, 3].map((i) => consumables[i] ?? null);

  return (
    <div className="pointer-events-none flex gap-2">
      {slots.map((inst, i) => {
        const def = inst ? ITEMS[inst.itemId] : undefined;
        const pending = inst ? pendingOps.length > 0 && isInstancePending(inst.instanceId) : false;
        return (
          <button
            key={i}
            type="button"
            disabled={!inst || pending}
            onClick={() => {
              if (!inst || isInstancePending(inst.instanceId)) return;
              submitOp(buildConsumeOp(inst.instanceId));
            }}
            title={
              def
                ? `${def.name} — ${consumableEffectText(def.id)} (${inst!.qty} left)`
                : `Slot ${i + 1} — no consumable packed`
            }
            className={`group pointer-events-auto relative h-14 w-14 border bg-stone/80 transition-all duration-150 ${
              inst
                ? 'border-iron hover:-translate-y-1 hover:border-phosphor'
                : 'border-dashed border-iron/60'
            } ${pending ? 'animate-[glow-breathe_1s_ease-in-out_infinite] opacity-50' : ''}`}
          >
            <span className="micro absolute left-1 top-0.5 text-[8px] text-ash">{i + 1}</span>
            {def && inst ? (
              <>
                <span className="flex h-full w-full items-center justify-center text-bone group-hover:text-phosphor">
                  <ItemIcon def={def} size={20} />
                </span>
                <span className="stat absolute bottom-0.5 right-1 text-[10px] text-bone">
                  {inst.qty}
                </span>
              </>
            ) : (
              <span className="font-runic flex h-full w-full items-center justify-center text-iron-2/70 text-sm">
                ᛭
              </span>
            )}
            {/* selected/hover corner brackets */}
            <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span className="absolute left-0 top-0 h-2 w-2 border-l-2 border-t-2 border-phosphor" />
              <span className="absolute right-0 top-0 h-2 w-2 border-r-2 border-t-2 border-phosphor" />
              <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-phosphor" />
              <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-phosphor" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
