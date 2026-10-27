/*
 * Spawns and updates all match vehicles. Vehicles are static props until a
 * player enters one; the manager also feeds their collision radii into the
 * C/WASM physics core every frame (bullets and actors treat them as obstacles).
 */

import * as THREE from "three";
import { CONFIG } from "../config";
import type { Rng } from "../rng";
import type { InputState } from "../input";
import type { Physics } from "../wasm/physics";
import type { World, CircleObstacle } from "../world";
import { Vehicle, type VehicleKind } from "./vehicle";
import { buildStylizedTank, buildStylizedTechnical } from "./stylized";

export class VehicleManager {
  readonly vehicles: Vehicle[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly physics: Physics,
    rng: Rng
  ) {
    const spawn = (kind: VehicleKind): THREE.Vector3 => {
      const radius = kind === "tank" ? CONFIG.vehicles.radiusTank : CONFIG.vehicles.radiusTechnical;
      for (let attempt = 0; attempt < 60; attempt++) {
        const half = CONFIG.world.size / 2 - 14;
        const x = rng.range(-half, half);
        const z = rng.range(-half, half);
        const h = this.world.heightAt(x, z);
        if (h < CONFIG.world.waterLevel + 0.8 || h > 6.5) continue;
        const blocked: CircleObstacle | undefined = this.world.obstacles.find(
          (o) => Math.hypot(o.x - x, o.z - z) < o.r + radius + 2.5
        );
        if (blocked) continue;
        const crowded = this.vehicles.some(
          (v) => Math.hypot(v.position.x - x, v.position.z - z) < 26
        );
        if (crowded) continue;
        return new THREE.Vector3(x, h, z);
      }
      // Fallback: ring placement near an edge.
      const a = rng.range(0, Math.PI * 2);
      const r = CONFIG.world.size * 0.32;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      return new THREE.Vector3(x, this.world.heightAt(x, z), z);
    };

    const add = (kind: VehicleKind) => {
      const pos = spawn(kind);
      const yaw = rng.range(0, Math.PI * 2);
      const group =
        kind === "tank" ? buildStylizedTank() : buildStylizedTechnical();
      const vehicle = new Vehicle(kind, group, yaw);
      vehicle.group.position.copy(pos);
      vehicle.group.rotation.y = yaw + Math.PI;
      scene.add(vehicle.group);
      this.vehicles.push(vehicle);
    };

    for (let i = 0; i < CONFIG.vehicles.tankCount; i++) add("tank");
    for (let i = 0; i < CONFIG.vehicles.technicalCount; i++) add("technical");

    this.physics.setVehicles(this.vehicles.map((v) => ({ x: v.position.x, z: v.position.z, r: v.radius })));
  }

  /** Drive/aim updates, vehicle-vs-vehicle push-out, physics refresh. */
  update(dt: number, input: InputState | null, physics: Physics, world: World) {
    for (const v of this.vehicles) v.update(dt, v.occupied ? input : null, physics, world);

    // Pairwise circle resolution (small N — plain JS is cheaper than a
    // second WASM round trip per vehicle).
    for (let i = 0; i < this.vehicles.length; i++) {
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const a = this.vehicles[i];
        const b = this.vehicles[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const minD = a.radius + b.radius;
        if (d > 0.001 && d < minD) {
          const push = (minD - d) / d / 2;
          a.position.x -= dx * push;
          a.position.z -= dz * push;
          b.position.x += dx * push;
          b.position.z += dz * push;
          a.speed *= 0.6;
          b.speed *= 0.6;
        }
      }
    }

    physics.setVehicles(
      this.vehicles.map((v) => ({ x: v.position.x, z: v.position.z, r: v.radius }))
    );
  }

  nearestEnterable(pos: THREE.Vector3): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD: number = CONFIG.vehicles.enterRadius;
    for (const v of this.vehicles) {
      if (v.occupied) continue;
      const d = Math.hypot(v.position.x - pos.x, v.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  byIndex(i: number): Vehicle | null {
    return this.vehicles[i] ?? null;
  }

  indexOf(v: Vehicle): number {
    return this.vehicles.indexOf(v);
  }

  dispose(scene: THREE.Scene) {
    for (const v of this.vehicles) scene.remove(v.group);
    this.vehicles.length = 0;
  }
}
