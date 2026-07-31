// ============================================================================
// CORESAPIAN — src/game/npc/mesh.ts
// Low-poly procedural NPC figures + floating nameplates (gdd §8.3, addendum
// §8: rpg-quests owns NPC meshes/nameplates). Zero external assets — canvas
// textures only, phosphor accent per the design system.
// ============================================================================

import * as THREE from 'three';

import type { NpcDef, NpcRole } from '../../../contracts/quests';

const PHOSPHOR = '#FFB64A';

/** Accent trim per role (design-system hues). */
const ROLE_ACCENT: Record<NpcRole, number> = {
  quest: 0xe8c86a, // gold
  shop: 0x8fbe50, // grove green
  smith: 0xf0703c, // forge ember
  seer: 0x9a6fe0, // seidr violet
  innkeep: 0xc48a5a, // hearth brown
};

const ROLE_LABEL: Record<NpcRole, string> = {
  quest: 'Quest',
  shop: 'Trader',
  smith: 'Smith',
  seer: 'Seeress',
  innkeep: 'Innkeep',
};

const CLOTH = 0x35302a;
const CLOTH_DARK = 0x27231e;
const SKIN = 0xc9a186;
const LEATHER = 0x5a4632;
const IRON = 0x8a8f96;

export interface NpcVisual {
  group: THREE.Group;
  dispose(): void;
}

/** Floating name + role plate (canvas sprite, phosphor on dark). */
function buildNameplate(npc: NpcDef): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const g = canvas.getContext('2d')!;

  g.fillStyle = 'rgba(12, 14, 17, 0.72)';
  g.beginPath();
  g.roundRect(8, 6, 240, 60, 6);
  g.fill();

  g.textAlign = 'center';
  g.fillStyle = PHOSPHOR;
  g.font = '600 22px "IBM Plex Mono", monospace';
  // Long names get a gentle shrink to fit the plate.
  const name = npc.name;
  if (g.measureText(name).width > 226) {
    g.font = '600 17px "IBM Plex Mono", monospace';
  }
  g.fillText(name, 128, 34);

  g.fillStyle = 'rgba(255, 182, 74, 0.66)';
  g.font = '13px "IBM Plex Mono", monospace';
  g.fillText(ROLE_LABEL[npc.role].toUpperCase(), 128, 56);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.9, 0.53, 1);
  sprite.position.y = 2.2;
  return sprite;
}

/**
 * Build the hooded/armored figure: cone robe, head, hood (or smith apron +
 * pads), role-accent trim ring, seer staff. ~1.7m tall.
 */
export function buildNpcVisual(npc: NpcDef): NpcVisual {
  const group = new THREE.Group();
  group.name = `npc:${npc.id}`;
  const accent = ROLE_ACCENT[npc.role];

  const clothMat = new THREE.MeshStandardMaterial({ color: CLOTH, roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: CLOTH_DARK, roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.35,
    roughness: 0.5,
    metalness: 0.3,
  });

  // Robe.
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.45, 7), clothMat);
  robe.position.y = 0.725;
  group.add(robe);

  // Waist trim.
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 6, 12), trimMat);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.88;
  group.add(trim);

  // Head.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 }),
  );
  head.position.y = 1.52;
  group.add(head);

  if (npc.role === 'smith') {
    // Apron + shoulder pads + headband instead of a hood.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.72, 0.07),
      new THREE.MeshStandardMaterial({ color: LEATHER, roughness: 0.95 }),
    );
    apron.position.set(0, 0.86, 0.3);
    group.add(apron);
    const padGeo = new THREE.BoxGeometry(0.18, 0.1, 0.22);
    const padMat = new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.5, metalness: 0.7 });
    const padL = new THREE.Mesh(padGeo, padMat);
    padL.position.set(-0.3, 1.32, 0);
    const padR = new THREE.Mesh(padGeo, padMat);
    padR.position.set(0.3, 1.32, 0);
    group.add(padL, padR);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 12), trimMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.56;
    group.add(band);
  } else {
    // Hood.
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.52, 7), darkMat);
    hood.position.y = 1.66;
    group.add(hood);
  }

  if (npc.role === 'seer') {
    // Staff topped with a glimmering shard.
    const staff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 1.7, 5),
      new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.9 }),
    );
    staff.position.set(0.42, 0.85, 0.1);
    group.add(staff);
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), trimMat);
    shard.position.set(0.42, 1.78, 0.1);
    group.add(shard);
  }

  group.add(buildNameplate(npc));

  const dispose = (): void => {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const material = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      } else if (obj instanceof THREE.Sprite) {
        const material = obj.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      }
    });
  };

  return { group, dispose };
}
