// ============================================================================
// CORESAPIAN — contracts/types.ts
// Core shared types. PURE TypeScript: no imports, no zod, no three, no react.
// Every other contract file (and both client & server) may import from here.
// ============================================================================

// ---------------------------------------------------------------------------
// Realms
// ---------------------------------------------------------------------------

export type RealmId =
  | 'midgard'
  | 'alfheim'
  | 'svartalfheim'
  | 'jotunheim'
  | 'niflheim'
  | 'muspelheim'
  | 'vanaheim'
  | 'helheim'
  | 'asgard';

/** Unlock order = story progression = realm tier (index + 1). */
export const REALM_IDS = [
  'midgard',
  'alfheim',
  'svartalfheim',
  'jotunheim',
  'niflheim',
  'muspelheim',
  'vanaheim',
  'helheim',
  'asgard',
] as const;

// ---------------------------------------------------------------------------
// Math / spatial
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Compact wire form of Vec3 (used in snapshots). */
export type Vec3Tuple = [number, number, number];

// ---------------------------------------------------------------------------
// Vitals & stats
// ---------------------------------------------------------------------------

export type DamageSchool = 'physical' | 'fire' | 'ice' | 'storm' | 'spirit';

export interface PlayerVitals {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  /** "Wyrd" — the mana resource (Old Norse: fate). */
  wyrd: number;
  maxWyrd: number;
}

export const BASE_VITALS: PlayerVitals = {
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  wyrd: 60,
  maxWyrd: 60,
};

/** Flat vitals gained per character level (applied to max values). */
export const VITALS_PER_LEVEL = { hp: 8, stamina: 3, wyrd: 4 } as const;

/** Derived-stat block computed from equipment + skills by the stats system. */
export interface StatBlock {
  /** Global damage multiplier (1 = no bonus). */
  power: number;
  /** Flat armor, feeds the mitigation curve. */
  armor: number;
  /** 0..1 */
  critChance: number;
  critMultiplier: number;
  /** m/s walk speed before sprint multiplier. */
  moveSpeed: number;
  /** Multiplier on weapon attack speed (1 = no bonus). */
  attackSpeed: number;
}

export const BASE_STATS: StatBlock = {
  power: 1,
  armor: 0,
  critChance: 0.05,
  critMultiplier: 1.75,
  moveSpeed: 5.0,
  attackSpeed: 1,
};

// ---------------------------------------------------------------------------
// Items / equipment / inventory
// ---------------------------------------------------------------------------

export type EquipSlot =
  | 'weapon'
  | 'shield'
  | 'head'
  | 'chest'
  | 'hands'
  | 'legs'
  | 'feet'
  | 'amulet'
  | 'ring';

export const EQUIP_SLOTS = [
  'weapon',
  'shield',
  'head',
  'chest',
  'hands',
  'legs',
  'feet',
  'amulet',
  'ring',
] as const;

export type ItemKind =
  | 'weapon'
  | 'shield'
  | 'bow'
  | 'armor'
  | 'rune'
  | 'consumable'
  | 'material'
  | 'quest';

export interface ItemInstance {
  /** Unique per stack/instance (crypto.randomUUID). */
  instanceId: string;
  /** References an item definition id in contracts/items.ts. */
  itemId: string;
  qty: number;
  /** 0..MAX_UPGRADE_LEVEL (blacksmith upgrades). */
  upgradeLevel: number;
}

export type Equipment = Record<EquipSlot, ItemInstance | null>;

/**
 * Four rune slots keyed Q, R, F, V. Values are rune itemIds (from items.ts)
 * or null. Runes are not "equipped" items — they are inscribed (learned) and
 * slotted; inscribing consumes the runestone item.
 */
export type RuneLoadout = [string | null, string | null, string | null, string | null];

export const RUNE_SLOT_KEYS = ['Q', 'R', 'F', 'V'] as const;

export const MAX_UPGRADE_LEVEL = 5 as const;

// ---------------------------------------------------------------------------
// Multiplayer / remote presence
// ---------------------------------------------------------------------------

export type RemoteAnim = 'idle' | 'run' | 'attack' | 'block' | 'cast' | 'dead';

export interface RemotePlayer {
  playerId: string;
  name: string;
  realm: RealmId;
  position: Vec3;
  yaw: number;
  anim: RemoteAnim;
  /** Last snapshot tick this record was updated on. */
  lastTick: number;
}

export type ConnectionStatus =
  | 'connecting' // first attempt in flight
  | 'connected'
  | 'reconnecting' // lost link, auto-retry loop running (3s interval)
  | 'disconnected'; // gave up / never connected this session

// ---------------------------------------------------------------------------
// World events
// ---------------------------------------------------------------------------

export type WorldEventKind = 'roaming_pack' | 'world_boss' | 'resource_surge';

export type WorldEventPhase = 'announced' | 'started' | 'ended';

export interface WorldEvent {
  eventId: string;
  kind: WorldEventKind;
  realm: RealmId;
  /** Server-provided PRNG seed — clients simulate identical events from it. */
  seed: number;
  name: string;
  /** Epoch ms (server clock domain). */
  startsAt: number;
  endsAt: number;
  phase: WorldEventPhase;
  /** For world_boss: enemy def id from contracts/enemies.ts. */
  bossEnemyId?: string;
  /** Anchor position (boss arena / pack centroid / surge field). */
  position?: Vec3;
}

// ---------------------------------------------------------------------------
// Quests / dialogue
// ---------------------------------------------------------------------------

export type QuestObjectiveKind = 'kill' | 'collect' | 'talk' | 'interact' | 'reach' | 'boss';

export interface QuestObjectiveState {
  objectiveId: string;
  current: number;
  target: number;
  done: boolean;
}

export interface QuestState {
  questId: string;
  status: 'active' | 'ready_to_turn_in' | 'completed';
  objectives: QuestObjectiveState[];
  /** branchId -> chosen optionId (see quests.ts BranchDef). */
  choices: Record<string, string>;
}

export interface DialogueSession {
  npcId: string;
  treeId: string;
  nodeId: string;
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export type AttackKind = 'light' | 'heavy' | 'bow' | 'rune';

export interface DamageEvent {
  /** Entity id of the victim (local enemy id, 'local_player', or playerId). */
  targetId: string;
  sourceId: string;
  amount: number;
  school: DamageSchool;
  isCrit: boolean;
  blocked: boolean;
  parried: boolean;
  killed: boolean;
  position: Vec3;
}

// ---------------------------------------------------------------------------
// HUD support
// ---------------------------------------------------------------------------

export type NotificationKind = 'info' | 'loot' | 'quest' | 'warning' | 'error' | 'level' | 'event';

export interface Notification {
  id: string;
  kind: NotificationKind;
  text: string;
  ttlMs: number;
}

export type MenuId =
  | 'none'
  | 'inventory'
  | 'skills'
  | 'quests'
  | 'map'
  | 'pause'
  | 'settings'
  | 'crafting'
  | 'death';

export interface BossBarState {
  name: string;
  hp: number;
  maxHp: number;
}
