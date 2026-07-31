// ============================================================================
// CORESAPIAN — src/game/ai/meshes.ts (combat-ai)
//
// Low-poly procedural enemy meshes: capsule-ish bodies + type-signature parts
// (antlers, wings, clubs, ice shards…), flat-shaded, elite accent emissive.
// Health bars are billboard sprites (visible only when damaged or a boss).
// Animation is bone-less: rigs expose named part pivots the FSM transforms.
// ============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

export interface EnemyRig {
  root: THREE.Group;
  /** Named animatable pivots: body, head, armL, armR, leg0..3, wingL, wingR, weapon, tail, jaw. */
  parts: Record<string, THREE.Object3D>;
  /** Approx standing height (m) — strike tests + health-bar placement. */
  height: number;
  /** Body radius (m) — melee fan + projectile hit tests. */
  radius: number;
  setHealthFrac(frac: number): void;
  setBarVisible(visible: boolean): void;
  setEliteGlow(on: boolean): void;
  dispose(): void;
}

const ELITE_EMISSIVE = 0xffb64a;

function mat(color: number, emissive = 0x000000, emissiveIntensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.92, metalness: 0.04, flatShading: true,
    emissive, emissiveIntensity,
  });
}

function box(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function sph(parent: THREE.Object3D, m: THREE.Material, r: number, x = 0, y = 0, z = 0, squashY = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), m);
  mesh.position.set(x, y, z);
  mesh.scale.y = squashY;
  parent.add(mesh);
  return mesh;
}

function cone(parent: THREE.Object3D, m: THREE.Material, r: number, h: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function cyl(parent: THREE.Object3D, m: THREE.Material, r: number, h: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, h, 6), m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Health bar (two sprites, left-anchored fill)
// ---------------------------------------------------------------------------

interface HealthBar {
  group: THREE.Group;
  fg: THREE.Sprite;
  bg: THREE.Sprite;
}

function makeHealthBar(width: number): HealthBar {
  const group = new THREE.Group();
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x140d0d, depthWrite: false }));
  bg.scale.set(width, 0.11, 1);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x7ee06a, depthWrite: false }));
  fg.scale.set(width * 0.96, 0.07, 1);
  group.add(bg);
  group.add(fg);
  group.visible = false;
  return { group, fg, bg };
}

// ---------------------------------------------------------------------------
// Family builders. `parts` naming: body (bob), head, armL/armR (pivot at
// shoulder), leg0..3 (pivot at hip), wingL/wingR, weapon, tail, jaw.
// ---------------------------------------------------------------------------

interface BuildResult {
  parts: Record<string, THREE.Object3D>;
  height: number;
  radius: number;
  bodyMaterials: THREE.MeshStandardMaterial[];
}

