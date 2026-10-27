/*
 * Headless verification for the revised MiG-29 module (npx tsx scripts/mig.test.ts):
 * assembly, material revision, rig hooks, independent builds, render proof.
 */

import * as THREE from "three";
import { assembleMig29, AIRCRAFT } from "../game/vehicles/mig29";
import { installDomStub } from "./lib/dom-stub";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

installDomStub();

console.log("Revised MiG-29 module:");
const jet = assembleMig29();
let meshes = 0;
let pbr = 0;
let transparentGlass = 0;
const materialTypes = new Set<string>();
jet.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    meshes++;
    const m = o.material as THREE.MeshStandardMaterial;
    materialTypes.add(m.constructor.name);
    if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) pbr++;
    if (o.name.includes("canopy") === false && m.transparent && m.type === "MeshLambertMaterial") {
      transparentGlass++;
    }
  }
});

check("airframe assembles as a named group", jet.name === "MiG-29 Fulcrum 09");
check("substantial geometry survived extraction", meshes > 150, `${meshes} meshes`);
check("no PBR/physical materials remain", pbr === 0, `${pbr} PBR materials`);
check(
  "only Lambert/Basic materials are used",
  [...materialTypes].every((t) => t === "MeshLambertMaterial" || t === "MeshBasicMaterial"),
  [...materialTypes].join(",")
);
check("glass converted to transparent Lambert", transparentGlass >= 1);

const ud = jet.userData;
check(
  "rig hooks preserved",
  !!ud.canopyPivot && Array.isArray(ud.parts) && Array.isArray(ud.gear) &&
    Array.isArray(ud.missiles) && !!ud.afterburners && !!ud.beacon
);
check("aircraft spec exported", AIRCRAFT.length === 11.2 && AIRCRAFT.wingtipX === 3.55);
check("independent builds", assembleMig29() !== jet);

// Render proof from two angles.
const scene = new THREE.Scene();
scene.add(jet);
scene.updateMatrixWorld(true);
renderPng(
  gatherTriangles(scene),
  makeCamera(new THREE.Vector3(10, 5.5, 12), new THREE.Vector3(0, 1.6, 0)),
  "screenshots/mig29-hero.png",
  { fogNear: 60, fogFar: 160 }
);
renderPng(
  gatherTriangles(scene),
  makeCamera(new THREE.Vector3(-12, 3.5, -6), new THREE.Vector3(0, 1.4, 0)),
  "screenshots/mig29-rear.png",
  { fogNear: 60, fogFar: 160 }
);
console.log("  ✓ render proofs written");

console.log(failures === 0 ? "\nAll MiG tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
