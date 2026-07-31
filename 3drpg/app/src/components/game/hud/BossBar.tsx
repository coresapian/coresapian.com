// ============================================================================
// CORESAPIAN — Boss bar (game.md S3): wide blood etched bar under the
// compass, name in Uncial, phase pips at the gdd §9 thresholds (100/75/50/25).
// Driven by the store bossBar slice (combat-ai writes).
// ============================================================================

import { useGameStore } from '@/game/store';

const SEGMENTS = 24;
const PHASE_MARKS = [0.75, 0.5, 0.25];

export default function BossBar() {
  const bossBar = useGameStore((s) => s.bossBar);
  if (!bossBar) return null;

  const frac = Math.max(0, Math.min(1, bossBar.hp / Math.max(1, bossBar.maxHp)));
  const filled = Math.round(frac * SEGMENTS);

  return (
    <div className="pointer-events-none flex w-[460px] flex-col items-center">
      <div className="mb-1 flex items-center gap-3">
        <span className="font-runic text-xs text-blood">ᚦ</span>
        <span className="font-norse text-sm uppercase tracking-[0.3em] text-bone">
          {bossBar.name}
        </span>
        <span className="font-runic text-xs text-blood">ᚦ</span>
      </div>
      <div className="panel relative flex h-[14px] w-full items-center gap-[2px] px-1 py-[2px]">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-full flex-1 transition-colors duration-150 ${
              i < filled ? 'bg-blood shadow-[0_0_6px_rgb(var(--blood-rgb)/0.6)]' : 'bg-abyss/70'
            }`}
          />
        ))}
        {/* phase threshold notches */}
        {PHASE_MARKS.map((p) => (
          <span
            key={p}
            className="absolute top-0 h-full w-px bg-void"
            style={{ left: `${(1 - p) * 100}%` }}
          />
        ))}
      </div>
      <div className="font-runic mt-1 flex gap-2 text-[11px]">
        {['Ⅰ', 'Ⅱ', 'Ⅲ'].map((pip, i) => {
          const threshold = [1, 2 / 3, 1 / 3][i]!;
          const lit = frac > threshold - 0.34 && frac <= threshold + 0.01;
          return (
            <span key={pip} className={lit ? 'text-blood-hi' : 'text-iron-2/60'}>
              {pip}
            </span>
          );
        })}
      </div>
    </div>
  );
}
