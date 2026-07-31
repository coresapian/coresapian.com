// ============================================================================
// CORESAPIAN — src/components/site/primitives.tsx
// Shared runic-CRT building blocks for the codex pages (Realms, Progression,
// Lore, Multiplayer). Mirrors the Home.tsx vocabulary (design.md §4–§6):
// kicker rows, rune dividers, boot-type, reveals, threat pips, chips, CTA band.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { useInView } from '@/lib/useInView';
import { cssVar, reducedMotion } from './utils';

// ---------------------------------------------------------------------------
// KickerRow — ▚▚ + kicker text + extending line + right rune string (§6.4)
// ---------------------------------------------------------------------------

export function KickerRow({
  label,
  runes,
  accent,
  className = '',
}: {
  label: string;
  runes: string;
  accent?: string;
  className?: string;
}) {
  return (
    <div
      className={`kicker-row ${className}`}
      style={accent ? cssVar('--accent', accent) : undefined}
    >
      <span className="kicker">{label}</span>
      <span className="kicker-row-line" />
      <span className="kicker-row-runes" aria-hidden="true">
        {runes}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuneDivider — etched rule with centered sigil (§4)
// ---------------------------------------------------------------------------

export function RuneDivider({ sigil = 'ᛟ', accent }: { sigil?: string; accent?: string }) {
  return (
    <div
      className="rune-divider mx-auto max-w-content px-4 sm:px-6"
      style={accent ? cssVar('--accent', accent) : undefined}
      aria-hidden="true"
    >
      <span>{sigil}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BootType — terminal typing, 18ms/char, once `active` (§5.2 boot-type)
// ---------------------------------------------------------------------------

export function BootType({
  text,
  active,
  className,
  speed = 18,
  onDone,
}: {
  text: string;
  active: boolean;
  className?: string;
  speed?: number;
  onDone?: () => void;
}) {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) {
      setOut(text);
      onDone?.();
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        onDone?.();
      }
    }, speed);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, text]);
  return <span className={className}>{out}</span>;
}

// ---------------------------------------------------------------------------
// Reveal — IntersectionObserver-driven etch/rise wrapper (§5.1–5.2)
// ---------------------------------------------------------------------------

export function Reveal({
  children,
  kind = 'rise',
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  kind?: 'rise' | 'etch';
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'span';
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const base = kind === 'etch' ? 'reveal-etch' : 'reveal-rise';
  return (
    <Tag
      ref={ref as never}
      className={`${base} ${inView ? 'is-revealed' : ''} ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// ThreatPips — ●●●○○ with accent glow, sequential light-up (§6.4 / realms.md)
// ---------------------------------------------------------------------------

export function ThreatPips({
  threat,
  accent,
  lit,
  size = 'text-[0.625rem]',
}: {
  threat: number;
  accent: string;
  /** When false, pips render dim (pre-reveal). */
  lit?: boolean;
  size?: string;
}) {
  const on = lit ?? true;
  return (
    <span className="flex gap-1" aria-label={`Threat ${threat} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`${size} transition-all duration-150`}
          style={{
            transitionDelay: `${i * 60}ms`,
            color: i < threat ? accent : 'var(--iron-2)',
            opacity: i < threat ? (on ? 1 : 0.25) : 0.3,
            textShadow: i < threat && on ? `0 0 8px ${accent}` : 'none',
          }}
          aria-hidden="true"
        >
          ●
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatBar — etched micro stat row; fill animates on reveal (§6.4)
// ---------------------------------------------------------------------------

export function StatBar({
  label,
  value,
  max = 10,
  accent = 'var(--phosphor)',
  filled,
  width = 120,
}: {
  label: string;
  value: number;
  max?: number;
  accent?: string;
  filled: boolean;
  width?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="stat-bar" style={cssVar('--accent', accent)}>
      <span className="stat-bar-label">{label}</span>
      <span className="stat-bar-track" style={{ width }}>
        <span
          className="stat-bar-fill"
          style={{ width: filled ? `${pct}%` : '0%', transitionDelay: '120ms' }}
        />
      </span>
      <span className="stat-bar-value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyChip — click-to-copy chip with COPIED feedback (§micro-interactions)
// ---------------------------------------------------------------------------

export function CopyChip({
  text,
  label,
  className = '',
  title,
}: {
  text: string;
  label: ReactNode;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable — feedback still shown */
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? `Copy ${text}`}
      className={`chip transition-colors hover:border-phosphor hover:text-phosphor ${className}`}
      aria-live="polite"
    >
      {copied ? <span className="text-soul">COPIED</span> : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CtaBand — standard closing call-to-action (realms.md S12 spec, home S9 mini)
// ---------------------------------------------------------------------------

export function CtaBand({
  heading,
  primary,
  secondary,
  live,
}: {
  heading: string;
  primary: { to: string; label: string };
  secondary?: { to: string; label: string };
  /** Optional live chip row rendered above the buttons. */
  live?: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <section className="relative overflow-hidden bg-void py-24 md:py-36">
      <img
        src="/rune-circle.svg"
        alt=""
        className="anim-spin-90 pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 opacity-15"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(255,182,74,0.06), transparent 55%)' }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={`relative z-10 mx-auto flex max-w-reading flex-col items-center px-4 text-center ${
          inView ? 'reveal-rise is-revealed' : 'reveal-rise'
        }`}
      >
        <h2 className="h2">{heading}</h2>
        {live && <div className="mt-6">{live}</div>}
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <span className="relative inline-flex">
            <span
              className="anim-spin-60 pointer-events-none absolute -inset-3 rounded-full border border-dashed border-phosphor/40"
              aria-hidden="true"
            />
            <Link to={primary.to} className="btn btn-phosphor btn-lg">
              {primary.label}
            </Link>
          </span>
          {secondary && (
            <Link to={secondary.to} className="btn btn-ghost btn-lg corner-brackets">
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SectionHead — kicker-row + heading + optional lede, reveal-consistent
// ---------------------------------------------------------------------------

export function SectionHead({
  kicker,
  runes,
  title,
  lede,
  accent,
  id,
}: {
  kicker: string;
  runes: string;
  title: ReactNode;
  lede?: string;
  accent?: string;
  id?: string;
}) {
  return (
    <div id={id} style={{ scrollMarginTop: 96 }}>
      <KickerRow label={kicker} runes={runes} accent={accent} />
      <h2 className="h2 mt-6">{title}</h2>
      {lede && <p className="body mt-5 max-w-reading">{lede}</p>}
    </div>
  );
}
