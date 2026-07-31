// ============================================================================
// CORESAPIAN — src/game/world/props.ts
// Instanced low-poly props driven by each realm's PropSets (trees/rocks/
// crystals kinds in contracts/realms.ts). One merged BufferGeometry per prop
// archetype, one InstancedMesh per placed kind, vertex-colored parts so a
// single standard material covers every opaque prop; glowing archetypes share
// per-color emissive materials. Also: rune monoliths + Midgard longhouses.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { mulberry32 } from '../config';

import type { RealmBuildCtx, RealmModule } from './types';

// ---------------------------------------------------------------------------
// Placement tuning
// ---------------------------------------------------------------------------

/** Playable area cells of 100x100m (densityPer100m unit from contracts). */
const AREA_CELLS = (220 * 220) / 10000;
const PLACEMENT_MAX_R = 148;
const MIN_HEIGHT = 0.7; // stay off the shore/sea
const MONOLITH_MAX = 3;

// ---------------------------------------------------------------------------
// Geometry part merging (vertex-colored)
// ---------------------------------------------------------------------------

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  matrix?: THREE.Matrix4;
}

function trs(
  x: number,
  y: number,
  z: number,
  o: { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number } = {},
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    q,
    new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
  );
}

/** Merge parts into one geometry with a per-vertex `color` attribute. */
function buildMerged(parts: Part[]): THREE.BufferGeometry {
  const prepped: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (p.matrix) g.applyMatrix4(p.matrix);
    const count = (g.attributes.position as THREE.BufferAttribute).count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = p.color.r;
      colors[i * 3 + 1] = p.color.g;
      colors[i * 3 + 2] = p.color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    prepped.push(g);
  }
  const merged = mergeGeometries(prepped, false);
  for (const g of prepped) g.dispose();
  if (!merged) throw new Error('[world/props] geometry merge failed');
  return merged;
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);

// ---------------------------------------------------------------------------
// Archetype factories (all origin at ground level, +Y up)
// ---------------------------------------------------------------------------

function conifer(trunkHex: string, leafHex: string, o: { h?: number; tiers?: number; bare?: boolean; lean?: number } = {}): THREE.BufferGeometry {
  const h = o.h ?? 7;
  const tiers = o.tiers ?? 3;
  const s = h / 7;
  const parts: Part[] = [
    { geo: new THREE.CylinderGeometry(0.09 * s, 0.2 * s, h * 0.38, 6), color: C(trunkHex), matrix: trs(0, h * 0.19, 0) },
  ];
  if (!o.bare) {
    for (let k = 0; k < tiers; k++) {
      const f = k / Math.max(tiers - 1, 1);
      const r = 1.55 * s * (1 - f * 0.62);
      const ch = h * 0.34;
      const y = h * 0.3 + f * h * 0.52;
      parts.push({
        geo: new THREE.ConeGeometry(r, ch, 7),
        color: C(leafHex).offsetHSL(0, 0, (f - 0.5) * 0.05),
        matrix: trs(0, y, 0, { ry: k * 0.7 }),
      });
    }
  }
  const merged = buildMerged(parts);
  if (o.lean) merged.applyMatrix4(trs(0, 0, 0, { rz: o.lean }));
  return merged;
}

function broadleaf(trunkHex: string, leafHex: string, o: { h?: number; blobs?: number } = {}): THREE.BufferGeometry {
  const h = o.h ?? 6;
  const s = h / 6;
  const blobs = o.blobs ?? 3;
  const parts: Part[] = [
    { geo: new THREE.CylinderGeometry(0.14 * s, 0.26 * s, h * 0.58, 6), color: C(trunkHex), matrix: trs(0, h * 0.29, 0) },
  ];
  const offsets: [number, number, number, number][] = [
    [0, 0.82, 0, 0.3],
    [0.34, 0.66, 0.14, 0.22],
    [-0.3, 0.7, -0.18, 0.2],
    [0.05, 0.6, 0.32, 0.18],
  ];
  for (let b = 0; b < Math.min(blobs, offsets.length); b++) {
    const [ox, oy, oz, or_] = offsets[b]!;
    parts.push({
      geo: new THREE.IcosahedronGeometry(h * or_, 0),
      color: C(leafHex).offsetHSL(0, 0, (b - 1) * 0.03),
      matrix: trs(ox * h, oy * h, oz * h),
    });
  }
  return buildMerged(parts);
}

