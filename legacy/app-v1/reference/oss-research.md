# Open-source research — anti-voxel art direction

Cloned and inspected during the low-poly overhaul. No code is vendored from
the no-license project; the MIT projects informed techniques that were
re-authored for this codebase.

## Cloned projects

### 1. brunosimon/folio-2019 — MIT (Copyright (c) 2019 Bruno SIMON)
The reference for polished browser low-poly Three.js work.
- Custom geometry classes over primitive stacking; matcap/standard material
  discipline; one color language across the whole world
- Confirms the project direction: a small set of reusable geometry helpers
  beats per-object ad-hoc meshes
- Influenced: `game/geometry/kit.ts` as the shared builder layer

### 2. Shellishack/3d-web-game-dev-skills — MIT (Copyright (c) 2026 Shellishack)
Practical procedural-art guidance. Adopted principles (re-implemented, not
copied — the source is Babylon.js, this project is three.js):
- Trees: tapered cylinder trunk + clustered rounded leaf shapes with low
  tessellation; rocks: irregular polyhedra with seeded jitter and non-uniform
  scale → our `jitteredBlobGeometry` and two-species instanced forest
- Materials: matte finishes with deliberately low specular so stylized
  shapes don't look plastic → Standard materials with high roughness
- Deterministic seeded variation for stable reloads → `hash3`/seeded palettes
- Lighting rig: hemisphere + key directional + fill, exponential fog,
  player-centered shadow frustum (already present)
- Sky: large back-face dome, depth writes off → our gradient shader dome

### 3. brianrisk/SYNTHBLAST-threejs-game — no license file (inspection only)
Tank shooter patterns reviewed for structure only; nothing copied.
Notably its own hero still uses 4-sided cone pyramids — our faceted cylinder
turret and wedge hull go beyond its shape language.

### 4. mrdoob/three.js r170 — MIT (Copyright © 2010-2026 Three.js Authors)
Fetched `examples/jsm/controls/PointerLockControls.js` at the r170 tag
(the same three.js release the project depends on). Revised/mixed into
`game/cameraRig.ts`, not imported:
- YXZ Euler order with yaw on Y and pitch on X, and the quaternion derived
  from that Euler — the exact convention PointerLockControls uses
- ~0.002 rad/px mouse sensitivity baseline (the project's Player keeps its
  own touch/desktop sensitivities around this range)
The Shellishack player-controllers skill supplied the eye-height grounding
over a terrainHeight() function and the head-bob/air-offset controller
structure. All realism layers (counter-sway, roll, landing dip, sprint FOV,
ADS pose, camera-attached view model) are original additions.

### 5. img2threejs — Apache-2.0 (npm `img2threejs@0.1.1`, skill tag v2.0.0)
Installed as a **global agent-skill CLI**, not a game dependency (it has no
importable API). The skill reconstructs a reference image as a code-only
procedural Three.js model through a staged sculpt/self-review pipeline with
a Python 3.10+ stdlib-only `forge/`. Methodologically aligned with this
project's anti-voxel, zero-texture, primitive-first art rules; nothing is
imported at runtime. CLI lives in the global npm prefix; skill checkout at
`~/.img2threejs/releases/a669e9a9…/img2threejs/`. Full install record in
`reference/tech-inventory.md` §10.

### 6. Footprintarts/ThreeJS_FPS_2.0 — MIT (cloned to /tmp 2026-10-28, three ^0.173 / Vite 6, plain JS, 724 LOC)
Modular repackaging of the official three.js FPS example. **Borrowed as
technique reference only — no code copied.**
- Worth studying: capsule-vs-Octree depenetration math (canonical three.js
  example approach), `AnimationMixer` action dictionary, camera-attached
  gun holder (same view-model pattern as `game/cameraRig.ts`), YXZ look
  order, 5-substep physics integration.
- Defects found during inspection (do not imitate): two `WebGLRenderer`
  instances are created (`createRenderer()` called in both `main_modular`
  and `physics.js`, each with its own `setAnimationLoop`); `gameLoop.js`
  is dead code with an unexplained `delta/5`; `playerCollider.onFloor` is
  read but never defined so walk speed silently stays at the airborne
  value; no pitch clamp (camera can flip); reload/animation state driven
  by hardcoded `setTimeout(3000)` instead of clock time; per-frame
  `new THREE.Vector3()` allocations throughout; bullets are 100 physics
  spheres with O(n²) pairwise collision, not hitscan; GLB-only world via
  `collision-world.glb` + lil-gui shipped in the loader; zero touch/mobile
  support. Incompatible with our procedural, in-house C/WASM, mobile-first
  architecture.

### 7. xilinnihao-afk/sandline-threejs-fps — MIT (cloned to /tmp 2026-10-28, three 0.180 / Vite 7 / TS 5.9, 5,246 LOC)
Mobile tactical FPS; the closest design analogue in this research.
**Strongest pattern reference; version gap (10 three.js minors) and GLB
asset pipeline mean no direct code port — patterns only.**
- Architecture worth emulating: (a) pure `Simulation` class with zero
  THREE imports — seeded deterministic state + an event queue the render
  layer drains once per frame, making the whole game headless-testable;
  (b) fixed 1/60 s accumulator loop with edge-triggered input flags
  consumed per sim tick and accumulated look deltas; (c) `TouchAim`
  with 5 px gesture slop, frame-rate-independent exponential smoothing,
  and remainder preserved on finger lift; (d) bots with last-seen memory
  TTL, team reports, cover-proxy search (decision-time only, never
  per-frame), A* on a precomputed 1 m `Uint8Array` grid, stall-triggered
  repath, reaction-time + burst/rest rhythm, friendly-fire line checks,
  and no wallhack (perception-gated information only); (e) multi-sample
  blast exposure (5 body points + LOS + smoothstep falloff) instead of
  binary full/zero damage; (f) adaptive mobile render scale that only
  downgrades after 3 s sustained <48 fps with a 6 s cooldown and never
  alters aim gain; (g) separate view-model scene/camera composited with
  `clearDepth()`; (h) pause-on-blur/visibility/pointerlock-loss and
  `webglcontextlost` handling.
