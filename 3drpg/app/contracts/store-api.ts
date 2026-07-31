// ============================================================================
// CORESAPIAN — contracts/store-api.ts
// Interface-only description of the zustand GameStore. NO zustand import:
// `src/game/store.ts` implements these interfaces. Every slice lists its
// state + actions; gdd.md §2 says who WRITES/READS.
// ============================================================================

import type {
  BossBarState,
  ConnectionStatus,
  DialogueSession,
  Equipment,
  ItemInstance,
  MenuId,
  Notification,
  NotificationKind,
  PlayerVitals,
  QuestState,
  RemotePlayer,
  RuneLoadout,
  WorldEvent,
} from './types';
import type { InventorySnapshot, ProgressionSnapshot } from './netcode';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface IdentitySlice {
  playerId: string; // crypto.randomUUID, localStorage 'coresapian.playerId'
  displayName: string; // localStorage 'coresapian.name'; validated by netcode.NAME_PATTERN
  setDisplayName(name: string): void;
}

// ---------------------------------------------------------------------------
// Vitals (hp / stamina / wyrd) — local sim owns regen; server owns max values,
// xp/level. `dead` drives the death screen.
// ---------------------------------------------------------------------------

export interface VitalsSlice {
  vitals: PlayerVitals;
  dead: boolean;
  setVitals(patch: Partial<PlayerVitals>): void;
  /** Server VitalsMsg is authoritative for max values + xp/level. */
  applyServerVitals(v: { hp: number; maxHp: number; wyrd: number; maxWyrd: number }): void;
  setDead(dead: boolean): void;
}

// ---------------------------------------------------------------------------
// Progression (xp, level, skill points, skills, realm abilities)
// ---------------------------------------------------------------------------

export interface ProgressionSlice {
  xp: number;
  level: number;
  xpToNext: number;
  skillPoints: number;
  /** skillNodeId -> rank */
  skills: Record<string, number>;
  /** unlocked realm ability ids (skills.ts REALM_ABILITIES) */
  realmAbilities: string[];
  /** Local, optimistic xp gain (enemy kills); reconciled by server vitals. */
  addXp(amount: number): void;
  spendSkillPoint(nodeId: string): boolean;
  unlockRealmAbility(abilityId: string): void;
  applyServerProgression(p: ProgressionSnapshot): void;
}

// ---------------------------------------------------------------------------
// Inventory (SERVER-AUTHORITATIVE; client sends InventoryOp, waits for ack)
// ---------------------------------------------------------------------------

export interface InventorySlice {
  items: ItemInstance[];
  gold: number;
  /** Last revision acked by the server. */
  revision: number;
  /** opIds awaiting invack — drives "pending" UI affordances. */
  pendingOps: string[];
  /** Called by net agent before sending; returns false if op already pending. */
  beginOp(opId: string): boolean;
  applyInventorySnapshot(snap: InventorySnapshot): void;
  applyInventoryAck(opId: string, ok: boolean, snap?: InventorySnapshot): void;
}

// ---------------------------------------------------------------------------
// Equipment + rune loadout (equip ops are inventory ops; this slice mirrors
// the server-acked state for fast reads by combat/ui).
// ---------------------------------------------------------------------------

export interface EquipmentSlice {
  equipment: Equipment;
  runeLoadout: RuneLoadout;
  applyEquipment(equipment: Equipment, runeLoadout: RuneLoadout): void;
}

// ---------------------------------------------------------------------------
// Quests / dialogue / factions
// ---------------------------------------------------------------------------

export interface QuestSlice {
  quests: Record<string, QuestState>;
  activeQuestId: string | null;
  /** factionId -> standing points */
  factions: Record<string, number>;
  setQuestState(state: QuestState): void;
  setActiveQuest(questId: string | null): void;
  /** Increment an objective counter; idempotent per (quest, objective, key). */
  progressObjective(questId: string, objectiveId: string, amount: number): void;
  recordChoice(questId: string, branchId: string, optionId: string): void;
  applyFactionDelta(factionId: string, delta: number): void;
}

export interface DialogueSlice {
  active: DialogueSession | null;
  openDialogue(session: DialogueSession): void;
  advanceDialogue(nodeId: string): void;
  closeDialogue(): void;
}

// ---------------------------------------------------------------------------
// HUD (menus, prompts, notifications, boss bar)
// ---------------------------------------------------------------------------

export interface HudSlice {
  activeMenu: MenuId;
  /** Contextual "E — Talk to Hulda" / "E — Take Ljóssteinn" prompt. */
  interactPrompt: string | null;
  notifications: Notification[];
  bossBar: BossBarState | null;
  setMenu(menu: MenuId): void;
  setInteractPrompt(prompt: string | null): void;
  notify(kind: NotificationKind, text: string, ttlMs?: number): void;
  dismissNotification(id: string): void;
  setBossBar(bar: BossBarState | null): void;
}

// ---------------------------------------------------------------------------
// Net (connection status, remote players)
// ---------------------------------------------------------------------------

export interface NetSlice {
  status: ConnectionStatus;
  latencyMs: number;
  remotePlayers: Record<string, RemotePlayer>;
  serverTick: number;
  setStatus(status: ConnectionStatus): void;
  setLatency(ms: number): void;
  /** Replace/merge from a snapshot; prunes ids absent for >3s. */
  applySnapshotPlayers(players: RemotePlayer[], tick: number): void;
  removeRemotePlayer(playerId: string): void;
}

// ---------------------------------------------------------------------------
// Settings (persisted to localStorage by the store impl)
// ---------------------------------------------------------------------------

export type QualityLevel = 'low' | 'medium' | 'high';

export interface SettingsSlice {
  mouseSensitivity: number; // 0.1..3, default 1
  invertY: boolean;
  fov: number; // 60..110, default 80
  volumeMaster: number; // 0..1
  volumeMusic: number;
  volumeSfx: number;
  quality: QualityLevel;
  showFps: boolean;
  updateSettings(patch: Partial<Omit<SettingsSlice, 'updateSettings'>>): void;
}

// ---------------------------------------------------------------------------
// World events (server-seeded schedule)
// ---------------------------------------------------------------------------

export interface WorldEventSlice {
  events: WorldEvent[];
  upsertEvent(event: WorldEvent): void;
  applyEventSchedule(events: WorldEvent[]): void;
  clearEvent(eventId: string): void;
}

// ---------------------------------------------------------------------------
// The composed store (scaffold: `useGameStore = create<GameStore>()(...)`)
// ---------------------------------------------------------------------------

export interface GameStore
  extends IdentitySlice,
    VitalsSlice,
    ProgressionSlice,
    InventorySlice,
    EquipmentSlice,
    QuestSlice,
    DialogueSlice,
    HudSlice,
    NetSlice,
    SettingsSlice,
    WorldEventSlice {}
