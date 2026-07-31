// ============================================================================
// CORESAPIAN — src/game/world/events.ts
// Server-seeded world events (gdd §7.3, addendum §7): the schedule lives in
// the store WorldEvent slice; world simulates it deterministically from each
// event's `seed`, emits `world_event` phase transitions, and spawns/despawns
// event enemies in the CURRENT realm via the EnemyService. Also owns the
// ambient roaming-pack spawner (fixedUpdate stage 6, gdd §3.3).
// ============================================================================

import * as THREE from 'three';

import type { RealmId, Vec3, WorldEvent, WorldEventPhase } from '../../../contracts/types';
import { REALMS } from '../../../contracts/realms';
import type { SpawnEntry } from '../../../contracts/realms';
import { mulberry32 } from '../config';

import { getService } from './types';
import type { WorldContext } from './types';

// ---------------------------------------------------------------------------
// Roaming-spawn tuning (local flavor; enemies are client-simulated per gdd §10)
// ---------------------------------------------------------------------------

const ROAM_TARGET = 8;
const ROAM_CHECK_SEC = 3;
const ROAM_TTL_SEC = 240;
const ROAM_MIN_DIST = 55;
const ROAM_MAX_DIST = 85;
const ROAM_DESPAWN_DIST = 130;

export interface WorldEventsDeps {
  current(): RealmId;
  sampleHeight(x: number, z: number): number;
}

interface EventRec {
  phase: WorldEventPhase | null;
  spawned: string[];
}

interface RoamRec {
  id: string;
  bornSec: number;
  x: number;
  z: number;
}

export interface WorldEventsSim {
  fixedUpdate(dt: number): void;
  /** Called after a realm (re)build: clears old-realm spawns, seeds new ones. */
  onRealmChanged(): void;
  dispose(): void;
}

