// ============================================================================
// CORESAPIAN — src/components/site/SiteModal.tsx
// Etched dialog shell for codex detail views (weapon detail, bestiary entry).
// Esc / backdrop click closes; focus moves into the panel and is restored;
// body scroll locks while open. Reduced-motion safe (opacity-only).
// ============================================================================

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function SiteModal({
  open,
  onClose,
  label,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panelRef.current) {
        // Lightweight focus trap inside the dialog.
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      window.clearTimeout(t);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9996] flex items-center justify-center p-4 sm:p-8"
          style={{ background: 'color-mix(in srgb, var(--void) 84%, transparent)' }}
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={`panel relative max-h-[86dvh] w-full overflow-y-auto ${
              wide ? 'max-w-[920px]' : 'max-w-[720px]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="btn btn-ghost btn-sm absolute right-4 top-4 z-10"
            >
              ✕
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