function buildHumanoid(o: {
  height: number; bulk: number; skin: number; accent: number;
  headStyle: 'skull' | 'elf' | 'helm' | 'hood' | 'horns' | 'crown';
  weapon?: 'club' | 'dagger' | 'spear' | 'staff' | 'hammer';
  wings?: boolean; glowEyes?: number; emissiveAccent?: number;
}): BuildResult {
  const parts: Record<string, THREE.Object3D> = {};
  const mats: THREE.MeshStandardMaterial[] = [];
  const skin = mat(o.skin, o.emissiveAccent ?? 0, o.emissiveAccent ? 0.5 : 0);
  const accent = mat(o.accent);
  mats.push(skin, accent);

  const h = o.height;
  const body = new THREE.Group();
  parts.body = body;

  // Torso + hips + head
  const torso = cyl(body, skin, 0.26 * o.bulk, h * 0.42, 0, h * 0.58, 0);
  torso.scale.z = 0.75;
  sph(body, accent, 0.24 * o.bulk, 0, h * 0.36, 0, 0.8); // hips
  const head = new THREE.Group();
  head.position.set(0, h * 0.86, 0);
  body.add(head);
  parts.head = head;
  sph(head, skin, 0.16 * o.bulk, 0, 0.05, 0);
  if (o.headStyle === 'skull') {
    box(head, accent, 0.1, 0.07, 0.06, 0, -0.06, 0.12); // jaw
  } else if (o.headStyle === 'elf') {
    const earL = cone(head, skin, 0.05, 0.22, -0.16 * o.bulk, 0.1, 0);
    earL.rotation.z = 1.2;
    const earR = cone(head, skin, 0.05, 0.22, 0.16 * o.bulk, 0.1, 0);
    earR.rotation.z = -1.2;
  } else if (o.headStyle === 'helm') {
    cone(head, accent, 0.18 * o.bulk, 0.24, 0, 0.14, 0);
    const hornL = cone(head, accent, 0.04, 0.3, -0.18 * o.bulk, 0.16, 0);
    hornL.rotation.z = 0.9;
    const hornR = cone(head, accent, 0.04, 0.3, 0.18 * o.bulk, 0.16, 0);
    hornR.rotation.z = -0.9;
  } else if (o.headStyle === 'hood') {
    cone(head, accent, 0.2 * o.bulk, 0.34, 0, 0.12, -0.02);
  } else if (o.headStyle === 'horns') {
    const hL = cone(head, accent, 0.045, 0.34, -0.14 * o.bulk, 0.16, 0);
    hL.rotation.z = 0.55;
    const hR = cone(head, accent, 0.045, 0.34, 0.14 * o.bulk, 0.16, 0);
    hR.rotation.z = -0.55;
  } else if (o.headStyle === 'crown') {
    cyl(head, accent, 0.17 * o.bulk, 0.08, 0, 0.18, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      cone(head, accent, 0.03, 0.12, Math.cos(a) * 0.15 * o.bulk, 0.26, Math.sin(a) * 0.15 * o.bulk);
    }
  }
  if (o.glowEyes !== undefined) {
    const eyeMat = mat(0x111111, o.glowEyes, 1.4);
    mats.push(eyeMat);
    sph(head, eyeMat, 0.028, -0.06 * o.bulk, 0.06, 0.13 * o.bulk);
    sph(head, eyeMat, 0.028, 0.06 * o.bulk, 0.06, 0.13 * o.bulk);
  }

  // Arms (pivot at shoulder)
  const armLen = h * 0.36;
  for (const side of ['L', 'R'] as const) {
    const pivot = new THREE.Group();
    pivot.position.set((side === 'L' ? -1 : 1) * 0.3 * o.bulk, h * 0.76, 0);
    body.add(pivot);
    cyl(pivot, skin, 0.07 * o.bulk, armLen, 0, -armLen / 2, 0);
    sph(pivot, accent, 0.09 * o.bulk, 0, -armLen, 0); // hand
    parts[`arm${side}`] = pivot;
  }
  if (o.weapon) {
    const weapon = new THREE.Group();
    weapon.position.set(0, -armLen, 0);
    parts.armR.add(weapon);
    parts.weapon = weapon;
    const wmat = mat(0x4c4238);
    mats.push(wmat);
    if (o.weapon === 'club') {
      cyl(weapon, wmat, 0.05, 0.7, 0, -0.3, 0);
      sph(weapon, wmat, 0.14, 0, -0.68, 0);
    } else if (o.weapon === 'dagger') {
      box(weapon, wmat, 0.03, 0.4, 0.08, 0, -0.25, 0);
    } else if (o.weapon === 'spear') {
      cyl(weapon, wmat, 0.03, 1.5, 0, -0.4, 0);
      cone(weapon, wmat, 0.06, 0.24, 0, -1.25, 0).rotation.x = Math.PI;
    } else if (o.weapon === 'staff') {
      cyl(weapon, wmat, 0.035, 1.3, 0, -0.4, 0);
      sph(weapon, mat(0x332222, 0xffaa33, 1.2), 0.09, 0, 0.28, 0);
    } else if (o.weapon === 'hammer') {
      cyl(weapon, wmat, 0.04, 1.0, 0, -0.4, 0);
      box(weapon, wmat, 0.34, 0.2, 0.2, 0, -0.9, 0);
    }
  }

  // Legs (pivot at hip)
  for (let i = 0; i < 2; i++) {
    const pivot = new THREE.Group();
    pivot.position.set((i === 0 ? -1 : 1) * 0.13 * o.bulk, h * 0.38, 0);
    body.add(pivot);
    cyl(pivot, skin, 0.09 * o.bulk, h * 0.38, 0, -h * 0.19, 0);
    parts[`leg${i}`] = pivot;
  }

  if (o.wings) {
    const wmat = mat(0xdfe8f2);
    mats.push(wmat);
    for (const side of ['L', 'R'] as const) {
      const wing = new THREE.Group();
      wing.position.set((side === 'L' ? -1 : 1) * 0.18 * o.bulk, h * 0.72, -0.14);
      body.add(wing);
      const feather = cone(wing, wmat, 0.16, h * 0.6, (side === 'L' ? -1 : 1) * 0.3, 0.1, 0);
      feather.rotation.z = (side === 'L' ? 1 : -1) * 1.35;
      feather.scale.z = 0.25;
      parts[`wing${side}`] = wing;
    }
  }

  return { parts, height: h, radius: 0.34 * o.bulk + 0.12, bodyMaterials: mats };
}

