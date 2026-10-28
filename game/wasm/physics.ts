/*
 * Physics bridge over the clang/WASM physics_core.c. Static cover obstacles
 * live in WASM linear memory; per-frame actor cylinders are re-uploaded each
 * shot. JsPhysics mirrors the C math exactly when the module is unavailable.
 */

import * as THREE from "three";
import { CONFIG } from "../config";
import { loadWasmModule } from "./loadModule";
import type { CircleObstacle } from "../world";

export interface RayHit {
  t: number;
  kind: "terrain" | "cover" | "actor" | "vehicle";
  actorIndex?: number;
  vehicleIndex?: number;
}

export interface Physics {
  readonly wasm: boolean;
  setObstacles(obstacles: CircleObstacle[]): void;
  /** Dynamic vehicle collision volumes, refreshed whenever vehicles move. */
  setVehicles(vehicles: { x: number; y: number; z: number; r: number }[]): void;
  resolveCircles(x: number, z: number, radius: number): [number, number];
  resolveAgainstVehicles(x: number, z: number, radius: number): [number, number];
  rayTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number;
  rayCover(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number;
  rayVehicles(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number;
  /** Upload actor hit cylinders (base position, radius, height) for this frame. */
  setActors(actors: { x: number; y: number; z: number; r: number; h: number }[]): void;
  rayActors(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): { index: number; t: number } | null;
  /** Nearest hit across terrain, cover, vehicles and actors. */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number,
    skipVehicle?: number
  ): RayHit | null;
}

/* ------------------------------ WASM impl ------------------------------ */

interface PhysExports {
  phys_balloc(n: number): number;
  phys_breset(): void;
  phys_make_floats(count: number): number;
  phys_set3(p: number, i: number, a: number, b: number, c: number): void;
  phys_set4(p: number, i: number, a: number, b: number, c: number, d: number): void;
  phys_set5(p: number, i: number, a: number, b: number, c: number, d: number, e: number): void;
  phys_ray_vehicles(
    vehP: number, count: number,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxT: number
  ): number;
  phys_resolve_circles(
    obsP: number, count: number, posP: number, radius: number, half: number
  ): void;
  phys_ray_spheres(
    obsP: number, count: number,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxT: number
  ): number;
  phys_ray_terrain(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxT: number, seed: number
  ): number;
  phys_ray_cylinders(
    cyP: number, count: number,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxT: number, outTP: number
  ): number;
  memory: WebAssembly.Memory;
}

class WasmPhysics implements Physics {
  readonly wasm = true;
  private readonly e: PhysExports;
  private obsPtr = 0;
  private obsCount = 0;
  // Separate strides: 3-float [x,z,r] for circle resolution,
  // 4-float [x,y,z,r] for height-aware ray spheres. Buffers are reused
  // while the vehicle count is stable (it is fixed for a match).
  private vehPtr = 0;
  private vehCap = 0;
  private vehRayPtr = 0;
  private vehRayCap = 0;
  private vehCount = 0;
  private cylPtr = 0;
  private cylCapacity = 0;
  private posPtr = 0;
  private outTPtr = 0;

  constructor(mod: NonNullable<Awaited<ReturnType<typeof loadWasmModule>>>) {
    this.e = mod.instance.exports as unknown as PhysExports;
    this.posPtr = this.e.phys_make_floats(2);
    this.outTPtr = this.e.phys_make_floats(1);
  }

  setObstacles(obstacles: CircleObstacle[]) {
    this.obsPtr = this.e.phys_make_floats(obstacles.length * 3);
    this.obsCount = obstacles.length;
    obstacles.forEach((o, i) => this.e.phys_set3(this.obsPtr, i, o.x, o.z, o.r));
  }

  setVehicles(vehicles: { x: number; y: number; z: number; r: number }[]) {
    this.vehCount = vehicles.length;
    if (vehicles.length > this.vehCap) {
      this.vehPtr = this.e.phys_make_floats(vehicles.length * 3);
      this.vehCap = vehicles.length;
    }
    if (vehicles.length > this.vehRayCap) {
      this.vehRayPtr = this.e.phys_make_floats(vehicles.length * 4);
      this.vehRayCap = vehicles.length;
    }
    vehicles.forEach((v, i) => {
      this.e.phys_set3(this.vehPtr, i, v.x, v.z, v.r);
      this.e.phys_set4(this.vehRayPtr, i, v.x, v.y, v.z, v.r);
    });
  }

  resolveAgainstVehicles(x: number, z: number, radius: number): [number, number] {
    const f = new Float32Array(this.e.memory.buffer);
    f[this.posPtr / 4] = x;
    f[this.posPtr / 4 + 1] = z;
    this.e.phys_resolve_circles(
      this.vehPtr, this.vehCount, this.posPtr,
      radius, CONFIG.world.size / 2 - 2
    );
    const f2 = new Float32Array(this.e.memory.buffer);
    return [f2[this.posPtr / 4], f2[this.posPtr / 4 + 1]];
  }

