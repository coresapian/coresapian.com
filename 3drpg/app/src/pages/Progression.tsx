// ============================================================================
// CORESAPIAN — src/pages/Progression.tsx (design/progression.md — S1…S8)
// The systems bible as a carved war-table: arsenal, four rune schools, three
// skill-tree constellations, forge ledger (rarity + crafting), nine realm
// abilities, and the Norns' arithmetic (leveling math). Data from
// contracts/items.ts + skills.ts + enemies.ts + quests.ts.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import type { RealmId } from '../../contracts/types';
import { BOWS, ITEMS, RECIPES, RUNES, SHIELDS, WEAPONS, upgradeCost, upgradeGold } from '../../contracts/items';
import type { BowDef, RuneSchool, ShieldDef, WeaponDef } from '../../contracts/items';
import {
  LEVEL_CAP,
  REALM_ABILITIES,
  SKILL_BRANCHES,
  SKILL_NODES,
  SKILL_POINTS_PER_CHAPTER,
  SKILL_POINTS_PER_LEVEL,
  XP_BASE,
  totalXpForLevel,
  xpToNext,
} from '../../contracts/skills';
import type { SkillBranch, SkillNode } from '../../contracts/skills';
import { ENEMIES, REALM_BOSSES } from '../../contracts/enemies';
import { QUESTS } from '../../contracts/quests';
import { REALMS } from '../../contracts/realms';

import { useInView } from '@/lib/useInView';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import {
  BootType,
  CtaBand,
  KickerRow,
  RuneDivider,
  StatBar,
} from '@/components/site/primitives';
import { cssVar, reducedMotion, useHashScroll } from '@/components/site/utils';
import { SiteModal } from '@/components/site/SiteModal';
import { REALM_META, REALM_ORDER, toRoman } from '@/components/site/realmMeta';

gsap.registerPlugin(ScrollTrigger);

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------------------
// S1 · Header — "Steel, Runes, Saga"
// ---------------------------------------------------------------------------

const PATH_BADGES = [
  { branch: 'warrior' as SkillBranch, rune: 'ᚺ', label: 'HERSIR' },
  { branch: 'seidr' as SkillBranch, rune: 'ᚷ', label: 'GALDR' },
  { branch: 'hunter' as SkillBranch, rune: 'ᛋ', label: 'SKÁLD' },
];

