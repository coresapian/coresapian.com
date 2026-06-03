// devmode.js - Developer/debug overlay
// Activated by ?dev or ?debug URL parameter
// FPS counter, position, wireframe toggle, collision viz, teleport, floor map export

import S from './state.js';
import * as THREE from 'three';

let overlay = null;
let fpsEl = null;
let posEl = null;
let floorEl = null;
let meshCountEl = null;
let wireframe = false;
let showCollision = false;
let collisionHelpers = [];
let frameTimes = [];
let currentFps = 0;

export function isDevMode() {
  const params = new URLSearchParams(window.location.search);
  return params.has('dev') || params.has('debug');
}

export function initDevMode() {
  if (!isDevMode()) return;

  S.devMode = true;
  createOverlay();
  initKeyboard();
  console.log('[DEV] Developer mode enabled');
  console.log('[DEV] Keys: F3=Wireframe F4=Colliders F5=ResetPos');

  // Log model bounds if already loaded
  if (S.sceneBounds) logBounds();
}

function logBounds() {
  const b = S.sceneBounds;
  console.log(`[DEV] Bounds: ${b.size.x.toFixed(1)}x${b.size.y.toFixed(1)}x${b.size.z.toFixed(1)}m`);
  console.log(`[DEV] Center: (${b.center.x.toFixed(1)}, ${b.center.y.toFixed(1)}, ${b.center.z.toFixed(1)})`);
  console.log(`[DEV] Floor Y=${b.min.y.toFixed(2)}, Ceiling Y=${b.max.y.toFixed(2)}`);

  // Suggest safe spawn points (center of each quadrant)
  const cx = b.center.x, cz = b.center.z, fy = b.min.y;
  const hx = b.size.x * 0.25, hz = b.size.z * 0.25;
  console.log(`[DEV] Suggested spawn points (floor Y=${fy.toFixed(2)}):`);
  console.log(`  Near-center: [${cx.toFixed(1)}, ${fy.toFixed(1)}, ${cz.toFixed(1)}]`);
  console.log(`  +X+Z quadrant: [${(cx + hx).toFixed(1)}, ${fy.toFixed(1)}, ${(cz + hz).toFixed(1)}]`);
  console.log(`  -X-Z quadrant: [${(cx - hx).toFixed(1)}, ${fy.toFixed(1)}, ${(cz - hz).toFixed(1)}]`);
  console.log(`  +X-Z quadrant: [${(cx + hx).toFixed(1)}, ${fy.toFixed(1)}, ${(cz - hz).toFixed(1)}]`);
  console.log(`  -X+Z quadrant: [${(cx - hx).toFixed(1)}, ${fy.toFixed(1)}, ${(cz + hz).toFixed(1)}]`);
}

// ── Overlay UI ──────────────────────────────────────────────────────────────

function createOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'dev-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '10px', right: '10px',
    background: 'rgba(0,0,0,0.85)', color: '#0f0',
    fontFamily: '"SF Mono","Fira Code",monospace', fontSize: '12px',
    padding: '12px 16px', borderRadius: '8px',
    zIndex: '999', pointerEvents: 'none',
    lineHeight: '1.7', minWidth: '260px',
    border: '1px solid rgba(0,255,0,0.15)',
    userSelect: 'none', webkitUserSelect: 'none',
  });

  // Title
  const title = document.createElement('div');
  title.textContent = 'DEV MODE';
  title.style.cssText = 'font-weight:bold; margin-bottom:6px; color:#0f0; letter-spacing:0.1em;';
  overlay.appendChild(title);

  // Stats
  fpsEl = mkDiv('FPS: --');
  posEl = mkDiv('Pos: --');
  floorEl = mkDiv('Floor: --');
  meshCountEl = mkDiv('Meshes: --');

  overlay.appendChild(fpsEl);
  overlay.appendChild(posEl);
  overlay.appendChild(floorEl);
  overlay.appendChild(meshCountEl);

  // Separator
  overlay.appendChild(mkDiv('', 'border-top:1px solid rgba(0,255,0,0.15); margin:8px 0;'));

  // Teleport input
  const tpLabel = mkDiv('Teleport x,y,z:', 'color:#888; font-size:11px;');
  overlay.appendChild(tpLabel);

  const tpInput = document.createElement('input');
  tpInput.type = 'text';
  tpInput.placeholder = '20, 0, 20';
  Object.assign(tpInput.style, {
    width: '100%', background: 'rgba(0,0,0,0.6)',
    border: '1px solid #333', color: '#0f0',
    padding: '4px 8px', fontFamily: 'monospace',
    fontSize: '12px', borderRadius: '3px',
    marginTop: '4px', outline: 'none',
    pointerEvents: 'auto',
  });
  tpInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.key === 'Enter') {
      const parts = tpInput.value.split(',').map(s => parseFloat(s.trim()));
      if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
        if (parts.length === 2) teleportTo(parts[0], 0, parts[1]);
        else teleportTo(parts[0], parts[1], parts[2]);
      }
    }
  });
  tpInput.addEventListener('keyup', (e) => e.stopPropagation());
  overlay.appendChild(tpInput);

  // Buttons
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' });

  btnRow.appendChild(mkBtn('Wire [F3]', toggleWireframe));
  btnRow.appendChild(mkBtn('Coll [F4]', toggleCollisionViz));
  btnRow.appendChild(mkBtn('Reset [F5]', resetPosition));
  btnRow.appendChild(mkBtn('Floor Map', exportFloorMap));
  overlay.appendChild(btnRow);

  // Shortcuts
  const hint = mkDiv('F3=Wire F4=Colliders F5=Reset', 'margin-top:8px; color:#555; font-size:10px;');
  overlay.appendChild(hint);

  document.body.appendChild(overlay);
}

function mkDiv(text, extraStyle) {
  const d = document.createElement('div');
  d.textContent = text;
  if (extraStyle) d.style.cssText = extraStyle;
  return d;
}

function mkBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  Object.assign(btn.style, {
    background: 'rgba(0,0,0,0.5)', border: '1px solid #444',
    color: '#0f0', padding: '3px 8px', fontFamily: 'monospace',
    fontSize: '11px', borderRadius: '3px', cursor: 'pointer',
    pointerEvents: 'auto',
  });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  btn.addEventListener('touchstart', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't fire if typing in input
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'F3') { e.preventDefault(); toggleWireframe(); }
    if (e.code === 'F4') { e.preventDefault(); toggleCollisionViz(); }
    if (e.code === 'F5') { e.preventDefault(); resetPosition(); }
  });
}

// ── Wireframe toggle ────────────────────────────────────────────────────────

function toggleWireframe() {
  wireframe = !wireframe;
  if (S.environmentGroup) {
    S.environmentGroup.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.wireframe = wireframe);
        } else {
          child.material.wireframe = wireframe;
        }
      }
    });
  }
  console.log(`[DEV] Wireframe: ${wireframe}`);
}

// ── Collision visualization ─────────────────────────────────────────────────

function toggleCollisionViz() {
  showCollision = !showCollision;
  if (showCollision) buildCollisionViz();
  else clearCollisionViz();
  console.log(`[DEV] Collision viz: ${showCollision}`);
}

function buildCollisionViz() {
  clearCollisionViz();
  if (!S.collisionMeshes.length) return;

  // Sample subset to avoid killing perf (thousands of boxes = crash)
  const maxShow = 300;
  const step = Math.max(1, Math.floor(S.collisionMeshes.length / maxShow));
  let shown = 0;

  for (let i = 0; i < S.collisionMeshes.length && shown < maxShow; i += step) {
    const mesh = S.collisionMeshes[i];
    if (!mesh.geometry) continue;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;

    const helper = new THREE.Box3Helper(box, 0x00ff44);
    helper.userData.isDevHelper = true;
    S.scene.add(helper);
    collisionHelpers.push(helper);
    shown++;
  }
  console.log(`[DEV] Showing ${shown} collision boxes (of ${S.collisionMeshes.length}, step=${step})`);
}

function clearCollisionViz() {
  for (const h of collisionHelpers) S.scene.remove(h);
  collisionHelpers = [];
}

// ── Teleport ────────────────────────────────────────────────────────────────

