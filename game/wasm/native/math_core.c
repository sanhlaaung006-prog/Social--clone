/*
 * math_core.c - performance-critical math for Golden Land Royale
 *
 * Compiled to WebAssembly with clang (see ../build-wasm.sh):
 *   clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export-all
 *
 * Only scalar f32/i32 values cross the boundary, so no linear-memory
 * glue code is required. The TypeScript fallback in ../noise.ts uses
 * the exact same hash/noise algorithm, so terrain looks identical with
 * or without the WASM module.
 */

#include <stdint.h>

/* Deterministic 2D integer hash (wrapping uint32 arithmetic). */
static uint32_t hash2i(int32_t ix, int32_t iy, uint32_t seed) {
  uint32_t h = seed ? seed : 0x9e3779b9u;
  h ^= (uint32_t)ix * 374761393u;
  h ^= (uint32_t)iy * 668265263u;
  h = h * 1274126177u;
  h ^= h >> 13;
  h *= 1597334677u;
  h ^= h >> 16;
  return h;
}

static float fade(float t) { return t * t * (3.0f - 2.0f * t); }

static float lerpf(float a, float b, float t) { return a + (b - a) * t; }

/* Smooth value noise in [0, 1]. */
float noise2(float x, float y, int32_t seed) {
  int32_t x0 = (int32_t)__builtin_floorf(x);
  int32_t y0 = (int32_t)__builtin_floorf(y);
  float fx = fade(x - (float)x0);
  float fy = fade(y - (float)y0);

  float v00 = (float)(hash2i(x0,     y0,     (uint32_t)seed) % 10000u) * 0.0001f;
  float v10 = (float)(hash2i(x0 + 1, y0,     (uint32_t)seed) % 10000u) * 0.0001f;
  float v01 = (float)(hash2i(x0,     y0 + 1, (uint32_t)seed) % 10000u) * 0.0001f;
  float v11 = (float)(hash2i(x0 + 1, y0 + 1, (uint32_t)seed) % 10000u) * 0.0001f;

  return lerpf(lerpf(v00, v10, fx), lerpf(v01, v11, fx), fy);
}

/* Fractal Brownian motion: layered octaves of value noise. */
float fbm2(float x, float y, int32_t seed, int32_t octaves,
           float lacunarity, float gain) {
  float amp = 1.0f;
  float freq = 1.0f;
  float sum = 0.0f;
  float norm = 0.0f;
  for (int32_t i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/*
 * Terrain height used by the whole game. Keeping this in C means the
 * heightfield generation and every runtime ground-height query run
 * natively. World is roughly +/- 110 units; hills up to ~10 units.
 */
float terrain_height(float x, float z, int32_t seed) {
  float broad = fbm2(x * 0.012f, z * 0.012f, seed, 4, 2.0f, 0.5f);
  float detail = fbm2(x * 0.055f, z * 0.055f, seed + 77, 3, 2.0f, 0.5f);
  float ridged = 1.0f - fbm2(x * 0.025f + 31.7f, z * 0.025f - 17.3f,
                             seed + 1234, 2, 2.0f, 0.5f);
  return (broad - 0.5f) * 16.0f + (detail - 0.5f) * 2.2f +
         ridged * ridged * 2.5f;
}

/* Small stateless helpers reused by bot AI / zone math. */
float dist2_sq(float ax, float az, float bx, float bz) {
  float dx = ax - bx;
  float dz = az - bz;
  return dx * dx + dz * dz;
}

float clampf(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
