// ============================================================================
// CORESAPIAN — src/pages/Lore.tsx (design/lore.md — S1…S8)
// The living saga: cosmology, the nine-act campaign timeline (forks + three
// endings marked), factions with rank thresholds, a filterable bestiary,
// branching-thread demos, and a glossary of Norse terms. Facts from
// contracts/quests.ts + enemies.ts + realms.ts + items.ts.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import type { RealmId } from '../../contracts/types';
import { QUESTS, FACTIONS, FACTION_RANK_THRESHOLDS, NPCS } from '../../contracts/quests';
import type { BranchOption, FactionId, QuestDef } from '../../contracts/quests';
import { ENEMIES, REALM_BOSSES } from '../../contracts/enemies';
import type { EnemyDef } from '../../contracts/enemies';
import { REALMS } from '../../contracts/realms';
import { ITEMS, LOOT_TABLES } from '../../contracts/items';

import { useInView } from '@/lib/useInView';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import {
  BootType,
  CtaBand,
  KickerRow,
  RuneDivider,
  ThreatPips,
} from '@/components/site/primitives';
import { cssVar, reducedMotion, useCopiedFlag, useHashScroll } from '@/components/site/utils';
import { SiteModal } from '@/components/site/SiteModal';
import { REALM_META, toRoman } from '@/components/site/realmMeta';

gsap.registerPlugin(ScrollTrigger);

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
}

const MAIN_QUESTS = Object.values(QUESTS)
  .filter((q) => q.type === 'main')
  .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));

/** The three marked branch forks (design/lore.md S3): acts I, IV, VIII. */
const FORK_ACTS = new Set([1, 4, 8]);

// ---------------------------------------------------------------------------
// S1 · Header
// ---------------------------------------------------------------------------

const LORE_ANCHORS = [
  { id: 'cosmology', label: 'COSMOLOGY' },
  { id: 'campaign', label: 'CAMPAIGN' },
  { id: 'factions', label: 'FACTIONS' },
  { id: 'bestiary', label: 'BESTIARY' },
  { id: 'threads', label: 'THREADS' },
  { id: 'glossary', label: 'GLOSSARY' },
];

function LoreHeader() {
  const [armed, setArmed] = useState(false);
  const title = useGlyphScramble('THE SAGA UNWRITTEN', armed);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 450);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <section className="relative overflow-hidden bg-void py-24 md:py-32">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(155,143,232,0.07), transparent 60%)' }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-content px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_EXPO }}
          className="flex flex-col items-center text-center"
        >
          <p className="kicker">▚▚ THE LIVING SAGA ▚▚</p>
          <h1 className="h1 mt-6" aria-label="THE SAGA UNWRITTEN">
            {title}
          </h1>
          <p className="norse-accent mt-5 max-w-reading text-bone-dim">
            What the Norns wove, Loki cut. What you do about it is the only
            line left unwritten.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {LORE_ANCHORS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => scrollToId(a.id)}
                className="chip transition-colors hover:border-phosphor hover:text-phosphor"
              >
                {a.label}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S2 · Cosmology — sticky world-tree art + four lore blocks
// ---------------------------------------------------------------------------

const COSMOLOGY = [
  {
    rune: 'ᛦ',
    title: 'THE ASH',
    body: 'Yggdrasil does not hold nine worlds like fruit on branches — it holds them like promises. Root, trunk, and crown are one argument: that everything which exists is connected, and that connection can be cut.',
  },
  {
    rune: 'ᚾ',
    title: 'THE THREADS',
    body: 'At the well of Urðr the Norns weave every life into the loom — past, becoming, debt. Fate in these realms is not a script. It is a tension, and tension can snap.',
  },
  {
    rune: 'ᛚ',
    title: 'THE UNRAVELING',
    body: 'Someone severed the threads — not to end the world, but to own the ending. Now the dead walk out of the barrows, the light is drunk from the roots, and the loom stands quiet for the first time since before time.',
  },
  {
    rune: 'ᛏ',
    title: 'YOUR THREAD',
    body: 'You washed ashore in Midgard with no thread of your own — a gap in the weave the Norns cannot see. Every realm you survive ties you tighter to the pattern. What you become is the ninth rune.',
  },
] as const;

