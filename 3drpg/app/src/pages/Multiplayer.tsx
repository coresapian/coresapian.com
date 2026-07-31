// ============================================================================
// CORESAPIAN — src/pages/Multiplayer.tsx (design/multiplayer.md — S1…S7)
// The shared-world codex page: live shard panel (useServerStatus poll + mock
// fallback), the four-state connection lifecycle with a "SIMULATE A DROP"
// demo, orb-avatar explainer, world events with ticking countdowns, netcode
// fairness from contracts/netcode.ts, and social/regions. 
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';

import {
  ATTACK_COOLDOWN_SLACK_MS,
  ATTACK_RANGE_TOLERANCE_M,
  CLIENT_INPUT_HZ,
  HEARTBEAT_MS,
  INTERPOLATION_DELAY_MS,
  MAX_SPEED_MPS,
  MAX_STEP_PER_INPUT_M,
  RECONNECT_INTERVAL_MS,
  RELEVANCE_RADIUS_M,
  SERVER_SNAPSHOT_HZ,
  SNAPSHOT_BUFFER_SIZE,
  SNAPSHOT_PLAYER_CAP,
} from '../../contracts/netcode';

import { useServerStatus } from '@/lib/useServerStatus';
import { useInView } from '@/lib/useInView';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import {
  BootType,
  CtaBand,
  KickerRow,
  RuneDivider,
} from '@/components/site/primitives';
import { reducedMotion, useHashScroll } from '@/components/site/utils';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------------------
// S1 · Hero + live shard panel
// ---------------------------------------------------------------------------

type ShardState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

const STATE_STYLE: Record<ShardState, { label: string; color: string; pulse: boolean }> = {
  connected: { label: 'CONNECTED', color: 'var(--soul)', pulse: false },
  connecting: { label: 'CONNECTING…', color: 'var(--phosphor)', pulse: true },
  reconnecting: { label: 'RETRYING…', color: 'var(--phosphor)', pulse: true },
  offline: { label: 'OFFLINE', color: 'var(--blood)', pulse: false },
};

function StateChip({ state }: { state: ShardState }) {
  const s = STATE_STYLE[state];
  return (
    <span
      className="chip chip-version"
      style={{
        color: s.color,
        borderColor: `color-mix(in srgb, ${s.color} 45%, transparent)`,
        animation: s.pulse ? 'pulse-dot 1.2s infinite' : undefined,
      }}
    >
      <span className="chip-dot" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
      {s.label}
    </span>
  );
}

interface ShardRow {
  code: string;
  region: string;
  state: ShardState;
  latencyMs: number;
  players: number;
}

function ShardPanel({ status }: { status: ReturnType<typeof useServerStatus> }) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // EU row is the real polled shard; NA/ASIA derived demo rows (same shard
  // code vocabulary, jittered so the panel breathes between 5s polls).
  const rows: ShardRow[] = useMemo(() => {
    const base: ShardRow = {
      code: status.shard,
      region: 'EU-WEST',
      state: status.state,
      latencyMs: status.latencyMs,
      players: status.playersOnline,
    };
    const na: ShardRow = {
      code: status.shard.replace('EU', 'NA'),
      region: 'NA-EAST',
      state: status.state,
      latencyMs: Math.round(status.latencyMs * 2.1 + 12),
      players: Math.round(status.playersOnline * 0.8),
    };
    const asia: ShardRow = {
      code: status.shard.replace('EU', 'AS'),
      region: 'ASIA',
      state: status.state,
      latencyMs: Math.round(status.latencyMs * 2.9 + 21),
      players: Math.round(status.playersOnline * 0.37),
    };
    return [base, na, asia];
  }, [status]);

  const total = rows.reduce((a, r) => a + r.players, 0);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(code);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="terminal max-w-[560px]">
      <div className="terminal-titlebar">
        <span>SHARD_STATUS.LOG</span>
        <span className="text-ash">
          {status.live ? 'LIVE FEED' : 'DEMO FEED'} · 5s POLL
        </span>
      </div>
      <div className="terminal-body flex flex-col gap-3">
        {rows.map((row) => (
          <button
            key={row.code}
            type="button"
            onClick={() => void copyCode(row.code)}
            className="group flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-iron/50 pb-3 text-left last:border-b-0"
            title={`Copy shard code ${row.code}`}
            aria-label={`${row.region} shard ${row.code}: ${row.latencyMs}ms, ${row.players} wanderers. Copy shard code.`}
          >
            <span className="stat w-32 text-phosphor group-hover:text-phosphor-hi">
              {copied === row.code ? 'COPIED ✓' : row.code}
            </span>
            <StateChip state={row.state} />
            <span className="stat ml-auto text-bone">{row.latencyMs}ms</span>
            <span className="micro w-24 text-right">{row.players.toLocaleString()} ONLINE</span>
          </button>
        ))}
        <p className="terminal-line pt-1">
          <BootType
            text={`> TOTAL ${total.toLocaleString()} WANDERERS ACROSS ${rows.length} SHARDS · PROTOCOL v1`}
            active
            speed={9}
          />
        </p>
      </div>
    </div>
  );
}

