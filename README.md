# Golden Land Royale

A Myanmar-inspired **low-poly 3D battle royale**, shipping **mobile-first as an
Android APK** with the browser build as the universal fallback. Built with
**Vite + React + Three.js (WebGL) + TypeScript**, and performance-critical
math and physics written in **C and compiled to WebAssembly with clang**.

> The setting is fictional and environment-inspired — teak jungle, monsoon
> mist, a golden pagoda and stilt village huts — with neutral, made-up
> combatants. No real factions, flags or political figures appear in the game.

## Distribution: APK first, browser fallback

The same WebGL codebase ships two ways:

| Target | How | Where it builds |
| --- | --- | --- |
| **Android APK (primary)** | [Capacitor](https://capacitor.org) wraps the Vite build (`dist/`) in a system WebView (full WebGL) | `.github/workflows/android.yml` (no Android SDK in the dev sandbox) |
| **Browser (fallback)** | Static `dist/` on any static host/CDN | `.github/workflows/ci.yml` |

APK build in CI (or locally with JDK 17 + Android SDK):

```bash
npm run build:wasm     # clang -> public/wasm/math_core.wasm
npm run build          # tsc + vite build -> dist/
npx cap add android    # one-time, generates android/ (git-ignored)
npm run android:apk    # cap sync + gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

Tag a commit `v*` or run the **Android APK** workflow manually to get an APK
artifact. Play Store release needs a signed AAB (`gradlew bundleRelease`) and a
Play Console account; the debug APK is sideload-installable for testing.

## Development

```bash
npm install
npm run dev           # Vite dev server with HMR, ~150 ms cold start
npm test              # 14 headless suites: smoke, physics, vehicles, art,
                      # quality, worker, touch, bot AI, utility AI, flight...
npm run build         # type-check and production build to dist/
npm run preview       # serve the production build locally
npm run build:wasm    # clang -> public/wasm/math_core.wasm (needs clang + lld)
npm run screenshot    # CPU-rasterizer renders screenshots/ from real geometry
npm run inspect:tank  # headless inspection of the vendor tank factory model
```

## Play the vertical slice

- 12 fighters (you + 11 AI bots) on a 220-unit procedural island
- 5-phase shrinking safe zone with escalating out-of-zone damage
- Hitscan rifle with spread, tracers, muzzle flash, reload, medkit/ammo loot
- **C/WASM physics**: capsule collision, terrain raycasts, cover spheres
  (trees/rocks/huts block bullets), actor hit cylinders — bot fire is
  physically blocked by cover and terrain
- Third-person camera with over-the-shoulder aim
- Full mobile touch controls and desktop pointer-lock controls
- Drivable vehicles: 2 MBT tanks and 2 armed technicals per match, with
  driver/passenger seats, seat swap (F), enter (E) and exit (G); the
  technical's passenger operates the mounted machine gun. Vehicles are
  physics obstacles that block bullets and push actors out of the way
- Last fighter standing wins; placement + elimination stats on death

## Architecture

```
index.html            Vite entry
vite.config.ts        React plugin, @ alias, relative base, vendor chunk split
src/
  main.tsx            React mount
  App.tsx             Engine lifecycle + HUD/touch overlay composition
  globals.css         All HUD, menu and touch-control styles
components/
  HUD.tsx             Health/ammo/zone/kill-feed/menu & result overlays
  Minimap.tsx         2D-canvas tactical minimap
  TouchControls.tsx   Joystick + look pad + fire/aim/jump/reload
game/
  engine.ts           WebGLRenderer, ACES tone mapping, FogExp2, game loop
  world.ts            Smooth terrain, animated water, lathe pagoda, huts,
                      instanced two-species jungle, grass, drifting clouds
  geometry/kit.ts     Shared stylized builders: loft, jittered blobs,
                      gabled prism, struts, palette variation (anti-voxel)
  botBrain.ts         Utility AI: six scored actions (engage, cover, reload,
                      search, returnToZone, patrol), response curves,
                      hysteresis selector — pure, headless-testable
  actors.ts           Rounded humanoids (cylinders/spheres), Player, bot AI:
                      LOS perception feeds the utility selector; magazine +
                      reload, last-seen search, cover retreat, stall repath
  combat.ts           Tracer/flash pools, combat event queue, pickups
  zone.ts             Shrinking battle-royale circle
  cameraRig.ts        FPS camera: YXZ pointer-lock rig, head bob/sway/roll,
                      landing dip, ADS + sprint FOV, camera-attached rifle
                      view model; vehicle chase cam and menu orbit retained
  device.ts           Quality-tier detection (mobile UA, pointer, cores,
                      memory); ?quality=low|high URL override
  instancedCuller.ts  Per-instance frustum + distance culling with order-
                      preserving matrix compaction for InstancedMesh
  wasm/physicsWorkerCore.ts  Environment-agnostic worker physics core
  wasm/physicsWorker.ts      Vite module-worker entry (postMessage glue)
  wasm/rayService.ts   Main-thread facade: off-thread raycasts with
                      frame-deferred drain and synchronous local fallback
  input.ts            Unified touch + keyboard/mouse input state
  touchAim.ts         Touch look filter: gesture slop, frame-rate-independent
                      low-pass, tail preservation, ADS precision gain
  adaptiveQuality.ts  Mobile render-scale governor (sustained slow/fast frames)
  flightModel.ts      Pure arcade aerodynamics: throttle, lift/stall,
                      coordinated banked turns, ceiling, landing, determinism
  config.ts           All gameplay tuning constants
  wasm/
    native/math_core.c      C: value noise, fBM, terrain heightfield
    native/physics_core.c   C: bump allocator, circle resolve, ray vs
                            heightfield/spheres/cylinders (clang -> WASM)
    build-wasm.sh           clang --target=wasm32 build script
    loadModule.ts           Shared WASM instantiation
    noise.ts / physics.ts   WASM bridges + bit-identical TS fallbacks
game/vehicles/
  stylized.ts         Hand-authored stylized factory: wedge-hull tank,
                      extruded technical and cone-nose jet (no BoxGeometry,
                      flat-shaded metallic-grey/dark-green materials)
  mig29.ts            Compressed/revised MiG-29 airframe, Lambert-only (generated)
  vehicle.ts          Arcade kinematic vehicle: throttle, steering, terrain
  manager.ts          Spawning, vehicle-vs-vehicle push-out, physics upload
  aircraft.ts         Flyable craft: InputState -> pure flight-model mapping,
                      YXZ airframe sync (pitch/roll conventions), ground collision
  aircraftManager.ts  Flat-ground runway spawns, enter-range/nearest queries
scripts/
  smoke.ts            Deterministic noise/RNG/zone tests
  physics.test.ts     Collision + raycast tests (mirrors the C algorithms)
  integration.ts      30-second headless simulated match
  screenshot.ts       CPU rasterizer: real scene geometry -> PNG (no GPU)
  vehicles.test.ts    Driving, steering, collision, stylized-geometry rules
  art-style.test.ts   Anti-voxel gate: zero boxes, smooth terrain, curved humans
  quality.test.ts     Tier decision table, culler compaction, low/high World
  worker.test.ts      Worker/core ray parity, deferred drain, fallback
  touch-aim.test.ts   Touch slop, low-pass smoothing, tail preservation, ADS
  bot-ai.test.ts      LOS gating, last-seen search, cover, stall repath
  bot-utility.test.ts Utility scorer policy, hysteresis, reload, zone return
  flight.test.ts      Takeoff, banked turn, stall sink, ceiling, landing,
                      transform conventions, idle auto-land, determinism
  adaptive-quality.test.ts  Slow-frame render-scale governor, recovery, floor
  combat-events.test.ts     Presentation event queue: drain, order, clear
  extract-mig.mjs     Compressing extractor: 4,160-line showcase -> mig29.ts
  mig.test.ts         MiG material revision, rig hooks and render proofs
  lib/raster.ts       Shared headless triangle rasterizer
  lib/dom-stub.ts     Headless canvas/DOM stub for texture-building modules
reference/            Supplied vehicle and terrain concepts (not shipped)
```

## Art direction: smooth stylized low-poly, no voxel

The game deliberately rejects block/voxel aesthetics. Ground is an indexed
heightfield with smooth normals and blended color ramps; props use lofts,
jittered polyhedra, tapered cylinders, lathe and extrude geometry. Raw
`THREE.BoxGeometry` is forbidden in shipped gameplay modules by
`scripts/art-style.test.ts`, which also asserts smooth terrain normals,
per-instance color variation and curved-primitive characters. Open-source
references and licenses are recorded in `reference/oss-research.md`.

## Stylized vehicle factory

`game/vehicles/stylized.ts` replaces the earlier voxel-style vendor models with
hand-authored Quaternius/PUBG-style geometry. House rules, enforced by
`scripts/vehicles.test.ts`: no raw `BoxGeometry` anywhere; hulls are custom
`BufferGeometry` wedges (sloped glacis, angled side belts) or `ExtrudeGeometry`
profiles; turrets are faceted 12-segment cylinders; barrels are horizontal
8-segment cylinders; the jet has a cone nose and swept tapered-slab wings;
every material is `flatShading: true` in a unified metallic-grey chassis /
dark-green camo palette. The MiG airframe remains viewable at **/jet.html**.

### C/WASM and the Rapier question

Rapier is a **Rust** engine (`cargo`/`wasm-pack`); clang cannot build it, so it
does not fit a clang-native toolchain. Instead `physics_core.c` implements the
subset a mobile BR needs (capsule movement, heightfield/cover/hit raycasts) in
~200 lines of dependency-free C over a linear-memory bump allocator. Every WASM
function has a line-for-line TypeScript fallback with identical math, so the
game runs with zero WASM tooling installed, and the menu shows which core is
active. Swapping in Rapier later remains possible if full rigid-body/vehicle
dynamics become necessary.

## Mobile performance notes

- Two quality tiers (`game/device.ts`, override with `?quality=low|high`):
  mobile/low-memory devices get coarser terrain/water meshes, 40% fewer
  instanced props, half-size shadow maps, pixel ratio capped at 1.25 and
  22% denser fog; desktops keep the full profile (ratio cap 2)
- Per-instance frustum + distance culling (`game/instancedCuller.ts`)
  compacts each InstancedMesh every frame; cull radii sit inside the fog
  envelope so the cutoff never visibly pops
- `antialias: false`, flat-shaded Standard materials, one directional
  shadow light with a player-following frustum
- Distance fog doubles as draw-distance masking; water normal recompute
  was removed (flat shading derives normals in-shader)
- Weapon raycasts run in a Web Worker (`wasm/`): the worker owns a full
  physics instance (WASM when it compiles, bit-mirrored JS otherwise) and
  resolves terrain/cover/vehicle/actor rays off the main thread; results
  drain at the next frame boundary, with an automatic synchronous local
  fallback if workers are unavailable
- Procedural everything — zero texture downloads; three.js/react split
  into separate cacheable vendor chunks
