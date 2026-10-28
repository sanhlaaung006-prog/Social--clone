/*
 * Simplex noise + merged 5 km map tests.
 * Run: npx tsx tests/simplex-map.test.ts
 */

import { domainWarp, ridgedSimplex, simplex2, simplexFbm } from "../src/terrain/simplex";
import {
  findSpawn,
  groundHeight,
  groundNormal,
  HEIGHT_SCALE,
  insideMyanmarOutline,
  MAP_HALF,
  mergedField,
  unitToLonLat
} from "../src/terrain/myanmarMap";
import { myanmarHeight } from "../src/terrain/locked/noise";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Simplex toolkit:");
{
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 500; i++) {
    const v = simplex2(i * 0.37, Math.sin(i) * 3.1, (i * 13) % 97);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  check("simplex2 stays inside [-1,1]", min >= -1 && max <= 1, `${min.toFixed(2)}..${max.toFixed(2)}`);
  check("simplex2 is deterministic per seed", simplex2(1.7, -2.3, 5) === simplex2(1.7, -2.3, 5));
  check("different seeds diverge", simplex2(1.7, -2.3, 5) !== simplex2(1.7, -2.3, 6));

  let fMin = Infinity;
  let fMax = -Infinity;
  for (let i = 0; i < 300; i++) {
    const v = simplexFbm(i * 0.21, Math.cos(i) * 2.7, 11, 5);
    fMin = Math.min(fMin, v);
    fMax = Math.max(fMax, v);
  }
  check("simplex fBm stays normalized", fMin >= -1.05 && fMax <= 1.05, `${fMin.toFixed(2)}..${fMax.toFixed(2)}`);

  const r = ridgedSimplex(3.4, -1.2, 8, 4);
  check("ridged simplex lands in [0,1]", r >= 0 && r <= 1, `${r}`);

  const w = domainWarp(0.5, 0.5, 3);
  check("domain warp offsets the sample point", w.x !== 0.5 || w.y !== 0.5);
}

console.log("Merged 5 km field:");
{
  check("field is deterministic", mergedField(0.2, -0.3) === mergedField(0.2, -0.3));
  let finite = true;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 72; i++) {
    for (let j = 0; j <= 72; j++) {
      const h = mergedField((i / 72) * 2 - 1, (j / 72) * 2 - 1);
      if (!Number.isFinite(h)) finite = false;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  check("all samples finite", finite);
  // Locked delta channels carve below the nominal sea floor; the sea
  // color ramp clamps at -1.3 so this envelope stays inside its range.
  check("envelope stays inside the locked color ramp", min > -1.3 && max < 3.2, `${min.toFixed(2)}..${max.toFixed(2)}`);

  const ocean = mergedField(-0.92, 0.1);
  check("ocean stays below sea level", ocean < 0, `${ocean.toFixed(2)}`);
  const himalaya = mergedField(0.1, -0.8);
  check("Himalayan knot is the high zone", himalaya > 1.2, `${himalaya.toFixed(2)}`);
  const coastGuard = mergedField(0.0, 0.0);
  check("locked coastline respected (land never dips under 0.02)", coastGuard >= 0.02, `${coastGuard.toFixed(2)}`);

  // The merge must preserve the locked field's geography ordering.
  check("Arakan still above the central basin",
    mergedField(-0.45, -0.45) > mergedField(0.0, -0.05));
  check("simplex adds relief beyond the bare macro",
    Math.abs(mergedField(0.23, 0.17) - myanmarHeight(0.23, 0.17) * 0.72) > 0.01);

  // World sampler consistency.
  const wh = groundHeight(MAP_HALF * 0.3, -MAP_HALF * 0.2);
  check("groundHeight maps world metres through HEIGHT_SCALE",
    Math.abs(wh - mergedField(0.3, -0.2) * HEIGHT_SCALE) < 1e-9);

  const n = groundNormal(120, -340);
  const len = Math.hypot(n.x, n.y, n.z);
  check("ground normal is unit length and upward", Math.abs(len - 1) < 1e-6 && n.y > 0);
}

console.log("Geographic outline utility:");
{
  // Bagan (95.1E, 21.2N) and Yangon (96.2E, 16.8N) lie inside Myanmar.
  const bagan = unitToLonLat(-0.33, -0.1);
  // Bounding-box equirect fit: longitude is tight; latitude carries the
  // full country span so central points tolerate ~1.1 degrees.
  check("lon/lat fit places Bagan near 95E/21N",
    Math.abs(bagan.lon - 95.1) < 0.6 && Math.abs(bagan.lat - 21.2) < 1.2,
    `${bagan.lon.toFixed(2)},${bagan.lat.toFixed(2)}`);
  const toUnit = (lon: number, lat: number) => ({
    u: ((lon - 92.3) / (100.7 - 92.3)) * 2 - 1,
    v: ((28.55 - lat) / (28.55 - 9.8)) * 2 - 1
  });
  check("Bagan is inside the outline", insideMyanmarOutline(toUnit(95.1, 21.2).u, toUnit(95.1, 21.2).v));
  check("Yangon is inside the outline", insideMyanmarOutline(toUnit(96.2, 16.8).u, toUnit(96.2, 16.8).v));
  check("Bay of Bengal is outside the outline", !insideMyanmarOutline(toUnit(91.5, 15.0).u, toUnit(91.5, 15.0).v));
  check("empty point in Thailand is outside", !insideMyanmarOutline(toUnit(102.0, 15.0).u, toUnit(102.0, 15.0).v));
}

console.log("Spawn search:");
{
  const spawn = findSpawn();
  check("spawn is above water", spawn.y > 0.5, `${spawn.y.toFixed(1)}`);
  check("spawn sits inside the map", Math.abs(spawn.x) < MAP_HALF && Math.abs(spawn.z) < MAP_HALF);
  const n = groundNormal(spawn.x, spawn.z);
  check("spawn ground is gently sloped", n.y >= 0.93, `${n.y.toFixed(3)}`);
  check("spawn matches the height sampler", Math.abs(groundHeight(spawn.x, spawn.z) - spawn.y) < 1e-6);
  check("spawn search is deterministic", (() => {
    const again = findSpawn();
    return again.x === spawn.x && again.z === spawn.z;
  })());
}

console.log(failures === 0 ? "\nSimplex/map: all checks passed." : `\nSimplex/map: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