function deadTree(barkHex: string, o: { h?: number; branches?: number } = {}): THREE.BufferGeometry {
  const h = o.h ?? 6;
  const s = h / 6;
  const branches = o.branches ?? 4;
  const parts: Part[] = [
    { geo: new THREE.CylinderGeometry(0.08 * s, 0.24 * s, h * 0.9, 6), color: C(barkHex), matrix: trs(0, h * 0.45, 0) },
  ];
  for (let b = 0; b < branches; b++) {
    const ang = (b / branches) * Math.PI * 2 + 0.4;
    const y = h * (0.45 + 0.4 * (b / branches));
    parts.push({
      geo: new THREE.CylinderGeometry(0.03 * s, 0.07 * s, h * 0.42, 5),
      color: C(barkHex).offsetHSL(0, 0, 0.02),
      matrix: trs(Math.cos(ang) * 0.5 * s, y, Math.sin(ang) * 0.5 * s, {
        rz: Math.cos(ang) * 1.0,
        rx: -Math.sin(ang) * 1.0,
      }),
    });
  }
  return buildMerged(parts);
}

function fungus(stemHex: string, capHex: string, o: { h?: number } = {}): THREE.BufferGeometry {
  const h = o.h ?? 3.2;
  const s = h / 3.2;
  return buildMerged([
    { geo: new THREE.CylinderGeometry(0.16 * s, 0.3 * s, h * 0.8, 7), color: C(stemHex), matrix: trs(0, h * 0.4, 0) },
    { geo: new THREE.ConeGeometry(0.9 * s, h * 0.4, 9), color: C(capHex), matrix: trs(0, h * 0.92, 0) },
  ]);
}

function boulder(rockHex: string, o: { r?: number } = {}): THREE.BufferGeometry {
  const r = o.r ?? 1.1;
  return buildMerged([
    { geo: new THREE.IcosahedronGeometry(r, 0), color: C(rockHex), matrix: trs(0, r * 0.55, 0, { sy: 0.72 }) },
    { geo: new THREE.IcosahedronGeometry(r * 0.55, 0), color: C(rockHex).offsetHSL(0, 0, 0.04), matrix: trs(r * 0.7, r * 0.3, r * 0.3, { sy: 0.7 }) },
  ]);
}

function spire(rockHex: string, o: { h?: number; r?: number; sides?: number } = {}): THREE.BufferGeometry {
  const h = o.h ?? 3.4;
  const r = o.r ?? 0.7;
  return buildMerged([
    { geo: new THREE.CylinderGeometry(r * 0.35, r, h, o.sides ?? 6), color: C(rockHex), matrix: trs(0, h / 2, 0) },
  ]);
}

function rubble(rockHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.BoxGeometry(0.9, 0.5, 0.7), color: C(rockHex), matrix: trs(0, 0.25, 0, { ry: 0.4 }) },
    { geo: new THREE.BoxGeometry(0.6, 0.4, 0.5), color: C(rockHex).offsetHSL(0, 0, 0.05), matrix: trs(0.55, 0.2, 0.3, { ry: 1.1 }) },
    { geo: new THREE.BoxGeometry(0.45, 0.35, 0.4), color: C(rockHex).offsetHSL(0, 0, -0.04), matrix: trs(-0.4, 0.17, 0.35, { ry: 2.2 }) },
  ]);
}

function ruin(rockHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.CylinderGeometry(0.45, 0.5, 2.4, 8), color: C(rockHex), matrix: trs(0, 1.2, 0) },
    { geo: new THREE.CylinderGeometry(0.42, 0.46, 1.1, 8), color: C(rockHex).offsetHSL(0, 0, 0.03), matrix: trs(0.1, 2.8, 0.05, { rz: 0.28 }) },
    { geo: new THREE.BoxGeometry(1.7, 0.35, 1.1), color: C(rockHex).offsetHSL(0, 0, -0.03), matrix: trs(1.3, 0.17, 0.7, { ry: 0.5, rz: 0.06 }) },
  ]);
}

function menhir(rockHex: string, o: { h?: number; runeHex?: string } = {}): THREE.BufferGeometry {
  const h = o.h ?? 2.8;
  const parts: Part[] = [
    { geo: new THREE.BoxGeometry(0.9, h, 0.5), color: C(rockHex), matrix: trs(0, h / 2, 0, { ry: 0.06 }) },
  ];
  if (o.runeHex) {
    parts.push({
      geo: new THREE.BoxGeometry(0.16, h * 0.62, 0.06),
      color: C(o.runeHex),
      matrix: trs(0, h * 0.5, 0.27),
    });
  }
  return buildMerged(parts);
}

