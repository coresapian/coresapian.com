// ============================================================================
// CORESAPIAN — src/game/world/portals.ts
// Runic gates per RealmConfig.portals: carved torus ring, swirling inner
// disc shader, particle drip, point light. Active only while the target
// realm is unlocked (dim/dormant otherwise); channeling an active gate for
// 1200ms travels via the RealmService.
// ============================================================================

import * as THREE from 'three';

import type { RealmId } from '../../../contracts/types';
import { REALMS } from '../../../contracts/realms';
import { damp } from '../config';

import type { RealmBuildCtx, RealmModule } from './types';

const PORTAL_CHANNEL_MS = 1200;
const INTERACT_RADIUS = 2.5;
const DRIP_COUNT = 26;

export interface PortalDeps {
  isUnlocked(to: RealmId): boolean;
  travel(to: RealmId): void;
}

// ---------------------------------------------------------------------------
// Inner-disc swirl shader
// ---------------------------------------------------------------------------

const DISC_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uActive;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float swirl = sin(a * 4.0 + uTime * 1.6 - r * 9.0);
  float core = smoothstep(1.0, 0.15, r);
  vec3 lit = uColor * (0.55 + 0.45 * swirl) + uColor * 0.4 * core;
  vec3 dormant = vec3(0.13, 0.13, 0.17) * (0.8 + 0.2 * swirl);
  vec3 col = mix(dormant, lit, uActive);
  float alpha = core * mix(0.5, 0.92, uActive);
  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type PortalsBuild = RealmModule;

interface PortalInstance {
  group: THREE.Group;
  to: RealmId;
  ringMat: THREE.MeshStandardMaterial;
  discUniforms: {
    uColor: { value: THREE.Color };
    uTime: { value: number };
    uActive: { value: number };
  };
  dripAttr: THREE.BufferAttribute;
  dripSeeds: Float32Array;
  dripMat: THREE.PointsMaterial;
  light: THREE.PointLight;
  /** 0 dormant .. 1 active (smoothed). */
  active: number;
}

export function buildPortals(bctx: RealmBuildCtx, deps: PortalDeps): PortalsBuild {
  const { config, root } = bctx;
  const instances: PortalInstance[] = [];
  const disposables: { dispose(): void }[] = [];

  const stoneGeo = new THREE.TorusGeometry(2.3, 0.28, 10, 44);
  const discGeo = new THREE.CircleGeometry(1.95, 40);
  disposables.push(stoneGeo, discGeo);

  config.portals.forEach((portal, idx) => {
    const target = REALMS[portal.to];
    const accent = new THREE.Color(target.palette.accent);
    const px = portal.offset.x;
    const pz = portal.offset.z;
    const py = bctx.sampleHeight(px, pz);

    const group = new THREE.Group();
    group.name = `portal:${config.id}->${portal.to}`;
    group.position.set(px, py, pz);
    group.rotation.y = Math.atan2(-px, -pz); // face the realm center

    // Carved ring.
    const ringMat = new THREE.MeshStandardMaterial({
      color: '#45454f',
      roughness: 0.75,
      metalness: 0.2,
      emissive: accent,
      emissiveIntensity: 0.08,
    });
    const ring = new THREE.Mesh(stoneGeo, ringMat);
    ring.position.y = 2.75;
    group.add(ring);

    // Swirl disc.
    const discUniforms = {
      uColor: { value: accent.clone() },
      uTime: { value: idx * 3.7 },
      uActive: { value: 0 },
    };
    const discMat = new THREE.ShaderMaterial({
      uniforms: discUniforms,
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 2.75;
    group.add(disc);

    // Particle drip falling from the ring.
    const dripGeo = new THREE.BufferGeometry();
    const dripSeeds = new Float32Array(DRIP_COUNT * 2); // (angle, fall phase)
    const dripPositions = new Float32Array(DRIP_COUNT * 3);
    for (let i = 0; i < DRIP_COUNT; i++) {
      dripSeeds[i * 2] = Math.random() * Math.PI * 2;
      dripSeeds[i * 2 + 1] = Math.random();
    }
    const dripAttr = new THREE.BufferAttribute(dripPositions, 3);
    dripAttr.setUsage(THREE.DynamicDrawUsage);
    dripGeo.setAttribute('position', dripAttr);
    const dripMat = new THREE.PointsMaterial({
      size: 0.12,
      sizeAttenuation: true,
      color: accent,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const drip = new THREE.Points(dripGeo, dripMat);
    drip.frustumCulled = false;
    group.add(drip);

    // Portal glow light.
    const light = new THREE.PointLight(accent, 4, 20, 1.8);
    light.position.set(0, 3.1, 1.2);
    group.add(light);

    // Base plinth so the gate sits in the terrain.
    const plinthGeo = new THREE.CylinderGeometry(1.6, 2.1, 0.5, 8);
    const plinth = new THREE.Mesh(plinthGeo, ringMat);
    plinth.position.y = 0.22;
    group.add(plinth);
    disposables.push(plinthGeo);

    root.add(group);
    disposables.push(ringMat, discMat, dripGeo, dripMat);

    // Colliders on the two ring posts only — the player must be able to step
    // up to (and through) the gate face within the 2.5m interact radius.
    const yaw = group.rotation.y;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    for (const side of [-1, 1]) {
      bctx.colliders.push({
        kind: 'cylinder',
        x: px + side * 2.3 * cosY,
        z: pz - side * 2.3 * sinY,
        r: 0.55,
        y0: py - 1,
        y1: py + 5,
      });
    }

    const isUnlocked = () => deps.isUnlocked(portal.to);
    bctx.interact({
      id: `portal:${config.id}:${portal.to}`,
      kind: 'portal',
      get prompt() {
        return isUnlocked() ? `E — Enter ${target.displayName}` : `Sealed — ${portal.label}`;
      },
      position: new THREE.Vector3(px, py + 1.4, pz),
      radius: INTERACT_RADIUS,
      channelMs: PORTAL_CHANNEL_MS,
      isAvailable: isUnlocked,
      onInteract: () => deps.travel(portal.to),
    });

    instances.push({
      group,
      to: portal.to,
      ringMat,
      discUniforms,
      dripAttr,
      dripSeeds,
      dripMat,
      light,
      active: 0,
    });
  });

  return {
    update(dt, elapsed) {
      for (const inst of instances) {
        const target = deps.isUnlocked(inst.to) ? 1 : 0;
        inst.active = damp(inst.active, target, 6, dt);
        const a = inst.active;

        inst.ringMat.emissiveIntensity = 0.08 + a * 1.05;
        inst.discUniforms.uTime.value = elapsed;
        inst.discUniforms.uActive.value = a;
        inst.light.intensity = 4 + a * 24 + Math.sin(elapsed * 2.1) * a * 4;
        inst.dripMat.opacity = a * 0.85;

        if (a > 0.02) {
          const arr = inst.dripAttr.array as Float32Array;
          for (let i = 0; i < DRIP_COUNT; i++) {
            const ang = inst.dripSeeds[i * 2]! + elapsed * 0.12;
            const fall = (inst.dripSeeds[i * 2 + 1]! + elapsed * 0.22) % 1;
            arr[i * 3] = Math.cos(ang) * 2.3;
            arr[i * 3 + 1] = 0.3 + (1 - fall) * 4.7; // ring top → ground drip
            arr[i * 3 + 2] = 0.35;
          }
          inst.dripAttr.needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const inst of instances) root.remove(inst.group);
      instances.length = 0;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
