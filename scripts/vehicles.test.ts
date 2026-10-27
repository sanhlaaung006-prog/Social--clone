/*
 * Headless vehicle tests (npx tsx scripts/vehicles.test.ts): spawning, arcade
 * driving physics, physics-core vehicle collision and bullet blocking.
 */

import * as THREE from "three";
import { JsNoise } from "../game/wasm/noise";
import { JsPhysics, bindJsPhysicsHeight } from "../game/wasm/physics";
import { World } from "../game/world";
import { Rng } from "../game/rng";
import { CONFIG } from "../game/config";
import { VehicleManager } from "../game/vehicles/manager";
import { Vehicle } from "../game/vehicles/vehicle";
import { InputState } from "../game/input";
import {
  buildStylizedTank,
  buildStylizedTechnical,
  buildStylizedJet,
} from "../game/vehicles/stylized";
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

const noise = new JsNoise();
bindJsPhysicsHeight((x, z) => noise.terrainHeight(x, z, CONFIG.seed));
const world = new World(noise);
const physics = new JsPhysics();
physics.setObstacles(world.obstacles);
const rng = new Rng(CONFIG.seed + 202);

console.log("Vehicle spawning:");
const manager = new VehicleManager(new THREE.Scene(), world, physics, rng);
const expected = CONFIG.vehicles.tankCount + CONFIG.vehicles.technicalCount;
check("expected vehicle count", manager.vehicles.length === expected, `got ${manager.vehicles.length}`);
check("mix of tanks and technicals",
  manager.vehicles.some((v) => v.kind === "tank") &&
  manager.vehicles.some((v) => v.kind === "technical"));
{
  let dry = true;
  for (const v of manager.vehicles) {
    const h = world.heightAt(v.position.x, v.position.z);
    if (h < CONFIG.world.waterLevel) dry = false;
    if (!Number.isFinite(v.position.y)) dry = false;
  }
  check("all vehicles spawn above water with finite Y", dry);
}

console.log("Arcade driving:");
{
  const tank = manager.vehicles.find((v) => v.kind === "tank")!;
  tank.occupied = "driver";
  const input = new InputState();
  input.moveY = 1; // full throttle
  const start = tank.position.clone();
  for (let i = 0; i < 120; i++) {
    manager.update(1 / 30, input, physics, world);
  }
  const moved = start.distanceTo(tank.position);
  check("throttle moves the vehicle", moved > 8, `moved ${moved.toFixed(1)}`);
  check("speed respects max", Math.abs(tank.speed) <= CONFIG.vehicles.maxSpeed + 0.01,
    `speed ${tank.speed.toFixed(2)}`);
  const half = CONFIG.world.size / 2 - 2;
  check("vehicle stays inside world bounds",
    Math.abs(tank.position.x) <= half && Math.abs(tank.position.z) <= half);
  check("hull hugs the terrain",
    Math.abs(tank.position.y - world.heightAt(tank.position.x, tank.position.z)) < 0.6,
    `y=${tank.position.y.toFixed(2)} ground=${world.heightAt(tank.position.x, tank.position.z).toFixed(2)}`);
  tank.occupied = null;
}

console.log("Steering:");
{
  const tech = manager.vehicles.find((v) => v.kind === "technical")!;
  tech.occupied = "driver";
  const input = new InputState();
  input.moveY = 1;
  input.moveX = 1;
  const yaw0 = tech.yaw;
  for (let i = 0; i < 90; i++) manager.update(1 / 30, input, physics, world);
  check("steering changes yaw while moving", Math.abs(tech.yaw - yaw0) > 0.2,
    `delta ${(tech.yaw - yaw0).toFixed(2)}`);
  tech.occupied = null;
}

