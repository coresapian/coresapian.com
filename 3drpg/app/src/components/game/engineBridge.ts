// ============================================================================
// CORESAPIAN — ui/engine seam (integration-addendum §3)
//
// The engine agent owns src/game/Game.ts. Per addendum §3 the engine exposes:
//   bootstrapGame(opts: GameOptions): Game
//   game.loading: LoadingState
//   game.onLoadingChange(cb): unsubscribe
//   game.projectToScreen(v: Vec3): { x, y, visible }
//   game.interactChannel (polled via rAF by ui)
//
// The engine (src/game/Game.ts) implements these today. The bridge still
// resolves them TOLERANTLY at runtime so the HUD survives any engine
// refactor that temporarily drops a member — without ever importing
// three.js (forbidden for ui).
// ============================================================================

import { createContext, useContext } from 'react';

import * as GameModule from '@/game/Game';
import type { GameOptions } from '@/game/Game';
import type { Vec3 } from '../../../contracts/types';

// ---------------------------------------------------------------------------
// Contract mirrors (addendum §3 — replace with engine exports when they land)
// ---------------------------------------------------------------------------

export interface LoadingState {
  stage: 1 | 2 | 3 | 4;
  label: string;
  progress: number;
  done: boolean;
}

export interface ScreenProjection {
  x: number;
  y: number;
  visible: boolean;
}

/** Normalized interact-channel state the HUD ring renders from. */
export interface InteractChannelState {
  active: boolean;
  /** 0..1 */
  progress: number;
  label: string | null;
}

export const IDLE_CHANNEL: InteractChannelState = { active: false, progress: 0, label: null };

/**
 * The ui-facing Game surface. Everything beyond start/dispose is OPTIONAL:
 * the bridge degrades gracefully if the engine omits a member.
 */
export interface GameHandle {
  start(): void;
  dispose(): void;
  loading?: LoadingState;
  onLoadingChange?(cb: (s: LoadingState) => void): () => void;
  projectToScreen?(v: Vec3): ScreenProjection;
  interactChannel?: unknown;
}

// ---------------------------------------------------------------------------
// Construction — prefer addendum §3 `bootstrapGame` when the engine lands it.
// ---------------------------------------------------------------------------

export function createGame(opts: GameOptions): GameHandle {
  const mod = GameModule as unknown as {
    bootstrapGame?: (o: GameOptions) => GameHandle;
  };
  if (typeof mod.bootstrapGame === 'function') return mod.bootstrapGame(opts);
  // Fallback: engine that only exports the Game class directly.
  return new GameModule.Game(opts) as unknown as GameHandle;
}

// ---------------------------------------------------------------------------
// Loading (addendum §3 / gdd §11.1)
// ---------------------------------------------------------------------------

function isLoadingState(v: unknown): v is LoadingState {
  const l = v as LoadingState | undefined;
  return (
    !!l &&
    typeof l === 'object' &&
    typeof l.progress === 'number' &&
    typeof l.done === 'boolean' &&
    typeof l.stage === 'number'
  );
}

export function readLoading(game: GameHandle | null): LoadingState | null {
  if (!game) return null;
  return isLoadingState(game.loading) ? game.loading : null;
}

