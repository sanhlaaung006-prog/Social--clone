# IRONVEIL whole-game resource map

This is the current resource ownership map for the Vite game in `game/`. It
was produced from a code recon plus two runs of the same headless mobile
profile (`844×390`, DPR 2, `?profile=1`) before and after the aircraft-systems
optimization pass.

> Sandbox timing warning: Chromium/SwiftShader FPS is **not** phone FPS. The
> useful comparison is renderer counters and main-thread CPU ms/frame. No
> application page-error stack was reproduced in either profile; the only
> error left is the sandbox-only Vite HMR WebSocket (`ws://127.0.0.1:443`).
> The fixes below therefore remove measured main-thread/GPU/resource pressure
> and several real correctness bugs, but they do not claim to identify a
> device-specific crash that still needs a phone stack/log to prove.

## 1. Runtime topology

| Layer | File(s) | Owns | Resource rule |
|---|---|---|---|
| HTML/CSS shell | `game/index.html` | All CSS, mobile HUD/aircraft console layout, safe areas, angular anti-PS2 triangle pads | No webfont/network dependency; system condensed/monospace stacks only |
| React UI/store | `game/src/ironveil.jsx` | Zustand game state, menus, HUD, touch controls, aircraft console, death/respawn | High-frequency values are painted through refs; hidden aircraft HUD polls at about 10 Hz |
| Three.js world | `game/src/world.js` | Renderer, terrain streaming, player, drones, scatter, sky/climate, FX, aircraft simulation/weapons, cameras | One RAF owner; pooled FX/projectiles; adaptive chunk/BVH budgets |
| Reusable aircraft model | `game/src/aircraft/aircraft-core.js` | Component IDs, health/armor, derived lift/thrust/control/drag, kinetic-energy collision damage, fire/advisories | No Three.js or Warthog geometry dependency |
| Supplied A-10 pack | `game/src/aircraft/warthog.ts` | Authored geometry/materials, 10 part groups, canopy, cockpit, fans, damage emissives, reset | Game builds with blueprint edges disabled; standalone pack defaults can still build edges |
| JS physics fallback | `game/src/physics.js` | Field-for-field kinematic step if Rust is unavailable | Preallocated `Float64Array(32)` exchange buffer |
| WASM bridge | `game/src/wasm/ironveil-core.js` | Loads local Rust core, exposes height/chunk/scatter/AI/sky/physics/safety calls | Local committed WASM only; full JS/Rust-main-thread fallback |
| Terrain Worker | `game/src/wasm/terrain-worker.js` | Second Rust instance for chunk meshes, local scatter, drone AI/path batches | Transferable typed arrays; terminated by `world.dispose()` |
| Rust core | `game/wasm/ironveil-core/src/lib.rs` | Deterministic terrain/noise/mesh/scatter/AI/physics/safety ABI v5 | 112,916-byte local asset in `game/public/wasm/` |
| Audio | `game/src/audio.js` | One lazy WebAudio context, ambient loops, living turbofan loop, one-shot SFX | Singleton by design across world rebuilds; all one-shots are stopped voices |

## 2. Boot and network resources

Current production build (`npm --prefix game run build`):

| Asset | Size |
|---|---:|
| Main JS | 1,019.32 kB / 292.91 kB gzip |
| HTML + inline CSS | 104.42 kB / 21.25 kB gzip |
| Terrain Worker JS | 6.77 kB |
| Rust WASM | 112,916 bytes, local/offline |
| Recorded rifle WAV | about 44 kB, loaded only after audio unlock |

The previous Google Fonts stylesheet was removed. It was render-blocking,
failed in the baseline sandbox profile, and made first paint depend on a
third party. The game now uses installed condensed/monospace system faces with
the same CSS variables, so field/offline boot does not wait on fonts.

The main bundle remains one chunk because the world is needed immediately
behind the title screen. Splitting it would not reduce total parsed code for a
normal session; the measured hot spots were runtime work, not transfer size.

## 3. Frame ownership and cadence

| Work | Owner/cadence | Budget or gate |
|---|---|---|
| Main simulation/render | `world.js` RAF | `dt` clamped to 0.05 s; update → drones/FX/sky → HUD cache → scatter/streaming → render |
| Player physics | Main thread Rust, JS fallback | 120 Hz substeps inside the step; no Worker round trip |
| Aircraft flight | `world.js`, up to 6 substeps/frame | Damage factors are read from the reusable core; stopped wrecks no longer run the flight model forever |
| Terrain streaming decisions | Every 0.25 s | Distance/view-prioritised jobs; teleport neighbourhood remains synchronous so cuts never show a hole |
| Chunk building | Every frame, time-sliced | 1.4 ms while live frame time is >22 ms, 2.6 ms during healthy play, 4.5 ms outside live play |
| BVH construction | Deferred queue | Atomic builds run at most on alternate live frames and are deferred above 22 ms (`bvhDeferred`) |
| Scatter compaction | Checked every 0.2 s, executed only when due | Playing: camera moved >2.5 m or data >1.2 s stale; non-playing threshold 5 m; teleport forces refresh |
| Pebbles/grass | Worker batch or main-thread fallback | Skipped completely above 30 m camera AGL |
| Aircraft projectiles | Pooled shells/missiles | Update function is not called at all while both pools are inactive |
| Engine audio telemetry | World → React hook → WebAudio | About every 0.18 s, spool/load/distance/damage |
| Ambient audio scheduler | `audio.js` | One 800 ms interval for birds/crickets/leaf gusts |
| Aircraft HUD DOM | React ref painter | Seated: per frame with same-text write suppression. On foot: full paint every 6th RAF, then early-return before hidden telemetry |

