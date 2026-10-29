// Loader for the local Rust -> WebAssembly terrain core.
// The .wasm asset lives in game/public/wasm/ and is served by Vite with
// the app itself: no GitHub, CDN, or other network dependency at play
// time. Loading is async and non-blocking; world.js keeps its identical
// JS implementation as the fallback until (or unless) this is ready.

export const rustCore = { ready: false, exports: null, version: 0, v3: false };
let loadPromise = null;
let skyLut = null;
let skyBins = 0;

export function loadRustCore() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
      const res = await fetch(base + "wasm/ironveil_core.wasm");
      if (!res.ok) return false;
      const bytes = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const ex = instance.exports;
      if (!ex.memory || typeof ex.ironveil_abi_version !== "function") return false;
      const version = ex.ironveil_abi_version();
      if (version < 1 || version > 3) return false;
      rustCore.version = version;
      if (typeof ex.ironveil_raw_height !== "function") return false;
      if (typeof ex.ironveil_chunk_raw_heights !== "function") return false;
      if (typeof ex.ironveil_heights_ptr !== "function") return false;
      rustCore.exports = ex;
      rustCore.ready = true;
      rustCore.v3 = version >= 3
        && typeof ex.ironveil_build_chunk_mesh === "function"
        && typeof ex.ironveil_scatter_local === "function"
        && typeof ex.ironveil_ai_batch === "function"
        && typeof ex.ironveil_find_path === "function";
      if (rustCore.v3 && typeof ex.ironveil_build_sky_lut === "function"
        && typeof ex.ironveil_sky_lut_ptr === "function") {
        skyBins = ex.ironveil_build_sky_lut();
        if (skyBins > 0) {
          skyLut = new Float32Array(ex.memory.buffer, ex.ironveil_sky_lut_ptr(), 3 * skyBins * 12).slice();
        }
      }
      return true;
    } catch (e) {
      return false; // JS fallback stays in charge
    }
  })();
  return loadPromise;
}

export function rustRawHeight(seed, x, z, half, rimStart) {
  if (!rustCore.ready) return null;
  const v = rustCore.exports.ironveil_raw_height(seed >>> 0, x, z, half, rimStart);
  return Number.isFinite(v) ? v : null;
}

// Returns a copied Float64Array of (segments+1)^2 raw heights in
// row-major order (row = +Z, col = +X), or null when Rust is absent.
function runChunkBatch(seed, minX, minZ, sizeM, segments, half, rimStart) {
  if (!rustCore.ready) return 0;
  const expected = (segments + 1) * (segments + 1);
  const count = rustCore.exports.ironveil_chunk_raw_heights(
    seed >>> 0, minX, minZ, sizeM, segments, half, rimStart
  );
  return count === expected ? count : 0;
}

export function rustChunkRawHeights(seed, minX, minZ, sizeM, segments, half, rimStart) {
  const count = runChunkBatch(seed, minX, minZ, sizeM, segments, half, rimStart);
  if (!count) return null;
  const ex = rustCore.exports;
  return new Float64Array(ex.memory.buffer, ex.ironveil_heights_ptr(), count).slice();
}

// Combined getter: copied raw heights plus (ABI v2) baked per-vertex
// lighting/AO factors, or null when Rust is absent.
export function rustChunkTerrain(seed, minX, minZ, sizeM, segments, half, rimStart) {
  const count = runChunkBatch(seed, minX, minZ, sizeM, segments, half, rimStart);
  if (!count) return null;
  const ex = rustCore.exports;
  const heights = new Float64Array(ex.memory.buffer, ex.ironveil_heights_ptr(), count).slice();
  let light = null;
  if (typeof ex.ironveil_lighting_ptr === "function") {
    light = new Float32Array(ex.memory.buffer, ex.ironveil_lighting_ptr(), count).slice();
  }
  return { heights, light };
}
// ---- ABI v3: full mesh / scatter / AI / sky-LUT helpers ----

