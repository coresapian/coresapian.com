// ============================================================================
// CORESAPIAN — src/pages/Home.tsx (design/home.md — S1…S9)
// The landing page: WebGL portal hero, realm marquee, pinned saga story,
// nine-realm grid, systems showcase, multiplayer teaser, bestiary strip,
// changelog terminal, waystone CTA.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as THREE from 'three';

import { BUILD_VERSION } from '@/lib/buildInfo';
import { useServerStatus } from '@/lib/useServerStatus';
import { useGlyphScramble } from '@/lib/useGlyphScramble';
import { useInView } from '@/lib/useInView';

gsap.registerPlugin(ScrollTrigger);

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface RealmCard {
  id: string;
  rune: string;
  name: string;
  epithet: string;
  threat: number;
  magic: number;
  terrain: number;
  accent: string;
  accentRgb: string;
}

const REALM_CARDS: RealmCard[] = [
  { id: 'midgard', rune: 'ᛗ', name: 'Midgard', epithet: 'The Mist-Girdled World', threat: 3, magic: 4, terrain: 5, accent: 'var(--realm-midgard)', accentRgb: 'var(--realm-midgard-rgb)' },
  { id: 'jotunheim', rune: 'ᛁ', name: 'Jötunheim', epithet: 'Where Mountains Walk', threat: 6, magic: 5, terrain: 8, accent: 'var(--realm-jotunheim)', accentRgb: 'var(--realm-jotunheim-rgb)' },
  { id: 'niflheim', rune: 'ᚾ', name: 'Niflheim', epithet: 'Mist Before Memory', threat: 5, magic: 8, terrain: 7, accent: 'var(--realm-niflheim)', accentRgb: 'var(--realm-niflheim-rgb)' },
  { id: 'muspelheim', rune: 'ᛋ', name: 'Muspelheim', epithet: 'The First Fire', threat: 8, magic: 7, terrain: 6, accent: 'var(--realm-muspelheim)', accentRgb: 'var(--realm-muspelheim-rgb)' },
  { id: 'alfheim', rune: 'ᚨ', name: 'Alfheim', epithet: 'Light Unspent', threat: 4, magic: 9, terrain: 4, accent: 'var(--realm-alfheim)', accentRgb: 'var(--realm-alfheim-rgb)' },
  { id: 'svartalfheim', rune: 'ᛊ', name: 'Svartalfheim', epithet: 'The Forge Below', threat: 6, magic: 8, terrain: 5, accent: 'var(--realm-svartalfheim)', accentRgb: 'var(--realm-svartalfheim-rgb)' },
  { id: 'vanaheim', rune: 'ᚹ', name: 'Vanaheim', epithet: 'The Green Wild', threat: 5, magic: 6, terrain: 6, accent: 'var(--realm-vanaheim)', accentRgb: 'var(--realm-vanaheim-rgb)' },
  { id: 'asgard', rune: 'ᛖ', name: 'Asgard', epithet: 'The Golden Perch', threat: 7, magic: 8, terrain: 3, accent: 'var(--realm-asgard)', accentRgb: 'var(--realm-asgard-rgb)' },
  { id: 'helheim', rune: 'ᚺ', name: 'Helheim', epithet: 'The Pale Gate', threat: 9, magic: 6, terrain: 8, accent: 'var(--realm-helheim)', accentRgb: 'var(--realm-helheim-rgb)' },
];

const SYSTEMS = [
  {
    title: 'COMBAT',
    img: '/weapon-axe.jpg',
    caption: 'ARSENAL.LOG — BEARDED WAR-AXE, ᚦ-ETCHED',
    body: 'Feel every blow. Physics-driven melee — axes, swords, hammers — shield parries, drawn bows, and stagger states. Your stamina is your life.',
    bullets: ['ᚦ Directional melee arcs & shield parry', 'ᛒ Bows with draw-weight & drop', 'ᚺ Server-authoritative hit resolution'],
    link: { to: '/progression', label: 'READ THE SAGA →' },
  },
  {
    title: 'RUNE MAGIC',
    img: '/class-galdr.jpg',
    caption: 'GALDR.LOG — FOUR SCHOOLS OF THE WYRD',
    body: "Four schools carved from the world's bones: Íss, Eldr, Vindr, Jörð. Cast with one hand, axe in the other.",
    bullets: ['ᛁ Íss — freeze, ward, shatter', 'ᛖ Eldr — burn, brand, ignite', 'ᚹᛃ Vindr & Jörð — storm and stone'],
    link: { to: '/progression', label: 'READ THE SAGA →' },
  },
  {
    title: 'PROGRESSION',
    img: '/class-hersir.jpg',
    caption: 'SAGA.LOG — THREE PATHS, ONE WANDERER',
    body: 'Three paths, one wanderer. Hersir, Galdr, Skáld — deep skill trees, crafted gear, realm-touched abilities.',
    bullets: ['ᚺ Three branching skill trees', 'ᛟ Crafting at dwarven forges', 'ᛗ Nine realm abilities to earn'],
    link: { to: '/progression', label: 'READ THE SAGA →' },
  },
  {
    title: 'THE LIVING WORLD',
    img: '/event-bloodmoon.jpg',
    caption: 'EVENT.LOG — BLOOD MOON RISING',
    body: 'Blood moons rise. Warbands roam. World bosses tear through the veil on a schedule only the Norns know.',
    bullets: ['ᚱ Roaming enemy warbands', 'ᚲ Procedural resource nodes', 'ᚷ Scheduled world bosses'],
    link: { to: '/multiplayer', label: 'SEE THE SHARED WORLD →' },
  },
];

