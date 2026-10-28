/*
 * ═══════════════════════════════════════════════════════════════════
 * FROZEN MODULE — DO NOT EDIT.
 * Ported verbatim (logic unchanged; only ES exports + type annotations
 * added) from the user-supplied standalone "Myanmar, in Relief — One
 * Continuous Terrain" (index.html, received 2026-10-28). Enforced by
 * tests/terrain-lock.test.ts checksums. See locked/LOCKED.md.
 * ═══════════════════════════════════════════════════════════════════
 *
 * Small deterministic noise toolkit + ONE HEIGHT FIELD: the whole of
 * Myanmar as a single continuous surface. u runs west→east, v runs
 * north(-1)→south(+1). Returns unit elevation; sea level sits at 0.
 */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const TAU = Math.PI * 2;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed = 0): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.73) * 43758.5453123;
  return value - Math.floor(value);
}

export function vnoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * vnoise(x * frequency, y * frequency, seed + i * 19.7);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

export function ridgedNoise(x: number, y: number, octaves = 4, seed = 0): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = vnoise(x * frequency, y * frequency, seed + i * 27.3);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    sum += amplitude * n;
    norm += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }
  return sum / norm;
}

export function gaussian(
  u: number,
  v: number,
  cu: number,
  cv: number,
  su: number,
  sv: number,
  rotation = 0
): number {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const du = u - cu;
  const dv = v - cv;
  const x = du * c - dv * s;
  const y = du * s + dv * c;
  return Math.exp(-(x * x / (2 * su * su) + y * y / (2 * sv * sv)));
}

type PathPoint = readonly [number, number];

export function distanceToPath(u: number, v: number, points: readonly PathPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy || 1e-7;
    const t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / lengthSq, 0, 1);
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    const dist = Math.hypot(u - px, v - py);
    if (dist < best) best = dist;
  }
  return best;
}

export const RIVER_MAIN: PathPoint[] = [
  [-0.05, -0.66], [-0.10, -0.52], [-0.02, -0.40], [-0.12, -0.28],
  [-0.18, -0.16], [-0.10, -0.04], [-0.16, 0.08], [-0.08, 0.20], [-0.10, 0.34]
];
export const RIVER_CHINDWIN: PathPoint[] = [
  [-0.52, -0.60], [-0.48, -0.48], [-0.42, -0.38], [-0.33, -0.30], [-0.24, -0.22], [-0.18, -0.16]
];
export const RIVER_SITTAUNG: PathPoint[] = [
  [0.30, -0.02], [0.33, 0.10], [0.31, 0.22], [0.34, 0.34], [0.32, 0.46]
];
export const DELTA_CHANNELS: PathPoint[][] = [
  [[-0.10, 0.34], [-0.22, 0.44], [-0.38, 0.54], [-0.52, 0.64], [-0.60, 0.72]],
  [[-0.10, 0.34], [-0.16, 0.46], [-0.24, 0.58], [-0.30, 0.68]],
  [[-0.10, 0.34], [-0.08, 0.46], [-0.10, 0.58], [-0.07, 0.68]],
  [[-0.10, 0.34], [0.02, 0.44], [0.08, 0.56], [0.12, 0.66]],
  [[-0.10, 0.34], [0.14, 0.42], [0.26, 0.52], [0.33, 0.62]],
  [[-0.10, 0.34], [0.26, 0.38], [0.38, 0.46], [0.46, 0.56]],
  [[-0.16, 0.46], [-0.02, 0.50], [-0.12, 0.60]],
  [[-0.60, -1.05], [-0.55, -0.80], [-0.60, -0.55], [-0.53, -0.32], [-0.57, -0.12], [-0.50, 0.05], [-0.54, 0.22], [-0.48, 0.38]]
];

