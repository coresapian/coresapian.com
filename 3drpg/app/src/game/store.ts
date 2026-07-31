// ============================================================================
// CORESAPIAN — src/game/store.ts (SCAFFOLD-OWNED, FROZEN)
// The zustand GameStore. Implements contracts/store-api.ts `GameStore` in full.
// Persistence: settings + identity slices only, via zustand persist middleware
// with a custom storage adapter that maps onto the three locked localStorage
// keys: `coresapian.settings`, `coresapian.playerId`, `coresapian.name`.
// All other slices are session-only (gdd.md §2).
// ============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import type { GameStore, SettingsSlice } from '../../contracts/store-api';
import type {
  Equipment,
  ItemInstance,
  PlayerVitals,
  RemotePlayer,
} from '../../contracts/types';
import { BASE_VITALS, EQUIP_SLOTS } from '../../contracts/types';
import {
  LEVEL_CAP,
  SKILL_NODES,
  SKILL_POINTS_PER_LEVEL,
  xpToNext as xpToNextForLevel,
} from '../../contracts/skills';
import { NAME_PATTERN } from '../../contracts/netcode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** crypto.randomUUID with a non-secure-context fallback. */
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function emptyEquipment(): Equipment {
  return Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, null])) as Equipment;
}

// ---------------------------------------------------------------------------
// Persistence — three locked keys via a custom StateStorage adapter over the
// persist middleware JSON envelope ({ state, version }).
// ---------------------------------------------------------------------------

const LS_SETTINGS = 'coresapian.settings';
const LS_PLAYER_ID = 'coresapian.playerId';
const LS_NAME = 'coresapian.name';

type SettingsValues = Omit<SettingsSlice, 'updateSettings'>;

interface PersistedSlices {
  playerId: string;
  displayName: string;
  settings: SettingsValues;
}

const DEFAULT_SETTINGS: SettingsValues = {
  mouseSensitivity: 1,
  invertY: false,
  fov: 80,
  volumeMaster: 1,
  volumeMusic: 0.8,
  volumeSfx: 1,
  quality: 'high',
  showFps: false,
};

function extractSettings(s: GameStore): SettingsValues {
  return {
    mouseSensitivity: s.mouseSensitivity,
    invertY: s.invertY,
    fov: s.fov,
    volumeMaster: s.volumeMaster,
    volumeMusic: s.volumeMusic,
    volumeSfx: s.volumeSfx,
    quality: s.quality,
    showFps: s.showFps,
  };
}

/** Splits the single persist envelope across the three locked keys. */
const splitKeyStorage: StateStorage = {
  getItem: () => {
    try {
      const settingsRaw = localStorage.getItem(LS_SETTINGS);
      const playerId = localStorage.getItem(LS_PLAYER_ID);
      const name = localStorage.getItem(LS_NAME);
      if (settingsRaw === null && playerId === null && name === null) return null;
      const state: Partial<PersistedSlices> = {};
      if (playerId) state.playerId = playerId;
      if (name) state.displayName = name;
      if (settingsRaw)
        state.settings = {
          ...DEFAULT_SETTINGS,
          ...(JSON.parse(settingsRaw) as Partial<SettingsValues>),
        };
      return JSON.stringify({ state, version: 0 });
    } catch {
      return null;
    }
  },
  setItem: (_name, value) => {
    try {
      const envelope = JSON.parse(value) as { state?: Partial<PersistedSlices> };
      const state = envelope.state;
      if (!state) return;
      if (state.settings) localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
      if (state.playerId) localStorage.setItem(LS_PLAYER_ID, state.playerId);
      if (state.displayName) localStorage.setItem(LS_NAME, state.displayName);
    } catch {
      /* storage full / unavailable — session-only */
    }
  },
  removeItem: () => {
    try {
      localStorage.removeItem(LS_SETTINGS);
      localStorage.removeItem(LS_PLAYER_ID);
      localStorage.removeItem(LS_NAME);
    } catch {
      /* noop */
    }
  },
};

