/*
 * physics_core.c - compact 3D physics for Golden Land Royale.
 *
 * Compiled together with math_core.c by clang (see ../build-wasm.sh):
 *   - bump allocator over linear memory for obstacle/actor buffers
 *   - circle-vs-circle collision resolution for capsule movement
 *   - ray vs heightfield (raymarch + bisection) for terrain hits
 *   - ray vs spheres for static cover (trees, rocks, huts)
 *   - ray vs vertical cylinders for humanoid hit tests
 *
 * No libc: only compiler builtins are used.
 */

#include <stdint.h>

extern float terrain_height(float x, float z, int32_t seed);

/* ------------------------- linear memory bump pool ------------------------ */

#define PHYS_MEM_CAP 65536u

static unsigned char g_mem[PHYS_MEM_CAP];
static uint32_t g_used = 0;

uint32_t phys_balloc(uint32_t bytes) {
  uint32_t aligned = (bytes + 7u) & ~7u;
  if (g_used + aligned > PHYS_MEM_CAP) return 0u;
  uint32_t ptr = g_used;
  g_used += aligned;
  return ptr;
}

void phys_breset(void) { g_used = 0u; }

static float *fptr(uint32_t p) { return (float *)(uintptr_t)(g_mem + p); }

uint32_t phys_make_floats(uint32_t count) { return phys_balloc(count * 4u); }

void phys_set3(uint32_t p, int32_t i, float a, float b, float c) {
  float *q = fptr(p) + i * 3;
  q[0] = a;
  q[1] = b;
  q[2] = c;
}

void phys_set5(uint32_t p, int32_t i, float a, float b, float c, float d, float e) {
  float *q = fptr(p) + i * 5;
  q[0] = a;
  q[1] = b;
  q[2] = c;
  q[3] = d;
  q[4] = e;
}

void phys_set4(uint32_t p, int32_t i, float a, float b, float c, float d) {
  float *q = fptr(p) + i * 4;
  q[0] = a;
  q[1] = b;
  q[2] = c;
  q[3] = d;
}

/* Ray vs vehicle volumes stored as [x, baseY, z, r]. Unlike static cover
 * (which assumes a near-zero base), the sphere rides 1.5 units above the
 * vehicle's actual ground height so hulls on hills stay hittable. */
float phys_ray_vehicles(uint32_t veh_p, int32_t count,
                        float ox, float oy, float oz,
                        float dx, float dy, float dz, float max_t) {
  const float *v = fptr(veh_p);
  float best = max_t;
  for (int32_t i = 0; i < count; i++) {
    float cx = v[i * 4];
    float cy = v[i * 4 + 1] + 1.5f;
    float cz = v[i * 4 + 2];
    float cr = v[i * 4 + 3] * 1.6f + 0.25f;

    float ex = ox - cx;
    float ey = oy - cy;
    float ez = oz - cz;
    float b = ex * dx + ey * dy + ez * dz;
    float cc = ex * ex + ey * ey + ez * ez - cr * cr;
    float disc = b * b - cc;
    if (disc < 0.0f) continue;
    float s = __builtin_sqrtf(disc);
    float t = -b - s;
    if (t < 0.01f) t = -b + s;
    if (t > 0.01f && t < best) best = t;
  }
  return best >= max_t ? -1.0f : best;
}

/* --------------------- capsule (circle in XZ) resolution ------------------- */

void phys_resolve_circles(uint32_t obs_p, int32_t count, uint32_t pos_p,
                          float radius, float half_world) {
  const float *obs = fptr(obs_p);
  float *pos = fptr(pos_p);
  float x = pos[0];
  float z = pos[1];

  if (x < -half_world) x = -half_world;
  if (x > half_world) x = half_world;
  if (z < -half_world) z = -half_world;
  if (z > half_world) z = half_world;

  for (int32_t i = 0; i < count; i++) {
    float ox = obs[i * 3];
    float oz = obs[i * 3 + 1];
    float or_ = obs[i * 3 + 2];
    float dx = x - ox;
    float dz = z - oz;
    float d2 = dx * dx + dz * dz;
    float min_d = or_ + radius;
    if (d2 < min_d * min_d) {
      float d = __builtin_sqrtf(d2);
      if (d < 1e-5f) {
        /* Exact overlap: nudge along +x deterministically. */
        x = ox + min_d;
        continue;
      }
      float push = (min_d - d) / d;
      x += dx * push;
      z += dz * push;
    }
  }
  pos[0] = x;
  pos[1] = z;
}

