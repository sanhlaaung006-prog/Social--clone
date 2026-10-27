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
npm test              # smoke + physics + integration headless tests
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
  actors.ts           Rounded humanoids (cylinders/spheres), Player, bot AI
  combat.ts           Tracer pool, muzzle flash, canister/hex-tin pickups
  zone.ts             Shrinking battle-royale circle
  cameraRig.ts        Third-person orbit camera w/ terrain pull-in
  input.ts            Unified touch + keyboard/mouse input state
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
scripts/
  smoke.ts            Deterministic noise/RNG/zone tests
  physics.test.ts     Collision + raycast tests (mirrors the C algorithms)
  integration.ts      30-second headless simulated match
  screenshot.ts       CPU rasterizer: real scene geometry -> PNG (no GPU)
  vehicles.test.ts    Driving, steering, collision, stylized-geometry rules
  art-style.test.ts   Anti-voxel gate: zero boxes, smooth terrain, curved humans
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

- `antialias: false`, capped device pixel ratio (1.6 on touch devices)
- Instanced meshes for all trees and rocks; Lambert materials + flat shading
- Single directional shadow light with a player-following frustum
- Distance fog doubles as draw-distance masking
- Procedural everything — zero texture downloads; ~182 kB gzip first load
  (three.js/react split into separate cacheable vendor chunks)
