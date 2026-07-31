// ============================================================================
// CORESAPIAN — Center-screen splashes (game.md S12 vocabulary):
//  • Realm title card on realm_change (rune + Uncial name + epithet, 3s)
//  • Level-up flash (level_up event)
//  • World-event announcement banner (world_event events)
// ============================================================================

import { useEffect, useState } from 'react';

import { gameEvents } from '@/game/events';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import { REALMS } from '../../../../contracts/realms';
import type { RealmId } from '../../../../contracts/types';
import { REALM_EPITHETS, REALM_RUNES } from '../realmState';
import { useUiAux } from '../uiAux';

// ---------------------------------------------------------------------------
// Realm title card
// ---------------------------------------------------------------------------

function RealmCard({ realm, onDone }: { realm: RealmId; onDone: () => void }) {
  const cfg = REALMS[realm];
  const name = useGlyphScramble(cfg.displayName.toUpperCase());

  useEffect(() => {
    const id = window.setTimeout(onDone, 3000);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex flex-col items-center [animation:rise_500ms_ease-out]">
      <span
        className="font-runic text-7xl leading-none"
        style={{ color: cfg.palette.accent, textShadow: `0 0 28px ${cfg.palette.accent}` }}
      >
        {REALM_RUNES[realm]}
      </span>
      <h2 className="font-display mt-3 text-3xl font-black uppercase tracking-[0.22em] text-bone">
        {name}
      </h2>
      <p className="font-norse mt-2 text-base text-bone-dim">{REALM_EPITHETS[realm]}</p>
      <div className="rune-divider mt-4 w-64" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level-up flash
// ---------------------------------------------------------------------------

function LevelUpFlash({ level, onDone }: { level: number; onDone: () => void }) {
  const text = useGlyphScramble(`LEVEL ${level}`);
  useEffect(() => {
    const id = window.setTimeout(onDone, 2500);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex flex-col items-center [animation:rise_400ms_ease-out]">
      <span className="font-runic text-2xl text-soul">ᛝ</span>
      <span className="font-display mt-1 text-2xl font-black uppercase tracking-[0.2em] text-phosphor">
        {text}
      </span>
      <span className="micro mt-2 text-bone-dim">+1 SKILL RUNE — PRESS K</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// World-event announcement banner
// ---------------------------------------------------------------------------

function WorldEventBanner() {
  const flash = useUiAux((s) => s.eventFlash);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!flash) return;
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  if (!flash || !visible) return null;
  const boss = flash.kind === 'world_boss';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex justify-center">
      <div
        className={`panel anim-flicker px-6 py-2 text-center ${
          boss ? 'border-blood/60' : 'border-galdr/50'
        }`}
      >
        <span className={`micro ${boss ? 'text-blood-hi' : 'text-galdr'}`}>
          {boss ? 'ᛒ ' : 'ᛗ '}
          {flash.text}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container — subscribes to bus events, keeps one splash mounted at a time.
// ---------------------------------------------------------------------------

export default function RealmTitleCard() {
  const [realmSplash, setRealmSplash] = useState<RealmId | null>(null);
  const [levelSplash, setLevelSplash] = useState<number | null>(null);

  useEffect(
    () =>
      gameEvents.on('realm_change', ({ to }) => {
        setRealmSplash(to);
      }),
    [],
  );
  useEffect(
    () =>
      gameEvents.on('level_up', ({ level }) => {
        setLevelSplash(level);
      }),
    [],
  );

  return (
    <>
      <WorldEventBanner />
      {realmSplash && <RealmCard realm={realmSplash} onDone={() => setRealmSplash(null)} />}
      {levelSplash !== null && (
        <LevelUpFlash level={levelSplash} onDone={() => setLevelSplash(null)} />
      )}
    </>
  );
}
