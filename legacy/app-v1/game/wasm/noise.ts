/*
 * Noise bridge. Prefers the clang-compiled WASM module
 * (public/wasm/math_core.wasm, built by `npm run build:wasm`); if it is
 * missing or WebAssembly is unavailable, falls back to a bit-identical
 * TypeScript implementation of the C code in native/math_core.c.
 */

export interface NoiseImpl {
  noise2(x: number, z: number, seed: number): number;
  fbm2(
    x: number,
    z: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    gain: number
  ): number;
  /** 2D simplex noise, roughly [-1, 1] (Gustavson algorithm, hash-seeded). */
  simplex2(x: number, z: number, seed: number): number;
  /** Amplitude-normalized fractal Brownian motion over simplex noise. */
  sfbm2(
    x: number,
    z: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    gain: number
  ): number;
  terrainHeight(x: number, z: number, seed: number): number;
  readonly wasm: boolean;
}

/* Gustavson simplex constants; must match native/math_core.c exactly. */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const SIMP_GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

import { loadWasmModule } from "./loadModule";

/* ----------------------------- JS fallback ----------------------------- */

// Must stay bit-identical to hash2i() in native/math_core.c.
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

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class JsNoise implements NoiseImpl {
  readonly wasm = false;

  noise2(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const v00 = (hash2i(x0, y0, seed) % 10000) * 0.0001;
    const v10 = (hash2i(x0 + 1, y0, seed) % 10000) * 0.0001;
    const v01 = (hash2i(x0, y0 + 1, seed) % 10000) * 0.0001;
    const v11 = (hash2i(x0 + 1, y0 + 1, seed) % 10000) * 0.0001;
    return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
  }

  fbm2(
    x: number,
    y: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    gain: number
  ): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq, seed + i * 1013);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  simplex2(xin: number, yin: number, seed: number): number {
    // Skew the input space to simplex lattice coordinates.
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // Which simplex triangle we are in (lower or upper).
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    // Seeded gradient indices, one per lattice corner.
    const gi0 = hash2i(i, j, seed) % 8;
    const gi1 = hash2i(i + i1, j + j1, seed) % 8;
    const gi2 = hash2i(i + 1, j + 1, seed) % 8;

    let n0 = 0;
    const t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = SIMP_GRAD2[gi0];
      n0 = t0 * t0 * t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let n1 = 0;
    const t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = SIMP_GRAD2[gi1];
      n1 = t1 * t1 * t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let n2 = 0;
    const t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = SIMP_GRAD2[gi2];
      n2 = t2 * t2 * t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  sfbm2(
    x: number,
    y: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    gain: number
  ): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.simplex2(x * freq, y * freq, seed + i * 1013);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  terrainHeight(x: number, z: number, seed: number): number {
    // IQ-style domain warp: low-frequency simplex bends the sample space
    // so ridges and valleys never align to a square grid.
    const warpX = this.sfbm2(x * 0.008 + 11.3, z * 0.008 - 4.7, seed + 311, 3, 2, 0.5);
    const warpZ = this.sfbm2(x * 0.008 - 7.1, z * 0.008 + 9.2, seed + 733, 3, 2, 0.5);
    const wx = x + warpX * 26;
    const wz = z + warpZ * 26;

    const broad = this.sfbm2(wx * 0.011, wz * 0.011, seed, 4, 2, 0.5);
    const ridgeRaw =
      1 - Math.abs(this.simplex2(wx * 0.022 + 31.7, wz * 0.022 - 17.3, seed + 1234));
    const detail = this.sfbm2(wx * 0.05, wz * 0.05, seed + 77, 3, 2, 0.5);

    return broad * 8.5 + ridgeRaw * ridgeRaw * 3.2 + detail * 1.1;
  }
}

/* ------------------------------ WASM impl ------------------------------ */

interface WasmExports {
  noise2: (x: number, y: number, seed: number) => number;
  fbm2: (
    x: number,
    y: number,
    seed: number,
    octaves: number,
    lac: number,
    gain: number
  ) => number;
  simplex2: (x: number, y: number, seed: number) => number;
  sfbm2: (
    x: number,
    y: number,
    seed: number,
    octaves: number,
    lac: number,
    gain: number
  ) => number;
  terrain_height: (x: number, z: number, seed: number) => number;
}

class WasmNoise implements NoiseImpl {
  readonly wasm = true;
  constructor(private readonly e: WasmExports) {}

  noise2(x: number, z: number, seed: number) {
    return this.e.noise2(x, z, seed);
  }

  fbm2(
    x: number,
    z: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    gain: number
  ) {
    return this.e.fbm2(x, z, seed, octaves, lacunarity, gain);
  }

  simplex2(x: number, z: number, seed: number) {
    return this.e.simplex2(x, z, seed);
  }

  sfbm2(
    x: number,
    z: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    gain: number
  ) {
    return this.e.sfbm2(x, z, seed, octaves, lacunarity, gain);
  }

  terrainHeight(x: number, z: number, seed: number) {
    return this.e.terrain_height(x, z, seed);
  }
}

let cached: Promise<NoiseImpl> | null = null;

export function loadNoise(): Promise<NoiseImpl> {
  if (cached) return cached;

  cached = (async () => {
    const mod = await loadWasmModule();
    if (!mod) return new JsNoise();
    return new WasmNoise(mod.instance.exports as unknown as WasmExports);
  })();

  return cached;
}
