// interaction.js - Raycast-based pickup system
// Casts from camera center, highlights items in range, picks up on E key or tap.

import S from './state.js';
import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0); // Screen center for raycasting

function initInteraction() {
  S.interactionRaycaster = _raycaster;

  // E key pickup
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && S.controls.isLocked) {
      tryPickup();
    }
  });

  // Expose for mobile pickup button
  window.__tryPickup = tryPickup;
}

function updateInteraction() {
  if (!S.controls.isLocked || !S.camera) return;

  const promptEl = document.getElementById('interaction-prompt');
  const mobilePickupBtn = document.getElementById('mobile-pickup-btn');
  const pickupRange = S.settings.pickupRange || 3.0;

  // Get all uncollected item meshes
  const targets = S.pickableItems
    .filter(item => !item.collected)
    .map(item => item.mesh);

  if (targets.length === 0) {
    if (promptEl) promptEl.style.display = 'none';
    S.highlightedItem = null;
    return;
  }

  // Raycast from camera center
  _raycaster.setFromCamera(_center, S.camera);
  _raycaster.far = pickupRange;

  // Check each item's meshes (cached at spawn time to avoid per-frame traverse)
  let closestItem = null;
  let closestDist = pickupRange;

  for (const item of S.pickableItems) {
    if (item.collected) continue;
    // item.meshes is the cached list from spawnPickableItems; fall back to
    // traverse for items created elsewhere.
    const meshes = item.meshes || [];
    if (meshes.length === 0) continue;
    const hits = _raycaster.intersectObjects(meshes, false);
    if (hits.length > 0 && hits[0].distance < closestDist) {
      closestDist = hits[0].distance;
      closestItem = item;
    }
  }

  // Update highlight
  if (S.highlightedItem && S.highlightedItem !== closestItem) {
    unhighlightItem(S.highlightedItem);
  }

  if (closestItem) {
    highlightItem(closestItem);
    S.highlightedItem = closestItem;
    if (promptEl) {
      promptEl.style.display = 'block';
      promptEl.innerHTML = `<span class="prompt-name">${closestItem.name}</span> <span class="prompt-key">${S.isTouchDevice ? '[PICK UP]' : '[E]'}</span>`;
    }
  } else {
    S.highlightedItem = null;
    if (promptEl) promptEl.style.display = 'none';
  }
}

function highlightItem(item) {
  item.mesh.traverse((child) => {
    if (child.isMesh && child.material && child.material.emissiveIntensity !== undefined) {
      child.material._origEmissiveIntensity = child.material.emissiveIntensity;
      child.material.emissiveIntensity = 1.5;
    }
  });
  // Scale pulse
  item.mesh.scale.setScalar((item.config.scale || 0.3) * 1.15);
}

function unhighlightItem(item) {
  item.mesh.traverse((child) => {
    if (child.isMesh && child.material && child.material._origEmissiveIntensity !== undefined) {
      child.material.emissiveIntensity = child.material._origEmissiveIntensity;
      delete child.material._origEmissiveIntensity;
    }
  });
  item.mesh.scale.setScalar(item.config.scale || 0.3);
}

function tryPickup() {
  const item = S.highlightedItem;
  if (!item || item.collected) return;

  // Check inventory space
  const maxSlots = S.settings.maxSlots || 20;
  if (S.inventory.items.length >= maxSlots) {
    const promptEl = document.getElementById('interaction-prompt');
    if (promptEl) {
      promptEl.innerHTML = '<span class="prompt-full">Inventory full!</span>';
      setTimeout(() => { if (promptEl) promptEl.style.display = 'none'; }, 1500);
    }
    return;
  }

  // Collect item
  item.collected = true;
  S.scene.remove(item.mesh);

  // Remove from collision meshes
  item.mesh.traverse((child) => {
    if (child.isMesh) {
      const idx = S.collisionMeshes.indexOf(child);
      if (idx !== -1) S.collisionMeshes.splice(idx, 1);
    }
  });

  // Add to inventory
  S.inventory.items.push({
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    color: item.color
  });

  S.highlightedItem = null;

  // Hide prompt
  const promptEl = document.getElementById('interaction-prompt');
  if (promptEl) {
    promptEl.innerHTML = `<span class="prompt-picked">Picked up ${item.name}!</span>`;
    setTimeout(() => { if (promptEl) promptEl.style.display = 'none'; }, 1500);
  }

  // Update bag count
  updateBagCount();

  // Refresh inventory if open
  if (S.inventory.isOpen && window.__renderInventory) {
    window.__renderInventory();
  }
}

function updateBagCount() {
  const countEl = document.getElementById('bag-count');
  if (countEl) {
    countEl.textContent = S.inventory.items.length;
  }
}

export { initInteraction, updateInteraction };
