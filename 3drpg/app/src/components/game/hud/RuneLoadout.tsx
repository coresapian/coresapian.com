// ============================================================================
// CORESAPIAN — Rune loadout (gdd §4: Q/R/F/V slots; contracts RuneLoadout).
// Icon + key label + wyrd cost; cooldown radial sweep (conic) driven by the
// engine probe when the engine publishes per-slot cooldowns.
// ============================================================================

import { ITEMS } from '../../../../contracts/items';
import { RUNE_SLOT_KEYS } from '../../../../contracts/types';
import { useGameStore } from '@/game/store';
import { ItemIcon } from '../itemVisual';
import type { EngineProbe } from './probe';

const SCHOOL_TEXT: Record<string, string> = {
  fire: 'text-phosphor',
  ice: 'text-ice',
  storm: 'text-galdr',
  spirit: 'text-soul',
};

export default function RuneLoadout({ probe }: { probe: EngineProbe }) {
  const runeLoadout = useGameStore((s) => s.runeLoadout);

  return (
    <div className="pointer-events-none flex gap-2">
      {runeLoadout.map((runeId, i) => {
        const def = runeId ? ITEMS[runeId] : undefined;
        const rune = def && def.kind === 'rune' ? def : undefined;
        const remaining = probe.runeCooldowns?.[i] ?? 0;
        const frac =
          rune && remaining > 0 ? Math.min(1, remaining / rune.cooldownSec) : 0;
        return (
          <div
            key={RUNE_SLOT_KEYS[i]}
            title={
              rune
                ? `${rune.name} — ${rune.description} (ᚹ ${rune.wyrdCost} · ${rune.cooldownSec}s)`
                : `${RUNE_SLOT_KEYS[i]} — no rune inscribed`
            }
            className={`relative h-12 w-12 border bg-stone/80 ${
              rune ? 'border-iron' : 'border-dashed border-iron/60'
            }`}
          >
            <span className="micro absolute left-1 top-0.5 text-[8px] text-phosphor">
              {RUNE_SLOT_KEYS[i]}
            </span>
            {rune ? (
              <span
                className={`flex h-full w-full items-center justify-center ${
                  SCHOOL_TEXT[rune.school] ?? 'text-bone'
                }`}
              >
                <ItemIcon def={rune} size={18} />
              </span>
            ) : (
              <span className="font-runic flex h-full w-full items-center justify-center text-sm text-iron-2/70">
                ᚱ
              </span>
            )}
            {/* cooldown radial sweep */}
            {frac > 0 && (
              <span
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  background: `conic-gradient(rgb(var(--void-rgb) / 0.78) ${Math.round(
                    frac * 360,
                  )}deg, transparent 0deg)`,
                }}
              >
                <span className="stat text-[10px] text-bone">{remaining.toFixed(1)}</span>
              </span>
            )}
            {rune && (
              <span className="micro absolute bottom-0 right-1 text-[8px] text-galdr">
                {rune.wyrdCost}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
