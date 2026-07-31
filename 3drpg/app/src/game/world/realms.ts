// ============================================================================
// CORESAPIAN — src/game/world/realms.ts
// Realm orchestration: implements the RealmService (addendum §7) — current(),
// isUnlocked() derived from quest chapter rewards, travelTo() with full
// teardown/regen + player teleport + portal_enter/realm_change events — and
// re-registers the TerrainService on every realm change.
// ============================================================================

import * as THREE from 'three';

import type { RealmId, Vec3 } from '../../../contracts/types';
import { HOME_REALM, REALMS } from '../../../contracts/realms';
import { QUESTS } from '../../../contracts/quests';
import { damp } from '../config';
import type { Collider, Interactable, RealmService } from '../services';

import { buildTerrain } from './terrain';
import type { TerrainBuild } from './terrain';
import { buildEnvironment } from './environment';
import type { EnvironmentBuild } from './environment';
import { buildProps } from './props';
import type { PropsBuild } from './props';
import { buildPortals } from './portals';
import type { PortalsBuild } from './portals';
import { buildNodes } from './nodes';
import type { NodesBuild } from './nodes';
import { createWorldEventsSim } from './events';
import type { WorldEventsSim } from './events';
import { getService } from './types';
import type { RealmBuildCtx, WorldContext } from './types';

// ---------------------------------------------------------------------------
// Bifröst flash — brief white-gold fade plane that covers realm regen
// ---------------------------------------------------------------------------

class FadeOverlay {
  private readonly ctx: WorldContext;
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly geo: THREE.PlaneGeometry;
  private readonly fwd = new THREE.Vector3();
  private opacity = 0;

  constructor(ctx: WorldContext) {
    this.ctx = ctx;
    this.geo = new THREE.PlaneGeometry(2.4, 2.4);
    this.mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffedc4'), // white-gold Bifröst
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = 9999;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'world:bifrost_fade';
    ctx.scene.add(this.mesh);
  }

  flash(strength = 0.95): void {
    this.opacity = strength;
  }