function MultiHero({ status }: { status: ReturnType<typeof useServerStatus> }) {
  const [armed, setArmed] = useState(false);
  const title = useGlyphScramble('THE OTHER WANDERERS', armed);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 450);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <section className="relative flex min-h-[92dvh] items-center overflow-hidden bg-void">
      <div className="absolute inset-0" aria-hidden="true">
        <img
          src="/multiplayer-orbs.jpg"
          alt=""
          className="h-full w-full object-cover opacity-40"
          loading="eager"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, var(--void) 4%, rgba(8,9,11,0.55) 40%, rgba(8,9,11,0.35)), radial-gradient(ellipse at 30% 40%, rgba(111,184,154,0.10), transparent 55%)',
          }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-content px-4 py-24 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_EXPO }}
        >
          <KickerRow label="▚▚ SHARED SHARDS · 24 SOULS PER FRAME" runes="ᛟᛟᛟ" className="max-w-xl" />
          <h1 className="h1 mt-6 max-w-3xl" aria-label="THE OTHER WANDERERS">
            {title}
          </h1>
          <p className="norse-accent mt-5 max-w-reading text-bone-dim">
            The realms are yours alone — until they are not. Look for the
            orbs: every light is another wanderer, walking their own thread.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.8, ease: EASE_EXPO }}
          className="mt-10"
        >
          <ShardPanel status={status} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          className="mt-8 flex flex-wrap items-center gap-4"
        >
          <Link to="/game" className="btn btn-phosphor btn-lg">
            FIND A SHARD
          </Link>
          <button type="button" onClick={() => scrollToId('lifecycle')} className="btn btn-ghost btn-lg corner-brackets">
            HOW THE THREAD HOLDS ↓
          </button>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S2 · Connection lifecycle — CONNECTED / CONNECTING / RETRY IN 3s / OFFLINE
// ---------------------------------------------------------------------------

type LifePhase = 'idle' | 'dropped' | 'retrying' | 'reconnecting';

const LIFE_STATES = [
  {
    id: 'connected', rune: 'ᛟ', title: 'CONNECTED', color: 'var(--soul)',
    banner: '● LINKED · 42ms · 1,203 WANDERERS',
    body: 'The shard holds your thread. Inputs at 15Hz, snapshots back at 10Hz.',
  },
  {
    id: 'connecting', rune: 'ᚲ', title: 'CONNECTING', color: 'var(--phosphor)',
    banner: 'CONNECTING TO SERVER · BIFRÖST-EU…',
    body: 'Handshake + hello. Protocol version is checked before anything moves.',
  },
  {
    id: 'retry', rune: 'ᚱ', title: 'RETRY IN 3s', color: 'var(--phosphor)',
    banner: 'LINK SEVERED — RETRYING IN 3',
    body: 'Fixed 3-second retry, never exponential. You always know when it tries again.',
  },
  {
    id: 'offline', rune: 'ᛝ', title: 'OFFLINE', color: 'var(--blood)',
    banner: 'SHARD UNREACHABLE — OFFLINE MODE',
    body: 'After repeated failures the banner goes red. Your saga stays saved locally.',
  },
] as const;

