/*
 * Headless proof shots for the Mandalay-inspired royal city on the
 * 5 km merged field. CPU raster (see lib/raster.ts): geometry is exact,
 * lighting is an ambient + sun approximation; the browser build adds
 * the locked engine's ACES tone mapping, hemisphere light and IBL.
 */

import * as THREE from "three";
import { buildGround } from "./lib/ground";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";
import { CITY_SEED, citySurfaceY, planCity } from "../src/city/layout";
import { buildCity } from "../src/city/buildCity";
import { groundHeight } from "../src/terrain/myanmarMap";

const plan = planCity(CITY_SEED, groundHeight);
const city = buildCity(plan);

const scene = new THREE.Scene();
scene.add(buildGround());
scene.add(city.group);

const tris = gatherTriangles(scene);
console.log(`city pieces: ${city.stats.pieces}, city triangles: ${city.stats.triangles}, scene triangles: ${tris.length}`);

const BG = 0x1d3325;
const padY = plan.padY;
// ACES rolloff keeps the deliberately light plaster/marble surfaces
// from clipping to white under the harness ambient floor.
const CITY_TONE = { toneMap: "aces" as const, exposure: 1.05 };

// 1) Aerial oblique: the whole terraced city in its dry-zone basin.
renderPng(
  tris,
  makeCamera(new THREE.Vector3(880, 640, 980), new THREE.Vector3(0, padY, 0)),
  "screenshots/city-01-aerial.png",
  { bgColor: BG, fogNear: 900, fogFar: 3600, ...CITY_TONE }
);

// 2) Street level on a northbound road, twin-house rows flanking it and
// the gilded pagoda visible down the avenue.
{
  const road = plan.roads.find((r) => r.axis === "z" && Math.abs(r.x - 364) < 3);
  const eyeX = road?.x ?? 364;
  const eyeZ = 420;
  const eyeY = citySurfaceY(plan, eyeX, eyeZ) ?? groundHeight(eyeX, eyeZ);
  renderPng(
    tris,
    makeCamera(
      new THREE.Vector3(eyeX, eyeY + 4.2, eyeZ),
      new THREE.Vector3(eyeX - 4, eyeY + 14, eyeZ - 420)
    ),
    "screenshots/city-02-twin-houses.png",
    { bgColor: BG, fogNear: 90, fogFar: 780, ...CITY_TONE }
  );
}

// 3) Gilded great pagoda over its ring of kyauksa-gu shrines, elevated.
{
  const pagoda = plan.landmarks.find((l) => l.kind === "greatPagoda")!;
  const eye = new THREE.Vector3(pagoda.x + 128, pagoda.baseY + 96, pagoda.z + 108);
  const target = new THREE.Vector3(pagoda.x, pagoda.baseY + 14, pagoda.z);
  renderPng(
    tris,
    makeCamera(eye, target),
    "screenshots/city-03-pagoda-court.png",
    { bgColor: BG, fogNear: 110, fogFar: 850, ...CITY_TONE }
  );
}

// 4) Citadel gate and tiered pyatthat pavilions from the ring road.
renderPng(
  tris,
  makeCamera(new THREE.Vector3(0, padY + 14, -360), new THREE.Vector3(0, padY + 8, 0)),
  "screenshots/city-04-citadel-gate.png",
  { bgColor: BG, fogNear: 100, fogFar: 850, ...CITY_TONE }
);