## 4. Terrain, Worker and WASM resources

- Map presets remain **Battle Royale 2×2 km / 4 chunks** and **Survival
  4×4 km / 16 chunks**, each chunk 1×1 km.
- LOD segment ladder in code is **96 / 64 / 32 / 16** by Chebyshev chunk ring.
- Worker Rust returns transferable positions/normals/colors/indices; the main
  thread owns Three.js geometry upload and BVH attachment.
- If Worker scatter is stale, the previous code could call synchronous
  `rustLocalScatter` on the main thread. That fallback still exists for
  correctness, but it is now reached far less often because scatter refresh is
  movement-gated and ground detail is disabled in flight above 30 m AGL.
- If Worker/WASM fails, the selected product behaviour remains a full fallback
  to main-thread Rust/JS terrain and physics. No runtime CDN is involved.

## 5. Scatter and instancing

Survival profile placement totals in the verified run:

| Placement set | Retained CPU-side placements | Spatial index | Runtime submission |
|---|---:|---|---|
| Rocks/boulders | 7,517 | 50 m grid, 3,854 occupied cells | One `InstancedMesh`, buffer sized to placements, count compacted to the 35 m band plus pebbles |
| Trees | 14,032 | 50 m grid, 4,723 occupied cells | 5 species × 3 LOD bands = 15 `InstancedMesh` objects, 384 instances maximum each |
| Tree blob shadows | derived during compaction | — | One instanced mesh, 768 maximum |
| Grass | deterministic local cells / Worker | — | One instanced mesh, 900 maximum |
| Local obstacles | derived during compaction | 35 m player band | Preallocated `Float32Array(640×4)` |

Before this pass, each scatter refresh scanned all rock and tree placements
(21,549 records on Survival). The culler now visits only grid buckets that
intersect the relevant bands. In the final browser run it visited about
110–160 tree placements per refresh instead of 14,032. Far-tree accounting
explicitly adds unvisited placements so debug counts remain honest.

The parked Warthog adds three obstacle discs for the on-foot player. Those
indices are remembered as aircraft-self obstacles and skipped by the
aircraft's own kinetic collision solver.

## 6. Rendering resources

- Native DPR is a product requirement and remains locked to
  `window.devicePixelRatio`; there is no adaptive resolution shedding.
- Coarse pointers do not request MSAA. Shadow maps are disabled entirely;
  grounding uses blob shadows.
- Sky resources are fixed: one shader dome, 1,700 star points and three
  256×256 galaxy canvas sprites.
- FX pools are fixed: 300 impact points, 180 splash points, 5 rifle tracers.
- Aircraft weapon pools are fixed: 42 visible cannon shells and 8 missile
  objects (the A-10 configuration stores only 2 missiles). Explosions reuse
  the impact-point pool; detached aircraft parts reuse the authored part
  groups rather than spawning mesh copies.
- Six drones are persistent objects with shared body/eye geometry.

Final profile renderer counters at the capture moment were 111 calls,
110,648 triangles, 2,180 points, 129 geometries, 7 textures and 44 programs.
Triangle/call counts vary with view and scatter, so geometry/program counts
are the stable regression guardrails.

## 7. Warthog geometry and materials

The supplied pack reports:

- 10 stable part groups;
- 306 authored meshes;
- 21,658 triangles.

Runtime consolidation in `world.js` now:

1. Builds the pack with `{ edges: false }`, avoiding hundreds of hidden
   `EdgesGeometry`/`LineSegments` objects that the game never displayed.
2. Merges only opaque, visible, childless, single-material meshes that already
   share the same immediate parent and material.
3. Leaves transparent/mapped/physical materials, canopy glass, decals, canopy
   pivot, fan groups and every part group separate.
4. Freezes authored mesh-local matrices after one build (`matrixAutoUpdate =
   false`); articulation remains on groups.

Measured runtime result: **306 authored meshes → 72 runtime meshes**, across
**40 merged groups**, with the same 21,658-triangle model. Total renderer
geometries in the comparable profile fell **367 → 129**.

The pack's port/starboard signs were also corrected. Its nose is authored at
+Z, so in a right-handed frame port is +X and starboard is −X; after the game's
180° adaptation, physical side, navigation lamps, raycast damage, detach and
the HUD diagram now agree.

Hit testing is two-phase:

1. A 12 m sphere broadphase rejects ordinary terrain/drone shots before any
   aircraft mesh list is built.
2. Only then are the 72 cached runtime hit meshes submitted. Each mesh caches
   `userData.aircraftPartId`; detached parts and retracted gear are filtered.

