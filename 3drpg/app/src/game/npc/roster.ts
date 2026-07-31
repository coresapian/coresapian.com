// ============================================================================
// CORESAPIAN — src/game/npc/roster.ts
// The 12-NPC roster (contracts/quests.ts NPCS), spawned per realm:
// procedural figures + nameplates (npc/mesh.ts), 24h schedules
// (1 game hour = 60 real seconds, gdd §8.3), talk interactables
// ('npc', 3m, gdd §4), shop keeper wake/sleep state (shops close while the
// keeper sleeps; quest NPCs stay interactable), and crafting-station
// proximity tracking for ui (via rpg/ops.ts getCurrentStation).
// ============================================================================

import * as THREE from 'three';

import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';
import type { ServiceRegistry } from '../services';
import type { RealmId, Vec3 } from '../../../contracts/types';
import type { CraftStation } from '../../../contracts/items';
import type { NpcDef, ScheduleBlock } from '../../../contracts/quests';
import { NPCS } from '../../../contracts/quests';
import { buildNpcVisual } from './mesh';
import type { NpcVisual } from './mesh';
import type { DialogueRuntimeApi } from '../quests/dialogue';
import type { NpcRosterQuery } from '../quests/runtime';
import { setShopKeeperAwake } from '../rpg/shops';
import { setStationProvider } from '../rpg/ops';

/** Day starts at 08:00 when the session boots. */
const START_HOUR = 8;
/** 1 game hour = 60 real seconds (gdd §8.3). */
const SECONDS_PER_GAME_HOUR = 60;
const WALK_SPEED_MPS = 1.6;
const TALK_RADIUS_M = 3; // gdd §4 interaction volumes
const STATION_RADIUS_M = 4;
const FACE_RADIUS_M = 8;
const WANDER_RADIUS_M = 2.5;

export interface NpcRosterDeps {
  store: UseGameStore;
  events: GameEventBus;
  scene: THREE.Scene;
  getServices(): ServiceRegistry | undefined;
  dialogue: DialogueRuntimeApi;
}

export interface NpcRosterApi extends NpcRosterQuery {
  /** Late-bind: positions of shrine-type quest markers (alchemy stations). */
  setShrineProvider(fn: () => Vec3[]): void;
  fixedUpdate(dt: number): void;
  dispose(): void;
}

interface NpcInstance {
  def: NpcDef;
  visual: NpcVisual;
  pos: THREE.Vector3;
  interactablePos: THREE.Vector3;
  unregister: () => void;
  activity: ScheduleBlock['activity'] | null;
  wanderSeed: number;
}

function blockAt(schedule: ScheduleBlock[], hour: number): ScheduleBlock {
  for (const b of schedule) {
    if (hour >= b.startHour && hour < b.endHour) return b;
  }
  return schedule[schedule.length - 1];
}