// ---------------------------------------------------------------------------
// Net slice bookkeeping: wall-clock last-seen for >3s prune (gdd §2 NetSlice).
// ---------------------------------------------------------------------------

const remoteLastSeen = new Map<string, number>();
const REMOTE_PRUNE_MS = 3000;
const NOTIFICATION_CAP = 6;
const DEFAULT_NOTIFICATION_TTL_MS = 4000;

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      // ------------------------------------------------------------- identity
      playerId: uid(),
      displayName: 'Wanderer',
      setDisplayName: (name) => {
        const trimmed = name.trim();
        if (!NAME_PATTERN.test(trimmed)) return; // invalid names rejected (netcode.ts)
        set({ displayName: trimmed });
      },

      // -------------------------------------------------------------- vitals
      vitals: { ...BASE_VITALS },
      dead: false,
      setVitals: (patch) => set((s) => ({ vitals: { ...s.vitals, ...patch } })),
      applyServerVitals: (v) =>
        set((s) => ({
          vitals: {
            ...s.vitals,
            hp: Math.min(v.hp, v.maxHp),
            maxHp: v.maxHp,
            wyrd: Math.min(v.wyrd, v.maxWyrd),
            maxWyrd: v.maxWyrd,
          },
        })),
      setDead: (dead) => set({ dead }),

      // ---------------------------------------------------------- progression
      xp: 0,
      level: 1,
      xpToNext: xpToNextForLevel(1),
      skillPoints: 0,
      skills: {},
      realmAbilities: [],
      addXp: (amount) =>
        set((s) => {
          if (amount <= 0 || s.level >= LEVEL_CAP) return {};
          let xp = s.xp + amount;
          let level = s.level;
          let skillPoints = s.skillPoints;
          let toNext = s.xpToNext;
          while (level < LEVEL_CAP && xp >= toNext) {
            xp -= toNext;
            level += 1;
            skillPoints += SKILL_POINTS_PER_LEVEL;
            toNext = xpToNextForLevel(level);
          }
          return { xp, level, skillPoints, xpToNext: toNext };
        }),
      spendSkillPoint: (nodeId) => {
        const s = get();
        const node = SKILL_NODES[nodeId];
        if (!node) return false;
        const rank = s.skills[nodeId] ?? 0;
        if (rank >= node.maxRank) return false;
        if (s.skillPoints < node.costPerRank) return false;
        const reqsMet = node.requires.every((req) => (s.skills[req] ?? 0) >= 1);
        if (!reqsMet) return false;
        set({
          skillPoints: s.skillPoints - node.costPerRank,
          skills: { ...s.skills, [nodeId]: rank + 1 },
        });
        return true;
      },
      unlockRealmAbility: (abilityId) =>
        set((s) =>
          s.realmAbilities.includes(abilityId)
            ? {}
            : { realmAbilities: [...s.realmAbilities, abilityId] },
        ),
      applyServerProgression: (p) =>
        set({
          xp: p.xp,
          level: p.level,
          xpToNext: xpToNextForLevel(p.level),
          skillPoints: p.skillPoints,
          skills: { ...p.skills },
          realmAbilities: [...p.realmAbilities],
          quests: { ...p.quests },
          factions: { ...p.factions },
        }),

      // ----------------------------------------------------------- inventory
      items: [] as ItemInstance[],
      gold: 0,
      revision: 0,
      pendingOps: [] as string[],
      beginOp: (opId) => {
        const s = get();
        if (s.pendingOps.includes(opId)) return false;
        set({ pendingOps: [...s.pendingOps, opId] });
        return true;
      },
      applyInventorySnapshot: (snap) =>
        set({
          items: snap.items,
          gold: snap.gold,
          revision: snap.revision,
          equipment: snap.equipment,
          runeLoadout: snap.runeLoadout,
        }),
      applyInventoryAck: (opId, ok, snap) =>
        set((s) => ({
          pendingOps: s.pendingOps.filter((id) => id !== opId),
          ...(ok && snap
            ? {
                items: snap.items,
                gold: snap.gold,
                revision: snap.revision,
                equipment: snap.equipment,
                runeLoadout: snap.runeLoadout,
              }
            : {}),
        })),

      // ----------------------------------------------------------- equipment
      equipment: emptyEquipment(),
      runeLoadout: [null, null, null, null],
      applyEquipment: (equipment, runeLoadout) => set({ equipment, runeLoadout }),

      // -------------------------------------------------------------- quests
      quests: {},
      activeQuestId: null,
      factions: {},
      setQuestState: (state) =>
        set((s) => ({ quests: { ...s.quests, [state.questId]: state } })),
      setActiveQuest: (questId) => set({ activeQuestId: questId }),
      progressObjective: (questId, objectiveId, amount) =>
        set((s) => {
          const quest = s.quests[questId];
          if (!quest) return {};
          let changed = false;
          const objectives = quest.objectives.map((obj) => {
            if (obj.objectiveId !== objectiveId || obj.done) return obj;
            changed = true;
            const current = Math.min(obj.target, obj.current + amount);
            return { ...obj, current, done: current >= obj.target };
          });
          if (!changed) return {};
          return { quests: { ...s.quests, [questId]: { ...quest, objectives } } };
        }),
      recordChoice: (questId, branchId, optionId) =>
        set((s) => {
          const quest = s.quests[questId];
          if (!quest) return {};
          return {
            quests: {
              ...s.quests,
              [questId]: { ...quest, choices: { ...quest.choices, [branchId]: optionId } },
            },
          };
        }),
      applyFactionDelta: (factionId, delta) =>
        set((s) => ({
          factions: { ...s.factions, [factionId]: (s.factions[factionId] ?? 0) + delta },
        })),

      // ------------------------------------------------------------ dialogue
      active: null,
      openDialogue: (session) => set({ active: session }),
      advanceDialogue: (nodeId) =>
        set((s) => (s.active ? { active: { ...s.active, nodeId } } : {})),
      closeDialogue: () => set({ active: null }),

      // ----------------------------------------------------------------- hud
      activeMenu: 'none',
      interactPrompt: null,
      notifications: [],
      bossBar: null,
      setMenu: (menu) => set({ activeMenu: menu }),
      setInteractPrompt: (prompt) => set({ interactPrompt: prompt }),
      notify: (kind, text, ttlMs) => {
        const id = uid();
        const ttl = ttlMs ?? DEFAULT_NOTIFICATION_TTL_MS;
        set((s) => ({
          notifications: [...s.notifications, { id, kind, text, ttlMs: ttl }].slice(
            -NOTIFICATION_CAP,
          ),
        }));
        // Auto-dismiss after ttl; dismissNotification is idempotent.
        setTimeout(() => get().dismissNotification(id), ttl);
      },
      dismissNotification: (id) =>
        set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
      setBossBar: (bar) => set({ bossBar: bar }),

      // ----------------------------------------------------------------- net
      status: 'connecting',
      latencyMs: 0,
      remotePlayers: {},
      serverTick: 0,
      setStatus: (status) => set({ status }),
      setLatency: (ms) => set({ latencyMs: ms }),
      applySnapshotPlayers: (players, tick) =>
        set((s) => {
          const now = Date.now();
          const next: Record<string, RemotePlayer> = { ...s.remotePlayers };
          for (const p of players) {
            next[p.playerId] = { ...p, lastTick: tick };
            remoteLastSeen.set(p.playerId, now);
          }
          // Prune ids absent from snapshots for >3s.
          for (const id of Object.keys(next)) {
            const seen = remoteLastSeen.get(id);
            if (seen === undefined || now - seen > REMOTE_PRUNE_MS) {
              delete next[id];
              remoteLastSeen.delete(id);
            }
          }
          return { remotePlayers: next, serverTick: tick };
        }),
      removeRemotePlayer: (playerId) =>
        set((s) => {
          if (!(playerId in s.remotePlayers)) return {};
          remoteLastSeen.delete(playerId);
          const next = { ...s.remotePlayers };
          delete next[playerId];
          return { remotePlayers: next };
        }),

      // ------------------------------------------------------------- settings
      ...DEFAULT_SETTINGS,
      updateSettings: (patch) => set(patch),

      // ---------------------------------------------------------- world events
      events: [],
      upsertEvent: (event) =>
        set((s) => {
          const idx = s.events.findIndex((e) => e.eventId === event.eventId);
          if (idx === -1) return { events: [...s.events, event] };
          const events = s.events.slice();
          events[idx] = event;
          return { events };
        }),
      applyEventSchedule: (events) => set({ events: [...events] }),
      clearEvent: (eventId) =>
        set((s) => ({ events: s.events.filter((e) => e.eventId !== eventId) })),
    }),
    {
      name: 'coresapian.game',
      version: 0,
      storage: createJSONStorage(() => splitKeyStorage),
      partialize: (s): PersistedSlices => ({
        playerId: s.playerId,
        displayName: s.displayName,
        settings: extractSettings(s),
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<PersistedSlices> | undefined;
        return {
          ...current,
          playerId: p?.playerId ?? current.playerId,
          displayName: p?.displayName ?? current.displayName,
          ...(p?.settings ?? {}),
        };
      },
    },
  ),
);

