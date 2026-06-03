// pointer-lock.js - Desktop Pointer Lock + iOS Safari synthetic lock
// Branches on S.isTouchDevice. Mobile never calls requestPointerLock.

import S from './state.js';

function lock() {
  if (S.isTouchDevice) {
    S.controls.isLocked = true;
    S.controls._lockListeners.forEach(fn => fn());
  } else {
    document.body.requestPointerLock();
  }
}

function unlock() {
  if (S.isTouchDevice) {
    S.controls.isLocked = false;
    S.controls._unlockListeners.forEach(fn => fn());
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function initPointerLock() {
  const blocker = document.getElementById('blocker');
  const crosshair = document.getElementById('crosshair');
  const prompt = document.getElementById('interaction-prompt');
  const mobilePauseBtn = document.getElementById('mobile-pause-btn');
  const mobilePickupBtn = document.getElementById('mobile-pickup-btn');
  const inventoryPanel = document.getElementById('inventory-panel');

  // Blocker click/tap to enter
  blocker.addEventListener('click', () => {
    lock();
  });

  blocker.addEventListener('touchend', (e) => {
    e.preventDefault();
    lock();
  });

  // Desktop pointerlockchange
  document.addEventListener('pointerlockchange', () => {
    if (S.isTouchDevice) return; // Mobile uses synthetic state
    if (document.pointerLockElement) {
      S.controls.isLocked = true;
      S.controls._lockListeners.forEach(fn => fn());
    } else {
      S.controls.isLocked = false;
      S.controls._unlockListeners.forEach(fn => fn());
    }
  });

  // Mouse move for desktop look
  document.addEventListener('mousemove', (e) => {
    if (!S.controls.isLocked || S.isTouchDevice) return;
    const sens = S.settings.mouseSens;
    S.cameraYaw.rotation.y -= e.movementX * sens;
    S.cameraPitch.rotation.x -= e.movementY * sens;
    S.cameraPitch.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, S.cameraPitch.rotation.x));
  });

  // Lock listeners - show/hide UI
  S.controls.addEventListener('lock', () => {
    blocker.style.display = 'none';
    crosshair.style.display = 'block';
    if (S.isTouchDevice) {
      const el = document.documentElement;
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (rfs) rfs.call(el).catch(() => {});
      if (mobilePauseBtn) mobilePauseBtn.style.display = 'flex';
      if (mobilePickupBtn) mobilePickupBtn.style.display = 'flex';
      const lookZone = document.getElementById('look-zone');
      if (lookZone) lookZone.style.display = 'block';
      const joystick = document.getElementById('joystick-container');
      if (joystick) joystick.style.display = 'block';
      const sprintBtn = document.getElementById('mobile-sprint-btn');
      if (sprintBtn) sprintBtn.style.display = 'flex';
    }
  });

  S.controls.addEventListener('unlock', () => {
    blocker.style.display = 'flex';
    crosshair.style.display = 'none';
    if (prompt) prompt.style.display = 'none';
    if (S.isTouchDevice) {
      if (mobilePauseBtn) mobilePauseBtn.style.display = 'none';
      if (mobilePickupBtn) mobilePickupBtn.style.display = 'none';
      const lookZone = document.getElementById('look-zone');
      if (lookZone) lookZone.style.display = 'none';
      const joystick = document.getElementById('joystick-container');
      if (joystick) joystick.style.display = 'none';
      const sprintBtn = document.getElementById('mobile-sprint-btn');
      if (sprintBtn) sprintBtn.style.display = 'none';
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {});
      }
    }
    // Close inventory if open
    if (S.inventory.isOpen) {
      S.inventory.isOpen = false;
      inventoryPanel.classList.remove('open');
    }
  });

  // Mobile pause button
  if (mobilePauseBtn) {
    mobilePauseBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      unlock();
    });
  }

  // Keyboard for desktop unlock (Escape handled by pointer lock API)
  // Inventory toggle
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'KeyB') {
      if (S.controls.isLocked) {
        e.preventDefault();
        toggleInventory();
      }
    }
    if (e.code === 'Escape' && S.inventory.isOpen) {
      S.inventory.isOpen = false;
      inventoryPanel.classList.remove('open');
    }
  });

  // Mobile inventory button
  const invBtn = document.getElementById('mobile-inventory-btn');
  if (invBtn) {
    invBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleInventory();
    });
  }

  // Block context menu
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

function toggleInventory() {
  const inventoryPanel = document.getElementById('inventory-panel');
  S.inventory.isOpen = !S.inventory.isOpen;
  if (S.inventory.isOpen) {
    inventoryPanel.classList.add('open');
    renderInventory();
  } else {
    inventoryPanel.classList.remove('open');
  }
}

// Render inventory contents into the grid
function renderInventory() {
  const grid = document.getElementById('inventory-grid');
  if (!grid) return;
  const maxSlots = S.settings.maxSlots || 20;
  const items = S.inventory.items;

  grid.innerHTML = '';
  for (let i = 0; i < maxSlots; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (i < items.length) {
      const item = items[i];
      slot.title = item.name + '\n' + item.description;
      slot.innerHTML = `<div class="inv-item" style="border-color: ${item.color};">
        <div class="inv-item-icon" style="background: ${item.color};">${getIconChar(item.icon)}</div>
        <div class="inv-item-name">${item.name}</div>
      </div>`;
    }
    grid.appendChild(slot);
  }
}

function getIconChar(icon) {
  switch (icon) {
    case 'gem': return '\u25C6';
    case 'coin': return '\u25C9';
    case 'herb': return '\u2740';
    case 'key': return '\u26BF';
    case 'scroll': return '\u2B22';
    default: return '\u25CF';
  }
}

// Export for use by inventory module
window.__renderInventory = renderInventory;
window.__toggleInventory = toggleInventory;

export { initPointerLock, lock, unlock, renderInventory };
