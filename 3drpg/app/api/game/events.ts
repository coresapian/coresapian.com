// ============================================================================
// api/game/events.ts — server-seeded world-event schedule (gdd.md §7.3).
// Deterministic: the whole chain derives from a fixed genesis + constant PRNG
// seed, so every server instance (and every restart) produces the identical
// schedule, and clients simulate identical events from each event's `seed`.
//   - world bosses every 20–40 min, live 10 min, announced 90 s ahead
//   - schedule horizon: next 24 h, sent in `welcome`
//   - phase transitions (announced -> started -> ended) broadcast to all
// ============================================================================

import type { RealmId, WorldEvent, WorldEventPhase } from "@contracts/types";
import { REALMS } from "@contracts/realms";
import { WORLD_BOSSES } from "@contracts/enemies";

// --- tuning (gdd.md §7.3) ---------------------------------------------------
export const EVENT_ANNOUNCE_LEAD_MS = 90_000; // announced 90s ahead
export const EVENT_LIVE_MS = 10 * 60_000; // live 10 minutes
export const EVENT_GAP_MIN_MS = 20 * 60_000; // 20–40 min between events
export const EVENT_GAP_MAX_MS = 40 * 60_000;
export const EVENT_HORIZON_MS = 24 * 60 * 60_000; // 24h schedule in welcome
export const EVENT_KEEP_ENDED_MS = 60_000; // keep ended events this long

/** Fixed schedule origin — determinism across restarts depends on this constant. */
const GENESIS_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
/** Fixed PRNG seed (arbitrary constant, never tuned without a version bump). */
const SCHEDULE_SEED = 0xc0e51a9e;

/** Boss rotation pools. Surtr walks only in Muspelheim (gdd.md §7.3). */
const BOSS_REALM_POOLS: Record<string, RealmId[]> = {
  wboss_hraesvelgr: ["midgard", "alfheim", "vanaheim"], // any temperate realm
  wboss_nidhogg: ["svartalfheim", "niflheim", "jotunheim"], // root-serpent
  wboss_surtr: ["muspelheim"],
};
const BOSS_IDS = Object.keys(BOSS_REALM_POOLS);

// ---------------------------------------------------------------------------
// mulberry32 — tiny deterministic PRNG (state kept explicitly for chain gen)
// ---------------------------------------------------------------------------

function nextRandom(state: number): { state: number; value: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: a >>> 0, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

// ---------------------------------------------------------------------------
// EventSchedule
// ---------------------------------------------------------------------------

export class EventSchedule {
  private rngState = SCHEDULE_SEED;
  private nextStartsAt = GENESIS_MS;
  private seq = 0;
  /** Recent + upcoming events (pruned to EVENT_KEEP_ENDED_MS behind now). */
  private window: WorldEvent[] = [];
  /** Last phase emitted per event (for transition detection). */
  private phaseEmitted = new Map<string, WorldEventPhase>();

  constructor(private readonly now: () => number = Date.now) {
    this.refresh();
  }

  private rand(): number {
    const r = nextRandom(this.rngState);
    this.rngState = r.state;
    return r.value;
  }

  /** Generate the next event in the chain and append to the window. */
  private advance(): void {
    const gapMs = EVENT_GAP_MIN_MS + this.rand() * (EVENT_GAP_MAX_MS - EVENT_GAP_MIN_MS);
    const startsAt = Math.round(this.nextStartsAt + (this.seq === 0 ? gapMs : EVENT_LIVE_MS + gapMs));
    const bossEnemyId = BOSS_IDS[Math.floor(this.rand() * BOSS_IDS.length)];
    const pool = BOSS_REALM_POOLS[bossEnemyId];
    const realm = pool[Math.floor(this.rand() * pool.length)];
    const seed = Math.floor(this.rand() * 0x7fffffff);
    const arena = REALMS[realm].bossArenaOffset;
    const event: WorldEvent = {
      eventId: `wev_${startsAt.toString(36)}_${this.seq}`,
      kind: "world_boss",
      realm,
      seed,
      name: WORLD_BOSSES[bossEnemyId]?.name ?? "World Boss",
      startsAt,
      endsAt: startsAt + EVENT_LIVE_MS,
      phase: "announced",
      bossEnemyId,
      position: { x: arena.x, y: arena.y, z: arena.z },
    };
    this.seq++;
    this.nextStartsAt = startsAt;
    this.window.push(event);
  }

  /** Ensure the window covers [now - keep, now + horizon] and prune the past. */
  private refresh(): void {
    const now = this.now();
    // Fast-forward the chain until the horizon is covered (also used at boot
    // to skip the long-gone tail from GENESIS).
    while (this.window.length === 0 || this.window[this.window.length - 1].endsAt < now + EVENT_HORIZON_MS) {
      this.advance();
    }
    const cutoff = now - EVENT_KEEP_ENDED_MS;
    while (this.window.length > 0 && this.window[0].endsAt < cutoff) {
      const dropped = this.window.shift();
      if (dropped) this.phaseEmitted.delete(dropped.eventId);
    }
  }

  /**
   * Effective phase at `at`; null before the 90s announcement lead.
   * Note: schedule entries sent in `welcome` label pre-announcement events
   * 'announced' (the WorldEventPhase union has no 'scheduled' value) — the
   * startsAt/endsAt timestamps + seed are the source of truth clients
   * simulate from.
   */
  private phaseAt(event: WorldEvent, at: number): WorldEventPhase | null {
    if (at >= event.endsAt) return "ended";
    if (at >= event.startsAt) return "started";
    if (at >= event.startsAt - EVENT_ANNOUNCE_LEAD_MS) return "announced";
    return null;
  }

  /** Full rolling schedule for `welcome` (next 24h + just-ended tail). */
  schedule(): WorldEvent[] {
    this.refresh();
    const now = this.now();
    return this.window.map((ev) => ({ ...ev, phase: this.phaseAt(ev, now) ?? "announced" }));
  }

  /**
   * Phase transitions since the previous poll. Each returned event is a full
   * WorldEvent with its new phase — broadcast as `event` messages and folded
   * into the next `snapshot.events`.
   */
  pollTransitions(): WorldEvent[] {
    this.refresh();
    const now = this.now();
    const out: WorldEvent[] = [];
    for (const ev of this.window) {
      const phase = this.phaseAt(ev, now);
      if (!phase) continue;
      if (this.phaseEmitted.get(ev.eventId) !== phase) {
        this.phaseEmitted.set(ev.eventId, phase);
        out.push({ ...ev, phase });
      }
    }
    return out;
  }
}