function graveSlab(rockHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.BoxGeometry(1.2, 0.24, 2.0), color: C(rockHex), matrix: trs(0, 0.14, 0, { rz: 0.05, rx: 0.03 }) },
  ]);
}

function soulCairn(rockHex: string, glowHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.IcosahedronGeometry(0.55, 0), color: C(rockHex), matrix: trs(0, 0.4, 0) },
    { geo: new THREE.IcosahedronGeometry(0.4, 0), color: C(rockHex).offsetHSL(0, 0, 0.04), matrix: trs(0.1, 1.05, 0.05) },
    { geo: new THREE.IcosahedronGeometry(0.26, 0), color: C(glowHex), matrix: trs(-0.05, 1.5, 0) },
  ]);
}

function crystalCluster(crystalHex: string, o: { h?: number } = {}): THREE.BufferGeometry {
  const h = o.h ?? 1.5;
  const s = h / 1.5;
  return buildMerged([
    { geo: new THREE.OctahedronGeometry(0.4 * s, 0), color: C(crystalHex), matrix: trs(0, h * 0.55, 0, { sy: 2.4 }) },
    { geo: new THREE.OctahedronGeometry(0.28 * s, 0), color: C(crystalHex).offsetHSL(0, 0, 0.08), matrix: trs(0.34 * s, h * 0.36, 0.1 * s, { sy: 2.1, rz: 0.5 }) },
    { geo: new THREE.OctahedronGeometry(0.22 * s, 0), color: C(crystalHex).offsetHSL(0, 0, -0.05), matrix: trs(-0.3 * s, h * 0.3, -0.08 * s, { sy: 2.0, rz: -0.45 }) },
  ]);
}

function rootTangle(rootHex: string): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + 0.5;
    parts.push({
      geo: new THREE.CylinderGeometry(0.07, 0.16, 2.2, 5),
      color: C(rootHex).offsetHSL(0, 0, (i - 1.5) * 0.02),
      matrix: trs(Math.cos(ang) * 0.55, 0.8, Math.sin(ang) * 0.55, {
        rz: Math.cos(ang) * 0.75,
        rx: -Math.sin(ang) * 0.75,
      }),
    });
  }
  return buildMerged(parts);
}

function frozenWave(iceHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.CylinderGeometry(0.3, 1.1, 2.6, 6, 1), color: C(iceHex), matrix: trs(0, 1.3, 0, { rz: 0.5 }) },
    { geo: new THREE.CylinderGeometry(0.2, 0.8, 1.9, 6, 1), color: C(iceHex).offsetHSL(0, 0, 0.05), matrix: trs(0.9, 0.95, 0.3, { rz: 0.9, ry: 0.6 }) },
  ]);
}

function caveRoot(rootHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.CylinderGeometry(0.12, 0.3, 3.4, 6), color: C(rootHex), matrix: trs(0, 1.7, 0, { rz: 0.16 }) },
    { geo: new THREE.CylinderGeometry(0.07, 0.16, 2.0, 5), color: C(rootHex).offsetHSL(0, 0, 0.04), matrix: trs(0.5, 2.6, 0.2, { rz: 0.7 }) },
  ]);
}

function longhouse(wallHex: string, roofHex: string): THREE.BufferGeometry {
  return buildMerged([
    { geo: new THREE.BoxGeometry(7, 2.4, 4.2), color: C(wallHex), matrix: trs(0, 1.2, 0) },
    { geo: new THREE.BoxGeometry(7.5, 0.24, 2.7), color: C(roofHex), matrix: trs(0, 3.15, -1.05, { rx: 0.62 }) },
    { geo: new THREE.BoxGeometry(7.5, 0.24, 2.7), color: C(roofHex), matrix: trs(0, 3.15, 1.05, { rx: -0.62 }) },
    { geo: new THREE.BoxGeometry(1.1, 1.7, 0.15), color: C('#241a10'), matrix: trs(0, 0.85, 2.12) },
    { geo: new THREE.CylinderGeometry(0.16, 0.16, 7.2, 5), color: C(roofHex).offsetHSL(0, 0, -0.05), matrix: trs(0, 3.55, 0, { rz: Math.PI / 2 }) },
  ]);
}

