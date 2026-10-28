# Technology & package inventory — Golden Land Royale

_Generated 2026-10-28 for the AI researcher. Everything below is verifiable
from the repository at branch `arena/3a691dda-social-clone`, the global npm
prefix, and `~/.img2threejs/` on this machine._

## 1. Project in one paragraph

Myanmar-inspired mobile-first 3D low-poly battle royale. Three.js renders
WebGL in a React 18 shell bundled by Vite 5; gameplay simulation and physics
run from TypeScript with a clang-compiled C/WASM core; an additional Web
Worker runs that physics off the main thread; Capacitor wraps the web build
into an Android APK. All art is procedural (zero image textures in shipped
gameplay); the art direction is smooth stylized low-poly, never voxel/box.

## 2. Languages & lines of code (shipped + test code)

| Language | Where | LOC |
|---|---|---:|
| TypeScript (`.ts`) | `game/`, `scripts/`, config | 7,539 |
| TSX React (`.tsx`) | `src/`, `components/` | 571 |
| C (`.c`, clang → WASM) | `game/wasm/native/` (2 files) | 413 |
| CSS | `src/globals.css` | 499 |
| JavaScript (`.mjs`) | `scripts/extract-mig.mjs` | 219 |
| GLSL | inline in `game/world.ts` sky shader | small |

44 TypeScript/TSX/C source files total under `game/ src/ components/ scripts/`.

## 3. npm packages (exact versions, from `package.json`)

### Runtime dependencies

| Package | Version | Role |
|---|---|---|
| `three` | 0.170.0 | WebGL engine, all 3D geometry/materials/instancing |
| `react` | 18.3.1 | UI shell, HUD, menus, touch controls |
| `react-dom` | 18.3.1 | React DOM renderer |
| `@capacitor/core` | 6.1.2 | Native bridge for the APK |
| `@capacitor/android` | 6.1.2 | Android platform package |

### Dev dependencies

| Package | Version | Role |
|---|---|---|
| `vite` | 5.4.11 | Dev server + production bundler (module workers, chunk splitting) |
| `typescript` | 5.5.3 | `tsc --noEmit` strict type gate (`noUnusedLocals` etc.) |
| `tsx` | 4.19.2 | Direct TS execution for all headless test/screenshot scripts |
| `@vitejs/plugin-react` | 4.3.4 | React Fast Refresh / JSX in Vite |
| `pngjs` | 7.0.0 | PNG encode in the dependency-free CPU rasterizer |
| `@types/node` | 20.14.10 | Node typings |
| `@types/react` / `@types/react-dom` | 18.3.3 / 18.3.0 | React typings |
| `@types/three` | 0.170.0 | Three typings |
| `@types/pngjs` | 6.0.5 | pngjs typings |
| `@capacitor/cli` | 6.1.2 | `cap add/sync` + APK pipeline |

### Globally installed on this machine (NOT in the game's package.json)

| Package | Version | Why global |
|---|---|---|
| `img2threejs` | 0.1.1 (Apache-2.0, zero deps, no install scripts) | Agent-skill CLI; not an importable library and not a game dependency |

## 4. Toolchain versions

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.22.3 | ESM (`"type": "module"`) |
| npm | 10.9.8 | |
| Git | 2.39.5 | |
| Python | 3.11.2 | Only used by the img2threejs skill's `forge/` (stdlib-only) |
| clang + lld | not in sandbox | WASM compiler; GitHub Actions installs them and builds `public/wasm/math_core.wasm`; local runs use the bit-identical TS fallback automatically |
| Android SDK/Gradle | not in sandbox | APK build runs where the Android platform is present (`npm run android:apk`) |

