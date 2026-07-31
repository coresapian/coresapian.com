// ============================================================================
// CORESAPIAN — src/game/quests/runtime.ts
// Quest campaign runtime (gdd §8, addendum §6/§7).
//
// - Quest state lives in the store Quest slice (`QuestState`); defs come from
//   contracts/quests.ts. This module is the ONLY writer of that slice.
// - Objective advancement:
//     kill/boss  ← `xp_gain.source` (enemy type ids; "boss:<enemyId>")
//     collect    ← store.items watcher (absolute sync, sticky-done per store)
//     talk       ← dialogue sessions opened with the target NPC
//     interact   ← spawned runic markers (interactables kind 'node' + glow)
//     reach      ← proximity check vs objective.position (realm-relative)
// - Completion pipeline (central store watcher):
//     all objectives done → branch? 'ready_to_turn_in' (branch UI surfaces)
//                         : 'completed' + grant rewards.
//   Rewards: xp via self-emitted `xp_gain {source:'quest:<id>'}`, gold/items
//   via a local quest_reward op, skill points via a progression pass-through
//   write (the frozen store has no addSkillPoints action), realm abilities via
//   unlockRealmAbility. Realm unlocks derive from quest completion per
//   addendum §7 (world reads store.quests) — nothing extra to do here.
// - Ambient triggers: chapter-giver proximity greets (6m) + realm first
//   arrival hints.
// ============================================================================

import * as THREE from 'three';

import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';
import type { ServiceRegistry } from '../services';
import type { QuestState, RealmId, Vec3 } from '../../../contracts/types';
import type { ObjectiveDef, QuestDef } from '../../../contracts/quests';
import { NPCS, QUESTS } from '../../../contracts/quests';
import { REALMS } from '../../../contracts/realms';
import { REALM_ABILITIES } from '../../../contracts/skills';
import { buildQuestRewardOp, submitOp } from '../rpg/ops';
import { countItem } from '../rpg/crafting';

/** Proximity radii (runtime tuning, not contract values). */
const GREET_RADIUS_M = 6;
const REACH_RADIUS_M = 6;
const MARKER_RADIUS_M = 2.5;

/** Golden angle for deterministic marker scatter rings. */
const GOLDEN_ANGLE = 2.399963229728653;

export interface NpcRosterQuery {
  /** Current world positions of spawned NPCs (current realm only). */
  getNpcPositions(): { npcId: string; realm: RealmId; position: Vec3 }[];
}

export interface QuestRuntimeDeps {
  store: UseGameStore;
  events: GameEventBus;
  scene: THREE.Scene;
  getServices(): ServiceRegistry | undefined;
}

export interface QuestRuntimeApi {
  /** Start a quest (idempotent). Called by dialogue effects. */
  startQuest(questId: string): void;
  /** Resolve a pending branch option (called by the dialogue interpreter). */
  chooseBranch(questId: string, optionId: string): void;
  /** dialogue 'advance_quest' effect: settle talk objectives / turn-ins. */
  advanceQuest(questId: string, npcId: string): void;
  /** Notify the runtime that a dialogue session opened with an NPC. */
  onDialogueOpened(npcId: string): void;
  /** Late-bind the npc roster (spawned after this runtime). */
  setRoster(roster: NpcRosterQuery): void;
  /** Positions of spawned shrine-type markers (alchemy stations, gdd §6.3). */
  getShrinePositions(): Vec3[];
  fixedUpdate(dt: number): void;
  dispose(): void;
}

interface MarkerInstance {
  key: string;
  questId: string;
  objectiveId: string;
  interactId: string;
  mesh: THREE.Mesh;
  unregister: () => void;
  baseY: number;
  phase: number;
}

function questLabel(def: QuestDef): string {
  return def.type === 'main' && def.chapter ? `Chapter ${def.chapter}: ${def.name}` : def.name;
}