- Rejected parts: flat 2D box-map collision (`MAP_BOXES`, no terrain
  heightfield — our world is simplex terrain with C raymarch), GLB
  character/weapon/IK/audio asset pipeline (conflicts with the zero-asset
  procedural rule), analytics/telemetry modules, Chinese-only UI strings,
  200+ line bot-brain method (would be split if adapted).
- Candidate scoped borrows, in priority order (each a separate commit
  behind the existing test gate):
  1. **DONE (c9d044d)** TouchAim slop/smoothing → new `game/touchAim.ts`,
     wired through `InputState`/engine/`TouchControls.tsx`; pixel-domain
     revision preserving the project's rad/px sensitivity; 19 checks in
     `scripts/touch-aim.test.ts`.
  2. **DONE** bot LOS/memory/cover/repath → `game/actors.ts` Bot rewritten
     with LOS-gated vision (`rayCover`+`rayTerrain`), last-seen memory +
     `search` state, reaction delay, low-HP obstacle cover with cooldown,
     and stall-triggered repath; no wallhack (unseen player position is
     never read); `scripts/bot-ai.test.ts` covers every transition.
  3. **DONE** sustained-slow-frame render-scale adaptation → new
     `game/adaptiveQuality.ts` (pure frame-time governor: 48 fps slow /
     58 fps fast thresholds, 3 s downgrade / 5 s recovery sustain, 6 s
     cooldown, 0.65 floor), enabled only on the low tier and wired into
     the engine frame loop; input/sensitivity never touched;
     `scripts/adaptive-quality.test.ts` covers downgrade, recovery, hold,
     floor, disabled passthrough.
  4. **DONE** event-sourced combat effects → `CombatEventQueue` in
     `game/combat.ts`: all five tracer/flash call sites (player, vehicle
     gun, bot fire, worker-deferred and sync paths) now emit tuple-only
     events; the engine drains them once per frame into the pooled
     presentation objects and clears the queue on endMatch/reset, matching
     the RayService no-shots-cross-matches invariant.
     `scripts/combat-events.test.ts` covers ordering, drain idempotence,
     clear, and JSON-safe payloads.
  5. **DONE — utility AI extension.** The sandline-style perception layer
     now feeds a real utility scorer instead of a hardcoded state machine:
     `game/botBrain.ts` (pure, no THREE) scores six actions every frame —
     engage, cover, reload, search, returnToZone, patrol — from context
     facts (LOS, HP fraction, memory age, zone depth, magazine fraction,
     cover availability). A `UtilitySelector` applies an 0.08 score margin
     and 0.3 s minimum hold to stop action flicker, and abandons any
     action whose score drops to zero immediately. Bots gained a real
     magazine/reload loop (reuses `CONFIG.weapon` sizes): empty under
     contact → cover reload, empty while safe → reload action. Reaction
     time gates the trigger, not the decision to face the threat.
     `scripts/bot-utility.test.ts` (33 checks) covers every scorer rule,
     hysteresis, reload execution and zone-return movement; the earlier
     `bot-ai.test.ts` regression suite passes unchanged against the new
     brain.
  Fixed-timestep accumulator is noted but deferred: our variable-step loop
  is covered by `scripts/integration.ts` and the worker ray contract, and
  converting it would touch every test.

### 8. Flight system — original work, no OSS source (2026-10-28)
`game/flightModel.ts` is a pure arcade aerodynamics module written for this
repo, not ported from a template. It uses the same design discipline the
sandline review recommended for simulation code: zero THREE/IO imports,
deterministic given identical inputs, fully headless-covered. The model
implements throttle-based thrust with quadratic drag and a terminal-speed
balance, a lift-vs-weight sink term that produces a genuine stall below
flying speed, banked coordinated turns (yaw pulled by sin(roll)), a hard
ceiling, runway ground-roll with speed-scaled steering, and gentle/hard
landing handling. The `Aircraft` wrapper maps `InputState` onto flight
controls and applies the YXZ airframe transform; the A-10 warthog follows
as a second airframe over this exact physics surface. Evidence:
`scripts/flight.test.ts` (29 checks) and `screenshots/06b-airborne-jet.png`.

## Also reviewed (search only, not cloned)
- npm `phototo3d@0.2.1` — MIT, CLI + MCP server (deps:
  `@modelcontextprotocol/sdk`, `zod`); cloud metered `reconstruct`
  (needs `SCULPT_API_KEY`, calls phototo3d.dev, unusable in this sandbox)
  plus fully local free `codegen` from a spec JSON. Generated factories
  emit raw `THREE.BoxGeometry` and `MeshPhysicalMaterial`, which fail the
  project anti-voxel/material gates unless revised; not installed.
- stemkoski three.js examples, NikLever/threejs-games-course — standard
  primitive composition patterns; nothing beyond what the MIT sources cover
- Quaternius ecosystem repos — confirm the target silhouette language:
  rounded blobs, tapered cylinders, 6–8 segment faceting, muted palettes

## Rules now enforced automatically
`scripts/art-style.test.ts` fails the build if any shipped gameplay module
reintroduces `THREE.BoxGeometry`, and asserts smooth terrain normals,
per-instance color variation, and curved-primitive humanoids. The MiG-29
reference module is exempt: it is a vendor showcase artifact, not spawned
in matches.
