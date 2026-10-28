/* Shared WASM instantiation so noise.ts and physics.ts reuse one module. */

export interface WasmModule {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
}

let cached: Promise<WasmModule | null> | null = null;

export function loadWasmModule(): Promise<WasmModule | null> {
  if (cached) return cached;

  cached = (async () => {
    if (typeof WebAssembly === "undefined") return null;
    try {
      // BASE_URL is "./" by default (vite.config base), so this resolves both
      // on static hosts and inside the Capacitor WebView's bundled origin.
      const res = await fetch(`${import.meta.env.BASE_URL}wasm/math_core.wasm`);
      if (!res.ok) throw new Error(`wasm ${res.status}`);
      const bytes = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const memory = instance.exports.memory as WebAssembly.Memory | undefined;
      if (!memory) throw new Error("wasm module exports no memory");
      return { instance, memory };
    } catch {
      return null;
    }
  })();

  return cached;
}
