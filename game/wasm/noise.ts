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
  terrainHeight(x: number, z: number, seed: number): number;
  readonly wasm: boolean;
}

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

  terrainHeight(x: number, z: number, seed: number): number {
    const broad = this.fbm2(x * 0.012, z * 0.012, seed, 4, 2, 0.5);
    const detail = this.fbm2(x * 0.055, z * 0.055, seed + 77, 3, 2, 0.5);
    const ridged =
      1 - this.fbm2(x * 0.025 + 31.7, z * 0.025 - 17.3, seed + 1234, 2, 2, 0.5);
    return (
      (broad - 0.5) * 16 + (detail - 0.5) * 2.2 + ridged * ridged * 2.5
    );
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
