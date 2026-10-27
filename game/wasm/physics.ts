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
  kind: "terrain" | "cover" | "actor";
  actorIndex?: number;
}

export interface Physics {
  readonly wasm: boolean;
  setObstacles(obstacles: CircleObstacle[]): void;
  resolveCircles(x: number, z: number, radius: number): [number, number];
  rayTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number;
  rayCover(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number;
  /** Upload actor hit cylinders (base position, radius, height) for this frame. */
  setActors(actors: { x: number; y: number; z: number; r: number; h: number }[]): void;
  rayActors(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): { index: number; t: number } | null;
  /** Nearest hit across terrain, cover and actors. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): RayHit | null;
}

/* ------------------------------ WASM impl ------------------------------ */

interface PhysExports {
  phys_balloc(n: number): number;
  phys_breset(): void;
  phys_make_floats(count: number): number;
  phys_set3(p: number, i: number, a: number, b: number, c: number): void;
  phys_set5(p: number, i: number, a: number, b: number, c: number, d: number, e: number): void;
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

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    const tt = this.rayTerrain(origin, dir, maxT);
    if (tt >= 0) best = { t: tt, kind: "terrain" };
    const tc = this.rayCover(origin, dir, maxT);
    if (tc >= 0 && (!best || tc < best.t)) best = { t: tc, kind: "cover" };
    const ta = this.rayActors(origin, dir, maxT);
    if (ta && (!best || ta.t < best.t)) best = { t: ta.t, kind: "actor", actorIndex: ta.index };
    return best;
  }
}

/* ------------------------------- JS impl ------------------------------- */

export class JsPhysics implements Physics {
  readonly wasm = false;
  private obstacles: CircleObstacle[] = [];
  private cylinders: { x: number; y: number; z: number; r: number; h: number }[] = [];

  setObstacles(obstacles: CircleObstacle[]) {
    this.obstacles = obstacles;
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
    let best = maxT;
    for (const o of this.obstacles) {
      const cx = o.x;
      const cy = 1.5;
      const cz = o.z;
      const cr = o.r * 1.6 + 0.25;
      const ex = origin.x - cx;
      const ey = origin.y - cy;
      const ez = origin.z - cz;
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

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    const tt = this.rayTerrain(origin, dir, maxT);
    if (tt >= 0) best = { t: tt, kind: "terrain" };
    const tc = this.rayCover(origin, dir, maxT);
    if (tc >= 0 && (!best || tc < best.t)) best = { t: tc, kind: "cover" };
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
