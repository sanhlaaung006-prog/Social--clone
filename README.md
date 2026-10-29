## IRONVEIL — Tactical Operations (game)

**Play online:** <https://ironveil-game.vercel.app>

A tactical FPS (React 18 + Zustand + Three.js, built with **Vite**) lives in
[`game/`](game/) — run `cd game && npm install && npm run dev`, then open
<http://localhost:8000>. The start world is a real-time 3D first-person
terrain (procedurally generated Karst-9 ridges, the relay-station objective,
hostile hover drones) — **WASD + drag-aim** on desktop and strictly
side-isolated touch controls (**left half = MOVE only, right half =
direct drag AIM only**, plus FIRE / JUMP buttons) on touch devices
(`SPACE` jumps on desktop). A realistic day/night cycle (one 15-minute macro day: 10-minute daylight,
5-minute night; sun, moon, stars, spiral galaxies — `T` skips +3h, `?phase=0.75`
starts at midnight) plays over a river-carved valley with a plank bridge,
and everything is sonified with WebAudio SFX: a recorded rifle shot
(synth fallback), UI clicks, grass/water footsteps, landing thuds,
river, birdsong, crickets, wind (`M` mutes).

Two map presets are selectable on the start screen (or via `?map=br` /
`?map=survival`): **Battle Royale — 2×2 km** (4 chunks) and **Survival —
4×4 km** (16 chunks). Terrain streams in 1 km chunks around a center spawn
at `(0, heightAt(0,0), 0)`; the relay and river are seeded per session
(`?seed=` reproduces a layout). The river is now a real crossing obstacle:
about **17.2 m of water surface** with its bed **1.65 m (5.4 ft) below the
water**, spanned by a longer plank bridge. Combat rendering keeps grass,
pebbles and rocks inside **35 m**; five Myanmar tree archetypes (teak,
padauk, rain tree, banyan and toddy/coconut palm) use one unified
whole-tree mesh per LOD band — full detail to 45 m, low-poly to 95 m and a
merged trunk+canopy imposter from 95–150 m — so trunks and canopies can
never cull separately or leave floating leaves. Climate-driven exponential
fog still allows clear ~300 m sightlines in Sunny weather. Procedural rim mountains
ring both maps: Survival hard-clamps at ±1950 m, while pressing the BR
±1000 m line triggers **RETURN TO THE COMBAT ZONE** at −5 vitals/sec.

Terrain LOD + streaming: the chunk you stand in builds at **64×64**
segments, ring 1 at 48, ring 2 at 28 and ring 3+ at 14. Terrain uses
simple Rust-baked vertex colors/AO with no splat attribute or custom
roughness shader. Chunk builds
run as time-sliced jobs (~3.5 ms of work per frame, prioritised by distance
and view direction, with predictive prefetch), so crossing into a new chunk
no longer hitches. Shooting raycasts run on a BVH
([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), MIT).
Movement is a PUBG-Mobile-style kinematic character controller without a
rigid-body physics engine. The same deterministic step runs in Rust on the
main thread (with a field-for-field JS twin as fallback): Quake-style
projection-capped acceleration and control-speed ground friction, capped
air control, projected slope gravity, steep-slope blocking/sliding with
contour slide, 0.55 m step-up and downhill snap, coyote-timed jumping, and
hard-landing momentum damping. Analog walk/jog now tops out at a natural
**5.2 m/s**; holding the stick (or W) near-straight forward for **1 second**
latches a stamina-limited **7.6 m/s sprint**, while `C`/`Ctrl` crouch scales
speed to 50% and lowers eye height from 1.70 m to 1.25 m. An
anti-underground safety sweep checks the player every frame and live
drones at 4 Hz against the Rust-backed ground authority; a confirmed bad
position is rescued to nearby dry, walkable ground and recorded in the
ABI v5 Rust safety-report ring. Stride-based camera bob, landing dip, the
damped-spring rifle viewmodel (sway + synced bob) and a physical magazine
drop/re-seat reload animation remain. Grounding comes from instanced blob
shadows under the player, trees and the relay, deterministic instanced
grass tufts and small pebbles inside 35 m, and a merged low-poly tactical
rifle viewmodel. The clean HUD is three thin bottom-left stripes
(red HP, blue stamina, green armour) plus two centered PUBG-style weapon
slots; an unused second slot stays visibly empty.