function Cosmology() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <section id="cosmology" className="relative border-t border-iron bg-abyss py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ BEFORE THE FIRST ACT" runes="ᛦᚾᛚᛏ" />
        <h2 className="h2 mt-6">THE COSMOLOGY</h2>

        <div ref={ref} className="mt-12 grid gap-10 lg:grid-cols-2">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className={`panel overflow-hidden ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}>
              <div className="relative aspect-[4/5] overflow-hidden sm:aspect-[16/12] lg:aspect-[4/5]">
                <img
                  src="/world-tree.jpg"
                  alt="Yggdrasil, the world-tree, holding nine realms in its branches"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'linear-gradient(to top, rgba(8,9,11,0.65), transparent 45%)' }}
                  aria-hidden="true"
                />
                <p className="micro absolute bottom-4 left-4 text-phosphor-dim">
                  FIG. 0 — THE ASH, AS THE SEERESSES DRAW IT
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-8">
            {COSMOLOGY.map((block, i) => (
              <article
                key={block.title}
                className={`panel corner-brackets p-6 md:p-7 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-runic text-2xl text-galdr" aria-hidden="true">
                    {block.rune}
                  </span>
                  <h3 className="h3">{block.title}</h3>
                </div>
                <p className="body mt-3 text-[0.9375rem] leading-relaxed">{block.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S3 · Campaign timeline — nine acts, three marked forks, three endings
// ---------------------------------------------------------------------------

function endingTitle(outcomeText: string): string {
  // "ENDING — THE QUIET LOOM: ..." → "THE QUIET LOOM"
  const m = /^ENDING — ([^:]+):/.exec(outcomeText);
  return m ? m[1]! : 'ENDING';
}

function ActCard({ quest, side, inView, delay }: { quest: QuestDef; side: 'l' | 'r'; inView: boolean; delay: number }) {
  const meta = REALM_META[quest.realm];
  const giver = NPCS[quest.giverId];
  const bossObjective = quest.objectives.find((o) => o.kind === 'boss');
  const bossFoe = bossObjective?.enemyId ? (ENEMIES[bossObjective.enemyId] ?? REALM_BOSSES[bossObjective.enemyId]) : undefined;
  const isFork = FORK_ACTS.has(quest.chapter ?? -1);
  const isFinale = quest.chapter === 9;

  return (
    <article
      className={`panel corner-brackets relative p-6 md:p-7 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
      style={{ animationDelay: `${delay}ms`, ...cssVar('--accent', meta.accent) }}
      aria-label={`Act ${toRoman(quest.chapter ?? 0)}: ${quest.name}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          to={`/realms#${quest.realm}`}
          className="chip transition-all hover:brightness-125"
          style={{ borderColor: `color-mix(in srgb, ${meta.accent} 50%, transparent)`, color: meta.accent }}
          title={`Travel to the ${REALMS[quest.realm].displayName} chapter`}
        >
          <span className="font-runic" aria-hidden="true">
            {meta.rune}
          </span>
          ACT {toRoman(quest.chapter ?? 0)} · {REALMS[quest.realm].displayName.toUpperCase()}
        </Link>
        {isFork && (
          <span className="chip text-phosphor" style={{ borderColor: 'rgb(var(--phosphor-rgb) / 0.5)', boxShadow: '0 0 12px rgb(var(--phosphor-rgb) / 0.25)' }}>
            <span className="font-runic" aria-hidden="true">
              ᚦ
            </span>
            FORK
          </span>
        )}
        {isFinale && (
          <span className="chip text-galdr" style={{ borderColor: 'color-mix(in srgb, var(--galdr) 50%, transparent)' }}>
            <span className="font-runic" aria-hidden="true">
              ᛟ
            </span>
            THREE ENDINGS
          </span>
        )}
        {!isFork && !isFinale && quest.branch && <span className="chip chip-version">CHOICE</span>}
      </div>

      <h3 className="font-display mt-4 text-[1.25rem] font-bold uppercase leading-tight tracking-[0.06em] text-bone">
        {quest.name}
      </h3>
      <p className="body mt-3 text-[0.875rem] leading-relaxed">{quest.summary}</p>

      {isFinale && quest.branch && (
        <div className="mt-4 flex flex-col gap-1.5 border-l-2 border-galdr/40 pl-3">
          {quest.branch.options.map((o) => (
            <p key={o.id} className="micro leading-relaxed text-bone-dim">
              <span className="text-galdr">ENDING —</span> {endingTitle(o.outcomeText)}
            </p>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-iron pt-4">
        <span className="micro">GIVER — {giver?.name.toUpperCase() ?? 'UNKNOWN'}</span>
        {bossFoe && <span className="micro">BOSS — {bossFoe.name.toUpperCase()}</span>}
        <span className="micro ml-auto">
          LV {quest.level} · {quest.rewards.xp.toLocaleString()} XP
        </span>
      </div>
      <span className="micro absolute right-4 top-4 text-ash" aria-hidden="true">
        {side === 'l' ? '◂' : '▸'}
      </span>
    </article>
  );
}

function CampaignTimeline() {
  const sectionRef = useRef<HTMLElement>(null);
  const spineRef = useRef<HTMLDivElement>(null);
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -20% 0px' });

  // Spine draws with scroll (scrub scaleY).
  useEffect(() => {
    if (reducedMotion()) return;
    const section = sectionRef.current;
    const spine = spineRef.current;
    if (!section || !spine) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        spine,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: { trigger: section, start: 'top 70%', end: 'bottom 60%', scrub: true },
        },
      );
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} id="campaign" className="relative border-t border-iron bg-void py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ NINE ACTS · ONE THREAD" runes="ᚠᚢᚦᚨᚱᚲᚷᚹᚺ" />
        <h2 className="h2 mt-6">THE CAMPAIGN</h2>
        <p className="body mt-5 max-w-reading">
          Nine acts, one per realm. Three great forks bend the saga; the last
          act breaks it into three endings. The acts are gates — the realms
          open as the thread holds.
        </p>

        <div ref={ref} className="relative mt-16">
          {/* Spine */}
          <div className="absolute bottom-0 left-4 top-0 w-px bg-iron md:left-1/2 md:-translate-x-1/2" aria-hidden="true" />
          <div
            ref={spineRef}
            className="absolute bottom-0 left-4 top-0 w-px origin-top bg-phosphor md:left-1/2 md:-translate-x-1/2"
            style={{ boxShadow: '0 0 10px rgb(var(--phosphor-rgb) / 0.45)' }}
            aria-hidden="true"
          />

          <ol className="flex flex-col gap-10 md:gap-14">
            {MAIN_QUESTS.map((q, i) => {
              const meta = REALM_META[q.realm];
              const left = i % 2 === 0;
              return (
                <li key={q.id} className="relative">
                  {/* Node medallion on the spine */}
                  <span
                    className="absolute left-4 top-7 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border bg-void md:left-1/2"
                    style={{ borderColor: meta.accent, boxShadow: `0 0 12px ${meta.accent}55` }}
                    aria-hidden="true"
                  >
                    <span className="font-runic text-base" style={{ color: meta.accent }}>
                      {meta.rune}
                    </span>
                  </span>
                  <div className={`pl-12 md:w-1/2 md:pl-0 ${left ? 'md:pr-12' : 'md:ml-auto md:pl-12'}`}>
                    <ActCard quest={q} side={left ? 'l' : 'r'} inView={inView} delay={(i % 3) * 80} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="micro mt-12 text-center leading-relaxed text-ash">
          ᚦ MARKS THE THREE GREAT FORKS · EVERY ACT HOUSES A CHOICE · THE FINALE SPLITS THREE WAYS
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S4 · Factions — three powers, thresholds, mock standing bar
// ---------------------------------------------------------------------------

const FACTION_META: Record<FactionId, { rune: string; accent: string; creed: string }> = {
  aesir_pact: { rune: 'ᛖ', accent: 'var(--realm-asgard)', creed: 'Honor, order, and the old sacrifices.' },
  dvergr_guild: { rune: 'ᛊ', accent: 'var(--realm-svartalfheim)', creed: 'Every debt weighed. Every name remembered.' },
  free_jotnar: { rune: 'ᛃ', accent: 'var(--realm-jotunheim)', creed: 'The realms loosened, not burned.' },
};

/** Example standing readout (the live value lives on the shard). */
const MOCK_STANDING: Record<FactionId, number> = {
  aesir_pact: 120,
  dvergr_guild: -80,
  free_jotnar: 340,
};

function rankIndex(standing: number): number {
  let idx = 0;
  FACTION_RANK_THRESHOLDS.forEach((t, i) => {
    if (standing >= t) idx = i;
  });
  return idx;
}

function Factions() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [open, setOpen] = useState<FactionId | null>(null);

  return (
    <section id="factions" className="relative border-t border-iron bg-abyss py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THREE POWERS" runes="ᛖᛊᛃ" />
        <h2 className="h2 mt-6">THE FACTIONS</h2>
        <p className="body mt-5 max-w-reading">
          No faction is right. Each remembers what you did — the forks you
          take move your standing between Forsworn and Hall-champion.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {(Object.keys(FACTIONS) as FactionId[]).map((fid, i) => {
            const f = FACTIONS[fid];
            const meta = FACTION_META[fid];
            const standing = MOCK_STANDING[fid];
            const current = rankIndex(standing);
            const pct = ((standing - FACTION_RANK_THRESHOLDS[0]!) / (FACTION_RANK_THRESHOLDS[5]! - FACTION_RANK_THRESHOLDS[0]!)) * 100;
            const expanded = open === fid;
            return (
              <article
                key={fid}
                className={`panel corner-brackets flex flex-col p-6 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                style={{ animationDelay: `${i * 90}ms`, ...cssVar('--accent', meta.accent) }}
              >
                <div className="flex items-center gap-4">
                  <span className="sigil-badge" style={cssVar('--accent', meta.accent)}>
                    <span>{meta.rune}</span>
                  </span>
                  <div>
                    <h3 className="font-display text-[1.05rem] font-bold tracking-[0.08em] text-bone">
                      {f.name.toUpperCase()}
                    </h3>
                    <p className="font-norse mt-0.5 text-[0.95rem] leading-tight" style={{ color: meta.accent }}>
                      {meta.creed}
                    </p>
                  </div>
                </div>
                <p className="body mt-4 flex-1 text-[0.8125rem] leading-relaxed">{f.description}</p>

                {/* Standing bar (example) */}
                <div className="mt-5">
                  <div className="flex items-baseline justify-between">
                    <p className="micro">EXAMPLE STANDING</p>
                    <p className="stat text-[0.75rem]" style={{ color: meta.accent }}>
                      {standing > 0 ? '+' : ''}
                      {standing} · {f.ranks[current]?.toUpperCase()}
                    </p>
                  </div>
                  <div className="stat-bar-track mt-2 w-full" style={{ height: 6 }}>
                    <span
                      className="stat-bar-fill"
                      style={{ width: inView ? `${pct}%` : '0%', background: meta.accent, transitionDelay: '300ms' }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : fid)}
                  aria-expanded={expanded}
                  className="kicker mt-5 inline-flex items-center gap-2 transition-colors hover:text-phosphor-hi"
                >
                  RANK LADDER {expanded ? '▴' : '▾'}
                </button>
                <div
                  className="grid transition-all duration-300"
                  style={{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}
                >
                  <ol className="overflow-hidden">
                    {f.ranks.map((rank, ri) => (
                      <li
                        key={rank}
                        className="flex items-baseline justify-between gap-3 border-b border-iron/50 py-1.5 text-[0.75rem] last:border-b-0"
                      >
                        <span className={ri === current ? 'body-strong' : 'body text-ash'}>
                          {ri === current ? '▸ ' : ''}
                          {rank}
                        </span>
                        <span className="micro">{FACTION_RANK_THRESHOLDS[ri]! >= 0 ? `${FACTION_RANK_THRESHOLDS[ri]}+` : FACTION_RANK_THRESHOLDS[ri]}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S5 · Bestiary — six entries, class filters, stat modal
// ---------------------------------------------------------------------------

type BestiaryFilter = 'undead' | 'beast' | 'giantkin' | 'divine' | 'worldboss';

interface BestiaryEntry {
  enemyId: string;
  img: string;
  filter: BestiaryFilter;
  classLabel: string;
  quote: string;
  pips: number;
}

const BESTIARY: BestiaryEntry[] = [
  { enemyId: 'draugr', img: '/bestiary-draugr.jpg', filter: 'undead', classLabel: 'UNDEAD · SHAMBLER', quote: 'It remembers being buried. Nothing else.', pips: 1 },
  { enemyId: 'vargr', img: '/bestiary-wolf.jpg', filter: 'beast', classLabel: 'BEAST · PACK', quote: 'You will hear the pack before the snow does.', pips: 2 },
  { enemyId: 'troll', img: '/bestiary-troll.jpg', filter: 'giantkin', classLabel: 'GIANT-KIN · CRUSHER', quote: 'It is not angry. It is weather.', pips: 3 },
  { enemyId: 'valkyrja', img: '/bestiary-valkyrie.jpg', filter: 'divine', classLabel: 'DIVINE · DUELIST', quote: 'She chose the fallen. Then she fell.', pips: 4 },
  { enemyId: 'hrimthurs', img: '/bestiary-giant.jpg', filter: 'giantkin', classLabel: 'GIANT · BOSS-TIER', quote: 'The mountains have cousins.', pips: 4 },
  { enemyId: 'boss_garmr', img: '/bestiary-boss.jpg', filter: 'worldboss', classLabel: 'WORLD BOSS · GATEKEEPER', quote: 'The hound is not guarding the gate. The gate is guarding you from him.', pips: 5 },
];

const FILTERS: { id: BestiaryFilter | 'all'; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'undead', label: 'UNDEAD' },
  { id: 'beast', label: 'BEAST' },
  { id: 'giantkin', label: 'GIANT-KIN' },
  { id: 'divine', label: 'DIVINE' },
  { id: 'worldboss', label: 'WORLD BOSS' },
];

function foeOf(enemyId: string): EnemyDef | undefined {
  return ENEMIES[enemyId] ?? REALM_BOSSES[enemyId];
}

function realmsOfFoe(enemyId: string): RealmId[] {
  return (Object.keys(REALMS) as RealmId[]).filter(
    (id) => REALMS[id].bossEnemyId === enemyId || REALMS[id].spawnTable.some((s) => s.enemyId === enemyId),
  );
}

function BestiaryModal({ entry, onClose }: { entry: BestiaryEntry | null; onClose: () => void }) {
  const foe = entry ? foeOf(entry.enemyId) : undefined;
  const loot = foe?.lootTable ? [...(LOOT_TABLES[foe.lootTable] ?? [])].sort((a, b) => b.chance - a.chance) : [];
  const found = entry ? realmsOfFoe(entry.enemyId) : [];

  return (
    <SiteModal open={entry !== null} onClose={onClose} label={foe ? `Bestiary entry: ${foe.name}` : 'Bestiary entry'} wide>
      {entry && foe && (
        <div className="grid gap-0 md:grid-cols-[300px_1fr]">
          <div className="relative min-h-[240px] overflow-hidden bg-abyss">
            <img src={entry.img} alt={foe.name} className="absolute inset-0 h-full w-full object-cover" />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(8,9,11,0.7), transparent 50%)' }}
              aria-hidden="true"
            />
          </div>
          <div className="p-6 md:p-8">
            <p className="micro text-blood">{entry.classLabel}</p>
            <h3 className="h3 mt-2">{foe.name.toUpperCase()}</h3>
            <p className="font-norse mt-3 text-[1.05rem] leading-snug text-bone-dim">{foe.description}</p>

            <dl className="mt-6 grid grid-cols-3 gap-x-4 gap-y-3 text-[0.8125rem] sm:grid-cols-6">
              <div><dt className="micro">HP</dt><dd className="stat text-bone">{foe.baseStats.hp.toLocaleString()}</dd></div>
              <div><dt className="micro">DMG</dt><dd className="stat text-bone">{foe.baseStats.damage}</dd></div>
              <div><dt className="micro">SPEED</dt><dd className="stat text-bone">{foe.baseStats.speed}m/s</dd></div>
              <div><dt className="micro">ARMOR</dt><dd className="stat text-bone">{foe.armor}</dd></div>
              <div><dt className="micro">AGGRO</dt><dd className="stat text-bone">{foe.aggroRangeM}m</dd></div>
              <div><dt className="micro">XP</dt><dd className="stat text-bone">{foe.baseStats.xp.toLocaleString()}</dd></div>
            </dl>

            <p className="micro mt-7 text-phosphor">▚▚ ATTACK PATTERNS</p>
            <ul className="mt-3 flex flex-col gap-2">
              {foe.attacks.map((a) => (
                <li key={a.id} className="border-b border-iron/50 pb-2 text-[0.75rem] last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="body-strong">{a.name}</span>
                    <span className="micro text-ash">
                      {a.range}m · {a.cooldownSec}s CD · {a.windupMs}ms TELEGRAPH · ×{a.damageMult}
                    </span>
                  </div>
                  <p className="body mt-0.5 leading-relaxed text-ash">{a.notes}</p>
                </li>
              ))}
            </ul>

            {foe.boss && (
              <p className="micro mt-4 leading-relaxed text-ash">
                ARENA {foe.boss.arenaRadiusM}M · {foe.boss.phases.length} PHASES
                {foe.boss.enrageSec > 0 ? ` · ENRAGE ${foe.boss.enrageSec}s` : ' · NO ENRAGE'}
              </p>
            )}

            {loot.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="micro mr-1">LOOT:</span>
                {loot.map((l) => (
                  <span key={l.itemId} className="chip chip-version">
                    {ITEMS[l.itemId]?.name.toUpperCase() ?? l.itemId.toUpperCase()} {Math.round(l.chance * 100)}%
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="micro mr-1">WHERE FOUND:</span>
              {found.map((id) => (
                <Link
                  key={id}
                  to={`/realms#${id}`}
                  onClick={onClose}
                  className="chip transition-colors hover:border-phosphor hover:text-phosphor"
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

function Bestiary() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [filter, setFilter] = useState<BestiaryFilter | 'all'>('all');
  const [open, setOpen] = useState<BestiaryEntry | null>(null);

  const visible = useMemo(
    () => BESTIARY.filter((e) => filter === 'all' || e.filter === filter),
    [filter],
  );

  return (
    <section id="bestiary" className="relative border-t border-iron bg-void py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ FIELD NOTES OF THE SLAIN" runes="ᛒᛖᛊᛏ" />
        <h2 className="h2 mt-6">THE BESTIARY</h2>
        <p className="body mt-5 max-w-reading">
          Six entries from the wanderer's margin. Stats are the shard's own
          numbers; the handwriting is ours.
        </p>

        {/* Filters */}
        <div className="mt-10 flex flex-wrap gap-2" role="group" aria-label="Filter bestiary by class">
          {FILTERS.map((f) => {
            const active = f.id === filter;
            const count = f.id === 'all' ? BESTIARY.length : BESTIARY.filter((e) => e.filter === f.id).length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={active}
                className="chip transition-all"
                style={
                  active
                    ? { borderColor: 'var(--phosphor)', color: 'var(--phosphor)', background: 'rgb(var(--phosphor-rgb) / 0.1)' }
                    : undefined
                }
              >
                {f.label} <span className="text-ash">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((entry, i) => {
            const foe = foeOf(entry.enemyId)!;
            return (
              <button
                key={entry.enemyId}
                type="button"
                onClick={() => setOpen(entry)}
                className={`realm-card corner-brackets group text-left ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
                style={{ animationDelay: `${(i % 3) * 80}ms` }}
                aria-label={`${foe.name} — open bestiary entry`}
              >
                <div className="realm-card-art">
                  <img src={entry.img} alt={foe.name} loading="lazy" />
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="chip chip-version text-blood">{entry.classLabel}</span>
                    <ThreatPips threat={entry.pips} accent="var(--blood)" lit={inView} />
                  </div>
                  <h3 className="font-display text-[1.05rem] font-bold tracking-[0.08em] text-bone">
                    {foe.name.toUpperCase()}
                  </h3>
                  <div className="micro flex flex-wrap gap-x-4 gap-y-1">
                    <span>HP {foe.baseStats.hp.toLocaleString()}</span>
                    <span>DMG {foe.baseStats.damage}</span>
                    <span>{foe.baseStats.speed} M/S</span>
                    <span>XP {foe.baseStats.xp.toLocaleString()}</span>
                    <span>AGGRO {foe.aggroRangeM}M</span>
                  </div>
                  {foe.lootTable && (
                    <p className="micro normal-case leading-relaxed text-ash">
                      DROPS —{' '}
                      {[...(LOOT_TABLES[foe.lootTable] ?? [])]
                        .sort((a, b) => b.chance - a.chance)
                        .slice(0, 2)
                        .map((l) => ITEMS[l.itemId]?.name ?? l.itemId)
                        .join(' · ')
                        .toUpperCase()}
                    </p>
                  )}
                  <p className="font-norse mt-1 text-[0.95rem] leading-snug text-bone-dim">{entry.quote}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <BestiaryModal entry={open} onClose={() => setOpen(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// S6 · Branching threads — two live dialogue forks from contracts/quests.ts
// ---------------------------------------------------------------------------

function BranchCard({ questId, inView, delay }: { questId: string; inView: boolean; delay: number }) {
  const quest = QUESTS[questId]!;
  const branch = quest.branch!;
  const meta = REALM_META[quest.realm];
  const [choice, setChoice] = useState<BranchOption | null>(null);

  return (
    <article
      className={`panel corner-brackets flex flex-col p-6 md:p-7 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
      style={{ animationDelay: `${delay}ms`, ...cssVar('--accent', meta.accent) }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip" style={{ borderColor: `color-mix(in srgb, ${meta.accent} 50%, transparent)`, color: meta.accent }}>
          ACT {toRoman(quest.chapter ?? 0)} · {REALMS[quest.realm].displayName.toUpperCase()}
        </span>
        <span className="chip chip-version">{quest.name.toUpperCase()}</span>
      </div>

      <p className="font-norse mt-4 text-[1.1rem] leading-snug text-bone-dim">“{branch.prompt}”</p>

      <div className="mt-5 flex flex-col gap-2.5">
        {branch.options.map((opt) => {
          const chosen = choice?.id === opt.id;
          const dimmed = choice !== null && !chosen;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={choice !== null}
              onClick={() => setChoice(opt)}
              aria-pressed={chosen}
              className="chip w-full justify-start px-4 py-3 text-left normal-case tracking-normal transition-all"
              style={{
                borderColor: chosen ? 'var(--phosphor)' : undefined,
                color: chosen ? 'var(--phosphor-hi)' : undefined,
                boxShadow: chosen ? '0 0 14px rgb(var(--phosphor-rgb) / 0.3)' : undefined,
                opacity: dimmed ? 0.4 : 1,
              }}
            >
              <span className="font-runic mr-2" aria-hidden="true">
                {chosen ? 'ᛟ' : '᛫'}
              </span>
              {opt.text}
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-[5.5rem]">
        {choice && (
          <>
            <p className="body text-[0.875rem] leading-relaxed">
              <BootType text={choice.outcomeText} active speed={12} />
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(choice.factionDelta ?? []).map((d) => (
                <span
                  key={d.factionId}
                  className="chip chip-version"
                  style={
                    d.delta >= 0
                      ? { color: 'var(--soul)', borderColor: 'color-mix(in srgb, var(--soul) 40%, transparent)' }
                      : { color: 'var(--blood)', borderColor: 'color-mix(in srgb, var(--blood) 40%, transparent)' }
                  }
                >
                  {d.delta >= 0 ? '+' : ''}
                  {d.delta} {FACTIONS[d.factionId].name.toUpperCase()}
                </span>
              ))}
              {choice.bonusXp && <span className="chip chip-version text-phosphor">+{choice.bonusXp} BONUS XP</span>}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setChoice(null)}
        disabled={choice === null}
        className="kicker mt-2 self-start transition-colors hover:text-phosphor-hi disabled:opacity-30"
      >
        ↺ REWEAVE THE THREAD
      </button>
    </article>
  );
}

function BranchingThreads() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -25% 0px' });
  return (
    <section id="threads" className="relative border-t border-iron bg-abyss py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ CHOICES THAT STAY CHOSEN" runes="ᚦᚦ" />
        <h2 className="h2 mt-6">BRANCHING THREADS</h2>
        <p className="body mt-5 max-w-reading">
          Two sample forks, straight from the campaign ledger. Choose one —
          the shard remembers. (Here you may reweave; in the realms, never.)
        </p>
        <div ref={ref} className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BranchCard questId="q_main_1" inView={inView} delay={0} />
          <BranchCard questId="q_main_6" inView={inView} delay={120} />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S7 · Glossary — Norse terms, click to copy
// ---------------------------------------------------------------------------

const GLOSSARY: { term: string; tag: string; gloss: string }[] = [
  { term: 'Bifröst', tag: 'NOUN · PLACE', gloss: 'The burning rainbow bridge to Asgard. Currently the wrong color.' },
  { term: 'Draugr', tag: 'NOUN · FOE', gloss: 'The barrow-dead. It remembers being buried. Nothing else.' },
  { term: 'Dvergr', tag: 'NOUN · KIN', gloss: 'The dwarf-kin of the deep forges. Every hammer-fall is a word.' },
  { term: 'Einherjar', tag: 'NOUN · BEINGS', gloss: 'The chosen slain, feasting in Valhöll until the last morning.' },
  { term: 'Galdr', tag: 'NOUN · MAGIC', gloss: 'The sung spell — the rune-schools’ spoken half.' },
  { term: 'Hacksilver', tag: 'NOUN · CURRENCY', gloss: 'Chopped silver, weighed not counted. Death tithes five percent of yours.' },
  { term: 'Hersir', tag: 'NOUN · CALLING', gloss: 'A shield-sworn freeholder. The warrior’s path walks under this name.' },
  { term: 'Jötunn', tag: 'NOUN · KIN', gloss: 'The giant-kin: frost, fire, and mountain. Older than the gods, less forgiving.' },
  { term: 'Ljósálfar', tag: 'NOUN · KIN', gloss: 'The light elves of Alfheim, keepers of the light unspent.' },
  { term: 'Seiðr', tag: 'NOUN · MAGIC', gloss: 'The deep craft of weaving and unweaving. The rune-schools are its dialects.' },
  { term: 'Vargr', tag: 'NOUN · FOE', gloss: 'The wolf-kin. You will hear the pack before the snow does.' },
  { term: 'Waystone', tag: 'NOUN · ARTIFACT', gloss: 'Attuned standing stones; fast-travel anchors for a wanderer’s thread.' },
  { term: 'Yggdrasil', tag: 'NOUN · COSMOLOGY', gloss: 'The world-ash that holds the nine realms. Root, trunk, and crown.' },
  { term: 'Æsir', tag: 'NOUN · KIN', gloss: 'The gods of the high halls — order, oaths, and thunder.' },
];

function Glossary() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [copied, markCopied] = useCopiedFlag();

  const copy = async (term: string) => {
    try {
      await navigator.clipboard.writeText(term);
    } catch {
      /* clipboard unavailable */
    }
    markCopied(term);
  };

  return (
    <section id="glossary" className="relative border-t border-iron bg-void py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ SPEAK THE LANGUAGE" runes="ᚷᛚᛟᛋ" />
        <h2 className="h2 mt-6">GLOSSARY OF THE NINE</h2>
        <p className="body mt-5 max-w-reading">
          Fourteen words the saga keeps using. Click any card to copy the term.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GLOSSARY.map((g, i) => (
            <button
              key={g.term}
              type="button"
              onClick={() => void copy(g.term)}
              className={`panel group p-5 text-left transition-all hover:-translate-y-0.5 hover:border-galdr/50 ${
                inView ? 'reveal-rise is-revealed' : 'reveal-rise'
              }`}
              style={{ animationDelay: `${(i % 6) * 60}ms` }}
              aria-label={`${g.term} — ${g.gloss} (copy term)`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-norse text-[1.25rem] leading-none text-bone transition-colors group-hover:text-galdr">
                  {copied === g.term ? <span className="text-soul">COPIED</span> : g.term}
                </h3>
                <span className="micro text-ash">{g.tag}</span>
              </div>
              <p className="body mt-2.5 text-[0.75rem] leading-relaxed">{g.gloss}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export default function Lore() {
  useHashScroll();
  return (
    <div className="noise-overlay relative">
      <LoreHeader />
      <Cosmology />
      <RuneDivider sigil="ᚱ" />
      <CampaignTimeline />
      <Factions />
      <Bestiary />
      <RuneDivider sigil="ᚦ" />
      <BranchingThreads />
      <Glossary />
      <CtaBand
        heading="THE TENTH THREAD IS YOURS"
        primary={{ to: '/game', label: 'WRITE YOUR SAGA' }}
        secondary={{ to: '/multiplayer', label: 'WATCH THE SHARDS' }}
      />
    </div>
  );
}
