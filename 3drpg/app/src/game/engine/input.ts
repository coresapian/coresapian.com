// ============================================================================
// CORESAPIAN — src/game/engine/input.ts (ENGINE-OWNED)
// Pointer lock, mouse look, WASD movement intent, and the locked gameplay
// action set (gdd.md §4 + addendum §4). Implements the frozen InputService
// seam (src/game/services.ts) so combat-ai / rpg-quests can subscribe to
// action edges and poll held state.
//
// Key ownership: engine NEVER binds Tab / K / J / M / Esc — ui owns those
// (addendum §4). Engine suspends all gameplay input while
// `activeMenu !== 'none'` or `dead === true` and releases pointer lock.
// ============================================================================

import type { GameEventBus } from '../events';
import type { InputService } from '../services';
import type { UseGameStore } from '../store';

/** gdd.md §4: look = mouseSensitivity × 0.0022 rad/px. */
const LOOK_RAD_PER_PX = 0.0022;
/** Pitch clamp — keep a hair off the poles so the camera basis stays stable. */
const PITCH_LIMIT = Math.PI / 2 - 0.001;

/** Locked action names (addendum §4). */
export const INPUT_ACTIONS = [
  'attack',
  'block',
  'interact',
  'jump',
  'sprint',
  'dodge',
  'swapArms',
  'realmAbility',
  'rune1',
  'rune2',
  'rune3',
  'rune4',
  'hotbar1',
  'hotbar2',
  'hotbar3',
  'hotbar4',
] as const;

export type InputAction = (typeof INPUT_ACTIONS)[number];

type ActionPhase = 'down' | 'up';
type ActionListener = (phase: ActionPhase) => void;

/** Keyboard (event.code) → action. Layout-independent, locked defaults. */
const KEY_ACTIONS: Record<string, InputAction> = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  AltLeft: 'dodge',
  KeyE: 'interact',
  KeyH: 'swapArms',
  KeyC: 'realmAbility',
  KeyQ: 'rune1',
  KeyR: 'rune2',
  KeyF: 'rune3',
  KeyV: 'rune4',
  Digit1: 'hotbar1',
  Digit2: 'hotbar2',
  Digit3: 'hotbar3',
  Digit4: 'hotbar4',
};

/** Mouse button index → action (only while pointer-locked). */
const MOUSE_ACTIONS: Record<number, InputAction> = {
  0: 'attack',
  2: 'block',
};

export interface EngineInputDeps {
  canvas: HTMLCanvasElement;
  store: UseGameStore;
  events: GameEventBus;
}

export class EngineInput implements InputService {
  private readonly canvas: HTMLCanvasElement;
  private readonly store: UseGameStore;
  private readonly events: GameEventBus;

  /** Physical key/button state (tracks hardware regardless of suspension). */
  private readonly keysDown = new Set<string>();
  private readonly mouseDown = new Set<number>();
  /** Effective (post-suspension) action state diffed each fixed step. */
  private readonly actionDown = new Set<string>();
  private readonly listeners = new Map<string, Set<ActionListener>>();

  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private suspended = false;
  private disposed = false;

