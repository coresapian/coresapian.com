// ============================================================================
// CORESAPIAN — src/game/world/nodes.ts
// Harvestable resource nodes from RealmConfig.resourceNodes. Glowing
// instanced props + engine interactables (kind 'node', 1500ms channel,
// 120s respawn). Per the world-agent brief, harvest channel completion calls
// store.beginOp(opId) — the ONLY inventory op world may originate.
// ============================================================================

import * as THREE from 'three';

import { ITEMS } from '../../../contracts/items';
import { mulberry32 } from '../config';
import { buildHarvestOp, submitOp } from '../rpg/ops';

import type { RealmBuildCtx, RealmModule } from './types';

const NODE_CHANNEL_MS = 1500;
const NODE_RESPAWN_MS = 120_000;
const NODE_RADIUS = 2.5;
const AREA_CELLS = (220 * 220) / 10000;
const PLACEMENT_MAX_R = 148;
const MIN_HEIGHT = 0.7;

/** Emissive tint per yielded material (display names come from items.ts). */
const NODE_TINTS: Record<string, string> = {
  mat_wood: '#b08a4f',
  mat_iron: '#d06a50',
  mat_herb: '#8fe07a',
  mat_crystal: '#a8d8ff',
  mat_rime: '#bfe8ff',
  mat_ember: '#ff8a4a',
  mat_gold: '#ffd75e',
  mat_sap: '#ffb84a',
  mat_essence: '#9fffd0',
};

type NodeKind = 'wood' | 'ore' | 'crystal' | 'herb';

function nodeGeometry(kind: NodeKind): THREE.BufferGeometry {
  switch (kind) {
    case 'wood': {
      // Fallen log with a cut stump.
      const log = new THREE.CylinderGeometry(0.3, 0.36, 2.3, 7);
      log.rotateZ(Math.PI / 2);
      log.translate(0, 0.34, 0);
      const stump = new THREE.CylinderGeometry(0.34, 0.42, 0.7, 7);
      stump.translate(1.35, 0.35, 0.2);
      return mergeSimple([log, stump]);
    }
    case 'ore': {
      const rock = new THREE.IcosahedronGeometry(0.8, 0);
      rock.scale(1, 0.75, 1);
      rock.translate(0, 0.5, 0);
      const vein = new THREE.OctahedronGeometry(0.32, 0);
      vein.scale(1, 1.9, 1);
      vein.translate(0.35, 0.75, 0.25);
      return mergeSimple([rock, vein]);
    }
    case 'crystal': {
      const a = new THREE.OctahedronGeometry(0.34, 0);
      a.scale(1, 2.3, 1);
      a.translate(0, 0.7, 0);
      const b = new THREE.OctahedronGeometry(0.24, 0);
      b.scale(1, 2.0, 1);
      b.rotateZ(0.5);
      b.translate(0.4, 0.45, 0.12);
      return mergeSimple([a, b]);
    }
    case 'herb': {
      const geos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const g = new THREE.ConeGeometry(0.16, 0.75, 5);
        const ang = (i / 3) * Math.PI * 2;
        g.translate(Math.cos(ang) * 0.22, 0.36, Math.sin(ang) * 0.22);
        geos.push(g);
      }
      return mergeSimple(geos);
    }
  }
}

/** Merge same-attribute primitives (position/normal/uv) without vertex colors. */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of nonIndexed) total += (g.attributes.position as THREE.BufferAttribute).count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let vo = 0;
  for (const g of nonIndexed) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, vo * 3);
    norm.set(n.array as Float32Array, vo * 3);
    uv.set(u.array as Float32Array, vo * 2);
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const g of geos) g.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type NodesBuild = RealmModule;

interface NodeInstance {
  mesh: THREE.InstancedMesh;
  index: number;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  harvestedAt: number | null;
}

