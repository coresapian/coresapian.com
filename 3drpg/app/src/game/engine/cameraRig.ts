// ============================================================================
// CORESAPIAN — src/game/engine/cameraRig.ts (ENGINE-OWNED)
// First-person camera: eye at 1.62m, walk/sprint bob, landing dip, decaying
// trauma shake driven by the `screen_shake` event (gdd §3.4), FOV kick on
// sprint (+6, deliverable §7) and dodge. Also owns the `viewmodelRoot` mount
// combat-ai populates (addendum §8: player viewmodel attaches to the camera)
// and the `carryMount` anchor used for carried physics props.
// ============================================================================

import { Group, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

import { damp } from '../config';
import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';
import type { EngineInput } from './input';
import type { PlayerPhysics } from './physics';

/** Deliverable §7: FPS eye height. */
const EYE_HEIGHT_M = 1.62;
/** Deliverable §7: FOV kick while sprinting. Dodge reuses the same kick. */
const SPRINT_FOV_KICK = 6;
const DODGE_FOV_KICK = 6;
/** FOV kick smoothing. */
const FOV_LAMBDA = 8;

// --- engine-internal feel constants (not contract-covered) -------------------
const BOB_AMP_WALK = 0.032;
const BOB_AMP_SPRINT = 0.05;
/** Bob phase advance per meter travelled. */
const BOB_FREQ_PER_M = 1.9;
const BOB_AMP_LAMBDA = 8;
/** Landing dip spring (critically-damped-ish). */
const DIP_SPRING_K = 140;
const DIP_SPRING_C = 16;
const DIP_IMPACT_SCALE = 0.045;
const DIP_MAX_SPEED = 0.6;
/** Trauma shake magnitudes (offset = trauma² × these). */
const SHAKE_POS_AMP = 0.12;
const SHAKE_ROLL_AMP = 0.05;

export interface CameraRigDeps {
  camera: PerspectiveCamera;
  store: UseGameStore;
  events: GameEventBus;
  input: EngineInput;
  physics: PlayerPhysics;
}

export class CameraRig {
  private readonly camera: PerspectiveCamera;
  private readonly store: UseGameStore;
  private readonly input: EngineInput;
  private readonly physics: PlayerPhysics;

  /** combat-ai attaches weapon/shield/bow/rune viewmodel meshes here. */
  private readonly viewmodelRoot = new Group();
  /** Carried props follow this anchor (interact system reads world pos). */
  private readonly carryMount = new Group();

  private bobPhase = 0;
  private bobAmp = 0;

  private dipPos = 0;
  private dipVel = 0;

  private trauma = 0;
  private traumaDecay = 0;
  private shakeTime = 0;

  private fovKick = 0;
  private lastAppliedFov = 0;

  private readonly unsubShake: () => void;
  private readonly tmp = new Vector3();

  constructor(deps: CameraRigDeps) {
    this.camera = deps.camera;
    this.store = deps.store;
    this.input = deps.input;
    this.physics = deps.physics;

    this.camera.rotation.order = 'YXZ';
    this.viewmodelRoot.name = 'viewmodelRoot';
    this.viewmodelRoot.position.set(0.26, -0.26, -0.5);
    this.carryMount.name = 'carryMount';
    this.carryMount.position.set(0, -0.3, -1.4);
    this.camera.add(this.viewmodelRoot);
    this.camera.add(this.carryMount);

    this.physics.onLand = (impactSpeed) => this.onLand(impactSpeed);
    this.unsubShake = deps.events.on('screen_shake', ({ intensity, durationMs }) => {
      this.trauma = Math.min(1, this.trauma + intensity);
      // The added trauma decays over the requested duration.
      this.traumaDecay = Math.max(this.traumaDecay, intensity / Math.max(0.05, durationMs / 1000));
    });
  }

  dispose(): void {
    this.unsubShake();
    this.camera.remove(this.viewmodelRoot);
    this.camera.remove(this.carryMount);
  }

  getViewmodelRoot(): Group {
    return this.viewmodelRoot;
  }

  /** World-space anchor for carried props (interact system, per frame). */
  getCarryWorldPosition(out: Vector3): Vector3 {
    return this.carryMount.getWorldPosition(out);
  }

  /** Camera look direction (throw direction for props). */
  getLookDirection(out: Vector3): Vector3 {
    return this.camera.getWorldDirection(out);
  }

  /** Landing dip impulse from the physics stage. */
  private onLand(impactSpeed: number): void {
    this.dipVel -= Math.min(impactSpeed * DIP_IMPACT_SCALE, DIP_MAX_SPEED);
  }

  /** Per-rAF frame (render stage — engine renders last, addendum §1). */
  update(dt: number): void {
    const feet = this.physics.getPosition(this.tmp);
    const yaw = this.input.getYaw();
    const pitch = this.input.getPitch();

    // --- walk / sprint bob (grounded, moving) ---
    const speed = this.physics.getHorizontalSpeed();
    const sprinting = this.physics.isSprinting();
    if (this.physics.isGrounded() && speed > 0.5) {
      this.bobPhase += speed * dt * BOB_FREQ_PER_M;
      this.bobAmp = damp(this.bobAmp, sprinting ? BOB_AMP_SPRINT : BOB_AMP_WALK, BOB_AMP_LAMBDA, dt);
    } else {
      this.bobAmp = damp(this.bobAmp, 0, BOB_AMP_LAMBDA, dt);
    }
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.65;

    // --- landing dip spring ---
    this.dipVel += (-DIP_SPRING_K * this.dipPos - DIP_SPRING_C * this.dipVel) * dt;
    this.dipPos += this.dipVel * dt;

    // --- trauma shake (screen_shake events) ---
    this.shakeTime += dt;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
      if (this.trauma === 0) this.traumaDecay = 0;
    }
    const shakeMag = this.trauma * this.trauma;
    const t = this.shakeTime;
    // Cheap layered-sine noise (deterministic, no allocation).
    const shakeX = (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7) * 0.4) * shakeMag * SHAKE_POS_AMP;
    const shakeY = (Math.sin(t * 41.3 + 1.7) * 0.6 + Math.sin(t * 67.9 + 0.6) * 0.4) * shakeMag * SHAKE_POS_AMP;
    const shakeRoll = (Math.sin(t * 47.9 + 3.1) * 0.6 + Math.sin(t * 71.3 + 2.2) * 0.4) * shakeMag * SHAKE_ROLL_AMP;

    // --- compose transform (bob/shake applied in camera-local space) ---
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this.camera.position.set(
      feet.x + rightX * bobX + rightX * shakeX,
      feet.y + EYE_HEIGHT_M + bobY + this.dipPos + shakeY,
      feet.z + rightZ * bobX + rightZ * shakeX,
    );
    this.camera.rotation.set(pitch, yaw, shakeRoll);

    // --- FOV kick: sprint (+6) and dodge, over settings base fov ---
    const baseFov = this.store.getState().fov;
    const targetKick = (sprinting ? SPRINT_FOV_KICK : 0) + (this.physics.isDodging() ? DODGE_FOV_KICK : 0);
    this.fovKick = damp(this.fovKick, targetKick, FOV_LAMBDA, dt);
    const fov = baseFov + this.fovKick;
    if (Math.abs(fov - this.lastAppliedFov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.lastAppliedFov = fov;
    }
  }
}
