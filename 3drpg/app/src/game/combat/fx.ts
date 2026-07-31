// ============================================================================
// CORESAPIAN — src/game/combat/fx.ts (combat-ai)
//
// Pooled combat FX: impact bursts, block sparks, parry rings, heal wisps,
// ground-decal telegraphs, ground fields, and projectile meshes with trails.
// Hard cap of 128 live effect objects (gdd perf budget); oldest recycle.
// Simulation never lives here — subsystems drive positions; this pool renders.
// ============================================================================

import * as THREE from 'three';

const MAX_LIVE = 128;

const POOL_PARTICLES = 72;
const POOL_RINGS = 8;
const POOL_DECALS = 16;
const POOL_FIELDS = 8;
const POOL_PROJECTILES = 24;

// ---------------------------------------------------------------------------
// Handles handed to sim code
// ---------------------------------------------------------------------------

export interface FxHandle {
  readonly obj: THREE.Object3D;
  /** True once the effect has finished and returned to the pool. */
  isDone(): boolean;
  /** End the effect immediately (returns it to the pool). */
  release(): void;
}

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  baseScale: number;
  active: boolean;
  seq: number;
}

interface TimedFx {
  obj: THREE.Object3D;
  mats: THREE.MeshBasicMaterial[];
  life: number;
  maxLife: number;
  active: boolean;
  seq: number;
  mode: 'ring' | 'decal' | 'field';
  radius: number;
}

interface ProjectileFx {
  obj: THREE.Object3D;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  trail: THREE.Line;
  trailGeom: THREE.BufferGeometry;
  trailPositions: Float32Array;
  active: boolean;
  seq: number;
}

const TRAIL_POINTS = 7;

