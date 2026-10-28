/*
 * Quality-tier and per-instance culling tests (npx tsx scripts/quality.test.ts).
 * Covers the device decision table, the culler compaction contract and the
 * mobile World profile without needing a browser or renderer.
 */

import * as THREE from "three";
import { tierFromSignals } from "../game/device";
import { InstanceCuller } from "../game/instancedCuller";
import { JsNoise } from "../game/wasm/noise";
import { World } from "../game/world";
import { CONFIG } from "../game/config";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log("Device tier decision:");
check("desktop signals -> high", tierFromSignals({
  mobileUA: false, coarsePointer: false, shortScreen: false, weakCpu: false, lowMemory: false,
}) === "high");
check("mobile UA -> low", tierFromSignals({
  mobileUA: true, coarsePointer: true, shortScreen: true, weakCpu: true, lowMemory: false,
}) === "low");
check("low deviceMemory dominates", tierFromSignals({
  mobileUA: false, coarsePointer: false, shortScreen: false, weakCpu: false, lowMemory: true,
}) === "low");
check("coarse pointer alone stays high", tierFromSignals({
  mobileUA: false, coarsePointer: true, shortScreen: false, weakCpu: false, lowMemory: false,
}) === "high");
check("coarse + weak CPU -> low", tierFromSignals({
  mobileUA: false, coarsePointer: true, shortScreen: false, weakCpu: true, lowMemory: false,
}) === "low");

console.log("Instance culler:");
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, 2);
  const dummy = new THREE.Object3D();
  dummy.position.set(0, 0, -5);
  dummy.updateMatrix();
  mesh.setMatrixAt(0, dummy.matrix);
  dummy.position.set(0, 0, -500);
  dummy.updateMatrix();
  mesh.setMatrixAt(1, dummy.matrix);
  mesh.count = 2;
  mesh.instanceMatrix.needsUpdate = true;
  const centers = new Float32Array([0, 0, -5, 0, 0, -500]);
  const radii = new Float32Array([1, 1]);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 600);
  camera.updateMatrixWorld(true);

  // Cullers are constructed once, at full count, as the World does.
  const tight = new InstanceCuller(mesh, centers, radii, 10);
  const wide = new InstanceCuller(mesh, centers, radii, 1000);
  tight.update(camera);
  check("far instance culled by distance", mesh.count === 1, `count=${mesh.count}`);

  wide.update(camera);
  check("both instances restored with larger radius", mesh.count === 2, `count=${mesh.count}`);

  const behind = new THREE.InstancedMesh(geo, mat, 1);
  dummy.position.set(0, 0, 8); // behind the default camera
  dummy.updateMatrix();
  behind.setMatrixAt(0, dummy.matrix);
  behind.instanceMatrix.needsUpdate = true;
  const c2 = new Float32Array([0, 0, 8]);
  const behindCuller = new InstanceCuller(behind, c2, new Float32Array([1]), 1000);
  behindCuller.update(camera);
  check("behind-camera instance frustum-culled", behind.count === 0, `count=${behind.count}`);
}

console.log("Mobile world profile:");
{
  const noise = new JsNoise();
  const high = new World(noise, "high");
  const low = new World(noise, "low");

  check("low tier drops prop density", low.obstacles.length < high.obstacles.length,
    `low=${low.obstacles.length} high=${high.obstacles.length}`);
  const verts = (seg: number) => (seg + 1) * (seg + 1);
  const highVerts = high.terrainMesh.geometry.getAttribute("position").count;
  const lowVerts = low.terrainMesh.geometry.getAttribute("position").count;
  check("low tier uses coarser terrain mesh",
    lowVerts === verts(CONFIG.quality.low.terrainSegments) && highVerts === verts(CONFIG.quality.high.terrainSegments),
    `low=${lowVerts} high=${highVerts}`);
  check("low tier keeps spawn contract", low.spawnPoints.length >= 12,
    `spawns=${low.spawnPoints.length}`);
  check("low tier stays playable-size dry", low.obstacles.length > 120,
    `obstacles=${low.obstacles.length}`);

  // updateCulling must run without throwing and never raise instance counts.
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 600);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);
  let maxCount = 0;
  low.group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) maxCount += o.count;
  });
  low.updateCulling(camera);
  let after = 0;
  low.group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) after += o.count;
  });
  check("culling never increases visible instances", after <= maxCount,
    `before=${maxCount} after=${after}`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll quality tests passed.");