// ---------------------------------------------------------------------------
// Prop archetype table — one entry per kind id used in contracts/realms.ts
// ---------------------------------------------------------------------------

interface PropDef {
  build(): THREE.BufferGeometry;
  /** Emissive hex; glowing archetypes share a per-color material. */
  glow?: string;
  /** Cylinder collider radius/height (meters, pre-scale). Omit = walk-through. */
  colliderR?: number;
  colliderH?: number;
  scale: [number, number];
  maxSlope: number;
}

const def = (d: Omit<PropDef, 'maxSlope'> & { maxSlope?: number }): PropDef => ({ maxSlope: 0.42, ...d });

const PROP_DEFS: Record<string, PropDef> = {
  // --- conifers -------------------------------------------------------------
  pine_tall: def({ build: () => conifer('#4a3626', '#2e5230', { h: 8.5, tiers: 4 }), colliderR: 0.5, colliderH: 8, scale: [0.8, 1.3] }),
  pine_gnarled: def({ build: () => conifer('#42301f', '#3a5c34', { h: 6, tiers: 3, lean: 0.14 }), colliderR: 0.45, colliderH: 6, scale: [0.75, 1.2] }),
  frost_pine: def({ build: () => conifer('#3a3f45', '#c9d8e2', { h: 7.5, tiers: 4 }), colliderR: 0.5, colliderH: 7, scale: [0.8, 1.25] }),
  ice_encased_pine: def({ build: () => conifer('#3f4a52', '#a8d0e8', { h: 7, tiers: 3 }), glow: '#6fa8e8', colliderR: 0.5, colliderH: 7, scale: [0.8, 1.2] }),
  charred_trunk: def({ build: () => conifer('#1c1512', '#000000', { h: 6, bare: true }), colliderR: 0.4, colliderH: 6, scale: [0.7, 1.3] }),
  // --- broadleaf --------------------------------------------------------------
  birch: def({ build: () => broadleaf('#d8d4c8', '#5c8a3c', { h: 6 }), colliderR: 0.4, colliderH: 6, scale: [0.8, 1.2] }),
  gold_birch: def({ build: () => broadleaf('#e0dcc8', '#d8b84a', { h: 6.5 }), colliderR: 0.4, colliderH: 6, scale: [0.8, 1.25] }),
  lumen_willow: def({ build: () => broadleaf('#8a94a8', '#ffe9a8', { h: 7, blobs: 4 }), glow: '#f0d060', colliderR: 0.4, colliderH: 7, scale: [0.85, 1.3] }),
  ancient_oak: def({ build: () => broadleaf('#4a3a28', '#3e7038', { h: 9, blobs: 4 }), colliderR: 0.7, colliderH: 9, scale: [0.9, 1.5] }),
  golden_ash: def({ build: () => broadleaf('#5a4632', '#c8a83e', { h: 7.5 }), colliderR: 0.45, colliderH: 7, scale: [0.85, 1.3] }),
  vine_tree: def({ build: () => broadleaf('#3e3324', '#4c7a34', { h: 7, blobs: 4 }), colliderR: 0.45, colliderH: 7, scale: [0.8, 1.3] }),
  golden_yew: def({ build: () => conifer('#5a4a30', '#c8a83e', { h: 6.5, tiers: 3 }), colliderR: 0.45, colliderH: 6, scale: [0.8, 1.25] }),
  storm_oak: def({ build: () => broadleaf('#3a332a', '#6a7280', { h: 8, blobs: 4 }), colliderR: 0.6, colliderH: 8, scale: [0.9, 1.4] }),
  // --- dead trees ---------------------------------------------------------------
  dead_larch: def({ build: () => deadTree('#6a6258', { h: 6 }), colliderR: 0.35, colliderH: 6, scale: [0.7, 1.3] }),
  dead_tree: def({ build: () => deadTree('#4a4440', { h: 5.5 }), colliderR: 0.35, colliderH: 5, scale: [0.7, 1.3] }),
  bone_tree: def({ build: () => deadTree('#c8c4b8', { h: 6 }), colliderR: 0.35, colliderH: 6, scale: [0.7, 1.25] }),
  // --- fungus / roots -------------------------------------------------------------
  glow_fungus_tall: def({ build: () => fungus('#c8bfd8', '#9a6fe0'), glow: '#9a6fe0', colliderR: 0.35, colliderH: 3, scale: [0.7, 1.4] }),
  cave_root: def({ build: () => caveRoot('#4a3a5c'), colliderR: 0.3, colliderH: 3, scale: [0.8, 1.4] }),
  root_tangle: def({ build: () => rootTangle('#4a3a26'), colliderR: 0.6, colliderH: 1.6, scale: [0.8, 1.4] }),
  // --- boulders / spires ------------------------------------------------------------
  boulder_moss: def({ build: () => boulder('#5a6a52'), colliderR: 1.1, colliderH: 1.6, scale: [0.7, 1.6] }),
  pale_stone: def({ build: () => boulder('#b8bcae'), colliderR: 1.0, colliderH: 1.5, scale: [0.7, 1.5] }),
  lava_rock: def({ build: () => boulder('#2a1a12'), glow: '#f0703c', colliderR: 1.1, colliderH: 1.6, scale: [0.7, 1.6] }),
  basalt_spire: def({ build: () => spire('#2e2838', { h: 4.2 }), colliderR: 0.8, colliderH: 4, scale: [0.8, 1.7], maxSlope: 0.6 }),
  basalt_column: def({ build: () => spire('#241d18', { h: 3.2, r: 0.8, sides: 6 }), colliderR: 0.9, colliderH: 3.2, scale: [0.8, 1.8], maxSlope: 0.6 }),
  obsidian_spire: def({ build: () => spire('#14100e', { h: 4.6, r: 0.65 }), colliderR: 0.8, colliderH: 4.5, scale: [0.9, 1.9], maxSlope: 0.6 }),
  glacier_spike: def({ build: () => spire('#b8d8e8', { h: 3.8, r: 0.6 }), colliderR: 0.7, colliderH: 3.8, scale: [0.8, 1.8], maxSlope: 0.6 }),
  blue_ice_spire: def({ build: () => spire('#7ab8d8', { h: 3.6, r: 0.6 }), glow: '#4a90c8', colliderR: 0.7, colliderH: 3.6, scale: [0.8, 1.8], maxSlope: 0.6 }),
  frozen_wave: def({ build: () => frozenWave('#8fc0d8'), colliderR: 1.0, colliderH: 2.4, scale: [0.9, 1.7], maxSlope: 0.6 }),
  forge_rubble: def({ build: () => rubble('#3a3244'), scale: [0.9, 1.8] }),
  // --- ruins / stones ------------------------------------------------------------------
  frozen_ruin: def({ build: () => ruin('#9ab0c0'), colliderR: 1.2, colliderH: 3, scale: [0.9, 1.5] }),
  marble_ruin: def({ build: () => ruin('#c8bc9a'), colliderR: 1.2, colliderH: 3, scale: [0.9, 1.5] }),
  standing_stone: def({ build: () => menhir('#6a7066', { h: 3 }), colliderR: 0.7, colliderH: 3, scale: [0.8, 1.4] }),
  rune_stone: def({ build: () => menhir('#5a6058', { h: 2.6, runeHex: '#8fd8b0' }), glow: '#6fa287', colliderR: 0.7, colliderH: 2.6, scale: [0.85, 1.3] }),
  rune_monolith: def({ build: () => menhir('#4a5058', { h: 3.6, runeHex: '#a8c6da' }), glow: '#a8c6da', colliderR: 0.8, colliderH: 3.6, scale: [0.9, 1.4] }),
  moss_menhir: def({ build: () => menhir('#5a6a48', { h: 2.8 }), colliderR: 0.7, colliderH: 2.8, scale: [0.8, 1.35] }),
  grave_slab: def({ build: () => graveSlab('#4a5058'), scale: [0.9, 1.4] }),
  soul_cairn: def({ build: () => soulCairn('#3c4248', '#7fb89a'), glow: '#7fb89a', colliderR: 0.7, colliderH: 1.7, scale: [0.9, 1.4] }),
  bifrost_shard_rock: def({ build: () => boulder('#8a7a5a'), glow: '#e8c86a', colliderR: 1.0, colliderH: 1.5, scale: [0.8, 1.5] }),
  // --- crystals ---------------------------------------------------------------------------
  mote_shard: def({ build: () => crystalCluster('#f0d060', { h: 1.0 }), glow: '#f0d060', scale: [0.8, 1.4] }),
  light_mote: def({ build: () => crystalCluster('#fff0b8', { h: 0.9 }), glow: '#ffe9a8', scale: [0.7, 1.3] }),
  sun_crystal: def({ build: () => crystalCluster('#ffd98a', { h: 1.4 }), glow: '#ffd98a', scale: [0.8, 1.5] }),
  vein_crystal_purple: def({ build: () => crystalCluster('#9a6fe0', { h: 1.5 }), glow: '#9a6fe0', scale: [0.8, 1.6] }),
  vein_crystal_teal: def({ build: () => crystalCluster('#5ec8c0', { h: 1.4 }), glow: '#5ec8c0', scale: [0.8, 1.6] }),
  rime_crystal: def({ build: () => crystalCluster('#bfe8ff', { h: 1.5 }), glow: '#bfe8ff', scale: [0.8, 1.6] }),
  nifl_crystal: def({ build: () => crystalCluster('#6fa8e8', { h: 1.6 }), glow: '#6fa8e8', scale: [0.8, 1.6] }),
  aurora_shard: def({ build: () => crystalCluster('#8fe8c0', { h: 1.2 }), glow: '#8fe8c0', scale: [0.7, 1.4] }),
  ember_crystal: def({ build: () => crystalCluster('#ff8a4a', { h: 1.5 }), glow: '#ff8a4a', scale: [0.8, 1.6] }),
  seed_crystal: def({ build: () => crystalCluster('#a8d860', { h: 1.2 }), glow: '#a8d860', scale: [0.7, 1.4] }),
  soul_wisp_crystal: def({ build: () => crystalCluster('#7fb89a', { h: 1.4 }), glow: '#7fb89a', scale: [0.8, 1.5] }),
  bifrost_crystal: def({ build: () => crystalCluster('#e8c86a', { h: 1.6 }), glow: '#e8c86a', scale: [0.8, 1.6] }),
};

