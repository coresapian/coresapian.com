// ============================================================================
// CORESAPIAN — contracts/netcode.ts
// WebSocket protocol between browser client and the authoritative Hono server.
// Transport: JSON text frames over `/ws`. Pure TypeScript, no deps.
// ============================================================================

import type {
  Equipment,
  ItemInstance,
  QuestState,
  RealmId,
  RuneLoadout,
  Vec3,
  Vec3Tuple,
  WorldEvent,
  DamageSchool,
  AttackKind,
} from './types';

// ---------------------------------------------------------------------------
// Protocol constants (LOCKED — do not tune without a protocol version bump)
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1 as const;

/** Client -> server input send rate. */
export const CLIENT_INPUT_HZ = 15;
/** Server -> client snapshot broadcast rate. */
export const SERVER_SNAPSHOT_HZ = 10;
/** Constant reconnect delay. NOT exponential — banner shows retry countdown. */
export const RECONNECT_INTERVAL_MS = 3000;
/** Remote-entity render delay behind the newest snapshot (buffer 1 tick). */
export const INTERPOLATION_DELAY_MS = 100;
/** Client heartbeat; server drops sockets silent for 3x this. */
export const HEARTBEAT_MS = 5000;

// --- name validation -------------------------------------------------------
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 16;
/** Letters/digits/space/hyphen/underscore + Norse glyphs þ ð æ ø å (both cases). */
export const NAME_PATTERN = /^[A-Za-z0-9 _\-ÞþÐðÆæØøÅå]{2,16}$/;

// --- server-side sanity limits ----------------------------------------------
/** Hard speed cap (sprint 7.2 m/s + latency tolerance). Violations rubber-band. */
export const MAX_SPEED_MPS = 9;
/** Max accepted displacement between consecutive inputs before correction. */
export const MAX_STEP_PER_INPUT_M = 2.0;
/** Max accepted teleport between snapshots (portal/respawn must use teleport flag). */
export const MAX_TELEPORT_PER_SNAPSHOT_M = 25;
/** Grace added to weapon range when validating attack claims. */
export const ATTACK_RANGE_TOLERANCE_M = 1.5;
/** Cooldown slack: claims arriving up to this early are still accepted. */
export const ATTACK_COOLDOWN_SLACK_MS = 120;
/** Only players within this radius of the recipient are included in snapshots. */
export const RELEVANCE_RADIUS_M = 80;
/** Max remote players per snapshot. */
export const SNAPSHOT_PLAYER_CAP = 24;
/** Snapshot buffer length on the client. */
export const SNAPSHOT_BUFFER_SIZE = 20;

// --- input button bitmask ----------------------------------------------------
export const BTN_JUMP = 1 << 0;
export const BTN_SPRINT = 1 << 1;
export const BTN_ATTACK = 1 << 2;
export const BTN_BLOCK = 1 << 3;
export const BTN_INTERACT = 1 << 4;
export const BTN_DODGE = 1 << 5;

// ---------------------------------------------------------------------------
// Shared snapshot shapes
// ---------------------------------------------------------------------------

/** One remote player as broadcast in `snapshot`. Compact positional fields. */
export interface SnapshotPlayer {
  id: string;
  name: string;
  realm: RealmId;
  /** [x, y, z] */
  p: Vec3Tuple;
  /** Radians. */
  yaw: number;
  /** RemoteAnim encoded as index: 0 idle, 1 run, 2 attack, 3 block, 4 cast, 5 dead. */
  anim: number;
}

export interface InventorySnapshot {
  revision: number;
  gold: number;
  items: ItemInstance[];
  equipment: Equipment;
  runeLoadout: RuneLoadout;
}

