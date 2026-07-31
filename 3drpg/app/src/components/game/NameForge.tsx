// ============================================================================
// CORESAPIAN — NameForge: first-visit display-name runestone (game.md S1.6).
// Shown BEFORE the engine starts when no `coresapian.name` is persisted.
// 2–16 chars per contracts/netcode NAME_PATTERN; stored via setDisplayName.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { NAME_PATTERN, NAME_MIN_LENGTH, NAME_MAX_LENGTH } from '../../../contracts/netcode';
import { useGameStore } from '@/game/store';
import { useGlyphScramble } from '@/lib/useGlyphScramble';

interface NameForgeProps {
  onCarved: () => void;
}

export default function NameForge({ onCarved }: NameForgeProps) {
  const setDisplayName = useGameStore((s) => s.setDisplayName);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = useGlyphScramble('THE STONE ASKS YOUR NAME');

  const trimmed = value.trim();
  const valid = NAME_PATTERN.test(trimmed);
  const showError = touched && !valid && trimmed.length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setDisplayName(trimmed);
    onCarved();
  };

  return (
    <div
      className="absolute inset-0 z-[70] flex items-center justify-center bg-void"
      role="dialog"
      aria-modal="true"
      aria-label="Carve your name"
    >
      {/* realm-tinted haze + rune circle watermark */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgb(var(--phosphor-rgb) / 0.07), transparent 60%)',
        }}
      />
      <img
        src="/rune-circle.svg"
        alt=""
        aria-hidden="true"
        className="anim-spin-90 pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 opacity-[0.08]"
      />

      <div className="panel relative w-[min(92vw,480px)] px-8 py-10 text-center">
        <img src="/rune-mark.svg" alt="" aria-hidden="true" className="mx-auto h-20 w-20" />

        <p className="kicker mt-6">CORESAPIAN</p>
        <h1 className="font-display mt-3 text-xl font-black uppercase tracking-[0.14em] text-bone">
          {title}
        </h1>
        <p className="font-norse mt-3 text-base text-bone-dim">
          Every wanderer is carved into the ledger of the Nine.
        </p>

        <form onSubmit={submit} className="mt-8">
          <div className="border border-iron bg-abyss/80 px-4 py-3 focus-within:border-phosphor">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={NAME_MAX_LENGTH}
              spellCheck={false}
              autoComplete="off"
              placeholder="carve your name…"
              aria-label="Display name"
              className="w-full bg-transparent text-center font-mono text-lg tracking-[0.2em] text-phosphor caret-[#FFB64A] outline-none placeholder:text-ash"
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className={showError ? 'micro text-blood-hi' : 'micro'}>
              {showError
                ? 'THE STONE REJECTS THIS CARVING'
                : `${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} RUNES · A–Z 0–9 — _ Þ Ð Æ Ø Å`}
            </span>
            <span className="stat micro text-ash">{trimmed.length}/{NAME_MAX_LENGTH}</span>
          </div>

          <button
            type="submit"
            disabled={!valid}
            className="btn btn-phosphor btn-md mt-6 w-full disabled:cursor-not-allowed disabled:opacity-40"
          >
            ᚲ CARVE
          </button>
        </form>

        <p className="micro mt-6 text-ash">
          NO OATH REQUIRED · YOUR NAME STAYS ON THIS STONE (LOCAL LEDGER)
        </p>
      </div>
    </div>
  );
}
