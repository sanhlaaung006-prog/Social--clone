/*
 * Headless first-person + overview proof for the merged 5 km map.
 * Rebuilds ground geometry from the merged field at the engine's exact
 * height scale (test-only color ramp); the authoritative art runs in
 * the locked ReliefTerrain engine in-browser.
 */

import * as THREE from "three";
import {
  findSpawn,
  groundHeight,
  MAP_HALF
} from "../src/terrain/myanmarMap";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";
import { buildGround } from "./lib/ground";

const scene = new THREE.Scene();
const ground = buildGround();
scene.add(ground);
const range = ground.userData.range as { minH: number; maxH: number };
console.log(`5 km ground range: ${range.minH.toFixed(1)} .. ${range.maxH.toFixed(1)} m`);

const tris = gatherTriangles(scene);
console.log(`triangles: ${tris.length}`);
const BG = 0x1d3325;

// 1) Shoulder-height basin walk at the actual spawn point, looking north.
const spawn = findSpawn();
const eyeY = groundHeight(spawn.x, spawn.z) + 7;
renderPng(
  tris,
  makeCamera(
    new THREE.Vector3(spawn.x, eyeY, spawn.z),
    new THREE.Vector3(spawn.x, eyeY - 18, spawn.z - 200)
  ),
  "screenshots/fp-01-basin-walk.png",
  { bgColor: BG, fogNear: 320, fogFar: 2500 }
);

// 2) Approach to the Himalayan knot (u=0.10, v=-0.62), peaks ahead.
const hx = 0.1 * MAP_HALF;
const hz = -0.62 * MAP_HALF;
const hy = groundHeight(hx, hz) + 9;
const peakZ = -0.82 * MAP_HALF;
const peakY = groundHeight(hx, peakZ) * 0.8;
renderPng(
  tris,
  makeCamera(
    new THREE.Vector3(hx, hy, hz + 260),
    new THREE.Vector3(hx, peakY, peakZ)
  ),
  "screenshots/fp-02-himalaya-approach.png",
  { bgColor: BG, fogNear: 280, fogFar: 2000 }
);

// 3) Arakan Yoma: the western mountain wall dropping to the Bay of Bengal.
const ax = -0.28 * MAP_HALF;
const az = -0.22 * MAP_HALF;
const ay = groundHeight(ax, az) + 9;
const coastX = -0.52 * MAP_HALF;
const coastY = groundHeight(coastX, az) + 4;
renderPng(
  tris,
  makeCamera(
    new THREE.Vector3(ax, ay, az),
    new THREE.Vector3(coastX, coastY, az - 60)
  ),
  "screenshots/fp-03-arakan-wall.png",
  { bgColor: BG, fogNear: 240, fogFar: 1800 }
);

// 4) Full 5 km overview.
renderPng(
  tris,
  makeCamera(new THREE.Vector3(1500, 1250, 2100), new THREE.Vector3(0, 40, 0)),
  "screenshots/fp-04-map-overview.png",
  { bgColor: BG, fogNear: 1500, fogFar: 5000 }
);
