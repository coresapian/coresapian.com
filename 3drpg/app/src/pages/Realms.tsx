// ============================================================================
// CORESAPIAN — src/pages/Realms.tsx (design/realms.md — S1…S12)
// The Nine Realms codex: interactive world-tree map, nine accent-themed
// scroll chapters (art, threats, resources, boss, realm ability, portal,
// ambient), portal-mechanics strip, closing CTA. All game facts from
// contracts/realms.ts + enemies.ts + skills.ts + items.ts + quests.ts.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import type { RealmId } from '../../contracts/types';
import { REALMS } from '../../contracts/realms';
import { ENEMIES, REALM_BOSSES } from '../../contracts/enemies';
import { ITEMS } from '../../contracts/items';
import { REALM_ABILITIES } from '../../contracts/skills';
import { QUESTS } from '../../contracts/quests';

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
import { ParticleField } from '@/components/site/Particles';
import { ALL_REALM_RUNES, REALM_META, REALM_ORDER, toRoman } from '@/components/site/realmMeta';

gsap.registerPlugin(ScrollTrigger);

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Boss threat pips derived from realm tier (1..9 → 3..5). */
function bossPips(tier: number): number {
  return Math.min(5, 2 + Math.ceil(tier / 2));
}

/** Chapter quest whose reward unlocks `realmId` (drives portal status). */
function unlockingChapter(realmId: RealmId): number | null {
  for (const q of Object.values(QUESTS)) {
    if (q.type === 'main' && q.rewards.unlockRealm === realmId) return q.chapter ?? null;
  }
  return null;
}

/** Visited-realm save (progress legend on the map). Defensive read. */
function readVisited(): RealmId[] {
  try {
    const raw = localStorage.getItem('coresapian.save.visitedRealms');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is RealmId => typeof r === 'string' && r in REALM_META);
  } catch {
    return [];
  }
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------------------
// S1 · Header — "The World Tree" with interactive realm-node map
// ---------------------------------------------------------------------------