export class FxPool {
  private readonly root: THREE.Group;
  private readonly particles: Particle[] = [];
  private readonly timed: TimedFx[] = [];
  private readonly projectiles: ProjectileFx[] = [];
  private seqCounter = 0;

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();
    this.root.name = 'combat-fx';
    scene.add(this.root);

    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < POOL_PARTICLES; i++) {
      const mat = this.makeMat(0xffffff);
      const mesh = new THREE.Mesh(plane, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.particles.push({
        mesh, mat, vel: new THREE.Vector3(), life: 0, maxLife: 1, gravity: 0,
        baseScale: 1, active: false, seq: 0,
      });
    }

    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    const decalGeo = new THREE.RingGeometry(0.9, 1, 40);
    const fillGeo = new THREE.CircleGeometry(1, 32);
    for (let i = 0; i < POOL_DECALS + POOL_RINGS + POOL_FIELDS; i++) {
      const mode: TimedFx['mode'] = i < POOL_RINGS ? 'ring' : i < POOL_RINGS + POOL_DECALS ? 'decal' : 'field';
      const geo = mode === 'ring' ? ringGeo : mode === 'decal' ? decalGeo : fillGeo;
      const mats = [this.makeMat(0xffffff)];
      const obj: THREE.Object3D = new THREE.Mesh(geo, mats[0]);
      if (mode === 'decal') {
        // Telegraphs get an inner fill disc that sweeps up as the windup runs.
        const fill = new THREE.Mesh(fillGeo, this.makeMat(0xffffff));
        fill.position.z = 0.02;
        obj.add(fill);
        mats.push(fill.material as THREE.MeshBasicMaterial);
      }
      obj.visible = false;
      this.root.add(obj);
      this.timed.push({ obj, mats, life: 0, maxLife: 1, active: false, seq: 0, mode, radius: 1 });
    }

    const projGeo = new THREE.OctahedronGeometry(0.09, 0);
    for (let i = 0; i < POOL_PROJECTILES; i++) {
      const mat = this.makeMat(0xffffff);
      const mesh = new THREE.Mesh(projGeo, mat);
      const obj = new THREE.Group();
      obj.add(mesh);
      const trailGeom = new THREE.BufferGeometry();
      const positions = new Float32Array(TRAIL_POINTS * 3);
      trailGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const trail = new THREE.Line(
        trailGeom,
        new THREE.LineBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      trail.frustumCulled = false;
      // Trail vertices are world-space; the line hangs off the pool root so it
      // stays behind in the world instead of dragging with the projectile.
      trail.visible = false;
      this.root.add(trail);
      obj.visible = false;
      this.root.add(obj);
      this.projectiles.push({ obj, mesh, mat, trail, trailGeom, trailPositions: positions, active: false, seq: 0 });
    }
  }

  private makeMat(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  private liveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.active) n++;
    for (const t of this.timed) if (t.active) n++;
    for (const p of this.projectiles) if (p.active) n++;
    return n;
  }

  // ---------------------------------------------------------------- spawns

  /** Small radial burst of billboard sparks. */
  spawnImpact(pos: THREE.Vector3, color: number, count = 7, speed = 3.2): void {
    for (let i = 0; i < count; i++) {
      const p = this.grabParticle();
      if (!p) return;
      p.mat.color.setHex(color);
      p.mesh.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.25;
      p.vel.set(Math.cos(a), up, Math.sin(a)).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      p.gravity = 6;
      p.maxLife = 0.28 + Math.random() * 0.18;
      p.life = p.maxLife;
      p.baseScale = 0.05 + Math.random() * 0.07;
      p.active = true;
      p.seq = ++this.seqCounter;
      p.mesh.visible = true;
    }
  }

  /** Shield-block spark: tight white-yellow burst. */
  spawnBlockSpark(pos: THREE.Vector3): void {
    this.spawnImpact(pos, 0xffe9a8, 5, 2.4);
  }

  /** Parry flash: bright expanding horizontal ring at the defender. */
  spawnParryRing(pos: THREE.Vector3): FxHandle {
    const t = this.grabTimed('ring');
    const h = this.handleFor(t);
    if (!t) return h;
    t.obj.position.copy(pos);
    t.obj.position.y += 1.1;
    t.obj.rotation.set(0, 0, 0);
    t.mats[0].color.setHex(0xbfe8ff);
    t.radius = 2.2;
    t.maxLife = 0.42;
    t.life = t.maxLife;
    return h;
  }

  /** Spirit-green wisps rising off the healed target. */
  spawnHealWisps(pos: THREE.Vector3): void {
    for (let i = 0; i < 5; i++) {
      const p = this.grabParticle();
      if (!p) return;
      p.mat.color.setHex(0x9dffc8);
      p.mesh.position.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + Math.random() * 0.8, pos.z + (Math.random() - 0.5) * 0.6);
      p.vel.set((Math.random() - 0.5) * 0.4, 1.1 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4);
      p.gravity = -0.6; // wisps buoy upward
      p.maxLife = 0.9 + Math.random() * 0.4;
      p.life = p.maxLife;
      p.baseScale = 0.09 + Math.random() * 0.06;
      p.active = true;
      p.seq = ++this.seqCounter;
      p.mesh.visible = true;
    }
  }

  /**
   * Ground-decal telegraph ring (enemy windup). Flat on the ground at `pos`;
   * inner fill sweeps outward over `durationSec`, then the decal expires.
   */
  telegraph(pos: THREE.Vector3, radius: number, durationSec: number, color = 0xff5a3c): FxHandle {
    const t = this.grabTimed('decal');
    const h = this.handleFor(t);
    if (!t) return h;
    t.obj.position.set(pos.x, pos.y + 0.06, pos.z);
    t.obj.rotation.set(-Math.PI / 2, 0, 0);
    t.mats[0].color.setHex(color);
    t.mats[1].color.setHex(color);
    t.radius = radius;
    t.maxLife = Math.max(0.05, durationSec);
    t.life = t.maxLife;
    return h;
  }

  /** Persistent translucent ground field (Niflgrip, fire trails, hazards). */
  groundField(pos: THREE.Vector3, radius: number, durationSec: number, color: number): FxHandle {
    const t = this.grabTimed('field');
    const h = this.handleFor(t);
    if (!t) return h;
    t.obj.position.set(pos.x, pos.y + 0.05, pos.z);
    t.obj.rotation.set(-Math.PI / 2, 0, 0);
    t.mats[0].color.setHex(color);
    t.radius = radius;
    t.maxLife = Math.max(0.05, durationSec);
    t.life = t.maxLife;
    return h;
  }

  /** Acquire a pooled projectile visual; sim code positions `handle.obj`. */
  acquireProjectile(color: number, scale = 1): FxHandle {
    let oldest: ProjectileFx | null = null;
    for (const p of this.projectiles) {
      if (!p.active) { oldest = p; break; }
      if (!oldest || p.seq < oldest.seq) oldest = p;
    }
    if (!oldest) return this.nullHandle();
    const p = oldest;
    p.active = true;
    p.seq = ++this.seqCounter;
    p.mat.color.setHex(color);
    (p.trail.material as THREE.LineBasicMaterial).color.setHex(color);
    p.mesh.scale.setScalar(scale);
    p.obj.visible = true;
    p.trail.visible = true;
    const start = p.obj.position;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      p.trailPositions[i * 3] = start.x;
      p.trailPositions[i * 3 + 1] = start.y;
      p.trailPositions[i * 3 + 2] = start.z;
    }
    p.trailGeom.attributes.position.needsUpdate = true;
    return {
      obj: p.obj,
      isDone: () => !p.active,
      release: () => this.releaseProjectile(p),
    };
  }

  // ------------------------------------------------------------- internals

  private grabParticle(): Particle | null {
    if (this.liveCount() >= MAX_LIVE) {
      let oldest: Particle | null = null;
      for (const p of this.particles) if (p.active && (!oldest || p.seq < oldest.seq)) oldest = p;
      if (oldest) { oldest.active = false; oldest.mesh.visible = false; return oldest; }
    }
    for (const p of this.particles) if (!p.active) return p;
    return null;
  }

  private grabTimed(mode: TimedFx['mode']): TimedFx | null {
    let oldest: TimedFx | null = null;
    for (const t of this.timed) {
      if (t.mode !== mode) continue;
      if (!t.active) { oldest = t; break; }
      if (!oldest || t.seq < oldest.seq) oldest = t;
    }
    if (oldest) {
      oldest.active = true;
      oldest.seq = ++this.seqCounter;
      oldest.obj.visible = true;
      oldest.obj.scale.setScalar(1);
    }
    return oldest;
  }

  private handleFor(t: TimedFx | null): FxHandle {
    if (!t) return this.nullHandle();
    return {
      obj: t.obj,
      isDone: () => !t.active,
      release: () => this.releaseTimed(t),
    };
  }

  private nullHandle(): FxHandle {
    const obj = new THREE.Object3D();
    return { obj, isDone: () => true, release: () => undefined };
  }

  private releaseTimed(t: TimedFx): void {
    t.active = false;
    t.obj.visible = false;
  }

  private releaseProjectile(p: ProjectileFx): void {
    p.active = false;
    p.obj.visible = false;
    p.trail.visible = false;
  }

  // --------------------------------------------------------------- update

  update(dt: number, camera: THREE.Camera): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; p.mesh.visible = false; continue; }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      p.mat.opacity = t;
      p.mesh.scale.setScalar(p.baseScale * (0.5 + t * 0.5));
      p.mesh.quaternion.copy(camera.quaternion); // billboard
    }

    for (const t of this.timed) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { this.releaseTimed(t); continue; }
      const progress = 1 - t.life / t.maxLife;
      if (t.mode === 'ring') {
        const s = 0.2 + progress * t.radius;
        t.obj.scale.setScalar(s);
        t.mats[0].opacity = 0.9 * (1 - progress);
      } else if (t.mode === 'decal') {
        t.obj.scale.setScalar(t.radius);
        t.mats[0].opacity = 0.55 + 0.35 * Math.sin(progress * Math.PI * 6);
        const fill = t.obj.children[0];
        if (fill) {
          fill.scale.setScalar(Math.max(0.001, progress));
          t.mats[1].opacity = 0.28;
        }
      } else {
        t.obj.scale.setScalar(t.radius);
        t.mats[0].opacity = 0.22 * Math.min(1, (t.life / t.maxLife) * 4);
      }
    }

    for (const p of this.projectiles) {
      if (!p.active) continue;
      // Shift the world-space trail back one slot; head = current position.
      const arr = p.trailPositions;
      for (let i = TRAIL_POINTS - 1; i > 0; i--) {
        arr[i * 3] = arr[(i - 1) * 3];
        arr[i * 3 + 1] = arr[(i - 1) * 3 + 1];
        arr[i * 3 + 2] = arr[(i - 1) * 3 + 2];
      }
      arr[0] = p.obj.position.x;
      arr[1] = p.obj.position.y;
      arr[2] = p.obj.position.z;
      p.trailGeom.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const m = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.particles.length = 0;
    this.timed.length = 0;
    this.projectiles.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Module singleton — created by the combat subsystem at init; the ai
// subsystem (which inits earlier) resolves it lazily inside fixedUpdate.
// ===========================================================================

let pool: FxPool | null = null;

export function initFxPool(scene: THREE.Scene): FxPool {
  pool?.dispose();
  pool = new FxPool(scene);
  return pool;
}

export function getFxPool(): FxPool | null {
  return pool;
}

export function shutdownFxPool(): void {
  pool?.dispose();
  pool = null;
}
