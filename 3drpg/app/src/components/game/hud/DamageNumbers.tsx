// ============================================================================
// CORESAPIAN — Damage numbers (combat-ai → damage_number events; game.md S3).
// World→screen projection via the engine helper game.projectToScreen(v)
// (addendum-consistent; engineBridge falls back near the crosshair if the
// engine omits it). Kills add a blood rune flare.
// ============================================================================

import { useEffect, useState } from 'react';

import { gameEvents } from '@/game/events';
import type { DamageSchool } from '../../../../contracts/types';
import { projectWorldToScreen, useGameHandle } from '../engineBridge';

const LIFE_MS = 900;
const MAX_LIVE = 24;

const SCHOOL_TEXT: Record<DamageSchool, string> = {
  physical: 'text-bone',
  fire: 'text-phosphor',
  ice: 'text-ice',
  storm: 'text-galdr',
  spirit: 'text-soul',
};

interface Floater {
  id: number;
  x: number;
  y: number;
  amount: number;
  isCrit: boolean;
  killed: boolean;
  school: DamageSchool;
  moteX: string;
}

let nextId = 1;

export default function DamageNumbers() {
  const game = useGameHandle();
  const [floaters, setFloaters] = useState<Floater[]>([]);

  useEffect(
    () =>
      gameEvents.on('damage_number', ({ amount, isCrit, killed, position, school }) => {
        const p = projectWorldToScreen(game, position);
        if (!p.visible) return;
        const floater: Floater = {
          id: nextId++,
          x: p.x,
          y: p.y,
          amount: Math.round(amount),
          isCrit,
          killed,
          school,
          moteX: `${Math.round((Math.random() - 0.5) * 36)}px`,
        };
        setFloaters((list) => [...list.slice(-(MAX_LIVE - 1)), floater]);
        window.setTimeout(() => {
          setFloaters((list) => list.filter((f) => f.id !== floater.id));
        }, LIFE_MS);
      }),
    [game],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[15] overflow-hidden" aria-hidden="true">
      {floaters.map((f) => (
        <div
          key={f.id}
          className={`stat absolute -translate-x-1/2 -translate-y-full [animation:motes_0.9s_ease-out_forwards] ${
            f.isCrit ? 'text-lg text-blood-hi' : `text-sm ${SCHOOL_TEXT[f.school]}`
          }`}
          style={{
            left: f.x,
            top: f.y,
            ['--mote-x' as string]: f.moteX,
            ['--mote-y' as string]: '-72px',
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
          }}
        >
          {f.amount}
          {f.isCrit && <span className="ml-0.5 text-[10px]">CRIT</span>}
          {f.killed && <span className="font-runic ml-1 text-blood">ᚦ</span>}
        </div>
      ))}
    </div>
  );
}