const BESTIARY = [
  { id: 'draugr', img: '/bestiary-draugr.jpg', name: 'Draugr', cls: 'UNDEAD · MELEE', threat: 2, accentRgb: 'var(--realm-midgard-rgb)' },
  { id: 'wolf', img: '/bestiary-wolf.jpg', name: 'Frost Vargr', cls: 'BEAST · PACK', threat: 2, accentRgb: 'var(--realm-jotunheim-rgb)' },
  { id: 'troll', img: '/bestiary-troll.jpg', name: 'Mountain Troll', cls: 'GIANT-KIN · CRUSHER', threat: 3, accentRgb: 'var(--realm-jotunheim-rgb)' },
  { id: 'valkyrie', img: '/bestiary-valkyrie.jpg', name: 'Fallen Valkyrie', cls: 'DIVINE · DUELIST', threat: 4, accentRgb: 'var(--realm-asgard-rgb)' },
  { id: 'giant', img: '/bestiary-giant.jpg', name: 'Jötunn', cls: 'GIANT · BOSS-TIER', threat: 5, accentRgb: 'var(--realm-niflheim-rgb)' },
  { id: 'boss', img: '/bestiary-boss.jpg', name: 'Garmr', cls: 'WORLD BOSS · HELHEIM', threat: 5, accentRgb: 'var(--blood-rgb)' },
];

const CHANGELOG: Array<{ hash: string; full: string; version: string; text: string }> = [
  { hash: '7f3a9c2', full: '7f3a9c2e1b4d8f0a6c5e3d2b1a0987654fedcba9', version: 'v1.4.2+ragnarok', text: 'HELHEIM: Garmr world-boss event tuned · orb nametag LOD fixed' },
  { hash: 'a41d88b', full: 'a41d88b3c9e2f7a5b1d6c8e4f0a2b9d7c5e3f1a8', version: 'v1.4.1', text: 'SVARTALFHEIM: forge recipes +12 · parry window 180ms→200ms' },
  { hash: '9c0e3f1', full: '9c0e3f1d7b5a2c8e6f4d0b9a7c3e1f5d8b2a6c4e', version: 'v1.4.0', text: 'THE SEVERED THREAD, ACT IX — Asgard unlocked' },
  { hash: '55be201', full: '55be201f8d4a6c3e9b7d5f2a0c8e6b4d1f9a7c5e', version: 'v1.3.0', text: 'Bows: draw-weight, arrow drop, headshot ×2' },
  { hash: 'd3f7c19', full: 'd3f7c19e5b2d8a4f6c0e3b7d9a5f1c8e4b6d2a0f', version: 'v1.2.0', text: 'Reconnect banner: world visible during 3s retry' },
];

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function KickerRow({ label, runes, accent }: { label: string; runes: string; accent?: string }) {
  return (
    <div className="kicker-row" style={accent ? { ['--accent' as string]: accent } : undefined}>
      <span className="kicker">{label}</span>
      <span className="kicker-row-line" />
      <span className="kicker-row-runes">{runes}</span>
    </div>
  );
}

function MiniStat({ label, value, accent, filled }: { label: string; value: number; accent: string; filled: boolean }) {
  return (
    <div className="stat-bar" style={{ ['--accent' as string]: accent }}>
      <span className="stat-bar-label">{label}</span>
      <span className="stat-bar-track" style={{ width: 72 }}>
        <span
          className="stat-bar-fill"
          style={{ width: filled ? `${value * 10}%` : '0%', ['--fill' as string]: `${value * 10}%` }}
        />
      </span>
      <span className="stat-bar-value">{value}</span>
    </div>
  );
}

/** boot-type: types `text` at 18ms/char once `active` (design.md §5.2). */
function BootType({ text, active, className, onDone }: { text: string; active: boolean; className?: string; onDone?: () => void }) {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (!active) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        onDone?.();
      }
    }, 18);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, text]);
  return <span className={className}>{out}</span>;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// ---------------------------------------------------------------------------
// S1 · WebGL hero scene (imperative three — the one heavy shader of the page)
// Low-poly fjord at dusk: 3 pine depth planes, drifting fog planes, colossal
// portal ring with rune plates, ~120 ember particles, aurora sky shader.
// Falls back to the CSS poster on touch / reduced-motion / WebGL failure.
// ---------------------------------------------------------------------------

interface HeroSceneHandle {
  flare: () => void;
}

