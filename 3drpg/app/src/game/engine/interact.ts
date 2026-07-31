// ============================================================================
// CORESAPIAN — src/game/engine/interact.ts (ENGINE-OWNED)
// The `interactables` service (frozen seam) plus the E-key interaction
// runtime: nearest-available targeting with the gdd §4 priority
// (npc > portal > loot > node > prop), store `interactPrompt` +
// `interact_target` event, channel mechanics (portal 1.2s / node 1.5s,
// cancelled by damage), and physics-prop carry/throw (gdd §4: light/medium/
// heavy weight classes, walk penalties, ballistic throw with terrain
// bounce + settle; Jǫtun Grip removes penalty and doubles throw).
// ============================================================================

import { Vector3 } from 'three';
import type { Object3D } from 'three';

import { REALM_ABILITIES } from '../../../contracts/skills';
import type { GameEventBus } from '../events';
import type { Interactable, InteractableService } from '../services';
import type { ServiceRegistry } from '../services';
import type { UseGameStore } from '../store';
import type { CameraRig } from './cameraRig';
import type { EngineInput } from './input';
import { GRAVITY } from './physics';
import type { PlayerPhysics } from './physics';

// --- gdd.md §4 prop numbers --------------------------------------------------
/** Weight-class thresholds (kg). */
const MEDIUM_PROP_MIN_KG = 15;
const HEAVY_PROP_MIN_KG = 60;
/** Throw speeds (m/s) per weight class. */
const THROW_SPEED = { light: 12, medium: 8, heavy: 5 } as const;
/** Carry walk-speed penalties (medium −15%, heavy −35%; light unpenalized). */
const CARRY_SPEED_MULT = { light: 1, medium: 0.85, heavy: 0.65 } as const;

// --- engine-internal feel constants (not contract-covered) -------------------
/** Approx prop body radius for ground rest / set-down placement. */
const PROP_RADIUS_M = 0.3;
/** Set-down distance in front of the player. */
const SET_DOWN_DISTANCE_M = 1.4;
/** Bounce restitution / tangential friction on terrain impact. */
const PROP_RESTITUTION = 0.35;
const PROP_BOUNCE_FRICTION = 0.6;
/** Below this impact speed the prop settles instead of bouncing (m/s). */
const PROP_SETTLE_SPEED = 2;
/** Slight upward arc on throws. */
const THROW_LIFT = 2;
/** HUD copy while carrying (ui renders this verbatim via interactPrompt). */
const CARRY_PROMPT = 'E — set down · LMB — throw';
/** Targeting is measured from the capsule center (feet + this). */
const TARGET_ORIGIN_HEIGHT = 0.9;

/** gdd §4 interact priority (lower wins). */
const KIND_PRIORITY: Record<Interactable['kind'], number> = {
  npc: 0,
  portal: 1,
  loot: 2,
  node: 3,
  prop: 4,
};

export type PropWeightClass = 'light' | 'medium' | 'heavy';

/**
 * Optional extension other agents use to make a `prop` interactable
 * carryable (world/rpg register these via the frozen Interactable seam —
 * extra fields are structural, never imported across agents).
 */
export interface PropInteractable extends Interactable {
  weightClass?: PropWeightClass;
  /** Alternative to weightClass: raw kg, bucketed per gdd §4 thresholds. */
  weightKg?: number;
  /** World object that follows the carry mount / ballistic sim. */
  object?: Object3D;
}

interface CarriedProp {
  def: PropInteractable;
  weightClass: PropWeightClass;
}

interface ThrownProp {
  def: PropInteractable;
  pos: Vector3;
  vel: Vector3;
}

export interface InteractSystemDeps {
  store: UseGameStore;
  events: GameEventBus;
  services: ServiceRegistry;
  input: EngineInput;
  physics: PlayerPhysics;
  rig: CameraRig;
  /** Shared channel-state object (Game facade + player service read this). */
  channel: { active: boolean; progress: number };
}

export class InteractSystem implements InteractableService {
  private readonly store: UseGameStore;
  private readonly events: GameEventBus;
  private readonly services: ServiceRegistry;
  private readonly input: EngineInput;
  private readonly physics: PlayerPhysics;
  private readonly rig: CameraRig;

  private readonly registry = new Map<string, Interactable>();
  private currentTargetId: string | null = null;
  private lastPrompt: string | null = null;

  /** Live channel state — shared with the Game facade + player service. */
  readonly channel: { active: boolean; progress: number };
  private channelTarget: Interactable | null = null;
  private channelElapsedMs = 0;

  private carried: CarriedProp | null = null;
  private readonly thrown: ThrownProp[] = [];

  private readonly tmpVec = new Vector3();
  private readonly tmpVec2 = new Vector3();