function WorldTreeMap() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -30% 0px' });
  const [hovered, setHovered] = useState<RealmId | null>(null);
  const [visited] = useState<RealmId[]>(() => readVisited());
  const backdropRef = useRef<HTMLDivElement>(null);

  // Backdrop parallax at 0.3× scroll speed (realms.md S1).
  useEffect(() => {
    if (reducedMotion()) return;
    const el = backdropRef.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { yPercent: -10 },
        {
          yPercent: 10,
          ease: 'none',
          scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
    });
    return () => ctx.revert();
  }, []);

  const active = hovered ? REALM_META[hovered] : null;
  const activeRealm = hovered ? REALMS[hovered] : null;

  return (
    <div ref={ref} className="relative mt-14">
      <div className="panel relative overflow-hidden">
        {/* world-tree.jpg backdrop at 20% with 0.3× parallax */}
        <div ref={backdropRef} className="absolute inset-[-12%]" aria-hidden="true">
          <img
            src="/world-tree.jpg"
            alt=""
            className="h-full w-full object-cover opacity-20"
            loading="eager"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(111,162,135,0.10), transparent 60%)' }}
          aria-hidden="true"
        />

        <div className="relative grid lg:grid-cols-[1fr_300px]">
          {/* Interactive radial diagram */}
          <div className="relative mx-auto w-full max-w-[760px]">
            <svg viewBox="0 0 1000 940" className="h-auto w-full" role="group" aria-label="World-tree map of the nine realms">
              {/* Trunk */}
              <path
                d="M500,70 C490,230 512,320 500,440 C488,560 512,690 500,880"
                fill="none"
                stroke="var(--iron-2)"
                strokeWidth={5}
                strokeLinecap="round"
                pathLength={1}
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: inView ? 0 : 1,
                  transition: 'stroke-dashoffset 900ms cubic-bezier(0.25,1,0.5,1)',
                }}
              />
              {/* Roots */}
              {[430, 470, 530, 570].map((rx) => (
                <path
                  key={rx}
                  d={`M500,860 Q ${(rx + 500) / 2},905 ${rx},925`}
                  fill="none"
                  stroke="var(--iron)"
                  strokeWidth={2.5}
                  pathLength={1}
                  style={{
                    strokeDasharray: 1,
                    strokeDashoffset: inView ? 0 : 1,
                    transition: 'stroke-dashoffset 700ms ease-out 500ms',
                  }}
                />
              ))}
              {/* Branch connectors */}
              {REALM_ORDER.map((id, i) => {
                const m = REALM_META[id];
                const cx = 500 + (m.map.x - 500) * 0.3;
                const cy = m.map.anchorY + (m.map.y - m.map.anchorY) * 0.9;
                const lit = hovered === id;
                return (
                  <path
                    key={id}
                    d={`M500,${m.map.anchorY} Q ${cx},${cy} ${m.map.x},${m.map.y}`}
                    fill="none"
                    stroke={m.accent}
                    strokeWidth={lit ? 3 : 1.6}
                    strokeOpacity={lit ? 1 : 0.45}
                    pathLength={1}
                    style={{
                      strokeDasharray: 1,
                      strokeDashoffset: inView ? 0 : 1,
                      transition: `stroke-dashoffset 800ms cubic-bezier(0.25,1,0.5,1) ${200 + i * 150}ms, stroke-width 150ms, stroke-opacity 150ms`,
                      filter: lit ? `drop-shadow(0 0 6px ${m.accent})` : undefined,
                    }}
                  />
                );
              })}
              {/* Realm nodes */}
              {REALM_ORDER.map((id, i) => {
                const m = REALM_META[id];
                const lit = hovered === id;
                const seen = visited.includes(id);
                const delay = 200 + i * 150 + 650;
                return (
                  <g
                    key={id}
                    transform={`translate(${m.map.x}, ${m.map.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${REALMS[id].displayName} — chapter ${toRoman(REALMS[id].tier)}. Travel to chapter.`}
                    onMouseEnter={() => setHovered(id)}
                    onMouseLeave={() => setHovered((h) => (h === id ? null : h))}
                    onFocus={() => setHovered(id)}
                    onBlur={() => setHovered((h) => (h === id ? null : h))}
                    onClick={() => scrollToId(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        scrollToId(id);
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      opacity: inView ? 1 : 0,
                      transition: `opacity 400ms ease-out ${delay}ms`,
                      outline: 'none',
                    }}
                  >
                    <g
                      style={{
                        transform: inView ? 'scale(1)' : 'scale(0)',
                        transformBox: 'fill-box',
                        transformOrigin: 'center',
                        transition: `transform 500ms cubic-bezier(0.34,1.56,0.64,1) ${delay}ms`,
                      }}
                    >
                      {/* idle pulse ring */}
                      <circle
                        r={46}
                        fill="none"
                        stroke={m.accent}
                        strokeWidth={1}
                        strokeDasharray="3 7"
                        strokeOpacity={lit ? 0.9 : 0.3}
                        style={{ animation: `glow-breathe 2.4s ease-in-out ${i * 0.27}s infinite` }}
                      />
                      <circle
                        r={32}
                        fill={seen ? rgba(m.accent, 0.35) : rgba(m.accent, 0.1)}
                        stroke={m.accent}
                        strokeWidth={lit ? 2.4 : 1.4}
                        style={{
                          transition: 'all 150ms ease-out',
                          filter: lit ? `drop-shadow(0 0 10px ${m.accent})` : undefined,
                        }}
                      />
                      <text
                        textAnchor="middle"
                        dy="0.36em"
                        fontSize={27}
                        fill={lit ? m.glow : m.accent}
                        style={{ fontFamily: "'Noto Sans Runic', monospace", transition: 'fill 150ms' }}
                      >
                        {m.rune}
                      </text>
                    </g>
                    <text
                      y={62}
                      textAnchor="middle"
                      fontSize={16}
                      letterSpacing={2.5}
                      fill={lit ? 'var(--bone)' : 'var(--bone-dim)'}
                      style={{ fontFamily: "'IBM Plex Mono', monospace", transition: 'fill 150ms' }}
                    >
                      {REALMS[id].displayName.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Preview chip / legend rail */}
          <div className="relative flex flex-col gap-4 border-t border-iron p-6 lg:border-l lg:border-t-0">
            <p className="micro text-phosphor">▚▚ REALM NODE</p>
            {active && activeRealm ? (
              <div key={active.id} className="anim-flicker flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <span
                    className="sigil-badge"
                    style={{ ...cssVar('--accent', active.accent), width: 48, height: 48 }}
                  >
                    <span>{active.rune}</span>
                  </span>
                  <div>
                    <p className="font-display text-lg font-bold tracking-[0.1em]" style={{ color: active.accent }}>
                      {activeRealm.displayName.toUpperCase()}
                    </p>
                    <p className="micro mt-0.5">{activeRealm.oldNorse} · ACT {toRoman(activeRealm.tier)}</p>
                  </div>
                </div>
                <p className="font-norse text-[1.05rem] leading-snug text-bone-dim">{active.epithet}</p>
                <div className="flex items-center gap-3">
                  <span className="micro w-14">BOSS</span>
                  <ThreatPips threat={bossPips(activeRealm.tier)} accent={active.accent} />
                </div>
                <p className="micro leading-relaxed">BOSS — {activeRealm.bossName.toUpperCase()}</p>
                <span className="chip mt-1" style={{ borderColor: rgba(active.accent, 0.5), color: active.accent }}>
                  {hovered ? 'CLICK TO TRAVEL ↓' : 'TRAVEL ↓'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="body text-[0.8125rem]">
                  Nine sigils hang on the ash. Hover — or tab — across a node to
                  read its thread; activate it to fall toward that chapter.
                </p>
                <p className="micro leading-relaxed text-ash">
                  FILLED SIGIL = REALM VISITED (LOCAL SAVE)
                </p>
              </div>
            )}
            <div className="mt-auto grid grid-cols-3 gap-2 border-t border-iron pt-4">
              {REALM_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollToId(id)}
                  className="font-runic text-lg transition-all hover:scale-110"
                  style={{ color: REALM_META[id].accent }}
                  title={REALMS[id].displayName}
                  aria-label={`Travel to ${REALMS[id].displayName}`}
                >
                  {REALM_META[id].rune}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreeHeader() {
  const [armed, setArmed] = useState(false);
  const title = useGlyphScramble('THE NINE REALMS', armed);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 450);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <section className="relative overflow-hidden bg-void pb-20 pt-24 md:pt-32">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(111,162,135,0.07), transparent 60%)' }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-content px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_EXPO }}
          className="flex flex-col items-center text-center"
        >
          <p className="kicker">▚▚ YGGDRASIL HOLDS ALL ▚▚</p>
          <p className="font-runic mt-6 text-lg tracking-[0.4em] text-phosphor/70" aria-hidden="true">
            {ALL_REALM_RUNES}
          </p>
          <h1 className="h1 mt-4" aria-label="THE NINE REALMS">
            {title}
          </h1>
          <p className="norse-accent mt-5 max-w-reading text-bone-dim">
            Nine worlds hang on the ash. The thread between them is cut — walk
            the branches, wanderer.
          </p>
        </motion.div>
        <WorldTreeMap />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S2–S10 · Realm chapter anatomy (realms.md shared spec)
// ---------------------------------------------------------------------------

function PaletteChips({ realmId }: { realmId: RealmId }) {
  const meta = REALM_META[realmId];
  const palette = REALMS[realmId].palette;
  const [copied, markCopied] = useCopiedFlag();
  const chips = [
    { key: 'accent', hex: meta.accent, label: 'ACCENT' },
    { key: 'glow', hex: meta.glow, label: 'GLOW' },
    { key: 'mood', hex: palette.ground, label: 'MOOD' },
  ];

  const copy = async (hex: string, key: string) => {
    try {
      await navigator.clipboard.writeText(hex.toUpperCase());
    } catch {
      /* clipboard unavailable */
    }
    markCopied(key);
  };

  return (
    <div className="flex items-center gap-2" aria-label="Realm palette">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => void copy(c.hex, c.key)}
          className="group flex flex-col items-center gap-1"
          title={`${c.label} ${c.hex.toUpperCase()} — click to copy`}
          aria-label={`${c.label} ${c.hex}, copy hex`}
        >
          <span
            className="block h-5 w-5 border border-iron transition-transform group-hover:scale-110"
            style={{ background: c.hex, boxShadow: `0 0 10px ${rgba(c.hex, 0.35)}` }}
          />
          <span className="micro text-[0.5625rem] text-ash group-hover:text-bone-dim">
            {copied === c.key ? <span className="text-soul">COPIED</span> : c.hex.toUpperCase()}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Ambient-audio chip — visual toggle only (site preview; game owns audio). */
function AmbientChip({ realmId, lit }: { realmId: RealmId; lit: boolean }) {
  const [playing, setPlaying] = useState(false);
  const realm = REALMS[realmId];
  const meta = REALM_META[realmId];
  return (
    <button
      type="button"
      onClick={() => setPlaying((p) => !p)}
      aria-pressed={playing}
      title={`Ambient loop preview: ${realm.ambientAudioId}`}
      className="chip gap-2.5 transition-colors hover:border-phosphor"
      style={playing ? { borderColor: rgba(meta.accent, 0.6), color: meta.accent } : undefined}
    >
      <span className="font-runic" aria-hidden="true">
        ᛊ
      </span>
      <span>
        AMBIENT: {playing ? 'PLAYING' : 'PAUSED'} · {realm.ambientAudioId}
      </span>
      {/* Equalizer bars */}
      <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-[2px] bg-current"
            style={{
              height: playing ? `${6 + ((i * 5) % 7)}px` : '3px',
              opacity: playing && lit ? undefined : 0.5,
              animation: playing ? `glow-breathe ${0.4 + i * 0.13}s ease-in-out ${i * 0.09}s infinite alternate` : 'none',
            }}
          />
        ))}
      </span>
    </button>
  );
}

function DataPanel({
  title,
  rune,
  accent,
  delay,
  inView,
  children,
}: {
  title: string;
  rune: string;
  accent: string;
  delay: number;
  inView: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`panel p-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
      style={{ animationDelay: `${delay}ms`, ...cssVar('--accent', accent) }}
    >
      <p className="micro flex items-center gap-2" style={{ color: accent }}>
        <span className="font-runic text-sm" aria-hidden="true">
          {rune}
        </span>
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Asgard lightning flash — isolated perpetual effect (reduced-motion off). */
function LightningFlash() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (reducedMotion()) return;
    let t1 = 0;
    let t2 = 0;
    const arm = () => {
      t1 = window.setTimeout(() => {
        setOn(true);
        t2 = window.setTimeout(() => {
          setOn(false);
          arm();
        }, 80);
      }, 7000 + Math.random() * 7000);
    };
    arm();
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ background: 'rgba(216,236,248,0.32)', opacity: on ? 1 : 0 }}
      aria-hidden="true"
    />
  );
}

function RealmChapter({ realmId, index }: { realmId: RealmId; index: number }) {
  const realm = REALMS[realmId];
  const meta = REALM_META[realmId];
  const ability = REALM_ABILITIES[realm.realmAbilityId];
  const boss = REALM_BOSSES[realm.bossEnemyId];
  const chapter = unlockingChapter(realmId);
  const sectionRef = useRef<HTMLElement>(null);
  const artImgRef = useRef<HTMLImageElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -25% 0px' });
  const name = useGlyphScramble(realm.displayName.toUpperCase(), inView);
  const mediaLeft = index % 2 === 0;

  // Scrub per chapter: inner image parallax ±40px; haze opacity 8%→16% feel.
  useEffect(() => {
    if (reducedMotion()) return;
    const section = sectionRef.current;
    const img = artImgRef.current;
    const haze = hazeRef.current;
    if (!section || !img || !haze) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        img,
        { y: -40 },
        {
          y: 40,
          ease: 'none',
          scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
      gsap.fromTo(
        haze,
        { opacity: 0.55 },
        {
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
    }, section);
    return () => ctx.revert();
  }, []);

  const art = (
    <div className={`panel overflow-hidden ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}>
      <div className="relative aspect-[16/10] overflow-hidden bg-abyss">
        <img
          ref={artImgRef}
          src={`/realm-${realmId}.jpg`}
          alt={`${realm.displayName} — ${meta.epithet}`}
          loading="lazy"
          className="absolute inset-0 h-[calc(100%+80px)] w-full object-cover"
          style={{ top: -40 }}
        />
        {/* Per-realm artwork flourishes (realms.md animation notes) */}
        {realmId === 'vanaheim' && (
          <>
            <div
              className="anim-fog-drift pointer-events-none absolute inset-0"
              style={{ background: 'linear-gradient(105deg, transparent 35%, rgba(240,208,96,0.09) 48%, transparent 62%)' }}
              aria-hidden="true"
            />
            <div
              className="anim-fog-drift pointer-events-none absolute inset-0"
              style={{ background: 'linear-gradient(75deg, transparent 40%, rgba(192,232,136,0.07) 55%, transparent 70%)', animationDelay: '-27s' }}
              aria-hidden="true"
            />
          </>
        )}
        {realmId === 'niflheim' && (
          <div
            className="anim-fog-drift pointer-events-none absolute inset-x-0 top-0 h-1/3"
            style={{
              background: 'linear-gradient(100deg, transparent 20%, rgba(159,216,255,0.16) 45%, rgba(180,140,242,0.12) 60%, transparent 80%)',
              animationDuration: '12s',
            }}
            aria-hidden="true"
          />
        )}
        {realmId === 'asgard' && <LightningFlash />}
        {/* chapter rune watermark */}
        <span
          className="font-runic pointer-events-none absolute bottom-3 right-4 text-6xl opacity-30"
          style={{ color: meta.accent, textShadow: `0 0 18px ${meta.accent}` }}
          aria-hidden="true"
        >
          {meta.rune}
        </span>
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(to top, ${rgba('#08090B', 0.55)}, transparent 40%)` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex items-center gap-2 border-t border-iron px-4 py-2.5">
        <span className="micro flex-1 text-phosphor-dim">
          {inView && (
            <BootType
              text={`VISTA.LOG — ${realm.displayName.toUpperCase()} · ${realm.oldNorse.toUpperCase()} · TIER ${realm.tier}`}
              active={inView}
              speed={10}
            />
          )}
        </span>
        <span className="boot-caret text-phosphor">▊</span>
      </div>
    </div>
  );

  return (
    <section
      ref={sectionRef}
      id={realmId}
      aria-label={`${realm.displayName} chapter`}
      className="relative overflow-hidden border-t border-iron bg-abyss py-24 md:py-32"
      style={{ scrollMarginTop: 64 }}
    >
      {/* Realm underlay: accent haze + particle field */}
      <div
        ref={hazeRef}
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse at 50% 30%, ${rgba(meta.accent, 0.14)}, transparent 60%)` }}
        aria-hidden="true"
      />
      <ParticleField mode={meta.particles} color={meta.accent} />
      {/* Giant rune sigil watermark (Svartalfheim: forge pulse, 1.1s) */}
      <span
        className="font-runic pointer-events-none absolute -right-6 top-10 select-none text-[11rem] leading-none"
        style={{
          color: rgba(meta.accent, 0.07),
          animation: realmId === 'svartalfheim' ? 'glow-breathe 1.1s ease-in-out infinite' : undefined,
        }}
        aria-hidden="true"
      >
        {meta.rune}
      </span>

      <div ref={ref} className="relative mx-auto max-w-content px-4 sm:px-6">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[58%_42%] lg:gap-14">
          {mediaLeft ? art : <div className="lg:order-2">{art}</div>}

          {/* Content column */}
          <div className={mediaLeft ? '' : 'lg:order-1'}>
            <div className="flex items-center gap-3">
              <span className="font-runic text-lg" style={{ color: meta.accent }} aria-hidden="true">
                {meta.rune}
              </span>
              <p className="micro" style={{ color: meta.accent }}>
                ACT {toRoman(realm.tier)} · {realm.oldNorse.toUpperCase()}
              </p>
              <span className="h-px flex-1 bg-iron" aria-hidden="true" />
            </div>

            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <h2
                className="font-display text-[clamp(1.9rem,3.6vw,2.8rem)] font-black uppercase leading-none tracking-[0.08em] text-bone"
                style={{ textShadow: `0 0 12px ${rgba(meta.accent, 0.35)}, 0 0 48px ${rgba(meta.accent, 0.18)}` }}
                aria-label={realm.displayName}
              >
                {name}
              </h2>
              <PaletteChips realmId={realmId} />
            </div>
            <p className="norse-accent mt-3 text-[1.35rem]" style={{ color: meta.accent }}>
              {meta.epithet}
            </p>

            <p className="body mt-5 max-w-reading text-[0.9375rem]">{realm.description}</p>

            {/* Data grid 2×2 */}
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DataPanel title="THREATS" rune="ᚦ" accent={meta.accent} delay={80} inView={inView}>
                <ul className="flex flex-col gap-2.5">
                  {realm.spawnTable.map((s) => {
                    const foe = ENEMIES[s.enemyId];
                    if (!foe) return null;
                    return (
                      <li key={s.enemyId} className="flex items-baseline justify-between gap-3">
                        <span className="body-strong text-[0.8125rem]">{foe.name}</span>
                        <span className="micro whitespace-nowrap">
                          ×{s.packMin}–{s.packMax} · {s.weight}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </DataPanel>

              <DataPanel title="RESOURCES" rune="ᚱ" accent={meta.accent} delay={160} inView={inView}>
                <ul className="flex flex-col gap-2.5">
                  {realm.resourceNodes.map((r, i) => {
                    const mat = ITEMS[r.itemId];
                    return (
                      <li key={`${r.itemId}-${i}`} className="flex items-baseline justify-between gap-3">
                        <span className="body-strong text-[0.8125rem]">{mat?.name ?? r.itemId}</span>
                        <span className="micro whitespace-nowrap">
                          {r.kind.toUpperCase()} · ×{r.yieldMin}–{r.yieldMax}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </DataPanel>

              <DataPanel title="REALM BOSS" rune="ᛒ" accent={meta.accent} delay={240} inView={inView}>
                <p className="body-strong text-[0.8125rem]">{realm.bossName}</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <ThreatPips threat={bossPips(realm.tier)} accent={meta.accent} lit={inView} />
                  {boss && <span className="micro whitespace-nowrap">{boss.baseStats.hp.toLocaleString()} HP</span>}
                </div>
                {boss && <p className="micro mt-2 normal-case leading-relaxed text-ash">{boss.boss?.phases.length ?? 0}-PHASE · ARENA {boss.boss?.arenaRadiusM ?? 0}M</p>}
              </DataPanel>

              <DataPanel title="REALM ABILITY" rune="ᛟ" accent={meta.accent} delay={320} inView={inView}>
                {ability ? (
                  <>
                    <p className="body-strong text-[0.8125rem]" style={{ color: meta.accent }}>
                      {ability.name} <span className="micro text-ash">· {ability.oldNorse}</span>
                    </p>
                    <p className="body mt-2 text-[0.75rem] leading-relaxed">{ability.description}</p>
                  </>
                ) : (
                  <p className="micro">UNKNOWN GIFT</p>
                )}
              </DataPanel>
            </div>

            {/* Footer row: portal + ambient + CTA */}
            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <span
                className="chip"
                style={{ borderColor: rgba(meta.accent, 0.5), color: meta.accent }}
                title="Portal status"
              >
                <span className="chip-dot" style={realm.tier === 1 ? undefined : { background: 'var(--phosphor)', boxShadow: '0 0 8px rgb(var(--phosphor-rgb) / 0.8)' }} />
                PORTAL — {realm.tier === 1 ? 'ALWAYS OPEN' : chapter ? `OPENS AFTER ACT ${toRoman(chapter)}` : 'SEALED'}
              </span>
              <AmbientChip realmId={realmId} lit={inView} />
              {realm.portals.map((p) => (
                <span key={p.to} className="chip chip-version" title={`Portal to ${REALMS[p.to].displayName}`}>
                  → {p.label.toUpperCase()}
                </span>
              ))}
            </div>
            <div className="mt-6">
              <Link
                to="/game"
                className="btn btn-ghost btn-md corner-brackets"
                style={cssVar('--bracket-color', meta.accent)}
              >
                ENTER {realm.displayName.toUpperCase()} →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S11 · Portal mechanics strip — "Walking Between Worlds"
// ---------------------------------------------------------------------------

const PORTAL_STEPS = [
  { rune: 'ᚱ', title: 'ATTUNE', body: 'Bind waystones to your thread; fast-travel from the map.' },
  { rune: 'ᛟ', title: 'OFFER', body: 'Some gates demand offerings — mist pearls, ember, dvergr tokens.' },
  { rune: 'ᛝ', title: 'ENDURE', body: 'Crossing takes 2 seconds. The runes ignite one by one. Do not blink.' },
] as const;

const RING_RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ'];

function PortalRingDemo() {
  const [lit, setLit] = useState<number[]>([]);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const ignite = (i: number) => {
    setLit((cur) => (cur.includes(i) ? cur : [...cur, i]));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLit([]), 900);
  };

  return (
    <div className="panel relative mx-auto mt-12 max-w-[420px] overflow-hidden p-6">
      <p className="micro mb-4 text-center text-phosphor">▚▚ CROSSING SEQUENCE — TAP A RUNE</p>
      <div className="relative mx-auto aspect-square max-w-[300px]">
        {/* rotating dashed ring */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          style={{ animation: 'spin-slow 20s linear infinite' }}
          aria-hidden="true"
        >
          <circle cx="50" cy="50" r="44" fill="none" stroke="var(--iron-2)" strokeWidth="0.8" strokeDasharray="2 3" />
          <circle cx="50" cy="50" r="37" fill="none" stroke="var(--iron)" strokeWidth="0.5" />
        </svg>
        {RING_RUNES.map((rune, i) => {
          const a = (i / RING_RUNES.length) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + Math.cos(a) * 44;
          const y = 50 + Math.sin(a) * 44;
          const on = lit.includes(i);
          return (
            <button
              key={rune}
              type="button"
              onClick={() => ignite(i)}
              aria-label={`Ignite rune ${rune}`}
              className="font-runic absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-lg transition-all duration-300"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                color: on ? 'var(--phosphor-hi)' : 'var(--bone-dim)',
                borderColor: on ? 'var(--phosphor)' : 'var(--iron)',
                background: on ? 'rgb(var(--phosphor-rgb) / 0.15)' : 'rgb(var(--stone-rgb) / 0.8)',
                textShadow: on ? '0 0 12px var(--phosphor)' : 'none',
                boxShadow: on ? '0 0 18px rgb(var(--phosphor-rgb) / 0.4)' : 'none',
              }}
            >
              {rune}
            </button>
          );
        })}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="micro text-ash">{lit.length > 0 ? 'IGNITING…' : '2.0s CROSSING'}</span>
        </div>
      </div>
    </div>
  );
}

function PortalStrip() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <section className="relative border-t border-iron bg-void py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ WALKING BETWEEN WORLDS" runes="ᚱᛟᛝ" />
        <h2 className="h2 mt-6">THE PORTAL CRAFT</h2>
        <p className="body mt-5 max-w-reading">
          The Bifröst is broken, but the branch-roads remain. Every gate obeys
          three laws.
        </p>

        <div ref={ref} className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PORTAL_STEPS.map((step, i) => (
            <div
              key={step.title}
              className={`panel corner-brackets p-6 ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <span className="sigil-badge">
                <span>{step.rune}</span>
              </span>
              <p className="h3 mt-4">{step.title}</p>
              <p className="body mt-2 text-[0.8125rem]">{step.body}</p>
            </div>
          ))}
        </div>

        <PortalRingDemo />

        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })}
            className="kicker inline-flex items-center gap-2 transition-colors hover:text-phosphor-hi"
          >
            SEE THE FULL MAP →
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export default function Realms() {
  useHashScroll();
  return (
    <div className="noise-overlay relative">
      <TreeHeader />
      {REALM_ORDER.map((id, i) => (
        <RealmChapter key={id} realmId={id} index={i} />
      ))}
      <RuneDivider sigil="ᛝ" />
      <PortalStrip />
      <CtaBand
        heading="CHOOSE YOUR FIRST MIST"
        primary={{ to: '/game', label: 'WAKE IN MIDGARD' }}
        secondary={{ to: '/progression', label: 'READ THE SAGA' }}
      />
    </div>
  );
}
