// ============================================================================
// CORESAPIAN — Controls hint (game.md S14; lead spec: first-60s contextual
// hints, dismissible). Cycles the locked default bindings for the first
// minute of play, then etches itself away. Once seen, never again.
// ============================================================================

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { useUiAux } from './uiAux';

const SEEN_KEY = 'coresapian.hintsSeen';
const ROTATE_MS = 6000;
const TOTAL_MS = 60_000;

const HINTS: { keys: string; action: string }[] = [
  { keys: 'W A S D', action: 'MOVE' },
  { keys: 'MOUSE', action: 'LOOK · CLICK TO LOCK' },
  { keys: 'SHIFT', action: 'SPRINT' },
  { keys: 'LMB / RMB', action: 'ATTACK / BLOCK' },
  { keys: 'E', action: 'INTERACT' },
  { keys: 'Q R F V', action: 'CAST RUNES' },
  { keys: '1–4', action: 'DRINK & EAT' },
  { keys: 'TAB · K · J · M', action: 'PACK · SKILLS · SAGAS · MAP' },
  { keys: 'ESC', action: 'PAUSE' },
];

export default function ControlsHint() {
  const bootDone = useUiAux((s) => s.bootDone);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!bootDone || dismissed) return;
    const rotate = window.setInterval(() => setIdx((i) => (i + 1) % HINTS.length), ROTATE_MS);
    const end = window.setTimeout(() => {
      setExpired(true);
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* session-only */
      }
    }, TOTAL_MS);
    return () => {
      window.clearInterval(rotate);
      window.clearTimeout(end);
    };
  }, [bootDone, dismissed]);

  if (!bootDone || dismissed || expired) return null;

  const hint = HINTS[idx]!;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* session-only */
    }
  };

  return (
    <div className="pointer-events-none absolute bottom-40 left-1/2 z-[25] -translate-x-1/2">
      <div className="panel pointer-events-auto flex items-center gap-3 px-4 py-2">
        <span className="rune-ticks">ᚠ</span>
        <span key={idx} className="anim-flicker stat text-xs text-phosphor">
          {hint.keys}
        </span>
        <span className="micro text-bone-dim">{hint.action}</span>
        <div className="flex gap-1">
          {HINTS.map((_, i) => (
            <span key={i} className={`h-1 w-1 ${i === idx ? 'bg-phosphor' : 'bg-iron-2'}`} />
          ))}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss controls hint"
          className="text-ash transition-colors hover:text-phosphor"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
