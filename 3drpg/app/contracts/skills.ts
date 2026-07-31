// ============================================================================
// CORESAPIAN — contracts/skills.ts
// XP curve, three skill branches (10 nodes each), and nine realm abilities.
// Pure data; rpg-quests agent implements the runtime that applies effects.
// ============================================================================

import type { RealmId } from './types';

// ---------------------------------------------------------------------------
// Progression constants (LOCKED — gdd.md §6 derives the whole economy from these)
// ---------------------------------------------------------------------------

export const LEVEL_CAP = 40;

/** xpToNext(level) = XP_BASE * level * (level + 1). Level 1->2 costs 100. */
export const XP_BASE = 50;

export function xpToNext(level: number): number {
  return XP_BASE * level * (level + 1);
}

/** Total XP required to reach `level` from level 1. */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

/** 1 skill point per level + 1 per completed campaign chapter (9 total) = 49 max. */
export const SKILL_POINTS_PER_LEVEL = 1;
export const SKILL_POINTS_PER_CHAPTER = 1;

// ---------------------------------------------------------------------------
// Skill effects — structured so any system can apply them generically
// ---------------------------------------------------------------------------

export type StatKey =
  | 'meleeDamage'
  | 'rangedDamage'
  | 'spellDamage'
  | 'maxHp'
  | 'maxStamina'
  | 'maxWyrd'
  | 'critChance'
  | 'critMultiplier'
  | 'blockReduction'
  | 'staminaCost'
  | 'cooldown'
  | 'moveSpeed'
  | 'armorPen'
  | 'summonDuration'
  | 'xpGain'
  | 'attackSpeed'
  | 'armor';

export interface SkillEffect {
  stat: StatKey;
  op: 'add' | 'mult';
  /** Applied per rank: add => stat += perRank; mult => stat *= perRank^rank. */
  perRank: number;
}

export type SkillBranch = 'warrior' | 'hunter' | 'seidr';

export interface SkillNode {
  id: string;
  branch: SkillBranch;
  name: string;
  description: string;
  maxRank: number;
  /** Skill points per rank. */
  costPerRank: number;
  /** Node ids that must have >=1 rank first. */
  requires: string[];
  effects: SkillEffect[];
}

// ---------------------------------------------------------------------------
// Branch: Warrior (Hildr's road — melee, shield, stamina)
// ---------------------------------------------------------------------------

const WARRIOR: SkillNode[] = [
  {
    id: 'sk_war_ironskin', branch: 'warrior', name: 'Járnskin',
    description: 'Skin like boiled hide. +6 armor per rank.',
    maxRank: 3, costPerRank: 1, requires: [],
    effects: [{ stat: 'armor', op: 'add', perRank: 6 }],
  },
  {
    id: 'sk_war_heavy', branch: 'warrior', name: 'Þungr Hǫgg',
    description: 'Heavy blows land harder. +8% melee damage per rank.',
    maxRank: 3, costPerRank: 1, requires: [],
    effects: [{ stat: 'meleeDamage', op: 'mult', perRank: 1.08 }],
  },
  {
    id: 'sk_war_shield', branch: 'warrior', name: 'Skjaldarlist',
    description: 'Shield-craft of the old levy. +5% block reduction per rank.',
    maxRank: 3, costPerRank: 1, requires: [],
    effects: [{ stat: 'blockReduction', op: 'add', perRank: 0.05 }],
  },
  {
    id: 'sk_war_secondwind', branch: 'warrior', name: 'Önd-Vindr',
    description: 'A second breath in the press of battle. +15 max stamina per rank.',
    maxRank: 2, costPerRank: 1, requires: [],
    effects: [{ stat: 'maxStamina', op: 'add', perRank: 15 }],
  },
  {
    id: 'sk_war_stagger', branch: 'warrior', name: 'Vá-Slag',
    description: 'Your hits break guards. +10% armor penetration per rank.',
    maxRank: 2, costPerRank: 2, requires: ['sk_war_heavy'],
    effects: [{ stat: 'armorPen', op: 'add', perRank: 0.1 }],
  },
  {
    id: 'sk_war_parry', branch: 'warrior', name: 'Gagn-Vǫrn',
    description: 'The answering wall. Parry window +40ms per rank.',
    maxRank: 2, costPerRank: 2, requires: ['sk_war_shield'],
    effects: [{ stat: 'blockReduction', op: 'add', perRank: 0.03 }],
  },
  {
    id: 'sk_war_berserk', branch: 'warrior', name: 'Berserksgangr',
    description: 'The bear-shirt comes over you. Below 30% health: +12% melee damage per rank.',
    maxRank: 3, costPerRank: 2, requires: ['sk_war_heavy', 'sk_war_secondwind'],
    effects: [{ stat: 'meleeDamage', op: 'mult', perRank: 1.12 }],
  },
  {
    id: 'sk_war_endurance', branch: 'warrior', name: 'Kappa-Þol',
    description: 'A champion’s lungs. +25 max health per rank.',
    maxRank: 3, costPerRank: 1, requires: ['sk_war_ironskin'],
    effects: [{ stat: 'maxHp', op: 'add', perRank: 25 }],
  },
  {
    id: 'sk_war_whirlwind', branch: 'warrior', name: 'Hvirfil-Hǫgg',
    description: 'Heavy attacks strike all foes in reach. -10% stamina cost per rank.',
    maxRank: 2, costPerRank: 3, requires: ['sk_war_stagger'],
    effects: [{ stat: 'staminaCost', op: 'mult', perRank: 0.9 }],
  },
  {
    id: 'sk_war_execute', branch: 'warrior', name: 'Feykju-Hǫgg',
    description: 'The death-blow. +20% damage to foes under 25% health per rank.',
    maxRank: 2, costPerRank: 3, requires: ['sk_war_berserk'],
    effects: [{ stat: 'meleeDamage', op: 'mult', perRank: 1.2 }],
  },
];

