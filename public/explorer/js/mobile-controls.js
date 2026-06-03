// mobile-controls.js - Virtual joystick + touch look zone
// Left side: joystick for movement. Right side: touch drag for camera look.

import S from './state.js';

let joystickBase, joystickThumb, lookZone;
let moveTouchId = null, lookTouchId = null;
let moveStartX = 0, moveStartY = 0;
let lookStartX = 0, lookStartY = 0;
const JOYSTICK_RADIUS = 50; // pixels from center

function initMobileControls() {
  joystickBase = document.getElementById('joystick-base');
  joystickThumb = document.getElementById('joystick-thumb');
  lookZone = document.getElementById('look-zone');

  S.joystickBase = joystickBase;
  S.joystickThumb = joystickThumb;
  S.lookZone = lookZone;

  if (!joystickBase || !lookZone) return;

  // -- Joystick (left side) --
  joystickBase.addEventListener('touchstart', onTouchMoveStart, { passive: false });
  joystickBase.addEventListener('touchmove', onTouchMoveMove, { passive: false });
  joystickBase.addEventListener('touchend', onTouchMoveEnd, { passive: false });
  joystickBase.addEventListener('touchcancel', onTouchMoveEnd, { passive: false });

  // -- Look zone (right side) --
  lookZone.addEventListener('touchstart', onTouchLookStart, { passive: false });
  lookZone.addEventListener('touchmove', onTouchLookMove, { passive: false });
  lookZone.addEventListener('touchend', onTouchLookEnd, { passive: false });
  lookZone.addEventListener('touchcancel', onTouchLookEnd, { passive: false });

  // -- Mobile sprint button --
  const sprintBtn = document.getElementById('mobile-sprint-btn');
  if (sprintBtn) {
    sprintBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      S.touchState.sprinting = true;
      sprintBtn.classList.add('active');
    });
    sprintBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      S.touchState.sprinting = false;
      sprintBtn.classList.remove('active');
    });
  }

  // -- Mobile pickup button --
  const pickupBtn = document.getElementById('mobile-pickup-btn');
  if (pickupBtn) {
    pickupBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__tryPickup && window.__tryPickup();
    });
  }
}

function onTouchMoveStart(e) {
  e.preventDefault();
  if (moveTouchId !== null) return;
  const t = e.changedTouches[0];
  moveTouchId = t.identifier;
  const rect = joystickBase.getBoundingClientRect();
  moveStartX = rect.left + rect.width / 2;
  moveStartY = rect.top + rect.height / 2;
}

function onTouchMoveMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== moveTouchId) continue;
    const dx = t.clientX - moveStartX;
    const dy = t.clientY - moveStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampDist = Math.min(dist, JOYSTICK_RADIUS);
    const angle = Math.atan2(dy, dx);
    const nx = Math.cos(angle) * clampDist;
    const ny = Math.sin(angle) * clampDist;

    joystickThumb.style.transform = `translate(${nx}px, ${ny}px)`;

    // Normalized -1..1
    S.touchState.moveX = nx / JOYSTICK_RADIUS;
    S.touchState.moveY = ny / JOYSTICK_RADIUS;
  }
}

function onTouchMoveEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier !== moveTouchId) continue;
    moveTouchId = null;
    joystickThumb.style.transform = 'translate(0, 0)';
    S.touchState.moveX = 0;
    S.touchState.moveY = 0;
  }
}

function onTouchLookStart(e) {
  e.preventDefault();
  if (lookTouchId !== null) return;
  const t = e.changedTouches[0];
  lookTouchId = t.identifier;
  lookStartX = t.clientX;
  lookStartY = t.clientY;
}

function onTouchLookMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== lookTouchId) continue;
    const dx = t.clientX - lookStartX;
    const dy = t.clientY - lookStartY;
    lookStartX = t.clientX;
    lookStartY = t.clientY;

    const mult = S.settings.touchLookMult || 0.008;
    S.cameraYaw.rotation.y -= dx * mult;
    S.cameraPitch.rotation.x -= dy * mult;
    S.cameraPitch.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, S.cameraPitch.rotation.x));
  }
}

function onTouchLookEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier !== lookTouchId) continue;
    lookTouchId = null;
  }
}

export { initMobileControls };
