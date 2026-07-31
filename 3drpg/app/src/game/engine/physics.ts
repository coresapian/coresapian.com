// ============================================================================
// CORESAPIAN — src/game/engine/physics.ts (ENGINE-OWNED)
// Local-player capsule vs terrain heightfield + world static colliders.
// Runs at fixed 60 Hz (gdd §3.3 stage 2). Terrain is resolved through
// `services.get('terrain')` EVERY step — never cached (addendum §2: world
// re-registers the terrain service on every realm change).
//
// Numbers: contracts where they exist (BASE_STATS.moveSpeed,
// MAX_SPEED_MPS), gdd.md §4/§5.1 otherwise (gravity 22, jump 8.2, coyote /
// buffer 120ms, sprint 7.2 @ 10 st/s, dodge 4.5m / 20 st / 300ms i-frames /
// 0.9s cd, step-up 0.55m, slope limit ~50°, stamina 18/s after 0.8s,
// wyrd 4/s after 1.2s). Feel-only accelerations are engine internals.
// ============================================================================

import { Vector3 } from 'three';

import { BASE_STATS } from '../../../contracts/types';
import type { Vec3 } from '../../../contracts/types';
import type { Collider, ServiceRegistry } from '../services';
import type { UseGameStore } from '../store';
import type { EngineInput } from './input';

// --- gdd.md §4 / deliverable-pinned movement numbers -------------------------
/** Gravity (m/s²). Exported for the prop ballistic sim (interact.ts). */
export const GRAVITY = 22;
/** Jump takeoff velocity (m/s). */
const JUMP_VELOCITY = 8.2;
/** gdd §4: coyote time 120ms. */
const COYOTE_TIME_S = 0.12;
/** gdd §4: jump input buffer 120ms. */
const JUMP_BUFFER_S = 0.12;
/** gdd §4: sprint 7.2 m/s. */
const SPRINT_SPEED = 7.2;
/** gdd §4/§5.1: sprint drains 10 stamina/s, stops at 0. */
const SPRINT_STAMINA_PER_S = 10;
/** gdd §5.1: stamina regen 18/s, starting 0.8s after last spend. */
const STAMINA_REGEN_PER_S = 18;
const STAMINA_REGEN_DELAY_S = 0.8;
/** gdd §5.1: wyrd regen 4/s, starting 1.2s after last cast. */
const WYRD_REGEN_PER_S = 4;
const WYRD_REGEN_DELAY_S = 1.2;
/** gdd §4: dodge roll — 4.5m burst, 20 stamina, 300ms i-frames, 0.9s cd. */
const DODGE_DISTANCE_M = 4.5;
const DODGE_STAMINA_COST = 20;
const DODGE_IFRAMES_S = 0.3;
const DODGE_COOLDOWN_S = 0.9;
/**
 * Burst duration: 4.5m / 0.55s ≈ 8.2 m/s — deliberately below the server
 * hard speed cap (contracts/netcode.ts MAX_SPEED_MPS = 9).
 */
const DODGE_DURATION_S = 0.55;
const DODGE_SPEED = DODGE_DISTANCE_M / DODGE_DURATION_S;
/** gdd §4: step-up height 0.55m, slope limit ~50°. */
const STEP_UP_M = 0.55;
const SLOPE_LIMIT_RAD = (50 * Math.PI) / 180;
/** Player capsule (deliverable §5): r = 0.45, h = 1.8. */
export const CAPSULE_RADIUS = 0.45;
export const CAPSULE_HEIGHT = 1.8;

// --- engine-internal feel constants (not contract-covered) -------------------
/** Horizontal velocity smoothing (exponential damp rates, grounded / air). */
const GROUND_ACCEL_LAMBDA = 14;
const AIR_ACCEL_LAMBDA = 2.5;
/** Downhill acceleration applied on slopes past the limit (m/s²). */
const SLOPE_SLIDE_ACCEL = 14;
/** Gradient sampling epsilon for slope estimation (m). */
const SLOPE_SAMPLE_EPS = 0.5;
/** Min fall speed that reports a landing (drives camera dip), m/s. */
const LAND_REPORT_SPEED = 3;
/** Snap-to-ground tolerance while walking (keeps grounded on descents). */
const GROUND_SNAP_M = 0.4;

