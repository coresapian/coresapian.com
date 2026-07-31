// ============================================================================
// CORESAPIAN — src/game/combat/viewmodel.ts (combat-ai)
//
// First-person weapon/shield/bow/rune-focus meshes attached to the player's
// viewmodel root (engine camera rig). All geometry is low-poly procedural,
// built from the equipped item defs in the store; animations are procedural
// (swing, block, draw, cast glow, swap-arms) driven from the combat state.
// ============================================================================

import * as THREE from 'three';

import type { BowDef, ShieldDef, WeaponDef } from '../../../contracts/items';
import type { DamageSchool } from '../../../contracts/types';

export type ArmsMode = 'melee' | 'bow';

const SCHOOL_COLORS: Record<DamageSchool, number> = {
  physical: 0xd8cfa8,
  fire: 0xff7a33,
  ice: 0x9fdcff,
  storm: 0xbfe8ff,
  spirit: 0x9dffc8,
};

function std(color: number, emissive = 0x000000, emissiveIntensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.35, flatShading: true, emissive, emissiveIntensity,
  });
}

// ---------------------------------------------------------------------------
// Mesh builders (camera-space: -Z is forward, +X right, +Y up)
// ---------------------------------------------------------------------------

function buildWeaponMesh(def: WeaponDef): THREE.Group {
  const g = new THREE.Group();
  const steel = std(0xb9c2cc, def.tier >= 4 ? 0xffb64a : 0x000000, def.tier >= 4 ? 0.12 : 0);
  const grip = std(0x4c3a28);
  const guard = std(0x6b5a3a);

  if (def.weaponClass === 'sword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.62, 0.01), steel);
    blade.position.y = 0.42;
    g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.09, 4), steel);
    tip.position.y = 0.77;
    g.add(tip);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.03), guard);
    cross.position.y = 0.1;
    g.add(cross);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.14, 6), grip);
    g.add(handle);
  } else if (def.weaponClass === 'axe') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.6, 6), grip);
    haft.position.y = 0.22;
    g.add(haft);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.02), steel);
    head.position.set(0.06, 0.48, 0);
    g.add(head);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), steel);
    beard.rotation.z = Math.PI;
    beard.position.set(0.085, 0.36, 0);
    g.add(beard);
  } else {
    // hammer
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 6), grip);
    haft.position.y = 0.24;
    g.add(haft);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.11), steel);
    head.position.y = 0.56;
    g.add(head);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.13), guard);
    cap.position.y = 0.56;
    g.add(cap);
  }
  return g;
}

function buildShieldMesh(def: ShieldDef): THREE.Group {
  const g = new THREE.Group();
  const wood = std(def.tier >= 3 ? 0x5a4632 : 0x7a6248);
  const iron = std(0x8a929c);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 14), wood);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 6, 20), iron);
  g.add(rim);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), iron);
  boss.position.z = 0.02;
  g.add(boss);
  if (def.tier >= 3) {
    const rune = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.045, 0),
      std(0x334455, 0x9fdcff, 0.9),
    );
    rune.position.z = 0.05;
    g.add(rune);
  }
  return g;
}

function buildBowMesh(def: BowDef): { group: THREE.Group; stringMesh: THREE.Mesh; arrowMesh: THREE.Group } {
  const g = new THREE.Group();
  const wood = std(def.tier >= 4 ? 0x3f5a3a : 0x6b4f30, def.tier >= 4 ? 0x9dffc8 : 0x000000, def.tier >= 4 ? 0.15 : 0);
  // Limbs: two curved boxes approximating the arc.
  for (const side of [-1, 1]) {
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.42, 5), wood);
    limb.position.y = side * 0.26;
    limb.rotation.z = side * 0.28;
    g.add(limb);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), std(0x3a2c1c));
  g.add(grip);
  // Bowstring (pulled back with draw).
  const stringMesh = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.62, 0.003), std(0xd8d2c0));
  stringMesh.position.z = 0.05;
  g.add(stringMesh);
  // Nocked arrow.
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5, 5), std(0x9a8058));
  shaft.rotation.x = Math.PI / 2;
  arrow.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 5), std(0xb9c2cc));
  head.rotation.x = -Math.PI / 2;
  head.position.z = -0.27;
  arrow.add(head);
  arrow.visible = false;
  g.add(arrow);
  return { group: g, stringMesh, arrowMesh: arrow };
}

function buildFocusMesh(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), std(0x6b5a3a));
  g.add(ring);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), std(0x223344, 0x9fdcff, 1.2));
  gem.name = 'gem';
  g.add(gem);
  return g;
}