export function createNpcRoster(deps: NpcRosterDeps): NpcRosterApi {
  const { events, scene, getServices, dialogue } = deps;

  const instances = new Map<string, NpcInstance>();
  let currentRealm: RealmId = 'midgard';
  let elapsed = 0;
  let disposed = false;
  let shrineProvider: (() => Vec3[]) | null = null;

  const terrainY = (x: number, z: number): number => {
    const terrain = getServices()?.get('terrain');
    return terrain ? terrain.sampleHeight(x, z) : 0;
  };

  const gameHour = (): number => (START_HOUR + elapsed / SECONDS_PER_GAME_HOUR) % 24;

  // ------------------------------------------------------------ spawn sync

  const spawn = (def: NpcDef): void => {
    const svc = getServices();
    const block = blockAt(def.schedule, gameHour());
    const x = block.location.x;
    const z = block.location.z;
    const y = terrainY(x, z);

    const visual = buildNpcVisual(def);
    visual.group.position.set(x, y, z);
    scene.add(visual.group);

    const interactablePos = new THREE.Vector3(x, y + 1, z);
    const unregister =
      svc?.get('interactables')?.register({
        id: `npc:${def.id}`,
        kind: 'npc',
        // Quest NPCs are always interactable (gdd §8.3) — sleeping shop
        // keepers still answer, their shop just stays closed.
        prompt: `E — Talk to ${def.name}`,
        position: interactablePos,
        radius: TALK_RADIUS_M,
        onInteract: () => dialogue.openFor(def.id),
      }) ?? (() => {});

    instances.set(def.id, {
      def,
      visual,
      pos: new THREE.Vector3(x, y, z),
      interactablePos,
      unregister,
      activity: block.activity,
      wanderSeed: Math.random() * Math.PI * 2,
    });
    if (def.shopId) setShopKeeperAwake(def.shopId, block.activity !== 'sleep');
  };

  const despawn = (npcId: string): void => {
    const inst = instances.get(npcId);
    if (!inst) return;
    instances.delete(npcId);
    inst.unregister();
    scene.remove(inst.visual.group);
    inst.visual.dispose();
  };

  const syncSpawn = (): void => {
    const wanted = new Set(
      Object.values(NPCS)
        .filter((n) => n.realm === currentRealm)
        .map((n) => n.id),
    );
    for (const npcId of [...instances.keys()]) {
      if (!wanted.has(npcId)) despawn(npcId);
    }
    for (const npcId of wanted) {
      if (!instances.has(npcId)) spawn(NPCS[npcId]);
    }
  };

  const unsubRealm = events.on('realm_change', ({ to }) => {
    currentRealm = to;
    syncSpawn();
  });

  // ----------------------------------------------------------- fixedUpdate

  const nearestStation = (playerPos: THREE.Vector3): CraftStation => {
    let station: CraftStation = 'none';
    const r2 = STATION_RADIUS_M * STATION_RADIUS_M;
    for (const inst of instances.values()) {
      const dx = playerPos.x - inst.pos.x;
      const dz = playerPos.z - inst.pos.z;
      if (dx * dx + dz * dz > r2) continue;
      if (inst.def.role === 'smith') return 'forge'; // forge outranks alchemy
      if (inst.def.shopId === 'shop_eira') station = 'alchemy';
    }
    if (station === 'none' && shrineProvider) {
      for (const p of shrineProvider()) {
        const dx = playerPos.x - p.x;
        const dz = playerPos.z - p.z;
        if (dx * dx + dz * dz <= r2) {
          station = 'alchemy';
          break;
        }
      }
    }
    return station;
  };

  let currentStation: CraftStation = 'none';
  setStationProvider(() => currentStation);

  const fixedUpdate = (dt: number): void => {
    if (disposed) return;
    elapsed += dt;
    const hour = gameHour();
    const player = getServices()?.get('player');
    const playerPos = player?.getPosition() ?? null;

    for (const inst of instances.values()) {
      const block = blockAt(inst.def.schedule, hour);

      // Keeper sleep/wake → shop open state (only on transitions).
      if (inst.def.shopId && inst.activity !== block.activity) {
        setShopKeeperAwake(inst.def.shopId, block.activity !== 'sleep');
      }
      inst.activity = block.activity;

      // Schedule target (+ slow drift for 'wander').
      let tx = block.location.x;
      let tz = block.location.z;
      if (block.activity === 'wander') {
        tx += Math.cos(elapsed * 0.25 + inst.wanderSeed) * WANDER_RADIUS_M;
        tz += Math.sin(elapsed * 0.22 + inst.wanderSeed * 1.7) * WANDER_RADIUS_M;
      }

      const dx = tx - inst.pos.x;
      const dz = tz - inst.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, WALK_SPEED_MPS * dt);
        inst.pos.x += (dx / dist) * step;
        inst.pos.z += (dz / dist) * step;
      }
      inst.pos.y = terrainY(inst.pos.x, inst.pos.z);
      inst.visual.group.position.copy(inst.pos);
      inst.interactablePos.set(inst.pos.x, inst.pos.y + 1, inst.pos.z);

      // Face the player when near.
      if (playerPos) {
        const fdx = playerPos.x - inst.pos.x;
        const fdz = playerPos.z - inst.pos.z;
        if (fdx * fdx + fdz * fdz <= FACE_RADIUS_M * FACE_RADIUS_M) {
          inst.visual.group.rotation.y = Math.atan2(fdx, fdz);
        }
      }
    }

    currentStation = playerPos ? nearestStation(playerPos) : 'none';
  };

  // Seed the initial realm (server restore may have moved us before init).
  const realmSvc = getServices()?.get('realms');
  if (realmSvc) currentRealm = realmSvc.current();
  syncSpawn();

  return {
    setShrineProvider(fn) {
      shrineProvider = fn;
    },

    getNpcPositions() {
      return [...instances.values()].map((inst) => ({
        npcId: inst.def.id,
        realm: inst.def.realm,
        position: { x: inst.pos.x, y: inst.pos.y, z: inst.pos.z },
      }));
    },

    fixedUpdate,

    dispose(): void {
      disposed = true;
      unsubRealm();
      for (const npcId of [...instances.keys()]) despawn(npcId);
      setStationProvider(() => 'none');
    },
  };
}