/** Short human label from an interactId ('beacon_shrine' → 'Beacon Shrine'). */
function interactLabel(interactId: string): string {
  return interactId
    .split('_')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function createQuestRuntime(deps: QuestRuntimeDeps): QuestRuntimeApi {
  const { store, events, scene, getServices } = deps;

  let roster: NpcRosterQuery | null = null;
  let currentRealm: RealmId = 'midgard';
  let disposed = false;

  const markers = new Map<string, MarkerInstance>();
  const greeted = new Set<string>();
  const visitedRealms = new Set<RealmId>();
  let elapsed = 0;
  let sweepTimer = 0;

  // ------------------------------------------------------------- helpers

  const playerPos = (): THREE.Vector3 | null => {
    const svc = getServices();
    const player = svc?.get('player');
    if (!player) return null;
    return player.getPosition();
  };

  const terrainY = (x: number, z: number): number => {
    const svc = getServices();
    const terrain = svc?.get('terrain');
    return terrain ? terrain.sampleHeight(x, z) : 0;
  };

  const activeQuestIds = (): string[] =>
    Object.values(store.getState().quests)
      .filter((q) => q.status === 'active')
      .map((q) => q.questId);

  const emitUpdated = (questId: string): void => {
    events.emit('quest_updated', { questId });
  };

  // ------------------------------------------------------------- rewards

  const grantSkillPoints = (points: number): void => {
    if (points <= 0) return;
    const s = store.getState();
    // The frozen Progression slice has no addSkillPoints action; the only
    // write path is a full pass-through snapshot with the points added.
    s.applyServerProgression({
      xp: s.xp,
      level: s.level,
      skillPoints: s.skillPoints + points,
      skills: s.skills,
      realmAbilities: s.realmAbilities,
      quests: s.quests,
      factions: s.factions,
    });
  };

  const completeQuest = (questId: string): void => {
    const def = QUESTS[questId];
    const q = store.getState().quests[questId];
    if (!def || !q || q.status === 'completed') return;

    store.getState().setQuestState({ ...q, status: 'completed' });

    const r = def.rewards;
    if (r.xp > 0) events.emit('xp_gain', { amount: r.xp, source: `quest:${questId}` });
    if (r.gold > 0 || (r.items && r.items.length > 0)) {
      submitOp(buildQuestRewardOp(questId, r.items ?? [], r.gold));
    }
    if (r.skillPoints) grantSkillPoints(r.skillPoints);
    if (r.unlockRealmAbility) {
      store.getState().unlockRealmAbility(r.unlockRealmAbility);
      const ability = REALM_ABILITIES[r.unlockRealmAbility];
      if (ability) {
        store.getState().notify('quest', `Realm ability unlocked: ${ability.name} — ${ability.description}`, 7000);
      }
    }

    store.getState().notify('quest', `Quest complete: ${questLabel(def)}`, 6000);
    events.emit('play_sfx', { sfxId: 'sfx.notify.quest' });
    emitUpdated(questId);

    if (def.nextQuestId) {
      const next = QUESTS[def.nextQuestId];
      if (next) {
        store
          .getState()
          .notify('info', `The thread leads onward: ${next.name} (${REALMS[next.realm].displayName}).`, 7000);
      }
    }
  };

  // ------------------------------------------------------- start / branch

  const startQuest = (questId: string): void => {
    const def = QUESTS[questId];
    if (!def) {
      console.warn(`[quests] unknown quest id: ${questId}`);
      return;
    }
    const existing = store.getState().quests[questId];
    if (existing) return; // already active / completed

    const state: QuestState = {
      questId,
      status: 'active',
      objectives: def.objectives.map((o) => ({
        objectiveId: o.id,
        current: 0,
        target: o.qty,
        done: false,
      })),
      choices: {},
    };
    store.getState().setQuestState(state);
    store.getState().setActiveQuest(questId);
    store.getState().notify('quest', `New quest: ${questLabel(def)}`, 6000);
    events.emit('play_sfx', { sfxId: 'sfx.notify.quest' });
    emitUpdated(questId);
    syncCollectObjectives();
    syncMarkers();
  };

  const chooseBranch = (questId: string, optionId: string): void => {
    const def = QUESTS[questId];
    const q = store.getState().quests[questId];
    if (!def?.branch || !q || q.status !== 'ready_to_turn_in') return;
    if (q.choices[def.branch.id]) return;
    const option = def.branch.options.find((o) => o.id === optionId);
    if (!option) return;

    store.getState().recordChoice(questId, def.branch.id, optionId);
    for (const fd of option.factionDelta ?? []) {
      store.getState().applyFactionDelta(fd.factionId, fd.delta);
    }
    store.getState().notify('quest', option.outcomeText, 9000);
    if (option.bonusXp && option.bonusXp > 0) {
      events.emit('xp_gain', { amount: option.bonusXp, source: `quest:${questId}` });
    }
    completeQuest(questId);
  };

  const advanceQuest = (questId: string, npcId: string): void => {
    const def = QUESTS[questId];
    const q = store.getState().quests[questId];
    if (!def || !q || q.status !== 'active') return;
    for (const obj of def.objectives) {
      if (obj.kind === 'talk' && obj.npcId === npcId) {
        store.getState().progressObjective(questId, obj.id, 1);
      }
    }
  };

  const onDialogueOpened = (npcId: string): void => {
    for (const questId of activeQuestIds()) {
      const def = QUESTS[questId];
      if (!def) continue;
      for (const obj of def.objectives) {
        if (obj.kind === 'talk' && obj.npcId === npcId) {
          store.getState().progressObjective(questId, obj.id, 1);
        }
      }
    }
  };

  // ---------------------------------------------------- objective drivers

  // kill/boss objectives ← xp_gain.source (addendum §6)
  const unsubXp = events.on('xp_gain', ({ source }) => {
    for (const questId of activeQuestIds()) {
      const def = QUESTS[questId];
      if (!def) continue;
      for (const obj of def.objectives) {
        if (obj.kind === 'kill' && obj.enemyId === source) {
          store.getState().progressObjective(questId, obj.id, 1);
        } else if (
          obj.kind === 'boss' &&
          (source === `boss:${obj.enemyId}` || source === obj.enemyId)
        ) {
          store.getState().progressObjective(questId, obj.id, 1);
        }
      }
    }
  });

  // collect objectives ← inventory watcher (absolute sync; store keeps done sticky)
  const syncCollectObjectives = (): void => {
    const s = store.getState();
    for (const q of Object.values(s.quests)) {
      if (q.status !== 'active') continue;
      const def = QUESTS[q.questId];
      if (!def) continue;
      for (const obj of def.objectives) {
        if (obj.kind !== 'collect' || !obj.itemId) continue;
        const state = q.objectives.find((o) => o.objectiveId === obj.id);
        if (!state || state.done) continue;
        const total = countItem(s.items, obj.itemId);
        const delta = total - state.current;
        if (delta !== 0) s.progressObjective(q.questId, obj.id, delta);
      }
    }
  };

  let lastItems: unknown = null;
  const unsubItems = store.subscribe(() => {
    const items = store.getState().items;
    if (items !== lastItems) {
      lastItems = items;
      syncCollectObjectives();
    }
  });

  // reach objectives ← proximity (checked in fixedUpdate)
  const checkReachObjectives = (): void => {
    const pos = playerPos();
    if (!pos) return;
    for (const questId of activeQuestIds()) {
      const def = QUESTS[questId];
      if (!def || def.realm !== currentRealm) continue;
      for (const obj of def.objectives) {
        if (obj.kind !== 'reach' || !obj.position) continue;
        const st = store.getState().quests[questId]?.objectives.find(
          (o) => o.objectiveId === obj.id,
        );
        if (!st || st.done) continue;
        const dx = pos.x - obj.position.x;
        const dz = pos.z - obj.position.z;
        if (dx * dx + dz * dz <= REACH_RADIUS_M * REACH_RADIUS_M) {
          store.getState().progressObjective(questId, obj.id, 1);
        }
      }
    }
  };

  // ------------------------------------------------------ interact markers

  const markerKey = (questId: string, objectiveId: string, index: number): string =>
    `qmark:${questId}:${objectiveId}:${index}`;

  const despawnMarker = (key: string): void => {
    const m = markers.get(key);
    if (!m) return;
    markers.delete(key);
    m.unregister();
    scene.remove(m.mesh);
    m.mesh.geometry.dispose();
    (m.mesh.material as THREE.Material).dispose();
  };

  const spawnMarker = (
    def: QuestDef,
    obj: ObjectiveDef,
    index: number,
  ): void => {
    const svc = getServices();
    const interactables = svc?.get('interactables');
    if (!interactables) return;

    // Anchor at the quest giver's live position when available (markers ring
    // the giver's steading), else the realm center.
    const giverPos = roster
      ?.getNpcPositions()
      .find((n) => n.npcId === def.giverId)?.position;
    const ax = giverPos?.x ?? 0;
    const az = giverPos?.z ?? 0;
    const angle = index * GOLDEN_ANGLE;
    const radius = 8 + 5 * index;
    const x = ax + Math.cos(angle) * radius;
    const z = az + Math.sin(angle) * radius;
    const y = terrainY(x, z);

    const key = markerKey(def.id, obj.id, index);
    const questId = def.id;
    const objectiveId = obj.id;

    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({
        color: 0x2a2418,
        emissive: 0xffb64a,
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.1,
      }),
    );
    mesh.position.set(x, y + 1.1, z);
    scene.add(mesh);

    const label = obj.interactId ? interactLabel(obj.interactId) : obj.text;
    const unregister = interactables.register({
      id: key,
      kind: 'node',
      prompt: `E — ${label}`,
      position: new THREE.Vector3(x, y + 1.1, z),
      radius: MARKER_RADIUS_M,
      isAvailable: () => {
        const st = store.getState().quests[questId]?.objectives.find(
          (o) => o.objectiveId === objectiveId,
        );
        return !!st && !st.done;
      },
      onInteract: () => {
        store.getState().progressObjective(questId, objectiveId, 1);
        events.emit('play_sfx', { sfxId: 'sfx.harvest' });
        despawnMarker(key);
      },
    });

    markers.set(key, {
      key,
      questId,
      objectiveId,
      interactId: obj.interactId ?? '',
      mesh,
      unregister,
      baseY: y + 1.1,
      phase: index * 1.7,
    });
  };

  /** Reconcile spawned markers with active quests in the current realm. */
  const syncMarkers = (): void => {
    const wanted = new Set<string>();
    for (const questId of activeQuestIds()) {
      const def = QUESTS[questId];
      if (!def || def.realm !== currentRealm) continue;
      for (const obj of def.objectives) {
        if (obj.kind !== 'interact' || !obj.interactId) continue;
        const st = store.getState().quests[questId]?.objectives.find(
          (o) => o.objectiveId === obj.id,
        );
        if (!st || st.done) continue;
        const remaining = obj.qty - st.current;
        for (let i = 0; i < remaining; i++) {
          const key = markerKey(questId, obj.id, st.current + i);
          wanted.add(key);
          if (!markers.has(key)) spawnMarker(def, obj, st.current + i);
        }
      }
    }
    for (const key of [...markers.keys()]) {
      if (!wanted.has(key)) despawnMarker(key);
    }
  };

  // ------------------------------------------- central quest-state watcher

  let lastQuests: Record<string, QuestState> = {};
  let watching = false;

  const watchQuests = (): void => {
    if (watching) return;
    watching = true;
    try {
      // Loop: completing a quest mutates the slice; settle until quiescent.
      for (let guard = 0; guard < 4; guard++) {
        const quests = store.getState().quests;
        let mutated = false;

        for (const [questId, q] of Object.entries(quests)) {
          const def = QUESTS[questId];
          const prev = lastQuests[questId];
          if (!def || prev === q) continue;

          // Toasts for newly completed objectives.
          if (prev) {
            for (const objState of q.objectives) {
              const was = prev.objectives.find(
                (o) => o.objectiveId === objState.objectiveId,
              );
              if (objState.done && was && !was.done) {
                const objDef = def.objectives.find((o) => o.id === objState.objectiveId);
                if (objDef) {
                  store
                    .getState()
                    .notify('quest', `${objDef.text} — done (${objState.target}/${objState.target}).`);
                  events.emit('play_sfx', { sfxId: 'sfx.notify.quest' });
                  emitUpdated(questId);
                }
              }
            }
          }

          if (q.status === 'active' && q.objectives.every((o) => o.done)) {
            if (def.branch && !q.choices[def.branch.id]) {
              // Objectives complete; branch choice pending (surfaced by ui /
              // the dialogue runtime via the 'branch:' sentinel node).
              store.getState().setQuestState({ ...q, status: 'ready_to_turn_in' });
              store
                .getState()
                .notify('quest', `${questLabel(def)} — a choice waits on your wyrd.`, 7000);
              emitUpdated(questId);
              mutated = true;
            } else if (!def.branch) {
              completeQuest(questId);
              mutated = true;
            }
          }
        }

        lastQuests = { ...store.getState().quests };
        if (!mutated) break;
      }
    } finally {
      watching = false;
      // Re-entrant writes blocked during our pass (e.g. collect objectives
      // synced from a quest_reward item grant): run one catch-up pass.
      const now = store.getState().quests;
      for (const [id, q] of Object.entries(now)) {
        if (lastQuests[id] !== q) {
          watchQuests();
          break;
        }
      }
    }
  };

  const unsubQuests = store.subscribe(watchQuests);

  // ----------------------------------------------------- ambient triggers

  const realmArrivalHint = (realm: RealmId): void => {
    if (visitedRealms.has(realm)) return;
    visitedRealms.add(realm);
    const questId = REALMS[realm].chapterQuestId;
    const def = QUESTS[questId];
    if (!def) return;
    if (store.getState().quests[questId]) return; // already started/completed
    const giver = NPCS[def.giverId];
    store
      .getState()
      .notify(
        'info',
        `${REALMS[realm].displayName}: ${questLabel(def)} — find ${giver?.name ?? def.giverId}.`,
        8000,
      );
  };

  const unsubRealm = events.on('realm_change', ({ to }) => {
    currentRealm = to;
    greeted.clear();
    for (const key of [...markers.keys()]) despawnMarker(key);
    realmArrivalHint(to);
    syncMarkers();
  });

  const checkGreets = (): void => {
    if (!roster) return;
    const pos = playerPos();
    if (!pos) return;
    for (const npc of roster.getNpcPositions()) {
      if (npc.realm !== currentRealm || greeted.has(npc.npcId)) continue;
      const def = NPCS[npc.npcId];
      if (!def) continue;
      const pendingQuestId = def.questIds.find((qid) => !store.getState().quests[qid]);
      if (!pendingQuestId) continue;
      const dx = pos.x - npc.position.x;
      const dz = pos.z - npc.position.z;
      if (dx * dx + dz * dz <= GREET_RADIUS_M * GREET_RADIUS_M) {
        greeted.add(npc.npcId);
        const qdef = QUESTS[pendingQuestId];
        store
          .getState()
          .notify('quest', `${def.name} has work for you: ${qdef?.name ?? pendingQuestId}.`, 6000);
      }
    }
  };

  // ------------------------------------------------------------- lifecycle

  const api: QuestRuntimeApi = {
    startQuest,
    chooseBranch,
    advanceQuest,
    onDialogueOpened,
    setRoster(r) {
      roster = r;
    },

    getShrinePositions(): Vec3[] {
      const out: Vec3[] = [];
      for (const m of markers.values()) {
        if (m.interactId.includes('shrine')) {
          out.push({ x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z });
        }
      }
      return out;
    },

    fixedUpdate(dt: number): void {
      if (disposed) return;
      elapsed += dt;
      sweepTimer += dt;

      checkReachObjectives();
      checkGreets();

      // Marker bob/spin + slow resync.
      for (const m of markers.values()) {
        m.mesh.rotation.y += dt * 1.2;
        m.mesh.position.y = m.baseY + Math.sin(elapsed * 2 + m.phase) * 0.12;
      }
      if (sweepTimer >= 0.5) {
        sweepTimer = 0;
        syncMarkers();
      }
    },

    dispose(): void {
      disposed = true;
      unsubXp();
      unsubItems();
      unsubQuests();
      unsubRealm();
      for (const key of [...markers.keys()]) despawnMarker(key);
    },
  };

  // Hydrate from any pre-existing state (server-restored quests) and seed the
  // home-realm arrival hint.
  lastQuests = { ...store.getState().quests };
  syncCollectObjectives();
  realmArrivalHint(currentRealm);
  syncMarkers();

  return api;
}