const SKY_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
void main() {
  vec3 base = vec3(0.047, 0.055, 0.067);       // #0C0E11
  vec3 dusk = vec3(0.135, 0.19, 0.16);         // pine-green dusk band
  vec3 ember = vec3(0.32, 0.19, 0.08);         // amber horizon ember
  float h = vUv.y;
  vec3 col = mix(base, dusk, smoothstep(0.0, 0.42, h) * (1.0 - smoothstep(0.45, 0.95, h)));
  col = mix(col, ember, smoothstep(0.06, 0.0, h) * 0.55);
  // aurora ribbons
  float band = sin(vUv.x * 9.0 + uTime * 0.12 + sin(vUv.x * 3.0 + uTime * 0.05) * 1.6);
  float aur = smoothstep(0.55, 0.95, h) * smoothstep(0.4, 1.0, band) * 0.16;
  col += vec3(0.28, 0.62, 0.5) * aur;
  float band2 = sin(vUv.x * 5.0 - uTime * 0.08);
  col += vec3(0.2, 0.4, 0.55) * smoothstep(0.62, 0.98, h) * smoothstep(0.55, 1.0, band2) * 0.1;
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeFogTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 64, 8, 128, 64, 120);
  g.addColorStop(0, 'rgba(178, 196, 186, 0.32)');
  g.addColorStop(0.55, 'rgba(150, 170, 160, 0.14)');
  g.addColorStop(1, 'rgba(150, 170, 160, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createHeroScene(
  container: HTMLDivElement,
  section: HTMLElement,
): { handle: HeroSceneHandle; dispose: () => void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c0e11, 0.055);

  const camera = new THREE.PerspectiveCamera(62, width / height, 0.1, 120);
  camera.position.set(0, 2.3, 11);
  camera.lookAt(0, 2.6, -4);

  // --- sky shader plane -------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { uTime: { value: 0 } },
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(160, 70), skyMat);
  sky.position.set(0, 16, -60);
  scene.add(sky);

  // --- lights -----------------------------------------------------------
  scene.add(new THREE.AmbientLight(0x3a4a42, 1.1));
  const portalLight = new THREE.PointLight(0xffb64a, 90, 34, 1.7);
  portalLight.position.set(0, 3.4, -4);
  scene.add(portalLight);
  const moon = new THREE.DirectionalLight(0x8fa8c0, 0.35);
  moon.position.set(-6, 12, 4);
  scene.add(moon);

  // --- portal ring + rune plates ----------------------------------------
  const portal = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.24, 12, 72),
    new THREE.MeshStandardMaterial({ color: 0x232a32, roughness: 0.6, metalness: 0.3, emissive: 0xffb64a, emissiveIntensity: 0.55 }),
  );
  portal.add(torus);
  const plateGeo = new THREE.BoxGeometry(0.34, 0.52, 0.1);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.5, metalness: 0.2, emissive: 0xffb64a, emissiveIntensity: 1.4 });
  const plates: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
    plate.rotation.z = a + Math.PI / 2;
    plates.push(plate);
    portal.add(plate);
  }
  // inner glow disc
  const glowTex = makeFogTexture();
  const glowDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 5.2),
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffb64a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glowDisc.position.z = -0.2;
  portal.add(glowDisc);
  portal.position.set(0, 3.4, -4);
  scene.add(portal);

  // --- ground -----------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 80),
    new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  // --- pine silhouettes (3 depth planes) --------------------------------
  const pineLayers: THREE.Group[] = [];
  const layerSpecs = [
    { z: -8, count: 14, color: 0x1a2f24, spread: 34, scale: 1.0, parallax: 1.0 },
    { z: -15, count: 18, color: 0x122019, spread: 48, scale: 1.35, parallax: 0.6 },
    { z: -24, count: 22, color: 0x0d1512, spread: 64, scale: 1.8, parallax: 0.3 },
  ];
  const coneGeo = new THREE.ConeGeometry(1, 2.6, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.8, 5);
  for (const spec of layerSpecs) {
    const layer = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 1, metalness: 0 });
    for (let i = 0; i < spec.count; i++) {
      const tree = new THREE.Group();
      const t = i / (spec.count - 1);
      const x = (t - 0.5) * spec.spread + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 2.2;
      const s = spec.scale * (0.8 + ((Math.sin(i * 78.233) * 12543.2 % 1) + 1) * 0.5 * 0.5);
      const c1 = new THREE.Mesh(coneGeo, mat);
      c1.position.y = 1.8 * s;
      c1.scale.setScalar(s);
      const c2 = new THREE.Mesh(coneGeo, mat);
      c2.position.y = 2.9 * s;
      c2.scale.setScalar(s * 0.72);
      const trunk = new THREE.Mesh(trunkGeo, mat);
      trunk.position.y = 0.4 * s;
      trunk.scale.setScalar(s);
      tree.add(c1, c2, trunk);
      tree.position.set(x, 0, spec.z + (Math.sin(i * 3.7) * 2));
      tree.userData.baseX = x;
      tree.userData.parallax = spec.parallax;
      layer.add(tree);
    }
    pineLayers.push(layer);
    scene.add(layer);
  }

  // --- drifting fog planes ----------------------------------------------
  const fogPlanes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const fogMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0x9fb8a8,
      transparent: true,
      opacity: 0.16 - i * 0.02,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(30, 9), fogMat);
    plane.position.set((i - 1.5) * 12, 1.6 + i * 0.7, -6 - i * 4);
    plane.userData.speed = 0.14 + i * 0.07;
    fogPlanes.push(plane);
    scene.add(plane);
  }

  // --- ember / mote particles (single Points system) ---------------------
  const PARTICLES = 120;
  const positions = new Float32Array(PARTICLES * 3);
  const seeds = new Float32Array(PARTICLES);
  for (let i = 0; i < PARTICLES; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = Math.random() * 8;
    positions[i * 3 + 2] = -Math.random() * 14 + 2;
    seeds[i] = Math.random() * Math.PI * 2;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xffc27a,
    size: 0.07,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // --- pointer parallax ---------------------------------------------------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // --- flare hook (CTA hover) ---------------------------------------------
  let flareTarget = 1;
  let flareValue = 1;
  const handle: HeroSceneHandle = {
    flare() {
      flareTarget = 1.6;
      window.setTimeout(() => {
        flareTarget = 1;
      }, 300);
    },
  };

  // --- scroll scrub: portal scale 1→1.15, pine parallax over hero --------
  const triggers: ScrollTrigger[] = [];
  triggers.push(
    ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => {
        portal.scale.setScalar(1 + self.progress * 0.15);
        for (const layer of pineLayers) {
          for (const tree of layer.children) {
            const p = (tree.userData.parallax as number) ?? 1;
            tree.position.x = (tree.userData.baseX as number) + self.progress * p * 2.4;
          }
        }
      },
    }),
  );

  // --- resize -------------------------------------------------------------
  const onResize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // --- loop ---------------------------------------------------------------
  let raf = 0;
  let running = true;
  const start = performance.now();
  const frame = (nowMs: number) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const t = (nowMs - start) / 1000;

    skyMat.uniforms.uTime.value = t;

    // breathing portal glow (~3s) + CTA flare
    flareValue += (flareTarget - flareValue) * 0.08;
    const breathe = 1 + Math.sin(t * 2.1) * 0.22;
    portalLight.intensity = 90 * breathe * flareValue;
    plateMat.emissiveIntensity = 1.4 * breathe * flareValue;
    (glowDisc.material as THREE.MeshBasicMaterial).opacity = 0.34 * breathe * flareValue;
    portal.rotation.z = t * 0.05;

    // fog drift (0.3/0.6/1.0 parallax feel)
    for (const plane of fogPlanes) {
      const sp = plane.userData.speed as number;
      plane.position.x += Math.sin(t * 0.05 + sp * 20) * 0.0035 * sp * 10;
      plane.position.y += Math.cos(t * 0.07 + sp * 9) * 0.0012;
    }

    // embers rise + wobble, wrap
    const pos = particleGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < PARTICLES; i++) {
      let y = pos.getY(i) + 0.004 + Math.sin(t * 0.8 + seeds[i]!) * 0.0012;
      if (y > 8.5) y = -0.2;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.6 + seeds[i]!) * 0.002);
    }
    pos.needsUpdate = true;

    // first-person sway + cursor parallax (lerp 0.05, ±2%)
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    camera.rotation.z = Math.sin(t * 0.32) * 0.004 + pointer.x * 0.006;
    camera.rotation.y = Math.sin(t * 0.21) * 0.006 - pointer.x * 0.02;
    camera.rotation.x = Math.sin(t * 0.27) * 0.004 - pointer.y * 0.014;

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const dispose = () => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('resize', onResize);
    triggers.forEach((st) => st.kill());
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        (obj.geometry as THREE.BufferGeometry).dispose();
        const mat = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    glowTex.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { handle, dispose };
}

