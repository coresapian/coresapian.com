// ============================================================================
// CORESAPIAN — src/game/Game.ts
// Engine facade — THE ONLY engine surface React touches (gdd.md §3.1 +
// integration addendum §3). Owns the WebGLRenderer, shared scene + camera,
// the fixed-60Hz stage-ordered loop (gdd §3.3 / addendum §1), the engine
// core (input/physics/camera/interact/player services), the loading driver
// (gdd §11.1), quality auto-scaling, resize, and HMR-safe dispose.
//
// Public API (LOCKED): constructor(opts) / use() / start() / dispose()
//                      + loading / onLoadingChange(cb) / interactChannel
//                      + bootstrapGame(opts) composing the 6 pinned factories.
// ============================================================================

import * as THREE from 'three';

import type { UseGameStore } from './store';
import type { GameEventBus } from './events';
import type { GameConfig } from './config';
import { GAME_CONFIG, MAX_SIM_STEPS, SIM_DT } from './config';
import { ServiceRegistry } from './services';
import { EngineCore } from './engine/core';
import { QualityScaler } from './engine/quality';
import { createWorldSubsystem } from './world';
import { createAISubsystem } from './ai';
import { createCombatSubsystem } from './combat';
import { createRpgSubsystem } from './rpg';
import { createNetSubsystem } from './net';
import { createAudioSubsystem } from './audio';

// ---------------------------------------------------------------------------
// Public contracts (gdd.md §3.1/§3.2 + addendum §2/§3 — LOCKED)
// ---------------------------------------------------------------------------

export interface GameOptions {
  canvas: HTMLCanvasElement;
  /** zustand bound store from scaffold. */
  store: UseGameStore;
  /** Typed bus from scaffold (gdd.md §3.4). */
  events: GameEventBus;
}

export interface GameContext {
  canvas: HTMLCanvasElement;
  store: UseGameStore;
  events: GameEventBus;
  /** Shared scene graph root. */
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** From src/game/config (frozen). */
  config: GameConfig;
  /** Cross-agent service registry (addendum §2). */
  services: ServiceRegistry;
  /** Sim clock state for the current step. */
  time: { now: number; dt: number; alpha: number; tick: number };
}

export interface GameSubsystem {
  readonly id: string;
  init(ctx: GameContext): void;
  /** Fixed 60Hz simulation step. ORDER IS FIXED (§3.3), not registration order. */
  fixedUpdate?(dt: number): void;
  /** Per-rAF frame (render, interpolation, FX). */
  update?(dt: number, alpha: number): void;
  dispose(): void;
}

/** gdd §11.1 loading stages, ui reads this (addendum §3). */
export interface LoadingState {
  stage: 1 | 2 | 3 | 4;
  label: string;
  progress: number;
  done: boolean;
}

// ---------------------------------------------------------------------------
// Stage ordering (addendum §1 — pinned; NOT registration order)
// ---------------------------------------------------------------------------

/** fixedUpdate: core(input→physics) → ai → combat → rpg → world → net → audio. */
const FIXED_STAGE_RANK: Record<string, number> = {
  ai: 10,
  combat: 20,
  rpg: 30,
  world: 40,
  net: 50,
  audio: 60,
};

/**
 * update: world → combat → net → audio → engine render (last). ai / rpg are
 * unpinned by the addendum; they slot between world and combat.
 */
const UPDATE_STAGE_RANK: Record<string, number> = {
  world: 10,
  ai: 20,
  rpg: 30,
  combat: 40,
  net: 50,
  audio: 60,
};

const UNKNOWN_STAGE_RANK = 999;

// ---------------------------------------------------------------------------
// Loading driver (gdd §11.1 — labels + weights are design-pinned)
// ---------------------------------------------------------------------------

const LOADING_STAGES = [
  { stage: 1, label: '> forging miðgarðr…', weight: 0.4 },
  { stage: 2, label: '> kindling sky and fog…', weight: 0.2 },
  { stage: 3, label: '> waking spirits…', weight: 0.2 },
  { stage: 4, label: '> opening bifröst…', weight: 0.2 },
] as const;

/** Stage 4 completes on net `connected` or after this timeout (non-blocking). */
const NET_CONNECT_TIMEOUT_MS = 4000;

/** Boot background before the world installs its sky (site abyss token). */
const COLOR_ABYSS = 0x0c0e11;
/** Camera frustum (not contract-covered): near for viewmodels, far past the
 *  200m world radius (contracts/realms.ts WORLD_RADIUS_M) + sky shells. */
