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

/* =====================================================================
 * 2D simplex noise
 *
 * Stefan Gustavson's simplex algorithm (the canonical public-domain
 * reference: "Simplex noise demystified"), revised for this engine:
 *  - gradients are selected through our seeded integer hash instead of
 *    a permutation table, so every seed gets its own stable field
 *  - no libc, no globals: safe for the -nostdlib wasm32 target
 * Output is roughly in [-1, 1], matching the reference *70 normalization.
 * ===================================================================== */

static const float SIMP_GRAD2[8][2] = {
  { 1.0f,  1.0f}, {-1.0f,  1.0f}, { 1.0f, -1.0f}, {-1.0f, -1.0f},
  { 1.0f,  0.0f}, {-1.0f,  0.0f}, { 0.0f,  1.0f}, { 0.0f, -1.0f}
};

float simplex2(float xin, float yin, int32_t seed) {
  const float F2 = 0.3660254037844386f; /* 0.5 * (sqrt(3) - 1) */
  const float G2 = 0.2113248654051871f; /* (3 - sqrt(3)) / 6     */

  /* Skew the input space to simplex lattice coordinates. */
  float s = (xin + yin) * F2;
  int32_t i = (int32_t)__builtin_floorf(xin + s);
  int32_t j = (int32_t)__builtin_floorf(yin + s);
  float t = (float)(i + j) * G2;
  float x0 = xin - ((float)i - t);
  float y0 = yin - ((float)j - t);

  /* Which simplex triangle we are in (lower or upper). */
  int32_t i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

  float x1 = x0 - (float)i1 + G2;
  float y1 = y0 - (float)j1 + G2;
  float x2 = x0 - 1.0f + 2.0f * G2;
  float y2 = y0 - 1.0f + 2.0f * G2;

  /* Seeded gradient indices, one per lattice corner. */
  int32_t gi0 = (int32_t)(hash2i(i,      j,      (uint32_t)seed) % 8u);
  int32_t gi1 = (int32_t)(hash2i(i + i1, j + j1, (uint32_t)seed) % 8u);
  int32_t gi2 = (int32_t)(hash2i(i + 1,  j + 1,  (uint32_t)seed) % 8u);

  float n0 = 0.0f;
  float t0 = 0.5f - x0 * x0 - y0 * y0;
  if (t0 > 0.0f) {
    t0 *= t0;
    n0 = t0 * t0 * (SIMP_GRAD2[gi0][0] * x0 + SIMP_GRAD2[gi0][1] * y0);
  }
  float n1 = 0.0f;
  float t1 = 0.5f - x1 * x1 - y1 * y1;
  if (t1 > 0.0f) {
    t1 *= t1;
    n1 = t1 * t1 * (SIMP_GRAD2[gi1][0] * x1 + SIMP_GRAD2[gi1][1] * y1);
  }
  float n2 = 0.0f;
  float t2 = 0.5f - x2 * x2 - y2 * y2;
  if (t2 > 0.0f) {
    t2 *= t2;
    n2 = t2 * t2 * (SIMP_GRAD2[gi2][0] * x2 + SIMP_GRAD2[gi2][1] * y2);
  }
  return 70.0f * (n0 + n1 + n2);
}

/* Fractal Brownian motion over simplex; amplitude-normalized like fbm2. */
float sfbm2(float x, float y, int32_t seed, int32_t octaves,
           float lacunarity, float gain) {
  float amp = 1.0f;
  float freq = 1.0f;
  float sum = 0.0f;
  float norm = 0.0f;
  for (int32_t i = 0; i < octaves; i++) {
    sum += amp * simplex2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/*
 * Terrain height used by the whole game. Built from simplex fBm plus
 * Inigo Quilez-style domain warping (the canonical procedural-terrain
 * technique): two low-frequency simplex fields bend the sampling
 * coordinates so ridges and valleys never line up on a square grid.
 * A ridged simplex term supplies sharp ridgelines; a high-frequency
 * simplex layer supplies small-scale ground detail. World stays roughly
 * +/- 12 units so the existing water level and physics step hold.
 */
float terrain_height(float x, float z, int32_t seed) {
  float warp_x = sfbm2(x * 0.008f + 11.3f, z * 0.008f - 4.7f,
                       seed + 311, 3, 2.0f, 0.5f);
  float warp_z = sfbm2(x * 0.008f - 7.1f,  z * 0.008f + 9.2f,
                       seed + 733, 3, 2.0f, 0.5f);
  float wx = x + warp_x * 26.0f;
  float wz = z + warp_z * 26.0f;

  float broad = sfbm2(wx * 0.011f, wz * 0.011f, seed, 4, 2.0f, 0.5f);
  float ridge_raw = 1.0f - __builtin_fabsf(
      simplex2(wx * 0.022f + 31.7f, wz * 0.022f - 17.3f, seed + 1234));
  float detail = sfbm2(wx * 0.05f, wz * 0.05f, seed + 77, 3, 2.0f, 0.5f);

  return broad * 8.5f + ridge_raw * ridge_raw * 3.2f + detail * 1.1f;
}