export function subscribeLoading(
  game: GameHandle | null,
  cb: (s: LoadingState) => void,
): () => void {
  if (!game || typeof game.onLoadingChange !== 'function') return () => {};
  try {
    return game.onLoadingChange(cb);
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// World→screen projection for damage numbers (addendum-consistent helper the
// engine exposes). Fallback if the engine omits it: scatter near the
// crosshair so combat feedback is still visible.
// ---------------------------------------------------------------------------

export function projectWorldToScreen(game: GameHandle | null, v: Vec3): ScreenProjection {
  if (game && typeof game.projectToScreen === 'function') {
    try {
      const p = game.projectToScreen(v);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch {
      /* fall through to the fallback */
    }
  }
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const h = typeof window === 'undefined' ? 720 : window.innerHeight;
  return {
    x: w / 2 + (Math.random() - 0.5) * 180,
    y: h / 2 - 30 + (Math.random() - 0.5) * 90,
    visible: true,
  };
}

// ---------------------------------------------------------------------------
// Tolerant probes for engine internals the HUD mirrors each frame. These all
// degrade to neutral values if an engine member is absent. Accessors are read
// FRESH every frame (addendum §2: never cache service references across frames).
// ---------------------------------------------------------------------------

type Probe = (g: GameHandle) => unknown;

function probe(game: GameHandle | null, paths: string[]): unknown {
  if (!game) return undefined;
  for (const path of paths) {
    let cur: unknown = game;
    let ok = true;
    for (const key of path.split('.')) {
      cur = (cur as Record<string, unknown> | null)?.[key];
      if (cur === undefined || cur === null) {
        ok = false;
        break;
      }
    }
    if (ok) return cur;
  }
  return undefined;
}

function callProbe(game: GameHandle | null, paths: string[]): unknown {
  const fn = probe(game, paths);
  if (typeof fn !== 'function') return undefined;
  try {
    return (fn as (this: unknown) => unknown).call(game);
  } catch {
    return undefined;
  }
}

/** Player yaw (radians, 0 = north/-Z). 0 if the engine exposes no rig. */
export function readYaw(game: GameHandle | null): number {
  const v =
    callProbe(game, ['getYaw', 'getPlayerYaw', 'player.getYaw', 'input.getYaw']) ??
    probe(game, ['yaw', 'playerYaw']);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Player world position (meters). null while unavailable. */
export function readPlayerPosition(game: GameHandle | null): Vec3 | null {
  const v = callProbe(game, ['getPlayerPosition', 'player.getPosition']);
  const p = (v ?? probe(game, ['playerPosition'])) as Partial<Vec3> | undefined;
  if (p && typeof p.x === 'number' && typeof p.z === 'number') {
    return { x: p.x, y: typeof p.y === 'number' ? p.y : 0, z: p.z };
  }
  return null;
}

/** Normalized interact channel (portal/harvest ring). */
export function readInteractChannel(game: GameHandle | null): InteractChannelState {
  const raw = (probe(game, ['interactChannel']) ?? callProbe(game, ['getInteractChannel'])) as
    | {
        active?: boolean;
        progress?: number;
        label?: string;
        prompt?: string;
        totalMs?: number;
        remainingMs?: number;
        elapsedMs?: number;
        durationMs?: number;
        channelMs?: number;
      }
    | null
    | undefined;
  if (!raw || typeof raw !== 'object') return IDLE_CHANNEL;

  let progress: number | null = null;
  if (typeof raw.progress === 'number') progress = raw.progress;
  else if (typeof raw.totalMs === 'number' && raw.totalMs > 0 && typeof raw.remainingMs === 'number')
    progress = 1 - raw.remainingMs / raw.totalMs;
  else if (typeof raw.elapsedMs === 'number') {
    const total =
      typeof raw.durationMs === 'number' && raw.durationMs > 0
        ? raw.durationMs
        : typeof raw.channelMs === 'number' && raw.channelMs > 0
          ? raw.channelMs
          : null;
    if (total) progress = raw.elapsedMs / total;
  }
  if (progress === null) return IDLE_CHANNEL;
  const clamped = Math.min(1, Math.max(0, progress));
  const active = raw.active ?? clamped > 0;
  if (!active) return IDLE_CHANNEL;
  return {
    active: true,
    progress: clamped,
    label: typeof raw.label === 'string' ? raw.label : typeof raw.prompt === 'string' ? raw.prompt : null,
  };
}

/** Crosshair context variant, if the engine publishes one. */
export type CrosshairVariant = 'default' | 'interact' | 'melee' | 'bow' | 'cast';

export function readCrosshairVariant(game: GameHandle | null): CrosshairVariant | null {
  const v = probe(game, ['crosshair', 'crosshairState', 'aimState']);
  if (v === 'interact' || v === 'melee' || v === 'bow' || v === 'cast' || v === 'default') return v;
  return null;
}

/** Per-slot rune cooldown remaining seconds [Q,R,F,V]. null = all ready. */
export function readRuneCooldowns(game: GameHandle | null): number[] | null {
  const v = probe(game, ['runeCooldowns', 'cooldowns.runes', 'runeCooldownsRemaining']);
  if (Array.isArray(v) && v.every((n) => typeof n === 'number')) return v.slice(0, 4) as number[];
  return null;
}

// Keep the Probe type referenced (documented seam for future probes).
export type { Probe };

// ---------------------------------------------------------------------------
// React context — the page provides the handle; HUD/menus consume it.
// ---------------------------------------------------------------------------

export const GameHandleContext = createContext<GameHandle | null>(null);

export function useGameHandle(): GameHandle | null {
  return useContext(GameHandleContext);
}
