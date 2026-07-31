// ============================================================================
// CORESAPIAN — src/lib/useInView.ts
// IntersectionObserver reveal hook (design.md §5.1: start "top 82%", once).
// Drives .reveal-etch / .reveal-rise → .is-revealed.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

export interface UseInViewOptions {
  /** Root margin; default mimics "top 82%". */
  rootMargin?: string;
  threshold?: number;
  /** Reveal only the first time (design default). */
  once?: boolean;
}

export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: UseInViewOptions = {},
) {
  const { rootMargin = '0px 0px -18% 0px', threshold = 0, once = true } = options;
  const ref = useRef<T | null>(null);
  // Without IntersectionObserver everything is visible immediately.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold, once]);

  return { ref, inView };
}