// ---------------------------------------------------------------------------
// Viewmodel
// ---------------------------------------------------------------------------

const SWAP_SEC = 0.32;
const LIGHT_SWING_SEC = 0.26;
const HEAVY_SWING_SEC = 0.44;
const CAST_FLASH_SEC = 0.45;

interface SwingState {
  kind: 'light' | 'heavy';
  t: number;
  dur: number;
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private readonly right = new THREE.Group(); // weapon / bow
  private readonly left = new THREE.Group(); // shield / rune focus
  private weaponMesh: THREE.Group | null = null;
  private shieldMesh: THREE.Group | null = null;
  private bowMesh: THREE.Group | null = null;
  private bowString: THREE.Mesh | null = null;
  private bowArrow: THREE.Group | null = null;
  private focusMesh: THREE.Group | null = null;

  private mode: ArmsMode = 'melee';
  private swing: SwingState | null = null;
  private blocking = false;
  private blockBlend = 0;
  private drawCharge: number | null = null;
  private castFlash = 0;
  private castColor = 0x9fdcff;
  private swapT = SWAP_SEC; // completed by default
  private pendingMode: ArmsMode | null = null;
  private time = 0;

  constructor() {
    this.root.name = 'viewmodel';
    this.right.position.set(0.3, -0.28, -0.55);
    this.left.position.set(-0.32, -0.3, -0.55);
    this.root.add(this.right);
    this.root.add(this.left);
    this.focusMesh = buildFocusMesh();
    this.focusMesh.visible = false;
    this.left.add(this.focusMesh);
  }

  attach(parent: THREE.Object3D): void {
    parent.add(this.root);
  }

  /** Rebuild meshes from current equipment (called on store change). */
  setLoadout(weapon: WeaponDef | null, shield: ShieldDef | null, bow: BowDef | null): void {
    this.clearChildren(this.right);
    this.clearChildren(this.left);
    this.weaponMesh = null;
    this.shieldMesh = null;
    this.bowMesh = null;
    this.bowString = null;
    this.bowArrow = null;

    if (weapon) {
      this.weaponMesh = buildWeaponMesh(weapon);
      this.weaponMesh.rotation.x = -0.35;
      this.right.add(this.weaponMesh);
    }
    if (bow) {
      const b = buildBowMesh(bow);
      this.bowMesh = b.group;
      this.bowString = b.stringMesh;
      this.bowArrow = b.arrowMesh;
      this.bowMesh.rotation.y = -0.25;
      this.bowMesh.visible = this.mode === 'bow';
      this.right.add(this.bowMesh);
    }
    if (shield) {
      this.shieldMesh = buildShieldMesh(shield);
      this.left.add(this.shieldMesh);
    }
    if (this.focusMesh) {
      this.focusMesh.visible = false;
      this.left.add(this.focusMesh);
    }
    this.applyModeVisibility();
  }

  private clearChildren(group: THREE.Group): void {
    for (const child of [...group.children]) {
      if (child === this.focusMesh) continue; // persistent rune focus survives rebuilds
      group.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    }
  }

  private applyModeVisibility(): void {
    if (this.weaponMesh) this.weaponMesh.visible = this.mode === 'melee';
    if (this.shieldMesh) this.shieldMesh.visible = this.mode === 'melee';
    if (this.bowMesh) this.bowMesh.visible = this.mode === 'bow';
  }

  setArmsMode(mode: ArmsMode): void {
    if (mode === this.mode || this.pendingMode === mode) return;
    this.pendingMode = mode;
    this.swapT = 0;
  }

  getArmsMode(): ArmsMode {
    return this.mode;
  }

  triggerSwing(kind: 'light' | 'heavy'): void {
    this.swing = { kind, t: 0, dur: kind === 'light' ? LIGHT_SWING_SEC : HEAVY_SWING_SEC };
  }

  setBlocking(blocking: boolean): void {
    this.blocking = blocking;
  }

  /** charge 0..1 while drawing; null when the bow is not drawn. */
  setDraw(charge: number | null): void {
    this.drawCharge = charge;
    if (this.bowArrow) this.bowArrow.visible = charge !== null;
  }

  triggerCast(school: DamageSchool): void {
    this.castFlash = CAST_FLASH_SEC;
    this.castColor = SCHOOL_COLORS[school];
  }

  /** Hitstop: briefly freeze the swing animation (60ms per gdd §5.2 feel). */
  private hitstopT = 0;

  triggerHitstop(): void {
    this.hitstopT = 0.06;
  }

