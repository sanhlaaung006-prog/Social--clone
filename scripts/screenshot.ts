/*
 * Renders screenshots/ from the real game scene using the headless CPU
 * rasterizer (no browser/GPU required): npm run screenshot.
 */

import * as THREE from "three";
import { JsNoise } from "../game/wasm/noise";
import { JsPhysics, bindJsPhysicsHeight } from "../game/wasm/physics";
import { World } from "../game/world";
import { Player, Bot } from "../game/actors";
import { Rng } from "../game/rng";
import { CONFIG } from "../game/config";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";
import { VehicleManager } from "../game/vehicles/manager";
import { CameraRig } from "../game/cameraRig";
import { buildStylizedJet, buildStylizedTank, buildStylizedTechnical } from "../game/vehicles/stylized";
import { installDomStub } from "./lib/dom-stub";

installDomStub();

const noise = new JsNoise();
bindJsPhysicsHeight((x, z) => noise.terrainHeight(x, z, CONFIG.seed));
const world = new World(noise);
const rng = new Rng(CONFIG.seed + 1);
const physics = new JsPhysics();
physics.setObstacles(world.obstacles);

const player = new Player(world, physics);
const bot1 = new Bot(world, physics, "Chinthe-1", new THREE.Vector3(), rng);
const bot2 = new Bot(world, physics, "Lotus-2", new THREE.Vector3(), rng);
const vehicles = new VehicleManager(new THREE.Scene(), world, physics, rng);
const scene = new THREE.Scene();
scene.add(world.group, player.group, bot1.group, bot2.group);
for (const v of vehicles.vehicles) scene.add(v.group);

const shoot = (name: string, eye: THREE.Vector3, target: THREE.Vector3) =>
  renderPng(gatherTriangles(scene), makeCamera(eye, target), `screenshots/${name}.png`);

// 1) Establishing shot: pagoda, terraces, village and jungle.
shoot("01-overview", new THREE.Vector3(62, 46, 74), new THREE.Vector3(0, 3, 0));

// 2) Ground-level jungle with the pagoda breaking through the canopy.
{
  const x = -34;
  const z = 26;
  const y = world.heightAt(x, z);
  shoot("02-jungle", new THREE.Vector3(x, y + 3.2, z), new THREE.Vector3(4, 6, -8));
}

// 3) Third-person gameplay: player facing two bots.
{
  const px = 18;
  const pz = 14;
  const py = world.heightAt(px, pz);
  player.group.position.set(px, py, pz);
  player.yaw = Math.atan2(-(12 - px), -(4 - pz));
  bot1.group.position.set(12, world.heightAt(12, 4), 4);
  bot2.group.position.set(15, world.heightAt(15, 1), 1);
  scene.updateMatrixWorld(true);
  const eye = new THREE.Vector3(
    px + Math.sin(player.yaw) * 8.2 + 0.7,
    py + 4.6,
    pz + Math.cos(player.yaw) * 8.2
  );
  const target = new THREE.Vector3(
    px - Math.sin(player.yaw) * 4,
    py + 1.8,
    pz - Math.cos(player.yaw) * 4
  );
  shoot("03-gameplay", eye, target);
}

// 3b) First-person view through the real CameraRig: eye-height framing,
//     view-model rifle, bots downrange. Rasterizer FOCAL assumes 62 FOV.
{
  const rig = new CameraRig(16 / 9);
  scene.add(rig.camera); // view model is a camera child
  const px = 18;
  const pz = 14;
  player.group.position.set(px, world.heightAt(px, pz), pz);
  player.velocity.set(0, 0, 0);
  player.yaw = Math.atan2(-(12 - px), -(4 - pz));
  player.pitch = -0.04;
  for (let i = 0; i < 10; i++) rig.update(1 / 60, player, world, false);
  scene.updateMatrixWorld(true);
  const fpEye = rig.camera.position.clone();
  const fpF = rig.getForward(new THREE.Vector3());
  const fpR = new THREE.Vector3().crossVectors(fpF, new THREE.Vector3(0, 1, 0)).normalize();
  const fpU = new THREE.Vector3().crossVectors(fpR, fpF).normalize();
  renderPng(gatherTriangles(scene), { eye: fpEye, f: fpF, r: fpR, u: fpU }, "screenshots/09-first-person.png");
  scene.remove(rig.camera);
}

// 4) Hero shot of the golden pagoda landmark (r=6.2 obstacle marker).
{
  const pagoda = world.obstacles.find((o) => Math.abs(o.r - 6.2) < 0.01);
  if (pagoda) {
    const ground = world.heightAt(pagoda.x, pagoda.z);
    shoot(
      "04-pagoda",
      new THREE.Vector3(pagoda.x + 16, ground + 7, pagoda.z + 20),
      new THREE.Vector3(pagoda.x, ground + 5, pagoda.z)
    );
  }
}

// 5) Stylized vehicle showcase: tank, armed technical and jet in a row.
{
  const tank = vehicles.vehicles.find((v) => v.kind === "tank");
  const tech = vehicles.vehicles.find((v) => v.kind === "technical");
  const jet = buildStylizedJet();
  scene.add(jet);

  const cx = 8;
  const cz = -12;
  const place = (group: THREE.Object3D, x: number, rot: number, lift = 0) => {
    group.position.set(x, world.heightAt(x, cz) + lift, cz);
    group.rotation.y = rot;
  };
  if (tank) place(tank.group, cx - 11, 0.35);
  if (tech) place(tech.group, cx, -0.25);
  place(jet, cx + 11, 0.15, 1.0);
  const gy = world.heightAt(cx, cz);
  scene.updateMatrixWorld(true);
  shoot(
    "05-vehicles",
    new THREE.Vector3(cx, gy + 6.5, cz + 20),
    new THREE.Vector3(cx, gy + 1.4, cz)
  );

  // 6) Three-quarter close-up: wedge glacis plate, oval turret and barrel.
  if (tank) {
    const p = tank.position;
    shoot(
      "06-tank-closeup",
      new THREE.Vector3(p.x + 7.5, p.y + 3.4, p.z + 8.5),
      new THREE.Vector3(p.x, p.y + 1.3, p.z)
    );
  }
}

// 7) Clean studio lineup on a plain plane — geometry proof with no trees
//    or terrain clutter obscuring the silhouettes.
{
  const studio = new THREE.Scene();
  // Hand-wound upward quad (the rasterizer derives normals from winding;
  // a rotated PlaneGeometry resolves as back-facing in the headless painter).
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      -30, 0, -20,
      30, 0, 20,
      30, 0, -20,
      -30, 0, -20,
      -30, 0, 20,
      30, 0, 20,
    ], 3)
  );
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ color: 0x8a948c })
  );
  studio.add(ground);

  const lineup: Array<[THREE.Group, number]> = [
    [buildStylizedTank(), -11],
    [buildStylizedTechnical(), 0],
    [buildStylizedJet(), 11],
  ];
  for (const [g, x] of lineup) {
    g.position.set(x, 0, 0);
    g.rotation.y = 0.45;
    studio.add(g);
  }
  studio.updateMatrixWorld(true);
  renderPng(
    gatherTriangles(studio),
    makeCamera(new THREE.Vector3(0, 4.6, 14.5), new THREE.Vector3(0, 1.0, 0)),
    "screenshots/07-studio-lineup.png",
    { fogNear: 80, fogFar: 200 }
  );
}

console.log("done");
