// ============================================================================
// api/game/gateway.ts — the authoritative WebSocket game gateway.
// Implements contracts/netcode.ts end to end:
//   hello -> welcome (+vitals) · input @<=15Hz with sanity rubber-banding ·
//   snapshot @10Hz (relevance 80m, cap 24) · attack claims -> dmg (+xp) ·
//   invop -> validate/mutate/persist -> invack · heartbeat 5s / drop >15s ·
//   seeded world-event schedule in welcome + `event` phase broadcasts.
//
// EXTENSION (documented deviation): the contract's ServerMessage union has no
// position-correction frame, yet gdd §10/§12.13 require rubber-banding. We
// emit an additive { t:'correct', seq, position, realm, serverTime } message;
// it changes no contract message and is safely ignored by strict clients.
// ============================================================================

import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import type { RealmId, Vec3, WorldEvent } from "@contracts/types";
import { REALM_IDS } from "@contracts/types";
import type {
  AttackClaimMsg,
  HelloMsg,
  InputMsg,
  InventoryOpMsg,
  InventorySnapshot,
  ProgressionSnapshot,
  ServerMessage,
  SnapshotPlayer,
} from "@contracts/netcode";
import {
  BTN_ATTACK,
  BTN_BLOCK,
  CLIENT_INPUT_HZ,
  HEARTBEAT_MS,
  MAX_SPEED_MPS,
  MAX_STEP_PER_INPUT_M,
  MAX_TELEPORT_PER_SNAPSHOT_M,
  PROTOCOL_VERSION,
  RELEVANCE_RADIUS_M,
  SERVER_SNAPSHOT_HZ,
  SNAPSHOT_PLAYER_CAP,
  validateName,
} from "@contracts/netcode";

import {
  loadOrCreatePlayer,
  saveInventory,
  savePosition,
  saveProgression,
} from "../queries/players";
import { computeArmor, computeMaxVitals, levelForXp } from "./character";
import { validateAttack } from "./combat";
import { applyInventoryOp } from "./inventory";
import { EventSchedule } from "./events";
import { addPresence, removePresence, updatePresence } from "./state";

// --- gateway-local tuning ----------------------------------------------------
/** WS frame cap — protocol messages are small JSON. */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Close sockets that never complete `hello`. */
const HELLO_TIMEOUT_MS = 10_000;
/** Server drops sockets silent for 3x the heartbeat (contract comment). */
const STALE_MS = HEARTBEAT_MS * 3;
/** Input token-bucket burst on top of the sustained 15Hz rate. */
const INPUT_BURST = 5;
/** Leaky-bucket horizontal speed allowance: covers dodge bursts (4.5m) + jitter. */
const SPEED_BUCKET_CAP_M = 6;
/** Rubber-band corrections are throttled so a violator can't farm messages. */
const CORRECT_THROTTLE_MS = 500;
/** Progression/position debounced save interval (gdd §10). */
const DIRTY_FLUSH_MS = 30_000;
/** Per-player duplicate-opId memory. */
const RECENT_OPS_CAP = 200;

/** Additive protocol extension — see file header. */
interface CorrectMsg {
  t: "correct";
  seq: number;
  position: Vec3;
  realm: RealmId;
  serverTime: number;
}