function SagaHeader() {
  const [armed, setArmed] = useState(false);
  const title = useGlyphScramble('BECOME THE NINTH RUNE', armed);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 450);
    return () => window.clearTimeout(t);
  }, []);

  const goPath = (branch: SkillBranch) => {
    window.dispatchEvent(new CustomEvent<SkillBranch>('coresapian:skill-tab', { detail: branch }));
    scrollToId('skill-trees');
  };

  return (
    <section className="relative overflow-hidden bg-void py-24 md:py-32">
      <div className="absolute inset-0" aria-hidden="true">
        <img src="/class-hersir.jpg" alt="" className="h-full w-full object-cover opacity-[0.12]" loading="eager" />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, var(--void) 8%, transparent 55%), radial-gradient(ellipse at 50% 25%, rgba(255,182,74,0.06), transparent 60%)' }}
        />
      </div>
      <div className="relative mx-auto max-w-content px-4 sm:px-6">
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_auto]">
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE_EXPO }}>
            <KickerRow label="▚▚ THE CRAFT OF THE WANDERER" runes="ᚦᛒᚺᛟᛗ" />
            <h1 className="h1 mt-6" aria-label="BECOME THE NINTH RUNE">
              {title}
            </h1>
            <p className="norse-accent mt-5 max-w-reading text-bone-dim">
              Three paths. Four schools. Nine realms of whetstones.
            </p>
          </motion.div>

          {/* Path sigil badges → skill-tree tabs */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease: EASE_EXPO }}
            className="flex gap-5"
          >
            {PATH_BADGES.map((b, i) => (
              <button
                key={b.branch}
                type="button"
                onClick={() => goPath(b.branch)}
                className="group flex flex-col items-center gap-2"
                aria-label={`Open the ${b.label} skill tree`}
                title={`${b.label} skill tree`}
              >
                <span
                  className="sigil-badge transition-transform duration-300 group-hover:scale-110"
                  style={{ animationDelay: `${i * 0.2}s` }}
                >
                  <span>{b.rune}</span>
                </span>
                <span className="micro transition-colors group-hover:text-phosphor">{b.label}</span>
              </button>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S2 · The Arsenal — six contract weapons across the six weapon artworks
// ---------------------------------------------------------------------------

type ArsenalEntry =
  | { kind: 'weapon'; def: WeaponDef }
  | { kind: 'bow'; def: BowDef }
  | { kind: 'shield'; def: ShieldDef };

type ArsenalCard = ArsenalEntry & {
  img: string;
  cls: string;
  bars: { label: string; value: number }[];
};

function weaponById(id: string): WeaponDef {
  const w = WEAPONS.find((x) => x.id === id);
  if (!w) throw new Error(`missing weapon ${id}`);
  return w;
}

const ARSENAL: ArsenalCard[] = [
  {
    kind: 'weapon', def: weaponById('wpn_axe_skegg'), img: '/weapon-axe.jpg', cls: 'ONE-HAND · AXE',
    bars: [
      { label: 'DAMAGE', value: 2 },
      { label: 'SPEED', value: 7 },
      { label: 'STAGGER', value: 4 },
    ],
  },
  {
    kind: 'weapon', def: weaponById('wpn_sword_dvergr'), img: '/weapon-sword.jpg', cls: 'ONE-HAND · SWORD',
    bars: [
      { label: 'DAMAGE', value: 3 },
      { label: 'SPEED', value: 10 },
      { label: 'STAGGER', value: 2 },
    ],
  },
  {
    kind: 'weapon', def: weaponById('wpn_hammer_thrym'), img: '/weapon-hammer.jpg', cls: 'TWO-HAND · HAMMER',
    bars: [
      { label: 'DAMAGE', value: 10 },
      { label: 'SPEED', value: 6 },
      { label: 'STAGGER', value: 10 },
    ],
  },
  {
    kind: 'weapon', def: weaponById('wpn_axe_jotun'), img: '/weapon-spear.jpg', cls: 'TWO-HAND · REACH',
    bars: [
      { label: 'DAMAGE', value: 5 },
      { label: 'SPEED', value: 7 },
      { label: 'STAGGER', value: 5 },
    ],
  },
  {
    kind: 'bow', def: BOWS[1]!, img: '/weapon-bow.jpg', cls: 'RANGED · BOW',
    bars: [
      { label: 'DAMAGE', value: 4 },
      { label: 'SPEED', value: 10 },
      { label: 'CRIT', value: 10 },
    ],
  },
  {
    kind: 'shield', def: SHIELDS[2]!, img: '/weapon-shield.jpg', cls: 'OFF-HAND · SHIELD',
    bars: [
      { label: 'GUARD', value: 8 },
      { label: 'STABILITY', value: 6 },
      { label: 'ARMOR', value: 6 },
    ],
  },
];

/** Realm chips for an item's power band (items.ts: bands 1-2, 3-4, 5-6, 7-8, 9). */
function realmsForTier(tier: number): RealmId[] {
  const bands: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 9]];
  const [lo, hi] = bands[Math.min(4, Math.max(0, tier - 1))]!;
  return REALM_ORDER.filter((id) => REALMS[id].tier >= lo && REALMS[id].tier <= hi);
}

const COMBAT_RULES = [
  { title: 'DIRECTIONAL ARCS', body: 'Attack angle follows mouse movement — horizontal sweeps, overhead chops, thrusts.' },
  { title: 'PARRY WINDOW 200ms', body: 'A perfect block flashes the shield rune and opens the foe to a counter.' },
  { title: 'STAGGER & POISE', body: 'Heavy blows fill the poise bar; break a troll’s stance and the finisher appears.' },
  { title: 'SERVER-AUTHORITATIVE', body: 'Hits resolve on the shard, predicted locally. The ledger never lies.' },
] as const;

function WeaponModal({ card, onClose }: { card: ArsenalCard | null; onClose: () => void }) {
  const def = card?.def;
  const recipe = def?.recipeId ? RECIPES[def.recipeId] : undefined;
  const found = def ? realmsForTier(def.tier) : [];

  return (
    <SiteModal open={card !== null} onClose={onClose} label={def ? `Weapon detail: ${def.name}` : 'Weapon detail'} wide>
      {card && def && (
        <div className="grid gap-0 md:grid-cols-[300px_1fr]">
          <div className="relative min-h-[240px] overflow-hidden bg-abyss">
            <img src={card.img} alt={def.name} className="absolute inset-0 h-full w-full object-cover" />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(8,9,11,0.7), transparent 50%)' }}
              aria-hidden="true"
            />
          </div>
          <div className="p-6 md:p-8">
            <p className="micro text-phosphor">{card.cls} · TIER {def.tier}</p>
            <h3 className="h3 mt-2">{def.name.toUpperCase()}</h3>
            <p className="font-norse mt-3 text-[1.05rem] leading-snug text-bone-dim">{def.description}</p>

            {/* Full contract stat table */}
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-3">
              {card.kind === 'weapon' && (
                <>
                  <div><dt className="micro">DAMAGE</dt><dd className="stat text-bone">{card.def.damage}</dd></div>
                  <div><dt className="micro">SWINGS/S</dt><dd className="stat text-bone">{card.def.attackSpeed}</dd></div>
                  <div><dt className="micro">REACH</dt><dd className="stat text-bone">{card.def.range}m</dd></div>
                  <div><dt className="micro">STAMINA</dt><dd className="stat text-bone">{card.def.staminaCost}</dd></div>
                  <div><dt className="micro">KNOCKBACK</dt><dd className="stat text-bone">{card.def.knockback}</dd></div>
                </>
              )}
              {card.kind === 'bow' && (
                <>
                  <div><dt className="micro">DAMAGE</dt><dd className="stat text-bone">{card.def.damage}</dd></div>
                  <div><dt className="micro">DRAW</dt><dd className="stat text-bone">{card.def.drawTime}s</dd></div>
                  <div><dt className="micro">ARROW SPEED</dt><dd className="stat text-bone">{card.def.arrowSpeed}m/s</dd></div>
                  <div><dt className="micro">CRIT BONUS</dt><dd className="stat text-bone">+{Math.round(card.def.critBonus * 100)}%</dd></div>
                  <div><dt className="micro">RANGE</dt><dd className="stat text-bone">{card.def.range}m</dd></div>
                </>
              )}
              {card.kind === 'shield' && (
                <>
                  <div><dt className="micro">BLOCK</dt><dd className="stat text-bone">{Math.round(card.def.blockReduction * 100)}%</dd></div>
                  <div><dt className="micro">STABILITY</dt><dd className="stat text-bone">{card.def.stability}×</dd></div>
                  <div><dt className="micro">ARMOR</dt><dd className="stat text-bone">{card.def.armor}</dd></div>
                </>
              )}
              <div><dt className="micro">SELL PRICE</dt><dd className="stat text-bone">{def.sellPrice} GOLD</dd></div>
            </dl>

            {/* Upgrade path (contracts/items.ts upgrade math) */}
            <p className="micro mt-7 text-phosphor">▚▚ UPGRADE PATH · +8% BASE PER LEVEL</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <li key={n} className="flex flex-wrap items-baseline justify-between gap-2 text-[0.75rem]">
                  <span className="body-strong">+{n} {n === 5 ? '— SAGA-FORGED' : n >= 3 ? '— MASTERWORK' : n === 2 ? '— FINE' : '— COMMON'}</span>
                  <span className="micro text-ash">
                    {upgradeGold(def.tier, n)} GOLD · {upgradeCost(def.tier, n)
                      .map((c) => `${ITEMS[c.itemId]?.name ?? c.itemId} ×${c.qty}`)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>

            {recipe && (
              <p className="micro mt-4 leading-relaxed text-ash">
                CRAFT: {recipe.station.toUpperCase()} · MIN LEVEL {recipe.minLevel} ·{' '}
                {recipe.requires.map((r) => `${ITEMS[r.itemId]?.name ?? r.itemId} ×${r.qty}`).join(' · ')}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="micro mr-1">WHERE FOUND:</span>
              {found.map((id) => (
                <Link
                  key={id}
                  to={`/realms#${id}`}
                  onClick={onClose}
                  className="chip transition-colors hover:border-phosphor hover:text-phosphor"
                  style={{ borderColor: `color-mix(in srgb, ${REALM_META[id].accent} 45%, transparent)` }}
                >
                  <span className="font-runic" style={{ color: REALM_META[id].accent }} aria-hidden="true">
                    {REALM_META[id].rune}
                  </span>
                  {REALMS[id].displayName.toUpperCase()}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </SiteModal>
  );
}

const SCHOOL_RUNES = ['ᛖ', 'ᛁ', 'ᚹ', 'ᛃ'];

function Arsenal() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [open, setOpen] = useState<ArsenalCard | null>(null);
  // Rune-slot indicator glyph-scrambles through the schools on card hover.
  const [slotHover, setSlotHover] = useState<string | null>(null);
  const [slotRuneIdx, setSlotRuneIdx] = useState(0);
  useEffect(() => {
    if (!slotHover || reducedMotion()) return;
    const id = window.setInterval(() => setSlotRuneIdx((i) => (i + 1) % SCHOOL_RUNES.length), 90);
    return () => window.clearInterval(id);
  }, [slotHover]);

  return (
    <section className="relative border-t border-iron bg-abyss py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ MELEE · BOWS · SHIELDS" runes="ᚦᛒᛋᚲᚷᚺ" />
        <h2 className="h2 mt-6">THE ARSENAL</h2>
        <p className="body mt-5 max-w-reading">
          Six shapes of argument. Every blade is a line in your saga — choose
          the hand that writes it.
        </p>

        <div ref={ref} className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ARSENAL.map((card, i) => (
            <button
              key={card.def.id}
              type="button"
              onClick={() => setOpen(card)}
              onMouseEnter={() => setSlotHover(card.def.id)}
              onMouseLeave={() => setSlotHover((h) => (h === card.def.id ? null : h))}
              className={`realm-card corner-brackets group text-left ${
                inView ? 'reveal-etch is-revealed' : 'reveal-etch'
              }`}
              style={{ animationDelay: `${i * 80}ms` }}
              aria-label={`${card.def.name} — open details`}
            >
              <div className="realm-card-art" style={{ aspectRatio: '1/1' }}>
                <img src={card.img} alt={card.def.name} loading="lazy" />
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-[1rem] font-bold tracking-[0.1em] text-bone">
                      {card.def.name.toUpperCase()}
                    </h3>
                    <p className="micro mt-1">{card.cls} · TIER {card.def.tier}</p>
                  </div>
                  {/* Rune slot indicator: etched square, filled = etchable */}
                  <span
                    className="font-runic mt-1 flex h-3.5 w-3.5 flex-none items-center justify-center border text-[9px] leading-none"
                    title={card.def.tier >= 3 ? 'RUNE SLOT — ETCHABLE' : 'RUNE SLOT — OPEN'}
                    style={{
                      borderColor: card.def.tier >= 3 ? 'var(--phosphor)' : 'var(--iron-2)',
                      background: card.def.tier >= 3 ? 'rgb(var(--phosphor-rgb) / 0.7)' : 'transparent',
                      boxShadow: card.def.tier >= 3 ? '0 0 10px rgb(var(--phosphor-rgb) / 0.5)' : 'none',
                      color: 'var(--void)',
                    }}
                  >
                    {slotHover === card.def.id && card.def.tier >= 3 ? SCHOOL_RUNES[slotRuneIdx] : ''}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {card.bars.map((b) => (
                    <StatBar key={b.label} label={b.label} value={b.value} accent="var(--phosphor)" filled={inView} width={96} />
                  ))}
                </div>
                <p className="font-norse mt-1 text-[0.95rem] leading-snug text-bone-dim">{card.def.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Combat rules strip */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COMBAT_RULES.map((rule, i) => (
            <div
              key={rule.title}
              className={`panel p-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
              style={{ animationDelay: `${400 + i * 80}ms` }}
            >
              <p className="micro text-phosphor">{rule.title}</p>
              <p className="body mt-2 text-[0.75rem] leading-relaxed">{rule.body}</p>
            </div>
          ))}
        </div>
      </div>

      <WeaponModal card={open} onClose={() => setOpen(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// S3 · Rune schools — the four colors of wyrd (contracts/items.ts RUNES)
// ---------------------------------------------------------------------------

interface SchoolMeta {
  id: RuneSchool;
  name: string;
  rune: string;
  color: string;
  flavor: string;
  role: string;
}

const SCHOOLS: SchoolMeta[] = [
  {
    id: 'fire', name: 'ELDR', rune: 'ᛖ', color: 'var(--realm-muspelheim)',
    flavor: 'The honest school — damage, burn, damage again.',
    role: 'DAMAGE · BURN · NO SUBTLETY',
  },
  {
    id: 'ice', name: 'ÍSS', rune: 'ᛁ', color: 'var(--ice)',
    flavor: 'The patient school — slow, freeze, shatter.',
    role: 'CONTROL · FROST · SHATTER',
  },
  {
    id: 'storm', name: 'VEÐR', rune: 'ᚹ', color: '#7A9FD0',
    flavor: 'The loud school — chain lightning and rude mobility.',
    role: 'CHAIN · MOBILITY · CRIT',
  },
  {
    id: 'spirit', name: 'ANDI', rune: 'ᛃ', color: 'var(--galdr)',
    flavor: 'The deep school — shields, echoes, roots under the world.',
    role: 'WARD · HEAL · SUMMON',
  },
];

function RuneSchools() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [school, setSchool] = useState<RuneSchool>('fire');

  const spells = useMemo(() => RUNES.filter((r) => r.school === school), [school]);
  const meta = SCHOOLS.find((s) => s.id === school)!;
  const costs = spells.map((s) => s.wyrdCost);
  const cds = spells.map((s) => s.cooldownSec);

  return (
    <section className="relative border-t border-iron bg-void py-24 md:py-36">
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-700"
        style={{ background: `radial-gradient(ellipse at 20% 15%, color-mix(in srgb, ${meta.color} 8%, transparent), transparent 55%)` }}
        aria-hidden="true"
      />
      <div ref={ref} className="relative mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE FOUR COLORS OF WYRD" runes="ᛖᛁᚹᛃ" />
        <h2 className="h2 mt-6">RUNE SCHOOLS</h2>
        <p className="body mt-5 max-w-reading">
          {RUNES.length} spells across four schools. Wyrd is your mana; the
          Norns charge by the syllable.
        </p>

        {/* School tabs */}
        <div className="mt-10 flex flex-wrap gap-2.5" role="tablist" aria-label="Rune schools">
          {SCHOOLS.map((s) => {
            const active = s.id === school;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSchool(s.id)}
                className="chip gap-2.5 px-4 py-2 transition-all"
                style={
                  active
                    ? {
                        borderColor: s.color,
                        color: s.color,
                        background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
                        boxShadow: `0 0 16px color-mix(in srgb, ${s.color} 30%, transparent)`,
                      }
                    : undefined
                }
              >
                <span className="font-runic text-base" aria-hidden="true">
                  {s.rune}
                </span>
                {s.name}
              </button>
            );
          })}
        </div>

        {/* School panel */}
        <div key={school} className="panel mt-6 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-iron px-6 py-5">
            <div className="flex items-baseline gap-4">
              <span className="font-runic text-3xl" style={{ color: meta.color, textShadow: `0 0 14px ${meta.color}` }} aria-hidden="true">
                {meta.rune}
              </span>
              <div>
                <h3 className="font-display text-xl font-bold tracking-[0.14em]" style={{ color: meta.color }}>
                  {meta.name}
                </h3>
                <p className="font-norse text-[1rem] text-bone-dim">{meta.flavor}</p>
              </div>
            </div>
            <p className="micro leading-relaxed text-ash">
              {meta.role} · WYRD {Math.min(...costs)}–{Math.max(...costs)} · CD {Math.min(...cds)}–{Math.max(...cds)}s
            </p>
          </div>

          <ul>
            {spells.map((spell, i) => {
              const [runeGlyph, effect] = spell.description.split(' — ');
              const flavor = effect ?? spell.description;
              return (
                <li
                  key={spell.id}
                  className={`group flex flex-col gap-3 border-b border-iron/60 px-6 py-4 transition-colors last:border-b-0 hover:bg-stone/40 md:flex-row md:items-center ${
                    inView ? 'reveal-rise is-revealed' : 'reveal-rise'
                  }`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span
                    className="font-runic flex h-10 w-10 flex-none items-center justify-center border text-xl transition-all group-hover:scale-110"
                    style={{ borderColor: 'var(--iron-2)', color: meta.color }}
                    aria-hidden="true"
                  >
                    {runeGlyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="body-strong text-[0.9375rem] text-bone">{spell.name}</p>
                    <p className="body mt-0.5 text-[0.75rem] leading-relaxed">{flavor}</p>
                  </div>
                  <div className="flex flex-none flex-wrap items-center gap-2">
                    <span className="chip chip-version" style={{ color: meta.color, borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)` }}>
                      {spell.wyrdCost} WYRD
                    </span>
                    <span className="chip chip-version">{spell.cooldownSec}s CD</span>
                    <span className="chip chip-version">{spell.damage} DMG</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="micro border-t border-iron px-6 py-3.5 leading-relaxed text-ash">
            CASTING REQUIRES A FREE HAND OR A RUNE FOCUS · SERVER VALIDATES MANA, COOLDOWNS, AND LINE-OF-SIGHT
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S4 · Skill trees — three constellations (contracts/skills.ts SKILL_NODES)
// ---------------------------------------------------------------------------

interface BranchMeta {
  id: SkillBranch;
  archetype: string;
  rune: string;
  motto: string;
  img: string;
  accent: string;
  featured: string[];
}

const BRANCHES: BranchMeta[] = [
  {
    id: 'warrior', archetype: 'HERSIR', rune: 'ᚺ', motto: 'The shield that does not step back.',
    img: '/class-hersir.jpg', accent: 'var(--blood-hi)',
    featured: ['sk_war_shield', 'sk_war_parry', 'sk_war_whirlwind', 'sk_war_berserk', 'sk_war_execute'],
  },
  {
    id: 'seidr', archetype: 'GALDR', rune: 'ᚷ', motto: 'The voice the runes answer.',
    img: '/class-galdr.jpg', accent: 'var(--galdr)',
    featured: ['sk_sei_affinity', 'sk_sei_galdr', 'sk_sei_echo', 'sk_sei_wyrdwell', 'sk_sei_volva'],
  },
  {
    id: 'hunter', archetype: 'SKÁLD', rune: 'ᛋ', motto: 'The road remembers them.',
    img: '/class-skald.jpg', accent: 'var(--soul)',
    featured: ['sk_hun_eagleeye', 'sk_hun_precision', 'sk_hun_silent', 'sk_hun_beastslayer', 'sk_hun_ullr'],
  },
];

function hashJitter(id: string, range: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % (range * 2)) - range;
}

interface PlacedNode {
  node: SkillNode;
  x: number;
  y: number;
  depth: number;
}

function layoutBranch(branch: SkillBranch): PlacedNode[] {
  const nodes = Object.values(SKILL_NODES).filter((n) => n.branch === branch);
  const depthOf = (n: SkillNode, seen: Set<string> = new Set()): number => {
    if (n.requires.length === 0 || seen.has(n.id)) return 0;
    seen.add(n.id);
    return 1 + Math.max(...n.requires.map((r) => depthOf(SKILL_NODES[r]!, seen)));
  };
  const byDepth = new Map<number, SkillNode[]>();
  nodes.forEach((n) => {
    const d = depthOf(n);
    byDepth.set(d, [...(byDepth.get(d) ?? []), n]);
  });
  const maxDepth = Math.max(...byDepth.keys());
  const placed: PlacedNode[] = [];
  byDepth.forEach((list, depth) => {
    const y = 72 + (depth / Math.max(1, maxDepth)) * 268;
    const spread = Math.min(150, 540 / Math.max(1, list.length));
    list.forEach((node, i) => {
      const x = 320 + (i - (list.length - 1) / 2) * spread + hashJitter(node.id, 22);
      placed.push({ node, x, y: y + hashJitter(node.id + 'y', 12), depth });
    });
  });
  return placed;
}

function SkillTrees() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [branch, setBranch] = useState<SkillBranch>('warrior');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Header sigil badges deep-link to a tab.
  useEffect(() => {
    const onPick = (e: Event) => {
      setBranch((e as CustomEvent<SkillBranch>).detail);
      setSelectedId(null);
    };
    window.addEventListener('coresapian:skill-tab', onPick);
    return () => window.removeEventListener('coresapian:skill-tab', onPick);
  }, []);

  const meta = BRANCHES.find((b) => b.id === branch)!;
  const placed = useMemo(() => layoutBranch(branch), [branch]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);
  const maxDepth = Math.max(...placed.map((p) => p.depth));
  const selected = (selectedId && SKILL_NODES[selectedId]) || SKILL_NODES[meta.featured[4]!]!;
  const featured = meta.featured.map((id) => SKILL_NODES[id]!).filter(Boolean);

  return (
    <section id="skill-trees" className="relative border-t border-iron bg-abyss py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE THREE PATHS" runes="ᚺᚷᛋ" />
        <h2 className="h2 mt-6">SKILL CONSTELLATIONS</h2>
        <p className="body mt-5 max-w-reading">
          Forty levels of choices, lit one star at a time. Hover a star to read
          it; the constellations re-light as you change path.
        </p>

        {/* Branch tabs */}
        <div className="mt-10 flex flex-wrap gap-2.5" role="tablist" aria-label="Skill branches">
          {BRANCHES.map((b) => {
            const active = b.id === branch;
            return (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setBranch(b.id);
                  setSelectedId(null);
                }}
                className="chip gap-2.5 px-4 py-2 transition-all"
                style={
                  active
                    ? { borderColor: b.accent, color: b.accent, background: 'rgb(var(--phosphor-rgb) / 0.06)' }
                    : undefined
                }
              >
                <span className="font-runic text-base" aria-hidden="true">
                  {b.rune}
                </span>
                {b.archetype} — {SKILL_BRANCHES[b.id].name.toUpperCase()}
              </button>
            );
          })}
        </div>

        <div key={branch} className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Constellation SVG */}
          <div className="panel relative overflow-hidden">
            <div className="absolute inset-0" aria-hidden="true">
              <img src={meta.img} alt="" className="h-full w-full object-cover opacity-[0.08]" loading="lazy" />
            </div>
            <svg viewBox="0 0 640 420" className="relative h-auto w-full" role="group" aria-label={`${meta.archetype} skill constellation`}>
              {/* edges */}
              {placed.flatMap((p) =>
                p.node.requires.map((req) => {
                  const from = byId.get(req);
                  if (!from) return null;
                  const hot = selected.id === p.node.id || selected.id === req;
                  const mx = (p.x + from.x) / 2;
                  const my = (p.y + from.y) / 2 - 14;
                  return (
                    <path
                      key={`${p.node.id}-${req}`}
                      d={`M${from.x},${from.y} Q ${mx},${my} ${p.x},${p.y}`}
                      fill="none"
                      stroke={hot ? meta.accent : 'var(--iron-2)'}
                      strokeWidth={hot ? 1.8 : 1}
                      strokeOpacity={hot ? 0.95 : 0.5}
                      pathLength={1}
                      style={{
                        strokeDasharray: 1,
                        strokeDashoffset: inView ? 0 : 1,
                        transition: `stroke-dashoffset 700ms ease-out ${200 + p.depth * 160}ms, stroke 150ms, stroke-opacity 150ms`,
                        filter: hot ? `drop-shadow(0 0 4px ${meta.accent})` : undefined,
                      }}
                    />
                  );
                }),
              )}
              {/* nodes */}
              {placed.map((p) => {
                const hot = selected.id === p.node.id;
                const cap = p.depth === maxDepth;
                const r = 7 + p.node.maxRank;
                return (
                  <g
                    key={p.node.id}
                    transform={`translate(${p.x}, ${p.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${p.node.name} — rank ${p.node.maxRank}, ${p.node.costPerRank} point per rank`}
                    onMouseEnter={() => setSelectedId(p.node.id)}
                    onFocus={() => setSelectedId(p.node.id)}
                    onClick={() => setSelectedId(p.node.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(p.node.id);
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      outline: 'none',
                      opacity: inView ? 1 : 0,
                      transition: `opacity 400ms ease-out ${260 + p.depth * 160}ms`,
                    }}
                  >
                    <title>{p.node.name}</title>
                    {cap && (
                      <circle r={r + 7} fill="none" stroke={meta.accent} strokeWidth={0.8} strokeDasharray="2 3" strokeOpacity={0.7} />
                    )}
                    <circle
                      r={r}
                      fill={hot ? meta.accent : 'rgb(var(--stone-rgb) / 0.95)'}
                      stroke={meta.accent}
                      strokeWidth={hot ? 2 : 1.2}
                      style={{ transition: 'all 150ms', filter: hot ? `drop-shadow(0 0 8px ${meta.accent})` : undefined }}
                    />
                    <circle r={2.2} fill={hot ? 'var(--void)' : meta.accent} style={{ transition: 'all 150ms' }} />
                  </g>
                );
              })}
            </svg>
            <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-iron px-5 py-3">
              <p className="micro text-phosphor-dim">
                {placed.length} STARS · {placed.reduce((a, p) => a + p.node.maxRank, 0)} RANKS · CAPSTONE RINGED
              </p>
              <p className="micro text-ash">POINTS: +{SKILL_POINTS_PER_LEVEL}/LEVEL · +{SKILL_POINTS_PER_CHAPTER}/CHAPTER</p>
            </div>
            <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-iron px-5 py-3">
              <p className="micro text-ash">SKILL RUNES DROP FROM BOSSES, SAGAS, AND DEEP PLACES · RESPEC AT ANY NORN SHRINE: 500 ᚺ</p>
              <Link to="/game#skills" className="kicker transition-colors hover:text-phosphor-hi">
                SEE IT IN GAME →
              </Link>
            </div>
          </div>

          {/* Right rail: motto + selected node + featured */}
          <div className="flex flex-col gap-5">
            <div className={`panel p-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}>
              <p className="font-norse text-[1.15rem] leading-snug" style={{ color: meta.accent }}>
                {meta.motto}
              </p>
            </div>

            <div className="panel corner-brackets p-5" key={selected.id}>
              <p className="micro" style={{ color: meta.accent }}>
                ▚▚ {selected.id === meta.featured[4] ? 'CAPSTONE' : 'STAR'} · {selected.branch.toUpperCase()}
              </p>
              <h3 className="font-display mt-2 text-lg font-bold tracking-[0.08em] text-bone">{selected.name}</h3>
              <p className="body mt-2 text-[0.8125rem] leading-relaxed">{selected.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip chip-version">RANK {selected.maxRank}</span>
                <span className="chip chip-version">{selected.costPerRank} PT / RANK</span>
                {selected.requires.length > 0 && (
                  <span className="chip chip-version">
                    REQUIRES {selected.requires.map((r) => SKILL_NODES[r]?.name.toUpperCase() ?? r).join(' + ')}
                  </span>
                )}
              </div>
              <ul className="mt-4 flex flex-col gap-1.5">
                {selected.effects.map((e, i) => (
                  <li key={i} className="stat flex items-baseline justify-between gap-3 border-b border-iron/50 pb-1.5 text-[0.75rem] last:border-b-0">
                    <span className="micro">{e.stat.replace(/([A-Z])/g, ' $1').toUpperCase()}</span>
                    <span style={{ color: meta.accent }}>
                      {e.perRank > 0 ? '+' : ''}
                      {e.perRank}
                      {e.op === 'mult' ? '×/RANK' : '/RANK'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel p-5">
              <p className="micro text-phosphor">FEATURED STARS</p>
              <ul className="mt-3 flex flex-col gap-2">
                {featured.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className="group flex w-full items-baseline justify-between gap-3 text-left"
                    >
                      <span className="body-strong text-[0.8125rem] transition-colors group-hover:text-phosphor-hi">
                        {n.name}
                      </span>
                      <span className="micro whitespace-nowrap">×{n.maxRank}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S5 · The Forge Ledger — rarity ladder + crafting loop (contracts/items.ts)
// ---------------------------------------------------------------------------

const LADDER = [
  { name: 'COMMON', range: '+0 / +1', example: 'SKEGGØX +1', cost: upgradeGold(1, 1), accent: 'var(--bone-dim)', note: 'Wood, iron, honest work.' },
  { name: 'FINE', range: '+2', example: 'DVERGR LONGBLADE +2', cost: upgradeGold(2, 2), accent: 'var(--ice)', note: 'Steel fold visible to the eye.' },
  { name: 'MASTERWORK', range: '+3 / +4', example: 'JǪTUN CLEAVER +4', cost: upgradeGold(3, 4), accent: 'var(--galdr)', note: 'Crystal etching begins.' },
  { name: 'SAGA-FORGED', range: '+5', example: 'ÞRYMR’S BANE +5', cost: upgradeGold(5, 5), accent: 'var(--phosphor)', note: 'One rune slot. One legend.' },
] as const;

const LOOP_STEPS = [
  { rune: 'ᚠ', title: 'GATHER', body: 'Pick mistwood in Midgard; mine bog iron under root and stone.' },
  { rune: 'ᚱ', title: 'REFINE', body: 'Smelt 2 bog iron into 1 steel ingot at any forge.' },
  { rune: 'ᚲ', title: 'CRAFT', body: 'Choose a schematic. Time, materials, a steady hand.' },
  { rune: 'ᚷ', title: 'ETCH', body: 'Seat a rune at masterwork. The blade remembers.' },
] as const;

function ForgeLedger() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [forgeState, setForgeState] = useState<'idle' | 'forging' | 'done'>('idle');
  const forgeTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(forgeTimer.current), []);

  const recipe = RECIPES['rcp_axe_jotun']!;
  const crafted = ITEMS[recipe.result.itemId];
  // Mock inventory against contract requirements (demo widget)
  const have: Record<string, number> = { mat_steel: 6, mat_hide: 4, mat_crystal: 1 };

  const craft = () => {
    if (forgeState !== 'idle') return;
    setForgeState('forging');
    forgeTimer.current = window.setTimeout(() => {
      setForgeState('done');
      forgeTimer.current = window.setTimeout(() => setForgeState('idle'), 3200);
    }, 1100);
  };

  return (
    <section className="relative border-t border-iron bg-void py-24 md:py-36">
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE FORGE LEDGER" runes="ᚠᚱᚲᚷ" />
        <h2 className="h2 mt-6">RARITY &amp; CRAFTING</h2>
        <p className="body mt-5 max-w-reading">
          Every item climbs the same ladder: +8% base per level, gold and
          matter at every rung.
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {/* Rarity ladder */}
          <div>
            <ol className="flex flex-col gap-4">
              {LADDER.map((rung, i) => (
                <li
                  key={rung.name}
                  className={`panel flex items-center gap-5 p-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                  style={{ animationDelay: `${i * 90}ms`, borderLeft: `3px solid ${rung.accent}` }}
                >
                  <div className="flex-1">
                    <p className="font-display text-[0.9375rem] font-bold tracking-[0.12em]" style={{ color: rung.accent }}>
                      {rung.name} <span className="micro ml-2">{rung.range}</span>
                    </p>
                    <p className="body mt-1 text-[0.75rem]">{rung.note}</p>
                  </div>
                  <div className="text-right">
                    <p className="micro text-bone">{rung.example}</p>
                    <p className="micro mt-1 text-ash">{rung.cost} GOLD</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="micro mt-4 leading-relaxed text-ash">
              UPGRADE MATH FROM THE FORGE CONTRACT · +8% BASE STATS PER LEVEL · CRYSTAL REQUIRED FROM +3
            </p>
          </div>

          {/* Crafting loop + live demo recipe */}
          <div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {LOOP_STEPS.map((step, i) => (
                <div
                  key={step.title}
                  className={`panel p-4 ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span className="font-runic text-2xl text-phosphor" aria-hidden="true">
                    {step.rune}
                  </span>
                  <p className="micro mt-2 text-bone">{step.title}</p>
                  <p className="body mt-1.5 text-[0.6875rem] leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>

            {/* Sample recipe — Jötun Cleaver */}
            <div className="panel corner-brackets mt-5 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="micro text-phosphor">▚▚ SCHEMATIC · {recipe.id.toUpperCase()}</p>
                <p className="micro text-ash">STATION: {recipe.station.toUpperCase()} · MIN LV {recipe.minLevel}</p>
              </div>
              <h3 className="font-display mt-2 text-lg font-bold tracking-[0.08em] text-bone">
                {crafted?.name.toUpperCase() ?? 'UNKNOWN'}
              </h3>
              <ul className="mt-4 flex flex-col gap-2">
                {recipe.requires.map((r) => {
                  const mat = ITEMS[r.itemId];
                  const owned = have[r.itemId] ?? 0;
                  const ok = owned >= r.qty;
                  return (
                    <li key={r.itemId} className="flex items-center justify-between gap-3 text-[0.8125rem]">
                      <span className="body-strong">{mat?.name ?? r.itemId}</span>
                      <span className={`stat text-[0.75rem] ${ok ? 'text-soul' : 'text-blood'}`}>
                        {owned}/{r.qty} {ok ? '✓' : '· SHORT'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={craft}
                disabled={forgeState === 'forging'}
                className="btn btn-phosphor btn-md mt-5 w-full"
                style={forgeState === 'done' ? { borderColor: 'var(--soul)', color: 'var(--soul)' } : undefined}
                aria-live="polite"
              >
                {forgeState === 'idle' && 'CRAFT'}
                {forgeState === 'forging' && 'FORGING…'}
                {forgeState === 'done' && '✓ CLEAVER FORGED'}
              </button>
              <p className="micro mt-3 text-center text-ash">DEMO ANVIL — THE REAL FORGE LIVES IN THE SHARD</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S6 · Nine realm abilities (contracts/skills.ts REALM_ABILITIES)
// ---------------------------------------------------------------------------

function RealmAbilities() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const navigate = useNavigate();

  const unlockAct = (abilityId: string): number | null => {
    for (const q of Object.values(QUESTS)) {
      if (q.type === 'main' && q.rewards.unlockRealmAbility === abilityId) return q.chapter ?? null;
    }
    return null;
  };

  return (
    <section className="relative border-t border-iron bg-abyss py-24 md:py-36">
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ NINE GIFTS" runes="ᛟᛟᛟ" />
        <h2 className="h2 mt-6">REALM ABILITIES</h2>
        <p className="body mt-5 max-w-reading">
          Each realm, once survived, leaves a gift in your hands. Earned, never
          bought.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REALM_ORDER.map((realmId, i) => {
            const realm = REALMS[realmId];
            const meta = REALM_META[realmId];
            const ability = REALM_ABILITIES[realm.realmAbilityId];
            if (!ability) return null;
            const act = unlockAct(ability.id);
            return (
              <button
                key={realmId}
                type="button"
                onClick={() => navigate(`/realms#${realmId}`)}
                className={`panel group p-5 text-left transition-all hover:-translate-y-0.5 ${
                  inView ? 'reveal-rise is-revealed' : 'reveal-rise'
                }`}
                style={{ animationDelay: `${i * 70}ms`, ...cssVar('--accent', meta.accent) }}
                aria-label={`${ability.name} — view ${realm.displayName} chapter`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-runic text-2xl" style={{ color: meta.accent, textShadow: `0 0 12px ${meta.accent}` }} aria-hidden="true">
                    {meta.rune}
                  </span>
                  <span
                    className="chip chip-version"
                    style={
                      realm.tier === 1
                        ? { color: 'var(--soul)', borderColor: 'color-mix(in srgb, var(--soul) 40%, transparent)', animation: 'pulse-dot 2s infinite' }
                        : undefined
                    }
                  >
                    {realm.tier === 1 ? 'EARNED' : act ? `ACT ${toRoman(act)}` : 'SEALED'}
                  </span>
                </div>
                <h3 className="font-display mt-3 text-[1rem] font-bold tracking-[0.1em] text-bone transition-colors group-hover:text-phosphor-hi">
                  {ability.name.toUpperCase()}
                </h3>
                <p className="micro mt-1">{realm.displayName.toUpperCase()} · {ability.oldNorse.toUpperCase()}</p>
                <p className="body mt-2.5 text-[0.75rem] leading-relaxed">{ability.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S7 · The Norns' Arithmetic — leveling math (contracts/skills.ts)
// ---------------------------------------------------------------------------

const ATTRIBUTES = [
  { rune: 'ᛋ', name: 'STRENGTH', stats: 'meleeDamage · armorPen · critMultiplier' },
  { rune: 'ᛖ', name: 'ENDURANCE', stats: 'maxHp · maxStamina · armor' },
  { rune: 'ᚹ', name: 'WILL', stats: 'maxWyrd · spellDamage · cooldown' },
  { rune: 'ᚨ', name: 'AGILITY', stats: 'moveSpeed · attackSpeed · critChance' },
] as const;

function LevelingMath() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -30% 0px' });
  const bossXp = Object.values(REALM_BOSSES).map((b) => b.baseStats.xp);
  const foeXp = (id: string) => ENEMIES[id]?.baseStats.xp ?? 0;

  const rows = [
    `> XP_BASE ${XP_BASE} · xpToNext(L) = ${XP_BASE}·L·(L+1)`,
    `LV 10 → ${totalXpForLevel(10).toLocaleString()} XP TOTAL · NEXT +${xpToNext(10).toLocaleString()}`,
    `LV 20 → ${totalXpForLevel(20).toLocaleString()} XP TOTAL · NEXT +${xpToNext(20).toLocaleString()}`,
    `LV 30 → ${totalXpForLevel(30).toLocaleString()} XP TOTAL · NEXT +${xpToNext(30).toLocaleString()}`,
    `LV ${LEVEL_CAP} → ${totalXpForLevel(LEVEL_CAP).toLocaleString()} XP · CAP — THE THREAD RESTS`,
    `SKILL POINTS — +${SKILL_POINTS_PER_LEVEL}/LEVEL · +${SKILL_POINTS_PER_CHAPTER}/CHAPTER · 49 MAX`,
    `ENEMY XP — VARGR ${foeXp('vargr')} · DRAGUR ${foeXp('draugr')} · TROLL ${foeXp('troll')} · BOSS ${Math.min(...bossXp).toLocaleString()}–${Math.max(...bossXp).toLocaleString()}`,
    `THE THREAD HOLDS — NO XP LOST ON DEATH · 5% HACKSILVER TITHE`,
  ];

  return (
    <section className="relative border-t border-iron bg-void py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE NORNS’ ARITHMETIC" runes="ᚠᛚᛟ" />
        <h2 className="h2 mt-6">LEVELING, BY THE NUMBERS</h2>
        <p className="body mt-5 max-w-reading">
          No hidden multipliers, no seasonal resets. The curve below is the
          same one the shard computes.
        </p>

        <div ref={ref} className="mt-12 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Terminal */}
          <div className="terminal">
            <div className="terminal-titlebar">
              <span>NORNS_LEDGER.LOG</span>
              <span className="text-ash">CURVE v1</span>
            </div>
            <div className="terminal-body flex flex-col gap-2">
              {rows.map((row, i) => (
                <p key={i} className="terminal-line">
                  <BootType text={row} active={inView} speed={7} />
                </p>
              ))}
              <p className="terminal-line">
                <span className="boot-caret text-phosphor">▊</span>
              </p>
            </div>
          </div>

          {/* Attribute cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            {ATTRIBUTES.map((a, i) => (
              <div
                key={a.name}
                className={`panel p-4 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-runic text-xl text-phosphor" aria-hidden="true">
                    {a.rune}
                  </span>
                  <p className="micro text-bone">{a.name}</p>
                </div>
                <p className="micro mt-2 normal-case leading-relaxed text-ash">{a.stats}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export default function Progression() {
  useHashScroll();
  return (
    <div className="noise-overlay relative">
      <SagaHeader />
      <Arsenal />
      <RuneDivider sigil="ᚦ" />
      <RuneSchools />
      <RuneDivider sigil="ᚷ" />
      <SkillTrees />
      <RuneDivider sigil="ᚲ" />
      <ForgeLedger />
      <RealmAbilities />
      <RuneDivider sigil="ᛟ" />
      <LevelingMath />
      <CtaBand
        heading="THE NORNS ARE WATCHING"
        primary={{ to: '/game', label: 'BECOME LEGEND' }}
        secondary={{ to: '/realms', label: 'MEET THE NINE' }}
      />
    </div>
  );
}