export function buildNodes(bctx: RealmBuildCtx): NodesBuild {
  const { ctx, config, root } = bctx;

  const disposables: { dispose(): void }[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const nodes: NodeInstance[] = [];
  let opSeq = 0;
  let simNowMs = 0;

  const rng = mulberry32(config.terrain.seed * 17 + 3);
  const yieldRng = mulberry32(config.terrain.seed * 977 + 13);

  const avoid: { x: number; z: number; r: number }[] = [
    { x: config.spawnOffset.x, z: config.spawnOffset.z, r: 6 },
    ...config.portals.map((p) => ({ x: p.offset.x, z: p.offset.z, r: 6 })),
    { x: config.bossArenaOffset.x, z: config.bossArenaOffset.z, r: 24 },
  ];

  const dummy = new THREE.Object3D();
  const HIDDEN = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -500, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0.0001, 0.0001, 0.0001),
  );

  config.resourceNodes.forEach((set, entryIdx) => {
    const kind = set.kind as NodeKind;
    const tint = NODE_TINTS[set.itemId] ?? '#a8d8ff';
    const itemName = ITEMS[set.itemId]?.name ?? set.itemId;

    const geo = nodeGeometry(kind);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tint).multiplyScalar(0.45),
      emissive: new THREE.Color(tint),
      emissiveIntensity: 0.55,
      roughness: 0.6,
      metalness: 0.05,
    });
    disposables.push(geo, mat);

    const count = Math.max(2, Math.round(set.densityPer100m * AREA_CELLS));
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = `nodes:${config.id}:${set.itemId}:${entryIdx}`;

    let used = 0;
    let attempts = count * 40;
    while (used < count && attempts-- > 0) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * PLACEMENT_MAX_R;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const y = bctx.sampleHeight(x, z);
      if (y < MIN_HEIGHT || bctx.sampleSlope(x, z) > 0.45) continue;
      if (!avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r)) continue;

      const yaw = rng() * Math.PI * 2;
      const scale = 0.85 + rng() * 0.5;
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(used, dummy.matrix);

      const node: NodeInstance = {
        mesh,
        index: used,
        kind,
        x,
        y,
        z,
        yaw,
        scale,
        harvestedAt: null,
      };
      nodes.push(node);

      if (kind === 'ore' || kind === 'crystal' || kind === 'wood') {
        bctx.colliders.push({
          kind: 'cylinder',
          x,
          z,
          r: 0.7 * scale,
          y0: y - 0.5,
          y1: y + 1.1 * scale,
        });
      }

      bctx.interact({
        id: `node:${config.id}:${entryIdx}:${used}`,
        kind: 'node',
        prompt: `E — Gather ${itemName}`,
        position: new THREE.Vector3(x, y + 0.6, z),
        radius: NODE_RADIUS,
        channelMs: NODE_CHANNEL_MS,
        isAvailable: () => node.harvestedAt === null,
        onInteract: () => harvest(node, set, itemName, opSeq++),
      });
      used++;
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    meshes.push(mesh);
    root.add(mesh);
  });

  function harvest(
    node: NodeInstance,
    set: { itemId: string; yieldMin: number; yieldMax: number },
    itemName: string,
    seq: number,
  ): void {
    if (node.harvestedAt !== null) return;
    node.harvestedAt = simNowMs;
    if (node.kind === 'ore' || node.kind === 'crystal') {
      // Depleted husk: shrink so the collider still matches the visual.
      dummy.position.set(node.x, node.y - 0.05, node.z);
      dummy.rotation.set(0, node.yaw, 0);
      dummy.scale.setScalar(node.scale * 0.3);
      dummy.updateMatrix();
      node.mesh.setMatrixAt(node.index, dummy.matrix);
    } else {
      node.mesh.setMatrixAt(node.index, HIDDEN);
    }
    node.mesh.instanceMatrix.needsUpdate = true;

    const qty = set.yieldMin + Math.floor(yieldRng() * (set.yieldMax - set.yieldMin + 1));

    // The one inventory op world may originate (brief §6): canonical
    // client-local harvest op, settled synchronously by the rpg subsystem.
    submitOp(buildHarvestOp(`node:${config.id}:${node.index}:${seq}`, set.itemId, qty));

    ctx.store.getState().notify('loot', `+${qty} × ${itemName}`, 3500);
    ctx.events.emit('play_sfx', {
      sfxId: 'sfx.harvest',
      position: { x: node.x, y: node.y, z: node.z },
    });
  }

  return {
    update(dt) {
      simNowMs += dt * 1000;
      for (const node of nodes) {
        if (node.harvestedAt !== null && simNowMs - node.harvestedAt >= NODE_RESPAWN_MS) {
          node.harvestedAt = null;
          dummy.position.set(node.x, node.y - 0.05, node.z);
          dummy.rotation.set(0, node.yaw, 0);
          dummy.scale.setScalar(node.scale);
          dummy.updateMatrix();
          node.mesh.setMatrixAt(node.index, dummy.matrix);
          node.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const m of meshes) {
        root.remove(m);
        m.dispose();
      }
      meshes.length = 0;
      nodes.length = 0;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