function ConnectionLifecycle() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -25% 0px' });
  const [phase, setPhase] = useState<LifePhase>('idle');
  const [countdown, setCountdown] = useState(RECONNECT_INTERVAL_MS / 1000);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const simulate = () => {
    if (phase !== 'idle') return;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const later = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    setPhase('dropped');
    setCountdown(RECONNECT_INTERVAL_MS / 1000);
    later(() => setPhase('retrying'), 900);
    later(() => setCountdown(2), 1900);
    later(() => setCountdown(1), 2900);
    later(() => setPhase('reconnecting'), 3900);
    later(() => {
      setPhase('idle');
      setCountdown(RECONNECT_INTERVAL_MS / 1000);
    }, 5000);
  };

  // Which diagram node is lit by the simulation (default: connected).
  const litId: string =
    phase === 'idle' ? 'connected' : phase === 'dropped' ? 'retry' : phase === 'retrying' ? 'retry' : 'connecting';

  const bannerText =
    phase === 'idle'
      ? LIFE_STATES[0].banner
      : phase === 'dropped'
        ? `LINK SEVERED — RETRY IN ${countdown}s`
        : phase === 'retrying'
          ? `LINK SEVERED — RETRY IN ${countdown}s`
          : 'RECONNECTING TO SHARD…';
  const bannerColor = phase === 'idle' ? 'var(--soul)' : 'var(--phosphor)';

  return (
    <section id="lifecycle" className="relative border-t border-iron bg-abyss py-24 md:py-36" style={{ scrollMarginTop: 64 }}>
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ FOUR STATES OF THE LINK" runes="ᛟᚲᚱᛝ" />
        <h2 className="h2 mt-6">THE CONNECTION LIFECYCLE</h2>
        <p className="body mt-5 max-w-reading">
          One banner, four states, zero mysteries. The same strip lives at the
          top of your screen in-game.
        </p>

        {/* State diagram */}
        <ol className="relative mt-14 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          <div
            className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-iron lg:block"
            aria-hidden="true"
          />
          {LIFE_STATES.map((s, i) => {
            const lit = litId === s.id || (phase === 'idle' && s.id === 'connected');
            return (
              <li
                key={s.id}
                className={`relative flex flex-col items-center text-center ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span
                  className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border bg-void transition-all duration-300"
                  style={{
                    borderColor: lit ? s.color : 'var(--iron-2)',
                    boxShadow: lit ? `0 0 16px ${s.color}` : 'none',
                    animation: lit && s.id !== 'offline' && phase !== 'idle' ? 'pulse-dot 1s infinite' : undefined,
                  }}
                  aria-hidden="true"
                >
                  <span className="font-runic text-xl" style={{ color: lit ? s.color : 'var(--ash)' }}>
                    {s.rune}
                  </span>
                </span>
                <p className="micro mt-3" style={{ color: lit ? s.color : 'var(--bone-dim)' }}>
                  {s.title}
                </p>
                <p className="body mt-2 max-w-[220px] text-[0.6875rem] leading-relaxed">{s.body}</p>
                {/* Banner mock */}
                <div className="panel mt-4 w-full max-w-[240px] px-3 py-2">
                  <p className="terminal-line text-[0.625rem]" style={{ color: s.color }}>
                    ▚ {s.banner}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Simulate a drop */}
        <div className="panel corner-brackets mx-auto mt-14 max-w-[640px] p-6 text-center">
          <p className="micro text-phosphor">▚▚ LIVE DEMO</p>
          <div
            className="mx-auto mt-4 flex min-h-[3.25rem] max-w-[460px] items-center justify-center border px-4 py-3 transition-all duration-300"
            style={{
              borderColor: `color-mix(in srgb, ${bannerColor} 55%, transparent)`,
              background: `color-mix(in srgb, ${bannerColor} 8%, transparent)`,
              boxShadow: `0 0 18px color-mix(in srgb, ${bannerColor} 22%, transparent)`,
            }}
            aria-live="polite"
          >
            <p className="terminal-line" style={{ color: bannerColor }}>
              ▚ {bannerText}
              {phase !== 'idle' && <span className="boot-caret ml-2">▊</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={simulate}
            disabled={phase !== 'idle'}
            className="btn btn-phosphor btn-md mt-5"
          >
            {phase === 'idle' ? 'SIMULATE A DROP' : 'REWEAVING…'}
          </button>
          <p className="micro mt-3 text-ash">
            FIXED {RECONNECT_INTERVAL_MS / 1000}s RETRY · NO EXPONENTIAL BACKOFF · HEARTBEAT EVERY {HEARTBEAT_MS / 1000}s
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S3 · Orb avatars — every light is a wanderer
// ---------------------------------------------------------------------------

const ORB_CALLOUTS = [
  { x: 22, y: 38, name: 'Sigrún', realm: 'MIDGARD', tint: 'var(--realm-muspelheim)', school: 'ELDR' },
  { x: 55, y: 30, name: 'Þórsteinn', realm: 'MIDGARD', tint: 'var(--ice)', school: 'ÍSS' },
  { x: 78, y: 52, name: 'Gunnlǫð', realm: 'MIDGARD', tint: 'var(--galdr)', school: 'ANDI' },
] as const;

const ORB_FACTS = [
  { title: 'ORBS AT DISTANCE', body: `Remote wanderers render as soul-lights beyond ~30m — cheap, readable, beautiful. Up to ${SNAPSHOT_PLAYER_CAP} per snapshot.` },
  { title: 'NAMETAGS AT 25m', body: 'Close in and the orb resolves: name, realm, and rune-school tint from their loadout.' },
  { title: `${RELEVANCE_RADIUS_M}m RELEVANCE`, body: `The shard only sends you players within ${RELEVANCE_RADIUS_M}m. The mist does the rest.` },
  { title: 'SAME WORLD, YOUR SAGA', body: 'Other wanderers share the wilderness, not your quest states. Your threads stay yours.' },
] as const;

function OrbExplainer() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -25% 0px' });
  const [active, setActive] = useState<number | null>(null);

  return (
    <section className="relative border-t border-iron bg-void py-24 md:py-36">
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ READING THE LIGHTS" runes="ᛟᛟᛟ" />
        <h2 className="h2 mt-6">THE ORB PROTOCOL</h2>
        <p className="body mt-5 max-w-reading">
          You will never see another wanderer's face from across a fjord — you
          will see their light. That is by design.
        </p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Annotated artwork */}
          <div
            className={`panel relative overflow-hidden ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
            onMouseLeave={() => setActive(null)}
          >
            <div className="relative aspect-[16/9]">
              <img
                src="/multiplayer-orbs.jpg"
                alt="Soul-orbs of three remote wanderers drifting over a dark Midgard valley"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              {ORB_CALLOUTS.map((orb, i) => {
                const lit = active === i;
                return (
                  <button
                    key={orb.name}
                    type="button"
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${orb.x}%`, top: `${orb.y}%` }}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onClick={() => setActive(lit ? null : i)}
                    aria-label={`Wanderer ${orb.name}, ${orb.school} school`}
                  >
                    <span
                      className="block h-4 w-4 rounded-full transition-all duration-300"
                      style={{
                        background: orb.tint,
                        boxShadow: `0 0 ${lit ? 22 : 12}px ${orb.tint}`,
                        animation: 'glow-breathe 2s ease-in-out infinite',
                        transform: lit ? 'scale(1.5)' : 'scale(1)',
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="chip absolute left-1/2 top-6 -translate-x-1/2 whitespace-nowrap transition-all duration-200"
                      style={{
                        opacity: lit ? 1 : 0,
                        transform: `translateX(-50%) translateY(${lit ? 0 : 4}px)`,
                        color: orb.tint,
                        borderColor: `color-mix(in srgb, ${orb.tint} 50%, transparent)`,
                        pointerEvents: 'none',
                      }}
                    >
                      {orb.name} · {orb.realm} · {orb.school}
                    </span>
                  </button>
                );
              })}
              <p className="micro absolute bottom-3 left-4 text-phosphor-dim">
                FIELD VIEW — HOVER A LIGHT
              </p>
            </div>
          </div>

          {/* Fact rows */}
          <div className="flex flex-col gap-4">
            {ORB_FACTS.map((f, i) => (
              <div
                key={f.title}
                className={`panel p-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <p className="micro text-phosphor">{f.title}</p>
                <p className="body mt-2 text-[0.8125rem] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S4 · World events — seeded demos with live ticking countdowns
// ---------------------------------------------------------------------------

interface DemoEvent {
  id: string;
  kind: 'WORLD BOSS' | 'RESOURCE SURGE' | 'ROAMING PACK';
  rune: string;
  name: string;
  realm: string;
  realmId: string;
  flavor: string;
  /** Seconds from mount until (re)start; wraps by cycleSec. */
  offsetSec: number;
  cycleSec: number;
  img?: string;
}

const DEMO_EVENTS: DemoEvent[] = [
  {
    id: 'ev_bloodmoon', kind: 'WORLD BOSS', rune: 'ᛒ', name: 'BLOOD MOON — LOGI UNCHAINED',
    realm: 'MUSPELHEIM', realmId: 'muspelheim', flavor: 'The flame of the third table walks the ember fields. Shards converge on the arena. +50% XP, +100% danger.',
    offsetSec: 47 * 60 + 12, cycleSec: 3 * 3600, img: '/event-bloodmoon.jpg',
  },
  {
    id: 'ev_surge', kind: 'RESOURCE SURGE', rune: 'ᚱ', name: 'CRYSTAL SURGE IN THE DEEP',
    realm: 'SVARTALFHEIM', realmId: 'svartalfheim', flavor: 'The veins sing. Double crystal yield while the resonance holds.',
    offsetSec: 12 * 60 + 40, cycleSec: 90 * 60,
  },
  {
    id: 'ev_pack', kind: 'ROAMING PACK', rune: 'ᚹ', name: 'THE GREY PACK RUNS',
    realm: 'MIDGARD', realmId: 'midgard', flavor: 'Vargr beyond counting, moving with the mist. Hunt them or hide — both are noticed.',
    offsetSec: 5 * 60 + 20, cycleSec: 45 * 60,
  },
];

function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Ticking countdown per event; wraps into the next cycle when it fires. */
function useEventClocks(events: DemoEvent[]): Record<string, number> {
  const [now, setNow] = useState(() => Date.now());
  const [origin] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    const elapsed = (now - origin) / 1000;
    const out: Record<string, number> = {};
    for (const e of events) {
      const t = (e.offsetSec - elapsed) % e.cycleSec;
      out[e.id] = t < 0 ? t + e.cycleSec : t;
    }
    return out;
  }, [events, now, origin]);
}

function readReminders(): string[] {
  try {
    const raw = localStorage.getItem('coresapian.eventReminders');
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function WorldEvents() {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -25% 0px' });
  const clocks = useEventClocks(DEMO_EVENTS);
  const [reminders, setReminders] = useState<string[]>(() => readReminders());

  const toggleReminder = (id: string) => {
    setReminders((cur) => {
      const next = cur.includes(id) ? cur.filter((r) => r !== id) : [...cur, id];
      try {
        localStorage.setItem('coresapian.eventReminders', JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  return (
    <section className="relative border-t border-iron bg-abyss py-24 md:py-36">
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE SHARD KEEPS ITS OWN WEATHER" runes="ᛒᚱᚹ" />
        <h2 className="h2 mt-6">WORLD EVENTS</h2>
        <p className="body mt-5 max-w-reading">
          Server-seeded, identical on every client: when the blood moon rises,
          every wanderer on the shard sees the same sky. Demo clocks below.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {DEMO_EVENTS.map((ev, i) => {
            const reminding = reminders.includes(ev.id);
            return (
              <article
                key={ev.id}
                className={`panel corner-brackets overflow-hidden ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {ev.img ? (
                  <div className="relative aspect-[16/9] overflow-hidden bg-abyss">
                    <img src={ev.img} alt={`${ev.name} artwork`} loading="lazy" className="h-full w-full object-cover" />
                    {/* Slow red vignette pulse (4s) on the Blood Moon */}
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(214,69,69,0.35))',
                        animation: 'glow-breathe 4s ease-in-out infinite',
                      }}
                      aria-hidden="true"
                    />
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{ background: 'linear-gradient(to top, rgba(8,9,11,0.75), transparent 55%)' }}
                      aria-hidden="true"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center bg-stone/40">
                    <span className="font-runic text-6xl text-iron-2" aria-hidden="true">
                      {ev.rune}
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip chip-version text-phosphor">{ev.kind}</span>
                    <span className="chip chip-version">{ev.realm}</span>
                  </div>
                  <h3 className="font-display text-[1rem] font-bold tracking-[0.08em] text-bone">{ev.name}</h3>
                  <p className="body text-[0.8125rem] leading-relaxed">{ev.flavor}</p>
                  <div className="mt-1 flex items-center justify-between gap-3 border-t border-iron pt-3">
                    <p className="stat text-lg text-phosphor" aria-label={`Starts in ${formatCountdown(clocks[ev.id] ?? 0)}`}>
                      {formatCountdown(clocks[ev.id] ?? 0)}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleReminder(ev.id)}
                      aria-pressed={reminding}
                      className="chip transition-all"
                      style={
                        reminding
                          ? { borderColor: 'var(--soul)', color: 'var(--soul)', background: 'color-mix(in srgb, var(--soul) 10%, transparent)' }
                          : undefined
                      }
                    >
                      {reminding ? '✓ REMINDER SET' : 'SET REMINDER'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Schedule terminal */}
        <div className="terminal mt-8">
          <div className="terminal-titlebar">
            <span>EVENT_SCHEDULE.LOG</span>
            <span className="text-ash">SEED-SYNCED</span>
          </div>
          <div className="terminal-body flex flex-col gap-2">
            {DEMO_EVENTS.map((ev) => (
              <p key={ev.id} className="terminal-line flex flex-wrap justify-between gap-2">
                <Link to={`/realms#${ev.realmId}`} className="transition-colors hover:text-phosphor-hi">
                  &gt; {ev.name} — {ev.realm}
                </Link>
                <span className="text-phosphor">T-{formatCountdown(clocks[ev.id] ?? 0)}</span>
              </p>
            ))}
            <p className="terminal-line">
              <BootType text="> NEXT SYNC ON SNAPSHOT · EVENTS SIMULATE IDENTICALLY FROM SERVER SEED" active={inView} speed={8} />
              <span className="boot-caret ml-2 text-phosphor">▊</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S5 · Netcode & fairness — the honest arithmetic (contracts/netcode.ts)
// ---------------------------------------------------------------------------

const NETCODE_CARDS = [
  {
    rune: 'ᛏ', title: 'THE TICK',
    stats: [`${CLIENT_INPUT_HZ}Hz INPUTS OUT`, `${SERVER_SNAPSHOT_HZ}Hz SNAPSHOTS IN`, `${INTERPOLATION_DELAY_MS}ms INTERP DELAY`, `BUFFER ${SNAPSHOT_BUFFER_SIZE} TICKS`],
    body: 'Your hands send intent fifteen times a second; the shard answers with the world ten times a second. Remote orbs render one tick behind — smooth, never psychic.',
  },
  {
    rune: 'ᛟ', title: 'SERVER AUTHORITY',
    stats: ['CLAIM → VALIDATE → RESOLVE', `+${ATTACK_RANGE_TOLERANCE_M}m RANGE GRACE`, `${ATTACK_COOLDOWN_SLACK_MS}ms COOLDOWN SLACK`, 'REJECTS: RANGE · COOLDOWN · IMPLAUSIBLE'],
    body: 'Clients claim attacks; the shard decides. Damage, loot, XP, and quest state are computed server-side. A modded client is just a loud liar.',
  },
  {
    rune: 'ᚱ', title: 'SPEED LIMITS',
    stats: [`${MAX_SPEED_MPS} m/s HARD CAP`, `${MAX_STEP_PER_INPUT_M}m MAX STEP/INPUT`, 'TELEPORT FLAG FOR PORTALS', 'VIOLATIONS RUBBER-BAND'],
    body: 'Sprint is 7.2 m/s; the cap sits just above with latency tolerance. Faster than that and the shard walks you back, politely, every time.',
  },
  {
    rune: 'ᛝ', title: 'RELEVANCE',
    stats: [`${RELEVANCE_RADIUS_M}m SNAPSHOT RADIUS`, `${SNAPSHOT_PLAYER_CAP} PLAYERS/SNAPSHOT`, `${HEARTBEAT_MS / 1000}s HEARTBEAT`, 'DROP AFTER 3× SILENT'],
    body: 'You only receive what matters: wanderers within the mist-radius, capped per snapshot. Bandwidth stays thin; the fog stays honest.',
  },
] as const;

function NetcodeDiagram() {
  return (
    <div className="panel mt-8 overflow-hidden">
      <svg viewBox="0 0 900 200" className="h-auto w-full" role="img" aria-label="Architecture: clients to shard to realm services">
        {/* nodes */}
        {[
          { x: 110, label: 'CLIENT', rune: 'ᚲ', sub: 'PREDICTS · RENDERS' },
          { x: 450, label: 'SHARD', rune: 'ᛟ', sub: 'VALIDATES · DECIDES' },
          { x: 790, label: 'LEDGER', rune: 'ᚱ', sub: 'QUESTS · LOOT · SAVE' },
        ].map((n) => (
          <g key={n.label}>
            <rect x={n.x - 90} y={70} width={180} height={64} fill="none" stroke="var(--iron-2)" />
            <text x={n.x} y={98} textAnchor="middle" fill="var(--phosphor)" fontSize={13} letterSpacing={2} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              {n.label}
            </text>
            <text x={n.x} y={118} textAnchor="middle" fill="var(--ash)" fontSize={9} letterSpacing={1.5} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              {n.sub}
            </text>
            <text x={n.x} y={58} textAnchor="middle" fill="var(--bone-dim)" fontSize={18} style={{ fontFamily: "'Noto Sans Runic', monospace" }}>
              {n.rune}
            </text>
          </g>
        ))}
        {/* edges */}
        <path id="np-in" d="M200,102 H360" fill="none" stroke="var(--iron-2)" strokeDasharray="4 4" />
        <path id="np-out" d="M540,102 H700" fill="none" stroke="var(--iron-2)" strokeDasharray="4 4" />
        <text x={280} y={92} textAnchor="middle" fill="var(--ash)" fontSize={9} letterSpacing={1.5} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {CLIENT_INPUT_HZ}Hz INPUT →
        </text>
        <text x={620} y={92} textAnchor="middle" fill="var(--ash)" fontSize={9} letterSpacing={1.5} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {SERVER_SNAPSHOT_HZ}Hz SNAPSHOT →
        </text>
        {/* packet dots (SMIL; decorative) */}
        {!reducedMotion() && (
          <>
            <circle r={3} fill="var(--phosphor)">
              <animateMotion dur="1.4s" repeatCount="indefinite" path="M200,102 H360" />
            </circle>
            <circle r={3} fill="var(--soul)">
              <animateMotion dur="1.8s" repeatCount="indefinite" path="M700,102 H540" />
            </circle>
          </>
        )}
      </svg>
      <div className="border-t border-iron px-5 py-3">
        <p className="micro text-ash">ONE AUTHORITATIVE SHARD PER REGION · THE CLIENT IS A WITNESS, NOT A JUDGE</p>
      </div>
    </div>
  );
}

function Netcode() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <section className="relative border-t border-iron bg-void py-24 md:py-36">
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ FAIRNESS, ETCHED IN STONE" runes="ᛏᛟᚱᛝ" />
        <h2 className="h2 mt-6">THE HONEST ARITHMETIC</h2>
        <p className="body mt-5 max-w-reading">
          No pay-to-win, no client-side miracles. These are the protocol's
          locked constants — the same numbers the shard enforces.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
          {NETCODE_CARDS.map((card, i) => (
            <article
              key={card.title}
              className={`panel corner-brackets p-6 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className="font-runic text-2xl text-phosphor" aria-hidden="true">
                  {card.rune}
                </span>
                <h3 className="h3">{card.title}</h3>
              </div>
              <p className="body mt-3 text-[0.8125rem] leading-relaxed">{card.body}</p>
              <ul className="mt-4 flex flex-col gap-1.5 border-t border-iron pt-3">
                {card.stats.map((s) => (
                  <li key={s} className="micro leading-relaxed">
                    <span className="text-phosphor">▸</span> {s}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <NetcodeDiagram />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S6 · Social & regions
// ---------------------------------------------------------------------------

const SOCIAL_ROWS = [
  { rune: 'ᚠ', title: 'PARTIES OF 4', body: 'Shared XP aura (10%), party chat, soul-green nametags with ✦. Small bands, sharp knives.' },
  { rune: 'ᛊ', title: 'EMOTES', body: 'Wave, hail, sit, skjaldmær-salute. Look at a wanderer, press E — the rest is etiquette.' },
  { rune: 'ᚷ', title: 'TRADE', body: 'Face-to-face window, server-escrowed. The ledger holds both halves until both confirm.' },
  { rune: 'ᛗ', title: 'CHAT', body: 'LOCAL / PARTY / REALM channels, profanity-filtered. Names carry Norse glyphs — þ, ð, æ, ø, å welcome.' },
] as const;

function SocialRegions({ status }: { status: ReturnType<typeof useServerStatus> }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  const regions = [
    { code: status.shard, region: 'EU-WEST', home: true },
    { code: status.shard.replace('EU', 'NA'), region: 'NA-EAST', home: false },
    { code: status.shard.replace('EU', 'AS'), region: 'ASIA', home: false },
  ];

  return (
    <section className="relative border-t border-iron bg-abyss py-24 md:py-36">
      <div ref={ref} className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ MANY THREADS, ONE LOOM" runes="ᚠᛊᛗᚷ" />
        <h2 className="h2 mt-6">SOCIAL &amp; REGIONS</h2>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            {SOCIAL_ROWS.map((row, i) => (
              <div
                key={row.title}
                className={`panel flex gap-4 p-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="font-runic mt-0.5 text-2xl text-phosphor" aria-hidden="true">
                  {row.rune}
                </span>
                <div>
                  <h3 className="micro text-bone">{row.title}</h3>
                  <p className="body mt-1.5 text-[0.8125rem] leading-relaxed">{row.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Regions table */}
          <div className={`panel self-start ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}>
            <div className="border-b border-iron px-5 py-4">
              <p className="micro text-phosphor">▚▚ REGION LEDGER</p>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-iron">
                  <th className="micro px-5 py-3 font-normal">SHARD</th>
                  <th className="micro px-5 py-3 font-normal">REGION</th>
                  <th className="micro px-5 py-3 font-normal">TICK</th>
                  <th className="micro px-5 py-3 font-normal">STATE</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr key={r.code} className="border-b border-iron/50 last:border-b-0">
                    <td className="stat px-5 py-3.5 text-phosphor">{r.code}</td>
                    <td className="micro px-5 py-3.5">
                      {r.region}
                      {r.home && <span className="ml-2 text-soul">· YOURS</span>}
                    </td>
                    <td className="micro px-5 py-3.5">{CLIENT_INPUT_HZ}/{SERVER_SNAPSHOT_HZ}Hz</td>
                    <td className="px-5 py-3.5">
                      <StateChip state={status.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="micro border-t border-iron px-5 py-3 text-ash">
              PROTOCOL v1 · NAMES 2–16 GLYPHS · ONE SAVE PER WANDERER, EVERY SHARD
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S7 · CTA with live wanderer count
// ---------------------------------------------------------------------------

function MultiCta({ status }: { status: ReturnType<typeof useServerStatus> }) {
  return (
    <CtaBand
      heading="THE SHARDS ARE WAITING"
      primary={{ to: '/game', label: 'ENTER THE SHARD' }}
      secondary={{ to: '/realms', label: 'CHOOSE A REALM' }}
      live={
        <span className="chip chip-version">
          <span className="chip-dot" style={{ animation: 'pulse-dot 2s infinite' }} />
          {status.playersOnline.toLocaleString()} WANDERERS ON {status.shard} {status.live ? '· LIVE' : '· DEMO'}
        </span>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export default function Multiplayer() {
  useHashScroll();
  // Single shard-status poller for the whole page (5s, graceful mock fallback).
  const status = useServerStatus();
  return (
    <div className="noise-overlay relative">
      <MultiHero status={status} />
      <ConnectionLifecycle />
      <RuneDivider sigil="ᛟ" />
      <OrbExplainer />
      <WorldEvents />
      <RuneDivider sigil="ᚱ" />
      <Netcode />
      <SocialRegions status={status} />
      <MultiCta status={status} />
    </div>
  );
}
