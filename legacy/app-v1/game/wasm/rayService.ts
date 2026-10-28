/*
 * Main-thread facade over the physics worker.
 *
 * Expensive raycasts (terrain raymarching can walk 200+ height samples,
 * each a full simplex stack) run off-thread. Movement resolution stays
 * synchronous on the main thread; ray results resolve on the next frame
 * via drain(), which is imperceptible for tracer/damage feedback. When
 * Worker support or WASM fetch fails the service stays `ready === false`
 * and the engine resolves rays with its local Physics instance instead.
 *
 * The worker constructor is injectable so the headless tests can drive
 * the exact message plumbing with an in-process fake worker.
 */

import type { RayHit } from "./physics";
import type { CircleObstacle } from "../world";
import type { ActorCyl, VehicleVol, WorkerRequest, WorkerResponse } from "./physicsWorkerCore";

type RayCallback = (hit: RayHit | null) => void;

interface WorkerLike {
  postMessage(msg: WorkerRequest, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: Event) => void) | null;
  terminate(): void;
}

type WorkerFactory = () => WorkerLike;

// The literal `new Worker(new URL(..., import.meta.url))` pattern is
// required for Vite/Rollup to emit a separate worker chunk.
const defaultFactory: WorkerFactory = () =>
  new Worker(new URL("./physicsWorker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;

export class RayService {
  ready = false;
  private worker: WorkerLike | null = null;
  private seq = 1;
  private readonly callbacks = new Map<number, RayCallback>();
  private readonly results: Array<{ id: number; hit: RayHit | null }> = [];
  private readonly queued: Array<() => void> = [];
  private readyResolve: (() => void) | null = null;

  constructor(private readonly factory: WorkerFactory = defaultFactory) {}

  /** Spawns the worker and hands it the WASM bytes. Never throws. */
  async init(wasmUrl: string): Promise<void> {
    if (typeof Worker === "undefined") return;
    try {
      const res = await fetch(wasmUrl);
      if (!res.ok) return;
      const wasmBytes = await res.arrayBuffer();
      const worker = this.factory();
      // A worker that never signals ready (load error, blocked context)
      // must not hang startup: give up and stay on the local physics.
      const guard = setTimeout(() => this.readyResolve?.(), 4000);
      await this.attachWorker(worker, wasmBytes);
      clearTimeout(guard);
      if (!this.ready) this.shutdown();
    } catch {
      this.shutdown();
    }
  }

  /** Wire up an already-constructed worker (also the headless test seam). */
  async attachWorker(worker: WorkerLike, wasmBytes?: ArrayBuffer): Promise<void> {
    try {
      this.worker = worker;
      const ready = new Promise<void>((resolve) => {
        this.readyResolve = resolve;
      });
      worker.onerror = () => this.shutdown();
      worker.onmessage = (e) => this.onResponse(e.data);
      worker.postMessage({ type: "init", wasmBytes }, wasmBytes ? [wasmBytes] : undefined);
      await ready;
      // Flush snapshots taken before the worker reported ready.
      while (this.queued.length) this.queued.shift()!();
    } catch {
      this.shutdown();
    }
  }

  private onResponse(msg: WorkerResponse) {
    if (msg.type === "ready") {
      // Ready means the worker responds; wasm=false just means it is
      // running the bit-mirrored JS physics core instead of WASM.
      this.ready = true;
      this.readyResolve?.();
      this.readyResolve = null;
      return;
    }
    // Buffer ray results; the engine flushes them at the frame boundary.
    this.results.push({ id: msg.id, hit: msg.hit });
  }

  private postWhenReady(make: () => WorkerRequest) {
    if (!this.worker) return;
    if (this.ready) this.worker.postMessage(make());
    else this.queued.push(() => this.worker?.postMessage(make()));
  }

  setObstacles(obstacles: CircleObstacle[]) {
    this.postWhenReady(() => ({ type: "obstacles", obstacles }));
  }

  setVehicles(vehicles: VehicleVol[]) {
    this.postWhenReady(() => ({ type: "vehicles", vehicles }));
  }

  setActors(actors: ActorCyl[]) {
    this.postWhenReady(() => ({ type: "actors", actors }));
  }

  /** Queue an off-thread ray. Returns false when the worker is unavailable. */
  request(
    origin: [number, number, number],
    dir: [number, number, number],
    maxT: number,
    skipVehicle: number,
    cb: RayCallback
  ): boolean {
    if (!this.ready || !this.worker) return false;
    const id = this.seq++;
    this.callbacks.set(id, cb);
    this.worker.postMessage({ type: "ray", id, origin, dir, maxT, skipVehicle });
    return true;
  }

  /** Deliver ray results that arrived since the last frame, in order. */
  drain() {
    while (this.results.length) {
      const r = this.results.shift()!;
      const cb = this.callbacks.get(r.id);
      if (cb) {
        this.callbacks.delete(r.id);
        cb(r.hit);
      }
    }
  }

  /** Drop in-flight requests without firing their callbacks. */
  clearPending() {
    this.callbacks.clear();
    this.results.length = 0;
  }

  shutdown() {
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
    this.callbacks.clear();
    this.results.length = 0;
    this.queued.length = 0;
  }
}
