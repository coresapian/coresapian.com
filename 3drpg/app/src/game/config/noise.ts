// ============================================================================
// CORESAPIAN — src/game/config/noise.ts (SCAFFOLD-OWNED, FROZEN)
// Seeded RNG (mulberry32), 2D simplex noise, and an fbm helper.
// Self-contained: no dependencies. Deterministic for a given seed so world
// generation is reproducible client-side and matches server-seeded events.
// ============================================================================

/** mulberry32 — fast seeded PRNG, returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 2D simplex noise (Gustavson-style), permutation table seeded via mulberry32.
// ---------------------------------------------------------------------------

const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Skewing factors for 2D simplex. */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export interface Simplex2D {
  /** Noise value in [-1, 1]. */
  noise(x: number, y: number): number;
}

/** Create a seeded 2D simplex noise source. */
export function createSimplex2D(seed: number): Simplex2D {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher–Yates shuffle with the seeded PRNG.
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  function noise(xin: number, yin: number): number {
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const g0 = GRAD2[perm[ii + perm[jj]!]! % 8]!;
      t0 *= t0;
      n0 = t0 * t0 * (g0[0] * x0 + g0[1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const g1 = GRAD2[perm[ii + i1 + perm[jj + j1]!]! % 8]!;
      t1 *= t1;
      n1 = t1 * t1 * (g1[0] * x1 + g1[1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const g2 = GRAD2[perm[ii + 1 + perm[jj + 1]!]! % 8]!;
      t2 *= t2;
      n2 = t2 * t2 * (g2[0] * x2 + g2[1] * y2);
    }

    // Scaled to [-1, 1].
    return 70 * (n0 + n1 + n2);
  }

  return { noise };
}

// ---------------------------------------------------------------------------
// fbm — fractal Brownian motion over a simplex source.
// ---------------------------------------------------------------------------

export interface FbmOptions {
  /** Number of noise layers. Default 4. */
  octaves?: number;
  /** Frequency multiplier per octave. Default 2. */
  lacunarity?: number;
  /** Amplitude multiplier per octave. Default 0.5. */
  gain?: number;
}

/**
 * Fractal Brownian motion. Returns values roughly in [-1, 1]
 * (normalized by total amplitude).
 */
export function fbm(
  simplex: Simplex2D,
  x: number,
  y: number,
  options: FbmOptions = {},
): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = options;
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * simplex.noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