  resolveCircles(x: number, z: number, radius: number): [number, number] {
    const f = new Float32Array(this.e.memory.buffer);
    f[this.posPtr / 4] = x;
    f[this.posPtr / 4 + 1] = z;
    this.e.phys_resolve_circles(
      this.obsPtr, this.obsCount, this.posPtr,
      radius, CONFIG.world.size / 2 - 2
    );
    const f2 = new Float32Array(this.e.memory.buffer);
    return [f2[this.posPtr / 4], f2[this.posPtr / 4 + 1]];
  }

  rayTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    return this.e.phys_ray_terrain(
      origin.x, origin.y, origin.z,
      dir.x, dir.y, dir.z, maxT, CONFIG.seed
    );
  }

  rayCover(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    return this.e.phys_ray_spheres(
      this.obsPtr, this.obsCount,
      origin.x, origin.y, origin.z,
      dir.x, dir.y, dir.z, maxT
    );
  }

  rayVehicles(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    return this.e.phys_ray_vehicles(
      this.vehRayPtr, this.vehCount,
      origin.x, origin.y, origin.z,
      dir.x, dir.y, dir.z, maxT
    );
  }

  setActors(actors: { x: number; y: number; z: number; r: number; h: number }[]) {
    if (actors.length > this.cylCapacity) {
      this.cylPtr = this.e.phys_make_floats(actors.length * 5);
      this.cylCapacity = actors.length;
    }
    actors.forEach((a, i) =>
      this.e.phys_set5(this.cylPtr, i, a.x, a.y, a.z, a.r, a.h)
    );
    this.cylCount = actors.length;
  }
  private cylCount = 0;

  rayActors(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number) {
    const idx = this.e.phys_ray_cylinders(
      this.cylPtr, this.cylCount,
      origin.x, origin.y, origin.z,
      dir.x, dir.y, dir.z, maxT, this.outTPtr
    );
    if (idx < 0) return null;
    const f = new Float32Array(this.e.memory.buffer);
    return { index: idx, t: f[this.outTPtr / 4] };
  }

  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number,
    skipVehicle = -1
  ): RayHit | null {
    let best: RayHit | null = null;
    const tt = this.rayTerrain(origin, dir, maxT);
    if (tt >= 0) best = { t: tt, kind: "terrain" };
    const tc = this.rayCover(origin, dir, maxT);
    if (tc >= 0 && (!best || tc < best.t)) best = { t: tc, kind: "cover" };
    if (skipVehicle < 0) {
      const tv = this.rayVehicles(origin, dir, maxT);
      if (tv >= 0 && (!best || tv < best.t)) best = { t: tv, kind: "vehicle" };
    }
    const ta = this.rayActors(origin, dir, maxT);
    if (ta && (!best || ta.t < best.t)) best = { t: ta.t, kind: "actor", actorIndex: ta.index };
    return best;
  }
}

/* ------------------------------- JS impl ------------------------------- */

export class JsPhysics implements Physics {
  readonly wasm = false;
  private obstacles: CircleObstacle[] = [];
  private vehicles: { x: number; y: number; z: number; r: number }[] = [];
  private cylinders: { x: number; y: number; z: number; r: number; h: number }[] = [];

  setObstacles(obstacles: CircleObstacle[]) {
    this.obstacles = obstacles;
  }

  setVehicles(vehicles: { x: number; y: number; z: number; r: number }[]) {
    this.vehicles = vehicles;
  }

  /** Sphere-ray for static cover: fixed 1.5-unit sphere center. */
  private coverSphereRay(
    list: CircleObstacle[],
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number,
    expand: number
  ): number {
    let best = maxT;
    for (const o of list) {
      const cy = 1.5;
      const cr = o.r * expand + 0.25;
      const ex = origin.x - o.x;
      const ey = origin.y - cy;
      const ez = origin.z - o.z;
      const b = ex * dir.x + ey * dir.y + ez * dir.z;
      const c = ex * ex + ey * ey + ez * ez - cr * cr;
      const disc = b * b - c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      let t = -b - s;
      if (t < 0.01) t = -b + s;
      if (t > 0.01 && t < best) best = t;
    }
    return best >= maxT ? -1 : best;
  }

  /**
   * Vehicle ray: the sphere center rides 1.5 units above the vehicle's own
   * ground height so hulls parked on simplex hills remain ray-hittable.
   */
  private vehicleSphereRay(
    list: { x: number; y: number; z: number; r: number }[],
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number
  ): number {
    let best = maxT;
    for (const o of list) {
      const cy = o.y + 1.5;
      const cr = o.r * 1.6 + 0.25;
      const ex = origin.x - o.x;
      const ey = origin.y - cy;
      const ez = origin.z - o.z;
      const b = ex * dir.x + ey * dir.y + ez * dir.z;
      const c = ex * ex + ey * ey + ez * ez - cr * cr;
      const disc = b * b - c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      let t = -b - s;
      if (t < 0.01) t = -b + s;
      if (t > 0.01 && t < best) best = t;
    }
    return best >= maxT ? -1 : best;
  }

