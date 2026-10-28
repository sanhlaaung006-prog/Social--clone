/*
 * Vite module-worker entry: thin postMessage glue around the
 * environment-agnostic physicsWorkerCore. All logic lives in the core so
 * the same request/response contract is unit-tested without real threads.
 */

import {
  createWorkerCore,
  handleWorkerRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "./physicsWorkerCore";

const core = createWorkerCore();

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const response = await handleWorkerRequest(core, e.data);
  if (response) {
    (self as unknown as Worker).postMessage(response as WorkerResponse);
  }
};