// ---------------------------------------------------------------------------
// Build & placement
// ---------------------------------------------------------------------------

export type PropsBuild = RealmModule;

interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function buildProps(bctx: RealmBuildCtx): PropsBuild {
  const { config, root } = bctx;
  const accent = config.palette.accent;

  const disposables: { dispose(): void }[] = [];
  const instancedMeshes: THREE.InstancedMesh[] = [];
  const pulseMats: THREE.MeshStandardMaterial[] = [];

  const standardMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.03,
  });
  disposables.push(standardMat);

  const glowMats = new Map<string, THREE.MeshStandardMaterial>();
  const glowMaterial = (hex: string): THREE.MeshStandardMaterial => {
    let m = glowMats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex).multiplyScalar(0.3),
        emissive: new THREE.Color(hex),
        emissiveIntensity: 0.85,
        roughness: 0.5,
        metalness: 0.05,
      });
      glowMats.set(hex, m);
      pulseMats.push(m);
      disposables.push(m);
    }
    return m;
  };

  // Points that must stay clear of props (spawn, portals, boss arena).
  const avoid: { x: number; z: number; r: number }[] = [
    { x: config.spawnOffset.x, z: config.spawnOffset.z, r: 8 },
    ...config.portals.map((p) => ({ x: p.offset.x, z: p.offset.z, r: 7 })),
    { x: config.bossArenaOffset.x, z: config.bossArenaOffset.z, r: 26 },
  ];
  const clearOfAnchors = (x: number, z: number): boolean =>
    avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r);

  const rng = mulberry32(config.terrain.seed * 31 + 7);

  const scatter = (count: number, maxSlope: number, minGap: number): Placement[] => {
    const out: Placement[] = [];
    let attempts = count * 30;
    while (out.length < count && attempts-- > 0) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * PLACEMENT_MAX_R;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const y = bctx.sampleHeight(x, z);
      if (y < MIN_HEIGHT) continue;
      if (bctx.sampleSlope(x, z) > maxSlope) continue;
      if (!clearOfAnchors(x, z)) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < minGap)) continue;
      out.push({ x, y, z, yaw: rng() * Math.PI * 2 });
    }
    return out;
  };

  const dummy = new THREE.Object3D();

  const placeKind = (kind: string, count: number, salt: number): void => {
    const d = PROP_DEFS[kind];
    if (!d || count <= 0) return;
    const geo = d.build();
    disposables.push(geo);
    const mesh = new THREE.InstancedMesh(geo, d.glow ? glowMaterial(d.glow) : standardMat, count);
    mesh.name = `props:${config.id}:${kind}`;
    const placements = scatter(count, d.maxSlope, 2.2);
    let used = 0;
    const local = mulberry32(config.terrain.seed * 131 + salt);
    for (const p of placements) {
      const scale = d.scale[0] + local() * (d.scale[1] - d.scale[0]);
      dummy.position.set(p.x, p.y - 0.12, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(used++, dummy.matrix);
      if (d.colliderR) {
        bctx.colliders.push({
          kind: 'cylinder',
          x: p.x,
          z: p.z,
          r: d.colliderR * scale,
          y0: p.y - 1,
          y1: p.y + (d.colliderH ?? 3) * scale,
        });
      }
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    instancedMeshes.push(mesh);
    root.add(mesh);
  };

  // One InstancedMesh per kind in each configured prop set.
  let salt = 1;
  const placeSet = (kinds: string[], densityPer100m: number): void => {
    if (kinds.length === 0 || densityPer100m <= 0) return;
    const total = Math.max(kinds.length, Math.round(densityPer100m * AREA_CELLS));
    const per = Math.max(1, Math.round(total / kinds.length));
    for (const kind of kinds) placeKind(kind, per, salt++);
  };
  placeSet(config.trees.kinds, config.trees.densityPer100m);
  placeSet(config.rocks.kinds, config.rocks.densityPer100m);
  placeSet(config.crystals.kinds, config.crystals.densityPer100m);

  // -- 1-3 glowing rune monoliths per realm (accent emissive) -----------------
  {
    const count = 1 + Math.floor(rng() * MONOLITH_MAX);
    const geo = menhir('#3f434a', { h: 3.6, runeHex: accent });
    disposables.push(geo);
    const mesh = new THREE.InstancedMesh(geo, glowMaterial(accent), count);
    mesh.name = `props:${config.id}:ward_monolith`;
    const placements = scatter(count, 0.35, 18);
    if (placements.length === 0) {
      // Guarantee at least one monolith per realm even on unlucky terrain.
      const fx = config.spawnOffset.x + 14;
      const fz = config.spawnOffset.z - 10;
      placements.push({ x: fx, y: bctx.sampleHeight(fx, fz), z: fz, yaw: 0.6 });
    }
    let used = 0;
    for (const p of placements) {
      dummy.position.set(p.x, p.y - 0.1, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(1.05);
      dummy.updateMatrix();
      mesh.setMatrixAt(used++, dummy.matrix);
      bctx.colliders.push({ kind: 'cylinder', x: p.x, z: p.z, r: 0.8, y0: p.y - 1, y1: p.y + 3.6 });
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    instancedMeshes.push(mesh);
    root.add(mesh);
  }

  // -- Midgard longhouse shells -------------------------------------------------
  if (config.id === 'midgard') {
    const geo = longhouse('#4a3826', '#332619');
    disposables.push(geo);
    const count = 4;
    const mesh = new THREE.InstancedMesh(geo, standardMat, count);
    mesh.name = 'props:midgard:longhouse';
    let used = 0;
    let attempts = 200;
    while (used < count && attempts-- > 0) {
      const ang = rng() * Math.PI * 2;
      const rad = 24 + rng() * 46;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const y = bctx.sampleHeight(x, z);
      if (y < MIN_HEIGHT || bctx.sampleSlope(x, z) > 0.25) continue;
      if (!clearOfAnchors(x, z)) continue;
      const yaw = rng() * Math.PI * 2;
      dummy.position.set(x, y - 0.15, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(0.9 + rng() * 0.35);
      dummy.updateMatrix();
      mesh.setMatrixAt(used++, dummy.matrix);
      bctx.colliders.push({ kind: 'cylinder', x, z, r: 4.6, y0: y - 1, y1: y + 3.6 });
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    instancedMeshes.push(mesh);
    root.add(mesh);
  }

  return {
    update(_dt, elapsed) {
      const k = 0.85 + Math.sin(elapsed * 1.3) * 0.22;
      for (const m of pulseMats) m.emissiveIntensity = k;
    },
    dispose() {
      for (const m of instancedMeshes) {
        root.remove(m);
        m.dispose();
      }
      instancedMeshes.length = 0;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      pulseMats.length = 0;
      glowMats.clear();
    },
  };
}
