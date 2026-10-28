/*
 * Headless smoke test (npx tsx scripts/smoke.ts): validates the deterministic
 * noise core, terrain heightfield and zone state machine without a browser.
 */

import { JsNoise } from "../game/wasm/noise";
import { Rng } from "../game/rng";
import { Zone } from "../game/zone";
import { CONFIG } from "../game/config";
import * as THREE from "three";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log("Noise core:");
const noise = new JsNoise();
check("noise2 stays in [0,1]", (() => {
  for (let i = 0; i < 500; i++) {
    const v = noise.noise2(i * 0.37, -i * 0.61, CONFIG.seed);
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
})());

const a = noise.fbm2(12.4, -7.1, 42, 5, 2, 0.5);
const b = noise.fbm2(12.4, -7.1, 42, 5, 2, 0.5);
check("fbm2 is deterministic", a === b, `got ${a} vs ${b}`);
check("fbm2 differs across seeds", noise.fbm2(1, 1, 1, 4, 2, 0.5) !== noise.fbm2(1, 1, 2, 4, 2, 0.5));

console.log("Simplex noise:");
check("simplex2 stays in [-1,1]", (() => {
  for (let i = 0; i < 400; i++) {
    const v = noise.simplex2(i * 0.27 - 31.4, Math.sin(i) * 12.0, CONFIG.seed);
    if (v < -1 || v > 1) return false;
  }
  return true;
})());
check("simplex2 is deterministic",
  noise.simplex2(8.8, -3.2, 9) === noise.simplex2(8.8, -3.2, 9));
check("simplex2 differs across seeds",
  noise.simplex2(2.2, 2.2, 1) !== noise.simplex2(2.2, 2.2, 2));
check("sfbm2 is amplitude-bounded", (() => {
  for (let i = 0; i < 100; i++) {
    const v = noise.sfbm2(i * 0.4, -i * 0.31, 5, 5, 2, 0.5);
    if (v < -1 || v > 1) return false;
  }
  return true;
})());

console.log("Terrain heightfield:");
let finite = true;
let min = Infinity;
let max = -Infinity;
const half = CONFIG.world.size / 2;
for (let x = -half; x <= half; x += 4) {
  for (let z = -half; z <= half; z += 4) {
    const h = noise.terrainHeight(x, z, CONFIG.seed);
    if (!Number.isFinite(h)) finite = false;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
}
check("all heights finite", finite);
check("hills have meaningful relief", max - min > 5, `range ${min.toFixed(1)}..${max.toFixed(1)}`);
check("terrain is symmetric-identical at same coords",
  noise.terrainHeight(33.3, -21.25, 7) === noise.terrainHeight(33.3, -21.25, 7));

console.log("RNG:");
const rng = new Rng(123);
check("rng range() inside bounds", (() => {
  for (let i = 0; i < 1000; i++) {
    const v = rng.range(-5, 5);
    if (v < -5 || v > 5) return false;
  }
  return true;
})());
check("rng int() inside bounds", rng.int(1, 3) >= 1 && rng.int(1, 3) <= 3);

console.log("Battle royale zone:");
const zone = new Zone(new THREE.Scene());
const startRadius = zone.radius;
let lastRadius = startRadius;
let shrinks = 0;
let grew = false;
for (let t = 0; t < 400; t += 1 / 30) {
  zone.update(1 / 30);
  if (zone.radius < lastRadius - 0.01) shrinks++;
  if (zone.radius > lastRadius + 0.001) grew = true;
  lastRadius = zone.radius;
}
check("radius never grows", !grew);
check("zone starts at first-phase radius", startRadius === CONFIG.zone.phases[0].from, `got ${startRadius}`);
check("zone shrinks multiple times", shrinks > 50, `only ${shrinks} shrinking frames`);
check("zone reaches final radius", Math.abs(zone.radius - CONFIG.zone.phases.at(-1)!.to) < 0.5, `got ${zone.radius}`);
check("zone finishes in done state", zone.state === "done");
check("isInside matches radius", zone.isInside(zone.center.x, zone.center.z) &&
  !zone.isInside(zone.center.x + zone.radius + 5, zone.center.z));

console.log(failures === 0 ? "\nAll smoke tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
