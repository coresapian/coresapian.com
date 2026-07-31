// ============================================================================
// CORESAPIAN — Boot & loading screen, "Waking the Waystone" (game.md S1,
// gdd §11.1, addendum §3).
//
// Driven by game.loading / game.onLoadingChange when the engine exposes
// them; a cosmetic simulation covers the case where the engine omits
// them. Fades out when loading.done (stage 3 complete; stage 4 = WS hello,
// non-blocking).
// ============================================================================

import { useEffect, useState } from 'react';

import { BUILD_VERSION } from '@/lib/buildInfo';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import type { GameHandle, LoadingState } from './engineBridge';
import { readLoading, subscribeLoading, useGameHandle } from './engineBridge';
import { useUiAux } from './uiAux';

// gdd §11.1 stage labels (fallback when the engine does not supply its own).
const STAGE_LABELS = [
  'forging miðgarðr…',
  'kindling sky and fog…',
  'waking spirits…',
  'opening bifröst…',
] as const;

const STATIC_LINES = [
  'waking the waystone',
  'binding yggdrasil.root',
  'WebGL2 context',
  'compiling realm shaders [9/9]',
  'loading hacksilver ledger',
  'summoning ambient choir',
] as const;

const TIPS = [
  'Hold BLOCK just before a blow lands to parry.',
  'Frost vargr hunt in packs. Listen.',
  'Every realm grants an ability. Earn them.',
  'The Norns see every thread but yours.',
  'Steel is folded with ash and patience. So are you.',
];

const SIM_DURATION_MS = 2600;

// ---------------------------------------------------------------------------
// Loading data: real engine state wins; simulation otherwise.
// ---------------------------------------------------------------------------

function useLoading(game: GameHandle | null): LoadingState {
  const engineDriven = !!game && typeof game.onLoadingChange === 'function';
  const [engine, setEngine] = useState<LoadingState | null>(() => readLoading(game));
  const [sim, setSim] = useState<LoadingState>({
    stage: 1,
    label: STAGE_LABELS[0],
    progress: 0,
    done: false,
  });

  useEffect(() => {
    setEngine(readLoading(game));
    return subscribeLoading(game, setEngine);
  }, [game]);

  useEffect(() => {
    if (engineDriven) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / SIM_DURATION_MS);
      const stage = (p < 0.4 ? 1 : p < 0.6 ? 2 : p < 0.8 ? 3 : 4) as 1 | 2 | 3 | 4;
      setSim({
        stage,
        label: STAGE_LABELS[stage - 1],
        progress: p,
        // addendum §3: done after stage 3; stage 4 (WS hello) is non-blocking.
        done: p >= 0.8,
      });
      if (p >= 1) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [engineDriven]);

  return engine ?? sim;
}

// ---------------------------------------------------------------------------
// Boot log line with glyph-scramble reveal
// ---------------------------------------------------------------------------

