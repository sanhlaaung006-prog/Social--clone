/*
 * Physics worker tests (npx tsx scripts/worker.test.ts):
 *  - worker core parity: its JsPhysics raycasts match a local JsPhysics
 *    fed the exact same obstacle/vehicle/actor snapshots
 *  - RayService plumbing through an in-process fake worker: deferred
 *    delivery, drain() ordering, clearPending() and inactive fallback
 * No real threads or WASM bytes are required to run these.
 */

import * as THREE from "three";
import { JsNoise } from "../game/wasm/noise";
import { JsPhysics, bindJsPhysicsHeight, type RayHit } from "../game/wasm/physics";
import {
  createWorkerCore,
  handleWorkerRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "../game/wasm/physicsWorkerCore";
import { RayService } from "../game/wasm/rayService";
import type { WorkerLike } from "../game/wasm/rayService";
import { CONFIG } from "../game/config";

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

const obstacles = [
  { x: 4, z: -6, r: 1.4 },
  { x: -9, z: 3, r: 2.1 },
  { x: 14, z: 14, r: 1.0 },
];
const vehicles = [
  { x: -3, y: noise.terrainHeight(-3, 8, CONFIG.seed), z: 8, r: 2.6 },
];
const actors = [
  { x: 8, y: noise.terrainHeight(8, -10, CONFIG.seed), z: -10, r: 0.7, h: 2.4 },
  { x: -12, y: noise.terrainHeight(-12, 2, CONFIG.seed), z: 2, r: 0.7, h: 2.4 },
];

console.log("Worker core vs local physics parity:");
{
  const core = createWorkerCore();
  const ready = (await handleWorkerRequest(core, { type: "init" })) as Extract<
    WorkerResponse,
    { type: "ready" }
  >;
  check("core starts on the JS mirror without bytes", ready.type === "ready" && ready.wasm === false);

  await handleWorkerRequest(core, { type: "obstacles", obstacles });
  await handleWorkerRequest(core, { type: "vehicles", vehicles });
  await handleWorkerRequest(core, { type: "actors", actors });

  const local = new JsPhysics();
  local.setObstacles(obstacles);
  local.setVehicles(vehicles);
  local.setActors(actors);

  const rays: Array<{ o: [number, number, number]; d: [number, number, number]; range: number; skip?: number }> = [
    { o: [0, 2, 0], d: [0.9, -0.05, -0.45], range: 80 },
    { o: [0, 2, 0], d: [-0.5, 0.1, 0.86], range: 60 },
    { o: [2, 1.6, 4], d: [0.7, -0.2, -0.7], range: 40 },
    { o: [10, 3, 10], d: [-0.9, -0.1, -0.3], range: 100, skip: 0 },
    { o: [-2, 1.8, 7], d: [0.2, -0.05, -1], range: 35 },
  ];

  let mismatches = 0;
  for (const [i, ray] of rays.entries()) {
    const res = (await handleWorkerRequest(core, {
      type: "ray",
      id: i,
      origin: ray.o,
      dir: ray.d,
      maxT: ray.range,
      skipVehicle: ray.skip ?? -1,
    })) as Extract<WorkerResponse, { type: "rayResult" }>;
    const ref = local.raycast(
      new THREE.Vector3(...ray.o),
      new THREE.Vector3(...ray.d),
      ray.range,
      ray.skip ?? -1
    );
    if (!hitsEquivalent(res.hit, ref)) {
      mismatches++;
      console.error(`    ray ${i}: worker=${JSON.stringify(res.hit)} local=${JSON.stringify(ref)}`);
    }
  }
  check("every worker ray matches the local physics core", mismatches === 0, `${mismatches} mismatches`);
}

function hitsEquivalent(a: RayHit | null, b: RayHit | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (Math.abs(a.t - b.t) > 1e-4) return false;
  if (a.kind === "actor") return a.actorIndex === b.actorIndex;
  if (a.kind === "vehicle") return a.vehicleIndex === b.vehicleIndex;
  return true;
}

console.log("RayService plumbing (in-process fake worker):");
{
  // Routes messages straight through the real worker core, then schedules
  // the response as a separate task, exactly like postMessage would.
  const core = createWorkerCore();
  class FakeWorker implements WorkerLike {
    onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    async postMessage(msg: WorkerRequest) {
      const res = await handleWorkerRequest(core, msg);
      if (res && this.onmessage) {
        queueMicrotask(() => this.onmessage!({ data: res } as MessageEvent<WorkerResponse>));
      }
    }
    terminate() {
      this.onmessage = null;
    }
  }

  const service = new RayService(() => new FakeWorker());
  await service.attachWorker(new FakeWorker());
  check("service reports ready after handshake", service.ready === true);

  service.setObstacles(obstacles);
  service.setVehicles(vehicles);
  service.setActors(actors);
  // Let the queued snapshot microtasks run.
  await Promise.resolve();
  await Promise.resolve();

  let delivered: RayHit | null | undefined;
  const accepted = service.request([0, 2, 0], [0.9, -0.05, -0.45], 80, -1, (hit) => {
    delivered = hit;
  });
  check("request is accepted by a ready service", accepted === true);
  check("result is deferred until drain()", delivered === undefined);
  service.drain();
  check("drain delivers nothing before the microtask", delivered === undefined);
  await new Promise((r) => setTimeout(r, 0)); // flush async postMessage chain
  service.drain();
  check("drain delivers the worker hit", delivered !== undefined, `got ${JSON.stringify(delivered)}`);

  let second = 0;
  service.request([2, 1.6, 4], [0.7, -0.2, -0.7], 40, -1, () => second++);
  service.request([-2, 1.8, 7], [0.2, -0.05, -1], 35, -1, () => second++);
  service.clearPending();
  await Promise.resolve();
  service.drain();
  check("clearPending drops in-flight callbacks", second === 0);

  const inactive = new RayService();
  check("service without worker stays inactive", inactive.ready === false);
  check("inactive request signals fallback", inactive.request([0, 0, 0], [0, 0, -1], 10, -1, () => {}) === false);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll worker tests passed.");