function buildWolf(o: {
  length: number; color: number; spectral?: boolean; chain?: boolean; ember?: boolean;
}): BuildResult {
  const parts: Record<string, THREE.Object3D> = {};
  const mats: THREE.MeshStandardMaterial[] = [];
  const fur = o.spectral
    ? new THREE.MeshStandardMaterial({
        color: o.color, roughness: 0.4, metalness: 0, flatShading: true,
        transparent: true, opacity: 0.72, emissive: 0x66ccff, emissiveIntensity: 0.55,
      })
    : mat(o.color, o.ember ? 0xff3300 : 0x000000, o.ember ? 0.35 : 0);
  const dark = mat(0x241f1a);
  mats.push(fur, dark);

  const L = o.length;
  const h = L * 0.52;
  const body = new THREE.Group();
  parts.body = body;
  const torso = sph(body, fur, L * 0.3, 0, h, 0, 0.82);
  torso.scale.z = 1.5;

  const head = new THREE.Group();
  head.position.set(0, h * 1.16, L * 0.48);
  body.add(head);
  parts.head = head;
  sph(head, fur, L * 0.13, 0, 0, 0);
  const jaw = box(head, fur, L * 0.11, L * 0.07, L * 0.22, 0, -L * 0.045, L * 0.14);
  parts.jaw = jaw;
  cone(head, fur, L * 0.045, L * 0.12, -L * 0.08, L * 0.13, -L * 0.02);
  cone(head, fur, L * 0.045, L * 0.12, L * 0.08, L * 0.13, -L * 0.02);
  const eyeMat = mat(0x111111, o.spectral ? 0xaaf0ff : 0xffcc44, 1.5);
  mats.push(eyeMat);
  sph(head, eyeMat, L * 0.022, -L * 0.06, L * 0.035, L * 0.11);
  sph(head, eyeMat, L * 0.022, L * 0.06, L * 0.035, L * 0.11);

  const tail = cone(body, fur, L * 0.05, L * 0.4, 0, h * 1.05, -L * 0.52);
  tail.rotation.x = -1.9;
  parts.tail = tail;

  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(
      (i % 2 === 0 ? -1 : 1) * L * 0.14,
      h * 0.92,
      (i < 2 ? 1 : -1) * L * 0.3,
    );
    body.add(pivot);
    cyl(pivot, fur, L * 0.045, h * 0.9, 0, -h * 0.45, 0);
    parts[`leg${i}`] = pivot;
  }

  if (o.chain) {
    const chainMat = mat(0x777d85, 0x3355ff, 0.4);
    mats.push(chainMat);
    const links = new THREE.Mesh(new THREE.TorusGeometry(L * 0.34, L * 0.035, 5, 14), chainMat);
    links.position.set(0, h * 1.02, 0);
    links.rotation.x = Math.PI / 2.3;
    body.add(links);
    parts.weapon = links;
  }

  return { parts, height: h * 1.45, radius: L * 0.34, bodyMaterials: mats };
}

