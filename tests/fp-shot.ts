/*
 * Headless first-person + overview proof for the merged 5 km map.
 * Rebuilds ground geometry from the merged field at the engine's exact
 * height scale (test-only color ramp); the authoritative art runs in
 * the locked ReliefTerrain engine in-browser.
 */

import * as THREE from "three";
import { clamp, smoothstep } from "../src/terrain/locked/noise";
import {
  findSpawn,
  groundHeight,
  HEIGHT_SCALE,
  MAP_HALF,
  MAP_SIZE,
  mergedField
} from "../src/terrain/myanmarMap";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";

const SEG = 260;

function buildGround(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEG, SEG);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const h =
      mergedField(positions.getX(i) / MAP_HALF, positions.getZ(i) / MAP_HALF) * HEIGHT_SCALE;
    positions.setY(i, h);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  const pos = flat.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const stops = [
    { t: 0.0, c: new THREE.Color("#17402c") },
    { t: 0.22, c: new THREE.Color("#55704a") },
    { t: 0.52, c: new THREE.Color("#8a7c5c") },
    { t: 0.8, c: new THREE.Color("#a29c8f") },
    { t: 1.0, c: new THREE.Color("#f2f1e8") }
  ];
  const seaDeep = new THREE.Color("#0c2827");
  const seaShelf = new THREE.Color("#155049");
  const color = new THREE.Color();
  const peakH = Math.max(1e-4, maxH);

  for (let i = 0; i < pos.count; i += 3) {
    const avg = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (avg < 0) {
      color.copy(seaDeep).lerp(seaShelf, clamp((avg + 45) / 45, 0, 1));
    } else {
      const t = clamp(avg / peakH, 0, 1);
      for (let s = 1; s < stops.length; s++) {
        if (t <= stops[s].t) {
          const a = stops[s - 1];
          const b = stops[s];
          color.copy(a.c).lerp(b.c, smoothstep(a.t, b.t, t));
          break;
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = color.r;
      colors[(i + k) * 3 + 1] = color.g;
      colors[(i + k) * 3 + 2] = color.b;
    }
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    flat,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })
  );
  mesh.userData.range = { minH, maxH };
  return mesh;
}

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