/** Bound-store type used by the engine facade (gdd.md §3.1 GameOptions). */
export type UseGameStore = typeof useGameStore;

// ---------------------------------------------------------------------------
// Convenience selectors (plain functions — compose with useGameStore / hooks)
// ---------------------------------------------------------------------------

export const selectPlayerId = (s: GameStore) => s.playerId;
export const selectDisplayName = (s: GameStore) => s.displayName;
export const selectVitals = (s: GameStore) => s.vitals;
export const selectDead = (s: GameStore) => s.dead;
export const selectXp = (s: GameStore) => s.xp;
export const selectLevel = (s: GameStore) => s.level;
export const selectXpToNext = (s: GameStore) => s.xpToNext;
export const selectSkillPoints = (s: GameStore) => s.skillPoints;
export const selectSkills = (s: GameStore) => s.skills;
export const selectRealmAbilities = (s: GameStore) => s.realmAbilities;
export const selectItems = (s: GameStore) => s.items;
export const selectGold = (s: GameStore) => s.gold;
export const selectInventoryRevision = (s: GameStore) => s.revision;
export const selectPendingOps = (s: GameStore) => s.pendingOps;
export const selectEquipment = (s: GameStore) => s.equipment;
export const selectRuneLoadout = (s: GameStore) => s.runeLoadout;
export const selectQuests = (s: GameStore) => s.quests;
export const selectActiveQuestId = (s: GameStore) => s.activeQuestId;
export const selectFactions = (s: GameStore) => s.factions;
export const selectDialogue = (s: GameStore) => s.active;
export const selectActiveMenu = (s: GameStore) => s.activeMenu;
export const selectInteractPrompt = (s: GameStore) => s.interactPrompt;
export const selectNotifications = (s: GameStore) => s.notifications;
export const selectBossBar = (s: GameStore) => s.bossBar;
export const selectNetStatus = (s: GameStore) => s.status;
export const selectLatencyMs = (s: GameStore) => s.latencyMs;
export const selectRemotePlayers = (s: GameStore) => s.remotePlayers;
export const selectServerTick = (s: GameStore) => s.serverTick;
export const selectWorldEvents = (s: GameStore) => s.events;
export const selectSettings = (s: GameStore): SettingsValues => extractSettings(s);

// Bound hooks for the most common reads (shallow-compared where composite).
export const useVitals = (): PlayerVitals => useGameStore(selectVitals);
export const useNetStatus = () => useGameStore(selectNetStatus);
export const useNotifications = () => useGameStore(selectNotifications);
export const useSettings = (): SettingsValues => useGameStore(useShallow(selectSettings));
