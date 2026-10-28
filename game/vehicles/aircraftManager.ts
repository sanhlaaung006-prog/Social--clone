/*
 * Spawns and updates flyable aircraft. Aircraft are static props until
 * boarded; unlike ground vehicles they keep flying when vacated (the
 * pure model spools down and auto-lands), so no ground obstacle resolution
 * runs unless the craft is on the ground.
 */

import * as THREE from "three";
import { CONFIG } from "../config";
import type { Rng } from "../rng";
import type { InputState } from "../input";
import type { Physics } from "../wasm/physics";
import type { World, CircleObstacle } from "../world";
import { Aircraft, type AircraftKind } from "./aircraft";
import { buildStylizedJet } from "./stylized";
import { buildWarthog } from "./warthog";

export class AircraftManager {
  readonly aircraft: Aircraft[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    physics: Physics,
    rng: Rng,
    groundVehicles: { position: THREE.Vector3; radius: number }[] = []
  ) {
    void physics;
    const spawn = (): THREE.Vector3 => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const half = CONFIG.world.size / 2 - 16;
        const x = rng.range(-half, half);
        const z = rng.range(-half, half);
        const h = this.world.heightAt(x, z);
        // Runways need flatter ground than wheeled vehicles.
        if (h < CONFIG.world.waterLevel + 0.8 || h > 4.5) continue;
        const blocked: CircleObstacle | undefined = this.world.obstacles.find(
          (o) => Math.hypot(o.x - x, o.z - z) < o.r + CONFIG.flight.radius + 2.5
        );
        if (blocked) continue;
        const crowdedAir = this.aircraft.some(
          (a) => Math.hypot(a.position.x - x, a.position.z - z) < 34
        );
        if (crowdedAir) continue;
        const crowdedGround = groundVehicles.some(
          (v) => Math.hypot(v.position.x - x, v.position.z - z) < v.radius + 14
        );
        if (crowdedGround) continue;
        return new THREE.Vector3(x, h, z);
      }
      const a = rng.range(0, Math.PI * 2);
      const r = CONFIG.world.size * 0.3;
      const x = Math.cos(a) * r;
      return new THREE.Vector3(x, 0, Math.sin(a) * r);
    };

    const add = (kind: AircraftKind) => {
      const pos = spawn();
      const yaw = rng.range(0, Math.PI * 2);
      const group = kind === "warthog" ? buildWarthog() : buildStylizedJet();
      const craft = new Aircraft(kind, group, pos, yaw);
      scene.add(craft.group);
      this.aircraft.push(craft);
    };

    for (let i = 0; i < CONFIG.flight.jetCount; i++) add("jet");
    for (let i = 0; i < CONFIG.flight.warthogCount; i++) add("warthog");
  }

  update(dt: number, input: InputState | null, physics: Physics, world: World): void {
    for (const craft of this.aircraft) {
      craft.update(dt, craft.occupied ? input : null, physics, world);
    }
  }

  nearestEnterable(pos: THREE.Vector3): Aircraft | null {
    let best: Aircraft | null = null;
    let bestD: number = CONFIG.vehicles.enterRadius;
    for (const craft of this.aircraft) {
      if (craft.occupied) continue;
      const d = Math.hypot(craft.position.x - pos.x, craft.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = craft;
      }
    }
    return best;
  }

  volumes(): { x: number; y: number; z: number; r: number }[] {
    return this.aircraft.map((a) => a.volume());
  }

  dispose(scene: THREE.Scene): void {
    for (const craft of this.aircraft) scene.remove(craft.group);
    this.aircraft.length = 0;
  }
}
