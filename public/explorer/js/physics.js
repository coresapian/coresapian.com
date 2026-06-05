// physics.js - v3: Player movement, gravity, collision
// Wall collision: per-mesh AABB with height filtering (no merge, no raycasts)
// Ground detection: vertical raycast, all hits, lowest Y = floor

import S from './state.js';
import * as THREE from 'three';

// -- Raycaster for ground detection only --
const _downRaycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _downDir = new THREE.Vector3(0, -1, 0);

// Per-mesh bounding boxes (populated once after GLB loads)
let meshBoxes = []; // Array of { box: Box3, id }

// Stuck escape
let stuckFrames = 0;
const MAX_STUCK_FRAMES = 90;

/**
 * Build per-mesh AABB collision data.
 * No merging. Height filtering at query time prevents skeleton/ceiling from blocking.
 */
function buildCollisionBoxes() {
  meshBoxes = [];
  const bigBox = new THREE.Box3();
  const _v = new THREE.Vector3();

  for (let i = 0; i < S.collisionMeshes.length; i++) {
    const mesh = S.collisionMeshes[i];
    if (!mesh.geometry) continue;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    meshBoxes.push({ box, id: i });
    bigBox.union(box);
  }

  console.log(`[Physics] ${S.collisionMeshes.length} meshes -> ${meshBoxes.length} collision boxes (per-mesh, no merge)`);

  if (!bigBox.isEmpty()) {
    const size = bigBox.getSize(new THREE.Vector3());
    const center = bigBox.getCenter(new THREE.Vector3());
    console.log(`[Physics] Scene: ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}m, center=(${center.x.toFixed(1)},${center.y.toFixed(1)},${center.z.toFixed(1)})`);
    console.log(`[Physics] Floor Y=${bigBox.min.y.toFixed(2)}, Ceiling Y=${bigBox.max.y.toFixed(2)}`);

    S.sceneBounds = {
      min: { x: bigBox.min.x, y: bigBox.min.y, z: bigBox.min.z },
      max: { x: bigBox.max.x, y: bigBox.max.y, z: bigBox.max.z },
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z }
    };
  }
}

/**
 * Find floor Y below a point using multi-ray spread + multi-hit scanning.
 *
 * The skill (threejs-web-experiences) is explicit: multi-hit scanning alone
 * is insufficient when suspended geometry extends across all offset rays
 * (e.g. a wide skeleton pelvis). We cast rays at the center AND at offsets
 * in a small radius, then pick the lowest hit point across ALL rays and
 * ALL intersections per ray. This is the durable fix for "player spawns on
 * the dinosaur skeleton."
 */
function findFloor(ox, oy, oz, maxDrop, offsets) {
  // Default offsets: center only (preserves backward compatibility for
  // runtime ground detection that uses a tighter spread).
  const probeOffsets = offsets || [[0, 0]];
  let bestY = null;

  for (const [dx, dz] of probeOffsets) {
    _rayOrigin.set(ox + dx, oy, oz + dz);
    _downRaycaster.set(_rayOrigin, _downDir);
    _downRaycaster.far = maxDrop;

    const hits = _downRaycaster.intersectObjects(S.collisionMeshes, false);
    if (!hits.length) continue;

    // Scan ALL hits per ray — the closest is often the top of a suspended
    // object (skeleton, chandelier), not the floor.
    for (let i = 0; i < hits.length; i++) {
      const y = hits[i].point.y;
      if (bestY === null || y < bestY) bestY = y;
    }
  }
  return bestY;
}

/**
 * Snap player to ground on spawn.
 * Uses a 5-ray spread (center + 4 cardinals at 0.8m) so a single piece of
 * suspended geometry (skeleton, chandelier) doesn't snap the player on top
 * of it. See findFloor() docs.
 */
function snapToGround() {
  const pos = S.cameraYaw.position;
  const eyeH = S.settings.eyeHeight;
  if (!S.collisionMeshes.length) return;

  const offsets = [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]];
  const floorY = findFloor(pos.x, 50, pos.z, 100, offsets);
  if (floorY !== null) {
    pos.y = floorY + eyeH;
    S.onGround = true;
    S.floorY = floorY;
    console.log(`[Physics] Snap: player Y=${pos.y.toFixed(2)}, floor Y=${floorY.toFixed(2)}`);
  } else {
    console.warn('[Physics] No floor below spawn point');
  }
}

// Reusable vectors for wall check
const _playerBox = new THREE.Box3();
const _pMin = new THREE.Vector3();
const _pMax = new THREE.Vector3();

/**
 * Test if a position (x, z) collides with walls at the player's current height.
 * Uses per-mesh AABB with height filtering: only tests boxes that overlap
 * the player's vertical body range (feet to head).
 */
function isBlocked(x, z, radius) {
  const pos = S.cameraYaw.position;
  const eyeH = S.currentEyeHeight || S.settings.eyeHeight;

  // Player vertical range
  const pMinY = pos.y - eyeH;          // feet
  const pMaxY = pos.y + 0.3;            // top of head
  // Player horizontal range at (x, z)
  _pMin.set(x - radius, pMinY, z - radius);
  _pMax.set(x + radius, pMaxY, z + radius);
  _playerBox.set(_pMin, _pMax);

  for (let i = 0; i < meshBoxes.length; i++) {
    const mb = meshBoxes[i].box;
    // Height filter: skip boxes entirely above or below player body
    if (mb.max.y < pMinY || mb.min.y > pMaxY) continue;
    // Horizontal + vertical overlap test
    if (_playerBox.intersectsBox(mb)) return true;
  }
  return false;
}

