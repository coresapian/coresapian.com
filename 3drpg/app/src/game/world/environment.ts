// ============================================================================
// CORESAPIAN — src/game/world/environment.ts
// Per-realm atmosphere: FogExp2, gradient sky dome (with realm-special sky
// FX: Niflheim aurora, Muspelheim ember sky, Asgard storm, Helheim void),
// hemisphere + sun lighting from the realm palette, and one THREE.Points
// weather/mote system (<= 600 particles).
// ============================================================================

import * as THREE from 'three';

import type { RealmId } from '../../../contracts/types';
import { clamp } from '../config';

import type { RealmBuildCtx, RealmModule } from './types';

const SKY_RADIUS = 320;

// ---------------------------------------------------------------------------
// Sky shader
// ---------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform vec3 uAccent;
uniform float uTime;
uniform int uEffect; // 0 plain, 1 aurora, 2 ember, 3 storm, 4 void
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float az = atan(d.z, d.x);

  vec3 col = mix(uHorizon, uSky, smoothstep(0.02, 0.5, h));
  col = mix(uFogColor, col, smoothstep(-0.12, 0.02, h));

  if (uEffect == 1) {
    // Niflheim — aurora bands bleeding across a sunless sky.
    float band = sin(az * 3.0 + uTime * 0.10 + sin(h * 9.0 + uTime * 0.23) * 0.8);
    float band2 = sin(az * 5.0 - uTime * 0.07 + h * 6.0);
    float mask = smoothstep(0.12, 0.38, h) * smoothstep(0.95, 0.45, h);
    float glow = (smoothstep(0.25, 0.9, band) * 0.6 + smoothstep(0.45, 0.95, band2) * 0.35) * mask;
    vec3 aurora = mix(vec3(0.25, 0.95, 0.6), uAccent, 0.45);
    col += aurora * glow * 0.55;
  } else if (uEffect == 2) {
    // Muspelheim — ember-choked horizon, slow churn and pulse.
    float churn = sin(az * 4.0 + uTime * 0.15) * sin(h * 12.0 - uTime * 0.3);
    float horizonGlow = smoothstep(0.55, 0.0, h);
    float pulse = 0.85 + 0.15 * sin(uTime * 0.7);
    col += uAccent * (0.22 + 0.10 * churn) * horizonGlow * pulse;
  } else if (uEffect == 3) {
    // Asgard — storm-lit cloud bands with golden rifts.
    float n = sin(az * 4.0 + uTime * 0.05 + h * 7.0) + sin(az * 7.0 - uTime * 0.08);
    float clouds = smoothstep(0.4, 1.5, n) * smoothstep(0.05, 0.35, h);
    col = mix(col, col * 0.45 + uSky * 0.1, clouds * 0.7);
    float rift = smoothstep(1.55, 1.9, n) * smoothstep(0.1, 0.4, h);
    col += uAccent * rift * 0.5;
  } else if (uEffect == 4) {
    // Helheim — pale void; contrast crushed toward a grey-green wash.
    vec3 wash = mix(uSky, uHorizon, 0.5) * vec3(0.85, 1.0, 0.92);
    col = mix(col, wash, 0.55);
    float veil = sin(d.x * 6.0 + uTime * 0.03) * sin(d.z * 5.0 - uTime * 0.04);
    col += uAccent * smoothstep(0.6, 1.0, veil) * 0.04;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_EFFECT: Record<RealmId, number> = {
  midgard: 0,
  alfheim: 0,
  svartalfheim: 0,
  jotunheim: 0,
  niflheim: 1,
  muspelheim: 2,
  vanaheim: 0,
  helheim: 4,
  asgard: 3,
};

// ---------------------------------------------------------------------------
// Weather / realm particles
// ---------------------------------------------------------------------------

interface ParticleStyle {
  count: number; // hard cap 600
  size: number;
  color: string;
  opacity: number;
  vel: { x: number; y: number; z: number };
  /** Sinusoidal wander amplitude (soul-wisp swirl etc.). */
  swirl: number;
  additive: boolean;
}

const PARTICLE_STYLES: Record<RealmId, ParticleStyle> = {
  midgard: { count: 420, size: 0.14, color: '#dfe8ee', opacity: 0.35, vel: { x: -0.25, y: -0.12, z: 0.1 }, swirl: 0.15, additive: false },
  alfheim: { count: 380, size: 0.13, color: '#ffe9a8', opacity: 0.8, vel: { x: 0.15, y: 0.22, z: 0.1 }, swirl: 0.6, additive: true },
  svartalfheim: { count: 360, size: 0.15, color: '#9a6fe0', opacity: 0.6, vel: { x: 0.08, y: 0.3, z: 0.06 }, swirl: 0.4, additive: true },
  jotunheim: { count: 600, size: 0.16, color: '#ffffff', opacity: 0.75, vel: { x: 0.9, y: -1.6, z: 0.5 }, swirl: 0.25, additive: false },
  niflheim: { count: 500, size: 0.14, color: '#a8d0f0', opacity: 0.5, vel: { x: 0.12, y: -0.25, z: 0.1 }, swirl: 0.35, additive: true },
  muspelheim: { count: 480, size: 0.13, color: '#ff9a50', opacity: 0.85, vel: { x: 0.5, y: 1.9, z: 0.35 }, swirl: 0.5, additive: true },
  vanaheim: { count: 400, size: 0.13, color: '#d8f0a0', opacity: 0.65, vel: { x: 0.2, y: 0.12, z: 0.14 }, swirl: 0.5, additive: true },
  helheim: { count: 320, size: 0.2, color: '#8fd8b8', opacity: 0.7, vel: { x: 0.25, y: 0.35, z: 0.2 }, swirl: 1.2, additive: true },
  asgard: { count: 420, size: 0.12, color: '#ffd98a', opacity: 0.75, vel: { x: 1.4, y: 0.4, z: 0.9 }, swirl: 0.3, additive: true },
};

/** Particle volume around the camera. */
const BOX_W = 120;
const BOX_H = 44;
const BOX_D = 120;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type EnvironmentBuild = RealmModule;

export function buildEnvironment(bctx: RealmBuildCtx): EnvironmentBuild {
  const { ctx, config, root } = bctx;
  const pal = config.palette;
  const scene = ctx.scene;

  // -- fog + background -------------------------------------------------------
  const fog = new THREE.FogExp2(pal.fog, (config.fogDensityMin + config.fogDensityMax) / 2);
  scene.fog = fog;
  const prevBackground = scene.background;
  scene.background = new THREE.Color(pal.sky);

  // -- sky dome ---------------------------------------------------------------
  const skyUniforms = {
    uSky: { value: new THREE.Color(pal.sky) },
    uHorizon: { value: new THREE.Color(pal.horizon) },
    uFogColor: { value: new THREE.Color(pal.fog) },
    uAccent: { value: new THREE.Color(pal.accent) },
    uTime: { value: 0 },
    uEffect: { value: SKY_EFFECT[config.id] },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  sky.name = `sky:${config.id}`;
  root.add(sky);

  // -- lighting ---------------------------------------------------------------
  const skyLum = luminance(pal.sky);
  const sunLum = luminance(pal.sun);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(pal.sky),
    new THREE.Color(pal.ground),
    clamp(0.3 + skyLum * 0.85, 0.3, 1.05),
  );
  hemi.name = `hemi:${config.id}`;
  root.add(hemi);

  const sun = new THREE.DirectionalLight(
    new THREE.Color(pal.sun),
    clamp(0.35 + sunLum * 1.9, 0.35, 2.3),
  );
  // Sun angle derived from unlock tier so each realm reads differently.
  const azimuth = 0.8 + config.tier * 0.75;
  const elevation = 0.3 + skyLum * 0.55;
  sun.position.set(
    Math.cos(azimuth) * Math.cos(elevation) * 220,
    Math.sin(elevation) * 220,
    Math.sin(azimuth) * Math.cos(elevation) * 220,
  );
  sun.name = `sun:${config.id}`;
  root.add(sun);
  root.add(sun.target);

  // -- particles ---------------------------------------------------------------
  const style = PARTICLE_STYLES[config.id];
  const count = Math.min(style.count, 600);
  const base = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = (Math.random() - 0.5) * BOX_W;
    base[i * 3 + 1] = (Math.random() - 0.5) * BOX_H;
    base[i * 3 + 2] = (Math.random() - 0.5) * BOX_D;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const pGeo = new THREE.BufferGeometry();
  const pAttr = new THREE.BufferAttribute(base.slice(), 3);
  pAttr.setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('position', pAttr);
  const pMat = new THREE.PointsMaterial({
    size: style.size,
    sizeAttenuation: true,
    color: new THREE.Color(style.color),
    transparent: true,
    opacity: style.opacity,
    depthWrite: false,
    blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: !style.additive,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.name = `particles:${config.id}`;
  root.add(points);

  // -- per-frame ---------------------------------------------------------------
  const update = (_dt: number, elapsed: number): void => {
    const cam = ctx.camera;

    sky.position.copy(cam.position);
    skyUniforms.uTime.value = elapsed;

    // Slow breathing between the config fog bounds.
    const span = config.fogDensityMax - config.fogDensityMin;
    fog.density = config.fogDensityMin + span * (0.5 + 0.5 * Math.sin(elapsed * 0.07));

    const t = elapsed;
    const arr = pAttr.array as Float32Array;
    const cy = cam.position.y + 6;
    for (let i = 0; i < count; i++) {
      const ph = phase[i]!;
      const sx = style.swirl * Math.sin(t * 0.6 + ph);
      const sz = style.swirl * Math.cos(t * 0.5 + ph * 1.3);
      const x = base[i * 3]! + style.vel.x * t + sx;
      const y = base[i * 3 + 1]! + style.vel.y * t + style.swirl * 0.4 * Math.sin(t * 0.8 + ph * 2.1);
      const z = base[i * 3 + 2]! + style.vel.z * t + sz;
      arr[i * 3] = cam.position.x + wrap(x - cam.position.x, BOX_W);
      arr[i * 3 + 1] = cy + wrap(y - cy, BOX_H);
      arr[i * 3 + 2] = cam.position.z + wrap(z - cam.position.z, BOX_D);
    }
    pAttr.needsUpdate = true;
  };

  return {
    update,
    dispose() {
      root.remove(sky, hemi, sun, sun.target, points);
      skyGeo.dispose();
      skyMat.dispose();
      pGeo.dispose();
      pMat.dispose();
      if (scene.fog === fog) scene.fog = null;
      scene.background = prevBackground;
    },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function wrap(v: number, w: number): number {
  return ((((v + w / 2) % w) + w) % w) - w / 2;
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return clamp(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 0, 1);
}