// ---------------------------------------------------------------------------
// Branch: Hunter (Veiðr road — bow, mobility, precision)
// ---------------------------------------------------------------------------

const HUNTER: SkillNode[] = [
  {
    id: 'sk_hun_eagleeye', branch: 'hunter', name: 'Aurn-Auga',
    description: 'The eagle’s patience. +10% ranged damage per rank.',
    maxRank: 3, costPerRank: 1, requires: [],
    effects: [{ stat: 'rangedDamage', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_hun_swiftdraw', branch: 'hunter', name: 'Snar-Dráttr',
    description: 'Nock, draw, loose — one breath. -12% bow draw time per rank.',
    maxRank: 2, costPerRank: 1, requires: [],
    effects: [{ stat: 'attackSpeed', op: 'mult', perRank: 1.12 }],
  },
  {
    id: 'sk_hun_fleet', branch: 'hunter', name: 'Fóthrjóðr',
    description: 'Feet that remember every path. +6% move speed per rank.',
    maxRank: 2, costPerRank: 1, requires: [],
    effects: [{ stat: 'moveSpeed', op: 'mult', perRank: 1.06 }],
  },
  {
    id: 'sk_hun_precision', branch: 'hunter', name: 'Ná-Skytnir',
    description: 'Thread the seam of any armor. +4% crit chance per rank.',
    maxRank: 3, costPerRank: 1, requires: ['sk_hun_eagleeye'],
    effects: [{ stat: 'critChance', op: 'add', perRank: 0.04 }],
  },
  {
    id: 'sk_hun_silent', branch: 'hunter', name: 'Þögul-Ganga',
    description: 'Walk like snowfall. Enemy aggro range -15% per rank.',
    maxRank: 2, costPerRank: 1, requires: [],
    effects: [{ stat: 'moveSpeed', op: 'mult', perRank: 1.0 }], // stealth handled by ai via rank lookup
  },
  {
    id: 'sk_hun_beastslayer', branch: 'hunter', name: 'Dýra-Bani',
    description: 'Know where the beast keeps its heart. +10% damage to beasts per rank.',
    maxRank: 2, costPerRank: 2, requires: ['sk_hun_eagleeye'],
    effects: [{ stat: 'rangedDamage', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_hun_volley', branch: 'hunter', name: 'Skot-Röð',
    description: 'Loose again before the first arrow lands. +10% attack speed per rank.',
    maxRank: 2, costPerRank: 2, requires: ['sk_hun_swiftdraw'],
    effects: [{ stat: 'attackSpeed', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_hun_longshot', branch: 'hunter', name: 'Langt-Skot',
    description: 'The far kill. +8% ranged damage per rank beyond 20m.',
    maxRank: 3, costPerRank: 2, requires: ['sk_hun_precision'],
    effects: [{ stat: 'rangedDamage', op: 'mult', perRank: 1.08 }],
  },
  {
    id: 'sk_hun_critkill', branch: 'hunter', name: 'Banamark',
    description: 'Marked for death. +20% crit damage per rank.',
    maxRank: 2, costPerRank: 3, requires: ['sk_hun_precision'],
    effects: [{ stat: 'critMultiplier', op: 'add', perRank: 0.2 }],
  },
  {
    id: 'sk_hun_ullr', branch: 'hunter', name: "Ullr's Blessing",
    description: 'The bow-god’s nod. First shot out of combat always crits; +5% crit chance per rank.',
    maxRank: 2, costPerRank: 3, requires: ['sk_hun_longshot', 'sk_hun_volley'],
    effects: [{ stat: 'critChance', op: 'add', perRank: 0.05 }],
  },
];

// ---------------------------------------------------------------------------
// Branch: Seiðr (galdr road — runes, wyrd, spirit)
// ---------------------------------------------------------------------------

const SEIDR: SkillNode[] = [
  {
    id: 'sk_sei_affinity', branch: 'seidr', name: 'Rúna-Fimi',
    description: 'Rune-craft runs in the blood. +12 max wyrd per rank.',
    maxRank: 3, costPerRank: 1, requires: [],
    effects: [{ stat: 'maxWyrd', op: 'add', perRank: 12 }],
  },
  {
    id: 'sk_sei_galdr', branch: 'seidr', name: 'Galdrameistari',
    description: 'Master of chants. -8% rune cooldowns per rank.',
    maxRank: 3, costPerRank: 1, requires: [],
    effects: [{ stat: 'cooldown', op: 'mult', perRank: 0.92 }],
  },
  {
    id: 'sk_sei_eldr', branch: 'seidr', name: 'Eldr-Adept',
    description: 'The fire answers faster. +10% fire spell damage per rank.',
    maxRank: 3, costPerRank: 1, requires: ['sk_sei_affinity'],
    effects: [{ stat: 'spellDamage', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_sei_iss', branch: 'seidr', name: 'Íss-Adept',
    description: 'The ice keeps its shape. +10% ice spell damage per rank.',
    maxRank: 3, costPerRank: 1, requires: ['sk_sei_affinity'],
    effects: [{ stat: 'spellDamage', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_sei_vedr', branch: 'seidr', name: 'Veðr-Adept',
    description: 'The storm takes sides. +10% storm spell damage per rank.',
    maxRank: 3, costPerRank: 1, requires: ['sk_sei_affinity'],
    effects: [{ stat: 'spellDamage', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_sei_andi', branch: 'seidr', name: 'Andi-Adept',
    description: 'The spirit stays. +10% spirit potency per rank.',
    maxRank: 3, costPerRank: 1, requires: ['sk_sei_affinity'],
    effects: [{ stat: 'spellDamage', op: 'mult', perRank: 1.1 }],
  },
  {
    id: 'sk_sei_wyrdwell', branch: 'seidr', name: 'Urðarbrunnr',
    description: 'Drink from the well beneath the root. +8% max wyrd per rank.',
    maxRank: 2, costPerRank: 2, requires: ['sk_sei_affinity'],
    effects: [{ stat: 'maxWyrd', op: 'mult', perRank: 1.08 }],
  },
  {
    id: 'sk_sei_echo', branch: 'seidr', name: 'Rúna-Gjarn',
    description: 'Sometimes the rune speaks twice. +7% chance per rank to cast without cooldown.',
    maxRank: 2, costPerRank: 3, requires: ['sk_sei_galdr'],
    effects: [{ stat: 'cooldown', op: 'mult', perRank: 1.0 }], // echo handled by combat via rank lookup
  },
  {
    id: 'sk_sei_spiritbond', branch: 'seidr', name: 'Fylgju-Band',
    description: 'The fetch lingers. +25% summon duration per rank.',
    maxRank: 2, costPerRank: 2, requires: ['sk_sei_andi'],
    effects: [{ stat: 'summonDuration', op: 'mult', perRank: 1.25 }],
  },
  {
    id: 'sk_sei_volva', branch: 'seidr', name: 'Vǫlu-Sjón',
    description: 'The seeress’s sight: enemy weak points glimmer. +6% crit chance per rank with runes.',
    maxRank: 2, costPerRank: 3, requires: ['sk_sei_wyrdwell'],
    effects: [{ stat: 'critChance', op: 'add', perRank: 0.06 }],
  },
];

export const SKILL_NODES: Record<string, SkillNode> = Object.fromEntries(
  [...WARRIOR, ...HUNTER, ...SEIDR].map((n) => [n.id, n]),
) as Record<string, SkillNode>;

export const SKILL_BRANCHES: Record<SkillBranch, { name: string; oldNorse: string; nodeIds: string[] }> = {
  warrior: { name: 'Warrior', oldNorse: 'Hildarvegur', nodeIds: WARRIOR.map((n) => n.id) },
  hunter: { name: 'Hunter', oldNorse: 'Veiðivegur', nodeIds: HUNTER.map((n) => n.id) },
  seidr: { name: 'Seiðr', oldNorse: 'Galdravegur', nodeIds: SEIDR.map((n) => n.id) },
};

// ---------------------------------------------------------------------------
// Realm abilities (9) — unlocked by completing each realm's chapter quest.
// ids are referenced by realms.ts `realmAbilityId` and quests.ts rewards.
// ---------------------------------------------------------------------------

export interface RealmAbility {
  id: string;
  realm: RealmId;
  name: string;
  oldNorse: string;
  description: string;
  /** Structured trigger + effect for the rpg runtime. */
  effect:
    | { type: 'passive_highlight'; target: 'resource_nodes'; radiusM: number }
    | { type: 'active_blink'; rangeM: number; cooldownSec: number }
    | { type: 'passive_craft_anywhere' }
    | { type: 'passive_carry'; weightMult: number; throwMult: number }
    | { type: 'passive_resist'; school: 'ice' | 'fire'; amount: number }
    | { type: 'passive_regen'; hpPerSec: number }
    | { type: 'passive_cheat_death'; cooldownSec: number }
    | { type: 'passive_xp'; mult: number };
}

export const REALM_ABILITIES: Record<string, RealmAbility> = {
  ra_midgard: {
    id: 'ra_midgard', realm: 'midgard', name: 'Earth-Sense', oldNorse: 'Jarðar-Skyn',
    description: 'The middle-earth tells you where it hides its bones: resource nodes glimmer through fog within 40m.',
    effect: { type: 'passive_highlight', target: 'resource_nodes', radiusM: 40 },
  },
  ra_alfheim: {
    id: 'ra_alfheim', realm: 'alfheim', name: 'Ljós-Step', oldNorse: 'Ljós-Stígr',
    description: 'Step through a fold of light: blink 8m forward. 20s cooldown. (Key: C)',
    effect: { type: 'active_blink', rangeM: 8, cooldownSec: 20 },
  },
  ra_svartalfheim: {
    id: 'ra_svartalfheim', realm: 'svartalfheim', name: 'Dvergr Craft', oldNorse: 'Dverga-Smiðja',
    description: 'Any flat stone is an anvil: craft forge and alchemy recipes anywhere.',
    effect: { type: 'passive_craft_anywhere' },
  },
  ra_jotunheim: {
    id: 'ra_jotunheim', realm: 'jotunheim', name: 'Jǫtun Grip', oldNorse: 'Jǫtun-Greip',
    description: 'Grip like a mountain: carry any prop without slowdown, throw with double force.',
    effect: { type: 'passive_carry', weightMult: 0, throwMult: 2 },
  },
  ra_niflheim: {
    id: 'ra_niflheim', realm: 'niflheim', name: 'Mist-Walk', oldNorse: 'Mist-Ganga',
    description: 'The primordial mist knows you: 60% ice resistance and realm fog thins around you.',
    effect: { type: 'passive_resist', school: 'ice', amount: 0.6 },
  },
  ra_muspelheim: {
    id: 'ra_muspelheim', realm: 'muspelheim', name: 'Eldr-Skin', oldNorse: 'Elds-Húð',
    description: 'Walk the ember-field unburned: 60% fire resistance, immune to burn.',
    effect: { type: 'passive_resist', school: 'fire', amount: 0.6 },
  },
  ra_vanaheim: {
    id: 'ra_vanaheim', realm: 'vanaheim', name: 'Vana Growth', oldNorse: 'Vana-Vǫxtr',
    description: 'The old harvest-gods feed you: regenerate 1.5 health per second.',
    effect: { type: 'passive_regen', hpPerSec: 1.5 },
  },
  ra_helheim: {
    id: 'ra_helheim', realm: 'helheim', name: "Hel's Bargain", oldNorse: 'Heljar-Sátt',
    description: 'Death takes payment once, not twice: survive a killing blow at 1 hp. 10-minute cooldown.',
    effect: { type: 'passive_cheat_death', cooldownSec: 600 },
  },
  ra_asgard: {
    id: 'ra_asgard', realm: 'asgard', name: "Allfather's Favor", oldNorse: 'Alfǫður-Gæfa',
    description: 'The high halls remember your name: +15% experience from all sources.',
    effect: { type: 'passive_xp', mult: 1.15 },
  },
};
