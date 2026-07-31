// ============================================================================
// CORESAPIAN — src/game/audio/index.ts (audio-net)
//
// Pinned subsystem entry (addendum §1): createAudioSubsystem(), id "audio".
// Stage 8 of fixedUpdate: listener sync (per-frame in update()), event-queue
// reactions, footsteps, low-HP layer, drone/vocal schedulers.
// ============================================================================

import type { GameContext, GameSubsystem } from '../Game';
import type { ServiceRegistry } from '../services';
import type { RealmId } from '../../../contracts/types';

import { AudioEngine } from './engine';
import { DroneManager } from './drone';
import { VocalPad } from './vocal';
import { playSfx } from './sfx';

/** Realm → footstep surface variant (terrain realm surface). */
const SURFACE_BY_REALM: Record<RealmId, 'grass' | 'stone' | 'snow'> = {
  midgard: 'grass',
  alfheim: 'grass',
  vanaheim: 'grass',
  svartalfheim: 'stone',
  muspelheim: 'stone',
  helheim: 'stone',
  asgard: 'stone',
  jotunheim: 'snow',
  niflheim: 'snow',
};

const WALK_STRIDE_M = 1.9;
const SPRINT_STRIDE_M = 2.2;
const MIN_STEP_SPEED = 0.6;
const LOW_HP_ENTER = 0.25;
const LOW_HP_EXIT = 0.4;
const HEARTBEAT_BPM = 60;
const COMBAT_HEAT_S = 4;

/** GameContext in the merged tree carries `services` (addendum §2). */
type Ctx = GameContext & { services?: ServiceRegistry };