export function createWorldEventsSim(ctx: WorldContext, deps: WorldEventsDeps): WorldEventsSim {
  const recs = new Map<string, EventRec>();
  const roam: RoamRec[] = [];
  let roamTimer = 0;
  let simSec = 0;
  let roamRng = mulberry32(1);
  let roamRealm: RealmId | null = null;

  const tmpPos = new THREE.Vector3();

  // ------------------------------------------------------------ event phases

  const phaseOf = (e: WorldEvent, now: number): WorldEventPhase =>
    now < e.startsAt ? 'announced' : now < e.endsAt ? 'started' : 'ended';

  const announce = (e: WorldEvent, phase: WorldEventPhase): void => {
    const realm = REALMS[e.realm];
    const text =
      phase === 'announced'
        ? `${e.name} stirs in ${realm.displayName}.`
        : phase === 'started'
          ? `${e.name} has begun in ${realm.displayName}!`
          : `${e.name} has ended.`;
    ctx.store.getState().notify('event', text, 5000);
  };

  const despawnAll = (rec: EventRec): void => {
    const enemies = getService(ctx, 'enemies');
    if (!enemies) {
      rec.spawned.length = 0;
      return;
    }
    for (const id of rec.spawned) {
      try {
        enemies.despawnEnemy(id);
      } catch {
        /* enemy already gone (killed) */
      }
    }
    rec.spawned.length = 0;
  };

  const spawnFor = (e: WorldEvent, rec: EventRec): void => {
    if (rec.spawned.length > 0) return;
    if (e.realm !== deps.current()) return; // other realms: emit only
    const enemies = getService(ctx, 'enemies');
    if (!enemies) return;

    const realm = REALMS[e.realm];
    const rng = mulberry32(e.seed);
    const anchor = e.position ?? realm.bossArenaOffset;
    const at = (dx: number, dz: number): Vec3 => {
      const x = anchor.x + dx;
      const z = anchor.z + dz;
      return { x, y: deps.sampleHeight(x, z), z };
    };
    const spawn = (enemyId: string, pos: Vec3, tier: number): void => {
      try {
        rec.spawned.push(enemies.spawnEnemy(enemyId, pos, { realmTier: tier }));
      } catch (err) {
        console.warn('[world/events] spawn failed', err);
      }
    };

    if (e.kind === 'world_boss') {
      if (!e.bossEnemyId) return;
      const ang = rng() * Math.PI * 2;
      const rad = rng() * 4;
      spawn(e.bossEnemyId, at(Math.cos(ang) * rad, Math.sin(ang) * rad), realm.tier);
    } else if (e.kind === 'roaming_pack') {
      const entry = pickSpawnEntry(realm.spawnTable, rng);
      if (!entry) return;
      const count = entry.packMin + Math.floor(rng() * (entry.packMax - entry.packMin + 1));
      for (let i = 0; i < count; i++) {
        const ang = rng() * Math.PI * 2;
        const rad = 2 + rng() * 7;
        spawn(entry.enemyId, at(Math.cos(ang) * rad, Math.sin(ang) * rad), entry.tier);
      }
    }
    // resource_surge: no enemy spawns (harvest-flavored event).
  };

  const step = (): void => {
    const now = Date.now();
    const events = ctx.store.getState().events;
    const seen = new Set<string>();

    for (const e of events) {
      seen.add(e.eventId);
      let rec = recs.get(e.eventId);
      if (!rec) {
        rec = { phase: null, spawned: [] };
        recs.set(e.eventId, rec);
      }
      const phase = phaseOf(e, now);
      if (phase !== rec.phase) {
        rec.phase = phase;
        ctx.events.emit('world_event', { event: { ...e, phase }, phase });
        announce(e, phase);
        if (phase === 'started') spawnFor(e, rec);
        if (phase === 'ended') despawnAll(rec);
      }
    }

    // Events removed from the schedule (clearEvent / reschedule).
    for (const [id, rec] of recs) {
      if (!seen.has(id)) {
        despawnAll(rec);
        recs.delete(id);
      }
    }
  };

  // --------------------------------------------------------- roaming spawns

  const stepRoam = (dt: number): void => {
    roamTimer -= dt;
    if (roamTimer > 0) return;
    roamTimer = ROAM_CHECK_SEC;

    const realm = REALMS[deps.current()];
    if (roamRealm !== realm.id) {
      roamRealm = realm.id;
      roamRng = mulberry32(realm.terrain.seed * 7919 + 5);
    }

    const enemies = getService(ctx, 'enemies');
    const player = getService(ctx, 'player');
    if (!enemies || !player) return;
    if (realm.spawnTable.length === 0) return;

    const p = player.getPosition(tmpPos);

    // Prune expired / out-of-range spawns (kills are untracked — TTL churn).
    for (let i = roam.length - 1; i >= 0; i--) {
      const r = roam[i]!;
      const far = Math.hypot(r.x - p.x, r.z - p.z) > ROAM_DESPAWN_DIST;
      const old = simSec - r.bornSec > ROAM_TTL_SEC;
      if (far || old) {
        try {
          enemies.despawnEnemy(r.id);
        } catch {
          /* already gone */
        }
        roam.splice(i, 1);
      }
    }

    if (roam.length >= ROAM_TARGET) return;
    const entry = pickSpawnEntry(realm.spawnTable, roamRng);
    if (!entry) return;

    const ang = roamRng() * Math.PI * 2;
    const dist = ROAM_MIN_DIST + roamRng() * (ROAM_MAX_DIST - ROAM_MIN_DIST);
    const cx = p.x + Math.cos(ang) * dist;
    const cz = p.z + Math.sin(ang) * dist;
    if (Math.hypot(cx, cz) > 145) return;
    if (deps.sampleHeight(cx, cz) < 0.7) return;

    const count = entry.packMin + Math.floor(roamRng() * (entry.packMax - entry.packMin + 1));
    for (let i = 0; i < count; i++) {
      const a = roamRng() * Math.PI * 2;
      const r = 1.5 + roamRng() * 5;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = deps.sampleHeight(x, z);
      try {
        const id = enemies.spawnEnemy(entry.enemyId, { x, y, z }, { realmTier: entry.tier });
        roam.push({ id, bornSec: simSec, x, z });
      } catch {
        break; // enemy service not ready — retry next tick
      }
    }
  };

  return {
    fixedUpdate(dt) {
      simSec += dt;
      step();
      stepRoam(dt);
    },
    onRealmChanged() {
      for (const rec of recs.values()) despawnAll(rec);
      const enemies = getService(ctx, 'enemies');
      if (enemies) {
        for (const r of roam) {
          try {
            enemies.despawnEnemy(r.id);
          } catch {
            /* already gone */
          }
        }
      }
      roam.length = 0;
      roamRealm = null;
      // Re-seed event enemies that are mid-'started' in the new realm.
      const now = Date.now();
      for (const e of ctx.store.getState().events) {
        const rec = recs.get(e.eventId);
        if (rec && rec.phase === 'started' && phaseOf(e, now) === 'started') {
          spawnFor(e, rec);
        }
      }
    },
    dispose() {
      for (const rec of recs.values()) despawnAll(rec);
      recs.clear();
      roam.length = 0;
    },
  };
}

/** Weighted pick from a realm spawn table using the given PRNG stream. */
function pickSpawnEntry(table: SpawnEntry[], rng: () => number): SpawnEntry | null {
  if (table.length === 0) return null;
  let total = 0;
  for (const e of table) total += e.weight;
  let roll = rng() * total;
  for (const e of table) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return table[table.length - 1]!;
}
