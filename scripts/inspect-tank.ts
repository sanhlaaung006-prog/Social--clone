/*
 * Inspection harness for reference/myanmar-mbt-tank.html.
 *
 * The vendor file is a standalone browser module (CDN importmap + DOM UI).
 * This script extracts its inline module, executes it in a vm sandbox with
 * DOM/WebGL stubs and the locally-installed THREE, then renders the tank
 * factory's output with the headless CPU rasterizer.
 *
 * Nothing here is imported by the game — it is a read-only inspection tool.
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "three";
import { gatherTriangles, makeCamera, renderPng } from "./lib/raster";
import { TankForge as ExtractedForge, TANK_PRESETS } from "../game/vehicles/tankForge";
import { installDomStub } from "./lib/dom-stub";

const html = readFileSync("reference/myanmar-mbt-tank.html", "utf8");
const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!moduleMatch) throw new Error("inline module script not found");

let code = moduleMatch[1]
  .replace(/^import .*$/gm, "") // drop three / OrbitControls ESM imports
  .replace(/export\s+/gm, "");

/* ------------------------------- DOM stubs -------------------------------- */

const noop = () => {};
const ctxStub = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "measureText") return () => ({ width: 0 });
      return typeof prop === "string" ? () => ({ addColorStop: noop }) : undefined;
    },
    set: () => true,
  }
);

const classListStub = () =>
  new Proxy(
    {},
    {
      get: (t, prop) => (prop in t ? (t as Record<string | symbol, unknown>)[prop] : noop),
      set: (t, prop, value) => {
        (t as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }
  );

const elementStub = () =>
  new Proxy(
    { style: {}, classList: classListStub(), dataset: {} },
    {
      get(t, prop) {
        if (prop in t) return (t as Record<string | symbol, unknown>)[prop];
        if (prop === "getContext") return () => ctxStub;
        if (prop === "width" || prop === "height") return 256;
        // Any other DOM method/property the viewer touches (setAttribute, ...).
        return typeof prop === "string" ? noop : undefined;
      },
      set: (t, prop, value) => {
        (t as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }
  );

const documentStub = {
  createElement: () => elementStub(),
  getElementById: () => elementStub(),
  querySelector: () => elementStub(),
  querySelectorAll: () => [],
  addEventListener: noop,
  body: elementStub(),
};

class FakeRenderer {
  domElement = elementStub();
  shadowMap = {};
  setSize = noop;
  setPixelRatio = noop;
  setClearColor = noop;
  render = noop;
  dispose = noop;
}
class FakeControls {
  target = new THREE.Vector3();
  update = noop;
  enableDamping = false;
  [key: string]: unknown;
}

const windowCapture: Record<string, unknown> = {};
// THREE's ESM namespace exports are read-only; proxy in the renderer stub.
const threeWithStub = new Proxy(THREE, {
  get(target, prop) {
    if (prop === "WebGLRenderer") return FakeRenderer;
    return Reflect.get(target, prop);
  },
});
const sandbox = {
  THREE: threeWithStub,
  OrbitControls: FakeControls,
  document: documentStub,
  window: new Proxy(
    { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: noop },
    {
      get(t, prop) {
        if (prop === "TankForge") return windowCapture.TankForge;
        return (t as Record<string | symbol, unknown>)[prop];
      },
      set(t, prop, value) {
        if (prop === "TankForge") windowCapture.TankForge = value;
        (t as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }
  ),
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: noop,
  cancelAnimationFrame: noop,
  addEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "vendor-tank.js" });

// The vendor assigns window.TankForge = { build, load, presets, ... }
const TankForge = windowCapture.TankForge ?? (sandbox.window as { TankForge?: unknown }).TankForge;
if (!TankForge || typeof (TankForge as { build?: unknown }).build !== "function") {
  throw new Error("TankForge factory not found after eval");
}
const forge = TankForge as {
  build: (spec: Record<string, unknown>) => THREE.Group;
  presets: Record<string, Record<string, unknown>>;
};

/* ------------------------------ render presets ----------------------------- */

const keys = Object.keys(forge.presets);
console.log(`TankForge presets: ${keys.join(", ")}`);

const vmMeshCounts: Record<string, number> = {};

for (const key of keys) {
  const tank = forge.build(forge.presets[key]);
  const scene = new THREE.Scene();
  scene.add(tank);
  scene.updateMatrixWorld(true);

  // Count geometry parts and flag/star decals for the report.
  let meshes = 0;
  const decals: string[] = [];
  tank.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      if (o.name) decals.push(o.name);
    }
  });
  vmMeshCounts[key] = meshes;
  console.log(`preset ${key}: ${meshes} meshes; named parts: ${decals.join(", ") || "(none)"}`);

  const tris = gatherTriangles(scene);
  // Three-quarter hero view and side view.
  renderPng(
    tris,
    makeCamera(new THREE.Vector3(9, 5.2, 10), new THREE.Vector3(0, 1, 0)),
    `screenshots/tank-${key}-hero.png`,
    { fogNear: 40, fogFar: 120 }
  );
  renderPng(
    tris,
    makeCamera(new THREE.Vector3(0, 2.6, 13), new THREE.Vector3(0, 1, 0)),
    `screenshots/tank-${key}-side.png`,
    { fogNear: 40, fogFar: 120 }
  );
}

/* ----------------- extracted ESM module fidelity check -------------------- */

// The extracted module only touches the DOM when buildTank() creates its
// canvas textures. Give headless Node a no-op 2D canvas stub for that path.
installDomStub();

console.log("\nExtracted module (game/vehicles/tankForge.ts) vs vendor VM:");
let fidelityFailures = 0;
for (const key of Object.keys(TANK_PRESETS)) {
  const tank = ExtractedForge.build((TANK_PRESETS as Record<string, Record<string, unknown>>)[key]);
  let meshes = 0;
  let decalCount = 0;
  tank.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      if (o.name === "flagDecal" || o.name === "starInsignia") decalCount++;
    }
  });
  const ok = meshes === vmMeshCounts[key];
  if (!ok) fidelityFailures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${key}: extracted ${meshes} meshes, vendor ${vmMeshCounts[key]}; ` +
      `${decalCount} flag/star decals preserved`
  );

  // Visual proof render of the extracted module's long preset.
  if (key === "long") {
    const scene = new THREE.Scene();
    scene.add(tank);
    renderPng(
      gatherTriangles(scene),
      makeCamera(new THREE.Vector3(9, 5.2, 10), new THREE.Vector3(0, 1, 0)),
      "screenshots/tank-extracted-long.png",
      { fogNear: 40, fogFar: 120 }
    );
  }
}
if (fidelityFailures > 0) process.exitCode = 1;

console.log("done");