/**
 * Main physics update. Called every animation frame.
 */
function updatePhysics(delta) {
  if (!S.controls.isLocked || !S.cameraYaw) return;

  const pos = S.cameraYaw.position;
  const dt = Math.min(delta, 0.1);
  const v = S.velocity;

  const sprinting = S.controls.sprint || S.touchState.sprinting;
  const speed = sprinting ? S.settings.sprintSpeed : S.settings.walkSpeed;

  // -- Movement input --
  let mx = 0, mz = 0;
  if (S.controls.moveForward) mz -= 1;
  if (S.controls.moveBackward) mz += 1;
  if (S.controls.moveLeft) mx -= 1;
  if (S.controls.moveRight) mx += 1;
  mx += S.touchState.moveX;
  mz += S.touchState.moveY;

  const ml = Math.sqrt(mx * mx + mz * mz);
  if (ml > 1) { mx /= ml; mz /= ml; }

  // Camera-relative movement
  const yaw = S.cameraYaw.rotation.y;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  v.x = (mx * cy + mz * sy) * speed;
  v.z = (-mx * sy + mz * cy) * speed;

  // Gravity + Jump
  v.y -= S.settings.gravity * dt;
  if (S.controls.jump && S.onGround) {
    v.y = S.settings.jumpVelocity;
    S.onGround = false;
  }

  const pr = (S.CFG.player && S.CFG.player.radius) || 0.4;
  const eh = S.currentEyeHeight || S.settings.eyeHeight;

  let nx = pos.x + v.x * dt;
  let ny = pos.y + v.y * dt;
  let nz = pos.z + v.z * dt;

  // -- Wall collision (per-mesh AABB + height filter) --
  if (meshBoxes.length > 0) {
    const hasMovement = Math.abs(nx - pos.x) > 0.001 || Math.abs(nz - pos.z) > 0.001;

    if (hasMovement) {
      const currentlyStuck = stuckFrames > MAX_STUCK_FRAMES;

      if (!currentlyStuck) {
        // Normal collision: test new position
        if (isBlocked(nx, nz, pr)) {
          // Try axis-aligned sliding
          const canX = !isBlocked(nx, pos.z, pr);
          const canZ = !isBlocked(pos.x, nz, pr);

          if (canX && !canZ) {
            nz = pos.z; v.z = 0;
          } else if (canZ && !canX) {
            nx = pos.x; v.x = 0;
          } else if (canX && canZ) {
            // Both axes free individually -- slide along dominant
            if (Math.abs(v.x) >= Math.abs(v.z)) { nz = pos.z; v.z = 0; }
            else { nx = pos.x; v.x = 0; }
          } else {
            // Fully blocked
            nx = pos.x; nz = pos.z; v.x = 0; v.z = 0;
          }
        }
        stuckFrames = 0;
      }
      // After MAX_STUCK_FRAMES: player escapes freely
    }
  }

  // -- Ground detection --
  // Runtime uses a tight 3-ray spread: center + two small offsets. This is
  // cheaper than the spawn-time 5-ray spread but still prevents the player
  // from snapping onto a narrow suspended object (e.g. a skeleton rib)
  // that only the center ray hits.
  if (S.collisionMeshes.length) {
    const rtOffsets = [[0, 0], [0.3, 0], [-0.3, 0]];
    const fy = findFloor(nx, ny + 0.1, nz, eh + 2.5, rtOffsets);
    if (fy !== null) {
      S.floorY = fy;
      if (ny - eh <= fy + 0.05) {
        ny = fy + eh;
        v.y = 0;
        S.onGround = true;
      } else {
        S.onGround = false;
      }
    } else {
      S.onGround = false;
      S.floorY = null;
    }
  }

  // Stuck counter
  const moved = Math.abs(nx - pos.x) > 0.001 || Math.abs(nz - pos.z) > 0.001;
  if (!moved && S.controls.isLocked && v.y >= -0.1) {
    stuckFrames++;
  } else if (moved) {
    stuckFrames = 0;
  }

  pos.x = nx;
  pos.y = ny;
  pos.z = nz;

  // Safety clamp
  if (pos.y < -100) {
    const sp = (S.CFG.spawn && S.CFG.spawn.position) || [0, 0, 0];
    pos.set(sp[0], sp[1] + eh, sp[2]);
    v.y = 0;
    S.onGround = true;
    stuckFrames = 0;
  }

  // Head bob
  const moving = ml > 0.1 && S.onGround;
  if (moving) {
    const bs = sprinting ? S.settings.headBobSpeed * 1.3 : S.settings.headBobSpeed;
    S.headBobTime += dt * bs;
    const ba = S.settings.headBobAmount * (sprinting ? 1.5 : 1.0);
    S.camera.position.y = S.currentEyeHeight + Math.sin(S.headBobTime) * ba;
  } else {
    S.headBobTime = 0;
    S.camera.position.y += (S.currentEyeHeight - S.camera.position.y) * 5 * dt;
  }
}

export { updatePhysics, buildCollisionBoxes, snapToGround };