  update(dt: number): void {
    if (this.opacity > 0.004) {
      this.opacity = damp(this.opacity, 0, 2.4, dt);
      const cam = this.ctx.camera;
      this.fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.mesh.position.copy(cam.position).addScaledVector(this.fwd, 0.4);
      this.mesh.quaternion.copy(cam.quaternion);
      this.mat.opacity = this.opacity;
      this.mesh.visible = true;
    } else if (this.mesh.visible) {
      this.opacity = 0;
      this.mat.opacity = 0;
      this.mesh.visible = false;
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Active realm bundle
// ---------------------------------------------------------------------------

interface ActiveRealm {
  id: RealmId;
  root: THREE.Group;
  terrain: TerrainBuild;
  env: EnvironmentBuild;
  props: PropsBuild;
  portals: PortalsBuild;
  nodes: NodesBuild;
  unregisters: (() => void)[];
}

// ---------------------------------------------------------------------------
// RealmManager — RealmService + lifecycle
// ---------------------------------------------------------------------------

export class RealmManager implements RealmService {
  private readonly ctx: WorldContext;
  private realm: RealmId = HOME_REALM;
  private active: ActiveRealm | null = null;
  private readonly fade: FadeOverlay;
  private readonly eventsSim: WorldEventsSim;

  constructor(ctx: WorldContext) {
    this.ctx = ctx;
    this.fade = new FadeOverlay(ctx);
    this.eventsSim = createWorldEventsSim(ctx, {
      current: () => this.realm,
      sampleHeight: (x, z) => this.active?.terrain.sampleHeight(x, z) ?? 0,
    });
  }

  // ------------------------------------------------------------- RealmService

  current(): RealmId {
    return this.realm;
  }

  isUnlocked(id: RealmId): boolean {
    if (id === HOME_REALM) return true;
    const quests = this.ctx.store.getState().quests;
    for (const q of Object.values(QUESTS)) {
      if (q.rewards.unlockRealm === id && quests[q.id]?.status === 'completed') {
        return true;
      }
    }
    return false;
  }

  travelTo(id: RealmId, opts?: { spawnOverride?: Vec3 }): void {
    if (!REALMS[id]) return;
    if (this.active && id === this.realm) {
      // Server-restore into the already-active realm: move, don't rebuild.
      this.teleport(opts?.spawnOverride ?? this.active.terrain.service.getSpawnPoint());
      return;
    }
    const from = this.realm;
    this.realm = id;
    this.fade.flash();
    this.build(id, opts?.spawnOverride);
    this.ctx.events.emit('portal_enter', { to: id });
    this.ctx.events.emit('realm_change', { from, to: id });
    const cfg = REALMS[id];
    this.ctx.store.getState().notify('info', `${cfg.displayName} — ${cfg.oldNorse}`, 4500);
  }

  // --------------------------------------------------------------- lifecycle

  /** Called once from subsystem init: builds the home realm + registers services. */
  buildInitial(): void {
    this.ctx.services?.register('realms', this);
    this.build(this.realm, undefined);
  }

  fixedUpdate(dt: number): void {
    this.eventsSim.fixedUpdate(dt);
  }

  update(dt: number, elapsed: number): void {
    this.fade.update(dt);
    const a = this.active;
    if (!a) return;
    a.env.update?.(dt, elapsed);
    a.props.update?.(dt, elapsed);
    a.portals.update?.(dt, elapsed);
    a.nodes.update?.(dt, elapsed);
  }

  dispose(): void {
    this.teardown();
    this.eventsSim.dispose();
    this.fade.dispose();
  }

  // ---------------------------------------------------------------- internals

  private build(id: RealmId, spawnOverride?: Vec3): void {
    this.teardown();

    const config = REALMS[id];
    const root = new THREE.Group();
    root.name = `realm:${id}`;
    this.ctx.scene.add(root);

    const unregisters: (() => void)[] = [];
    const colliders: Collider[] = [];
    let sampler: (x: number, z: number) => number = () => 0;

    const bctx: RealmBuildCtx = {
      ctx: this.ctx,
      config,
      root,
      colliders,
      sampleHeight: (x, z) => sampler(x, z),
      sampleSlope: (x, z) => {
        const e = 1.2;
        const gx = (sampler(x + e, z) - sampler(x - e, z)) / (2 * e);
        const gz = (sampler(x, z + e) - sampler(x, z - e)) / (2 * e);
        const m = Math.hypot(gx, gz);
        return 1 - 1 / Math.sqrt(1 + m * m); // matches 1 - normalY
      },
      interact: (item: Interactable) => {
        const svc = getService(this.ctx, 'interactables');
        if (!svc) return;
        try {
          unregisters.push(svc.register(item));
        } catch (err) {
          console.warn('[world] interactable registration failed', err);
        }
      },
    };

    const terrain = buildTerrain(bctx);
    sampler = terrain.sampleHeight;

    const env = buildEnvironment(bctx);
    const props = buildProps(bctx);
    const portals = buildPortals(bctx, {
      isUnlocked: (to) => this.isUnlocked(to),
      travel: (to) => {
        this.ctx.events.emit('play_sfx', { sfxId: 'sfx.portal.travel' });
        this.travelTo(to);
      },
    });
    const nodes = buildNodes(bctx);

    this.active = { id, root, terrain, env, props, portals, nodes, unregisters };

    // TerrainService is re-registered on every realm change (addendum §2).
    this.ctx.services?.register('terrain', terrain.service);

    // Event spawns follow the current realm.
    this.eventsSim.onRealmChanged();

    // Move the player (no-op gracefully if the engine player isn't up yet).
    this.teleport(spawnOverride ?? terrain.service.getSpawnPoint());
  }

  private teardown(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    for (const unreg of a.unregisters.splice(0)) {
      try {
        unreg();
      } catch {
        /* registry may already be gone */
      }
    }
    a.nodes.dispose();
    a.portals.dispose();
    a.props.dispose();
    a.env.dispose();
    a.terrain.dispose();
    this.ctx.scene.remove(a.root);
  }

  private teleport(spawn: Vec3): void {
    const player = getService(this.ctx, 'player');
    if (!player) return;
    try {
      player.teleport(spawn);
    } catch (err) {
      console.warn('[world] player teleport failed', err);
    }
  }
}