// ---------------------------------------------------------------------------
// S1 · Hero — "The Portal Awaits"
// ---------------------------------------------------------------------------

function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const sceneHandle = useRef<HeroSceneHandle | null>(null);
  const status = useServerStatus();

  const [titleActive, setTitleActive] = useState(false);
  const [runesActive, setRunesActive] = useState(false);
  const title = useGlyphScramble('CORESAPIAN', titleActive);
  const runeLine = useGlyphScramble('ᚲᛟᚱᛖᛋᚨᛈᛁᚨᚾ', runesActive);

  // Mount WebGL (skip on touch / reduced-motion / failure → poster stays).
  useEffect(() => {
    const host = sceneHostRef.current;
    const section = sectionRef.current;
    if (!host || !section) return;
    if (reducedMotion() || window.matchMedia('(hover: none)').matches) return;
    let scene: { handle: HeroSceneHandle; dispose: () => void } | null = null;
    try {
      scene = createHeroScene(host, section);
      sceneHandle.current = scene.handle;
    } catch (err) {
      console.warn('[home] WebGL hero unavailable, using poster', err);
      return;
    }
    return () => {
      scene?.dispose();
      sceneHandle.current = null;
    };
  }, []);

  // Load orchestration (~1.8s): poster → rune-draw → scramble → rise.
  useEffect(() => {
    const t1 = window.setTimeout(() => setRunesActive(true), 500);
    const t2 = window.setTimeout(() => setTitleActive(true), 950);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Scroll: content parallax-exits at 0.5×, canvas fades to --abyss.
  useEffect(() => {
    if (reducedMotion()) return;
    const section = sectionRef.current;
    if (!section) return;
    const ctx = gsap.context(() => {
      gsap.to('.hero-content', {
        yPercent: -50,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: section, start: 'top top', end: 'bottom 40%', scrub: true },
      });
      gsap.to('.hero-scene-fade', {
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: section, start: 'top top', end: 'bottom top', scrub: true },
      });
    }, section);
    return () => ctx.revert();
  }, []);

  const scrollToRealms = () => {
    document.getElementById('realm-grid')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <section ref={sectionRef} className="relative -mt-16 flex min-h-[100dvh] flex-col overflow-hidden">
      {/* Poster fallback / first paint (LCP) */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/hero-poster.jpg')" }}
        aria-hidden="true"
      />
      {/* WebGL scene (fades out over the first 100vh of scroll) */}
      <div className="hero-scene-fade absolute inset-0">
        <div ref={sceneHostRef} className="absolute inset-0" aria-hidden="true" />
      </div>
      {/* Realm-tinted haze + bottom fade into --abyss */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(111,162,135,0.08), transparent 60%)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56"
        style={{ background: 'linear-gradient(to top, var(--abyss), transparent)' }}
        aria-hidden="true"
      />

      {/* Center UI column */}
      <div className="hero-content relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-16 text-center">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="kicker"
        >
          ▚▚ A FIRST-PERSON SAGA OF THE NINE REALMS ▚▚
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.45 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="font-runic mt-6 text-xl tracking-[0.4em] text-phosphor"
          aria-hidden="true"
        >
          {runeLine}
        </motion.p>

        <h1 className="display-hero mt-2" aria-label="CORESAPIAN">
          {title}
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.45, duration: 0.8, ease: EASE_EXPO }}
          className="body-strong mt-6 max-w-xl text-[1rem]"
        >
          Etched in runes. Forged in the nine. An always-online first-person RPG —
          playable in your browser.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.55, duration: 0.8, ease: EASE_EXPO }}
          className="mt-9 flex flex-col items-center gap-4 sm:flex-row"
        >
          <span className="relative inline-flex">
            <span className="anim-spin-60 pointer-events-none absolute -inset-3 rounded-full border border-dashed border-phosphor/40" aria-hidden="true" />
            <Link
              to="/game"
              className="btn btn-phosphor btn-lg"
              onMouseEnter={() => sceneHandle.current?.flare()}
            >
              ENTER MIDGARD
            </Link>
          </span>
          <button type="button" onClick={scrollToRealms} className="btn btn-ghost btn-lg corner-brackets">
            EXPLORE THE REALMS
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.75, duration: 0.5 }}
          className="anim-flicker mt-8 flex flex-wrap items-center justify-center gap-2.5"
        >
          <span className="chip chip-version">v{BUILD_VERSION}</span>
          <span className="chip">WEBGL2</span>
          <span className="chip">ALWAYS ONLINE</span>
          <span className="chip">
            <span className="chip-dot" />
            {status.latencyMs}ms · {status.playersOnline.toLocaleString()} WANDERERS
          </span>
        </motion.div>
      </div>

      {/* Bottom-left: build chip · bottom-center: scroll hint · bottom-right: audio */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between p-4 sm:p-6">
        <span className="chip chip-version hidden sm:inline-flex">BUILD v{BUILD_VERSION}</span>
        <div className="flex flex-col items-center gap-2">
          <span className="font-runic text-phosphor/80">ᛏ</span>
          <span className="micro">SCROLL</span>
          <span
            className="block h-10 w-px bg-phosphor/70"
            style={{ animation: 'scroll-line 1.8s cubic-bezier(0.4,0,0.2,1) infinite' }}
            aria-hidden="true"
          />
        </div>
        <span className="chip hidden sm:inline-flex">AUDIO FORGES ON FIRST INPUT</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S2 · Realm marquee — "Nine Realms. One Thread."
// ---------------------------------------------------------------------------

function RealmMarquee() {
  const trackRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Brighten the item nearest the viewport center (checked ~5Hz).
  useEffect(() => {
    if (reducedMotion()) return;
    const id = window.setInterval(() => {
      const track = trackRef.current;
      if (!track) return;
      const cx = window.innerWidth / 2;
      for (const el of Array.from(track.querySelectorAll<HTMLElement>('[data-marquee-item]'))) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - cx);
        const t = Math.max(0, 1 - dist / (window.innerWidth * 0.35));
        el.style.opacity = String(0.7 + t * 0.3);
        el.style.textShadow = t > 0.55 ? `0 0 14px ${el.dataset.accent ?? 'transparent'}` : 'none';
      }
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const items = [...REALM_CARDS, ...REALM_CARDS];
  return (
    <section className="marquee relative h-24 border-y border-iron bg-abyss/60" aria-label="The nine realms">
      <div ref={trackRef} className="marquee-track h-full">
        {items.map((realm, i) => (
          <button
            key={`${realm.id}-${i}`}
            type="button"
            data-marquee-item
            data-accent={realm.accent}
            onClick={() => navigate(`/realms#${realm.id}`)}
            className="mr-14 flex items-center gap-3 opacity-70 transition-opacity"
            style={{ color: realm.accent }}
          >
            <span className="font-runic text-xl">{realm.rune}</span>
            <span className="font-display text-[1.1rem] font-bold tracking-[0.12em]">{realm.name.toUpperCase()}</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: realm.accent }} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S3 · The Saga — pinned scroll story (pin 150vh)
// ---------------------------------------------------------------------------

const ACTS = [
  {
    accent: 'var(--realm-midgard)',
    accentRgb: '111 162 135',
    title: "The Norns' thread is cut.",
    body: 'Yggdrasil shudders. The ways between realms bleed into one another, and the dead walk in Midgard.',
  },
  {
    accent: 'var(--realm-helheim)',
    accentRgb: '127 184 154',
    title: 'You wake at the waystone.',
    body: 'No name. No past. A rune burnt into your arm: ᚲ — the torch. The nine realms open before you.',
  },
  {
    accent: 'var(--phosphor)',
    accentRgb: '255 182 74',
    title: 'Retie the thread — or sever it forever.',
    body: 'Nine realms. Nine bosses. One choice at the roots of the world.',
  },
] as const;

function SagaStory() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrambleArmed, setScrambleArmed] = useState(0);
  const finalLine = useGlyphScramble('Retie the thread — or sever it forever.', scrambleArmed > 0, scrambleArmed);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (reducedMotion()) return;

    const ctx = gsap.context(() => {
      const acts = gsap.utils.toArray<HTMLElement>('.saga-act');
      const hazes = gsap.utils.toArray<HTMLElement>('.saga-haze');
      const panels = gsap.utils.toArray<HTMLElement>('.saga-panel');

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: '+=150%',
          scrub: 0.5,
          pin: true,
          onUpdate: (self) => {
            // One glyph-scramble on the final line as Act III settles.
            if (self.progress > 0.7) setScrambleArmed((v) => (v === 0 ? 1 : v));
          },
        },
      });

      // Act I holds then blurs/fades by 33%
      tl.to(acts[0], { opacity: 0, filter: 'blur(8px)', duration: 0.14, ease: 'power2.in' }, 0.19)
        .fromTo(acts[1], { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' }, 0.33)
        .to(hazes[0], { opacity: 0, duration: 0.12 }, 0.33)
        .fromTo(hazes[1], { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0.33)
        .to(acts[1], { opacity: 0, filter: 'blur(8px)', duration: 0.14, ease: 'power2.in' }, 0.52)
        .fromTo(acts[2], { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' }, 0.66)
        .to(hazes[1], { opacity: 0, duration: 0.12 }, 0.66)
        .fromTo(hazes[2], { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0.66)
        // Right-hand thread panels crossfade in step with the acts.
        .to(panels[0], { opacity: 0.25, duration: 0.1 }, 0.33)
        .to(panels[1], { opacity: 1, duration: 0.1 }, 0.33)
        .to(panels[1], { opacity: 0.25, duration: 0.1 }, 0.66)
        .to(panels[2], { opacity: 1, duration: 0.1 }, 0.66)
        // Thread line draws down, then snaps at 95%.
        .fromTo('.saga-thread', { scaleY: 0 }, { scaleY: 1, duration: 0.9, ease: 'none' }, 0)
        .to('.saga-thread', { opacity: 0, scaleY: 1.06, duration: 0.05 }, 0.95);
    }, root);
    return () => ctx.revert();
  }, []);

  const staticMode = typeof window !== 'undefined' && reducedMotion();

  return (
    <section ref={rootRef} className="relative overflow-hidden bg-void">
      {/* Realm haze per act */}
      {ACTS.map((act, i) => (
        <div
          key={i}
          className="saga-haze pointer-events-none absolute inset-0"
          style={{
            opacity: i === 0 || staticMode ? 1 : 0,
            background: `radial-gradient(ellipse at 50% 30%, rgba(${act.accentRgb}, 0.09), transparent 60%)`,
          }}
          aria-hidden="true"
        />
      ))}
      {/* Rotating rune-circle watermark */}
      <img
        src="/rune-circle.svg"
        alt=""
        className="anim-spin-90 pointer-events-none absolute left-1/2 top-1/2 h-[110vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2 opacity-20"
        aria-hidden="true"
      />

      <div className={`relative mx-auto flex max-w-content gap-10 px-4 sm:px-6 ${staticMode ? 'flex-col py-24' : 'min-h-[100dvh] items-center'}`}>
        {/* Thread line down the left margin */}
        <div className="relative w-px flex-none self-stretch" aria-hidden="true">
          <div className="saga-thread absolute inset-y-8 left-0 w-[2px] origin-top bg-gradient-to-b from-phosphor/0 via-phosphor to-phosphor/0" style={{ transform: staticMode ? 'none' : undefined }} />
        </div>

        <div className="relative grid flex-1 items-center gap-12 lg:grid-cols-[55%_45%]">
          {/* Left: narrative column */}
          <div>
            <p className="kicker mb-10">▚ THE SEVERED THREAD</p>
            <div className={staticMode ? 'flex flex-col gap-20' : 'relative min-h-[320px]'}>
              {ACTS.map((act, i) => (
                <div
                  key={i}
                  className={`saga-act ${staticMode ? '' : 'absolute inset-0 flex flex-col justify-center'}`}
                  style={{ opacity: staticMode || i === 0 ? 1 : 0 }}
                >
                  <p className="norse-accent max-w-reading" style={{ color: act.accent }}>
                    {i === 2 ? finalLine : act.title}
                  </p>
                  <p className="body mt-6 max-w-reading text-[1rem]">{act.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: three stacked thread panels crossfading with the acts */}
          <div className="hidden flex-col gap-5 lg:flex">
            {ACTS.map((act, i) => (
              <div
                key={i}
                className="saga-panel panel flex items-center gap-5 p-6"
                style={{ opacity: staticMode || i === 0 ? 1 : 0.25, borderColor: `rgba(${act.accentRgb}, 0.45)` }}
              >
                <span className="sigil-badge" style={{ ['--accent' as string]: act.accent }}>
                  <span>{['ᚠ', 'ᚱ', 'ᛟ'][i]}</span>
                </span>
                <div>
                  <p className="micro">ACT {['I', 'II', 'III'][i]}</p>
                  <p className="body-strong mt-1 text-[0.8125rem]" style={{ color: act.accent }}>
                    {['THE CUT', 'THE WAKING', 'THE CHOICE'][i]}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S4 · The Nine Realms grid (3×3)
// ---------------------------------------------------------------------------

function RealmGrid() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const heading = useGlyphScramble('NINE REALMS', inView);

  return (
    <section id="realm-grid" className="relative bg-abyss py-24 md:py-36" style={{ scrollMarginTop: 0 }}>
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE WORLD TREE" runes="ᚠᚢᚦᚨᚱᚲᚷᚹᚺ" />
        <h2 className="h1 mt-6">{heading}</h2>
        <p className="body mt-5 max-w-reading">
          Nine realms hang on the wounded tree — each with its own fog, its own
          hunger, its own boss at the root of its chapter. Master them in order,
          wanderer; the tree remembers.
        </p>

        <div ref={ref} className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {REALM_CARDS.map((realm, i) => (
            <Link
              key={realm.id}
              to={`/realms#${realm.id}`}
              className={`realm-card corner-brackets group ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
              style={{
                animationDelay: `${i * 90}ms`,
                ['--card-accent-rgb' as string]: realm.accentRgb,
                ['--accent' as string]: realm.accent,
                ['--bracket-color' as string]: realm.accent,
              }}
            >
              <div className="realm-card-art">
                <img src={`/realm-${realm.id}.jpg`} alt={`${realm.name} — ${realm.epithet}`} loading="lazy" />
                <span
                  className="font-runic pointer-events-none absolute -bottom-3 right-3 text-6xl opacity-25 transition-transform duration-500 group-hover:rotate-[10deg]"
                  style={{ color: realm.accent }}
                  aria-hidden="true"
                >
                  {realm.rune}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-6">
                <div>
                  <h3 className="norse-accent text-2xl" style={{ color: realm.accent }}>
                    {realm.name}
                  </h3>
                  <p className="micro mt-1">{realm.epithet}</p>
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <MiniStat label="THREAT" value={realm.threat} accent={realm.accent} filled={inView} />
                  <MiniStat label="MAGIC" value={realm.magic} accent={realm.accent} filled={inView} />
                  <MiniStat label="TERRAIN" value={realm.terrain} accent={realm.accent} filled={inView} />
                </div>
                <span
                  className="micro mt-2 inline-flex items-center gap-2 transition-colors group-hover:text-[var(--accent)]"
                  style={{ color: 'var(--bone-dim)' }}
                >
                  TRAVERSE <span aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S5 · Systems showcase — "Steel. Runes. Saga."
// ---------------------------------------------------------------------------

function SystemRow({ system, index }: { system: (typeof SYSTEMS)[number]; index: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const mediaLeft = index % 2 === 0;

  const media = (
    <div
      className={`panel group overflow-hidden ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}
      style={{ animationDelay: '80ms' }}
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-abyss">
        <img
          src={system.img}
          alt={system.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex items-center gap-2 border-t border-iron px-4 py-2.5">
        <span className="micro flex-1 text-phosphor-dim">
          <BootType text={system.caption} active={inView} />
        </span>
        <span className="boot-caret text-phosphor transition-[animation-duration] group-hover:[animation-duration:0.4s]">▊</span>
      </div>
    </div>
  );

  const text = (
    <div className="flex flex-col justify-center">
      <h3 className="h2">{system.title}</h3>
      <p className="body mt-5 max-w-reading">{system.body}</p>
      <ul className={`mt-7 flex flex-col gap-3 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`} style={{ animationDelay: '160ms' }}>
        {system.bullets.map((bullet) => (
          <li key={bullet} className="flex items-baseline gap-3">
            <span className="font-runic text-phosphor" aria-hidden="true">
              {bullet.slice(0, bullet.indexOf(' '))}
            </span>
            <span className="body-strong text-[0.875rem]">{bullet.slice(bullet.indexOf(' ') + 1)}</span>
          </li>
        ))}
      </ul>
      <div className={`mt-8 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`} style={{ animationDelay: '240ms' }}>
        <Link to={system.link.to} className="kicker inline-flex items-center gap-2 transition-colors hover:text-phosphor-hi">
          {system.link.label}
        </Link>
      </div>
    </div>
  );

  return (
    <div ref={ref} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
      {mediaLeft ? (
        <>
          {media}
          {text}
        </>
      ) : (
        <>
          <div className="lg:order-2">{media}</div>
          <div className="lg:order-1">{text}</div>
        </>
      )}
    </div>
  );
}

function Systems() {
  return (
    <section className="relative bg-void py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE CRAFT OF SURVIVAL" runes="ᚦᛒᚺᛟᛗᚱᚲᚷ" />
        <h2 className="h1 mt-6">STEEL. RUNES. SAGA.</h2>
        <div className="mt-16 flex flex-col gap-24 md:gap-32">
          {SYSTEMS.map((system, i) => (
            <SystemRow key={system.title} system={system} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S6 · Multiplayer — "Never Wander Alone"
// ---------------------------------------------------------------------------

const BANNER_STATES = [
  { label: 'CONNECTED · 42ms', cls: 'text-soul', dot: true },
  { label: 'CONNECTING…', cls: 'text-phosphor', dot: false },
  { label: 'RETRY IN 3s', cls: 'text-blood-hi', dot: false },
] as const;

const NAMETAGS = [
  { name: 'Sigurdr_Lv14', left: '22%', top: '30%', delay: '0s' },
  { name: 'Eira_Skald', left: '55%', top: '22%', delay: '0.3s' },
  { name: 'MossBeard', left: '72%', top: '44%', delay: '0.6s' },
] as const;

function MultiplayerTeaser() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [bannerIdx, setBannerIdx] = useState(0);
  const navigate = useNavigate();

  // Demo the reconnection UX: cycle states every 6s.
  useEffect(() => {
    const id = window.setInterval(() => setBannerIdx((i) => (i + 1) % BANNER_STATES.length), 6000);
    return () => window.clearInterval(id);
  }, []);

  const banner = BANNER_STATES[bannerIdx]!;

  const rows = [
    { n: '01', title: 'SPAWN INSTANTLY', body: 'No lobbies, no login wall. You wake in Midgard while the world connects around you.' },
    { n: '02', title: 'ORBS OF THE WANDERERS', body: 'Other players appear as glowing orbs with nametags — spirits crossing the same mist.' },
    { n: '03', title: 'RECONNECT IN 3S', body: 'Dropped from the Bifröst? The banner appears, the world stays visible, and you rejoin automatically.' },
  ];

  return (
    <section className="relative border-t border-iron bg-abyss py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[45%_55%] lg:gap-16">
          {/* Copy */}
          <div>
            <KickerRow label="▚▚ ALWAYS ONLINE" runes="ᛒᛁᚠᚱᛟᛊᛏ" />
            <h2 className="h1 mt-6">THE SHARED WORLD</h2>
            <p className="body mt-5 max-w-reading">
              One world, one thread, thousands of wanderers. No shards of
              solitude — the mist you walk is the mist they walk.
            </p>
            <div ref={ref} className="mt-10 flex flex-col gap-7">
              {rows.map((row, i) => (
                <div
                  key={row.n}
                  className={`flex gap-5 ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <span className="stat text-lg text-phosphor-dim">{row.n}</span>
                  <div>
                    <p className="body-strong text-[0.875rem] tracking-[0.08em]">{row.title}</p>
                    <p className="body mt-1 text-[0.8125rem]">{row.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <Link to="/multiplayer" className="kicker mt-10 inline-flex items-center gap-2 transition-colors hover:text-phosphor-hi">
              SEE THE SHARED WORLD →
            </Link>
          </div>

          {/* Framed vista with HUD overlay */}
          <div className={`panel overflow-hidden ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}>
            <div className="relative aspect-video overflow-hidden bg-abyss">
              <img src="/multiplayer-orbs.jpg" alt="Misty clearing with glowing player orbs" loading="lazy" className="h-full w-full object-cover" />
              {/* Nametags: fade in one-by-one (0.3s stagger), then idle bob */}
              {inView &&
                NAMETAGS.map((tag, i) => (
                  <motion.span
                    key={tag.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 + i * 0.3, duration: 0.5 }}
                    className="absolute"
                    style={{ left: tag.left, top: tag.top }}
                  >
                    <span
                      className="anim-bob block text-[0.625rem] font-medium tracking-[0.14em] text-phosphor"
                      style={{
                        animationDelay: tag.delay,
                        animationDuration: '2s',
                        textShadow: '0 0 8px rgba(255,182,74,0.8)',
                      }}
                    >
                      {tag.name}
                    </span>
                  </motion.span>
                ))}
              {/* Cycling connection-banner mock */}
              <button
                type="button"
                onClick={() => navigate('/multiplayer#connection')}
                className="absolute left-1/2 top-4 -translate-x-1/2"
                title="Connection lifecycle — open the shared world codex"
              >
                <span key={banner.label} className={`chip anim-flicker bg-void/80 ${banner.cls}`}>
                  {banner.dot && <span className="chip-dot" />}
                  {banner.label}
                </span>
              </button>
            </div>
            <div className="flex items-center gap-2 border-t border-iron px-4 py-2.5">
              <span className="micro flex-1 text-phosphor-dim">BIFRÖST.LINK — RECONNECTION DEMO (CYCLES EVERY 6S)</span>
              <span className="boot-caret text-phosphor">▊</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S7 · Bestiary strip — "What Hunts in the Mist"
// ---------------------------------------------------------------------------

function ThreatPips({ threat, accentRgb }: { threat: number; accentRgb: string }) {
  return (
    <span className="flex gap-1" aria-label={`Threat ${threat} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`text-[0.625rem] transition-opacity duration-100 ${
            i < threat ? 'opacity-40 group-hover:opacity-100' : 'opacity-25'
          }`}
          style={{
            color: i < threat ? `rgb(${accentRgb})` : 'var(--iron-2)',
            transitionDelay: `${i * 50}ms`,
            textShadow: i < threat ? `0 0 6px rgb(${accentRgb})` : 'none',
          }}
          aria-hidden="true"
        >
          ●
        </span>
      ))}
    </span>
  );
}

function BestiaryStrip() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <section className="relative bg-void py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <div className="flex items-end justify-between gap-6">
          <KickerRow label="▚▚ THE BESTIARY" runes="ᛞᚢᚦᚨᚷᚱ" />
          <Link to="/lore#bestiary" className="kicker hidden flex-none transition-colors hover:text-phosphor-hi sm:block">
            OPEN THE CODEX →
          </Link>
        </div>
        <h2 className="h2 mt-6">WHAT HUNTS IN THE MIST</h2>

        <div ref={ref} className="strip-scroll mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4">
          {BESTIARY.map((beast, i) => (
            <Link
              key={beast.id}
              to="/lore#bestiary"
              className={`realm-card group w-[240px] flex-none snap-start ${inView ? 'reveal-rise is-revealed' : 'reveal-rise'}`}
              style={{
                animationDelay: `${i * 70}ms`,
                ['--card-accent-rgb' as string]: beast.accentRgb,
              }}
            >
              <div className="realm-card-art" style={{ aspectRatio: '4/5', height: 260 }}>
                <img src={beast.img} alt={beast.name} loading="lazy" />
              </div>
              <div className="flex flex-col gap-1.5 p-4">
                <p className="font-display text-sm font-bold tracking-[0.1em] text-bone">{beast.name.toUpperCase()}</p>
                <p className="micro">{beast.cls}</p>
                <ThreatPips threat={beast.threat} accentRgb={beast.accentRgb} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S8 · Changelog terminal — "The Builder's Rune"
// ---------------------------------------------------------------------------

function ChangelogTerminal() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [linesDone, setLinesDone] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const copyHash = async (hash: string, full: string) => {
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      /* clipboard unavailable — still show feedback */
    }
    setCopied(hash);
    window.setTimeout(() => setCopied((c) => (c === hash ? null : c)), 1200);
  };

  const allLines = [
    { prompt: true, text: '> coresapian --ledger' },
    ...CHANGELOG.map((c) => ({ prompt: false, text: `[${c.hash}] ${c.version}${' '.repeat(Math.max(1, 18 - c.version.length))} ${c.text}`, entry: c })),
  ];

  return (
    <section className="relative border-t border-iron bg-abyss py-24 md:py-36">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <KickerRow label="▚▚ THE BUILDER'S RUNE" runes="ᛒᚢᛁᛚᛞᚱ" />
        <div ref={ref} className={`terminal mx-auto mt-12 max-w-[880px] ${inView ? 'reveal-etch is-revealed' : 'reveal-etch'}`}>
          <div className="terminal-titlebar">
            <span aria-hidden="true">▚▚</span> CORESAPIAN.SHELL — BUILD LEDGER
            <span className="boot-caret ml-auto">▊</span>
          </div>
          <div className="terminal-body relative">
            <div className="rune-ticks absolute inset-y-4 right-3 hidden [writing-mode:vertical-rl] md:block" aria-hidden="true">
              ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ
            </div>
            {allLines.map((line, i) => {
              const visible = i <= linesDone;
              if (line.prompt) {
                return (
                  <p key={i} className="terminal-line">
                    {visible && (
                      <BootType text={line.text} active={inView} className="prompt" onDone={() => setLinesDone(1)} />
                    )}
                  </p>
                );
              }
              const entry = (line as { entry?: (typeof CHANGELOG)[number] }).entry!;
              return (
                <p key={i} className="terminal-line">
                  {visible && (
                    <button
                      type="button"
                      title={`commit ${entry.full}`}
                      onClick={() => copyHash(entry.hash, entry.full)}
                      className="text-left transition-colors hover:text-bone"
                    >
                      <BootType text={line.text} active={inView && linesDone >= i} onDone={() => setLinesDone((d) => Math.max(d, i + 1))} />
                      {copied === entry.hash && <span className="ml-3 text-soul">COPIED</span>}
                    </button>
                  )}
                </p>
              );
            })}
            {linesDone >= allLines.length && <span className="boot-caret text-phosphor">▊</span>}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {CHANGELOG.map((c) => (
            <span key={c.hash} className="chip chip-version">
              {c.version}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// S9 · Final CTA — "The Waystone"
// ---------------------------------------------------------------------------

function WaystoneCta() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const heading = useGlyphScramble('THE WAYSTONE AWAITS', inView);
  const [departing, setDeparting] = useState(false);
  const navigate = useNavigate();

  const enter = () => {
    if (departing) return;
    setDeparting(true);
    window.setTimeout(() => navigate('/game'), 600);
  };

  return (
    <section className="relative flex min-h-[90dvh] items-center justify-center overflow-hidden bg-void">
      <img
        src="/rune-circle.svg"
        alt=""
        className="anim-spin-60 pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-25"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(255,182,74,0.07), transparent 55%)' }}
        aria-hidden="true"
      />

      <div ref={ref} className="relative z-10 flex flex-col items-center px-4 text-center">
        <h2 className="h1">{heading}</h2>

        <motion.button
          type="button"
          onClick={enter}
          whileTap={{ scale: 0.97 }}
          animate={departing ? { scale: 20, opacity: 0 } : undefined}
          transition={departing ? { duration: 0.6, ease: 'easeIn' } : undefined}
          className={`${departing ? '' : 'anim-portal-pulse '}group relative mt-12 flex h-40 w-40 items-center justify-center rounded-full border border-iron-2 bg-stone`}
          aria-label="Enter the game"
        >
          {/* Swirling amber interior */}
          <span
            className="absolute inset-2 rounded-full opacity-80 transition-[animation-duration] group-hover:[animation-duration:1.5s]"
            style={{
              background: 'conic-gradient(from 0deg, transparent, rgba(255,182,74,0.65), transparent 40%, rgba(255,182,74,0.35), transparent 70%, rgba(255,216,154,0.6), transparent)',
              animation: 'portal-swirl 6s linear infinite',
              filter: 'blur(2px)',
            }}
            aria-hidden="true"
          />
          <span className="absolute inset-4 rounded-full border border-phosphor/40" aria-hidden="true" />
          <span className="font-display relative z-10 text-xl font-black tracking-[0.2em] text-phosphor phosphor-glow">
            ENTER
          </span>
        </motion.button>

        <p className="body mt-12 max-w-md">
          The thread leads inward, wanderer. Midgard is first.
        </p>
        <p className="micro mt-4">NO ACCOUNT · NO DOWNLOAD · ALWAYS ONLINE</p>
      </div>

      {/* Route-transition flash */}
      {departing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.85] }}
          transition={{ duration: 0.6, times: [0, 0.5, 1] }}
          className="pointer-events-none fixed inset-0 z-[9995]"
          style={{ background: 'radial-gradient(circle, #FFE9C4 0%, #FFB64A 45%, rgba(255,182,74,0.4) 100%)' }}
          aria-hidden="true"
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <>
      <Hero />
      <RealmMarquee />
      <div className="rune-divider mx-auto max-w-content px-4 sm:px-6" aria-hidden="true">
        <span>ᛟ</span>
      </div>
      <SagaStory />
      <RealmGrid />
      <Systems />
      <MultiplayerTeaser />
      <BestiaryStrip />
      <ChangelogTerminal />
      <WaystoneCta />
    </>
  );
}
