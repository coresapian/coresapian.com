// ============================================================================
// CORESAPIAN — src/components/Footer.tsx (design.md §6.2)
// Rune-divider crest, 3 columns (brand / THE NINE / THE SAGA), shard status
// row with build stamp + CRT intensity control, copyright line.
// ============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { BUILD_VERSION } from '@/lib/buildInfo';
import { useInView } from '@/lib/useInView';

const REALMS = [
  { id: 'midgard', name: 'MIDGARD', rune: 'ᛗ', accent: 'var(--realm-midgard)' },
  { id: 'jotunheim', name: 'JÖTUNHEIM', rune: 'ᛁ', accent: 'var(--realm-jotunheim)' },
  { id: 'niflheim', name: 'NIFLHEIM', rune: 'ᚾ', accent: 'var(--realm-niflheim)' },
  { id: 'muspelheim', name: 'MUSPELHEIM', rune: 'ᛋ', accent: 'var(--realm-muspelheim)' },
  { id: 'alfheim', name: 'ALFHEIM', rune: 'ᚨ', accent: 'var(--realm-alfheim)' },
  { id: 'svartalfheim', name: 'SVARTALFHEIM', rune: 'ᛊ', accent: 'var(--realm-svartalfheim)' },
  { id: 'vanaheim', name: 'VANAHEIM', rune: 'ᚹ', accent: 'var(--realm-vanaheim)' },
  { id: 'asgard', name: 'ASGARD', rune: 'ᛖ', accent: 'var(--realm-asgard)' },
  { id: 'helheim', name: 'HELHEIM', rune: 'ᚺ', accent: 'var(--realm-helheim)' },
] as const;

const SAGA_LINKS = [
  { to: '/progression', label: 'PROGRESSION' },
  { to: '/lore', label: 'LORE' },
  { to: '/multiplayer', label: 'MULTIPLAYER' },
  { to: '/game', label: 'PLAY' },
] as const;

const SHARDS = [
  { name: 'BIFRÖST-EU', baseMs: 42 },
  { name: 'BIFRÖST-NA', baseMs: 87 },
  { name: 'BIFRÖST-ASIA', baseMs: 133 },
] as const;

type CrtIntensity = 'off' | 'low' | 'high';
const CRT_ORDER: CrtIntensity[] = ['off', 'low', 'high'];
const CRT_KEY = 'coresapian.crt';

function readCrt(): CrtIntensity {
  try {
    const v = localStorage.getItem(CRT_KEY);
    if (v === 'off' || v === 'low' || v === 'high') return v;
  } catch {
    /* noop */
  }
  return 'low';
}

/* Minimal etched brand icons (no external icon dep for socials) */
function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M7 5h10l3 5v7l-3 2-1.5-2.5M7 5 4 10v7l3 2 1.5-2.5M7 5c2 1 8 1 10 0" />
      <circle cx="9.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 4l16 16M20 4L4 20" />
    </svg>
  );
}
function YoutubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M10.5 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function Footer() {
  const { ref, inView } = useInView<HTMLElement>();
  const [pings, setPings] = useState<number[]>(SHARDS.map((s) => s.baseMs));
  const [crt, setCrt] = useState<CrtIntensity>(() => readCrt());

  // Mock shard pings drift with a phosphor-flicker refresh every 5s.
  useEffect(() => {
    const id = window.setInterval(() => {
      setPings(SHARDS.map((s) => Math.max(12, Math.round(s.baseMs + (Math.random() * 18 - 9)))));
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const cycleCrt = () => {
    const next = CRT_ORDER[(CRT_ORDER.indexOf(crt) + 1) % CRT_ORDER.length]!;
    setCrt(next);
    try {
      localStorage.setItem(CRT_KEY, next);
    } catch {
      /* noop */
    }
    window.dispatchEvent(new CustomEvent('coresapian:crt', { detail: next }));
  };

  return (
    <footer ref={ref} className="relative border-t border-iron bg-abyss">
      <div className="mx-auto max-w-content px-4 pb-10 pt-14 sm:px-6">
        <div className="rune-divider mb-14" aria-hidden="true">
          <span>ᛟ</span>
        </div>

        <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
          {/* Brand */}
          <div
            className={inView ? 'reveal-rise is-revealed' : 'reveal-rise'}
            style={{ animationDelay: '0ms' }}
          >
            <div className="flex items-center gap-3">
              <img src="/rune-mark.svg" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
              <span className="font-display text-sm font-bold tracking-[0.2em] text-bone">CORESAPIAN</span>
            </div>
            <p className="body mt-5 max-w-xs text-[0.8125rem]">
              A first-person saga of the nine realms. Etched in runes, forged in
              the nine — always online, playable in your browser.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <a href="https://discord.com" target="_blank" rel="noreferrer" className="btn btn-rune corner-brackets" aria-label="Discord">
                <DiscordIcon />
              </a>
              <a href="https://x.com" target="_blank" rel="noreferrer" className="btn btn-rune corner-brackets" aria-label="X">
                <XIcon />
              </a>
              <a href="https://youtube.com" target="_blank" rel="noreferrer" className="btn btn-rune corner-brackets" aria-label="YouTube">
                <YoutubeIcon />
              </a>
            </div>
          </div>

          {/* THE NINE */}
          <nav
            className={inView ? 'reveal-rise is-revealed' : 'reveal-rise'}
            style={{ animationDelay: '100ms' }}
            aria-label="The Nine Realms"
          >
            <h3 className="kicker mb-5">THE NINE</h3>
            <ul className="grid grid-cols-1 gap-2.5">
              {REALMS.map((realm) => (
                <li key={realm.id}>
                  <Link
                    to={`/realms#${realm.id}`}
                    className="group flex items-center gap-3 text-[0.75rem] tracking-[0.18em] text-bone-dim transition-colors duration-150 hover:text-bone"
                    style={{ ['--accent' as string]: realm.accent }}
                  >
                    <span className="font-runic text-sm text-ash transition-colors duration-150 group-hover:text-[var(--accent)]">
                      {realm.rune}
                    </span>
                    <span className="group-hover:text-[var(--accent)]">{realm.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* THE SAGA */}
          <nav
            className={inView ? 'reveal-rise is-revealed' : 'reveal-rise'}
            style={{ animationDelay: '200ms' }}
            aria-label="The Saga"
          >
            <h3 className="kicker mb-5">THE SAGA</h3>
            <ul className="flex flex-col gap-2.5">
              {SAGA_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-[0.75rem] tracking-[0.18em] text-bone-dim transition-colors duration-150 hover:text-phosphor"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link to="/game" className="btn btn-ghost btn-sm corner-brackets">
                ENTER MIDGARD
              </Link>
            </div>
          </nav>
        </div>

        {/* Status row */}
        <div className="mt-14 flex flex-wrap items-center gap-2.5 border-t border-iron pt-6">
          {SHARDS.map((shard, i) => (
            <span key={shard.name} className="chip anim-flicker" title={`${shard.name} shard ping`}>
              <span className="chip-dot" />
              {shard.name} · {pings[i]}ms
            </span>
          ))}
          <span className="chip chip-version" title="Build stamp">
            v{BUILD_VERSION}
          </span>
          <span className="chip">WEBGL2 · WS:3000</span>
          <button
            type="button"
            className="chip corner-brackets transition-colors hover:text-phosphor"
            onClick={cycleCrt}
            title="CRT overlay intensity (Off / Low / High)"
          >
            CRT: {crt.toUpperCase()}
          </button>
          <span className="micro ml-auto">© 2025 FORGED UNDER YGGDRASIL</span>
        </div>
      </div>
    </footer>
  );
}
