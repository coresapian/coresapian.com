// main.js - Orchestrator: init scene, load config, run animation loop

import * as THREE from 'three';

import S from './state.js';
import { loadConfig } from './config.js';
import { initPointerLock } from './pointer-lock.js';
import { initMobileControls } from './mobile-controls.js';
import { updatePhysics, buildCollisionBoxes, snapToGround } from './physics.js';
import { loadEnvironment, spawnPickableItems, updatePickableItems } from './scene-objects.js';
import { initInteraction, updateInteraction } from './interaction.js';
import { initDevMode, updateDevMode } from './devmode.js';

async function init() {
  // Detect device
  S.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  S.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || S.isTouchDevice;

  // Load config
  await loadConfig();

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('container').appendChild(renderer.domElement);
  S.renderer = renderer;

  // Scene
  const scene = new THREE.Scene();
  const bgColor = (S.CFG.environment && S.CFG.environment.background_color) || '#1a1a2e';
  scene.background = new THREE.Color(bgColor);
  S.scene = scene;

  // Fog
  if ((S.CFG.fog && S.CFG.fog.enabled) !== false) {
    const fogColor = (S.CFG.fog && S.CFG.fog.color) || bgColor;
    const fogDensity = (S.CFG.fog && S.CFG.fog.density) || 0.008;
    scene.fog = new THREE.FogExp2(new THREE.Color(fogColor), fogDensity);
  }

  // Camera rig
  const cameraYaw = new THREE.Group();
  const cameraPitch = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

  cameraYaw.add(cameraPitch);
  cameraPitch.add(camera);
  scene.add(cameraYaw);

  S.camera = camera;
  S.cameraYaw = cameraYaw;
  S.cameraPitch = cameraPitch;

  // Spawn position (temporary, will be adjusted by ground snap)
  const spawnPos = (S.CFG.spawn && S.CFG.spawn.position) || [0, 0, 0];
  cameraYaw.position.set(spawnPos[0], spawnPos[1] + S.settings.eyeHeight + 5, spawnPos[2]);
  cameraYaw.rotation.y = (S.CFG.spawn && S.CFG.spawn.yaw) || 0;
  camera.position.y = S.settings.eyeHeight;

  // Lighting
  // Ambient
  const ambientIntensity = (S.CFG.environment && S.CFG.environment.ambient_intensity) || 0.5;
  scene.add(new THREE.AmbientLight(0xffffff, ambientIntensity));

  // Hemisphere
  const hemiSky = (S.CFG.environment && S.CFG.environment.hemisphere_sky_color) || '#ffeedd';
  const hemiGround = (S.CFG.environment && S.CFG.environment.hemisphere_ground_color) || '#222244';
  const hemiIntensity = (S.CFG.environment && S.CFG.environment.hemisphere_intensity) || 0.6;
  scene.add(new THREE.HemisphereLight(hemiSky, hemiGround, hemiIntensity));

  // Config point lights
  const lights = (S.CFG.lights) || [];
  lights.forEach((lcfg) => {
    const light = new THREE.PointLight(
      new THREE.Color(lcfg.color || '#ffffff'),
      lcfg.intensity || 1.0,
      lcfg.distance || 25
    );
    if (lcfg.position) light.position.set(lcfg.position[0], lcfg.position[1], lcfg.position[2]);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    scene.add(light);
  });

  // Clock
  S.clock = new THREE.Clock();

  // Pointer lock
  initPointerLock();

  // Mobile controls
  if (S.isTouchDevice) {
    initMobileControls();
  }

  // Interaction
  initInteraction();

  // Keyboard
  initKeyboard();

  // Window resize
  window.addEventListener('resize', onResize);

  // Load environment
  updateLoadingStatus('Loading environment...');
  await loadEnvironment();

  // Build collision boxes from loaded meshes
  updateLoadingStatus('Building collision data...');
  buildCollisionBoxes();

  // Snap player to ground
  snapToGround();

  // Spawn collectible items
  spawnPickableItems();
  initDevMode();
  updateLoadingStatus('Ready! Click to explore.');

  // Hide loading, show blocker
  const loadingEl = document.getElementById('loading-overlay');
  if (loadingEl) loadingEl.style.display = 'none';
  const blocker = document.getElementById('blocker');
  if (blocker) blocker.style.display = 'flex';

  // Start loop
  S.loaded = true;
  animate();
}

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!S.controls.isLocked && !['Tab', 'KeyB', 'KeyE'].includes(e.code)) return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') { S.controls.moveForward = true; e.preventDefault(); }
    if (e.code === 'KeyS' || e.code === 'ArrowDown') { S.controls.moveBackward = true; e.preventDefault(); }
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') { S.controls.moveLeft = true; e.preventDefault(); }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') { S.controls.moveRight = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') S.controls.sprint = true;
    if (e.code === 'Space') { S.controls.jump = true; e.preventDefault(); }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') S.controls.moveForward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') S.controls.moveBackward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') S.controls.moveLeft = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') S.controls.moveRight = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') S.controls.sprint = false;
    if (e.code === 'Space') S.controls.jump = false;
  });
}

function animate() {
  S.animFrameId = requestAnimationFrame(animate);

  const delta = S.clock.getDelta();
  const elapsed = S.clock.getElapsedTime();

  updatePhysics(delta);
  updatePickableItems(elapsed);
  updateInteraction();
  updateDevMode();

  S.renderer.render(S.scene, S.camera);
}

function onResize() {
  if (!S.camera || !S.renderer) return;
  S.camera.aspect = window.innerWidth / window.innerHeight;
  S.camera.updateProjectionMatrix();
  S.renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateLoadingStatus(text) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = text;
}

// Boot
init().catch((e) => {
  console.error('Init failed:', e);
  updateLoadingStatus('Error: ' + e.message);
});
