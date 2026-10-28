/*
 * Headless physics tests (npx tsx scripts/physics.test.ts). These exercise the
 * same algorithms as physics_core.c; CI additionally runs the clang WASM
 * build, and JsPhysics is kept line-for-line equivalent to the C.
 */

import * as THREE from "three";
import { JsPhysics, bindJsPhysicsHeight } from "../game/wasm/physics";
import { JsNoise } from "../game/wasm/noise";
import { CONFIG } from "../game/config";
import type { CircleObstacle } from "../game/world";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const noise = new JsNoise();
bindJsPhysicsHeight((x, z) => noise.terrainHeight(x, z, CONFIG.seed));
const phys = new JsPhysics();

console.log("Circle collision resolution:");
const obstacles: CircleObstacle[] = [
  { x: 10, z: 10, r: 2 },
  { x: -5, z: 4, r: 1 },
];
phys.setObstacles(obstacles);
{
  // Start inside the first obstacle's radius.
  const [x, z] = phys.resolveCircles(10.5, 10.5, 0.7);
  const d = Math.hypot(x - 10, z - 10);
  check("overlap is pushed to the boundary", Math.abs(d - 2.7) < 0.05, `d=${d.toFixed(3)}`);
}
{
  const [x, z] = phys.resolveCircles(0, 0, 0.7);
  check("free position is unchanged", x === 0 && z === 0);
}
{
  const [x, z] = phys.resolveCircles(9999, 9999, 0.7);
  const half = CONFIG.world.size / 2 - 2;
  check("world bounds are clamped", Math.abs(x) <= half && Math.abs(z) <= half, `(${x},${z})`);
}

console.log("Terrain raycast:");
{
  const gx = 12.4;
  const gz = -7.8;
  const ground = noise.terrainHeight(gx, gz, CONFIG.seed);
  const origin = new THREE.Vector3(gx, ground + 30, gz);
  const down = new THREE.Vector3(0, -1, 0);
  const t = phys.rayTerrain(origin, down, 200);
  check("downward ray hits heightfield", t > 0 && Math.abs(origin.y + down.y * t - ground) < 0.6,
    `t=${t.toFixed(2)} hitY=${(origin.y - t).toFixed(2)} ground=${ground.toFixed(2)}`);

  const up = new THREE.Vector3(0, 1, 0);
  check("upward ray misses terrain", phys.rayTerrain(origin, up, 50) < 0);
}

console.log("Cover raycasts (trees/rocks/huts block bullets):");
{
  phys.setObstacles([{ x: 20, z: 20, r: 0.8 }]);
  const origin = new THREE.Vector3(20, 1.5, 0);
  const dir = new THREE.Vector3(0, 0, 1);
  const t = phys.rayCover(origin, dir, 100);
  check("ray into tree is blocked", t > 0 && t < 40, `t=${t}`);
  const miss = phys.rayCover(new THREE.Vector3(0, 1.5, 0), dir, 100);
  check("ray away from cover misses", miss < 0);
}

console.log("Actor cylinder raycasts:");
{
  phys.setObstacles([]);
  phys.setActors([
    { x: 0, y: 0, z: 15, r: 0.7, h: 3 }, // bot 0, torso height
    { x: 0, y: 0, z: 30, r: 0.7, h: 3 }, // bot 1, farther
  ]);
  const origin = new THREE.Vector3(0, 1.6, 0);
  const hit = phys.rayActors(origin, new THREE.Vector3(0, 0, 1), 100);
  check("nearest cylinder is returned", !!hit && hit.index === 0 && Math.abs(hit.t - 14.3) < 0.05,
    JSON.stringify(hit));
  const high = phys.rayActors(origin, new THREE.Vector3(0, 1, 0).normalize(), 100);
  check("ray over the cylinders misses", high === null);
}

console.log("Combined raycast picks nearest surface:");
{
  phys.setObstacles([{ x: 0, z: 8, r: 1.2 }]);
  phys.setActors([{ x: 0, y: 0, z: 20, r: 0.7, h: 3 }]);
  const origin = new THREE.Vector3(0, 1.5, 0);
  const hit = phys.raycast(origin, new THREE.Vector3(0, 0, 1), 100);
  check("cover wins over actor behind it", hit?.kind === "cover", JSON.stringify(hit));
}

console.log(failures === 0 ? "\nAll physics tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