export interface PlayerPhysicsDeps {
  store: UseGameStore;
  services: ServiceRegistry;
  input: EngineInput;
}

export class PlayerPhysics {
  private readonly store: UseGameStore;
  private readonly services: ServiceRegistry;
  private readonly input: EngineInput;

  /** Feet position of the capsule. */
  private readonly pos = new Vector3(0, 0, 0);
  private readonly vel = new Vector3(0, 0, 0);
  private grounded = false;

  private lastGroundedAt = -Infinity;
  private jumpBufferedAt = -Infinity;

  // Dodge state.
  private dodgeEndAt = -Infinity;
  private dodgeIFramesEndAt = -Infinity;
  private dodgeCooldownEndAt = -Infinity;
  private readonly dodgeDir = new Vector3(0, 0, -1);

  /** Guard break / heavy crowd control: movement locked until this time. */
  private staggeredUntil = -Infinity;

  /** Carry walk-speed multiplier set by the interact system (1 = none). */
  private carrySpeedMult = 1;

  private sprintingNow = false;
  private movingNow = false;

  // Vitals bookkeeping for regen (engine owns regen, gdd §2.2 matrix).
  private prevStamina = 0;
  private prevWyrd = 0;
  private lastStaminaSpendAt = -Infinity;
  private lastWyrdSpendAt = -Infinity;

  /** Fired on landing with impact speed (camera rig dip). */
  onLand: ((impactSpeed: number) => void) | null = null;

  constructor(deps: PlayerPhysicsDeps) {
    this.store = deps.store;
    this.services = deps.services;
    this.input = deps.input;

    const vitals = this.store.getState().vitals;
    this.prevStamina = vitals.stamina;
    this.prevWyrd = vitals.wyrd;

    this.input.onAction('jump', (phase) => {
      if (phase === 'down') this.jumpBufferedAt = this.now;
    });
    this.input.onAction('dodge', (phase) => {
      if (phase === 'down') this.tryStartDodge();
    });
  }

  /** Sim clock (seconds) stamped by the core each fixed step. */
  private now = 0;

  // ------------------------------------------------------------------ queries

  getPosition(out?: Vector3): Vector3 {
    return (out ?? new Vector3()).copy(this.pos);
  }

