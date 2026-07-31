// ============================================================================
// CORESAPIAN — src/game/net/index.ts (audio-net)
//
// Pinned subsystem entry (addendum §1): createNetSubsystem(), id "net".
// Stage 7 of fixedUpdate: 15Hz input send, attack-claim drain, snapshot
// ingest, reconciliation; update(): orb interpolation/render (gdd §10).
//
// Protocol EXACTLY per contracts/netcode.ts. Reconnect: constant 3000ms,
// no backoff; world keeps rendering while the banner counts down.
// ============================================================================

import type { GameContext, GameSubsystem } from '../Game';
import type { ServiceRegistry } from '../services';
import type { RealmId, RemoteAnim, RemotePlayer } from '../../../contracts/types';
import {
  BTN_ATTACK,
  BTN_BLOCK,
  BTN_DODGE,
  BTN_INTERACT,
  BTN_JUMP,
  BTN_SPRINT,
  CLIENT_INPUT_HZ,
  PROTOCOL_VERSION,
  validateName,
} from '../../../contracts/netcode';
import type {
  AttackClaimMsg,
  InputMsg,
  SnapshotMsg,
  WelcomeMsg,
} from '../../../contracts/netcode';

import { NetClient, defaultWsUrl } from './client';
import { getPendingOpPayload, isServerOp, releaseOpPayload } from '../rpg/ops';
import { OrbRenderer } from './orbs';

// ---------------------------------------------------------------------------
// combat-ai attack-claim handoff (orchestrator-granted exception):
// import `drainAttackClaims` from ../combat/netClaims. The file merges in the
// same wave; an eager glob resolves it when present and yields {} standalone,
// so this branch type-checks and runs alone while the merged build wires the
// real module statically at bundle time.
// ---------------------------------------------------------------------------

/** Mirrors combat-ai's AttackClaim = Omit<AttackClaimMsg, 't'> (structural). */
type DrainedClaim = Partial<Omit<AttackClaimMsg, 't'>>;
interface NetClaimsModule {
  drainAttackClaims?: () => DrainedClaim[];
}

const netClaimsModules = import.meta.glob<NetClaimsModule>('../combat/netClaims.ts', {
  eager: true,
});
const netClaims: NetClaimsModule | undefined = netClaimsModules['../combat/netClaims.ts'];

function drainAttackClaims(): DrainedClaim[] {
  try {
    return netClaims?.drainAttackClaims?.() ?? [];
  } catch (err) {
    console.error('[net] drainAttackClaims failed', err);
    return [];
  }
}

// ---------------------------------------------------------------------------

const ANIMS: readonly RemoteAnim[] = ['idle', 'run', 'attack', 'block', 'cast', 'dead'];
const INPUT_PERIOD_S = 1 / CLIENT_INPUT_HZ;
const MAX_PREDICTED_XP_QUEUE = 32;

type Ctx = GameContext & { services?: ServiceRegistry };

/** Engine's InputService implementation exposes getMoveIntent() (extended
 *  surface beyond the frozen interface — feature-detected, never required). */
interface RichInput {
  getMoveIntent?: () => { x: number; z: number };
}