function buildGiant(o: {
  height: number; skin: number; element: 'stone' | 'ice' | 'fire';
  weapon: 'club' | 'fists' | 'sword' | 'hammer'; crown?: boolean;
}): BuildResult {
  const parts: Record<string, THREE.Object3D> = {};
  const mats: THREE.MeshStandardMaterial[] = [];
  const emissive = o.element === 'fire' ? 0xff4a1a : o.element === 'ice' ? 0x9fdcff : 0x000000;
  const skin = mat(o.skin, emissive, o.element === 'stone' ? 0 : 0.28);
  const accent = mat(o.element === 'ice' ? 0xd8f2ff : o.element === 'fire' ? 0x2a1a14 : 0x6d7278);
  mats.push(skin, accent);

  const h = o.height;
  const body = new THREE.Group();
  parts.body = body;
  const torso = cyl(body, skin, 0.55, h * 0.45, 0, h * 0.6, 0);
  torso.scale.z = 0.8;
  sph(body, accent, 0.5, 0, h * 0.36, 0, 0.75);

  const head = new THREE.Group();
  head.position.set(0, h * 0.88, 0);
  body.add(head);
  parts.head = head;
  sph(head, skin, 0.3, 0, 0.02, 0);
  box(head, accent, 0.2, 0.1, 0.1, 0, -0.14, 0.22); // heavy jaw
  if (o.crown) {
    cyl(head, accent, 0.32, 0.14, 0, 0.3, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      cone(head, accent, 0.05, 0.22, Math.cos(a) * 0.28, 0.44, Math.sin(a) * 0.28);
    }
  }
  const eyeMat = mat(0x0a0a0a, o.element === 'fire' ? 0xffcc33 : 0xbfeaff, 1.6);
  mats.push(eyeMat);
  sph(head, eyeMat, 0.05, -0.11, 0.08, 0.24);
  sph(head, eyeMat, 0.05, 0.11, 0.08, 0.24);

  // Elemental signature: ice shards or ember cracks on the shoulders.
  if (o.element === 'ice') {
    const shardMat = mat(0xcdeeff, 0x9fdcff, 0.9);
    mats.push(shardMat);
    for (let i = 0; i < 5; i++) {
      const shard = cone(body, shardMat, 0.1, 0.55, (i - 2) * 0.24, h * 0.86, -0.18);
      shard.rotation.x = -0.4 + (i % 2) * 0.3;
    }
  } else if (o.element === 'fire') {
    const emberMat = mat(0xff5a26, 0xff7a33, 1.6);
    mats.push(emberMat);
    for (let i = 0; i < 6; i++) {
      box(body, emberMat, 0.06, 0.3, 0.06, (i - 2.5) * 0.2, h * (0.5 + (i % 3) * 0.12), 0.42);
    }
  }

  const armLen = h * 0.4;
  for (const side of ['L', 'R'] as const) {
    const pivot = new THREE.Group();
    pivot.position.set((side === 'L' ? -1 : 1) * 0.62, h * 0.78, 0);
    body.add(pivot);
    cyl(pivot, skin, 0.16, armLen, 0, -armLen / 2, 0);
    sph(pivot, accent, 0.2, 0, -armLen, 0);
    parts[`arm${side}`] = pivot;
  }
  const wmat = mat(0x3d3428);
  mats.push(wmat);
  const weapon = new THREE.Group();
  weapon.position.set(0, -armLen, 0);
  parts.armR.add(weapon);
  parts.weapon = weapon;
  if (o.weapon === 'club') {
    cyl(weapon, wmat, 0.09, 1.4, 0, -0.5, 0);
    sph(weapon, o.element === 'ice' ? accent : wmat, 0.3, 0, -1.25, 0);
  } else if (o.weapon === 'hammer') {
    cyl(weapon, wmat, 0.08, 1.8, 0, -0.7, 0);
    box(weapon, wmat, 0.66, 0.4, 0.4, 0, -1.6, 0);
  } else if (o.weapon === 'sword') {
    const blade = box(weapon, mat(0xff6a2a, 0xff8a3c, 1.2), 0.16, 2.4, 0.05, 0, -1.4, 0);
    mats.push(blade.material as THREE.MeshStandardMaterial);
    box(weapon, wmat, 0.5, 0.1, 0.12, 0, -0.2, 0);
  }

  for (let i = 0; i < 2; i++) {
    const pivot = new THREE.Group();
    pivot.position.set((i === 0 ? -1 : 1) * 0.26, h * 0.36, 0);
    body.add(pivot);
    cyl(pivot, skin, 0.19, h * 0.36, 0, -h * 0.18, 0);
    parts[`leg${i}`] = pivot;
  }

  return { parts, height: h, radius: 0.72, bodyMaterials: mats };
}