Weather & seasons are gameplay systems. Ten macro days form a season
(Dry → Cool → Monsoon); terrain/foliage palettes, exponential-fog density
and color, sunlight/ambient/exposure, and AI line-of-sight lerp over 30 s.
Every 10 real minutes a weighted roll chooses Sunny, Mist or Monsoon
(Dry 60/30/10, Cool 50/40/10, Monsoon-season 10/40/50 for Sunny/Mist/Rain).
Sunny uses density 0.0024 and 300 m drone LOS with a shader sun halo; Mist
uses 0.034 and 50 m LOS; Monsoon uses 0.0215, 80 m LOS, a screen-space
rain/visor shader, and mud physics (−30% acceleration, longer decel slide).
`?season=dry|cool|monsoon`, `?weather=sunny|mist|monsoon`, and `?day=N`
set the starting climate; the debug overlay (backtick / F3) shows season,
weather blend, fog density, AI LOS and engaged drones.

**Credits:** the recorded gunshot (`game/public/sfx/gunshot.wav`) is from
the Godot engine's TPS demo (© 2018 Juan Linietsky, Godot contributors),
distributed under CC-BY 3.0 — trimmed/mono-mixed here, with per-shot pitch
jitter and a synthesized sub-thump layered in `game/src/audio.js`.

It boots straight to a **Start / Title screen** and **▶ START is playable
instantly** — the systems check (uplink, field feed, armory, squad link,
weapons) is a ~0.4s cosmetic flourish that never blocks input. Short
landscape screens compact the title stack so START stays visible without
scrolling; deploying hands keyboard focus to the game canvas, and WASD is
listened for in the capture phase with an `e.key` fallback, so movement keys
work even after clicking START inside an embedded preview. INVENTORY,
SETTINGS and a mission BRIEFING (controls) are available before you deploy.
In-game, `ESC` (or the COMMAND button) opens the pause menu, which can also
**EXIT TO TITLE**. Back-navigation from the armory/settings returns to the
title screen before deployment and to the pause menu once in the field.

Terrain generation runs on a **Rust → WebAssembly ABI v5 core**
(`game/wasm/ironveil-core/`, dependency-free). A dedicated module Web
Worker (`game/src/wasm/terrain-worker.js`) owns a second Rust instance and
returns transferable typed arrays for **(1)** streamed full chunk meshes
(positions, normals, vertex colors, baked light, indices — no splat),
**(2)** deterministic local grass/pebble scatter batches, and **(3)** drone
LOS/threat/tactical waypoints plus coarse A* paths. The main thread keeps
the Rust per-frame kinematic physics step (zero worker round-trip latency),
the ABI v5 fixed-size safety-report sink, the 3-weather × 128-bin sky/cloud
LUT and rendering. Terrain colors include
Rust-baked AO (eight-direction horizon slope + concavity, faded to 1.0 at
chunk borders to avoid seams). Streamed work uses the Worker; teleport
destination cuts still finish synchronously on the main thread so arrival
never shows a terrain hole, and if Worker or WASM fails the game
falls back fully to the main-thread Rust/JS paths. The 113,787-byte compiled
asset is committed at `game/public/wasm/ironveil_core.wasm` and loaded
locally — **fully offline at runtime, no CDN**. The production build uses a
relative Vite base, and the loader validates the WASM magic across root,
subpath and Worker-relative candidates, so the same build runs from the
Vercel domain above or a repository subpath. The debug overlay shows
`PHYSICS: RUST KINEMATIC`, `WORKER: RUST`, and live main-thread CPU ms when
active. Rebuild it with the *Build Rust WASM terrain core* GitHub Action
(or `cargo build --release --target wasm32-unknown-unknown` locally).

The frame loop was also put through a zero-allocation pass: preallocated
physics and profiler buffers, scratch river/chunk/palette objects, direct
final-height grids, lazy JS fallback geometry (Rust chunks no longer build
and discard a PlaneGeometry), and reused shooting targets. Frequent HUD
values no longer flow through React renders — compass heading, objective
distance/bearing, crosshair range/fire state, weapon-slot ammo and the
stamina stripe are updated through refs/direct DOM writes. Mobile fill
rate is protected by the live render-quality setting — **MED is the default**
(coarse pointers start at 1.1× DPR, cap at 1.25×, shed resolution above a
15.5 ms average frame and only buy it back under 11 ms, targeting smooth
~70 fps play; LOW pins 1.0×). MSAA and the full-screen CSS noise blend are
disabled on coarse pointers, keeping a cheap flow-sine water shader with
horizon tint and sun glint, and the existing fragment-space sun disc/glow.

