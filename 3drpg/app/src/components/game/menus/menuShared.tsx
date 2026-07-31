// ============================================================================
// CORESAPIAN — shared menu chrome: backdrop, stone slab shell with runic
// header, item tooltip with stats (game.md S6 panel grammar).
// ============================================================================

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import type { ItemDef } from '../../../../contracts/items';
import { UPGRADE_STAT_MULT_PER_LEVEL } from '../../../../contracts/items';
import type { ItemInstance } from '../../../../contracts/types';
import { rarityOf } from '../itemVisual';

// ---------------------------------------------------------------------------
// Menu shell
// ---------------------------------------------------------------------------

export function MenuShell({
  title,
  rune,
  keyHint,
  onClose,
  children,
  width = 'w-[min(94vw,860px)]',
}: {
  title: string;
  rune: string;
  keyHint: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-void/70 backdrop-blur-[8px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`panel flex max-h-[86vh] flex-col ${width}`}>
        <header className="flex items-center gap-3 border-b border-iron px-5 py-3">
          <span className="font-runic text-xl leading-none text-phosphor">{rune}</span>
          <h2 className="font-display text-base font-black uppercase tracking-[0.2em] text-bone">
            {title}
          </h2>
          <span className="micro text-ash">· {keyHint}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto flex h-7 w-7 items-center justify-center border border-iron text-ash transition-colors hover:border-blood hover:text-blood-hi"
          >
            <X size={13} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item stats + tooltip
// ---------------------------------------------------------------------------

export function itemStatLines(def: ItemDef, inst?: ItemInstance | null): string[] {
  const lines: string[] = [];
  const upgrade = inst?.upgradeLevel ?? 0;
  const mult = 1 + UPGRADE_STAT_MULT_PER_LEVEL * upgrade;
  switch (def.kind) {
    case 'weapon':
      lines.push(
        `DAMAGE ${Math.round(def.damage * mult)} · ${def.attackSpeed}/s · ${def.range}m reach`,
      );
      break;
    case 'bow':
      lines.push(
        `DAMAGE ${Math.round(def.damage * mult)} · DRAWS ${def.drawTime}s · +${Math.round(def.critBonus * 100)}% CRIT`,
      );
      break;
    case 'shield':
      lines.push(
        `BLOCK ${Math.round(def.blockReduction * 100)}% · ARMOR ${Math.round(def.armor * mult)}`,
      );
      break;
    case 'armor': {
      lines.push(`ARMOR ${Math.round(def.armor * mult)}`);
      if (def.bonus) {
        for (const [k, v] of Object.entries(def.bonus)) {
          if (typeof v === 'number') lines.push(`+${v} ${k.replace(/([A-Z])/g, ' $1').toUpperCase()}`);
        }
      }
      break;
    }
    case 'rune':
      lines.push(
        `${def.school.toUpperCase()} SCHOOL · ${Math.round(def.damage * mult)} DMG · ᚹ ${def.wyrdCost} · ${def.cooldownSec}s CD`,
      );
      break;
    case 'consumable': {
      const e = def.effect;
      if (e.type === 'heal') lines.push(`+${e.amount} HP over ${e.overSec}s`);
      else if (e.type === 'restore_stamina') lines.push(`+${e.amount} STAMINA`);
      else if (e.type === 'restore_wyrd') lines.push(`+${e.amount} WYRD`);
      else if (e.type === 'buff_power') lines.push(`+${Math.round((e.mult - 1) * 100)}% POWER ${e.durationSec}s`);
      else if (e.type === 'buff_defense') lines.push(`+${e.armor} ARMOR ${e.durationSec}s`);
      else if (e.type === 'regen') lines.push(`+${e.hpPerSec} HP/S ${e.durationSec}s`);
      break;
    }
    default:
      break;
  }
  if (upgrade > 0) lines.push(`FORGED +${upgrade}`);
  if (def.sellPrice > 0) lines.push(`WORTH ${def.sellPrice} HACKSILVER`);
  return lines;
}

const KIND_LABEL: Record<ItemDef['kind'], string> = {
  weapon: 'WEAPON',
  shield: 'SHIELD',
  bow: 'BOW',
  armor: 'ARMOR',
  rune: 'RUNE',
  consumable: 'PROVISION',
  material: 'MATERIAL',
};

export function ItemTooltip({
  def,
  inst,
  equipped,
  actions,
}: {
  def: ItemDef;
  inst?: ItemInstance | null;
  equipped?: boolean;
  actions?: ReactNode;
}) {
  const rarity = rarityOf(def.tier);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-norse text-base text-bone">{def.name}</span>
        <span className={`micro ${rarity.text}`}>{rarity.label}</span>
      </div>
      <div className="micro text-ash">
        {KIND_LABEL[def.kind]}
        {inst && inst.qty > 1 ? ` · ×${inst.qty}` : ''}
        {equipped ? ' · EQUIPPED' : ''}
      </div>
      {itemStatLines(def, inst).map((line) => (
        <div key={line} className="stat text-[11px] text-bone-dim">
          {line}
        </div>
      ))}
      <p className="mt-1 border-t border-iron/60 pt-1.5 text-[11px] italic leading-snug text-ash">
        {def.description}
      </p>
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small etched action button used inside tooltips and rows. */
export function MenuAction({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="border border-iron px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-bone-dim transition-colors hover:border-phosphor hover:text-phosphor disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}