function buildStag(o: { length: number }): BuildResult {
  const parts: Record<string, THREE.Object3D> = {};
  const hide = mat(0x6b5233);
  const bone = mat(0xd9d2bd, 0x8fd48f, 0.25);
  const mats = [hide, bone];
  const L = o.length;
  const h = L * 0.62;
  const body = new THREE.Group();
  parts.body = body;
  const torso = sph(body, hide, L * 0.28, 0, h, 0, 0.85);
  torso.scale.z = 1.45;

  const neck = cyl(body, hide, L * 0.09, L * 0.42, 0, h * 1.35, L * 0.38);
  neck.rotation.x = 0.5;
  const head = new THREE.Group();
  head.position.set(0, h * 1.62, L * 0.52);
  body.add(head);
  parts.head = head;
  sph(head, hide, L * 0.11, 0, 0, 0);
  box(head, hide, L * 0.08, L * 0.06, L * 0.2, 0, -L * 0.03, L * 0.12);
  // Antlers: branching cylinders (Dáinn's signature).
  for (const side of [-1, 1]) {
    const beam = cyl(head, bone, L * 0.02, L * 0.5, side * L * 0.09, L * 0.28, 0);
    beam.rotation.z = side * 0.5;
    for (let t = 0; t < 3; t++) {
      const tine = cyl(head, bone, L * 0.014, L * (0.22 - t * 0.04), side * L * (0.14 + t * 0.1), L * (0.22 + t * 0.12), 0);
      tine.rotation.z = side * (1.1 - t * 0.15);
    }
  }
  const eyeMat = mat(0x111111, 0x9fff9f, 1.4);
  mats.push(eyeMat);
  sph(head, eyeMat, L * 0.02, -L * 0.06, L * 0.02, L * 0.09);
  sph(head, eyeMat, L * 0.02, L * 0.06, L * 0.02, L * 0.09);

  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.set((i % 2 === 0 ? -1 : 1) * L * 0.13, h * 0.95, (i < 2 ? 1 : -1) * L * 0.32);
    body.add(pivot);
    cyl(pivot, hide, L * 0.04, h * 0.95, 0, -h * 0.48, 0);
    parts[`leg${i}`] = pivot;
  }
  return { parts, height: h * 1.8, radius: L * 0.32, bodyMaterials: mats };
}

function buildEagle(o: { span: number }): BuildResult {
  const parts: Record<string, THREE.Object3D> = {};
  const feather = mat(0x4e5a66);
  const bone = mat(0xd8d4c4);
  const mats = [feather, bone];
  const s = o.span;
  const body = new THREE.Group();
  parts.body = body;
  const torso = sph(body, feather, s * 0.14, 0, s * 0.16, 0, 0.9);
  torso.scale.z = 1.4;
  const head = new THREE.Group();
  head.position.set(0, s * 0.3, s * 0.18);
  body.add(head);
  parts.head = head;
  sph(head, bone, s * 0.06, 0, 0, 0);
  const beak = cone(head, mat(0xd9a53c), s * 0.03, s * 0.1, 0, -s * 0.01, s * 0.07);
  beak.rotation.x = Math.PI / 2;
  const eyeMat = mat(0x111111, 0xffe28a, 1.6);
  mats.push(eyeMat);
  sph(head, eyeMat, s * 0.012, -s * 0.03, s * 0.02, s * 0.05);
  sph(head, eyeMat, s * 0.012, s * 0.03, s * 0.02, s * 0.05);
  for (const side of ['L', 'R'] as const) {
    const wing = new THREE.Group();
    wing.position.set((side === 'L' ? -1 : 1) * s * 0.1, s * 0.2, 0);
    body.add(wing);
    const plane = box(wing, feather, s * 0.4, s * 0.02, s * 0.16, (side === 'L' ? -1 : 1) * s * 0.2, 0, 0);
    plane.rotation.y = (side === 'L' ? -1 : 1) * 0.12;
    parts[`wing${side}`] = wing;
  }
  for (const side of [-1, 1]) {
    const talon = cone(body, bone, s * 0.025, s * 0.1, side * s * 0.06, s * 0.02, s * 0.02);
    talon.rotation.x = Math.PI;
  }
  return { parts, height: s * 0.42, radius: s * 0.2, bodyMaterials: mats };
}