export function myanmarHeight(u: number, v: number): number {
  /* --- coasts & land mask -------------------------------------- */
  const westCoast = -0.60 + 0.05 * Math.sin(v * 2.4 + 1.3) +
    0.04 * Math.sin(v * 6.1 + 2.0) + 0.04 * (vnoise(v * 3.2, 0.7, 7) - 0.5);
  const southCoast = 0.56 + 0.07 * Math.sin(u * 3.1 + 0.9) +
    0.045 * Math.sin(u * 7.9 + 0.3) + 0.05 * (vnoise(u * 3.6, 4.2, 8) - 0.5);
  const gulfCoast = 0.50 + 0.05 * Math.sin(v * 4.6 + 1.2);
  const gulfMask = smoothstep(gulfCoast - 0.07, gulfCoast + 0.05, u) * smoothstep(0.02, 0.18, v);
  const landMask = smoothstep(westCoast - 0.05, westCoast + 0.07, u) *
    (1 - smoothstep(southCoast - 0.10, southCoast + 0.03, v)) *
    (1 - gulfMask);

  /* --- base rolling land --------------------------------------- */
  let h = 0.11 + 0.15 * fbm(u * 2.6 + 7.7, v * 2.0 + 3.3, 4, 61) +
    0.02 * (vnoise(u * 9.5, v * 9.5, 4) - 0.5);

  /* --- the northern Himalayan knot ------------------------------ */
  const northness = smoothstep(-0.30, -0.78, v);
  const northCrest = 0.05 + 0.10 * Math.sin(v * 2.1 + 0.7) + 0.05 * Math.sin(v * 4.3 + 2.0);
  const northBelt = Math.exp(-Math.pow(Math.abs(u - northCrest) / 0.30, 1.6));
  const jag = Math.pow(ridgedNoise(u * 3.1 + 8.4, v * 2.7 + 3.1, 5, 23), 1.35);
  h += northness * northBelt * (0.75 + 2.85 * jag);
  h += northness * 0.6 * Math.pow(ridgedNoise(u * 7.3 + 1.4, v * 6.7 + 5.0, 4, 71), 2.0);
  h += 1.50 * gaussian(u, v, 0.10, -0.80, 0.10, 0.09);   // Hkakabo Razi
  h += 1.15 * gaussian(u, v, -0.14, -0.87, 0.09, 0.08);  // Gamlang Razi
  h += 0.90 * gaussian(u, v, 0.30, -0.72, 0.09, 0.10, -0.2);
  h += 0.80 * gaussian(u, v, -0.32, -0.75, 0.08, 0.09, 0.3);
  const spurCrest = -0.10 + 0.12 * Math.sin(v * 3.0 + 1.0);
  h += 0.5 * smoothstep(-0.25, -0.55, v) *
    Math.exp(-Math.pow(Math.abs(u - spurCrest) / 0.5, 1.5)) *
    ridgedNoise(u * 4, v * 3, 3, 44);

  /* --- Arakan Yoma, the western wall ---------------------------- */
  const arakanCrest = -0.40 + 0.05 * Math.sin(v * 2.2 + 0.9) + 0.035 * Math.sin(v * 5.0 + 2.0);
  const arakanTaper = smoothstep(-0.68, -0.56, v) * (1 - smoothstep(0.28, 0.42, v));
  const arakanBelt = Math.exp(-Math.pow(Math.abs(u - arakanCrest) / 0.14, 1.7));
  h += arakanTaper * arakanBelt * (0.80 +
    0.80 * ridgedNoise(u * 3.8 + 2.7, v * 2.6 + 1.8, 4, 19) +
    0.22 * fbm(u * 8.2, v * 5.5, 3, 53));
  h += arakanTaper * 0.4 * Math.exp(-Math.pow((u - arakanCrest + 0.16) / 0.08, 2)) *
    ridgedNoise(u * 7, v * 6, 3, 63);
  h += 0.55 * gaussian(u, v, -0.45, -0.45, 0.11, 0.12);  // Mount Victoria

  /* --- Shan plateau & Tanintharyi strip (east) ------------------- */
  const shanMask = smoothstep(0.30, 0.60, u) * (1 - smoothstep(0.35, 0.62, v) * 0.8);
  h += shanMask * (0.55 + 0.55 * fbm(u * 3.2 + 11.3, v * 2.4 + 5.2, 4, 101) +
    0.22 * ridgedNoise(u * 6.0 + 3, v * 4.5 + 1, 3, 113));
  const stripMask = smoothstep(gulfCoast + 0.04, gulfCoast + 0.16, u) * smoothstep(0.0, 0.2, v);
  h += stripMask * (0.25 + 0.3 * ridgedNoise(u * 5 + 9, v * 4 + 2, 3, 127));

  /* --- Bago Yoma, the low central ridge -------------------------- */
  const bagoCrest = 0.16 + 0.03 * Math.sin(v * 4.5 + 1.2);
  const bagoMask = Math.exp(-Math.pow((u - bagoCrest) / 0.09, 2)) *
    smoothstep(-0.02, 0.12, v) * (1 - smoothstep(0.48, 0.60, v));
  h += bagoMask * (0.30 + 0.14 * ridgedNoise(u * 8, v * 6, 3, 77));

  /* --- volcanic centres (Popa's plug is a placed structure) ------ */
  h += 0.13 * gaussian(u, v, 0.0, 0.02, 0.13, 0.13);
  h += 0.05 * gaussian(u, v, -0.25, -0.35, 0.10, 0.10);

  /* --- delta flattening ------------------------------------------ */
  const deltaMask = smoothstep(0.30, 0.42, v);
  const deltaBase = 0.10 + 0.05 * fbm(u * 3.0 + 1.2, v * 2.8 + 8.0, 4, 88) +
    0.07 * smoothstep(0.72, 0.45, v);
  h = mix(h, deltaBase, deltaMask);

  /* --- river valleys & beds (carved below sea/water level) ------- */
  const dMain = distanceToPath(u, v, RIVER_MAIN);
  const mainWidth = 0.048 + 0.04 * smoothstep(-0.45, 0.30, v);
  h -= 0.10 * Math.exp(-Math.pow(dMain / 0.17, 2));
  h -= 0.30 * Math.pow(Math.max(0, 1 - dMain / mainWidth), 0.9);

  const dChin = distanceToPath(u, v, RIVER_CHINDWIN);
  h -= 0.08 * Math.exp(-Math.pow(dChin / 0.12, 2));
  h -= 0.24 * Math.pow(Math.max(0, 1 - dChin / 0.045), 0.9) * smoothstep(-0.62, -0.50, v);

  const dSit = distanceToPath(u, v, RIVER_SITTAUNG);
  h -= 0.15 * Math.pow(Math.max(0, 1 - dSit / 0.033), 0.9) *
    smoothstep(-0.08, 0.05, v) * (1 - smoothstep(0.44, 0.50, v));

  /* --- delta distributaries -------------------------------------- */
  for (let i = 0; i < DELTA_CHANNELS.length; i++) {
    const d = distanceToPath(u, v, DELTA_CHANNELS[i]);
    const width = (i === 0 ? 0.046 : 0.033) + 0.011 * Math.sin(v * 4.8 + i * 1.7);
    h -= 0.22 * Math.pow(Math.max(0, 1 - d / width), 1.3);
    h -= 0.04 * Math.exp(-Math.pow(d / (width * 4.5), 2));
  }

  /* --- Rakhine coastal strip ------------------------------------- */
  const stripW = smoothstep(westCoast + 0.02, westCoast + 0.16, u) *
    (1 - smoothstep(westCoast + 0.16, westCoast + 0.30, u));
  h += 0.05 * stripW;

  const sea = -0.34 + 0.03 * fbm(u * 2.2 + 4, v * 2.0 + 2, 3, 19);
  return mix(sea, h, landMask);
}
