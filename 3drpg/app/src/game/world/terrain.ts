// ============================================================================
// CORESAPIAN — src/game/world/terrain.ts
// Per-realm procedural heightfield island. Heights come from the seeded
// simplex/fbm helpers in src/game/config (frozen) driven by
// RealmConfig.terrain; sampleHeight() is a bilinear read over the exact grid
// the mesh is built from (analytic — never a mesh raycast).
// ============================================================================

import * as THREE from 'three';

import type { RealmConfig } from '../../../contracts/realms';
import type { Vec3 } from '../../../contracts/types';
import { clamp, createSimplex2D, fbm, lerp, smoothstep } from '../config';
import type { TerrainService } from '../services';

import type { RealmBuildCtx, RealmModule } from './types';

// ---------------------------------------------------------------------------
// Layout constants (world-geometry tuning; gameplay numbers live in contracts)
// ---------------------------------------------------------------------------

/** Terrain mesh span — the ~220x220m playable area. */
export const TERRAIN_SIZE_M = 224;
/** Grid resolution (128..192 per spec). */
export const TERRAIN_SEGMENTS = 160;

const SEA_LEVEL = 0;
const SEA_FLOOR_Y = -9;
/** Island radial falloff: land starts sinking here... */
const ISLAND_SHELF_R = 138;
/** ...and reaches the sea floor here. */
const ISLAND_RIM_R = 196;
/** Base lift so the island disc sits above the sea. */
const BASE_LIFT = 2.4;

const SEA_RADIUS = 300;

// ---------------------------------------------------------------------------
// Height function
// ---------------------------------------------------------------------------

interface FlattenPoint {
  x: number;
  z: number;
  r: number;
  h: number;
}

/**
 * The analytic realm height function: seeded fbm, exponent-mixed by
 * `flatness`, radial island falloff, and flattened discs under gameplay
 * anchor points (spawn, portals, boss arena).
 */
function createHeightFunction(config: RealmConfig): (x: number, z: number) => number {
  const t = config.terrain;
  const simplex = createSimplex2D(t.seed);
  const exponent = 1 + t.flatness * 2;

  const raw = (x: number, z: number): number => {
    const n = fbm(simplex, x * t.frequency, z * t.frequency, { octaves: t.octaves });
    const shaped = Math.sign(n) * Math.pow(Math.abs(n), exponent);
    let h = t.amplitude * shaped + BASE_LIFT;
    const r = Math.hypot(x, z);
    const shelf = smoothstep(ISLAND_SHELF_R, ISLAND_RIM_R, r);
    h = lerp(h, SEA_FLOOR_Y, shelf);
    return h;
  };

  const anchors: { x: number; z: number; r: number }[] = [
    { x: config.spawnOffset.x, z: config.spawnOffset.z, r: 12 },
    ...config.portals.map((p) => ({ x: p.offset.x, z: p.offset.z, r: 9 })),
    { x: config.bossArenaOffset.x, z: config.bossArenaOffset.z, r: 24 },
  ];
  const flats: FlattenPoint[] = anchors.map((a) => ({ ...a, h: raw(a.x, a.z) }));

  return (x, z) => {
    let h = raw(x, z);
    for (const f of flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r) {
        const k = smoothstep(f.r * 0.4, f.r, d);
        h = lerp(f.h, h, k);
      }
    }
    return h;
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface TerrainBuild extends RealmModule {
  readonly mesh: THREE.Mesh;
  readonly service: TerrainService;
  sampleHeight(x: number, z: number): number;
}

export function buildTerrain(bctx: RealmBuildCtx): TerrainBuild {
  const { config, root } = bctx;
  const size = TERRAIN_SIZE_M;
  const seg = TERRAIN_SEGMENTS;
  const verts = seg + 1;
  const half = size / 2;
  const cell = size / seg;

  const heightFn = createHeightFunction(config);

  // -- height grid (single source of truth for mesh + sampling) -------------
  const grid = new Float32Array(verts * verts);
  for (let j = 0; j < verts; j++) {
    const z = -half + j * cell;
    for (let i = 0; i < verts; i++) {
      const x = -half + i * cell;
      grid[j * verts + i] = heightFn(x, z);
    }
  }

  const sampleHeight = (x: number, z: number): number => {
    const gx = clamp(((x + half) / size) * seg, 0, seg - 1e-4);
    const gz = clamp(((z + half) / size) * seg, 0, seg - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h00 = grid[j * verts + i]!;
    const h10 = grid[j * verts + i + 1]!;
    const h01 = grid[(j + 1) * verts + i]!;
    const h11 = grid[(j + 1) * verts + i + 1]!;
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  };

  // -- mesh ------------------------------------------------------------------
  const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
  geometry.rotateX(-Math.PI / 2); // XZ plane, +Y up
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  // After rotateX(-π/2), PlaneGeometry vertex (j,i) sits at
  // (x = -half + i*cell, z = -half + j*cell) — a direct row mapping.
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      pos.setY(j * verts + i, grid[j * verts + i]!);
    }
  }
  geometry.computeVertexNormals();

  // -- vertex colors from height/slope against the realm palette -------------
  const pal = config.palette;
  const cGround = new THREE.Color(pal.ground);
  const cRock = new THREE.Color(pal.ground).lerp(new THREE.Color(pal.ambient), 0.6).multiplyScalar(0.82);
  const cHigh = new THREE.Color(pal.accent).lerp(new THREE.Color('#ffffff'), 0.45);
  const cShore = new THREE.Color(pal.horizon).lerp(cGround, 0.35);
  const amp = Math.max(config.terrain.amplitude, 1);

  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    const h = pos.getY(k);
    const slope = 1 - normals.getY(k); // 0 flat .. 1 vertical

    c.copy(cGround);
    c.lerp(cRock, smoothstep(0.12, 0.42, slope));
    c.lerp(cHigh, smoothstep(amp * 0.34, amp * 0.85, h) * 0.55);
    c.lerp(cShore, smoothstep(1.1, 0.15, h) * 0.65);
    // Deterministic per-vertex jitter so large flats don't band.
    const jitter = 1 + (hash2(x, z) - 0.5) * 0.09;
    colors[k * 3] = c.r * jitter;
    colors[k * 3 + 1] = c.g * jitter;
    colors[k * 3 + 2] = c.b * jitter;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `terrain:${config.id}`;
  root.add(mesh);

  // -- sea plane (realm island sits in it; fully fogged at the rim) ----------
  const seaColor = new THREE.Color(pal.fog).lerp(new THREE.Color(pal.horizon), 0.35);
  const seaGeo = new THREE.CircleGeometry(SEA_RADIUS, 48);
  const seaMat = new THREE.MeshStandardMaterial({
    color: seaColor,
    roughness: 0.42,
    metalness: 0.08,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL - 0.55;
  sea.name = `sea:${config.id}`;
  root.add(sea);

  // -- service ---------------------------------------------------------------
  const spawn: Vec3 = {
    x: config.spawnOffset.x,
    y: sampleHeight(config.spawnOffset.x, config.spawnOffset.z),
    z: config.spawnOffset.z,
  };

  const service: TerrainService = {
    realmId: config.id,
    sampleHeight,
    getColliders: () => bctx.colliders,
    getSpawnPoint: () => ({ ...spawn }),
  };

  return {
    mesh,
    service,
    sampleHeight,
    dispose() {
      root.remove(mesh, sea);
      geometry.dispose();
      material.dispose();
      seaGeo.dispose();
      seaMat.dispose();
    },
  };
}

/** Small deterministic 2D hash in [0,1) for color jitter. */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
