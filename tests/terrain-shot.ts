/*
 * Headless shape proof for the FROZEN terrain (no GPU in CI).
 *
 * The locked ReliefTerrain needs a WebGL context, so this test harness
 * rebuilds only the ground displacement using the locked myanmarHeight
 * field at the engine's exact dimensions/height scale, with a test-only
 * elevation color ramp. The authoritative colors and water shader run
 * in the browser via src/terrain/locked/ReliefTerrain.ts.
 */

import * as THREE from "three";
import { myanmarHeight, clamp, smoothstep } from "../src/terrain/locked/noise";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";

const WIDTH = 130;
const DEPTH = 210;
const SEG_X = 168;
const SEG_Z = 272;
const HEIGHT_SCALE = 3.4;

function buildGroundMesh(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, SEG_X, SEG_Z);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const h =
      myanmarHeight(positions.getX(i) / (WIDTH / 2), positions.getZ(i) / (DEPTH / 2)) * HEIGHT_SCALE;
    positions.setY(i, h);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const nonIndexed = geometry.toNonIndexed();
  geometry.dispose();
  const pos = nonIndexed.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  // Test-only ramp echoing the locked elevation stops.
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
      color.copy(seaDeep).lerp(seaShelf, clamp((avg + 1.3) / 1.3, 0, 1));
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
  nonIndexed.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  nonIndexed.computeVertexNormals();
  nonIndexed.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    nonIndexed,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })
  );
  mesh.name = "ground";
  mesh.userData.range = { minH, maxH };
  return mesh;
}

const scene = new THREE.Scene();
const ground = buildGroundMesh();
scene.add(ground);
// No opaque sea stand-in: the locked ground mesh already bakes sea-deep /
// sea-shelf vertex colors where the height field drops below level 0,
// which is what shows through the transparent water in the real engine.

const range = ground.userData.range as { minH: number; maxH: number };
console.log(`ground range: ${range.minH.toFixed(2)} .. ${range.maxH.toFixed(2)} world units`);

const tris = gatherTriangles(scene);
console.log(`triangles sent to rasterizer: ${tris.length}`);

const STAGE_BG = 0x14241a;

renderPng(
  tris,
  makeCamera(new THREE.Vector3(30, 84, 146), new THREE.Vector3(0, 2, 4)),
  "screenshots/terrain-01-overview.png",
  { bgColor: STAGE_BG, fogNear: 260, fogFar: 760 }
);

// Hkakabo Razi region: u=0.10, v=-0.80 -> world (6.5, ?, -84).
renderPng(
  tris,
  makeCamera(new THREE.Vector3(38, 34, -46), new THREE.Vector3(6, 8, -84)),
  "screenshots/terrain-02-himalaya.png",
  { bgColor: STAGE_BG, fogNear: 110, fogFar: 380 }
);

// Irrawaddy delta: u=-0.10, v=0.50 -> world (-6.5, ?, 52.5).
renderPng(
  tris,
  makeCamera(new THREE.Vector3(24, 24, 84), new THREE.Vector3(-6, 1, 52)),
  "screenshots/terrain-03-delta.png",
  { bgColor: STAGE_BG, fogNear: 80, fogFar: 280 }
);
