// Rust/WASM terrain generation + AI worker.
//
// This module worker owns a second instance of the local Rust core. The
// main thread sends only compact requests and receives final typed-array
// mesh/scatter/AI payloads as transferables. River/objective flattening is
// reproduced here from serialized layout samples using exactly the same
// formulas as world.js, so worker-produced terrain is a visual 1:1 match.

import {
  rustCore, loadRustCore, setRustGroundProvider, rustRawHeight,
  rustChunkTerrain, rustBuildChunkMesh, rustLocalScatter,
  rustAiBatch, rustFindPath,
} from "./ironveil-core.js";

let layout = null;
let ready = false;
let loadPromise = null;
const riverGrid = new Map();
const _ri = { d: 9999, bed: 0, water: -9999, x: 0, z: 0 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const riverCellKey = (ix, iz) => (ix + 128) * 512 + (iz + 128);

function rebuildRiverGrid() {
  riverGrid.clear();
  if (!layout || !layout.samples) return;
  const s = layout.samples;
  const cell = layout.cellSize || 50;
  for (let o = 0; o < s.length; o += 4) {
    const key = riverCellKey(Math.floor(s[o] / cell), Math.floor(s[o + 1] / cell));
    const bucket = riverGrid.get(key);
    if (bucket) bucket.push(o); else riverGrid.set(key, [o]);
  }
}

function riverInfoInto(x, z, out) {
  out.d = 9999; out.bed = 0; out.water = -9999; out.x = x; out.z = z;
  if (!layout || !layout.samples || !layout.samples.length) return out;
  const s = layout.samples;
  const cell = layout.cellSize || 50;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let best = -1, bestD2 = Infinity;
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const bucket = riverGrid.get(riverCellKey(ix, iz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const o = bucket[i];
        const dx = x - s[o], dz = z - s[o + 1];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = o; }
      }
    }
  }
  if (best < 0) return out;
  out.d = Math.sqrt(bestD2);
  out.bed = s[best + 2];
  out.water = s[best + 3];
  out.x = s[best];
  out.z = s[best + 1];
  return out;
}

function terrainHeightFromRaw(raw, x, z) {
  let h = raw;
  const dRelay = Math.hypot(x - layout.relayX, z - layout.relayZ);
  const dSpawn = Math.hypot(x - layout.spawnX, z - layout.spawnZ);
  h = lerp(layout.relayBase, h, smoothstep(9, 26, dRelay));
  h = lerp(layout.spawnBase, h, smoothstep(7, 20, dSpawn));
  const ri = riverInfoInto(x, z, _ri);
  if (ri.d < 34) {
    const t = 1 - smoothstep(9, 34, ri.d);
    h = lerp(h, ri.bed, Math.pow(t, 1.35) * 0.94);
  }
  return h;
}

function ensureReady() {
  if (!loadPromise) {
    setRustGroundProvider((x, z) => {
      if (!layout) return 0;
      const raw = rustRawHeight(layout.noiseSeed, x, z, layout.half, layout.rimStart);
      return raw === null ? 0 : terrainHeightFromRaw(raw, x, z);
    });
    loadPromise = loadRustCore().then((ok) => {
      ready = !!(ok && rustCore.ready && rustCore.v3);
      return ready;
    }).catch(() => false);
  }
  return loadPromise;
}

function fail(type, id, err) {
  self.postMessage({ type, id, ok: false, error: String((err && err.message) || err || "worker unavailable") });
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === "init") {
      layout = m.layout;
      rebuildRiverGrid();
      const ok = await ensureReady();
      self.postMessage({ type: "ready", ok, version: rustCore.version });
      return;
    }
    if (!layout || !(await ensureReady())) throw new Error("Rust worker core unavailable");

    if (m.type === "chunk") {
      const rust = rustChunkTerrain(
        layout.noiseSeed, m.minX, m.minZ, m.sizeM, m.segments,
        layout.half, layout.rimStart
      );
      if (!rust || !rust.heights) throw new Error("Rust chunk heights unavailable");
      const rowW = m.segments + 1;
      const count = rowW * rowW;
      const final = new Float64Array(count);
      const step = m.sizeM / m.segments;
      for (let row = 0; row < rowW; row++) {
        const wz = m.minZ + row * step;
        const base = row * rowW;
        for (let col = 0; col < rowW; col++) {
          const idx = base + col;
          final[idx] = terrainHeightFromRaw(rust.heights[idx], m.minX + col * step, wz);
        }
      }
      const mesh = rustBuildChunkMesh(
        final, layout.noiseSeed, m.minX, m.minZ, m.sizeM, m.segments, m.palette
      );
      if (!mesh) throw new Error("Rust chunk mesh unavailable");
      self.postMessage({
        type: "chunk", id: m.id, ok: true, key: m.key,
        positions: mesh.positions, normals: mesh.normals, colors: mesh.colors,
        light: mesh.light, indices: mesh.indices,
      }, [
        mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer,
        mesh.light.buffer, mesh.indices.buffer,
      ]);
      return;
    }

    if (m.type === "scatter") {
      const records = rustLocalScatter(layout.noiseSeed, m.kind, m.cx, m.cz, m.radius);
      if (!records) throw new Error("Rust scatter unavailable");
      self.postMessage(
        { type: "scatter", id: m.id, ok: true, kind: m.kind, cx: m.cx, cz: m.cz, records },
        [records.buffer]
      );
      return;
    }

    if (m.type === "ai") {
      const out = rustAiBatch(
        layout.noiseSeed, m.agents, m.px, m.py, m.pz, m.losM,
        layout.half, layout.rimStart
      );
      if (!out) throw new Error("Rust AI batch unavailable");
      self.postMessage({ type: "ai", id: m.id, ok: true, count: m.count, out }, [out.buffer]);
      return;
    }

    if (m.type === "path") {
      const path = rustFindPath(
        layout.noiseSeed, m.sx, m.sz, m.gx, m.gz,
        layout.half, layout.rimStart
      );
      if (!path) throw new Error("Rust path unavailable");
      self.postMessage(
        { type: "path", id: m.id, ok: true, drone: m.drone, path },
        [path.buffer]
      );
      return;
    }
  } catch (err) {
    fail(m.type || "error", m.id || 0, err);
  }
};