function resetPosition() {
  const sp = (S.CFG.spawn && S.CFG.spawn.position) || [20, 0, 20];
  teleportTo(sp[0], sp[1], sp[2]);
}

function teleportTo(x, y, z) {
  if (!S.cameraYaw || !S.collisionMeshes.length) return;
  const eyeH = S.currentEyeHeight || S.settings.eyeHeight;

  // Find floor at target
  const rc = new THREE.Raycaster();
  rc.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  rc.far = 100;
  const hits = rc.intersectObjects(S.collisionMeshes, false);

  let floorY = y;
  if (hits.length > 0) {
    floorY = hits[0].point.y;
    for (let i = 1; i < hits.length; i++) {
      if (hits[i].point.y < floorY) floorY = hits[i].point.y;
    }
  }

  S.cameraYaw.position.set(x, floorY + eyeH, z);
  S.velocity.x = 0;
  S.velocity.y = 0;
  S.velocity.z = 0;
  S.floorY = floorY;
  S.onGround = true;
  console.log(`[DEV] Teleported to (${x.toFixed(1)}, ${floorY.toFixed(1)}, ${z.toFixed(1)})`);
}

// ── Floor map export ────────────────────────────────────────────────────────

function exportFloorMap() {
  if (!S.collisionMeshes.length || !S.sceneBounds) {
    console.warn('[DEV] No scene data for floor map');
    return;
  }

  console.log('[DEV] Generating floor height map (this may take a moment)...');
  const b = S.sceneBounds;
  const rc = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);

  const step = 2; // 2m grid
  const results = [];

  for (let x = b.min.x; x <= b.max.x; x += step) {
    for (let z = b.min.z; z <= b.max.z; z += step) {
      origin.set(x, b.max.y + 5, z);
      rc.set(origin, down);
      rc.far = b.size.y + 20;
      const hits = rc.intersectObjects(S.collisionMeshes, false);

      let floorY = null;
      if (hits.length > 0) {
        floorY = hits[0].point.y;
        for (let i = 1; i < hits.length; i++) {
          if (hits[i].point.y < floorY) floorY = hits[i].point.y;
        }
      }

      results.push({
        x: +x.toFixed(1),
        z: +z.toFixed(1),
        floorY: floorY !== null ? +floorY.toFixed(2) : null
      });
    }
  }

  // Summary
  const withFloor = results.filter(r => r.floorY !== null);
  const yValues = withFloor.map(r => r.floorY);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  console.log(`[DEV] Floor map: ${results.length} points, ${withFloor.length} with floor`);
  console.log(`[DEV] Floor range: ${minY.toFixed(2)} to ${maxY.toFixed(2)}`);

  // Print first 30 valid points as table for quick inspection
  console.table(withFloor.slice(0, 30));

  // Download as JSON
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hintze_hall_floor_map.json';
  a.click();
  URL.revokeObjectURL(url);
  console.log('[DEV] Floor map downloaded as hintze_hall_floor_map.json');
}

// ── Per-frame update ────────────────────────────────────────────────────────

export function updateDevMode() {
  if (!S.devMode || !S.cameraYaw) return;

  // FPS (rolling 1-second window)
  const now = performance.now();
  frameTimes.push(now);
  while (frameTimes.length > 0 && frameTimes[0] < now - 1000) {
    frameTimes.shift();
  }
  currentFps = frameTimes.length;

  // Position
  const pos = S.cameraYaw.position;
  const eyeH = S.currentEyeHeight || S.settings.eyeHeight;

  fpsEl.textContent = `FPS: ${currentFps}`;
  fpsEl.style.color = currentFps < 25 ? '#f44' : currentFps < 50 ? '#ff0' : '#0f0';

  posEl.textContent = `Pos: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
  floorEl.textContent = `Floor: ${S.floorY !== null ? S.floorY.toFixed(2) : '--'} | Feet: ${(pos.y - eyeH).toFixed(2)}`;
  meshCountEl.textContent = `Meshes: ${S.collisionMeshes.length} | Yaw: ${(S.cameraYaw.rotation.y * 180 / Math.PI).toFixed(0)}\u00B0`;
}
