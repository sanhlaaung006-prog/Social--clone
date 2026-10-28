/*
 * Environment-agnostic physics-worker core.
 *
 * This module never touches Worker/postMessage globals, so it runs both
 * inside the Vite module worker (physicsWorker.ts) and directly under the
 * headless tsx test runner. It owns a complete Physics instance:
 *  - with compiled WASM bytes it instantiates the same clang core the
 *    main thread can use, so terrain raymarching runs natively off-thread
 *  - without bytes it falls back to the bit-mirrored JsPhysics
 *
 * All request/response payloads are plain JSON-friendly data; no THREE
 * objects or class instances cross the worker boundary.
 */

import * as THREE from "three";
import { CONFIG } from "../config";
import { JsNoise } from "./noise";
import {
  JsPhysics,
  WasmPhysics,
  bindJsPhysicsHeight,
  type Physics,
  type RayHit,
} from "./physics";
import type { CircleObstacle } from "../world";

export interface VehicleVol {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface ActorCyl {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
}

export type WorkerRequest =
  | { type: "init"; wasmBytes?: ArrayBuffer }
  | { type: "obstacles"; obstacles: CircleObstacle[] }
  | { type: "vehicles"; vehicles: VehicleVol[] }
  | { type: "actors"; actors: ActorCyl[] }
  | {
      type: "ray";
      id: number;
      origin: [number, number, number];
      dir: [number, number, number];
      maxT: number;
      skipVehicle?: number;
    };

export type WorkerResponse =
  | { type: "ready"; wasm: boolean }
  | { type: "rayResult"; id: number; hit: RayHit | null };

export interface WorkerCore {
  physics: Physics | null;
  wasm: boolean;
}

export function createWorkerCore(): WorkerCore {
  return { physics: null, wasm: false };
}

/** Handles one message. Returns a response, or null for state-only posts. */
export async function handleWorkerRequest(
  core: WorkerCore,
  msg: WorkerRequest
): Promise<WorkerResponse | null> {
  switch (msg.type) {
    case "init": {
      if (msg.wasmBytes && typeof WebAssembly !== "undefined") {
        try {
          const { instance } = await WebAssembly.instantiate(msg.wasmBytes, {});
          const memory = instance.exports.memory as WebAssembly.Memory | undefined;
          if (memory) {
            core.physics = new WasmPhysics({ instance, memory });
            core.wasm = true;
            return { type: "ready", wasm: true };
          }
        } catch {
          // fall through to the JS mirror
        }
      }
      const noise = new JsNoise();
      const physics = new JsPhysics();
      bindJsPhysicsHeight((x, z) => noise.terrainHeight(x, z, CONFIG.seed));
      core.physics = physics;
      core.wasm = false;
      return { type: "ready", wasm: false };
    }

    case "obstacles": {
      core.physics?.setObstacles(msg.obstacles);
      return null;
    }

    case "vehicles": {
      core.physics?.setVehicles(msg.vehicles);
      return null;
    }

    case "actors": {
      core.physics?.setActors(msg.actors);
      return null;
    }

    case "ray": {
      const p = core.physics;
      let hit: RayHit | null = null;
      if (p) {
        const origin = new THREE.Vector3(...msg.origin);
        const dir = new THREE.Vector3(...msg.dir);
        hit = p.raycast(origin, dir, msg.maxT, msg.skipVehicle ?? -1);
      }
      return { type: "rayResult", id: msg.id, hit };
    }
  }
}
