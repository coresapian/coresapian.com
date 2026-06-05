// scene-objects.js - Load hintze_hall.glb environment + spawn pickable items
// Keeps original PBR materials for realistic lighting. Spawns floating collectibles.

import S from './state.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let environmentLoaded = false;

function loadEnvironment() {
  const loader = new GLTFLoader();
  const modelPath = (S.CFG.environment && S.CFG.environment.model) || 'hintze_hall.glb';

  return new Promise((resolve) => {
    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;
        const convertToBasic = (S.CFG.environment && S.CFG.environment.convert_to_basic) === true;

        model.traverse((child) => {
          if (child.isMesh) {
            // Register for collision raycasting
            S.collisionMeshes.push(child);

            if (convertToBasic && child.material) {
              // Only convert if explicitly requested (for baked-lightmap models)
              const oldMat = child.material;
              const newMat = new THREE.MeshBasicMaterial({
                map: oldMat.map || null,
                color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff),
                side: oldMat.side || THREE.FrontSide,
                transparent: oldMat.transparent || false,
                opacity: oldMat.opacity !== undefined ? oldMat.opacity : 1.0,
              });
              if (oldMat.map && oldMat.map.offset) {
                newMat.map.offset.copy(oldMat.map.offset);
                newMat.map.repeat.copy(oldMat.map.repeat);
              }
              child.material = newMat;
              oldMat.dispose();
            } else {
              // Keep PBR materials but ensure they receive light properly
              if (child.material) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            }
          }
        });

        S.scene.add(model);
        S.environmentGroup = model;
        environmentLoaded = true;

        // Log bounding box for spawn calibration
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        console.log(`Model bounds: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}m, center: (${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)})`);
        console.log(`Model floor Y: ${box.min.y.toFixed(2)}, ceiling Y: ${box.max.y.toFixed(2)}`);

        // Update loading UI
        const statusEl = document.getElementById('loading-status');
        if (statusEl) statusEl.textContent = 'Environment loaded. Spawning items...';

        resolve();
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          const statusEl = document.getElementById('loading-status');
          if (statusEl) statusEl.textContent = `Loading environment... ${pct}%`;
          const fillEl = document.getElementById('loading-fill');
          if (fillEl) fillEl.style.width = pct + '%';
        }
      },
      (error) => {
        console.error('Failed to load environment GLB:', error);
        const statusEl = document.getElementById('loading-status');
        if (statusEl) statusEl.textContent = 'Failed to load environment. Check console.';
        resolve();
      }
    );
  });
}

function spawnPickableItems() {
  const items = (S.CFG.pickable_items) || [];
  items.forEach((itemConfig) => {
    const mesh = createPickableMesh(itemConfig);
    if (!mesh) return;

    mesh.position.set(
      itemConfig.position[0],
      itemConfig.position[1],
      itemConfig.position[2]
    );
    mesh.scale.setScalar(itemConfig.scale || 0.3);

    // Add point light to make it glow
    const light = new THREE.PointLight(
      new THREE.Color(itemConfig.color || '#ffffff'),
      0.5,
      5
    );
    light.position.set(0, 0, 0);
    mesh.add(light);

    // NOTE: Pickable items are NOT pushed into S.collisionMeshes.
    // They are floating collectibles — wall collision against them would trap
    // the player in doorways or block corridors. Pickup is via center-screen
    // raycast in interaction.js, which traverses each item's meshes directly.

    S.scene.add(mesh);

    S.pickableItems.push({
      id: itemConfig.id,
      name: itemConfig.name,
      description: itemConfig.description,
      icon: itemConfig.icon,
      color: itemConfig.color,
      mesh: mesh,
      meshes: (() => {
        // Cache all child meshes once for fast raycasting in interaction.js
        const arr = [];
        mesh.traverse((child) => { if (child.isMesh) arr.push(child); });
        return arr;
      })(),
      config: itemConfig,
      baseY: itemConfig.position[1],
      collected: false
    });
  });
}

function createPickableMesh(config) {
  const color = new THREE.Color(config.color || '#ffffff');
  const emissive = new THREE.Color(config.emissive || '#000000');
  const mat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: emissive,
    emissiveIntensity: 0.8,
    metalness: 0.3,
    roughness: 0.4,
  });

  let geometry;
  switch (config.shape) {
    case 'octahedron':
      geometry = new THREE.OctahedronGeometry(0.5, 0);
      break;
    case 'dodecahedron':
      geometry = new THREE.DodecahedronGeometry(0.5, 0);
      break;
    case 'icosahedron':
      geometry = new THREE.IcosahedronGeometry(0.5, 0);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(0.35, 0.12, 8, 16);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.4, 16, 16);
      break;
    case 'cube':
      geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      break;
    default:
      geometry = new THREE.OctahedronGeometry(0.5, 0);
  }

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = true;

  // Outer glow ring
  const glowMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  });
  const glowRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 16), glowMat);
  glowRing.rotation.x = -Math.PI / 2;
  glowRing.position.y = -0.3;
  mesh.add(glowRing);

  return mesh;
}

function updatePickableItems(time) {
  S.pickableItems.forEach((item) => {
    if (item.collected) return;
    const cfg = item.config;
    const floatAmp = cfg.float_amplitude || 0.15;
    const floatSpd = cfg.float_speed || 2.0;
    const rotSpd = cfg.rotation_speed || 1.5;

    item.mesh.position.y = item.baseY + Math.sin(time * floatSpd) * floatAmp;
    item.mesh.rotation.y += rotSpd * 0.016;
    item.mesh.rotation.x += rotSpd * 0.005;
  });
}

export { loadEnvironment, spawnPickableItems, updatePickableItems };