  constructor(deps: EngineInputDeps) {
    this.canvas = deps.canvas;
    this.store = deps.store;
    this.events = deps.events;

    this.canvas.addEventListener('click', this.onCanvasClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onWindowBlur);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onWindowBlur);
    if (this.pointerLocked) this.exitPointerLock();
    this.listeners.clear();
    this.keysDown.clear();
    this.mouseDown.clear();
    this.actionDown.clear();
  }

  // ------------------------------------------------------------- InputService

  isDown(action: string): boolean {
    return this.actionDown.has(action);
  }

  onAction(action: string, cb: ActionListener): () => void {
    let set = this.listeners.get(action);
    if (!set) {
      set = new Set();
      this.listeners.set(action, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.listeners.delete(action);
    };
  }

  // ---------------------------------------------------------------- look state

  getYaw(): number {
    return this.yaw;
  }

  getPitch(): number {
    return this.pitch;
  }

  /** Teleport / spawn may re-orient the player (services.ts PlayerService). */
  setLook(yaw: number, pitch?: number): void {
    this.yaw = yaw;
    if (pitch !== undefined) this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  /** Normalized WASD intent: x = strafe right (+), z = forward (+). */
  getMoveIntent(): { x: number; z: number } {
    if (this.suspended) return { x: 0, z: 0 };
    let x = 0;
    let z = 0;
    if (this.keysDown.has('KeyW')) z += 1;
    if (this.keysDown.has('KeyS')) z -= 1;
    if (this.keysDown.has('KeyD')) x += 1;
    if (this.keysDown.has('KeyA')) x -= 1;
    if (x !== 0 && z !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      z *= inv;
    }
    return { x, z };
  }

  /**
   * Fixed-step stage 1 (gdd §3.3): recompute suspension, release pointer lock
   * when entering a menu / dying, and fire action edge events.
   */
  fixedUpdate(): void {
    const s = this.store.getState();
    const suspended = s.activeMenu !== 'none' || s.dead;
    if (suspended !== this.suspended) {
      this.suspended = suspended;
      if (suspended && this.pointerLocked) this.exitPointerLock();
    }

    for (const action of INPUT_ACTIONS) {
      const down = !suspended && this.rawActionDown(action);
      const was = this.actionDown.has(action);
      if (down === was) continue;
      if (down) this.actionDown.add(action);
      else this.actionDown.delete(action);
      this.fire(action, down ? 'down' : 'up');
    }
  }

  // ------------------------------------------------------------------ internals

  private rawActionDown(action: InputAction): boolean {
    switch (action) {
      case 'attack':
        return this.pointerLocked && this.mouseDown.has(0);
      case 'block':
        return this.pointerLocked && this.mouseDown.has(2);
      case 'jump':
        return this.keysDown.has('Space');
      case 'sprint':
        return this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
      case 'dodge':
        return this.keysDown.has('AltLeft');
      case 'interact':
        return this.keysDown.has('KeyE');
      case 'swapArms':
        return this.keysDown.has('KeyH');
      case 'realmAbility':
        return this.keysDown.has('KeyC');
      case 'rune1':
        return this.keysDown.has('KeyQ');
      case 'rune2':
        return this.keysDown.has('KeyR');
      case 'rune3':
        return this.keysDown.has('KeyF');
      case 'rune4':
        return this.keysDown.has('KeyV');
      case 'hotbar1':
        return this.keysDown.has('Digit1');
      case 'hotbar2':
        return this.keysDown.has('Digit2');
      case 'hotbar3':
        return this.keysDown.has('Digit3');
      case 'hotbar4':
        return this.keysDown.has('Digit4');
      default:
        return false;
    }
  }

  private fire(action: string, phase: ActionPhase): void {
    const set = this.listeners.get(action);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(phase);
      } catch (err) {
        console.error(`[input] listener for "${action}" threw`, err);
      }
    }
  }

  private requestPointerLock(): void {
    if (this.pointerLocked || this.suspended || this.disposed) return;
    try {
      // Chrome returns a promise that rejects if re-locked too quickly after
      // an Esc exit; that rejection is expected UX, swallow it.
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      /* pointer lock unavailable (iframe perms etc.) */
    }
  }

  private exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  // ------------------------------------------------------------------ handlers

  private readonly onCanvasClick = (): void => {
    this.requestPointerLock();
  };

  private readonly onContextMenu = (e: Event): void => {
    // RMB = block; never show the browser menu over the game canvas.
    e.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.pointerLocked) return;
    this.pointerLocked = locked;
    if (!locked) {
      // Losing lock drops held mouse buttons so attack/block can't stick.
      this.mouseDown.clear();
    }
    this.events.emit('pointer_lock', { locked });
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Engine never touches ui-owned menu keys (addendum §4): Tab K J M Escape.
    if (e.code === 'Tab' || e.code === 'KeyK' || e.code === 'KeyJ' || e.code === 'KeyM' || e.code === 'Escape') {
      return;
    }
    if (!(e.code in KEY_ACTIONS) && !this.isMovementKey(e.code)) return;
    // Keep Space/Alt from scrolling the page / focusing browser chrome.
    if (this.pointerLocked || e.code === 'Space' || e.code === 'AltLeft') e.preventDefault();
    if (e.repeat) return;
    this.keysDown.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    if (!(e.button in MOUSE_ACTIONS)) return;
    this.mouseDown.add(e.button);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.mouseDown.delete(e.button);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked || this.suspended) return;
    const settings = this.store.getState();
    const sens = settings.mouseSensitivity * LOOK_RAD_PER_PX;
    this.yaw -= e.movementX * sens;
    const dy = e.movementY * sens * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy));
  };

  private readonly onWindowBlur = (): void => {
    // Alt-tabbing away must not leave keys stuck down.
    this.keysDown.clear();
    this.mouseDown.clear();
  };

  private isMovementKey(code: string): boolean {
    return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD';
  }
}
