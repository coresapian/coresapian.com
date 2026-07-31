// ============================================================================
// CORESAPIAN — src/game/net/orbs.ts (audio-net)
//
// Remote-player presence per gdd §10: glowing orbs — 0.45m sphere with a
// fresnel rim shader, color = HSL(hash(playerId)), cheap glow sprite, and a
// nametag canvas sprite (IBM Plex Mono 24px, phosphor #FFB64A, fading >40m).
// Interpolation: 100ms buffer (INTERPOLATION_DELAY_MS), catmull-rom position
// + shortest-arc yaw slerp. Only orbs in the local player's realm render.
// ============================================================================

import * as THREE from 'three';

import type { RealmId, RemoteAnim, RemotePlayer } from '../../../contracts/types';
import type { SnapshotPlayer } from '../../../contracts/netcode';
import { INTERPOLATION_DELAY_MS, SNAPSHOT_BUFFER_SIZE } from '../../../contracts/netcode';

import { catmullRom, slerpYaw } from './interp';

const ORB_RADIUS = 0.45;
const NAMETAG_FADE_START_M = 40;
const NAMETAG_FADE_END_M = 55;
const NAMETAG_COLOR = '#FFB64A';
const NAMETAG_FONT = '24px "IBM Plex Mono", monospace';

const ANIMS: readonly RemoteAnim[] = ['idle', 'run', 'attack', 'block', 'cast', 'dead'];

interface OrbSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: RemoteAnim;
}

interface Orb {
  group: THREE.Group;
  sphere: THREE.Mesh;
  material: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  glowMaterial: THREE.SpriteMaterial;
  tag: THREE.Sprite;
  tagMaterial: THREE.SpriteMaterial;
  baseColor: THREE.Color;
  flare: number;
  phase: number;
  lastAnim: RemoteAnim;
}

// ---------------------------------------------------------------------------
// shaders / textures
// ---------------------------------------------------------------------------

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRESNEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.0);
    vec3 col = uColor * (0.35 + fres * 1.6) * uPulse;
    float alpha = clamp(0.35 + fres * 0.65, 0.0, 1.0) * clamp(uPulse, 0.0, 1.6);
    gl_FragColor = vec4(col, alpha);
  }
