// ============================================================================
// CORESAPIAN — src/components/Layout.tsx
// Shared chrome: Navbar + Outlet + Footer + Lenis smooth scroll. The /game
// route renders WITHOUT navbar/footer/Lenis (fullscreen engine surface).
// Also exports the global CrtOverlay (mounted once in App root).
// ============================================================================

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import Lenis from 'lenis';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import gsap from 'gsap';

import Navbar from './Navbar';
import Footer from './Footer';

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------------------
// CRT overlay (design.md §4): scanlines + vignette + flicker. Intensity
// Off/Low/High persisted to localStorage `coresapian.crt`. Pointer-events
// none; disabled entirely under prefers-reduced-motion.
// ---------------------------------------------------------------------------

type CrtIntensity = 'off' | 'low' | 'high';
const CRT_KEY = 'coresapian.crt';

function readCrtIntensity(): CrtIntensity {
  try {
    const v = localStorage.getItem(CRT_KEY);
    if (v === 'off' || v === 'low' || v === 'high') return v;
  } catch {
    /* noop */
  }
  return 'low';
}

export function CrtOverlay() {
  const [intensity, setIntensity] = useState<CrtIntensity>(() => readCrtIntensity());
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onMotion);

    const onCrt = (e: Event) => {
      const detail = (e as CustomEvent<CrtIntensity>).detail;
      if (detail === 'off' || detail === 'low' || detail === 'high') setIntensity(detail);
    };
    window.addEventListener('coresapian:crt', onCrt);
    return () => {
      mq.removeEventListener('change', onMotion);
      window.removeEventListener('coresapian:crt', onCrt);
    };
  }, []);

  if (reducedMotion || intensity === 'off') return null;

  return (
    <div className="crt-overlay" data-intensity={intensity} aria-hidden="true">
      <div className="crt-scanlines" />
      <div className="crt-vignette" />
      <div className="crt-flicker-layer" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lenis smooth scroll (design.md §5.1) — disabled for prefers-reduced-motion.
// ---------------------------------------------------------------------------

function LenisRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1.0 });
    lenis.on('scroll', ScrollTrigger.update);

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export default function Layout() {
  const location = useLocation();
  const isGame = location.pathname === '/game' || location.pathname.startsWith('/game/');

  // Scroll restoration; honor hash targets (e.g. /realms#midgard).
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        el.scrollIntoView({ block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.hash]);

  // /game: bare fullscreen engine surface — no chrome, no Lenis.
  if (isGame) {
    return <Outlet />;
  }

  return (
    <LenisRoot>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[9999] focus:bg-stone focus:px-4 focus:py-2 focus:text-phosphor"
      >
        SKIP TO CONTENT
      </a>
      <Navbar />
      {/* Layout owns the fixed-nav offset (react-dev contract); full-bleed
          heroes opt out inside the page with -mt-16. */}
      <main id="content" className="min-h-[100dvh] pt-16">
        <Outlet />
      </main>
      <Footer />
    </LenisRoot>
  );
}