export function createNetSubsystem(): GameSubsystem {
  let ctx: Ctx | null = null;
  let client: NetClient | null = null;
  let orbs: OrbRenderer | null = null;
  const unsubs: Array<() => void> = [];
  let disposed = false;

  // Outbound state
  let inputAcc = 0;
  let seq = 0;
  let teleportLatch = false;
  let restoredThisSession = false;
  const seenOps = new Set<string>();
  const predictedKillXp: number[] = [];

  function services(): ServiceRegistry | undefined {
    return ctx?.services;
  }

  function store() {
    if (!ctx) throw new Error('[net] store before init');
    return ctx.store.getState();
  }

  function currentRealm(): RealmId {
    return services()?.get('realms')?.current() ?? 'midgard';
  }

  // ------------------------------------------------------------- outbound

  function sendInput(): void {
    const c = client;
    if (!c?.connected || !ctx) return;
    const player = services()?.get('player');
    if (!player) return;

    const pos = player.getPosition();
    const inputSvc = services()?.get('input') as (RichInput & { isDown(a: string): boolean }) | undefined;
    const rawMove = inputSvc?.getMoveIntent?.() ?? { x: 0, z: 0 };
    const move = {
      x: Math.max(-1, Math.min(1, rawMove.x)),
      z: Math.max(-1, Math.min(1, rawMove.z)),
    };

    let buttons = 0;
    if (inputSvc?.isDown('jump')) buttons |= BTN_JUMP;
    if (inputSvc?.isDown('sprint')) buttons |= BTN_SPRINT;
    if (inputSvc?.isDown('attack')) buttons |= BTN_ATTACK;
    if (inputSvc?.isDown('block')) buttons |= BTN_BLOCK;
    if (inputSvc?.isDown('interact')) buttons |= BTN_INTERACT;
    if (inputSvc?.isDown('dodge')) buttons |= BTN_DODGE;

    const teleported = teleportLatch;
    const msg: InputMsg = {
      t: 'input',
      seq: seq++,
      move,
      yaw: player.getYaw(),
      pitch: player.getPitch(),
      buttons,
      position: { x: pos.x, y: pos.y, z: pos.z },
      realm: currentRealm(),
      clientTime: Date.now(),
      ...(teleported ? { teleported: true } : {}),
    };
    if (c.send(msg)) teleportLatch = false;
  }

  function sendAttackClaims(): void {
    const c = client;
    if (!c?.connected) return;
    const claims = drainAttackClaims();
    for (const claim of claims) {
      const claimId = typeof claim.claimId === 'string' ? claim.claimId : '';
      const itemId = typeof claim.itemId === 'string' ? claim.itemId : '';
      if (!claimId || !itemId) continue;
      const msg: AttackClaimMsg = {
        t: 'attack',
        claimId,
        attackKind: claim.attackKind ?? 'light',
        itemId,
        origin: claim.origin ?? { x: 0, y: 0, z: 0 },
        dir: claim.dir ?? { x: 0, y: 0, z: 1 },
        clientTime: typeof claim.clientTime === 'number' ? claim.clientTime : Date.now(),
        ...(typeof claim.targetId === 'string' ? { targetId: claim.targetId } : {}),
        ...(typeof claim.charge === 'number' ? { charge: claim.charge } : {}),
      };
      c.send(msg);
    }
  }

  function flushInvOps(): void {
    const c = client;
    if (!c?.connected || !ctx) return;
    const s = store();
    for (const opId of s.pendingOps) {
      if (seenOps.has(opId)) continue;
      // Canonical op layer (rpg/ops.ts): payloads live in the outbox; only
      // server kinds hit the wire — local ops are settled by the rpg
      // subsystem, anything without a payload is left alone.
      const payload = getPendingOpPayload(opId);
      if (!payload) continue;
      seenOps.add(opId);
      if (!isServerOp(payload)) continue;
      c.send({ t: 'invop', opId, op: payload });
    }
  }

  // -------------------------------------------------------------- inbound

  function onWelcome(msg: WelcomeMsg): void {
    const s = store();
    seq = 0; // input seq restarts per session

    if (!restoredThisSession) {
      // First join: full character restore (addendum §7). Progression is
      // applied BEFORE travelTo so portal unlock checks see restored quests.
      restoredThisSession = true;
      s.applyInventorySnapshot(msg.inventory);
      s.applyServerProgression(msg.progression);
      s.applyEventSchedule(msg.events);
      const realms = services()?.get('realms');
      if (realms && realms.current() !== msg.spawn.realm) {
        try {
          realms.travelTo(msg.spawn.realm, { spawnOverride: msg.spawn.position });
        } catch (err) {
          console.error('[net] server-restore travel failed', err);
        }
      }
    } else {
      // Reconnect resync: authoritative inventory + event schedule only
      // (do not yank the player across realms or clobber predicted xp).
      s.applyInventorySnapshot(msg.inventory);
      s.applyEventSchedule(msg.events);
    }

    // Ops still pending may have been lost with the old socket; resend them
    // (the server rejects duplicates idempotently per gdd §12.11).
    for (const opId of store().pendingOps) seenOps.delete(opId);
    flushInvOps();
  }

  function onSnapshot(msg: SnapshotMsg): void {
    const s = store();
    const players: RemotePlayer[] = [];
    for (const p of msg.players) {
      if (p.id === s.playerId) continue;
      players.push({
        playerId: p.id,
        name: p.name,
        realm: p.realm,
        position: { x: p.p[0], y: p.p[1], z: p.p[2] },
        yaw: p.yaw,
        anim: ANIMS[p.anim] ?? 'idle',
        lastTick: msg.tick,
      });
    }
    s.applySnapshotPlayers(players, msg.tick);
    orbs?.ingest(msg.players, msg.serverTime, s.playerId);
    if (msg.events) {
      for (const e of msg.events) s.upsertEvent(e);
    }
  }

  return {
    id: 'net',

    init(c: GameContext): void {
      ctx = c as Ctx;
      orbs = new OrbRenderer(c.scene);

      // XP prediction tracking (delta reconciliation on `dmg` results).
      unsubs.push(
        c.events.on('xp_gain', ({ amount, source }) => {
          if (source === 'server' || source.startsWith('quest:')) return;
          predictedKillXp.push(amount);
          if (predictedKillXp.length > MAX_PREDICTED_XP_QUEUE) predictedKillXp.shift();
        }),
        // Teleport-flag latches (portal travel / respawn bypass move sanity).
        c.events.on('realm_change', () => {
          teleportLatch = true;
        }),
        c.events.on('player_respawn', () => {
          teleportLatch = true;
        }),
      );

      // Inventory op transport: watch pendingOps for newly originated ops.
      unsubs.push(
        c.store.subscribe((state, prev) => {
          if (state.pendingOps !== prev.pendingOps) flushInvOps();
        }),
      );

      client = new NetClient(
        defaultWsUrl(),
        () => {
          const s = store();
          return {
            t: 'hello',
            protocolVersion: PROTOCOL_VERSION,
            playerId: s.playerId,
            name: validateName(s.displayName) ? s.displayName : 'Wanderer',
          };
        },
        {
          onStatus: (status) => store().setStatus(status),
          onWelcome,
          onSnapshot,
          onDamage: (msg) => {
            if (!msg.accepted) {
              console.debug(`[net] attack claim ${msg.claimId} rejected: ${msg.reason ?? 'unknown'}`);
              return;
            }
            // Authoritative kill xp: correct the local prediction by delta so
            // rpg-quests never double-grants (addendum §6 / task spec).
            if (msg.killed && typeof msg.xpAwarded === 'number') {
              const predicted = predictedKillXp.length > 0 ? predictedKillXp.shift()! : null;
              const delta = predicted === null ? msg.xpAwarded : msg.xpAwarded - predicted;
              if (delta !== 0 && ctx) {
                ctx.events.emit('xp_gain', { amount: delta, source: 'server' });
              }
            }
          },
          onVitals: (msg) => {
            store().applyServerVitals({
              hp: msg.hp,
              maxHp: msg.maxHp,
              wyrd: msg.wyrd,
              maxWyrd: msg.maxWyrd,
            });
          },
          onInventoryAck: (msg) => {
            seenOps.delete(msg.opId);
            releaseOpPayload(msg.opId);
            const s = store();
            s.applyInventoryAck(msg.opId, msg.ok, msg.inventory);
            if (!msg.ok) {
              s.notify('warning', `Inventory op failed: ${msg.reason ?? 'unknown'}`);
            }
          },
          onInventorySync: (msg) => {
            store().applyInventorySnapshot(msg.inventory);
          },
          onWorldEvent: (msg) => {
            store().upsertEvent(msg.event);
          },
          onPong: (msg) => {
            store().setLatency(Math.max(0, Date.now() - msg.clientTime));
          },
          onServerError: (msg) => {
            store().notify('warning', msg.message);
          },
          onReconnectTick: () => {
            ctx?.events.emit('play_sfx', { sfxId: 'sfx.reconnect.tick' });
          },
          onCorrect: (msg) => {
            // Server rubber-band: snap back to the authoritative position.
            try {
              services()?.require('player').teleport(msg.position);
              store().notify('warning', 'Position corrected by server');
            } catch {
              /* player service not ready yet */
            }
          },
        },
      );
      client.connect();
    },

    fixedUpdate(dt: number): void {
      if (disposed || !client) return;
      inputAcc += dt;
      if (inputAcc >= INPUT_PERIOD_S) {
        inputAcc %= INPUT_PERIOD_S;
        sendInput();
        sendAttackClaims();
        flushInvOps();
      }
    },

    update(dt: number): void {
      if (disposed || !ctx || !orbs) return;
      const s = store();
      orbs.frame(dt, s.remotePlayers, services()?.get('realms')?.current() ?? null, ctx.camera);
    },

    dispose(): void {
      disposed = true;
      for (const u of unsubs.splice(0)) {
        try {
          u();
        } catch {
          /* noop */
        }
      }
      client?.dispose();
      client = null;
      orbs?.dispose();
      orbs = null;
      seenOps.clear();
      predictedKillXp.length = 0;
      ctx = null;
    },
  };
}