`;

let glowTexture: THREE.CanvasTexture | null = null;

function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

function makeNametag(name: string): { texture: THREE.CanvasTexture; aspect: number } {
  const width = 256;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (g) {
    g.clearRect(0, 0, width, height);
    g.font = NAMETAG_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = NAMETAG_COLOR;
    g.shadowBlur = 12;
    g.fillStyle = NAMETAG_COLOR;
    g.fillText(name, width / 2, height / 2, width - 16);
    g.shadowBlur = 0;
    g.fillText(name, width / 2, height / 2, width - 16);
  }
  return { texture: new THREE.CanvasTexture(canvas), aspect: width / height };
}

/** FNV-1a hash → HSL hue (stable per playerId). */
function colorForId(playerId: string): THREE.Color {
  let h = 0x811c9dc5;
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hue = (h >>> 0) % 360;
  const color = new THREE.Color();
  color.setHSL(hue / 360, 0.75, 0.62);
  return color;
}

// ---------------------------------------------------------------------------
// OrbRenderer
// ---------------------------------------------------------------------------

export class OrbRenderer {
  private readonly scene: THREE.Scene;
  private readonly buffers = new Map<string, OrbSample[]>();
  private readonly orbs = new Map<string, Orb>();
  private sphereGeo: THREE.SphereGeometry | null = null;
  /** Latest (serverTime − localNow) estimate; advances the interp clock. */
  private serverOffsetMs: number | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Push one snapshot's players into the per-player interpolation buffers. */
  ingest(players: SnapshotPlayer[], serverTime: number, selfId: string): void {
    this.serverOffsetMs = serverTime - performance.now();
    for (const p of players) {
      if (p.id === selfId) continue;
      let buf = this.buffers.get(p.id);
      if (!buf) {
        buf = [];
        this.buffers.set(p.id, buf);
      }
      const last = buf[buf.length - 1];
      // Stationary player: refresh the newest sample's timestamp instead of
      // growing the buffer with duplicates.
      if (last && p.p[0] === last.x && p.p[1] === last.y && p.p[2] === last.z && p.yaw === last.yaw && (ANIMS[p.anim] ?? 'idle') === last.anim) {
        last.t = serverTime;
        continue;
      }
      buf.push({
        t: serverTime,
        x: p.p[0],
        y: p.p[1],
        z: p.p[2],
        yaw: p.yaw,
        anim: ANIMS[p.anim] ?? 'idle',
      });
      if (buf.length > SNAPSHOT_BUFFER_SIZE) buf.splice(0, buf.length - SNAPSHOT_BUFFER_SIZE);
    }
  }

  /**
   * Per-rAF render update. `alive` = store.remotePlayers (store prunes ids
   * absent >3s); orbs outside the local realm are hidden, not deleted.
   */
  frame(
    dt: number,
    alive: Record<string, RemotePlayer>,
    myRealm: RealmId | null,
    camera: THREE.Camera,
  ): void {
    // Prune orbs the store has dropped.
    for (const [id, orb] of this.orbs) {
      if (!(id in alive)) {
        this.destroyOrb(id, orb);
      }
    }
    // Prune stale buffers with no orb (never rendered / left relevance).
    for (const id of this.buffers.keys()) {
      if (!(id in alive)) this.buffers.delete(id);
    }

    for (const id of Object.keys(alive)) {
      const buf = this.buffers.get(id);
      if (!buf || buf.length === 0) continue;
      const remote = alive[id];
      if (!remote) continue;

      let orb = this.orbs.get(id);
      if (!orb) {
        orb = this.createOrb(id, remote.name);
        this.orbs.set(id, orb);
      }

      // Realm gate: only render orbs in the local player's current realm.
      const visible = myRealm !== null && remote.realm === myRealm;
      orb.group.visible = visible;
      if (!visible) continue;

      // Interpolation target: 100ms behind the (advancing) server clock,
      // clamped to the newest buffered sample (no extrapolation).
      const newest = buf[buf.length - 1]!.t;
      const serverNow =
        this.serverOffsetMs !== null ? performance.now() + this.serverOffsetMs : newest;
      const target = Math.min(serverNow - INTERPOLATION_DELAY_MS, newest);
      const pos = this.sampleAt(buf, target);
      if (!pos) continue;

      // Anim-driven motion/pulse.
      orb.flare = Math.max(0, orb.flare - dt * 1.6);
      if (pos.anim === 'attack' && orb.lastAnim !== 'attack') orb.flare = 1;
      orb.lastAnim = pos.anim;

      let bob = 0;
      if (pos.anim === 'run') bob = Math.abs(Math.sin(performance.now() / 1000 * 8 + orb.phase)) * 0.12;
      orb.group.position.set(pos.x, pos.y + ORB_RADIUS + bob, pos.z);
      orb.group.rotation.y = pos.yaw;

      let pulse = 1 + orb.flare * 1.8 + Math.sin(performance.now() / 1000 * 3 + orb.phase) * 0.08;
      if (pos.anim === 'cast') pulse = 1.4 + Math.sin(performance.now() / 1000 * 10 + orb.phase) * 0.3;
      else if (pos.anim === 'block') pulse = 0.7;
      else if (pos.anim === 'dead') pulse = 0.35;
      orb.material.uniforms.uPulse!.value = pulse;
      orb.glowMaterial.opacity = 0.55 * Math.min(pulse, 1.4);

      const scale = 1 + orb.flare * 0.35;
      orb.sphere.scale.setScalar(scale);

      // Nametag: always faces camera (sprite); fades out beyond 40m.
      const dist = camera.position.distanceTo(orb.group.position);
      const fade =
        dist <= NAMETAG_FADE_START_M
          ? 1
          : Math.max(0, 1 - (dist - NAMETAG_FADE_START_M) / (NAMETAG_FADE_END_M - NAMETAG_FADE_START_M));
      orb.tagMaterial.opacity = fade;
      orb.tag.visible = fade > 0.01;
    }
  }

  dispose(): void {
    for (const [id, orb] of this.orbs) this.destroyOrb(id, orb);
    this.orbs.clear();
    this.buffers.clear();
    this.sphereGeo?.dispose();
    this.sphereGeo = null;
  }

  // ------------------------------------------------------------- internals

  private sampleAt(buf: OrbSample[], target: number): { x: number; y: number; z: number; yaw: number; anim: RemoteAnim } | null {
    const n = buf.length;
    if (n === 0) return null;
    const newest = buf[n - 1]!;
    if (target >= newest.t) {
      return { x: newest.x, y: newest.y, z: newest.z, yaw: newest.yaw, anim: newest.anim };
    }
    const oldest = buf[0]!;
    if (target <= oldest.t) {
      return { x: oldest.x, y: oldest.y, z: oldest.z, yaw: oldest.yaw, anim: oldest.anim };
    }
    // Find i with buf[i].t <= target < buf[i+1].t.
    let i = n - 2;
    while (i > 0 && buf[i]!.t > target) i--;
    const s0 = buf[Math.max(0, i - 1)]!;
    const s1 = buf[i]!;
    const s2 = buf[i + 1]!;
    const s3 = buf[Math.min(n - 1, i + 2)]!;
    const span = s2.t - s1.t;
    const t = span > 0 ? (target - s1.t) / span : 0;
    return {
      x: catmullRom(s0.x, s1.x, s2.x, s3.x, t),
      y: catmullRom(s0.y, s1.y, s2.y, s3.y, t),
      z: catmullRom(s0.z, s1.z, s2.z, s3.z, t),
      yaw: slerpYaw(s1.yaw, s2.yaw, t), // shortest-arc yaw slerp
      anim: t < 0.5 ? s1.anim : s2.anim,
    };
  }

  private createOrb(playerId: string, name: string): Orb {
    this.sphereGeo ??= new THREE.SphereGeometry(ORB_RADIUS, 24, 18);
    const baseColor = colorForId(playerId);

    const material = new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT,
      fragmentShader: FRESNEL_FRAG,
      uniforms: {
        uColor: { value: baseColor.clone() },
        uPulse: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sphere = new THREE.Mesh(this.sphereGeo, material);

    const glowMaterial = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: baseColor.clone(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.setScalar(1.8);

    const { texture, aspect } = makeNametag(name);
    const tagMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const tag = new THREE.Sprite(tagMaterial);
    tag.scale.set(0.55 * aspect, 0.55, 1);
    tag.position.y = ORB_RADIUS + 0.55;

    const group = new THREE.Group();
    group.add(sphere);
    group.add(glow);
    group.add(tag);
    group.visible = false;
    this.scene.add(group);

    return {
      group,
      sphere,
      material,
      glow,
      glowMaterial,
      tag,
      tagMaterial,
      baseColor,
      flare: 0,
      phase: Math.random() * Math.PI * 2,
      lastAnim: 'idle',
    };
  }

  private destroyOrb(id: string, orb: Orb): void {
    this.scene.remove(orb.group);
    orb.material.dispose();
    orb.glowMaterial.dispose();
    orb.tagMaterial.map?.dispose();
    orb.tagMaterial.dispose();
    this.orbs.delete(id);
  }
}
