/*
 * MYANMAR 5x5 KM MAP — merged height field (ours, not locked).
 *
 * Merges every showcase technique into one continuous field:
 *  - macro geography and the approved art envelope come from the FROZEN
 *    myanmarHeight() relief field (value/normal noise, sea mask, rivers)
 *  - extra rolling detail from the same value-noise family
 *  - Gustavson simplex ridged crests, IQ domain warp and fine simplex
 *    bumps for walking-scale relief
 * The locked terrain texture/color ramp is never replaced: this module
 * only feeds a height function into the unchanged ReliefTerrain engine.
 *
 * The real geographic outline from the "Living Terrain Atlas" is kept
 * here as a staged utility for the later accurate-outline brick.
 */

import { fbm, myanmarHeight } from "./locked/noise";
import { domainWarp, ridgedSimplex, simplex2 } from "./simplex";

export const MAP_SIZE = 5000; // 5 km x 5 km square, metres
export const MAP_HALF = MAP_SIZE / 2;
export const HEIGHT_SCALE = 120; // unit field -> world metres
export const WATER_LEVEL = 0;
export const MAP_SEGMENTS = 320; // grid resolution per axis

/**
 * The merged unit elevation field. u: west(-1)..east(+1),
 * v: north(-1)..south(+1). Sea level is 0; output envelope is roughly
 * [-0.35, 2.8].
 */
export function mergedField(u: number, v: number): number {
  const macro = myanmarHeight(u, v);

  // Value ("normal") noise rolling detail — same family as the locked art.
  const valueDetail = fbm(u * 6 + 3.1, v * 6 - 1.7, 4, 61) - 0.5;

  // Simplex layer: warped ridged crests plus fine walking-scale bumps.
  const warped = domainWarp(u, v, 17, 0.16);
  const ridge = ridgedSimplex(warped.x * 5.2, warped.y * 5.2, 23, 4) - 0.5;
  const fine = simplex2(u * 22 + 5, v * 22 - 9, 77);

  if (macro < 0) {
    // Open ocean: keep the locked sea floor, add faint shelf dunes.
    return macro * 0.85 + valueDetail * 0.05 + fine * 0.02;
  }

  const land = macro * 0.72 + valueDetail * 0.22 + ridge * 0.5 + fine * 0.05;
  // Coastline stays where the locked land mask drew it.
  return Math.max(0.02, land);
}

/** World-space ground height in metres for any (x, z) inside the map. */
export function groundHeight(x: number, z: number): number {
  return mergedField(x / MAP_HALF, z / MAP_HALF) * HEIGHT_SCALE;
}

/** Analytic-ish normal via the same finite differences as the locked engine. */
export function groundNormal(x: number, z: number, epsilon = 1.2): { x: number; y: number; z: number } {
  const dx = (groundHeight(x + epsilon, z) - groundHeight(x - epsilon, z)) / (2 * epsilon);
  const dz = (groundHeight(x, z + epsilon) - groundHeight(x, z - epsilon)) / (2 * epsilon);
  const len = Math.hypot(dx, 1, dz);
  return { x: -dx / len, y: 1 / len, z: -dz / len };
}

/* ------------------------------------------------------------------ */
/* Real geographic outline (Living Terrain Atlas technique, re-authored)
 * Equirectangular fit into the unit square; used by the future accurate
 * outline brick and available now for point-in-Myanmar tests.          */
/* ------------------------------------------------------------------ */

const LON_MIN = 92.3;
const LON_MAX = 100.7;
const LAT_MIN = 9.8;
const LAT_MAX = 28.55;

export const MYANMAR_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [97.45, 28.55], [98.25, 28.15], [98.75, 27.45], [98.35, 26.65], [98.85, 25.85],
  [98.15, 25.25], [98.75, 24.35], [98.9, 23.55], [99.35, 22.65], [99.95, 22.1],
  [99.25, 21.45], [100.08, 21.25], [100.6, 20.45], [100.12, 19.65], [99.25, 19.85],
  [98.95, 19.25], [98.55, 18.55], [98.95, 17.75], [98.55, 16.95], [98.95, 16.15],
  [98.55, 15.35], [98.95, 14.55], [98.55, 13.65], [98.65, 12.75], [99.0, 11.85],
  [98.65, 10.95], [98.55, 9.95], [98.05, 10.35], [97.75, 11.25], [97.55, 12.2],
  [97.75, 13.15], [97.45, 14.1], [97.15, 15.05], [97.55, 16.0], [97.35, 16.65],
  [96.75, 17.05], [96.25, 16.35], [95.65, 16.0], [95.05, 15.65], [94.45, 16.05],
  [94.25, 16.85], [94.45, 17.65], [94.05, 18.25], [93.65, 19.05], [93.25, 19.85],
  [92.85, 20.65], [92.35, 21.45], [92.65, 22.2], [92.35, 23.05], [92.85, 23.8],
  [93.15, 24.65], [93.55, 25.35], [94.15, 25.9], [94.65, 26.65], [95.15, 27.35],
  [96.05, 27.75], [96.7, 28.25]
];

export function unitToLonLat(u: number, v: number): { lon: number; lat: number } {
  return {
    lon: LON_MIN + ((u + 1) / 2) * (LON_MAX - LON_MIN),
    lat: LAT_MAX - ((v + 1) / 2) * (LAT_MAX - LAT_MIN)
  };
}

/** Ray-casting point-in-polygon over the real outline, given unit coords. */
export function insideMyanmarOutline(u: number, v: number): boolean {
  const { lon, lat } = unitToLonLat(u, v);
  let inside = false;
  for (let i = 0, j = MYANMAR_OUTLINE.length - 1; i < MYANMAR_OUTLINE.length; j = i++) {
    const a = MYANMAR_OUTLINE[i];
    const b = MYANMAR_OUTLINE[j];
    if (a[1] > lat !== b[1] > lat) {
      const cross = ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0];
      if (lon < cross) inside = !inside;
    }
  }
  return inside;
}

export interface SpawnPoint {
  x: number;
  z: number;
  y: number;
}

/**
 * Deterministic search for walkable ground in the central dry zone:
 * low, gently sloping, above water. Spiral scan so the first hit is
 * close to map centre.
 */
export function findSpawn(): SpawnPoint {
  for (let ring = 0; ring < 60; ring++) {
    const radius = ring * 40;
    for (let a = 0; a < 12; a++) {
      const angle = (a / 12) * Math.PI * 2 + ring * 0.37;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius + 120; // bias toward the central basin
      const y = groundHeight(x, z);
      if (y < 2.5 || y > 14) continue;
      const n = groundNormal(x, z);
      if (n.y < 0.93) continue; // slope < ~21 degrees
      return { x, z, y };
    }
  }
  // Fallback: centre of the map regardless.
  return { x: 0, z: 120, y: groundHeight(0, 120) };
}