export function rustBuildChunkMesh(finalHeights, seed, minX, minZ, sizeM, segments, palette) {
  if (!rustCore.ready || !rustCore.v3 || !finalHeights || !palette || palette.length < 12) return null;
  const ex = rustCore.exports;
  const expected = (segments + 1) * (segments + 1);
  if (finalHeights.length < expected) return null;
  new Float64Array(ex.memory.buffer, ex.ironveil_final_heights_ptr(), expected)
    .set(finalHeights.subarray ? finalHeights.subarray(0, expected) : finalHeights.slice(0, expected));
  const count = ex.ironveil_build_chunk_mesh(seed >>> 0, minX, minZ, sizeM, segments, ...palette.slice(0, 12));
  if (count !== expected) return null;
  const f32 = (ptrFn, n) => new Float32Array(ex.memory.buffer, ex[ptrFn](), n).slice();
  return {
    positions: f32("ironveil_positions_ptr", count * 3),
    normals: f32("ironveil_normals_ptr", count * 3),
    colors: f32("ironveil_colors_ptr", count * 3),
    splat: f32("ironveil_splat_ptr", count * 4),
    light: f32("ironveil_lighting_ptr", count),
    indices: new Uint32Array(ex.memory.buffer, ex.ironveil_indices_ptr(), segments * segments * 6).slice(),
  };
}

export function rustLocalScatter(seed, kind, cx, cz, radius) {
  if (!rustCore.ready || !rustCore.v3) return null;
  const ex = rustCore.exports;
  const count = ex.ironveil_scatter_local(seed >>> 0, kind, cx, cz, radius);
  if (!count) return null;
  return new Float32Array(ex.memory.buffer, ex.ironveil_scatter_ptr(), count * 10).slice();
}

// agents: Float32Array stride 6 [x,y,z,anchorX,anchorZ,hover].
// Returns stride 8 [dist,clear,threat,wayX,wayZ,wayY,minClear,clearRatio].
export function rustAiBatch(seed, agents, px, py, pz, losM, half, rimStart) {
  if (!rustCore.ready || !rustCore.v3 || !agents || agents.length < 6) return null;
  const ex = rustCore.exports;
  const count = Math.min(32, Math.floor(agents.length / 6));
  new Float32Array(ex.memory.buffer, ex.ironveil_ai_in_ptr(), count * 6)
    .set(agents.subarray ? agents.subarray(0, count * 6) : agents.slice(0, count * 6));
  const n = ex.ironveil_ai_batch(seed >>> 0, count, px, py, pz, losM, half, rimStart);
  if (n !== count) return null;
  return new Float32Array(ex.memory.buffer, ex.ironveil_ai_out_ptr(), n * 8).slice();
}

// Returns a copied Float32Array of XZ path pairs, or null.
export function rustFindPath(seed, sx, sz, gx, gz, half, rimStart) {
  if (!rustCore.ready || !rustCore.v3) return null;
  const ex = rustCore.exports;
  const count = ex.ironveil_find_path(seed >>> 0, sx, sz, gx, gz, half, rimStart);
  if (!count) return null;
  return new Float32Array(ex.memory.buffer, ex.ironveil_path_ptr(), count * 2).slice();
}

// Samples the Rust-built sky/cloud LUT into out[12]:
// zenith rgb, horizon rgb, sun rgb, cloud rgb (sRGB 0..1).
export function rustSkySample(cycle, weatherA, weatherB, blend, out) {
  if (!skyLut || !out || out.length < 12) return false;
  const bins = skyBins, ch = 12;
  const u = (((cycle % 1) + 1) % 1) * bins;
  const b0 = Math.floor(u) % bins, b1 = (b0 + 1) % bins, f = u - Math.floor(u);
  const wa = Math.max(0, Math.min(2, weatherA | 0)), wb = Math.max(0, Math.min(2, weatherB | 0));
  const t = Math.max(0, Math.min(1, blend));
  for (let c = 0; c < ch; c++) {
    const a0 = skyLut[(wa * bins + b0) * ch + c], a1 = skyLut[(wa * bins + b1) * ch + c];
    const e0 = skyLut[(wb * bins + b0) * ch + c], e1 = skyLut[(wb * bins + b1) * ch + c];
    const av = a0 + (a1 - a0) * f, bv = e0 + (e1 - e0) * f;
    out[c] = av + (bv - av) * t;
  }
  return true;
}

loadRustCore();
