// ============================================================================
// CORESAPIAN — src/components/site/utils.ts
// Non-component helpers shared by the codex pages. Kept separate from
// primitives.tsx so that file stays a clean fast-refresh boundary.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation } from 'react-router';

export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** CSS var custom-property style helper (design tokens passed as strings). */
export function cssVar(name: string, value: string): CSSProperties {
  return { [name]: value } as CSSProperties;
}

/**
 * Scrolls to `location.hash` targets on mount/hash-change (react-router does
 * not handle fragment scrolling; cross-page links like `/realms#jotunheim`
 * rely on it). Deferred so page sections have laid out.
 */
export function useHashScroll(): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = window.setTimeout(() => {
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
    }, 120);
    return () => window.clearTimeout(id);
  }, [hash]);
}

/** Shared "COPIED" flash state for copy-on-click chips. */
export function useCopiedFlag(timeoutMs = 1200): [string | null, (key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mark = (key: string) => {
    setCopied(key);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied((c) => (c === key ? null : c)), timeoutMs);
  };
  return [copied, mark];
}