interface Session {
  ws: WebSocket;
  playerId: string;
  name: string;
  realm: RealmId;
  position: Vec3;
  yaw: number;
  anim: number;
  lastSeq: number;
  inputsAccepted: number;
  lastSeenAt: number;
  // input rate limiting (token bucket, CLIENT_INPUT_HZ sustained)
  inputTokens: number;
  inputTokensAt: number;
  // movement sanity
  speedUsed: number;
  speedAt: number;
  posAtLastTick: Vec3;
  teleportedThisTick: boolean;
  lastCorrectAt: number;
  // authority
  inventory: InventorySnapshot;
  progression: ProgressionSnapshot;
  hp: number;
  wyrd: number;
  lastAttackAt: Map<string, number>;
  lastConsumeAt: number;
  opQueue: Promise<void>;
  processedOps: { set: Set<string>; queue: string[] };
  dirtyProgression: boolean;
  dirtyPosition: boolean;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distHorizontal(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return finite(o.x) && finite(o.y) && finite(o.z);
}

function isRealmId(v: unknown): v is RealmId {
  return typeof v === "string" && (REALM_IDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export class GameGateway {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, Session>();
  private readonly schedule = new EventSchedule();
  private readonly timers: NodeJS.Timeout[] = [];
  private tick = 0;
  private eventQueue: WorldEvent[] = [];

  constructor() {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    this.wss.on("connection", (ws) => this.onConnection(ws));

    this.timers.push(setInterval(() => this.broadcastSnapshots(), 1000 / SERVER_SNAPSHOT_HZ));
    this.timers.push(setInterval(() => this.broadcastEventTransitions(), 1000));
    this.timers.push(setInterval(() => this.heartbeatSweep(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => this.flushDirty(), DIRTY_FLUSH_MS));
    for (const t of this.timers) t.unref?.();
  }

  /** Attach to a Node HTTP server at the given path (contract: /ws). */
  attach(server: HttpServer, path = "/ws"): void {
    server.on("upgrade", (req, socket, head) => {
      let pathname = "";
      try {
        pathname = new URL(req.url ?? "", "http://localhost").pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== path) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });
  }

  get playerCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    for (const t of this.timers) clearInterval(t);
    for (const s of this.sessions.values()) this.teardown(s, false);
    this.wss.close();
  }

  // --- connection lifecycle -------------------------------------------------

  private onConnection(ws: WebSocket): void {
    const state: { session: Session | null; authed: boolean; hellod: boolean } = {
      session: null,
      authed: false,
      hellod: false,
    };
    const authTimer = setTimeout(() => {
      if (!state.authed) {
        this.send(ws, { t: "error", code: "bad_hello", message: "hello required" });
        ws.close();
      }
    }, HELLO_TIMEOUT_MS);
    authTimer.unref?.();

    ws.on("message", (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        if (!state.authed) {
          this.send(ws, { t: "error", code: "bad_hello", message: "expected JSON hello" });
          ws.close();
        }
        return;
      }
      if (!state.authed) {
        // Hello processing is async (DB load). Once a valid hello is in
        // flight, silently drop frames (early inputs at 15Hz) until welcome
        // completes the handshake — never treat them as a bad first message.
        if (state.hellod) return;
        if ((msg as { t?: unknown } | null)?.t === "hello") state.hellod = true;
        void this.onHello(ws, msg, state);
        return;
      }
      if (state.session) this.onMessage(state.session, msg);
    });
    ws.on("pong", () => {
      if (state.session) state.session.lastSeenAt = Date.now();
    });
    const cleanup = () => {
      clearTimeout(authTimer);
      if (state.session) this.teardown(state.session, true);
      state.session = null;
    };
    ws.on("close", cleanup);
    ws.on("error", () => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    });
  }

  private async onHello(ws: WebSocket, raw: unknown, state: { session: Session | null; authed: boolean }): Promise<void> {
    const msg = raw as Partial<HelloMsg>;
    if (!msg || msg.t !== "hello") {
      this.send(ws, { t: "error", code: "bad_hello", message: "first message must be hello" });
      ws.close();
      return;
    }
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.send(ws, {
        t: "error",
        code: "version_mismatch",
        message: `protocol ${String(msg.protocolVersion)} != ${PROTOCOL_VERSION}`,
      });
      ws.close();
      return;
    }
    if (typeof msg.name !== "string" || !validateName(msg.name)) {
      this.send(ws, { t: "error", code: "bad_name", message: "name fails NAME_PATTERN" });
      ws.close();
      return;
    }
    if (typeof msg.playerId !== "string" || msg.playerId.length < 8 || msg.playerId.length > 36) {
      this.send(ws, { t: "error", code: "bad_hello", message: "invalid playerId" });
      ws.close();
      return;
    }

    let character;
    try {
      character = await loadOrCreatePlayer(msg.playerId, msg.name);
    } catch (err) {
      console.error("[gateway] loadOrCreatePlayer failed:", err);
      this.send(ws, { t: "error", code: "internal", message: "character store unavailable" });
      ws.close();
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return; // socket gave up during DB roundtrip

    // One live session per identity: a newer hello replaces the old socket.
    const previous = this.sessions.get(msg.playerId);
    if (previous) {
      try {
        previous.ws.terminate();
      } catch {
        /* already gone */
      }
      this.teardown(previous, true);
    }

    const maxes = computeMaxVitals(character.progression, character.inventory);
    const now = Date.now();
    const session: Session = {
      ws,
      playerId: msg.playerId,
      name: msg.name,
      realm: character.realm,
      position: { ...character.position },
      yaw: 0,
      anim: 0,
      lastSeq: 0,
      inputsAccepted: 0,
      lastSeenAt: now,
      inputTokens: CLIENT_INPUT_HZ + INPUT_BURST,
      inputTokensAt: now,
      speedUsed: 0,
      speedAt: now,
      posAtLastTick: { ...character.position },
      teleportedThisTick: false,
      lastCorrectAt: 0,
      inventory: character.inventory,
      progression: character.progression,
      hp: maxes.maxHp,
      wyrd: maxes.maxWyrd,
      lastAttackAt: new Map(),
      lastConsumeAt: 0,
      opQueue: Promise.resolve(),
      processedOps: { set: new Set(), queue: [] },
      dirtyProgression: false,
      dirtyPosition: false,
    };
    this.sessions.set(session.playerId, session);
    state.session = session;
    state.authed = true;
    addPresence({
      playerId: session.playerId,
      name: session.name,
      realm: session.realm,
      position: session.position,
      connectedAt: now,
    });

    this.send(ws, {
      t: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      playerId: session.playerId,
      name: session.name,
      serverTime: now,
      snapshotHz: SERVER_SNAPSHOT_HZ,
      spawn: { realm: session.realm, position: { ...session.position } },
      events: this.schedule.schedule(),
      inventory: session.inventory,
      progression: session.progression,
    });
    this.sendVitals(session);
  }

  private teardown(session: Session, persist: boolean): void {
    if (this.sessions.get(session.playerId) !== session) return; // replaced by newer socket
    this.sessions.delete(session.playerId);
    removePresence(session.playerId);
    if (persist) void this.flushSession(session);
    try {
      if (session.ws.readyState === WebSocket.OPEN) session.ws.close();
    } catch {
      /* already gone */
    }
    // Leave announcements are implicit: the id simply disappears from
    // snapshots and clients prune it (store-api NetSlice, >3s absence).
  }

  // --- message routing (post-hello) -----------------------------------------

  private onMessage(session: Session, raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    session.lastSeenAt = Date.now(); // any authed frame counts as liveness
    const t = (raw as { t?: unknown }).t;
    switch (t) {
      case "input":
        this.onInput(session, raw as InputMsg);
        break;
      case "attack":
        this.onAttack(session, raw as AttackClaimMsg);
        break;
      case "invop":
        this.onInvop(session, raw as InventoryOpMsg);
        break;
      case "ping": {
        const clientTime = (raw as { clientTime?: unknown }).clientTime;
        this.send(session.ws, {
          t: "pong",
          clientTime: typeof clientTime === "number" ? clientTime : 0,
          serverTime: Date.now(),
        });
        break;
      }
      case "hello":
        break; // already authed on this socket — ignore duplicates
      default:
        break;
    }
  }

  // --- input @<=15Hz + sanity -------------------------------------------------

  private onInput(session: Session, msg: InputMsg): void {
    const now = Date.now();

    // Rate limit: token bucket at CLIENT_INPUT_HZ sustained + small burst.
    const elapsed = now - session.inputTokensAt;
    session.inputTokensAt = now;
    session.inputTokens = Math.min(CLIENT_INPUT_HZ + INPUT_BURST, session.inputTokens + (elapsed * CLIENT_INPUT_HZ) / 1000);
    if (session.inputTokens < 1) {
      this.send(session.ws, { t: "error", code: "rate_limited", message: `input exceeds ${CLIENT_INPUT_HZ}Hz` });
      return;
    }
    session.inputTokens -= 1;

    // Structural validation.
    if (
      !finite(msg.seq) ||
      !isVec3(msg.position) ||
      !finite(msg.yaw) ||
      !isRealmId(msg.realm) ||
      !msg.move ||
      !finite(msg.move.x) ||
      !finite(msg.move.z) ||
      !finite(msg.buttons)
    ) {
      return;
    }
    if (msg.seq <= session.lastSeq) return; // stale / reordered
    session.lastSeq = msg.seq;

    session.yaw = msg.yaw;
    const moving = Math.abs(msg.move.x) > 0.1 || Math.abs(msg.move.z) > 0.1;
    // RemoteAnim index: 0 idle, 1 run, 2 attack, 3 block (netcode.SnapshotPlayer).
    session.anim = msg.buttons & BTN_ATTACK ? 2 : msg.buttons & BTN_BLOCK ? 3 : moving ? 1 : 0;

    if (msg.realm !== session.realm) {
      session.realm = msg.realm;
      session.dirtyPosition = true;
    }

    if (msg.teleported === true || session.inputsAccepted === 0) {
      // Portal travel / respawn bypasses teleport sanity per contract; the
      // first input of a session is also accepted outright (the client snaps
      // its y to local terrain right after welcome.spawn).
      session.position = { ...msg.position };
      session.posAtLastTick = { ...msg.position };
      session.teleportedThisTick = true;
      session.speedUsed = 0;
      session.speedAt = now;
      session.inputsAccepted += 1;
      session.dirtyPosition = true;
      updatePresence(session.playerId, { realm: session.realm, position: session.position });
      return;
    }

    // Sanity 1: per-input step (horizontal — vertical is unbounded so legit
    // falls never trip it; gross y jumps are caught by the 25m tick check).
    const step = distHorizontal(msg.position, session.position);
    // Sanity 2: sustained horizontal speed (leaky bucket).
    const dt = now - session.speedAt;
    session.speedAt = now;
    session.speedUsed = Math.max(0, session.speedUsed - (dt * MAX_SPEED_MPS) / 1000);
    const violates = step > MAX_STEP_PER_INPUT_M || session.speedUsed + step > SPEED_BUCKET_CAP_M;
    if (violates) {
      this.rubberBand(session);
      return;
    }
    session.speedUsed += step;
    session.position = { ...msg.position };
    session.inputsAccepted += 1;
    session.dirtyPosition = true;
    updatePresence(session.playerId, { realm: session.realm, position: session.position });
  }

  /** Reject the claimed position and snap the client to authoritative state. */
  private rubberBand(session: Session): void {
    const now = Date.now();
    if (now - session.lastCorrectAt < CORRECT_THROTTLE_MS) return;
    session.lastCorrectAt = now;
    const msg: CorrectMsg = {
      t: "correct",
      seq: session.lastSeq,
      position: { ...session.position },
      realm: session.realm,
      serverTime: now,
    };
    this.send(session.ws, msg as unknown as ServerMessage);
  }

  // --- attack claims -----------------------------------------------------------

  private onAttack(session: Session, msg: AttackClaimMsg): void {
    const now = Date.now();
    if (
      typeof msg.claimId !== "string" ||
      msg.claimId.length === 0 ||
      msg.claimId.length > 64 ||
      typeof msg.itemId !== "string" ||
      (msg.targetId !== undefined && typeof msg.targetId !== "string")
    ) {
      return;
    }

    const outcome = validateAttack(msg, {
      now,
      playerPos: session.position,
      realm: session.realm,
      inventory: session.inventory,
      progression: session.progression,
      lastAttackAt: session.lastAttackAt,
      resolvePlayerTarget: (targetId) => {
        const other = this.sessions.get(targetId);
        if (!other) return null;
        return {
          pos: other.position,
          realm: other.realm,
          armor: computeArmor(other.progression, other.inventory),
        };
      },
    });

    if (!outcome.accepted) {
      this.send(session.ws, { t: "dmg", claimId: msg.claimId, accepted: false, reason: outcome.reason });
      return;
    }

    // Server owns xp: accumulate + level on the contracts curve.
    if (outcome.xpAwarded && outcome.xpAwarded > 0) {
      session.progression.xp += outcome.xpAwarded;
      const lvl = levelForXp(session.progression.xp, session.progression.level);
      if (lvl.leveled) {
        session.progression.level = lvl.level;
        session.progression.skillPoints += lvl.skillPointsGained;
      }
      session.dirtyProgression = true;
      this.sendVitals(session);
    }

    let targetHp: number | undefined;
    let targetMaxHp: number | undefined;
    let killed: boolean | undefined;
    if (outcome.targetKind === "player" && msg.targetId) {
      const victim = this.sessions.get(msg.targetId);
      if (victim) {
        const maxes = computeMaxVitals(victim.progression, victim.inventory);
        victim.hp = Math.max(0, victim.hp - (outcome.amount ?? 0));
        if (victim.hp <= 0) {
          killed = true;
          victim.hp = Math.round(maxes.maxHp * 0.5); // respawn at 50% (gdd §11.2)
        }
        targetHp = victim.hp;
        targetMaxHp = maxes.maxHp;
        this.sendVitals(victim);
      }
    }

    this.send(session.ws, {
      t: "dmg",
      claimId: msg.claimId,
      accepted: true,
      amount: outcome.amount,
      school: outcome.school,
      targetId: msg.targetId,
      targetHp,
      targetMaxHp,
      killed,
      xpAwarded: outcome.xpAwarded ?? 0,
      position: { ...msg.origin },
    });
  }

  // --- inventory ops -------------------------------------------------------------

  private onInvop(session: Session, msg: InventoryOpMsg): void {
    if (
      typeof msg.opId !== "string" ||
      msg.opId.length === 0 ||
      msg.opId.length > 64 ||
      !msg.op ||
      typeof msg.op !== "object" ||
      typeof (msg.op as { kind?: unknown }).kind !== "string"
    ) {
      return;
    }
    const { opId, op } = msg;

    // Duplicate opId rejection (per-player memory, survives reconnects).
    // Marked synchronously at receive time so a transport-level retry can
    // never slip a second copy into the queue behind the first.
    if (session.processedOps.set.has(opId)) {
      this.send(session.ws, { t: "invack", opId, ok: false, reason: "duplicate_op", revision: session.inventory.revision });
      return;
    }
    this.markOpProcessed(session, opId);

    // Serialize ops per session: validate/mutate/persist strictly in order.
    // A previous op's failure must not block later ops in the queue.
    session.opQueue = session.opQueue
      .catch(() => {})
      .then(() => this.processInvop(session, opId, op))
      .catch(() => {});
  }

  private async processInvop(session: Session, opId: string, op: InventoryOpMsg["op"]): Promise<void> {
    const previous = session.inventory;
    const draft = structuredClone(previous);
    const outcome = applyInventoryOp(draft, op, {
      realm: session.realm,
      level: session.progression.level,
      now: Date.now(),
      lastConsumeAt: session.lastConsumeAt,
    });

    if (!outcome.ok) {
      this.send(session.ws, { t: "invack", opId, ok: false, reason: outcome.reason, revision: previous.revision });
      return;
    }

    draft.revision = previous.revision + 1;
    session.inventory = draft;
    if (outcome.lastConsumeAt !== undefined) session.lastConsumeAt = outcome.lastConsumeAt;

    try {
      await saveInventory(session.playerId, draft); // persist on every invack
    } catch (err) {
      console.error("[gateway] saveInventory failed, rolling back:", err);
      session.inventory = previous;
      this.send(session.ws, { t: "invack", opId, ok: false, reason: "internal", revision: previous.revision });
      return;
    }

    this.send(session.ws, { t: "invack", opId, ok: true, revision: draft.revision, inventory: draft });

    // Equipment/inscription may have changed derived vitals maxima.
    if (op.kind === "equip" || op.kind === "unequip" || op.kind === "inscribe_rune" || op.kind === "upgrade") {
      this.sendVitals(session);
    }
  }

  private markOpProcessed(session: Session, opId: string): void {
    const mem = session.processedOps;
    mem.set.add(opId);
    mem.queue.push(opId);
    if (mem.queue.length > RECENT_OPS_CAP) {
      const oldest = mem.queue.shift();
      if (oldest) mem.set.delete(oldest);
    }
  }

  // --- vitals ---------------------------------------------------------------------

  private sendVitals(session: Session): void {
    const maxes = computeMaxVitals(session.progression, session.inventory);
    session.hp = Math.min(session.hp, maxes.maxHp);
    session.wyrd = Math.min(session.wyrd, maxes.maxWyrd);
    this.send(session.ws, {
      t: "vitals",
      hp: Math.round(session.hp),
      maxHp: maxes.maxHp,
      wyrd: Math.round(session.wyrd),
      maxWyrd: maxes.maxWyrd,
      xp: session.progression.xp,
      level: session.progression.level,
      skillPoints: session.progression.skillPoints,
    });
  }

  // --- snapshots @10Hz ----------------------------------------------------------------

  private broadcastSnapshots(): void {
    if (this.sessions.size === 0) {
      this.eventQueue.length = 0;
      return;
    }
    this.tick += 1;
    const now = Date.now();
    const events = this.eventQueue.length > 0 ? this.eventQueue.splice(0) : undefined;
    const all = [...this.sessions.values()];

    for (const s of all) {
      // Per-snapshot teleport sanity (unless a `teleported` input covered it).
      if (!s.teleportedThisTick && dist3(s.position, s.posAtLastTick) > MAX_TELEPORT_PER_SNAPSHOT_M) {
        s.position = { ...s.posAtLastTick };
        this.rubberBand(s);
      }
      s.posAtLastTick = { ...s.position };
      s.teleportedThisTick = false;
    }

    for (const s of all) {
      if (s.ws.readyState !== WebSocket.OPEN) continue;
      const players: SnapshotPlayer[] = [];
      for (const o of all) {
        if (o === s || o.realm !== s.realm) continue;
        if (dist3(o.position, s.position) > RELEVANCE_RADIUS_M) continue;
        players.push({
          id: o.playerId,
          name: o.name,
          realm: o.realm,
          p: [o.position.x, o.position.y, o.position.z],
          yaw: o.yaw,
          anim: o.anim,
        });
      }
      players.sort(
        (a, b) =>
          dist3({ x: a.p[0], y: a.p[1], z: a.p[2] }, s.position) -
          dist3({ x: b.p[0], y: b.p[1], z: b.p[2] }, s.position),
      );
      if (players.length > SNAPSHOT_PLAYER_CAP) players.length = SNAPSHOT_PLAYER_CAP;
      this.send(s.ws, { t: "snapshot", tick: this.tick, serverTime: now, players, events });
    }
  }

  // --- world events ----------------------------------------------------------------

  private broadcastEventTransitions(): void {
    const transitions = this.schedule.pollTransitions();
    if (transitions.length === 0) return;
    this.eventQueue.push(...transitions); // folded into the next snapshot too
    for (const event of transitions) {
      for (const s of this.sessions.values()) {
        if (s.ws.readyState === WebSocket.OPEN) this.send(s.ws, { t: "event", event });
      }
    }
  }

  // --- heartbeat ----------------------------------------------------------------------

  private heartbeatSweep(): void {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastSeenAt > STALE_MS) {
        try {
          s.ws.terminate();
        } catch {
          /* already gone */
        }
        this.teardown(s, true);
        continue;
      }
      try {
        s.ws.ping();
      } catch {
        /* ignore */
      }
    }
  }

  // --- persistence ----------------------------------------------------------------------

  private flushDirty(): void {
    for (const s of this.sessions.values()) void this.flushSession(s);
  }

  private async flushSession(session: Session): Promise<void> {
    if (session.dirtyProgression) {
      session.dirtyProgression = false;
      try {
        await saveProgression(session.playerId, session.progression);
      } catch (err) {
        session.dirtyProgression = true;
        console.error("[gateway] saveProgression failed:", err);
      }
    }
    if (session.dirtyPosition) {
      session.dirtyPosition = false;
      try {
        await savePosition(session.playerId, session.realm, session.position);
      } catch (err) {
        session.dirtyPosition = true;
        console.error("[gateway] savePosition failed:", err);
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket racing close */
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton + attach helper (used by api/boot.ts)
// ---------------------------------------------------------------------------

let gateway: GameGateway | null = null;

export function getGameGateway(): GameGateway {
  if (!gateway) gateway = new GameGateway();
  return gateway;
}

/** Attach the WS gateway to the Node http server at path /ws (production). */
export function attachGameGateway(server: HttpServer): GameGateway {
  const gw = getGameGateway();
  gw.attach(server, "/ws");
  return gw;
}
