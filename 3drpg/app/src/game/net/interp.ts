// ============================================================================
// CORESAPIAN — src/game/net/interp.ts (audio-net)
//
// Snapshot interpolation math (gdd §10): catmull-rom position +
// shortest-arc yaw slerp over the 100ms interpolation buffer.
// ============================================================================

/** Catmull-rom spline interpolation between p1..p2 (t ∈ 0..1). */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3)
  );
}

/** Wrap an angle delta to (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** Shortest-arc yaw interpolation. */
export function slerpYaw(yaw1: number, yaw2: number, t: number): number {
  return yaw1 + wrapAngle(yaw2 - yaw1) * t;
}