  resolveAgainstVehicles(x: number, z: number, radius: number): [number, number] {
    for (const v of this.vehicles) {
      const dx = x - v.x;
      const dz = z - v.z;
      const d2 = dx * dx + dz * dz;
      const minD = v.r + radius;
      if (d2 < minD * minD) {
        const d = Math.sqrt(d2);
        if (d < 1e-5) {
          x = v.x + minD;
          continue;
        }
        const push = (minD - d) / d;
        x += dx * push;
        z += dz * push;
      }
    }
    return [x, z];
  }

  resolveCircles(x: number, z: number, radius: number): [number, number] {
    const half = CONFIG.world.size / 2 - 2;
    x = THREE.MathUtils.clamp(x, -half, half);
    z = THREE.MathUtils.clamp(z, -half, half);
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d2 = dx * dx + dz * dz;
      const minD = o.r + radius;
      if (d2 < minD * minD) {
        const d = Math.sqrt(d2);
        if (d < 1e-5) {
          x = o.x + minD;
          continue;
        }
        const push = (minD - d) / d;
        x += dx * push;
        z += dz * push;
      }
    }
    return [x, z];
  }

  rayTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    // Must match phys_ray_terrain() in physics_core.c.
    const step = 0.55;
    let prevT = 0;
    let prevGap = origin.y - this.ground(origin.x, origin.z);
    for (let t = step; t <= maxT; t += step) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const gap = py - this.ground(px, pz);
      if (gap <= 0 && prevGap > 0) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + dir.y * mid;
          const mg = my - this.ground(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (mg > 0) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }
      prevGap = gap;
      prevT = t;
    }
    return -1;
  }

  private ground(x: number, z: number): number {
    // Late-bound to avoid importing the noise loader at module scope.
    return JsPhysics.heightFn(x, z);
  }
  static heightFn: (x: number, z: number) => number = () => 0;

  rayCover(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    return this.coverSphereRay(this.obstacles, origin, dir, maxT, 1.6);
  }

  rayVehicles(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    return this.vehicleSphereRay(this.vehicles, origin, dir, maxT);
  }

  setActors(actors: { x: number; y: number; z: number; r: number; h: number }[]) {
    this.cylinders = actors;
  }

  rayActors(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number
  ): { index: number; t: number } | null {
    let hit: { index: number; t: number } | null = null;
    for (let i = 0; i < this.cylinders.length; i++) {
      const c = this.cylinders[i];
      const ex = origin.x - c.x;
      const ez = origin.z - c.z;
      const bq = ex * dir.x + ez * dir.z;
      const cq = ex * ex + ez * ez - c.r * c.r;
      const disc = bq * bq - cq;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      for (const t of [-bq - s, -bq + s]) {
        if (t < 0.01 || t >= maxT) continue;
        const y = origin.y + dir.y * t;
        if (y >= c.y && y <= c.y + c.h && (!hit || t < hit.t)) {
          hit = { index: i, t };
        }
      }
    }
    return hit;
  }

  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number,
    skipVehicle = -1
  ): RayHit | null {
    let best: RayHit | null = null;
    const tt = this.rayTerrain(origin, dir, maxT);
    if (tt >= 0) best = { t: tt, kind: "terrain" };
    const tc = this.rayCover(origin, dir, maxT);
    if (tc >= 0 && (!best || tc < best.t)) best = { t: tc, kind: "cover" };
    if (skipVehicle < 0) {
      const tv = this.rayVehicles(origin, dir, maxT);
      if (tv >= 0 && (!best || tv < best.t)) best = { t: tv, kind: "vehicle" };
    } else {
      // Gunner firing from inside a vehicle: ignore its own collision sphere.
      const others = this.vehicles.filter((_, i) => i !== skipVehicle);
      const tv = this.vehicleSphereRay(others, origin, dir, maxT);
      if (tv >= 0 && (!best || tv < best.t)) best = { t: tv, kind: "vehicle" };
    }
    const ta = this.rayActors(origin, dir, maxT);
    if (ta && (!best || ta.t < best.t)) best = { t: ta.t, kind: "actor", actorIndex: ta.index };
    return best;
  }
}

export function bindJsPhysicsHeight(fn: (x: number, z: number) => number) {
  JsPhysics.heightFn = fn;
}

let cached: Promise<Physics> | null = null;

export function loadPhysics(): Promise<Physics> {
  if (cached) return cached;
  cached = (async () => {
    const mod = await loadWasmModule();
    if (mod) return new WasmPhysics(mod);
    return new JsPhysics();
  })();
  return cached;
}