const CAMERA_NEAR_M = 0.1;
const CAMERA_FAR_M = 800;
/** Hard clamp on a single rAF delta so tab-switch hitches can't explode the
 *  accumulator (spiral-of-death guard, gdd §3.3). */
const MAX_FRAME_DT_S = 0.25;

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export class Game {
  /** Loading progress for the ui boot sequence (addendum §3). */
  readonly loading: LoadingState = {
    stage: 1,
    label: LOADING_STAGES[0].label,
    progress: 0,
    done: false,
  };

  /** Live interact-channel state for the ui channel ring (deliverable §8). */
  readonly interactChannel: { active: boolean; progress: number } = {
    active: false,
    progress: 0,
  };

  private readonly canvas: HTMLCanvasElement;
  private readonly store: UseGameStore;
  private readonly events: GameEventBus;
  private readonly subsystems: GameSubsystem[] = [];

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private services: ServiceRegistry | null = null;
  private core: EngineCore | null = null;
  private quality: QualityScaler | null = null;

  /** Stable clock object shared with subsystems via GameContext. */
  private readonly time = { now: 0, dt: 0, alpha: 0, tick: 0 };
  private simNow = 0;

  /** Subsystems that completed init, dispatch lists in pinned stage order. */
  private readonly activeSubsystems: GameSubsystem[] = [];
  private fixedList: GameSubsystem[] = [];
  private updateList: GameSubsystem[] = [];
  private readonly initializedIds = new Set<string>();

  private readonly loadingListeners = new Set<(s: LoadingState) => void>();
  private cancelNetWait: (() => void) | null = null;

  private rafId = 0;
  private lastFrameTs = 0;
  private accumulator = 0;
  private started = false;
  private disposed = false;

  private readonly onResize = (): void => this.resize();

  constructor(opts: GameOptions) {
    this.canvas = opts.canvas;
    this.store = opts.store;
    this.events = opts.events;
  }

  /** Register a subsystem. Call before start(). Order = init order. */
  use(subsystem: GameSubsystem): this {
    if (this.started) {
      console.warn('[game] use() called after start(); subsystem will not init', subsystem.id);
      return this;
    }
    this.subsystems.push(subsystem);
    return this;
  }

  /** Loading-state subscription for ui (addendum §3). */
  onLoadingChange(cb: (s: LoadingState) => void): () => void {
    this.loadingListeners.add(cb);
    return () => {
      this.loadingListeners.delete(cb);
    };
  }

  /**
   * World→screen projection for DOM overlays (damage numbers, markers).
   * Returns CSS pixel coords relative to the canvas + visibility flag.
   */
  projectToScreen(v: { x: number; y: number; z: number }): { x: number; y: number; visible: boolean } {
    if (!this.camera || !this.canvas) return { x: 0, y: 0, visible: false };
    const p = new THREE.Vector3(v.x, v.y, v.z).project(this.camera);
    const visible = p.z < 1 && p.x >= -1.1 && p.x <= 1.1 && p.y >= -1.1 && p.y <= 1.1;
    return {
      x: (p.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-p.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible,
    };
  }

  /** Boots renderer, engine core, subsystems (via loading driver), loop. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;

    this.initRenderer();
    if (!this.renderer || !this.scene || !this.camera) return; // WebGL unavailable

    // Engine core inits FIRST, before any subsystem init (addendum §1/§2):
    // registers `player`, `interactables`, `input` into the service registry.
    const services = new ServiceRegistry();
    this.services = services;
    this.core = new EngineCore({
      canvas: this.canvas,
      store: this.store,
      events: this.events,
      scene: this.scene,
      camera: this.camera,
      services,
      homeRealm: GAME_CONFIG.homeRealm,
      interactChannel: this.interactChannel,
    });

    const ctx = this.buildContext();

    window.addEventListener('resize', this.onResize);
    this.lastFrameTs = performance.now();
    this.rafId = requestAnimationFrame(this.frame);

    // Subsystems init through the loading driver (gdd §11.1 stage order).
    void this.runLoading(ctx);
  }

  /** Tears down renderer, listeners, subsystems (HMR-safe). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.cancelNetWait?.();
    this.cancelNetWait = null;
    this.loadingListeners.clear();

    // Reverse-init order for teardown.
    for (const subsystem of [...this.activeSubsystems].reverse()) {
      try {
        subsystem.dispose();
      } catch (err) {
        console.error(`[game] subsystem "${subsystem.id}" dispose failed`, err);
      }
    }
    this.activeSubsystems.length = 0;
    this.fixedList = [];
    this.updateList = [];
    this.initializedIds.clear();

    this.core?.dispose();
    this.core = null;

    if (this.scene) this.disposeSceneGraph(this.scene);
    if (this.renderer) {
      this.renderer.dispose();
      // Release the GL context so HMR / remount gets a fresh one cleanly.
      this.renderer.forceContextLoss();
      // NOTE: the canvas element is React-owned — never remove it from the DOM.
    }

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.services = null;
    this.quality = null;
  }

  // ------------------------------------------------------------------ setup

  private initRenderer(): void {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      console.error('[game] WebGLRenderer creation failed', err);
      return;
    }
    // Deliverable §1: ACES tone mapping, sRGB output, PCF soft shadows.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR_ABYSS);

    // FOV from settings; the camera rig re-reads it per frame (plus kicks).
    this.camera = new THREE.PerspectiveCamera(
      this.store.getState().fov,
      1,
      CAMERA_NEAR_M,
      CAMERA_FAR_M,
    );

    // Pixel ratio capped by settings.quality + auto-scaler (deliverable §1).
    this.quality = new QualityScaler(this.renderer, this.store);

    this.resize();
  }

  private buildContext(): GameContext {
    if (!this.renderer || !this.scene || !this.camera || !this.services) {
      throw new Error('[game] buildContext before renderer init');
    }
    return {
      canvas: this.canvas,
      store: this.store,
      events: this.events,
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      config: GAME_CONFIG,
      services: this.services,
      time: this.time,
    };
  }

  // ------------------------------------------------------------- loading driver

  /**
   * gdd §11.1 stage sequence. Stage 1–2 = world (terrain, then sky/fx),
   * stage 3 = ai/combat/rpg, stage 4 = net (non-blocking) + audio.
   * `loading.done = true` after stage 3 — the player may move (addendum §3).
   */
  private async runLoading(ctx: GameContext): Promise<void> {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    // --- stage 1: terrain heightfield + props (world init) ---
    this.setLoading({ stage: 1, label: LOADING_STAGES[0].label, progress: 0 });
    this.initSubsystem('world', ctx);
    this.setLoading({ progress: LOADING_STAGES[0].weight });
    await nextFrame(); // world ready: await one frame after world init
    if (this.disposed) return;
    this.core?.onWorldReady(); // terrain service is live → spawn the player

    // --- stage 2: lighting, sky, env (world-owned; a frame so ui shows it) ---
    this.setLoading({ stage: 2, label: LOADING_STAGES[1].label });
    await nextFrame();
    if (this.disposed) return;
    this.setLoading({ progress: LOADING_STAGES[0].weight + LOADING_STAGES[1].weight });

    // --- stage 3: enemies, NPCs, quest state ---
    this.setLoading({ stage: 3, label: LOADING_STAGES[2].label });
    this.initSubsystem('ai', ctx);
    this.initSubsystem('combat', ctx);
    this.initSubsystem('rpg', ctx);
    // Any subsystem without a pinned stage inits here, in registration order.
    for (const sub of this.subsystems) {
      if (sub.id !== 'net' && sub.id !== 'audio') this.initSubsystem(sub.id, ctx);
    }
    this.setLoading({
      progress: LOADING_STAGES[0].weight + LOADING_STAGES[1].weight + LOADING_STAGES[2].weight,
    });
    await nextFrame();
    if (this.disposed) return;
    this.setLoading({ done: true }); // player spawns + moves (gdd §11.1)

    // --- stage 4: WS hello (NON-BLOCKING) + audio ---
    this.setLoading({ stage: 4, label: LOADING_STAGES[3].label });
    this.initSubsystem('net', ctx);
    this.initSubsystem('audio', ctx);
    await this.waitForNetConnect();
    if (this.disposed) return;
    this.setLoading({ progress: 1 });
  }

  private initSubsystem(id: string, ctx: GameContext): void {
    if (this.initializedIds.has(id)) return;
    const subsystem = this.subsystems.find((s) => s.id === id);
    if (!subsystem) return;
    this.initializedIds.add(id);
    try {
      subsystem.init(ctx);
    } catch (err) {
      console.error(`[game] subsystem "${id}" init failed`, err);
    }
    this.addActive(subsystem);
  }

  private addActive(subsystem: GameSubsystem): void {
    this.activeSubsystems.push(subsystem);
    this.fixedList = [...this.activeSubsystems].sort(
      (a, b) =>
        (FIXED_STAGE_RANK[a.id] ?? UNKNOWN_STAGE_RANK) -
        (FIXED_STAGE_RANK[b.id] ?? UNKNOWN_STAGE_RANK),
    );
    this.updateList = [...this.activeSubsystems].sort(
      (a, b) =>
        (UPDATE_STAGE_RANK[a.id] ?? UNKNOWN_STAGE_RANK) -
        (UPDATE_STAGE_RANK[b.id] ?? UNKNOWN_STAGE_RANK),
    );
  }

  /** Resolves when net reports `connected`, or after the 4s timeout. */
  private waitForNetConnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.store.getState().status === 'connected') {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, NET_CONNECT_TIMEOUT_MS);
      const unsub = this.store.subscribe((state) => {
        if (state.status === 'connected') {
          cleanup();
          resolve();
        }
      });
      const cleanup = (): void => {
        clearTimeout(timer);
        unsub();
        this.cancelNetWait = null;
      };
      this.cancelNetWait = () => {
        cleanup();
        resolve();
      };
    });
  }

  private setLoading(patch: Partial<LoadingState>): void {
    Object.assign(this.loading, patch);
    for (const cb of [...this.loadingListeners]) {
      try {
        cb(this.loading);
      } catch (err) {
        console.error('[game] loading listener threw', err);
      }
    }
  }

  // ------------------------------------------------------------------- loop

  private readonly frame = (ts: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);

    const frameMs = ts - this.lastFrameTs;
    const frameDt = Math.min(frameMs / 1000, MAX_FRAME_DT_S);
    this.lastFrameTs = ts;
    this.accumulator += frameDt;

    // Fixed 60Hz sim, max 5 catch-up steps; drop remainder (gdd §3.3).
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_SIM_STEPS) {
      this.accumulator -= SIM_DT;
      steps += 1;
      this.simNow += SIM_DT;
      this.time.tick += 1;
      this.time.now = this.simNow;
      this.time.dt = SIM_DT;

      // Stage 1–2 (core): input → physics (+interact). Then pinned order:
      // ai → combat → rpg → world(events) → net → audio (addendum §1).
      this.core?.fixedUpdate(SIM_DT);
      for (const subsystem of this.fixedList) {
        try {
          subsystem.fixedUpdate?.(SIM_DT);
        } catch (err) {
          console.error(`[game] subsystem "${subsystem.id}" fixedUpdate threw`, err);
        }
      }
      // The event bus (events.ts) dispatches synchronously — emitters may
      // fire anytime and listeners always see a consistent store; there is
      // no queue to flush at the end of a fixed step.
    }
    if (steps === MAX_SIM_STEPS && this.accumulator >= SIM_DT) this.accumulator = 0;

    const alpha = this.accumulator / SIM_DT;
    this.time.now = ts / 1000;
    this.time.dt = frameDt;
    this.time.alpha = alpha;

    // update order: world → combat → net → audio (addendum §1).
    for (const subsystem of this.updateList) {
      try {
        subsystem.update?.(frameDt, alpha);
      } catch (err) {
        console.error(`[game] subsystem "${subsystem.id}" update threw`, err);
      }
    }

    // Engine renders LAST: camera rig, then the frame itself.
    this.core?.update(frameDt);
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }

    // Quality auto-scaler observes real (unclamped) frame time.
    this.quality?.frame(frameMs);
  };

  // ----------------------------------------------------------------- helpers

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private disposeSceneGraph(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const material = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      } else if (obj instanceof THREE.Sprite) {
        const material = obj.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      } else if (obj instanceof THREE.Line || obj instanceof THREE.Points) {
        // Lines and points also carry geometry + material resources.
        (obj.geometry as THREE.BufferGeometry | undefined)?.dispose();
        const material = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// bootstrapGame (addendum §3): composes all 6 pinned factories in init order
// world → ai → combat → rpg → net → audio.
// ---------------------------------------------------------------------------

export function bootstrapGame(opts: GameOptions): Game {
  const game = new Game(opts);
  game.use(createWorldSubsystem());
  game.use(createAISubsystem());
  game.use(createCombatSubsystem());
  game.use(createRpgSubsystem());
  game.use(createNetSubsystem());
  game.use(createAudioSubsystem());
  return game;
}