  getVelocity(out?: Vector3): Vector3 {
    return (out ?? new Vector3()).copy(this.vel);
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  isSprinting(): boolean {
    return this.sprintingNow;
  }

  isMoving(): boolean {
    return this.movingNow;
  }

  /** True while dodge-roll i-frames are active (gdd §4: 300ms). */
  isInIFrames(): boolean {
    return this.now < this.dodgeIFramesEndAt;
  }

  isDodging(): boolean {
    return this.now < this.dodgeEndAt;
  }

  isStaggered(): boolean {
    return this.now < this.staggeredUntil;
  }

  getHorizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Self-stagger (guard break = 1.0s per gdd §5). */
  stagger(durationS: number): void {
    this.staggeredUntil = Math.max(this.staggeredUntil, this.now + durationS);
  }

  /** Interact system applies the carry weight-class penalty here. */
  setCarrySpeedMult(mult: number): void {
    this.carrySpeedMult = mult;
  }

  teleport(pos: Vec3): void {
    this.pos.set(pos.x, pos.y, pos.z);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.lastGroundedAt = -Infinity;
    this.jumpBufferedAt = -Infinity;
    this.dodgeEndAt = -Infinity;
    this.dodgeIFramesEndAt = -Infinity;
  }

  // -------------------------------------------------------------- fixed step

  fixedUpdate(dt: number, now: number): void {
    this.now = now;
    const terrain = this.services.get('terrain'); // never cached (addendum §2)
    const sampleHeight = (x: number, z: number): number =>
      terrain ? terrain.sampleHeight(x, z) : 0;
    const colliders = terrain ? terrain.getColliders() : [];

    const staggered = this.isStaggered();

    // --- wish direction (camera-relative, gdd §4) ---
    const intent = staggered ? { x: 0, z: 0 } : this.input.getMoveIntent();
    const yaw = this.input.getYaw();
    // three.js convention: yaw 0 faces -Z.
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    let wishX = rightX * intent.x + fwdX * intent.z;
    let wishZ = rightZ * intent.x + fwdZ * intent.z;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }
    this.movingNow = wishLen > 0.01;

    // --- speed selection: walk (contracts BASE_STATS) / sprint (gdd §4) ---
    const vitals = this.store.getState().vitals;
    let speed = BASE_STATS.moveSpeed * this.carrySpeedMult;
    const wantSprint =
      !staggered && this.input.isDown('sprint') && this.movingNow && vitals.stamina > 0;
    this.sprintingNow = wantSprint;
    if (wantSprint) {
      speed = SPRINT_SPEED * this.carrySpeedMult;
      this.spendStamina(SPRINT_STAMINA_PER_S * dt, now);
    }

    // --- horizontal velocity ---
    if (this.isDodging()) {
      // Dodge burst overrides steering (fixed 4.5m burst, gdd §4).
      this.vel.x = this.dodgeDir.x * DODGE_SPEED;
      this.vel.z = this.dodgeDir.z * DODGE_SPEED;
    } else {
      const lambda = this.grounded ? GROUND_ACCEL_LAMBDA : AIR_ACCEL_LAMBDA;
      const t = 1 - Math.exp(-lambda * dt);
      this.vel.x += (wishX * speed - this.vel.x) * t;
      this.vel.z += (wishZ * speed - this.vel.z) * t;
    }

    // --- gravity ---
    this.vel.y -= GRAVITY * dt;

    // --- jump: buffer + coyote (gdd §4: both 120ms) ---
    const canJump =
      this.grounded || now - this.lastGroundedAt <= COYOTE_TIME_S;
    if (!staggered && canJump && now - this.jumpBufferedAt <= JUMP_BUFFER_S) {
      this.vel.y = JUMP_VELOCITY;
      this.grounded = false;
      this.lastGroundedAt = -Infinity; // consume coyote
      this.jumpBufferedAt = -Infinity; // consume buffer
    }

    // --- integrate horizontal with step-up / terrain-wall handling ---
    const preY = this.pos.y;
    const stepAllowance = this.grounded ? STEP_UP_M : 0;
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (sampleHeight(nx, nz) - preY <= stepAllowance) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else if (sampleHeight(nx, this.pos.z) - preY <= stepAllowance) {
      this.pos.x = nx; // slide along the wall (x-only)
      this.vel.z = 0;
    } else if (sampleHeight(this.pos.x, nz) - preY <= stepAllowance) {
      this.pos.z = nz; // slide along the wall (z-only)
      this.vel.x = 0;
    } else {
      this.vel.x = 0;
      this.vel.z = 0;
    }

    // --- integrate vertical, resolve against ground (terrain + collider tops) ---
    this.pos.y += this.vel.y * dt;
    const groundY = this.groundAt(this.pos.x, this.pos.z, sampleHeight, colliders);
    if (this.pos.y <= groundY && this.vel.y <= 0) {
      if (!this.grounded && -this.vel.y >= LAND_REPORT_SPEED) {
        this.onLand?.(-this.vel.y);
      }
      this.pos.y = groundY;
      this.vel.y = 0;
      this.grounded = true;
      this.lastGroundedAt = now;
    } else if (this.grounded && this.vel.y <= 0 && this.pos.y - groundY <= GROUND_SNAP_M) {
      // Walking down a slope: stick to the ground instead of popping airborne.
      this.pos.y = groundY;
      this.vel.y = 0;
      this.lastGroundedAt = now;
    } else {
      this.grounded = false;
    }

    // --- static collider push-out (XZ) ---
    this.resolveColliders(colliders);

    // --- slope limit ~50° (gdd §4): kill uphill motion, slide downhill ---
    this.applySlopeLimit(sampleHeight, dt);

    // --- vitals: regen pass (engine owns regen, gdd §2.2 write matrix) ---
    this.regenVitals(dt, now);
  }

  // ------------------------------------------------------------------ vitals

  private spendStamina(amount: number, now: number): void {
    const v = this.store.getState().vitals;
    if (amount <= 0 || v.stamina <= 0) return;
    this.lastStaminaSpendAt = now;
    this.store.getState().setVitals({ stamina: Math.max(0, v.stamina - amount) });
    this.prevStamina = Math.max(0, v.stamina - amount);
  }

