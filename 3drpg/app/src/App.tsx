// ============================================================================
// CORESAPIAN — src/App.tsx
// Router root. Nested-route (layout-route) pattern: Layout renders <Outlet/>,
// App provides nested <Route>s (react-dev contract, pattern B).
//
// Route-based code splitting: every page except Home is lazy-loaded so the
// landing page ships minimal JS. The /game route pulls in the entire engine
// (three.js + 6 subsystems) only when the player actually enters the game.
// ============================================================================

import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import Layout, { CrtOverlay } from '@/components/Layout';
import Home from '@/pages/Home';

const Realms = lazy(() => import('@/pages/Realms'));
const Progression = lazy(() => import('@/pages/Progression'));
const Lore = lazy(() => import('@/pages/Lore'));
const Multiplayer = lazy(() => import('@/pages/Multiplayer'));
const Game = lazy(() => import('@/pages/Game'));

/** Minimal fallback while a lazy chunk loads (kept inline — itself <1KB). */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <span className="font-runic animate-pulse text-2xl text-phosphor">ᛟ</span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Global CRT overlay — mounted once, above everything except cursor. */}
      <CrtOverlay />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route
            path="realms"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Realms />
              </Suspense>
            }
          />
          <Route
            path="progression"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Progression />
              </Suspense>
            }
          />
          <Route
            path="lore"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Lore />
              </Suspense>
            }
          />
          <Route
            path="multiplayer"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Multiplayer />
              </Suspense>
            }
          />
          <Route
            path="game"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Game />
              </Suspense>
            }
          />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