function buildSerpent(o: { length: number }): BuildResult {
  const parts: Record<string, THREE.Object3D> = {};
  const scaleMat = mat(0x3d4a3a);
  const belly = mat(0x8a8f6a);
  const mats = [scaleMat, belly];
  const L = o.length;
  const body = new THREE.Group();
  parts.body = body;
  // Segmented coils trailing behind.
  for (let i = 0; i < 5; i++) {
    const r = L * (0.16 - i * 0.022);
    const seg = sph(body, i % 2 ? belly : scaleMat, r, 0, r * 0.9, -i * L * 0.22);
    parts[`seg${i}`] = seg;
  }
  const head = new THREE.Group();
  head.position.set(0, L * 0.2, L * 0.16);
  body.add(head);
  parts.head = head;
  sph(head, scaleMat, L * 0.13, 0, 0, 0);
  const jaw = box(head, belly, L * 0.14, L * 0.05, L * 0.2, 0, -L * 0.06, L * 0.08);
  parts.jaw = jaw;
  cone(head, bone_fang(), L * 0.02, L * 0.09, -L * 0.05, -L * 0.02, L * 0.16).rotation.x = Math.PI;
  cone(head, bone_fang(), L * 0.02, L * 0.09, L * 0.05, -L * 0.02, L * 0.16).rotation.x = Math.PI;
  const eyeMat = mat(0x111111, 0xaaff66, 1.5);
  mats.push(eyeMat);
  sph(head, eyeMat, L * 0.02, -L * 0.07, L * 0.05, L * 0.1);
  sph(head, eyeMat, L * 0.02, L * 0.07, L * 0.05, L * 0.1);
  return { parts, height: L * 0.42, radius: L * 0.2, bodyMaterials: mats };

  function bone_fang(): THREE.MeshStandardMaterial {
    const m = mat(0xe8e4d0);
    mats.push(m);
    return m;
  }
}

// ---------------------------------------------------------------------------
// Per-def assembly
// ---------------------------------------------------------------------------

interface SizeEntry { height: number; radius: number; barWidth: number }

