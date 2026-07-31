// ============================================================================
// CORESAPIAN — src/lib/useGlyphScramble.ts
// glyph-scramble (design.md §5.2): characters cycle random Elder Futhark runes
// (30ms/frame) then settle left→right over 600–900ms. Max ~20 chars.
// Reduced motion: settles instantly.
// ============================================================================

import { useEffect, useState } from 'react';

const RUNE_CHARS = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const FRAME_MS = 30;
const MAX_CHARS = 20;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Scrambles `target` whenever `target` or `trigger` changes while `active`.
 * Returns the currently displayed string.
 */
export function useGlyphScramble(target: string, active = true, trigger: unknown = 0): string {
  const [out, setOut] = useState(target);

  // Keep displayed text in sync when the target changes (render-adjust).
  const [lastTarget, setLastTarget] = useState(target);
  if (lastTarget !== target) {
    setLastTarget(target);
    setOut(target);
  }

  useEffect(() => {
    // Inactive / reduced-motion: the settled target is already displayed.
    if (!active || prefersReducedMotion()) return;
    const chars = target.split('');
    // Only the first ~MAX_CHARS scramble; longer tails stay settled (§5.2 cap).
    const scrambleCount = Math.min(chars.length, MAX_CHARS);
    const durationMs = Math.min(900, Math.max(600, scrambleCount * 45));
    const start = performance.now();

    const id = window.setInterval(() => {
      const t = (performance.now() - start) / durationMs;
      if (t >= 1) {
        setOut(target);
        window.clearInterval(id);
        return;
      }
      const settledCount = Math.floor(t * scrambleCount);
      let s = '';
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]!;
        if (i >= scrambleCount || i < settledCount || ch === ' ' || ch === '—') {
          s += ch;
        } else {
          s += RUNE_CHARS[(Math.random() * RUNE_CHARS.length) | 0];
        }
      }
      setOut(s);
    }, FRAME_MS);

    return () => window.clearInterval(id);
  }, [target, active, trigger]);

  return out;
}

/** Stateless scramble for one-shot DOM text (used sparingly). */
export function scrambleText(target: string, onFrame: (s: string) => void): () => void {
  if (prefersReducedMotion()) {
    onFrame(target);
    return () => {};
  }
  const chars = target.split('');
  const scrambleCount = Math.min(chars.length, MAX_CHARS);
  const durationMs = Math.min(900, Math.max(600, scrambleCount * 45));
  const start = performance.now();
  const id = window.setInterval(() => {
    const t = (performance.now() - start) / durationMs;
    if (t >= 1) {
      onFrame(target);
      window.clearInterval(id);
      return;
    }
    const settledCount = Math.floor(t * scrambleCount);
    let s = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      s +=
        i >= scrambleCount || i < settledCount || ch === ' '
          ? ch
          : RUNE_CHARS[(Math.random() * RUNE_CHARS.length) | 0];
    }
    onFrame(s);
  }, FRAME_MS);
  return () => window.clearInterval(id);
}
