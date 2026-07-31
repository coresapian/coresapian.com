// ============================================================================
// CORESAPIAN — shared item presentation: kind/school/slot → lucide glyph,
// contracts `tier` (1..5) → rarity label/color per game.md S6 vocabulary
// (Common bone / Fine ice / Masterwork galdr / Saga-Forged phosphor).
// ============================================================================

import { createElement, type ComponentType } from 'react';
import {
  Anvil,
  Axe,
  Bone,
  CircleDot,
  Coins,
  Droplets,
  Flame,
  FlaskConical,
  Footprints,
  Gem,
  Ghost,
  Hammer,
  Hand,
  HardHat,
  Heart,
  Leaf,
  Package,
  Shield,
  Shirt,
  Snowflake,
  Sparkles,
  Sword,
  Target,
  TreePine,
  Zap,
} from 'lucide-react';

import type { ItemDef } from '../../../contracts/items';

type Icon = ComponentType<{ size?: number | string; className?: string }>;

function iconFor(def: ItemDef): Icon {
  switch (def.kind) {
    case 'weapon':
      return def.weaponClass === 'axe' ? Axe : def.weaponClass === 'hammer' ? Hammer : Sword;
    case 'shield':
      return Shield;
    case 'bow':
      return Target;
    case 'rune':
      return def.school === 'fire'
        ? Flame
        : def.school === 'ice'
          ? Snowflake
          : def.school === 'storm'
            ? Zap
            : Ghost;
    case 'armor':
      switch (def.slot) {
        case 'head':
          return HardHat;
        case 'chest':
          return Shirt;
        case 'hands':
          return Hand;
        case 'legs':
        case 'feet':
          return Footprints;
        case 'amulet':
          return Gem;
        case 'ring':
          return CircleDot;
        default:
          return Shield;
      }
    case 'consumable':
      switch (def.effect.type) {
        case 'heal':
        case 'regen':
          return Heart;
        case 'restore_stamina':
          return Droplets;
        case 'restore_wyrd':
          return Sparkles;
        case 'buff_power':
          return Flame;
        case 'buff_defense':
          return Shield;
        default:
          return FlaskConical;
      }
    case 'material':
      if (def.id === 'mat_wood') return TreePine;
      if (def.id === 'mat_iron' || def.id === 'mat_steel') return Anvil;
      if (def.id === 'mat_bone') return Bone;
      if (def.id === 'mat_herb') return Leaf;
      if (def.id === 'mat_gold') return Coins;
      if (
        def.id === 'mat_crystal' ||
        def.id === 'mat_rime' ||
        def.id === 'mat_ember' ||
        def.id === 'mat_essence' ||
        def.id === 'mat_sap'
      )
        return Gem;
      return Package;
    default:
      return Package;
  }
}

export interface Rarity {
  label: string;
  /** Tailwind text color class. */
  text: string;
  /** Tailwind border color class. */
  border: string;
}

/** contracts tier (1..5 power band) → game.md rarity vocabulary. */
export function rarityOf(tier: number): Rarity {
  if (tier >= 4)
    return { label: 'SAGA-FORGED', text: 'text-phosphor', border: 'border-phosphor/60' };
  if (tier === 3)
    return { label: 'MASTERWORK', text: 'text-galdr', border: 'border-galdr/50' };
  if (tier === 2) return { label: 'FINE', text: 'text-ice', border: 'border-ice/50' };
  return { label: 'COMMON', text: 'text-bone', border: 'border-iron-2' };
}

export function ItemIcon({
  def,
  size = 20,
  className = '',
}: {
  def: ItemDef;
  size?: number;
  className?: string;
}) {
  // iconFor returns a stable module-level component reference (lucide icons);
  // createElement keeps the static-components rule happy without resetting state.
  return createElement(iconFor(def), { size, className });
}
