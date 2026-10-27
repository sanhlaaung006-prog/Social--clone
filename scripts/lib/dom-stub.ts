/*
 * Minimal DOM/canvas stub so headless Node scripts can import modules that
 * create CanvasTextures on demand (canvas-texture vehicle modules).
 */

const noop = () => {};

export function installDomStub(): void {
  if (typeof globalThis.document !== "undefined") return;

  const ctx2d = new Proxy(
    {},
    {
      get: (t, prop) => {
        if (prop in t) return (t as Record<string | symbol, unknown>)[prop];
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return () => ({ addColorStop: noop });
        return typeof prop === "string" ? noop : undefined;
      },
      set: (t, prop, value) => {
        (t as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }
  );

  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 256, height: 256, getContext: () => ctx2d }),
  };
}
