// ============================================================================
// CORESAPIAN — /game page (game.md S0–S14, integration-addendum §3/§4).
//
// Fullscreen fixed canvas + UI overlay. Boot flow:
//   1. First visit (no `coresapian.name` persisted): runic name-forge modal
//      (2–16 chars per contracts NAME_PATTERN) — the engine does NOT start
//      until a name is carved.
//   2. useEffect → bootstrapGame({canvas, store, events}) (addendum §3;
//      engineBridge prefers `bootstrapGame` and falls back to `new Game(opts)`)
//      → g.start() → g.dispose() on unmount (HMR-safe).
//   3. BootScreen drives the loading overlay from g.loading/onLoadingChange.
//
// Layering: canvas z-1 < HUD z-10 < banner/hints z-20/25 < dialogue/shop
// z-30 < menus z-40 < death z-50 < boot z-60 < name-forge z-70.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

import { gameEvents } from '@/game/events';
import { useGameStore } from '@/game/store';
import { hasCrtPreference, writeCrt } from '@/components/game/crt';
import BootScreen from '@/components/game/BootScreen';
import ConnectionBanner from '@/components/game/ConnectionBanner';
import ControlsHint from '@/components/game/ControlsHint';
import DeathScreen from '@/components/game/DeathScreen';
import DialoguePanel from '@/components/game/DialoguePanel';
import NameForge from '@/components/game/NameForge';
import ShopPanel from '@/components/game/ShopPanel';
import type { GameHandle } from '@/components/game/engineBridge';
import { createGame, GameHandleContext } from '@/components/game/engineBridge';
import Hud from '@/components/game/hud/Hud';
import MenuRoot from '@/components/game/menus/MenuRoot';
import { useMenuKeys } from '@/components/game/menus/useMenuKeys';

/** True when the player has already carved a name on this stone. */
function hasCarvedName(): boolean {
  try {
    return !!localStorage.getItem('coresapian.name');
  } catch {
    return false;
  }
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nameReady, setNameReady] = useState<boolean>(hasCarvedName);
  const [game, setGame] = useState<GameHandle | null>(null);

  const activeMenu = useGameStore((s) => s.activeMenu);
  const dead = useGameStore((s) => s.dead);

  // ui owns Tab/K/J/M/Esc window keydown (addendum §4) — after the name gate.
  useMenuKeys(nameReady);

  // game.md S11: the CRT veil applies at High intensity by default here
  // (user-tunable in Settings). Only applies when no preference exists yet.
  useEffect(() => {
    if (!hasCrtPreference()) writeCrt('high');
  }, []);

  useEffect(() => {
    if (!nameReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = createGame({ canvas, store: useGameStore, events: gameEvents });
    setGame(g);
    g.start();
    return () => {
      g.dispose();
      setGame(null);
    };
  }, [nameReady]);

  // Pause/menu grammar: the world blurs 8px + darkens behind menus (game.md S5).
  const worldDimmed = activeMenu !== 'none' || dead;

  return (
    <div className="fixed inset-0 overflow-hidden bg-void">
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
          filter: worldDimmed ? 'blur(8px) brightness(0.45)' : 'none',
          transition: 'filter 300ms ease',
        }}
      />

      <GameHandleContext.Provider value={game}>
        <Hud />
        <ConnectionBanner />
        <ControlsHint />
        <DialoguePanel />
        <ShopPanel />
        <MenuRoot />
        <DeathScreen />
        <BootScreen />
      </GameHandleContext.Provider>

      {!nameReady && <NameForge onCarved={() => setNameReady(true)} />}
    </div>
  );
}