## 5. All npm scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server (0.0.0.0:5173) |
| `npm run build` | `tsc --noEmit` then `vite build` |
| `npm run preview` | Vite static preview of `dist/` |
| `npm test` | 8 suites in sequence: smoke, physics, vehicles, art-style, quality, worker, mig, integration |
| `npm run screenshot` | Headless CPU rasterizer writes `screenshots/*.png` (no browser/GPU) |
| `npm run build:wasm` | clang wasm32 build of the two C files |
| `npm run extract:mig` | Legacy showcase extraction (`.mjs`) |
| `npm run android:add/sync/apk` | Capacitor Android pipeline |

## 6. Game code map (TypeScript modules)

### Core loop & presentation
| File | Responsibility |
|---|---|
| `game/engine.ts` | WebGLRenderer, ACES tone mapping, FogExp2, frame loop, match flow, ray dispatch to worker/fallback |
| `game/config.ts` | All tuning constants incl. high/low quality-tier budgets |
| `game/input.ts` | Unified touch + keyboard/mouse `InputState`, pointer lock |
| `game/hud.ts` | HUD snapshot types shared engine → React |
| `game/rng.ts` | Seeded RNG + bot callsigns |

### World & graphics
| File | Responsibility |
|---|---|
| `game/world.ts` | Simplex terrain heightfield mesh, vertex colors, sky shader, water waves, pagoda, huts, instanced trees/rocks/grass/clouds, ambient animation |
| `game/geometry/kit.ts` | Shared procedural geometry builders (loft, jittered blobs, gabled prism, struts, palette variation) |
| `game/instancedCuller.ts` | Per-instance frustum + distance culling with matrix compaction |
| `game/device.ts` | high/low quality-tier detection (`?quality=` override) |
| `game/cameraRig.ts` | First-person rig: YXZ look, head bob/sway/roll, landing dip, ADS/sprint FOV, rifle view model; vehicle chase + menu orbit |
| `game/zone.ts` | Shrinking battle-royale circle (ring + cylinder wall) |

### Actors & combat
| File | Responsibility |
|---|---|
| `game/actors.ts` | Rounded humanoid builder, `Player` controller, `Bot` state-machine AI, shared `buildRifleModel()` |
| `game/combat.ts` | Tracer pool, muzzle flash, canister/hex-tin pickups |

### Vehicles (off-limits for unrelated edits per owner)
| File | Responsibility |
|---|---|
| `game/vehicles/stylized.ts` | Hand-authored wedge-hull tank, extruded technical, cone-nose jet |
| `game/vehicles/mig29.ts` | Vendored Lambert-only MiG-29 showcase (`jet.html`) |
| `game/vehicles/vehicle.ts` / `manager.ts` | Arcade kinematics, spawning, vehicle physics upload |

### C/WASM physics + worker layer
| File | Responsibility |
|---|---|
| `game/wasm/native/math_core.c` | Seeded hash, value noise, **Gustavson simplex**, simplex fBm, IQ-warped `terrain_height` |
| `game/wasm/native/physics_core.c` | Bump allocator, circle resolution, terrain raymarch, sphere/cylinder ray tests, height-aware vehicle rays |
| `game/wasm/noise.ts` | WASM/JS noise bridge + bit-identical TS mirror of the C |
| `game/wasm/physics.ts` | `WasmPhysics` + `JsPhysics` behind one `Physics` interface |
| `game/wasm/loadModule.ts` | Shared WASM fetch/instantiate with silent fallback |
| `game/wasm/physicsWorkerCore.ts` | Environment-agnostic worker physics core (testable without threads) |
| `game/wasm/physicsWorker.ts` | Vite module-worker entry (postMessage) |
| `game/wasm/rayService.ts` | Main-thread facade: deferred `drain()`, timeouts, sync fallback |

### React layer
| File | Responsibility |
|---|---|
| `src/main.tsx`, `src/App.tsx` | Mount, engine lifecycle, overlay composition |
| `components/HUD.tsx` | Health/ammo/zone/kill-feed/crosshair/menus |
| `components/Minimap.tsx` | 2D canvas tactical minimap |
| `components/TouchControls.tsx` | Joystick, look pad, fire/aim/jump/reload |