  /**
   * Regen watches the store for spends (any writer — combat-ai attack costs,
   * engine sprint/dodge) by diffing against the previous step; a decrease
   * restarts the regen delay. gdd §5.1: stamina 18/s after 0.8s, wyrd 4/s
   * after 1.2s. ra_vanaheim (Vana Growth) adds 1.5 hp/s.
   */
  private regenVitals(dt: number, now: number): void {
    const s = this.store.getState();
    const v = s.vitals;

    if (v.stamina < this.prevStamina - 1e-4) this.lastStaminaSpendAt = now;
    if (v.wyrd < this.prevWyrd - 1e-4) this.lastWyrdSpendAt = now;

    if (s.dead) {
      this.prevStamina = v.stamina;
      this.prevWyrd = v.wyrd;
      return;
    }

    const patch: { stamina?: number; wyrd?: number; hp?: number } = {};

    if (v.stamina < v.maxStamina && now - this.lastStaminaSpendAt >= STAMINA_REGEN_DELAY_S) {
      patch.stamina = Math.min(v.maxStamina, v.stamina + STAMINA_REGEN_PER_S * dt);
    }
    if (v.wyrd < v.maxWyrd && now - this.lastWyrdSpendAt >= WYRD_REGEN_DELAY_S) {
      patch.wyrd = Math.min(v.maxWyrd, v.wyrd + WYRD_REGEN_PER_S * dt);
    }
    // Vana Growth — contracts/skills.ts REALM_ABILITIES.ra_vanaheim.
    if (v.hp > 0 && v.hp < v.maxHp && s.realmAbilities.includes('ra_vanaheim')) {
      patch.hp = Math.min(v.maxHp, v.hp + 1.5 * dt);
    }

    if (patch.stamina !== undefined || patch.wyrd !== undefined || patch.hp !== undefined) {
      s.setVitals(patch);
    }
    const after = this.store.getState().vitals;
    this.prevStamina = after.stamina;
    this.prevWyrd = after.wyrd;
  }

  // ------------------------------------------------------------------ dodge

  private tryStartDodge(): void {
    const now = this.now;
    if (now < this.dodgeCooldownEndAt || this.isStaggered()) return;
    const v = this.store.getState().vitals;
    if (v.stamina < DODGE_STAMINA_COST) return;

    this.spendStamina(DODGE_STAMINA_COST, now);

    // Burst along current move intent, else along facing.
    const intent = this.input.getMoveIntent();
    const yaw = this.input.getYaw();
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    if (intent.x !== 0 || intent.z !== 0) {
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      this.dodgeDir
        .set(rightX * intent.x + fwdX * intent.z, 0, rightZ * intent.x + fwdZ * intent.z)
        .normalize();
    } else {
      this.dodgeDir.set(fwdX, 0, fwdZ);
    }

    this.dodgeEndAt = now + DODGE_DURATION_S;
    this.dodgeIFramesEndAt = now + DODGE_IFRAMES_S;
    this.dodgeCooldownEndAt = now + DODGE_COOLDOWN_S;
  }

  // ------------------------------------------------------------------ ground

