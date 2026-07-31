// ============================================================================
// CORESAPIAN — src/game/engine/core.ts (ENGINE-OWNED)
// Engine core: constructs input / physics / camera rig / interact / player,
// registers the engine-provided services (`player`, `interactables`, `input`)
// into the frozen ServiceRegistry BEFORE any subsystem init (addendum §2),
// and runs the core fixed stages (input → physics → interact, gdd §3.3) plus
// the per-frame camera update. Also owns spawn/respawn (addendum §5).
// ============================================================================

import type { PerspectiveCamera, Scene } from 'three';

import type { RealmId } from '../../../contracts/types';
import { REALMS } from '../config';
import type { GameEventBus } from '../events';
import { ServiceRegistry } from '../services';
import type { UseGameStore } from '../store';
import { CameraRig } from './cameraRig';
import { EngineInput } from './input';
import { InteractSystem } from './interact';
import { EnginePlayerService } from './player';
import { PlayerPhysics } from './physics';
/** Respawn vitals per gdd §11.2: 50% hp, full stamina, no XP/item loss. */
const RESPAWN_HP_FRACTION = 0.5;

export interface EngineCoreDeps {
  canvas: HTMLCanvasElement;
  store: UseGameStore;
  events: GameEventBus;
  scene: Scene;
  camera: PerspectiveCamera;
  services: ServiceRegistry;
  homeRealm: RealmId;
  /** Shared interact-channel state, exposed on the Game facade (addendum §3). */
  interactChannel: { active: boolean; progress: number };
}

export class EngineCore {
  readonly input: EngineInput;
  readonly physics: PlayerPhysics;
  readonly rig: CameraRig;
  readonly interact: InteractSystem;
  readonly player: EnginePlayerService;

  private readonly store: UseGameStore;
  private readonly events: GameEventBus;
  private readonly services: ServiceRegistry;
  private readonly homeRealm: RealmId;

  /** Shared sim clock (seconds) stamped each fixed step. */
  private readonly clock = { now: 0 };

  private readonly unsubscribeRespawn: () => void;
  private disposed = false;

  constructor(deps: EngineCoreDeps) {
    this.store = deps.store;
    this.events = deps.events;
    this.services = deps.services;
    this.homeRealm = deps.homeRealm;

    // The camera must live in the scene graph for its children (viewmodel
    // mount, carry mount) to render.
    deps.scene.add(deps.camera);

    this.input = new EngineInput({ canvas: deps.canvas, store: deps.store, events: deps.events });
    this.physics = new PlayerPhysics({ store: deps.store, services: deps.services, input: this.input });
    this.rig = new CameraRig({
      camera: deps.camera,
      store: deps.store,
      events: deps.events,
      input: this.input,
      physics: this.physics,
    });
    this.interact = new InteractSystem({
      store: deps.store,
      events: deps.events,
      services: deps.services,
      input: this.input,
      physics: this.physics,
      rig: this.rig,
      channel: deps.interactChannel,
    });
    this.player = new EnginePlayerService({
      store: deps.store,
      events: deps.events,
      input: this.input,
      physics: this.physics,
      rig: this.rig,
      clock: this.clock,
    });

    // Cross-wiring.
    this.player.onDamaged = () => this.interact.cancelChannel();
    this.player.channel = this.interact.channel;

    // Engine-provided services, registered BEFORE subsystem inits (§2).
    this.services.register('input', this.input);
    this.services.register('player', this.player);
    this.services.register('interactables', this.interact);

    // Respawn watch (addendum §5): ui sets dead=false → teleport + vitals.
    let wasDead = this.store.getState().dead;
    this.unsubscribeRespawn = this.store.subscribe((state) => {
      if (wasDead && !state.dead) this.onRespawn();
      wasDead = state.dead;
    });
  }

  /** Initial spawn once the world (terrain service) is up — gdd §11.1. */
  onWorldReady(): void {
    this.teleportToSpawn();
  }

  /** Core fixed stages: input → physics → interact (gdd §3.3, addendum §1). */
  fixedUpdate(dt: number): void {
    this.clock.now += dt;
    this.input.fixedUpdate();
    this.physics.fixedUpdate(dt, this.clock.now);
    this.interact.fixedUpdate(dt);
  }

  /** Per-rAF core update (camera rig + carried-prop visuals). */
  update(dt: number): void {
    this.rig.update(dt);
    this.interact.updateVisuals();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeRespawn();
    this.rig.dispose();
    this.input.dispose();
  }

  // ------------------------------------------------------------------ spawn

  private currentRealm(): RealmId {
    // Prefer the live terrain service; fall back to the realms service.
    const terrain = this.services.get('terrain');
    if (terrain) return terrain.realmId;
    const realms = this.services.get('realms');
    return realms ? realms.current() : this.homeRealm;
  }

  private teleportToSpawn(): void {
    const terrain = this.services.get('terrain'); // never cached (addendum §2)
    // Fallback: home realm's spawnOffset (contracts/realms.ts) at y = 0.
    const spawn = terrain ? terrain.getSpawnPoint() : REALMS[this.homeRealm].spawnOffset;
    this.player.teleport(spawn);
    this.rig.update(0); // snap the camera behind the new position
  }

  /** gdd §11.2 + addendum §5: respawn at realm spawn, 50% hp, full stamina. */
  private onRespawn(): void {
    this.interact.forceDropCarried(); // clear carried prop (deliverable §10)
    this.interact.cancelChannel();
    this.teleportToSpawn();

    const s = this.store.getState();
    s.setVitals({
      hp: Math.round(s.vitals.maxHp * RESPAWN_HP_FRACTION),
      stamina: s.vitals.maxStamina,
    });

    this.events.emit('player_respawn', {
      realm: this.currentRealm(),
      position: this.player.getPosition(),
    });
  }
}
