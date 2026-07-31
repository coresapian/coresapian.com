// ============================================================================
// CORESAPIAN — Bottom-right HUD cluster (game.md S3): realm rune + name,
// active world-event timer, hacksilver gold counter, link status dot,
// build stamp (always visible, never covered).
// ============================================================================

import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';

import { BUILD_VERSION } from '@/lib/buildInfo';
import { useGameStore } from '@/game/store';
import { REALMS } from '../../../../contracts/realms';
import { REALM_RUNES, useCurrentRealm } from '../realmState';

const STATUS_DOT: Record<string, string> = {
  connecting: 'bg-phosphor animate-pulse',
  connected: 'bg-soul',
  reconnecting: 'bg-blood animate-pulse',
  disconnected: 'bg-blood',
};

function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(active: boolean): number {
  // Lazy initializer keeps the impure read off the render path (react-hooks/purity).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export default function RealmStatus() {
  const realm = useCurrentRealm();
  const gold = useGameStore((s) => s.gold);
  const status = useGameStore((s) => s.status);
  const events = useGameStore((s) => s.events);

  const active = events.find((e) => e.realm === realm && e.phase !== 'ended');
  const now = useNow(!!active);
  const cfg = REALMS[realm];

  return (
    <div className="pointer-events-none flex flex-col items-end gap-1">
      {active && (
        <div className="chip border-blood/50 text-blood-hi">
          ᛒ {active.name} ·{' '}
          {active.phase === 'announced'
            ? `BEGINS ${formatClock(active.startsAt - now)}`
            : `RAGES ${formatClock(active.endsAt - now)}`}
        </div>
      )}
      <div className="panel flex items-center gap-3 px-3 py-1.5">
        <span className="font-runic text-base leading-none" style={{ color: cfg.palette.accent }}>
          {REALM_RUNES[realm]}
        </span>
        <span className="micro text-bone-dim">{cfg.displayName.toUpperCase()}</span>
        <span className="h-3 w-px bg-iron" />
        <Coins size={11} className="text-phosphor" />
        <span className="stat text-xs text-phosphor">{gold.toLocaleString()}</span>
        <span className="h-3 w-px bg-iron" />
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      </div>
      <span className="micro text-[8px] text-ash">CORESAPIAN v{BUILD_VERSION}</span>
    </div>
  );
}
