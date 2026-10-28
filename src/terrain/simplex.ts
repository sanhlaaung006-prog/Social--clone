/*
 * Seeded 2D simplex noise (Stefan Gustavson's public-domain algorithm)
 * plus fractal, ridged and IQ domain-warp helpers. Re-authored as a
 * standalone module from the v1 project's JS/WASM mirror; this file is
 * ours and may evolve — the locked relief field in terrain/locked/ is
 * untouched. Everything is deterministic per integer seed.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1]
];

/** Integer hash matching the v1 math_core convention. */
function hash2i(ix: number, iy: number, seed: number): number {
  let h = seed ? seed : 0x9e3779b9;
  h ^= Math.imul(ix, 374761393);
  h ^= Math.imul(iy, 668265263);
  h = Math.imul(h, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1597334677);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Raw simplex noise, roughly [-1, 1]. */
export function simplex2(xin: number, yin: number, seed: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const gi0 = hash2i(i, j, seed) % 8;
  const gi1 = hash2i(i + i1, j + j1, seed) % 8;
  const gi2 = hash2i(i + 1, j + 1, seed) % 8;

  let n0 = 0;
  const t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = GRAD2[gi0];
    n0 = t0 * t0 * t0 * t0 * (g[0] * x0 + g[1] * y0);
  }
  let n1 = 0;
  const t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = GRAD2[gi1];
    n1 = t1 * t1 * t1 * t1 * (g[0] * x1 + g[1] * y1);
  }
  let n2 = 0;
  const t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = GRAD2[gi2];
    n2 = t2 * t2 * t2 * t2 * (g[0] * x2 + g[1] * y2);
  }
  return 70 * (n0 + n1 + n2);
}

/** Amplitude-normalized simplex fBm, roughly [-1, 1]. */
export function simplexFbm(
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  lacunarity = 2.02,
  gain = 0.5
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * simplex2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged simplex in [0, 1] — sharp crests for mountain ridges. */
export function ridgedSimplex(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(simplex2(x * freq, y * freq, seed + i * 271));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.52;
    freq *= 2.07;
  }
  return sum / norm;
}

/** IQ-style domain warp: low-frequency simplex bends the sample space. */
export function domainWarp(
  x: number,
  y: number,
  seed: number,
  strength = 0.18
): { x: number; y: number } {
  const wx = simplexFbm(x * 1.7 + 11.3, y * 1.7 - 4.7, seed + 311, 3, 2, 0.5);
  const wy = simplexFbm(x * 1.7 - 7.1, y * 1.7 + 9.2, seed + 733, 3, 2, 0.5);
  return { x: x + wx * strength, y: y + wy * strength };
}
