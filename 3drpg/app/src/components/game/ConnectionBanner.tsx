// ============================================================================
// CORESAPIAN — Connection banner, "The Bifröst Link" (game.md S2,
// gdd §10 reconnect UX, addendum §3 stage 4).
//
// Overlay only — never blocks clicks, never blocks play; the world stays
// visible behind it. States vocabulary: CONNECTING / RETRYING / LINKED /
// UNSTABLE (>150ms) / OFFLINE.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

import { useGameStore } from '@/game/store';
import { RECONNECT_INTERVAL_MS } from '../../../contracts/netcode';

const LINKED_HOLD_MS = 2500;
const DEGRADED_MS = 150;

/** Animated ellipsis — 0..3 dots cycling at 1s. */
function Dots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => (v + 1) % 4), 250);
    return () => window.clearInterval(id);
  }, []);
  return <span className="inline-block w-[3ch] text-left">{'.'.repeat(n)}</span>;
}

/** Live 3→1 retry numeral + refilling strip (netcode: constant 3000ms retry). */
function RetryCountdown() {
  const [phase, setPhase] = useState(0); // 0..1 through the current retry window
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => {
      setPhase(((performance.now() - t0) % RECONNECT_INTERVAL_MS) / RECONNECT_INTERVAL_MS);
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  const tick = 3 - Math.floor(phase * 3);
  return (
    <>
      <span key={tick} className="stat anim-flicker text-blood-hi">
        {tick}
      </span>
      <div className="absolute inset-x-4 bottom-1 h-px bg-iron">
        <div className="h-full bg-blood/70" style={{ width: `${Math.round(phase * 100)}%` }} />
      </div>
    </>
  );
}

export default function ConnectionBanner() {
  const status = useGameStore((s) => s.status);
  const latencyMs = useGameStore((s) => s.latencyMs);
  const wanderers = useGameStore((s) => Object.keys(s.remotePlayers).length);

  // `connected` shows briefly, then the banner fades away.
  const [linkedAt, setLinkedAt] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status === 'connected' && prevStatus.current !== 'connected') {
      setLinkedAt(Date.now());
      setHidden(false);
    }
    if (status !== 'connected') {
      setLinkedAt(null);
      setHidden(false);
    }
    prevStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (linkedAt === null) return;
    const remaining = LINKED_HOLD_MS - (Date.now() - linkedAt);
    const id = window.setTimeout(() => setHidden(true), Math.max(0, remaining));
    return () => window.clearTimeout(id);
  }, [linkedAt]);

  if (status === 'disconnected') {
    return (
      <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
        <div className="panel anim-flicker flex h-10 w-[340px] items-center justify-center gap-2 border-blood/50">
          <span className="h-2 w-2 rounded-full bg-blood shadow-[0_0_8px_rgb(var(--blood-rgb)/0.9)]" />
          <span className="micro text-blood-hi">OFFLINE — UNRECORDED</span>
        </div>
      </div>
    );
  }

  if (status === 'connected') {
    if (hidden) return null;
    const degraded = latencyMs > DEGRADED_MS;
    return (
      <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
        <div className="panel anim-flicker flex h-10 w-[340px] items-center justify-center gap-2 transition-all duration-300">
          <span
            className={`h-2 w-2 animate-[pulse-dot_1.2s_ease-in-out_infinite] rounded-full ${
              degraded
                ? 'bg-phosphor shadow-[0_0_8px_rgb(var(--phosphor-rgb)/0.9)]'
                : 'bg-soul shadow-[0_0_8px_rgb(var(--soul-rgb)/0.9)]'
            }`}
          />
          <span className={`micro ${degraded ? 'text-phosphor' : 'text-soul'}`}>
            {degraded ? `UNSTABLE LINK · ${Math.round(latencyMs)}ms` : 'LINKED TO BIFRÖST'}
          </span>
          {!degraded && (
            <span className="micro text-ash">
              · {Math.round(latencyMs)}ms · {wanderers + 1} WANDERER{wanderers === 0 ? '' : 'S'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // connecting / reconnecting
  const reconnecting = status === 'reconnecting';
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
      <div className="panel anim-flicker relative flex h-10 w-[340px] items-center justify-center gap-2 px-4">
        <span className="h-2 w-2 animate-[pulse-dot_1.2s_ease-in-out_infinite] rounded-full bg-phosphor shadow-[0_0_8px_rgb(var(--phosphor-rgb)/0.9)]" />
        {reconnecting ? (
          <>
            <span className="micro text-blood-hi">CONNECTION LOST — RETRYING IN</span>
            <RetryCountdown />
          </>
        ) : (
          <span className="micro text-phosphor">
            CONNECTING TO SERVER
            <Dots />
          </span>
        )}
        <span className="micro absolute right-3 text-ash">BIFRÖST</span>
      </div>
    </div>
  );
}