**1-minute traversal CPU profile** (final ABI v5 build, headless
Chromium/SwiftShader, seed 20261029, Survival, 374 profiled frames;
sandbox FPS is not phone-representative, so these are main-thread CPU
ms/frame from `?profile=1`):

| CPU metric | avg | p50 | p95 | p99 | p99.9 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Update | 1.074 ms | 0.3 ms | 2.6 ms | **16.8 ms** | 41.6 ms |
| Render submission | 10.750 ms | 0.6 ms | 1.1 ms | **11.4 ms** | 1396.1 ms |
| Total | 11.824 ms | 0.9 ms | 4.7 ms | **43.2 ms** | 1397.3 ms |

The route crossed ten streamed neighbourhoods and finished with Rust
terrain/physics/Worker active, 16/16 chunks, 62 Worker chunks, 136 Worker
scatter batches and 68 Worker AI batches. Maximum observed load was
**42,373 triangles / 49 draw calls** (final frame 23,716 / 33), safely under
the 60k triangle budget. Tree bands peaked at 11 full / 38 low-poly / 53
imposters; because each band is one merged trunk+canopy geometry, no tree
can degrade into floating leaves. The single p99.9 render outlier is a
SwiftShader/teleport upload frame in the software-rendered sandbox; the
reported production metric for this pass is total CPU **p99 = 43.2 ms**.

**Developing:** edit [`game/src/ironveil.jsx`](game/src/ironveil.jsx) (UI) and
[`game/src/world.js`](game/src/world.js) (3D world) — Vite serves with HMR on
port 8000. `npm run build` produces `game/dist/`.

### Screenshots

Captured from the running game in headless Chromium. The terrain is rendered
live by WebGL (no backdrop photo anymore); only Google Fonts was stubbed
locally during capture because the sandbox can't reach it. Desktop shots:
the Survival center spawn, Monsoon weather at 190 m east (AI LOS 80 m,
0/6 drones engaged), the BR rim wall at +850 m, its out-of-bounds warning
at the +1000 m line, and midnight under the stars and galaxies.

**Start menu (desktop):**

![IRONVEIL start menu](screenshots/ironveil-start-menu.png)

**Survival (4×4 km) — center spawn at (0, 0):**

![IRONVEIL Survival spawn](screenshots/ironveil-survival-spawn.png)

**Rust ABI v2 — baked terrain AO and refined rifle viewmodel:**

![IRONVEIL Rust lighting and rifle](screenshots/rust-v2-rifle.png)

**Rust ABI v3 — mesh/scatter/AI batches and sky LUT active (`RUST V3` debug row):**

![IRONVEIL Rust v3 systems](screenshots/rust-v3-systems.png)

**Rust ABI v4 + Worker — Rust kinematic physics and worker terrain/AI active (`PHYSICS` / `WORKER` debug rows):**

![IRONVEIL Rust v4 worker physics](screenshots/rust-v4-worker-physics.png)

**Mobile performance / Myanmar tree LOD / clean HUD — whole-tree LODs, three vitals stripes and two centered weapon slots:**

![IRONVEIL Myanmar trees and clean HUD](screenshots/mobile-tree-lod-hud.png)

**Monsoon weather — screen-space rain, 80 m AI LOS, no drones engaged:**

![IRONVEIL Monsoon weather](screenshots/ironveil-monsoon.png)

**Battle Royale — rim mountains rising from +850 m:**

![IRONVEIL BR rim mountains](screenshots/ironveil-br-rim.png)

**Battle Royale — out-of-bounds warning at the +1000 m line:**

![IRONVEIL BR out of bounds](screenshots/ironveil-br-oob.png)

**Midnight — stars, a spiral galaxy and moonlit ridges:**

![IRONVEIL at night](screenshots/ironveil-night.png)

**Start menu (mobile):**

![IRONVEIL start menu on mobile](screenshots/ironveil-start-menu-mobile.png)

**Pause menu (mobile):**

![IRONVEIL pause menu on mobile](screenshots/ironveil-pause-mobile.png)
