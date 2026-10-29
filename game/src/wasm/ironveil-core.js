// Loader for the local Rust -> WebAssembly terrain core.
// The .wasm asset lives in game/public/wasm/ and is served by Vite with
// the app itself: no GitHub, CDN, or other network dependency at play
// time. Loading is async and non-blocking; world.js keeps its identical
// JS implementation as the fallback until (or unless) this is ready.

export const rustCore = { ready: false, exports: null, version: 0 };
let loadPromise = null;

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
      if (version < 1 || version > 2) return false;
      rustCore.version = version;
      if (typeof ex.ironveil_raw_height !== "function") return false;
      if (typeof ex.ironveil_chunk_raw_heights !== "function") return false;
      if (typeof ex.ironveil_heights_ptr !== "function") return false;
      rustCore.exports = ex;
      rustCore.ready = true;
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

loadRustCore();
