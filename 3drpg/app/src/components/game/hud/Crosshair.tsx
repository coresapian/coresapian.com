// ============================================================================
// CORESAPIAN — Crosshair + interact prompt (game.md S3 center).
// Context variants: default dot+ticks / interact brackets / melee red ticks /
// bow draw arc / cast rune circle. Channel progress ring for portals &
// harvests polls game.interactChannel via rAF (addendum §3).
// ============================================================================

import { useGameStore } from '@/game/store';
import type { EngineProbe } from './probe';

const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

export default function Crosshair({ probe }: { probe: EngineProbe }) {
  const interactPrompt = useGameStore((s) => s.interactPrompt);
  const channel = probe.channel;

  const variant = interactPrompt
    ? 'interact'
    : (probe.crosshair ?? 'default');

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
      <div className="relative flex h-16 w-16 items-center justify-center">
        {/* channel progress ring (portals / harvest) */}
        {channel.active && (
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 40 40">
            <circle
              cx="20"
              cy="20"
              r={RING_R}
              fill="none"
              stroke="var(--iron)"
              strokeWidth="2"
            />
            <circle
              cx="20"
              cy="20"
              r={RING_R}
              fill="none"
              stroke="var(--phosphor)"
              strokeWidth="2"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - channel.progress)}
              strokeLinecap="butt"
            />
          </svg>
        )}

        {variant === 'interact' ? (
          /* interact: corner brackets */
          <>
            <span className="absolute left-1 top-1 h-3 w-3 border-l-2 border-t-2 border-phosphor" />
            <span className="absolute right-1 top-1 h-3 w-3 border-r-2 border-t-2 border-phosphor" />
            <span className="absolute bottom-1 left-1 h-3 w-3 border-b-2 border-l-2 border-phosphor" />
            <span className="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-phosphor" />
            <span className="h-[3px] w-[3px] rounded-full bg-phosphor" />
          </>
        ) : variant === 'melee' ? (
          /* enemy in melee range: blood ticks flare outward */
          <>
            {[0, 90, 180, 270].map((deg) => (
              <span
                key={deg}
                className="absolute h-[7px] w-[2px] bg-blood-hi"
                style={{
                  transform: `rotate(${deg}deg) translateY(-9px)`,
                }}
              />
            ))}
            <span className="h-[3px] w-[3px] rounded-full bg-blood-hi" />
          </>
        ) : variant === 'bow' ? (
          /* bow draw: open circle + dot */
          <>
            <span className="absolute h-9 w-9 rounded-full border border-bone/70" />
            <span className="h-[3px] w-[3px] rounded-full bg-bone" />
          </>
        ) : variant === 'cast' ? (
          /* cast: rune circle */
          <>
            <span className="absolute h-9 w-9 rounded-full border border-galdr/70" />
            <span className="font-runic text-[11px] text-galdr">ᚱ</span>
          </>
        ) : (
          /* default: 1.5px dot + hairline ticks (bone 70%) */
          <>
            {[0, 90, 180, 270].map((deg) => (
              <span
                key={deg}
                className="absolute h-[5px] w-px bg-bone/70"
                style={{
                  transform: `rotate(${deg}deg) translateY(-6px)`,
                }}
              />
            ))}
            <span className="h-[3px] w-[3px] rounded-full bg-bone/80" />
          </>
        )}
      </div>

      {/* interact prompt text under the crosshair */}
      {interactPrompt && !channel.active && (
        <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap">
          <span className="chip border-phosphor/50 bg-abyss/80 text-phosphor">
            {interactPrompt}
          </span>
        </div>
      )}
      {/* channel label */}
      {channel.active && (
        <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap">
          <span className="micro bg-abyss/70 px-2 py-0.5 text-phosphor">
            {channel.label ?? 'CHANNELING'} {Math.round(channel.progress * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
