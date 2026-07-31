// ============================================================================
// CORESAPIAN — src/game/config/math.ts (SCAFFOLD-OWNED, FROZEN)
// Small scalar math helpers shared by every engine-side agent. No deps.
// ============================================================================

/** Clamp `v` into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation from `a` to `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing ("damp").
 * Moves `current` toward `target` with time constant ~1/`lambda` seconds.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Smoothstep (cubic Hermite) from `edge0` to `edge1` at `x`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