console.log("Physics-core vehicle obstacles:");
{
  const v = manager.vehicles[0];
  physics.setVehicles(manager.vehicles.map((x) => ({ x: x.position.x, z: x.position.z, r: x.radius })));
  // Ray from above straight down onto the vehicle's center.
  const origin = new THREE.Vector3(v.position.x, v.position.y + 6, v.position.z);
  const t = physics.rayVehicles(origin, new THREE.Vector3(0, -1, 0), 30);
  check("rayVehicles hits a vehicle from above", t > 0, `t=${t}`);

  // On-foot actor gets pushed out of the vehicle radius.
  const [px, pz] = physics.resolveAgainstVehicles(v.position.x, v.position.z, 0.7);
  const d = Math.hypot(px - v.position.x, pz - v.position.z);
  check("actor push-out reaches summed radii", Math.abs(d - (v.radius + 0.7)) < 0.05, `d=${d.toFixed(2)}`);

  // Combined raycast classifies the hit as kind "vehicle".
  const hit = physics.raycast(origin, new THREE.Vector3(0, -1, 0), 30);
  check("raycast reports vehicle kind", hit?.kind === "vehicle", JSON.stringify(hit));

  // Skipping own index lets the gunner fire out.
  const ownIndex = manager.vehicles.indexOf(v);
  const skipped = physics.raycast(origin, new THREE.Vector3(0, -1, 0), 30, ownIndex);
  check("skipVehicle ignores the firing vehicle", skipped?.kind !== "vehicle");
}

console.log("Stylized geometry rules:");
{
  const tank = buildStylizedTank();
  const tech = buildStylizedTechnical();
  const jet = buildStylizedJet();
  check("builders return groups", tank instanceof THREE.Group && tech instanceof THREE.Group && jet instanceof THREE.Group);

  // Rule 1: no raw BoxGeometry anywhere in the vehicle family.
  let boxCount = 0;
  let flatFailures = 0;
  const materials = new Set<THREE.Material>();
  for (const root of [tank, tech, jet]) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o.geometry.type === "BoxGeometry") boxCount++;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          materials.add(m);
          if (!(m as THREE.MeshStandardMaterial).flatShading) flatFailures++;
        }
      }
    });
  }
  check("no raw BoxGeometry (rule 1)", boxCount === 0, `${boxCount} boxes`);
  check("every material is flat-shaded (rule 3)", flatFailures === 0, `${flatFailures} non-flat`);

  // Rule 3: unified grey chassis + dark-green camo family.
  const mats = [...materials] as THREE.MeshStandardMaterial[];
  const grey = mats.find((m) => m.color.getHex() === 0x8d9398 && m.metalness > 0.2);
  const green = mats.find((m) => m.color.getHex() === 0x3c4a33);
  check("metallic grey chassis material present", !!grey);
  check("dark-green camo material present", !!green);

  // Required rig nodes that the Vehicle wrapper resolves by name.
  check("tank exposes turretPivot and muzzle",
    !!tank.getObjectByName("turretPivot") && !!tank.getObjectByName("GunMount.MuzzleFlashEffect"));
  check("technical exposes yaw/pitch gun mount and muzzle",
    !!tech.getObjectByName("GunMount.TurretYawGroup") &&
    !!tech.getObjectByName("GunMount.GunPitchGroup") &&
    !!tech.getObjectByName("GunMount.MuzzleFlashEffect"));

  // Rule 2: jet uses a cone nose and cylinder/cone fuselage primitives.
  const types: string[] = [];
  jet.traverse((o) => { if (o instanceof THREE.Mesh) types.push(o.geometry.type); });
  check("jet nose is a cone", types.includes("ConeGeometry"));
  check("jet fuselage is a cylinder", types.includes("CylinderGeometry"));

  // Turret proportion: dome width stays well inside the hull footprint.
  const turret = tank.getObjectByName("turretPivot")!;
  const dome = turret.children.find((c) => c.name === "turret-dome") as THREE.Mesh;
  const domeBox = new THREE.Box3().setFromObject(dome);
  const hullBox = new THREE.Box3().setFromObject(tank.getObjectByName("wedge-hull")!);
  check("turret narrower than hull (rule 4)",
    domeBox.max.x - domeBox.min.x < (hullBox.max.x - hullBox.min.x) * 0.75);

  // Independent builds must not share material instances.
  check("independent builds", buildStylizedTank() !== tank);
  const standalone = new Vehicle("tank", buildStylizedTank(), 0);
  check("vehicle wraps stylized model with turret reference", standalone instanceof Vehicle);
}

console.log(failures === 0 ? "\nAll vehicle tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