function BootLine({ text, suffix, active }: { text: string; suffix: string; active: boolean }) {
  const shown = useGlyphScramble(text);
  return (
    <div className="terminal-line">
      <span className="prompt">&gt; </span>
      <span className="text-bone-dim">{shown}</span>
      <span className="text-ash">{suffix}</span>
      {active ? <span className="boot-caret"> ▊</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boot screen
// ---------------------------------------------------------------------------

export default function BootScreen() {
  const game = useGameHandle();
  const loading = useLoading(game);

  const [minShown, setMinShown] = useState(false);
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  const [staticCount, setStaticCount] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);
  const [choirAwake, setChoirAwake] = useState(false);

  // Stage labels as reported by the engine (fallbacks = gdd §11.1).
  const [stageLabels, setStageLabels] = useState<string[]>([...STAGE_LABELS]);
  useEffect(() => {
    setStageLabels((prev) => {
      if (prev[loading.stage - 1] === loading.label) return prev;
      const next = [...prev];
      next[loading.stage - 1] = loading.label;
      return next;
    });
  }, [loading.stage, loading.label]);

  // Minimum on-screen time so the boot sequence reads even on fast loads.
  useEffect(() => {
    const id = window.setTimeout(() => setMinShown(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  // Static BIOS lines tick in one by one.
  useEffect(() => {
    if (staticCount >= STATIC_LINES.length) return;
    const id = window.setTimeout(() => setStaticCount((c) => c + 1), 130);
    return () => window.clearTimeout(id);
  }, [staticCount]);

  // Tips crossfade every 4s.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTipVisible(false);
      window.setTimeout(() => {
        setTipIdx((i) => (i + 1) % TIPS.length);
        setTipVisible(true);
      }, 260);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  // First click anywhere wakes WebAudio (engine/audio agent owns the graph).
  useEffect(() => {
    const wake = () => setChoirAwake(true);
    window.addEventListener('pointerdown', wake, { once: true });
    return () => window.removeEventListener('pointerdown', wake);
  }, []);

  // Fade out when the engine says done (and the minimum show time elapsed).
  useEffect(() => {
    if (!loading.done || !minShown || fading) return;
    setFading(true);
    useUiAux.getState().setBootDone(true); // HUD assembles as the world fades in
    const id = window.setTimeout(() => setGone(true), 750);
    return () => window.clearTimeout(id);
  }, [loading.done, minShown, fading]);

  if (gone) return null;

  const pct = Math.round(Math.min(1, Math.max(0, loading.progress)) * 100);
  const staticsDone = staticCount >= STATIC_LINES.length;

  return (
    <div
      className={`absolute inset-0 z-[60] flex items-center justify-center bg-void transition-opacity duration-700 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
      aria-hidden={fading}
    >
      {/* realm haze */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 28%, rgb(var(--phosphor-rgb) / 0.08), transparent 62%)',
        }}
      />

      <div className="relative flex w-[min(92vw,560px)] flex-col items-center">
        {/* rune mark with self-drawing dashed ring */}
        <div className="relative">
          <img src="/rune-mark.svg" alt="CORESAPIAN sigil" className="h-24 w-24" />
          <span className="pointer-events-none absolute inset-0 animate-[spin-slow_20s_linear_infinite] rounded-full border border-dashed border-phosphor/40" />
        </div>

        {/* boot log terminal */}
        <div className="terminal mt-8 w-full">
          <div className="terminal-titlebar">
            ▚▚ CORESAPIAN.SHELL
            <span className="boot-caret">▊</span>
            <span className="ml-auto text-ash">BIOS v{BUILD_VERSION}</span>
          </div>
          <div className="terminal-body h-[320px] overflow-hidden text-xs">
            <div className="terminal-line mb-2 text-phosphor">
              CORESAPIAN BIOS v{BUILD_VERSION}
            </div>
            {STATIC_LINES.slice(0, staticCount).map((line, i) => (
              <BootLine key={line} text={line} suffix={` ${'.'.repeat(Math.max(2, 26 - line.length))} OK`} active={i === staticCount - 1 && !staticsDone} />
            ))}
            {staticsDone &&
              STAGE_LABELS.map((_, i) => {
                const stageNo = (i + 1) as 1 | 2 | 3 | 4;
                if (loading.stage < stageNo) return null;
                const label = stageLabels[i]!;
                const complete = loading.stage > stageNo || (loading.done && stageNo <= 3);
                return (
                  <BootLine
                    key={stageNo}
                    text={label}
                    suffix={complete ? ' … OK' : ''}
                    active={!complete}
                  />
                );
              })}
          </div>
        </div>

        {/* rune-strip progress bar */}
        <div className="mt-6 w-[min(100%,480px)]">
          <div className="relative h-[3px] bg-iron">
            <div
              className="absolute inset-y-0 left-0 bg-phosphor shadow-[0_0_10px_rgb(var(--phosphor-rgb)/0.7)] transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
            <div className="absolute inset-x-0 -top-[5px] flex justify-between">
              {Array.from({ length: 11 }, (_, i) => (
                <span
                  key={i}
                  className={`h-[13px] w-px ${i * 10 <= pct ? 'bg-phosphor/80' : 'bg-iron-2/60'}`}
                />
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="rune-ticks">ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ</span>
            <span className="stat text-xs text-phosphor">{pct}%</span>
          </div>
        </div>

        {/* rotating tip */}
        <p
          className={`font-norse mt-6 h-6 text-center text-base text-bone-dim transition-opacity duration-300 ${
            tipVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          “{TIPS[tipIdx]}”
        </p>
      </div>

      {/* build version stamp — bottom-right, never covered */}
      <div className="pointer-events-none absolute bottom-3 right-4">
        <span className="chip chip-version font-mono">
          CORESAPIAN v{BUILD_VERSION} · WEBGL2
        </span>
      </div>

      {/* audio unlock chip */}
      {!choirAwake && (
        <div className="pointer-events-none absolute bottom-10 right-4 animate-[glow-breathe_1.6s_ease-in-out_infinite]">
          <span className="chip border-phosphor/50 text-phosphor">
            ᛊ SOUND: CLICK TO WAKE THE CHOIR
          </span>
        </div>
      )}
    </div>
  );
}