/* ------------------------------ ray helpers -------------------------------- */

/* Ray vs approximate cover spheres stored as [x, z, r]. The visual volume of
 * trees/rocks/huts is approximated by a sphere centered at y=1.5. */
float phys_ray_spheres(uint32_t obs_p, int32_t count,
                       float ox, float oy, float oz,
                       float dx, float dy, float dz, float max_t) {
  const float *obs = fptr(obs_p);
  float best = max_t;
  for (int32_t i = 0; i < count; i++) {
    float cx = obs[i * 3];
    float cz = obs[i * 3 + 1];
    float cr = obs[i * 3 + 2] * 1.6f + 0.25f;
    float cy = 1.5f;

    float ex = ox - cx;
    float ey = oy - cy;
    float ez = oz - cz;
    float b = ex * dx + ey * dy + ez * dz;
    float cc = ex * ex + ey * ey + ez * ez - cr * cr;
    float disc = b * b - cc;
    if (disc < 0.0f) continue;
    float s = __builtin_sqrtf(disc);
    float t = -b - s;
    if (t < 0.01f) t = -b + s;
    if (t > 0.01f && t < best) best = t;
  }
  return best >= max_t ? -1.0f : best;
}

/* Ray vs the procedural heightfield: fixed-step march then bisect. */
float phys_ray_terrain(float ox, float oy, float oz,
                       float dx, float dy, float dz,
                       float max_t, int32_t seed) {
  const float step = 0.55f;
  float prev_t = 0.0f;
  float prev_gap = oy - terrain_height(ox, oz, seed);

  for (float t = step; t <= max_t; t += step) {
    float px = ox + dx * t;
    float py = oy + dy * t;
    float pz = oz + dz * t;
    float gap = py - terrain_height(px, pz, seed);
    if (gap <= 0.0f && prev_gap > 0.0f) {
      float lo = prev_t;
      float hi = t;
      for (int32_t k = 0; k < 8; k++) {
        float mid = (lo + hi) * 0.5f;
        float my = oy + dy * mid;
        float mg = my - terrain_height(ox + dx * mid, oz + dz * mid, seed);
        if (mg > 0.0f) lo = mid;
        else hi = mid;
      }
      return (lo + hi) * 0.5f;
    }
    prev_gap = gap;
    prev_t = t;
  }
  return -1.0f;
}

/* Ray vs vertical cylinders [baseX, baseY, baseZ, radius, height].
 * Returns the hit index (or -1) and writes the nearest t to *out_t. */
int32_t phys_ray_cylinders(uint32_t cy_p, int32_t count,
                           float ox, float oy, float oz,
                           float dx, float dy, float dz,
                           float max_t, uint32_t out_t_p) {
  const float *cys = fptr(cy_p);
  float *out_t = fptr(out_t_p);
  int32_t hit = -1;
  float best = max_t;

  for (int32_t i = 0; i < count; i++) {
    float bx = cys[i * 5];
    float by = cys[i * 5 + 1];
    float bz = cys[i * 5 + 2];
    float cr = cys[i * 5 + 3];
    float ch = cys[i * 5 + 4];

    /* 2D quadratic in the XZ plane. */
    float ex = ox - bx;
    float ez = oz - bz;
    float bq = ex * dx + ez * dz;
    float cq = ex * ex + ez * ez - cr * cr;
    float disc = bq * bq - cq;
    if (disc < 0.0f) continue;
    float s = __builtin_sqrtf(disc);
    float t1 = -bq - s;
    float t2 = -bq + s;

    float candidates[2];
    candidates[0] = t1;
    candidates[1] = t2;
    for (int32_t k = 0; k < 2; k++) {
      float t = candidates[k];
      if (t < 0.01f || t >= best) continue;
      float y = oy + dy * t;
      if (y >= by && y <= by + ch) {
        best = t;
        hit = i;
      }
    }
  }

  if (hit >= 0) *out_t = best;
  return hit;
}
