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

// 5) Vehicle showcase: park one tank and one technical side by side.
{
  const tank = vehicles.vehicles.find((v) => v.kind === "tank");
  const tech = vehicles.vehicles.find((v) => v.kind === "technical");
  if (tank && tech) {
    const cx = 6;
    const cz = -10;
    const gy = world.heightAt(cx, cz);
    tank.position.set(cx - 4.5, world.heightAt(cx - 4.5, cz), cz);
    tech.position.set(cx + 4.5, world.heightAt(cx + 4.5, cz), cz);
    tank.group.rotation.y = 0.6;
    tech.group.rotation.y = -0.5;
    scene.updateMatrixWorld(true);
    shoot(
      "05-vehicles",
      new THREE.Vector3(cx, gy + 5.2, cz + 13),
      new THREE.Vector3(cx, gy + 1.2, cz)
    );
  }
}

console.log("done");
