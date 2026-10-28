/*
 * Anti-voxel art-direction gate (npx tsx scripts/art-style.test.ts).
 * Fails the suite if shipped gameplay code reintroduces raw BoxGeometry,
 * and asserts the smooth-stylized choices the world/actors now make.
 * Reference-only modules (mig29 airframe, vendors in reference/) are out
 * of scope: they are not spawned in matches.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
import * as THREE from "three";
import { JsNoise } from "../game/wasm/noise";
import { JsPhysics, bindJsPhysicsHeight } from "../game/wasm/physics";
import { World } from "../game/world";
import { CONFIG } from "../game/config";
import { Pickup } from "../game/combat";
import { buildHumanoid } from "../game/actors";
import { installDomStub } from "./lib/dom-stub";

installDomStub();

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log("Source-level anti-voxel rules:");
const shippedModules = [
  "game/world.ts",
  "game/actors.ts",
  "game/combat.ts",
  "game/zone.ts",
  "game/vehicles/vehicle.ts",
  "game/vehicles/manager.ts",
  "game/vehicles/stylized.ts",
  "game/geometry/kit.ts",
  "game/cameraRig.ts",
  "game/instancedCuller.ts",
  "game/device.ts",
];
for (const rel of shippedModules) {
  const src = readFileSync(join(root, rel), "utf8");
  check(`${rel} contains no BoxGeometry`, !/new THREE\.BoxGeometry/.test(src));
}

console.log("Runtime scene rules:");
const noise = new JsNoise();
bindJsPhysicsHeight((x, z) => noise.terrainHeight(x, z, CONFIG.seed));
const world = new World(noise);

let boxMeshes = 0;
let instancedWithColor = 0;
let instancedTotal = 0;
world.group.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    if (o.geometry.type === "BoxGeometry") boxMeshes++;
    if (o instanceof THREE.InstancedMesh) {
      instancedTotal++;
      if (o.instanceColor) instancedWithColor++;
    }
  }
});
check("world scene has zero box meshes", boxMeshes === 0, `${boxMeshes} found`);
check("every instanced prop carries per-instance colors",
  instancedTotal > 0 && instancedWithColor === instancedTotal,
  `${instancedWithColor}/${instancedTotal}`);

const terrainMat = world.terrainMesh.material as THREE.MeshStandardMaterial;
check("terrain uses smooth normals (flatShading off)", terrainMat.flatShading === false);
check("terrain is a Standard material", terrainMat.isMeshStandardMaterial === true);

console.log("Humanoid rules:");
const human = buildHumanoid(0x5f7a4a, 0x3d4f33);
let humanBoxes = 0;
let curvedParts = 0;
human.group.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    if (o.geometry.type === "BoxGeometry") humanBoxes++;
    if (["CylinderGeometry", "SphereGeometry"].includes(o.geometry.type)) curvedParts++;
  }
});
check("humanoid has no box meshes", humanBoxes === 0, `${humanBoxes} found`);
check("humanoid built from curved primitives", curvedParts >= 8, `${curvedParts} parts`);

console.log("Pickup rules:");
for (const kind of ["medkit", "ammo"] as const) {
  const pickup = new Pickup(kind, 0, 0, 0);
  let boxes = 0;
  pickup.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry.type === "BoxGeometry") boxes++;
  });
  check(`${kind} pickup has no box meshes`, boxes === 0);
}

// Physics still resolves against the same obstacle contract.
const physics = new JsPhysics();
physics.setObstacles(world.obstacles);
check("world still publishes collision obstacles", world.obstacles.length > 20,
  `${world.obstacles.length} obstacles`);
check("spawn points remain on dry ground",
  world.spawnPoints.every((p) => p.y > CONFIG.world.waterLevel));

console.log(failures === 0 ? "\nAll art-style tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
