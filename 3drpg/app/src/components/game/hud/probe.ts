// ============================================================================
// CORESAPIAN — HUD engine probe: one rAF loop polling the tolerant engine
// readers (engineBridge). Change-guarded so React only re-renders when a
// displayed value actually changes.
// ============================================================================

import { useEffect, useState } from 'react';

import type { Vec3 } from '../../../../contracts/types';
import type {
  CrosshairVariant,
  GameHandle,
  InteractChannelState,
} from '../engineBridge';
import {
  IDLE_CHANNEL,
  readCrosshairVariant,
  readInteractChannel,
  readPlayerPosition,
  readRuneCooldowns,
  readYaw,
} from '../engineBridge';

export interface EngineProbe {
  yaw: number;
  pos: Vec3 | null;
  channel: InteractChannelState;
  crosshair: CrosshairVariant | null;
  /** Per-slot rune cooldown remaining seconds; null = unknown/all ready. */
  runeCooldowns: number[] | null;
}

const INITIAL: EngineProbe = {
  yaw: 0,
  pos: null,
  channel: IDLE_CHANNEL,
  crosshair: null,
  runeCooldowns: null,
};

function nearlyEqual(a: EngineProbe, b: EngineProbe): boolean {
  if (Math.abs(a.yaw - b.yaw) > 0.004) return false;
  if ((a.pos === null) !== (b.pos === null)) return false;
  if (a.pos && b.pos && (Math.abs(a.pos.x - b.pos.x) > 0.1 || Math.abs(a.pos.z - b.pos.z) > 0.1))
    return false;
  if (a.channel.active !== b.channel.active) return false;
  if (a.channel.active && Math.abs(a.channel.progress - b.channel.progress) > 0.01) return false;
  if (a.channel.label !== b.channel.label) return false;
  if (a.crosshair !== b.crosshair) return false;
  const ac = a.runeCooldowns;
  const bc = b.runeCooldowns;
  if ((ac === null) !== (bc === null)) return false;
  if (ac && bc) {
    for (let i = 0; i < 4; i++) {
      if (Math.abs((ac[i] ?? 0) - (bc[i] ?? 0)) > 0.1) return false;
    }
  }
  return true;
}

/** Polls the Game handle every animation frame; re-renders on real change. */
export function useEngineProbe(game: GameHandle | null, active = true): EngineProbe {
  const [probe, setProbe] = useState<EngineProbe>(INITIAL);

  useEffect(() => {
    if (!active || !game) return;
    let raf = 0;
    let last: EngineProbe = INITIAL;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const next: EngineProbe = {
        yaw: readYaw(game),
        pos: readPlayerPosition(game),
        channel: readInteractChannel(game),
        crosshair: readCrosshairVariant(game),
        runeCooldowns: readRuneCooldowns(game),
      };
      if (!nearlyEqual(last, next)) {
        last = next;
        setProbe(next);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, active]);

  return probe;
}