  update(dt: number, opts: { moving: boolean }): void {
    this.time += dt;
    const t = this.time;

    // --- swap arms ---
    if (this.pendingMode) {
      this.swapT += dt;
      const half = SWAP_SEC / 2;
      if (this.swapT >= half && this.mode !== this.pendingMode) {
        this.mode = this.pendingMode;
        this.applyModeVisibility();
      }
      if (this.swapT >= SWAP_SEC) {
        this.pendingMode = null;
        this.swapT = SWAP_SEC;
      }
    }
    const swapDip = this.pendingMode ? Math.sin(Math.min(1, this.swapT / SWAP_SEC) * Math.PI) * 0.25 : 0;

    // --- swing ---
    let swingRx = 0;
    let swingRz = 0;
    let swingPy = 0;
    if (this.swing) {
      if (this.hitstopT > 0) {
        this.hitstopT -= dt; // freeze pose during hitstop
      } else {
        this.swing.t += dt;
      }
      const k = Math.min(1, this.swing.t / this.swing.dur);
      if (this.swing.kind === 'light') {
        // Horizontal slash: sweep right→left across the body.
        swingRz = THREE.MathUtils.lerp(-0.9, 0.85, easeOut(k));
        swingRx = -0.25 + Math.sin(k * Math.PI) * 0.15;
      } else {
        // Heavy: raise overhead then slam down.
        swingRx = k < 0.45
          ? THREE.MathUtils.lerp(-0.35, -1.5, easeOut(k / 0.45))
          : THREE.MathUtils.lerp(-1.5, 0.55, easeOut((k - 0.45) / 0.55));
        swingPy = k < 0.45 ? 0.05 : -0.06;
      }
      if (k >= 1) this.swing = null;
    }

    // --- idle sway / walk bob ---
    const bobAmp = opts.moving ? 0.014 : 0.006;
    const bobY = Math.sin(t * (opts.moving ? 9 : 1.8)) * bobAmp;
    const bobX = Math.cos(t * (opts.moving ? 4.5 : 1.2)) * bobAmp * 0.6;

    // --- right hand (weapon/bow) ---
    const drawing = this.drawCharge !== null;
    const rightBase = this.mode === 'bow'
      ? new THREE.Vector3(drawing ? 0.16 : 0.24, drawing ? -0.24 : -0.28, -0.5)
      : new THREE.Vector3(0.3, -0.28, -0.55);
    this.right.position.set(
      rightBase.x + bobX,
      rightBase.y + bobY + swingPy - swapDip,
      rightBase.z,
    );
    this.right.rotation.set(swingRx, this.mode === 'bow' ? 0.1 : 0, swingRz);
    if (this.weaponMesh) this.weaponMesh.rotation.x = -0.35 + swingRx * 0.4;
    if (this.bowMesh && this.mode === 'bow') {
      const c = this.drawCharge ?? 0;
      this.bowMesh.rotation.y = -0.25 + c * 0.2;
      if (this.bowString) this.bowString.position.z = 0.05 + c * 0.16;
      if (this.bowArrow) this.bowArrow.position.z = c * 0.16;
    }

    // --- left hand (shield / focus) ---
    this.blockBlend += ((this.blocking ? 1 : 0) - this.blockBlend) * Math.min(1, dt * 12);
    const leftRest = new THREE.Vector3(-0.32, -0.3, -0.55);
    const leftBlock = new THREE.Vector3(-0.06, -0.24, -0.42);
    this.left.position.lerpVectors(leftRest, leftBlock, this.blockBlend);
    this.left.position.y += bobY * 0.7 - swapDip;
    this.left.rotation.set(0, this.blockBlend * 0.35, this.blockBlend * 0.15);

    // --- cast flash ---
    if (this.castFlash > 0) {
      this.castFlash -= dt;
      if (this.focusMesh) {
        this.focusMesh.visible = true;
        const k = Math.max(0, this.castFlash / CAST_FLASH_SEC);
        this.focusMesh.scale.setScalar(1 + (1 - k) * 1.6);
        const gem = this.focusMesh.getObjectByName('gem') as THREE.Mesh | null;
        if (gem) {
          (gem.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(this.castColor);
          (gem.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + k * 1.8;
        }
      }
    } else if (this.focusMesh) {
      this.focusMesh.visible = false;
    }
  }

  dispose(): void {
    this.clearChildren(this.right);
    this.clearChildren(this.left);
    if (this.focusMesh) {
      this.left.remove(this.focusMesh);
      this.focusMesh = null;
    }
    this.root.parent?.remove(this.root);
  }
}

function easeOut(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