  /**
   * Ground height at (x, z): terrain heightfield plus the tops of any
   * colliders the capsule can stand on (within step-up reach).
   */
  private groundAt(
    x: number,
    z: number,
    sampleHeight: (x: number, z: number) => number,
    colliders: Collider[],
  ): number {
    let ground = sampleHeight(x, z);
    for (const c of colliders) {
      if (c.kind === 'cylinder') {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d <= c.r + CAPSULE_RADIUS * 0.25 && this.pos.y >= c.y1 - STEP_UP_M) {
          ground = Math.max(ground, c.y1);
        }
      } else if (c.kind === 'sphere') {
        const d = Math.hypot(x - c.x, z - c.z);
        const top = c.y + c.r;
        if (d <= c.r + CAPSULE_RADIUS * 0.25 && this.pos.y >= top - STEP_UP_M) {
          ground = Math.max(ground, top);
        }
      } else {
        const top = c.max.y;
        const inside =
          x >= c.min.x - CAPSULE_RADIUS * 0.25 &&
          x <= c.max.x + CAPSULE_RADIUS * 0.25 &&
          z >= c.min.z - CAPSULE_RADIUS * 0.25 &&
          z <= c.max.z + CAPSULE_RADIUS * 0.25;
        if (inside && this.pos.y >= top - STEP_UP_M) {
          ground = Math.max(ground, top);
        }
      }
    }
    return ground;
  }

  /** Push the capsule out of collider volumes horizontally. */
  private resolveColliders(colliders: Collider[]): void {
    const feet = this.pos.y;
    const head = this.pos.y + CAPSULE_HEIGHT;
    for (const c of colliders) {
      if (c.kind === 'cylinder') {
        this.pushOutCircle(c.x, c.z, c.r, c.y0, c.y1, feet, head);
      } else if (c.kind === 'sphere') {
        this.pushOutCircle(c.x, c.z, c.r, c.y - c.r, c.y + c.r, feet, head);
      } else {
        // AABB: skip if we can step onto it or we stand above it.
        if (c.max.y - feet <= STEP_UP_M || feet >= c.max.y - 0.02) continue;
        if (head <= c.min.y || feet >= c.max.y) continue;
        const cx = Math.max(c.min.x, Math.min(this.pos.x, c.max.x));
        const cz = Math.max(c.min.z, Math.min(this.pos.z, c.max.z));
        const dx = this.pos.x - cx;
        const dz = this.pos.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= CAPSULE_RADIUS) continue;
        if (d > 1e-5) {
          const push = (CAPSULE_RADIUS - d) / d;
          this.pos.x += dx * push;
          this.pos.z += dz * push;
        } else {
          // Center inside the box: exit along the smallest penetration axis.
          const exLeft = this.pos.x - c.min.x + CAPSULE_RADIUS;
          const exRight = c.max.x - this.pos.x + CAPSULE_RADIUS;
          const ezNear = this.pos.z - c.min.z + CAPSULE_RADIUS;
          const ezFar = c.max.z - this.pos.z + CAPSULE_RADIUS;
          const min = Math.min(exLeft, exRight, ezNear, ezFar);
          if (min === exLeft) this.pos.x = c.min.x - CAPSULE_RADIUS;
          else if (min === exRight) this.pos.x = c.max.x + CAPSULE_RADIUS;
          else if (min === ezNear) this.pos.z = c.min.z - CAPSULE_RADIUS;
          else this.pos.z = c.max.z + CAPSULE_RADIUS;
        }
      }
    }
  }

  private pushOutCircle(
    cx: number,
    cz: number,
    r: number,
    y0: number,
    y1: number,
    feet: number,
    head: number,
  ): void {
    // Step-up onto the top instead of colliding (gdd §4: 0.55m).
    if (y1 - feet <= STEP_UP_M || feet >= y1 - 0.02) return;
    if (head <= y0 || feet >= y1) return;
    const dx = this.pos.x - cx;
    const dz = this.pos.z - cz;
    const d = Math.hypot(dx, dz);
    const minDist = r + CAPSULE_RADIUS;
    if (d >= minDist) return;
    if (d > 1e-5) {
      const push = (minDist - d) / d;
      this.pos.x += dx * push;
      this.pos.z += dz * push;
    } else {
      this.pos.x += minDist; // degenerate: dead center — pick an axis
    }
  }

  /** Slopes steeper than the limit are unwalkable: slide off them. */
  private applySlopeLimit(
    sampleHeight: (x: number, z: number) => number,
    dt: number,
  ): void {
    if (!this.grounded) return;
    const e = SLOPE_SAMPLE_EPS;
    const gx = (sampleHeight(this.pos.x + e, this.pos.z) - sampleHeight(this.pos.x - e, this.pos.z)) / (2 * e);
    const gz = (sampleHeight(this.pos.x, this.pos.z + e) - sampleHeight(this.pos.x, this.pos.z - e)) / (2 * e);
    const grad = Math.hypot(gx, gz);
    const angle = Math.atan(grad);
    if (angle <= SLOPE_LIMIT_RAD || grad < 1e-4) return;

    const ux = gx / grad; // uphill direction
    const uz = gz / grad;
    const uphillSpeed = this.vel.x * ux + this.vel.z * uz;
    if (uphillSpeed > 0) {
      this.vel.x -= ux * uphillSpeed;
      this.vel.z -= uz * uphillSpeed;
    }
    this.vel.x -= ux * SLOPE_SLIDE_ACCEL * dt;
    this.vel.z -= uz * SLOPE_SLIDE_ACCEL * dt;
  }
}