## 7. WASM & worker architecture

```
clang --target=wasm32 -O2 -nostdlib -mbulk-memory (CI)
        math_core.c + physics_core.c
                 │  instantiate
                 ▼
   Main thread                     Web Worker (separate 29 kB chunk)
   ───────────────                 ────────────────────────────────
   JsPhysics (sync fallback)  ◄── bit-identical outputs ──►  WasmPhysics/JsPhysics
   movement collisions (sync)                               raycasts only
   RayService.request() ──postMessage(JSON)──────────────►  terrain/cover/
   RayService.drain()  ◄──────────── rayResult ───────────  vehicle/actor rays
```
- Worker inactivity (no Worker global, fetch fail, 4 s timeout) → all rays
  resolve synchronously on the main thread exactly as before.
- WASM absence (no clang locally) → TS mirror, proven identical by tests.

## 8. Test & verification matrix (8 suites, all green)

| Suite | Coverage |
|---|---|
| `smoke.ts` | Noise/simplex bounds, determinism, terrain relief, RNG |
| `physics.test.ts` | WASM/JS parity, circles, ray tests |
| `vehicles.test.ts` | Driving/steering/collision, no-BoxGeometry rules |
| `art-style.test.ts` | Anti-voxel source gate + runtime scene checks |
| `quality.test.ts` | Tier table, culler compaction, mobile World profile |
| `worker.test.ts` | Worker/local ray parity, deferred drain, fallback |
| `mig.test.ts` | Showcase module assembly/material contracts |
| `integration.ts` | 30-second headless full-match simulation |

CI (`.github/workflows/ci.yml`, `android.yml`): clang WASM build → `npm test`
→ `tsc` + Vite build → artifacts. No browser is needed anywhere; the custom
CPU rasterizer (`scripts/lib/raster.ts`, pngjs only) renders proof PNGs.

## 9. Latest production bundle (Vite output in `dist/assets/`)

| Chunk | Raw size |
|---|---:|
| three (vendor) | 516.7 kB (gzip 132.6 kB) |
| react (vendor) | 140.9 kB (gzip 45.3 kB) |
| main (game) | 74.4 kB (gzip 24.9 kB) |
| physicsWorker | 29.4 kB |
| jet showcase | 39.0 kB |
| modulepreload polyfill | 0.7 kB |

## 10. img2threejs installation record

- **What it is:** an Apache-2.0 CLI that installs an AI-agent *skill*
  ("turn a reference image into a code-only procedural Three.js model",
  staged sculpt pipeline with Python stdlib `forge/`). It has no importable
  API, no dependencies, and no install scripts.
- **CLI:** `img2threejs@0.1.1` installed globally (`/usr/local/bin/img2threejs`).
- **Skill content:** tag `v2.0.0`, SHA `a669e9a97cea4452b1c2310c5cca6aa0f6657c1f`,
  checked out at `~/.img2threejs/releases/a669e9a…/img2threejs/` (7.1 MB;
  the same canonical layout the CLI manages).
- **Link state:** none — this sandbox has none of the four supported agent
  host directories (`~/.hermes`, `~/.claude`, `~/.codex`,
  `~/.config/opencode`), so `img2threejs install` correctly refuses.
  On a machine with a host, run `img2threejs install` and it symlinks the
  release into `<host>/skills/img2threejs`.
- **Relevance to this game:** methodology only — its code-only primitive
  reconstruction philosophy matches the existing anti-voxel, zero-texture
  pipeline; nothing from it is imported by the game.

## 11. Open-source provenance & licenses already in use

See `reference/oss-research.md`. Headline: three.js MIT, React MIT, Vite MIT,
Capacitor MIT, pngjs MIT; studied/referenced MIT projects (folio-2019,
3d-web-game-dev-skills, three.js PointerLockControls r170); one no-license
project used for techniques only.