export interface ProgressionSnapshot {
  xp: number;
  level: number;
  skillPoints: number;
  /** skillNodeId -> rank */
  skills: Record<string, number>;
  /** unlocked realm ability ids */
  realmAbilities: string[];
  quests: Record<string, QuestState>;
  /** factionId -> standing points */
  factions: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Inventory operations (client requests; server validates + persists)
// ---------------------------------------------------------------------------

export type InventoryOp =
  | { kind: 'consume'; instanceId: string }
  | { kind: 'equip'; instanceId: string; slot: string }
  | { kind: 'unequip'; slot: string }
  | { kind: 'craft'; recipeId: string }
  | { kind: 'upgrade'; instanceId: string }
  | { kind: 'inscribe_rune'; instanceId: string; runeSlot: number }
  | { kind: 'drop'; instanceId: string; qty: number }
  | { kind: 'buy'; npcId: string; itemId: string; qty: number }
  | { kind: 'sell'; instanceId: string; qty: number };

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface HelloMsg {
  t: 'hello';
  protocolVersion: number;
  playerId: string; // crypto.randomUUID, persisted in localStorage
  name: string; // must match NAME_PATTERN
}

export interface InputMsg {
  t: 'input';
  /** Monotonically increasing per session. */
  seq: number;
  /** Normalized move intent, -1..1 (strafe, forward). */
  move: { x: number; z: number };
  yaw: number;
  pitch: number;
  /** Bitmask of BTN_* */
  buttons: number;
  /** Client-predicted position (server sanity-checks, never trusts blindly). */
  position: Vec3;
  realm: RealmId;
  clientTime: number;
  /** Set true for portal travel / respawn so teleport sanity is bypassed. */
  teleported?: boolean;
}

export interface AttackClaimMsg {
  t: 'attack';
  /** Client-generated id echoed back in DamageResultMsg. */
  claimId: string;
  attackKind: AttackKind;
  /** Weapon/rune itemId used. */
  itemId: string;
  /** Local enemy entity id if a direct target is known. */
  targetId?: string;
  origin: Vec3;
  dir: Vec3;
  /** Bow charge 0..1. */
  charge?: number;
  clientTime: number;
}

export interface InventoryOpMsg {
  t: 'invop';
  opId: string;
  op: InventoryOp;
}

export interface PingMsg {
  t: 'ping';
  clientTime: number;
}

export type ClientMessage = HelloMsg | InputMsg | AttackClaimMsg | InventoryOpMsg | PingMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface WelcomeMsg {
  t: 'welcome';
  protocolVersion: number;
  playerId: string;
  name: string;
  serverTime: number;
  snapshotHz: number;
  spawn: { realm: RealmId; position: Vec3 };
  /** Full world-event schedule; clients simulate identical events from seeds. */
  events: WorldEvent[];
  inventory: InventorySnapshot;
  progression: ProgressionSnapshot;
}

export interface SnapshotMsg {
  t: 'snapshot';
  tick: number;
  serverTime: number;
  players: SnapshotPlayer[];
  /** Event phase changes since last snapshot (usually empty). */
  events?: WorldEvent[];
}

export interface DamageResultMsg {
  t: 'dmg';
  claimId: string;
  accepted: boolean;
  /** Why a claim was rejected: 'range' | 'cooldown' | 'implausible' | 'no_target'. */
  reason?: string;
  amount?: number;
  school?: DamageSchool;
  targetId?: string;
  targetHp?: number;
  targetMaxHp?: number;
  killed?: boolean;
  xpAwarded?: number;
  /** Impact position for damage numbers / FX. */
  position?: Vec3;
}

export interface VitalsMsg {
  t: 'vitals';
  hp: number;
  maxHp: number;
  wyrd: number;
  maxWyrd: number;
  xp: number;
  level: number;
  skillPoints: number;
}

export interface InventoryAckMsg {
  t: 'invack';
  opId: string;
  ok: boolean;
  /** 'insufficient_materials' | 'insufficient_gold' | 'invalid_op' | ... */
  reason?: string;
  revision: number;
  /** Present when the op mutated inventory (authoritative resync). */
  inventory?: InventorySnapshot;
}

/** Full authoritative inventory push (on welcome and on divergence). */
export interface InventorySyncMsg {
  t: 'invsync';
  inventory: InventorySnapshot;
}

export interface WorldEventMsg {
  t: 'event';
  event: WorldEvent;
}

export interface PongMsg {
  t: 'pong';
  clientTime: number;
  serverTime: number;
}

export interface ServerErrorMsg {
  t: 'error';
  /** 'bad_hello' | 'bad_name' | 'version_mismatch' | 'rate_limited' | 'internal' */
  code: string;
  message: string;
}

export type ServerMessage =
  | WelcomeMsg
  | SnapshotMsg
  | DamageResultMsg
  | VitalsMsg
  | InventoryAckMsg
  | InventorySyncMsg
  | WorldEventMsg
  | PongMsg
  | ServerErrorMsg;

// ---------------------------------------------------------------------------
// Type guards (handy for both sides; pure functions, no deps)
// ---------------------------------------------------------------------------

export function isClientMessage(v: unknown): v is ClientMessage {
  return (
    typeof v === 'object' &&
    v !== null &&
    't' in v &&
    ['hello', 'input', 'attack', 'invop', 'ping'].includes((v as { t: string }).t)
  );
}

export function isServerMessage(v: unknown): v is ServerMessage {
  return (
    typeof v === 'object' &&
    v !== null &&
    't' in v &&
    ['welcome', 'snapshot', 'dmg', 'vitals', 'invack', 'invsync', 'event', 'pong', 'error'].includes(
      (v as { t: string }).t,
    )
  );
}

export function validateName(name: string): boolean {
  return NAME_PATTERN.test(name);
}