export function createAudioSubsystem(): GameSubsystem {
  const engine = new AudioEngine();
  const drone = new DroneManager(engine);

  let ctx: Ctx | null = null;
  const unsubs: Array<() => void> = [];
  let disposed = false;

  // Realm/drone state
  let droneStarted = false;
  let currentRealm: RealmId = 'midgard';
  let qualityLow = false;

  // Vocal pads (boss / portal)
  let bossPad: VocalPad | null = null;
  let portalPad: VocalPad | null = null;
  let portalPadStopAt = 0;

  // Footstep / movement state
  let prevPos: { x: number; y: number; z: number } | null = null;
  let strideAcc = 0;
  let airborneFor = 0;
  let wasGrounded = true;

  // Low-HP state
  let lowHpActive = false;
  let nextHeartbeatAt = 0;

  function services(): ServiceRegistry | undefined {
    return ctx?.services;
  }

  function realmNow(): RealmId {
    const realms = services()?.get('realms');
    if (realms) return realms.current();
    const terrain = services()?.get('terrain');
    return terrain?.realmId ?? currentRealm;
  }

  function maybeStartDrone(): void {
    if (!engine.ready || droneStarted) return;
    droneStarted = true;
    currentRealm = realmNow();
    drone.setQuality(qualityLow);
    drone.crossfadeTo(currentRealm);
  }

  function startBossPad(): void {
    if (bossPad?.active) return;
    bossPad ??= new VocalPad(engine, { root: 110, gain: 0.05, morph: true, rRoll: true });
    bossPad.start(1.2);
  }

  function stopBossPad(): void {
    bossPad?.stop(1.0);
  }

  function startPortalPad(): void {
    portalPad ??= new VocalPad(engine, { root: 146.8, gain: 0.05, morph: true });
    portalPad.start(0.6);
    portalPadStopAt = engine.now() + 4;
  }

  function applySettings(): void {
    const s = ctx?.store.getState();
    if (!s) return;
    engine.applyVolumes(s.volumeMaster, s.volumeMusic, s.volumeSfx);
  }

  function playFootstep(): void {
    const terrain = services()?.get('terrain');
    const surface = terrain ? SURFACE_BY_REALM[terrain.realmId] : 'grass';
    playSfx(engine, `sfx.footstep.${surface}`);
  }

  function scheduleHeartbeat(at: number): void {
    const ac = engine.context;
    const bus = engine.bus('mus');
    if (!ac || !bus) return;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.setTargetAtTime(0.12, at, 0.005);
    g.gain.setTargetAtTime(0.0001, at + 0.02, 0.06);
    osc.connect(g);
    g.connect(bus);
    osc.start(at);
    osc.stop(at + 0.3);
    osc.onended = () => {
      g.disconnect();
    };
  }

  return {
    id: 'audio',

    init(c: GameContext): void {
      ctx = c as Ctx;
      engine.bindGestureUnlock(c.canvas.ownerDocument?.defaultView ?? window);

      const s = c.store.getState();
      qualityLow = s.quality === 'low';
      engine.setQuality(s.quality);

      // Settings → bus gains + quality (rebuild drone on quality flip).
      unsubs.push(
        c.store.subscribe((state, prev) => {
          if (
            state.volumeMaster !== prev.volumeMaster ||
            state.volumeMusic !== prev.volumeMusic ||
            state.volumeSfx !== prev.volumeSfx
          ) {
            applySettings();
          }
          if (state.quality !== prev.quality) {
            engine.setQuality(state.quality);
            const low = state.quality === 'low';
            if (low !== qualityLow) {
              qualityLow = low;
              drone.setQuality(low);
              if (droneStarted && engine.ready) {
                drone.stopAll();
                droneStarted = false;
              }
            }
          }
        }),
      );

      const ev = c.events;
      unsubs.push(
        ev.on('pointer_lock', ({ locked }) => {
          if (locked) {
            engine.ensure();
            applySettings();
          }
        }),
        ev.on('play_sfx', ({ sfxId, position, volume }) => {
          playSfx(engine, sfxId, { position, volume });
        }),
        ev.on('realm_change', ({ to }) => {
          currentRealm = to;
          if (engine.ready) {
            maybeStartDrone();
            drone.crossfadeTo(to);
          } else {
            droneStarted = false;
          }
        }),
        ev.on('boss_engaged', () => {
          drone.setBoss(true);
          drone.pokeCombatHeat(COMBAT_HEAT_S);
          startBossPad();
        }),
        ev.on('boss_disengaged', () => {
          drone.setBoss(false);
          stopBossPad();
        }),
        ev.on('portal_enter', () => {
          startPortalPad();
          playSfx(engine, 'sfx.portal.travel');
        }),
        ev.on('world_event', ({ phase }) => {
          if (phase === 'started') playSfx(engine, 'sfx.event.horn');
        }),
        ev.on('level_up', () => {
          playSfx(engine, 'sfx.levelup');
        }),
        ev.on('player_died', () => {
          playSfx(engine, 'sfx.death');
          stopBossPad();
          drone.setBoss(false);
        }),
        ev.on('player_respawn', () => {
          playSfx(engine, 'sfx.respawn');
        }),
        ev.on('damage_number', ({ amount }) => {
          if (amount > 0) {
            playSfx(engine, 'sfx.damage.tick');
            drone.pokeCombatHeat(COMBAT_HEAT_S);
          }
        }),
        ev.on('player_hurt', () => {
          drone.pokeCombatHeat(COMBAT_HEAT_S);
        }),
      );

      // Movement one-shots via the input service (jump / dodge).
      const input = services()?.get('input');
      if (input) {
        unsubs.push(
          input.onAction('jump', (phase) => {
            if (phase === 'down' && wasGrounded) playSfx(engine, 'sfx.jump');
          }),
          input.onAction('dodge', (phase) => {
            if (phase === 'down') playSfx(engine, 'sfx.dodge');
          }),
        );
      }
    },

    fixedUpdate(dt: number): void {
      if (disposed || !ctx) return;
      if (!engine.ready) return;
      maybeStartDrone();

      const store = ctx.store.getState();

      // ---- footsteps: poll player velocity (position delta per fixed tick)
      const player = services()?.get('player');
      if (player && !store.dead && store.activeMenu === 'none') {
        const p = player.getPosition();
        const grounded = player.isGrounded();
        if (prevPos) {
          const dx = p.x - prevPos.x;
          const dz = p.z - prevPos.z;
          const speed = Math.hypot(dx, dz) / dt;
          if (grounded && speed > MIN_STEP_SPEED) {
            strideAcc += Math.hypot(dx, dz);
            const stride = speed > 6 ? SPRINT_STRIDE_M : WALK_STRIDE_M;
            if (strideAcc >= stride) {
              strideAcc = 0;
              playFootstep();
            }
          } else {
            strideAcc = Math.min(strideAcc, WALK_STRIDE_M * 0.5);
          }
          // Landing: airborne → grounded with a meaningful fall.
          if (!grounded) {
            airborneFor += dt;
          } else {
            if (!wasGrounded && airborneFor > 0.18) {
              playSfx(engine, 'sfx.land', { volume: Math.min(1, 0.5 + airborneFor * 0.5) });
            }
            airborneFor = 0;
          }
          wasGrounded = grounded;
        }
        prevPos = { x: p.x, y: p.y, z: p.z };
      }

      // ---- low-HP layer (audio-recipes §5): master lp 800Hz + heartbeat
      const ratio = store.vitals.maxHp > 0 ? store.vitals.hp / store.vitals.maxHp : 1;
      if (!lowHpActive && !store.dead && ratio < LOW_HP_ENTER) {
        lowHpActive = true;
        engine.setMasterLowpass(800, 0.5);
      } else if (lowHpActive && (store.dead || ratio > LOW_HP_EXIT)) {
        lowHpActive = false;
        engine.setMasterLowpass(19500, 0.5);
      }
      if (lowHpActive) {
        const now = engine.now();
        if (nextHeartbeatAt < now) nextHeartbeatAt = now + 0.05;
        while (nextHeartbeatAt < now + 0.2) {
          scheduleHeartbeat(nextHeartbeatAt);
          nextHeartbeatAt += 60 / HEARTBEAT_BPM;
        }
      }

      // ---- boss-bar backstop (events are primary; store poll reconciles)
      if (store.bossBar && !bossPad?.active) {
        drone.setBoss(true);
        startBossPad();
      } else if (!store.bossBar && bossPad?.active) {
        drone.setBoss(false);
        stopBossPad();
      }

      // ---- pads + drone schedulers
      bossPad?.update();
      if (portalPad) {
        portalPad.update();
        if (portalPad.active && engine.now() >= portalPadStopAt) portalPad.stop(1.2);
      }
      drone.update(dt);
    },

    update(): void {
      if (disposed || !ctx) return;
      engine.syncListener(ctx.camera);
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
      bossPad?.stop(0.2);
      portalPad?.stop(0.2);
      drone.dispose();
      engine.dispose();
      ctx = null;
      prevPos = null;
    },
  };
}
