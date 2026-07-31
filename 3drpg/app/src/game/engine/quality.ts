// ============================================================================
// CORESAPIAN — src/game/engine/quality.ts (ENGINE-OWNED)
// Renderer resolution management: settings.quality caps the base pixel ratio
// (deliverable §1), and a sustained-frame-time auto-scaler steps render scale
// down when the GPU can't hold budget (> 22ms sustained), recovering when
// headroom returns. User quality changes reset the auto-scale.
// ============================================================================

import type { WebGLRenderer } from 'three';

import type { UseGameStore } from '../store';

/** Frame budget: above this sustained average we scale down (ms). */
const OVER_BUDGET_MS = 22;
/** Below this sustained average we consider scaling back up (ms). */
const UNDER_BUDGET_MS = 14;
/** Sustained windows before a scale step (seconds). */
const DOWN_WINDOW_S = 1.5;
const UP_WINDOW_S = 6;
/** Cooldown between resolution changes (seconds). */
const CHANGE_COOLDOWN_S = 2;

/** Render-scale ladder applied on top of the quality-capped pixel ratio. */
const SCALE_STEPS = [1, 0.85, 0.72, 0.6, 0.5];

export class QualityScaler {
  private readonly renderer: WebGLRenderer;
  private readonly store: UseGameStore;

  private emaFrameMs = 16.7;
  private overBudgetS = 0;
  private underBudgetS = 0;
  private lastChangeAt = 0;
  private elapsedS = 0;
  private scaleIndex = 0;
  private lastQuality = '';

  constructor(renderer: WebGLRenderer, store: UseGameStore) {
    this.renderer = renderer;
    this.store = store;
    this.apply();
  }

  /** Base pixel ratio cap per settings.quality (deliverable §1). */
  private basePixelRatio(): number {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const quality = this.store.getState().quality;
    switch (quality) {
      case 'low':
        return 1;
      case 'medium':
        return Math.min(dpr, 1.5);
      case 'high':
      default:
        return Math.min(dpr, 2);
    }
  }

  private apply(): void {
    const ratio = this.basePixelRatio() * SCALE_STEPS[this.scaleIndex];
    this.renderer.setPixelRatio(ratio);
  }

  /** Feed one rendered frame's wall-clock duration (ms). */
  frame(frameMs: number): void {
    this.elapsedS += frameMs / 1000;
    // EMA smooths single-frame spikes.
    this.emaFrameMs += (frameMs - this.emaFrameMs) * 0.05;

    const quality = this.store.getState().quality;
    if (quality !== this.lastQuality) {
      // User intent wins: reset auto-scale to the new cap.
      this.lastQuality = quality;
      this.scaleIndex = 0;
      this.overBudgetS = 0;
      this.underBudgetS = 0;
      this.apply();
      return;
    }

    if (this.elapsedS - this.lastChangeAt < CHANGE_COOLDOWN_S) return;

    if (this.emaFrameMs > OVER_BUDGET_MS) {
      this.overBudgetS += frameMs / 1000;
      this.underBudgetS = 0;
      if (this.overBudgetS >= DOWN_WINDOW_S && this.scaleIndex < SCALE_STEPS.length - 1) {
        this.scaleIndex += 1;
        this.overBudgetS = 0;
        this.lastChangeAt = this.elapsedS;
        this.apply();
      }
    } else if (this.emaFrameMs < UNDER_BUDGET_MS) {
      this.underBudgetS += frameMs / 1000;
      this.overBudgetS = 0;
      if (this.underBudgetS >= UP_WINDOW_S && this.scaleIndex > 0) {
        this.scaleIndex -= 1;
        this.underBudgetS = 0;
        this.lastChangeAt = this.elapsedS;
        this.apply();
      }
    } else {
      this.overBudgetS = 0;
      this.underBudgetS = 0;
    }
  }

  /** Current effective render scale (1 = full quality cap). */
  getRenderScale(): number {
    return SCALE_STEPS[this.scaleIndex];
  }
}
