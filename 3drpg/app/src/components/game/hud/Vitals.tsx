// ============================================================================
// CORESAPIAN — Vitals cluster (game.md S3 bottom-left): segmented HEALTH bar
// (shape-coded), smooth STAMINA bar, WYRD bar + 4 school pips, 64px level
// rune badge with conic XP ring. Colorblind-safe: each vital differs by
// shape + icon + position, not hue alone (design.md §10 a11y note).
// Also: low-hp blood vignette + floating xp gain text.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

import { gameEvents } from '@/game/events';
import { useGameStore, useVitals } from '@/game/store';

const HP_SEGMENTS = 10;
const SCHOOL_PIPS = ['ᛁ', 'ᛖ', 'ᚹ', 'ᛃ'] as const;

function SegmentedBar({
  value,
  max,
  segments,
  fillClass,
  flash,
}: {
  value: number;
  max: number;
  segments: number;
  fillClass: string;
  flash: boolean;
}) {
  const filled = Math.round((Math.max(0, value) / Math.max(1, max)) * segments);
  return (
    <div className="flex h-[10px] flex-1 gap-[2px]">
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`flex-1 border border-iron/80 ${
            i < filled ? fillClass : 'bg-abyss/70'
          } ${flash && i === filled ? 'bg-blood-hi' : ''} transition-colors duration-150`}
        />
      ))}
    </div>
  );
}

function SmoothBar({
  value,
  max,
  fillClass,
  height = 6,
}: {
  value: number;
  max: number;
  fillClass: string;
  height?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100));
  return (
    <div className="flex-1 bg-abyss/70" style={{ height }}>
      <div
        className={`h-full ${fillClass} transition-[width] duration-200 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Floating "+N XP" soul text above the cluster; merges into a running total. */
function XpFloaters() {
  const [total, setTotal] = useState(0);
  const [stamp, setStamp] = useState(0);

  useEffect(
    () =>
      gameEvents.on('xp_gain', ({ amount }) => {
        if (amount <= 0) return;
        setTotal((t) => t + amount);
        setStamp(Date.now());
      }),
    [],
  );

  useEffect(() => {
    if (!stamp) return;
    const id = window.setTimeout(() => {
      setTotal(0);
      setStamp(0);
    }, 1800);
    return () => window.clearTimeout(id);
  }, [stamp]);

  if (!stamp || total <= 0) return null;
  return (
    <div
      key={stamp}
      className="stat pointer-events-none absolute -top-7 left-16 text-sm text-soul [animation:motes_1.6s_ease-out_forwards]"
      style={{ ['--mote-y' as string]: '-36px', ['--mote-x' as string]: '8px' }}
    >
      +{total} XP
    </div>
  );
}

export default function Vitals() {
  const vitals = useVitals();
  const level = useGameStore((s) => s.level);
  const xp = useGameStore((s) => s.xp);
  const xpToNext = useGameStore((s) => s.xpToNext);
  const skillPoints = useGameStore((s) => s.skillPoints);

  const [flash, setFlash] = useState(false);
  const prevHp = useRef(vitals.hp);
  useEffect(() => {
    if (vitals.hp < prevHp.current) {
      setFlash(true);
      const id = window.setTimeout(() => setFlash(false), 180);
      prevHp.current = vitals.hp;
      return () => window.clearTimeout(id);
    }
    prevHp.current = vitals.hp;
    return undefined;
  }, [vitals.hp]);

  const hpFrac = vitals.hp / Math.max(1, vitals.maxHp);
  const lowHp = hpFrac <= 0.25;
  const xpFrac = Math.min(1, xp / Math.max(1, xpToNext));

  return (
    <>
      {/* low-hp pulsing blood vignette (game.md S3 screen states) */}
      {lowHp && (
        <div
          className="pointer-events-none fixed inset-0 z-[9] animate-[glow-breathe_1.1s_ease-in-out_infinite]"
          style={{
            boxShadow: 'inset 0 0 140px 40px rgb(var(--blood-rgb) / 0.35)',
          }}
          aria-hidden="true"
        />
      )}

      <div className="panel pointer-events-none relative flex w-[300px] items-center gap-3 px-4 py-3">
        <XpFloaters />

        {/* level rune badge with conic XP ring */}
        <div
          className="relative flex h-16 w-16 flex-none items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(var(--soul) ${Math.round(xpFrac * 360)}deg, var(--iron) 0deg)`,
          }}
          title={`Level ${level} — ${xp}/${xpToNext} XP`}
        >
          <div className="flex h-[52px] w-[52px] flex-col items-center justify-center rounded-full bg-stone">
            <span className="font-display text-xl font-black leading-none text-bone">{level}</span>
            <span className="micro text-[8px] text-ash">LVL</span>
          </div>
          {skillPoints > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 animate-[glow-breathe_1.4s_ease-in-out_infinite] items-center justify-center rounded-full border border-phosphor bg-void text-[10px] text-phosphor">
              {skillPoints}
            </span>
          )}
        </div>

        {/* bars */}
        <div className="flex flex-1 flex-col gap-[7px]">
          {/* HEALTH — segmented, blood */}
          <div className="flex items-center gap-2">
            <span className="font-runic w-4 text-center text-sm leading-none text-blood" title="Health">
              ᚺ
            </span>
            <SegmentedBar
              value={vitals.hp}
              max={vitals.maxHp}
              segments={HP_SEGMENTS}
              fillClass={flash ? 'bg-blood-hi' : 'bg-blood'}
              flash={flash}
            />
            <span className="stat w-12 text-right text-[10px] text-bone">
              {Math.ceil(vitals.hp)}/{vitals.maxHp}
            </span>
          </div>
          {/* STAMINA — smooth thin, bone/amber */}
          <div className="flex items-center gap-2">
            <span className="font-runic w-4 text-center text-sm leading-none text-phosphor" title="Stamina">
              ᛊ
            </span>
            <SmoothBar value={vitals.stamina} max={vitals.maxStamina} fillClass="bg-phosphor/90" />
            <span className="stat w-12 text-right text-[10px] text-bone-dim">
              {Math.ceil(vitals.stamina)}
            </span>
          </div>
          {/* WYRD — smooth, galdr, + school pips */}
          <div className="flex items-center gap-2">
            <span className="font-runic w-4 text-center text-sm leading-none text-galdr" title="Wyrd">
              ᚱ
            </span>
            <SmoothBar value={vitals.wyrd} max={vitals.maxWyrd} fillClass="bg-galdr/90" />
            <span className="stat w-12 text-right text-[10px] text-bone-dim">
              {Math.ceil(vitals.wyrd)}
            </span>
            <span className="font-runic flex gap-[3px] text-[11px] leading-none text-galdr/70">
              {SCHOOL_PIPS.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