function assemble(defId: string): { build: BuildResult; barWidth: number } {
  switch (defId) {
    case 'draugr':
      return { build: buildHumanoid({ height: 1.75, bulk: 0.95, skin: 0x5d6b52, accent: 0x8a8571, headStyle: 'skull', glowEyes: 0x7fff9a }), barWidth: 1.0 };
    case 'vargr':
      return { build: buildWolf({ length: 1.5, color: 0x4a453c }), barWidth: 1.0 };
    case 'troll':
      return { build: buildGiant({ height: 3.1, skin: 0x5e6a6c, element: 'stone', weapon: 'club' }), barWidth: 1.6 };
    case 'dokkalf':
      return { build: buildHumanoid({ height: 1.6, bulk: 0.8, skin: 0x3a3350, accent: 0x241f33, headStyle: 'elf', weapon: 'dagger', glowEyes: 0xbb88ff }), barWidth: 1.0 };
    case 'valkyrja':
      return { build: buildHumanoid({ height: 1.95, bulk: 0.9, skin: 0x6d7f92, accent: 0x46525f, headStyle: 'helm', weapon: 'spear', wings: true, glowEyes: 0x9fd4ff }), barWidth: 1.1 };
    case 'hrimthurs':
      return { build: buildGiant({ height: 3.6, skin: 0x8fb8cf, element: 'ice', weapon: 'club' }), barWidth: 1.8 };
    case 'eldjotunn':
      return { build: buildGiant({ height: 3.4, skin: 0x3a241c, element: 'fire', weapon: 'fists' }), barWidth: 1.8 };
    case 'summon_fylgja_wolf':
      return { build: buildWolf({ length: 1.55, color: 0x9fdcff, spectral: true }), barWidth: 1.0 };
    // --- realm bosses ---
    case 'boss_fenrir':
      return { build: buildWolf({ length: 3.4, color: 0x2e2a33, chain: true }), barWidth: 2.4 };
    case 'boss_dainn':
      return { build: buildStag({ length: 3.0 }), barWidth: 2.2 };
    case 'boss_andvari':
      return { build: buildHumanoid({ height: 1.7, bulk: 1.0, skin: 0x4a3f2a, accent: 0xd9a53c, headStyle: 'hood', weapon: 'dagger', glowEyes: 0xffd76a }), barWidth: 1.2 };
    case 'boss_thrym':
      return { build: buildGiant({ height: 4.3, skin: 0x7d94a8, element: 'ice', weapon: 'hammer', crown: true }), barWidth: 2.2 };
    case 'boss_hrimgrimnir':
      return { build: buildGiant({ height: 4.7, skin: 0xa8cede, element: 'ice', weapon: 'club', crown: true }), barWidth: 2.4 };
    case 'boss_logi':
      return { build: buildGiant({ height: 4.5, skin: 0x422016, element: 'fire', weapon: 'fists', crown: true }), barWidth: 2.4 };
    case 'boss_gullveig':
      return { build: buildHumanoid({ height: 2.2, bulk: 0.95, skin: 0x8a6a3c, accent: 0xd9a53c, headStyle: 'hood', weapon: 'staff', glowEyes: 0xffb84a }), barWidth: 1.4 };
    case 'boss_garmr':
      return { build: buildWolf({ length: 3.8, color: 0x3a2020, chain: true, ember: true }), barWidth: 2.6 };
    case 'boss_loki':
      return { build: buildHumanoid({ height: 2.05, bulk: 0.9, skin: 0x2f4a3a, accent: 0x1a2a20, headStyle: 'horns', weapon: 'dagger', glowEyes: 0x9fff9f }), barWidth: 1.4 };
    // --- world bosses ---
    case 'wboss_hraesvelgr':
      return { build: buildEagle({ span: 7 }), barWidth: 2.6 };
    case 'wboss_nidhogg':
      return { build: buildSerpent({ length: 6 }), barWidth: 2.6 };
    case 'wboss_surtr':
      return { build: buildGiant({ height: 5.4, skin: 0x2a1410, element: 'fire', weapon: 'sword', crown: true }), barWidth: 2.8 };
    default:
      return { build: buildHumanoid({ height: 1.7, bulk: 1, skin: 0x666666, accent: 0x444444, headStyle: 'skull' }), barWidth: 1.0 };
  }
}

/** Build a rigged enemy mesh. `elite` adds 1.15× scale + accent emissive. */
export function buildEnemyRig(defId: string, elite: boolean): EnemyRig {
  const { build, barWidth } = assemble(defId);
  const root = new THREE.Group();
  const body = build.parts.body;
  if (body) root.add(body);

  if (elite) {
    root.scale.setScalar(1.15);
    for (const m of build.bodyMaterials) {
      m.emissive = new THREE.Color(ELITE_EMISSIVE);
      m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.28);
    }
  }

  const bar = makeHealthBar(barWidth);
  bar.group.position.y = build.height * (elite ? 1.15 : 1) + 0.45;
  root.add(bar.group);

  const sizes: SizeEntry = { height: build.height * (elite ? 1.15 : 1), radius: build.radius * (elite ? 1.15 : 1), barWidth };

  return {
    root,
    parts: build.parts,
    height: sizes.height,
    radius: sizes.radius,
    setHealthFrac(frac: number) {
      const f = Math.max(0, Math.min(1, frac));
      const w = barWidth * 0.96;
      bar.fg.scale.set(Math.max(0.001, w * f), 0.07, 1);
      bar.fg.position.x = -w * (1 - f) / 2;
      (bar.fg.material as THREE.SpriteMaterial).color.setHSL(0.33 * f, 0.75, 0.55);
    },
    setBarVisible(visible: boolean) {
      bar.group.visible = visible;
    },
    setEliteGlow(on: boolean) {
      for (const m of build.bodyMaterials) m.emissiveIntensity = on ? Math.max(m.emissiveIntensity, 0.28) : m.emissiveIntensity;
    },
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          if (obj instanceof THREE.Mesh) obj.geometry.dispose();
          const m = obj.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      root.parent?.remove(root);
    },
  };
}