  constructor(deps: InteractSystemDeps) {
    this.store = deps.store;
    this.events = deps.events;
    this.services = deps.services;
    this.input = deps.input;
    this.physics = deps.physics;
    this.rig = deps.rig;
    this.channel = deps.channel;

    this.input.onAction('interact', (phase) => {
      if (phase === 'down') this.onInteractPressed();
    });
    // While carrying, LMB throws instead of attacking (gdd §4).
    this.input.onAction('attack', (phase) => {
      if (phase === 'down' && this.carried) this.throwCarried();
    });
  }

  // -------------------------------------------------------- InteractableService

  register(item: Interactable): () => void {
    this.registry.set(item.id, item);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.registry.get(item.id) === item) this.registry.delete(item.id);
      if (this.currentTargetId === item.id) this.currentTargetId = null;
      if (this.channelTarget?.id === item.id) this.cancelChannel();
    };
  }

  // ---------------------------------------------------------------- targeting

  /** Best interactable: available, in radius, priority then distance. */
  private pickTarget(): Interactable | null {
    const origin = this.physics.getPosition(this.tmpVec);
    const oy = origin.y + TARGET_ORIGIN_HEIGHT;
    let best: Interactable | null = null;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const item of this.registry.values()) {
      if (item.isAvailable && !item.isAvailable()) continue;
      const dx = item.position.x - origin.x;
      const dy = item.position.y - oy;
      const dz = item.position.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > item.radius) continue;
      const rank = KIND_PRIORITY[item.kind];
      if (rank < bestRank || (rank === bestRank && dist < bestDist)) {
        best = item;
        bestRank = rank;
        bestDist = dist;
      }
    }
    return best;
  }

  private inRange(item: Interactable): boolean {
    const origin = this.physics.getPosition(this.tmpVec);
    const dx = item.position.x - origin.x;
    const dy = item.position.y - (origin.y + TARGET_ORIGIN_HEIGHT);
    const dz = item.position.z - origin.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= item.radius;
  }

  private setPrompt(prompt: string | null): void {
    if (prompt === this.lastPrompt) return;
    this.lastPrompt = prompt;
    this.store.getState().setInteractPrompt(prompt);
    this.events.emit('interact_target', { prompt });
  }

  // ------------------------------------------------------------------ actions

  private onInteractPressed(): void {
    if (this.input.isSuspended()) return;
    if (this.carried) {
      this.setDownCarried();
      return;
    }
    if (this.channel.active) {
      this.cancelChannel(); // E toggles the channel off
      return;
    }
    const target = this.pickTarget();
    if (!target) return;
    if (target.kind === 'prop' && this.propWeightClass(target as PropInteractable)) {
      this.grabProp(target as PropInteractable);
      return;
    }
    if (target.channelMs && target.channelMs > 0) {
      this.channelTarget = target;
      this.channelElapsedMs = 0;
      this.channel.active = true;
      this.channel.progress = 0;
      return;
    }
    this.fireInteract(target);
  }

  private fireInteract(target: Interactable): void {
    try {
      target.onInteract();
    } catch (err) {
      console.error(`[interact] onInteract for "${target.id}" threw`, err);
    }
  }

  /** Taking damage cancels the channel (gdd §4, wired via player.onDamaged). */
  cancelChannel(): void {
    this.channelTarget = null;
    this.channelElapsedMs = 0;
    this.channel.active = false;
    this.channel.progress = 0;
  }

  // -------------------------------------------------------------- fixed step

  fixedUpdate(dt: number): void {
    const suspended = this.input.isSuspended();

    // --- targeting + prompt ---
    if (suspended) {
      if (this.channel.active) this.cancelChannel();
      this.setPrompt(null);
      this.currentTargetId = null;
    } else if (this.carried) {
      this.setPrompt(CARRY_PROMPT);
    } else {
      const target = this.pickTarget();
      this.currentTargetId = target?.id ?? null;
      this.setPrompt(target ? target.prompt : null);
    }

    // --- channel progression ---
    if (this.channel.active && this.channelTarget) {
      const target = this.channelTarget;
      const available = !target.isAvailable || target.isAvailable();
      if (!available || !this.registry.has(target.id) || !this.inRange(target)) {
        this.cancelChannel();
      } else {
        this.channelElapsedMs += dt * 1000;
        const total = target.channelMs ?? 1;
        this.channel.progress = Math.min(1, this.channelElapsedMs / total);
        if (this.channel.progress >= 1) {
          this.cancelChannel();
          this.fireInteract(target);
        }
      }
    }

    // --- thrown prop ballistics (continues while menus are open) ---
    this.stepThrownProps(dt);
  }

  /** Per-rAF: carried prop visuals track the camera carry mount. */
  updateVisuals(): void {
    if (this.carried?.def.object) {
      this.rig.getCarryWorldPosition(this.tmpVec2);
      this.carried.def.object.position.copy(this.tmpVec2);
    }
  }

  // ------------------------------------------------------------------ props

  private propWeightClass(def: PropInteractable): PropWeightClass | null {
    if (def.weightClass) return def.weightClass;
    if (typeof def.weightKg === 'number') {
      if (def.weightKg < MEDIUM_PROP_MIN_KG) return 'light';
      if (def.weightKg <= HEAVY_PROP_MIN_KG) return 'medium';
      return 'heavy';
    }
    return null;
  }

  /** Jǫtun Grip (contracts/skills.ts ra_jotunheim): passive_carry mults. */
  private carryGripMults(): { weightMult: number; throwMult: number } {
    if (!this.store.getState().realmAbilities.includes('ra_jotunheim')) {
      return { weightMult: 1, throwMult: 1 };
    }
    const effect = REALM_ABILITIES['ra_jotunheim'].effect;
    return effect.type === 'passive_carry'
      ? { weightMult: effect.weightMult, throwMult: effect.throwMult }
      : { weightMult: 1, throwMult: 1 };
  }

  private grabProp(def: PropInteractable): void {
    const weightClass = this.propWeightClass(def);
    if (!weightClass || this.carried) return;
    // Detach from the target registry while carried (re-registered on
    // set-down / throw-settle at its new rest position).
    this.registry.delete(def.id);
    if (this.currentTargetId === def.id) this.currentTargetId = null;
    if (this.channelTarget?.id === def.id) this.cancelChannel();
    this.carried = { def, weightClass };
    const { weightMult } = this.carryGripMults();
    const penalty = 1 + (CARRY_SPEED_MULT[weightClass] - 1) * weightMult;
    this.physics.setCarrySpeedMult(penalty);
    if (this.channel.active) this.cancelChannel();
  }

  private setDownCarried(): void {
    const carried = this.carried;
    if (!carried) return;
    this.carried = null;
    this.physics.setCarrySpeedMult(1);

    const feet = this.physics.getPosition(this.tmpVec);
    const yaw = this.input.getYaw();
    const x = feet.x - Math.sin(yaw) * SET_DOWN_DISTANCE_M;
    const z = feet.z - Math.cos(yaw) * SET_DOWN_DISTANCE_M;
    const y = this.sampleGround(x, z) + PROP_RADIUS_M;
    carried.def.position.set(x, y, z);
    if (carried.def.object) carried.def.object.position.copy(carried.def.position);
    this.register(carried.def);
  }

  private throwCarried(): void {
    const carried = this.carried;
    if (!carried) return;
    this.carried = null;
    this.physics.setCarrySpeedMult(1);

    const { throwMult } = this.carryGripMults();
    const speed = THROW_SPEED[carried.weightClass] * throwMult;
    const dir = this.rig.getLookDirection(this.tmpVec2);
    const pos = new Vector3().copy(carried.def.position);
    if (carried.def.object) pos.copy(carried.def.object.position);
    const vel = new Vector3(dir.x * speed, dir.y * speed + THROW_LIFT, dir.z * speed);
    this.thrown.push({ def: carried.def, pos, vel });
  }

  /** Simple ballistic sim: gravity, terrain bounce, settle → re-register. */
  private stepThrownProps(dt: number): void {
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const p = this.thrown[i];
      p.vel.y -= GRAVITY * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;

      const ground = this.sampleGround(p.pos.x, p.pos.z) + PROP_RADIUS_M;
      if (p.pos.y <= ground) {
        p.pos.y = ground;
        if (Math.abs(p.vel.y) > PROP_SETTLE_SPEED) {
          p.vel.y = -p.vel.y * PROP_RESTITUTION;
          p.vel.x *= PROP_BOUNCE_FRICTION;
          p.vel.z *= PROP_BOUNCE_FRICTION;
        } else if (Math.hypot(p.vel.x, p.vel.z) > PROP_SETTLE_SPEED) {
          p.vel.y = 0;
          p.vel.x *= PROP_BOUNCE_FRICTION;
          p.vel.z *= PROP_BOUNCE_FRICTION;
        } else {
          // Settled: rest on the terrain and become interactable again.
          p.def.position.copy(p.pos);
          if (p.def.object) p.def.object.position.copy(p.pos);
          this.register(p.def);
          this.thrown.splice(i, 1);
          continue;
        }
      }
      if (p.def.object) p.def.object.position.copy(p.pos);
    }
  }

  /** Drop whatever is carried without throwing (respawn, realm travel). */
  forceDropCarried(): void {
    if (!this.carried) return;
    this.setDownCarried();
  }

  getCarriedProp(): { id: string; weightClass: PropWeightClass } | null {
    return this.carried
      ? { id: this.carried.def.id, weightClass: this.carried.weightClass }
      : null;
  }

  private sampleGround(x: number, z: number): number {
    // Never cached — world re-registers terrain on realm change (addendum §2).
    const terrain = this.services.get('terrain');
    return terrain ? terrain.sampleHeight(x, z) : 0;
  }
}
