// ============================================================================
// CORESAPIAN — Death screen (game.md S12, gdd §11.2, addendum §5).
// Grayscale slow fade, "Your thread is cut." + killer credit, Respawn button
// + 5s auto countdown → setDead(false). The engine emits player_respawn.
// ============================================================================

import { useEffect, useState } from 'react';

import { useGameStore } from '@/game/store';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import { useUiAux } from './uiAux';

const RESPAWN_MS = 5000;

export default function DeathScreen() {
  const dead = useGameStore((s) => s.dead);
  const setDead = useGameStore((s) => s.setDead);
  const lastKiller = useUiAux((s) => s.lastKiller);

  const [visible, setVisible] = useState(false);
  const [left, setLeft] = useState(RESPAWN_MS);
  const title = useGlyphScramble('YOUR THREAD IS CUT', dead);

  useEffect(() => {
    if (!dead) return;
    setLeft(RESPAWN_MS);
    const fade = window.setTimeout(() => setVisible(true), 60);
    const t0 = Date.now();
    const tick = window.setInterval(() => {
      setLeft(Math.max(0, RESPAWN_MS - (Date.now() - t0)));
    }, 100);
    const respawn = window.setTimeout(() => useGameStore.getState().setDead(false), RESPAWN_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearInterval(tick);
      window.clearTimeout(respawn);
      setVisible(false);
    };
  }, [dead]);

  if (!dead) return null;

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-void/70 transition-opacity duration-1000 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* desaturating veil — the world greys out behind it */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgb(var(--void-rgb) / 0.85) 100%)',
          backdropFilter: 'grayscale(0.9) brightness(0.7)',
        }}
      />

      <div className="relative flex flex-col items-center">
        <span className="font-runic text-4xl tracking-[0.3em] text-blood">ᚦᚱᚨᚹᚦ</span>
        <h2 className="font-display mt-4 text-3xl font-black uppercase tracking-[0.2em] text-bone">
          {title}
        </h2>
        <p className="font-norse mt-3 text-base text-bone-dim">
          Slain by {lastKiller ?? 'the Nine Realms'}.
        </p>

        <button
          type="button"
          onClick={() => setDead(false)}
          className="btn btn-phosphor btn-md mt-8"
        >
          ᚦ RESPAWN ({Math.ceil(left / 1000)})
        </button>
        <p className="micro mt-3 text-ash">THE THREAD PULLS YOU BACK IN {Math.ceil(left / 1000)}…</p>
      </div>
    </div>
  );
}
