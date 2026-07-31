// ============================================================================
// CORESAPIAN — CRT veil intensity helpers. The frozen Layout CrtOverlay owns
// rendering; it persists to localStorage `coresapian.crt` and listens for the
// `coresapian:crt` CustomEvent. ui only reads/writes that contract.
// ============================================================================

export type CrtLevel = 'off' | 'low' | 'high';

export const CRT_KEY = 'coresapian.crt';
const CRT_EVENT = 'coresapian:crt';

export function readCrt(fallback: CrtLevel = 'low'): CrtLevel {
  try {
    const v = localStorage.getItem(CRT_KEY);
    if (v === 'off' || v === 'low' || v === 'high') return v;
  } catch {
    /* session-only */
  }
  return fallback;
}

export function writeCrt(level: CrtLevel): void {
  try {
    localStorage.setItem(CRT_KEY, level);
  } catch {
    /* session-only */
  }
  window.dispatchEvent(new CustomEvent(CRT_EVENT, { detail: level }));
}

/** True when no intensity has ever been chosen on this stone. */
export function hasCrtPreference(): boolean {
  try {
    const v = localStorage.getItem(CRT_KEY);
    return v === 'off' || v === 'low' || v === 'high';
  } catch {
    return false;
  }
}
