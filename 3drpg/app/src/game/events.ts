// ============================================================================
// CORESAPIAN — src/game/events.ts (SCAFFOLD-OWNED, FROZEN)
// Typed event bus implementing the full catalogue of gdd.md §3.4.
// React (ui agent) and engine subsystems talk through this bus; payloads are
// typed end-to-end via EventMap. `on` returns an unsubscribe function.
// ============================================================================

import type {
  DamageSchool,
  NotificationKind,
  RealmId,
  Vec3,
  WorldEvent,
  WorldEventPhase,
} from '../../contracts/types';

// ---------------------------------------------------------------------------
// Event catalogue (gdd.md §3.4 — LOCKED)
// ---------------------------------------------------------------------------

export interface EventMap {
  // combat → ui/audio (emitters: combat-ai)
  damage_number: { amount: number; isCrit: boolean; school: DamageSchool; position: Vec3; killed: boolean };
  player_hurt: { amount: number; blocked: boolean; parried: boolean };
  player_died: { sourceId: string };
  player_respawn: { realm: RealmId; position: Vec3 };
  level_up: { level: number; skillPoints: number };
  xp_gain: { amount: number; source: string };
  screen_shake: { intensity: number; durationMs: number };
  /** sfxId per design/audio-recipes.md. */
  play_sfx: { sfxId: string; position?: Vec3; volume?: number };
  // rpg/quests → ui (emitters: rpg-quests)
  dialogue_open: { npcId: string; treeId: string; nodeId: string };
  dialogue_advance: { nodeId: string };
  dialogue_close: Record<string, never>;
  quest_updated: { questId: string };
  /** Anyone may emit; UI-visible toasts should prefer store.notify(). */
  notification: { kind: NotificationKind; text: string; ttlMs?: number };
  // world (emitters: world; boss_* from combat-ai)
  realm_change: { from: RealmId; to: RealmId };
  world_event: { event: WorldEvent; phase: WorldEventPhase };
  boss_engaged: { enemyId: string; name: string };
  boss_disengaged: { enemyId: string };
  portal_enter: { to: RealmId };
  // engine → ui
  interact_target: { prompt: string | null };
  pointer_lock: { locked: boolean };
}

export interface GameEventBus {
  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void;
  on<K extends keyof EventMap>(type: K, fn: (p: EventMap[K]) => void): () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type AnyHandler = (payload: never) => void;

export function createEventBus(): GameEventBus {
  const listeners = new Map<keyof EventMap, Set<AnyHandler>>();

  return {
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set || set.size === 0) return;
      // Copy: listeners may subscribe/unsubscribe re-entrantly during emit.
      for (const fn of [...set]) {
        try {
          (fn as (p: EventMap[typeof type]) => void)(payload);
        } catch (err) {
          // One bad listener must never break the bus or the sim loop.
          console.error(`[events] listener for "${String(type)}" threw`, err);
        }
      }
    },
    on(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const handler = fn as AnyHandler;
      set.add(handler);
      return () => {
        set.delete(handler);
        if (set.size === 0) listeners.delete(type);
      };
    },
  };
}

/** The shared client-side bus. Created once; HMR-safe via dispose patterns. */
export const gameEvents: GameEventBus = createEventBus();