## 8. Aircraft combat and reusable configuration

Reusable component IDs are:

`fuselage`, `canopy`, `wing-port`, `wing-starboard`, `engine-port`,
`engine-starboard`, `empennage`, `gun`, `stores`, `gear`.

Damage sources enter through the same core: small arms use per-component
armor attenuation; cannon/explosive/missile/collision loads do not. Derived
performance changes lift, thrust, pitch/roll authority, drag, asymmetric
roll/yaw, gear state, cockpit/gun/stores availability and fire/catastrophic
state.

Collision damage is based on kinetic energy:

```text
KE(MJ) = 0.5 × massKg × speed² / 1,000,000
damage ≈ clamp(sqrt(KE) × 13 + closingSpeed × 0.55, 0, 320)
```

The world applies per-sample load shares for nose, fuselage, both wingtips,
gear and tail, removes inward velocity and pushes the airframe out of the
obstacle. Retracted gear and already-detached parts are not collision samples.

Weapons are **capability data**, not assumptions in the solver:

- The A-10 config installs the pack's GAU-8/A (1,174 rounds) on `gun`.
- The A-10 config installs two AIM-9-class missiles on `stores`.
- Destroying `gun` disables the cannon; destroying `stores` disables missile
  launch. A future unarmed aircraft can omit either entry and neither the
  world nor HUD will invent it.

Engine life is layered from existing state rather than extra objects: intake
fans and exhaust glow follow spool, one persistent WebAudio turbofan loop is
wave-modulated by spool/load/damage, and tactical advisories derive from
stall, terrain sink, component health, fire and explosion timer.

## 9. Memory and disposal

`world.dispose()` now:

- terminates the terrain Worker and clears the Rust ground provider;
- cancels RAF, window/visual-viewport listeners and resize timers;
- dedupes geometries, materials and textures before disposal;
- disposes BVH data, shader-uniform textures, canvas textures and the PMREM
  environment texture through material texture discovery;
- clears the scene, terrain chunk map/mesh list, chunk jobs/queue, BVH queue
  and Worker pending map;
- disposes render lists and the renderer.

React's `WorldScene` unsubscribes from the store and calls that dispose path
when the map preset changes or the component unmounts. This closes the old
map-switch leak where shared materials/textures could survive on the same
canvas/WebGL context.

Audio is the deliberate exception: one context, one set of ambient/engine
loops and one scheduler persist for the page. Rebuilding a world does not
create another audio graph.

## 10. Measured before/after

Same sandbox profile shape, 844×390 at DPR 2. Absolute FPS is software-render
noise and is omitted as a product claim.

| Metric | Baseline | Final | Change |
|---|---:|---:|---:|
| Warthog runtime meshes | 306 | 72 | −76% |
| Renderer geometries | 367 | 129 | −65% |
| Draw calls at capture | 119 | 111 | view-dependent |
| CPU update p50 / p95 | 2.6 / 34.9 ms | 0.8 / 14.2 ms | lower |
| CPU render p50 / p95 | 4.4 / 23.8 ms | 1.8 / 15.6 ms | lower |
| CPU total p50 / p95 | 10.0 / 96.6 ms | 2.7 / 29.5 ms | lower |
| JS heap used at capture | 44.7 MB | 47.4 MB | no heap reduction claimed |
| DOM nodes | 285 | 278 | similar |
| External font request | failed request present | none | removed |

JS heap did not fall in this short profile: merged non-indexed geometry,
retained placement records and browser allocation variance offset the removed
edge objects. The important resource wins are fewer GPU geometry objects,
fewer scene meshes, much smaller scatter visits, gated BVH/chunk work and
removal of hot-path full-subtree matrix updates/allocations.

## 11. Hot-path allocation rules now in force

- No full `warthog.group.updateMatrixWorld()` around per-frame part, missile,
  gun, collision or camera lookups; `localToWorld` updates ancestors only.
- Aircraft collision samples and scratch vectors are preallocated.
- Projectile activity is counted during the existing pool pass; no per-frame
  `reduce()` scans.
- Debug health keys are precomputed once per component.
- Aircraft HUD text is written only when the string changes.
- Scatter, chunk and BVH work are budgeted/gated instead of unconditional.
- Detached debris reuses authored groups; impact/explosion particles reuse
  typed-array pools.

## 12. Verification used for this map

- `npm --prefix game run build` — passes; only known Vite runtime-WASM and
  chunk-size warnings remain.
- Node unit checks against `aircraft-core.js` for aliases, gun armor,
  asymmetric performance, explosive destruction, KE and advisories.
- Full browser systems run: on-foot aircraft-part raycast, wing detach,
  entry/idle engine, anti-PS2 triangle geometry, bottom-left damage diagram,
  top-right camera toggle, manual thrust/no self-takeoff, W liftoff/climb,
  cannon, missile, cockpit/chase cameras, engine fire, ejection/parachute
  survival, seated explosion/death overlay, respawn/repair and on-foot
  movement. Safety rescues remained 0 and no application page errors were
  reported.
- Real screenshots are committed under `screenshots/aircraft-systems-*.png`.
