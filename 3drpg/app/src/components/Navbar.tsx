// ============================================================================
// CORESAPIAN — src/components/Navbar.tsx (design.md §6.1)
// Fixed 64px top nav: rune-mark + wordmark, center links, server-status chip,
// PLAY button, mobile drawer. Renders on all pages except /game (see Layout).
// ============================================================================

import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';

import { useServerStatus } from '@/lib/useServerStatus';
import { scrambleText } from '@/lib/useGlyphScramble';

const LINKS = [
  { to: '/realms', label: 'REALMS', rune: 'ᚱ' },
  { to: '/progression', label: 'PROGRESSION', rune: 'ᚦ' },
  { to: '/lore', label: 'LORE', rune: 'ᛚ' },
  { to: '/multiplayer', label: 'MULTIPLAYER', rune: 'ᛗ' },
] as const;

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

function StatusChip() {
  const status = useServerStatus();
  const ok = status.state === 'connected';
  return (
    <span
      className={ok ? 'chip' : 'chip chip-error'}
      title={
        ok
          ? `SHARD ${status.shard} · ${status.latencyMs}ms · ${status.playersOnline.toLocaleString()} WANDERERS${status.live ? '' : ' · CACHED'}`
          : 'RECONNECTING TO THE BIFRÖST…'
      }
    >
      <span className="chip-dot" />
      <span className={ok ? '' : 'anim-flicker'}>
        {ok ? `${status.latencyMs}ms · ${status.shard}` : 'RECONNECTING…'}
      </span>
    </span>
  );
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wordmark, setWordmark] = useState('CORESAPIAN');
  const location = useLocation();

  // Close the drawer on route change (state-adjusted-during-render pattern).
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setDrawerOpen(false);
  }

  // Shrink on scroll (>40px), 64px → 56px.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Esc closes the drawer; body scroll locks while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <>
      <motion.header
        initial={{ y: '-100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: EASE_EXPO }}
        className="fixed inset-x-0 top-0 z-50 border-b border-iron"
        style={{
          background: 'color-mix(in srgb, var(--void) 82%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div
          className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 transition-[height] duration-200 sm:px-6"
          style={{ height: scrolled ? 56 : 64 }}
        >
          {/* Left: rune mark + wordmark */}
          <Link
            to="/"
            className="group flex items-center gap-3"
            onMouseEnter={() => scrambleText('CORESAPIAN', setWordmark)}
            aria-label="CORESAPIAN — home"
          >
            <img src="/rune-mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px]" />
            <span className="font-display text-[0.95rem] font-bold tracking-[0.2em] text-bone transition-colors group-hover:text-phosphor">
              {wordmark}
            </span>
          </Link>

          {/* Center links (desktop) */}
          <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
            {LINKS.map((link, i) => (
              <motion.span
                key={link.to}
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.06, duration: 0.5, ease: EASE_EXPO }}
              >
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    `nav-link kicker relative py-1 transition-colors duration-150 ${
                      isActive ? 'text-phosphor' : 'text-bone-dim hover:text-phosphor'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              </motion.span>
            ))}
          </nav>

          {/* Right: status + PLAY + hamburger */}
          <div className="flex items-center gap-3">
            <div className="hidden md:block">
              <StatusChip />
            </div>
            <Link to="/game" className="btn btn-phosphor btn-sm hidden sm:inline-flex">
              PLAY
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm lg:hidden"
              aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              {drawerOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {/* Rune tick strip along the bottom border */}
        <div className="rune-ticks absolute inset-x-0 bottom-0 translate-y-1/2 px-4 opacity-[0.24]" aria-hidden="true">
          ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ
        </div>
      </motion.header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center lg:hidden"
            style={{ background: 'color-mix(in srgb, var(--void) 96%, transparent)' }}
          >
            <img
              src="/rune-circle.svg"
              alt=""
              className="anim-spin-60 pointer-events-none absolute h-[80vmin] w-[80vmin] opacity-15"
              aria-hidden="true"
            />
            <nav className="relative flex flex-col items-center gap-7" aria-label="Mobile">
              {LINKS.map((link, i) => (
                <motion.div
                  key={link.to}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.07 * i, duration: 0.5, ease: EASE_EXPO }}
                >
                  <NavLink
                    to={link.to}
                    className={({ isActive }) =>
                      `flex items-baseline gap-4 font-display text-3xl font-bold tracking-[0.14em] ${
                        isActive ? 'text-phosphor' : 'text-bone'
                      }`
                    }
                  >
                    <span className="font-runic text-xl text-phosphor/70">{link.rune}</span>
                    {link.label}
                  </NavLink>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.07 * LINKS.length, duration: 0.5, ease: EASE_EXPO }}
              >
                <Link to="/game" className="btn btn-phosphor btn-lg mt-2">
                  PLAY
                </Link>
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
