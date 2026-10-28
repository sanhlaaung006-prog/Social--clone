# Golden Land Royale — v0.4 rebuild

Mobile-first 3D battle royale for Android APK (browser fallback).
React 18 + Vite 5 + three.js r170 + WebGL, in-house physics (C/WASM),
Capacitor packaging.

## Why a rebuild?

The v1 build (archived in [`legacy/app-v1/`](legacy/app-v1), recovery
tag `pre-rebuild-0280104`) had working systems but weak visual/game
feel. v0.4 rebuilds the foundation on techniques ported from the
MIT-licensed [SANDLINE](https://github.com/xilinnihao-afk/sandline-threejs-fps)
mobile FPS — see [NOTICE.md](NOTICE.md). No Rapier (in-house physics
stays), no Next.js, three.js stays r170.

## Locked terrain foundation (do not modify)

The approved **"Myanmar, in Relief"** terrain is the frozen base map:

- `src/terrain/locked/noise.ts` — deterministic noise toolkit, river
  paths and the single continuous `myanmarHeight(u, v)` height field
  (Himalayan north, Arakan Yoma, Shan plateau, Bago ridge, Irrawaddy
  delta, sea-level 0).
- `src/terrain/locked/ReliefTerrain.ts` — WebGL engine: displaced
  flat-shaded ground with elevation/slope vertex colors, animated
  water shader, light/fog rig, orbit framing, and the public
  `placeStructure()` / `scatter()` / `sampleHeight()` / `sampleNormal()`
  APIs that future content must use.
- `src/terrain/locked/structures.ts` — locked pagoda and volcanic-plug
  builders (reserved for the structures brick).

These files are frozen by SHA-256 checksums
(`tests/lib/terrain-lock.json`, enforced by `tests/terrain-lock.test.ts`)
and documented in `src/terrain/locked/LOCKED.md`. New structures,
objects and gameplay go **on top**, never by editing locked code.

`src/terrain/TerrainStage.tsx` is the (non-locked) React bridge that
boots the engine at its approved dimensions (130 × 210 m, ×3.4 relief,
168 × 272 segments) with the natural 1100-tree / 420-rock scatter.

## Rebuild roadmap (each brick is a green, scoped commit)

1. ✅ Sandline-derived render core: procedural texture forge, material
   family, batched world toolkit (`src/render/`).
2. ✅ Locked Myanmar relief terrain port, checksum-frozen, live in-app.
3. ✅ 5 × 5 km merged-noise map: locked value-noise macro field plus
   Gustavson simplex ridged/warped/fine layers (`src/terrain/`), real
   geo outline utility staged for the accurate-outline brick.
4. ✅ Immersive first-person controller (`src/player/`): pure
   deterministic kernel (sprint/crouch/jump/wade/slope block, head bob,
   sway, lean, landing dip, sprint FOV), unified keyboard/pointer-lock +
   dynamic touch joystick/drag-look input, orbit ↔ walk mode switch.
5. ✅ Mandalay-inspired royal city (`src/city/`, checksum-frozen): pure
   deterministic layout kernel, twin semidetached shophouses, battered
   citadel with 12 zodiac gates + pyatthat pavilions, moat and teak
   bridges, gilded stupa court with shrine rings, monastery, market and
   clock tower. Terraced pads adapt to the real terrain; AABB collision
   and curb step-up are wired into the first-person controller. Zero
   BoxGeometry (anti-voxel art gate); ~75k tris in 14 merged meshes.
   Real-browser proof shots run via Playwright in CI.
6. ⏳ Chunked LOD for the 5 km ground (the Living Terrain Atlas skirt
   technique) to cap mobile triangle counts.
6. ⏳ Weapon viewmodel, ADS, recoil, ballistics and combat FX.
7. ⏳ Structures and objects on top of the locked map (`placeStructure`).
8. ⏳ Re-integrate v1 originals: C/WASM physics, utility-AI bots, BR
   zone, adaptive quality, Capacitor APK, vehicles, flight, A-10.

## Commands

```sh
npm install
npm test         # render-core + terrain-lock headless suites
npm run build    # tsc --noEmit && vite build
npm run dev      # http://localhost:5173 (binds 0.0.0.0)
npm run screenshot  # CPU-rasterized terrain proof (no GPU needed)
```

## Layout

```
src/
  engine/      GameEngine (RAF loop), React canvas bridge
  render/      procedural texture forge, materials, batched world toolkit
  terrain/
    locked/    FROZEN relief engine (checksum-enforced, see LOCKED.md)
    TerrainStage.tsx
  ui/          React HUD overlay
tests/         headless tsx suites, CPU rasterizer, lock checksums
legacy/        archived v1 app (do not import from live code)
```
