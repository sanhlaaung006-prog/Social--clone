# Golden Land Royale — v0.4 rebuild

Mobile-first 3D battle royale for Android APK (browser fallback).
React 18 + Vite 5 + three.js r170 + WebGL, in-house physics (C/WASM),
Capacitor packaging.

## Why a rebuild?

The v1 build (archived in [`legacy/app-v1/`](legacy/app-v1), recovery
tag `pre-rebuild-0280104`) had working systems but weak visual/game
feel. v0.4 rebuilds the foundation on techniques ported from the
MIT-licensed [SANDLINE](https://github.com/xilinnihao-afk/sandline-threejs-fps)
mobile FPS, re-authored into our stack — see [NOTICE.md](NOTICE.md).
No Rapier (in-house physics stays), no Next.js, three.js stays r170.

## Current milestone — visual baseline

- Procedural texture forge (`src/render/textureForge.ts`): seven
  canvas-generated surface atlases, zero downloaded assets, deterministic.
- PBR material family with per-vertex tinting (`src/render/materials.ts`).
- Batched courtyard world (`src/render/world.ts`): one draw mesh per
  material family, world-scale UV tiling, height/contact shading,
  anti-voxel rule (no BoxGeometry).
- Renderer recipe (`src/render/environment.ts`): ACES tone mapping,
  sRGB output, PCF soft shadows, hemisphere/sun/fill rig, RoomEnvironment
  IBL, distance fog.
- React shell with an RAF engine and cinematic orbit camera.

## Rebuild roadmap (each brick is a green, scoped commit)

1. ✅ Archive v1; render-core shell, procedural materials, batched world.
2. ⏳ First-person controller + input/touch layer (sandline camera-feel
   math re-authored onto our collision/ground probe, no Rapier).
3. ⏳ Weapon viewmodel, ADS, recoil, ballistics and combat FX.
4. ⏳ Re-integrate v1 originals: Myanmar terrain + C/WASM physics,
   utility-AI bots, BR zone, adaptive quality, Capacitor APK.
5. ⏳ Re-integrate vehicles, flight model and the A-10 Warthog.

## Commands

```sh
npm install
npm test        # headless render-core checks (forge, materials, world)
npm run build   # tsc --noEmit && vite build
npm run dev     # http://localhost:5173 (binds 0.0.0.0)
```

## Layout

```
src/
  engine/      GameEngine (RAF loop), React canvas bridge
  render/      renderer, environment rig, texture forge, materials, world
  ui/          React HUD overlay
  main.tsx     React entry
tests/         headless tsx suites + DOM stub
legacy/        archived v1 app (do not import from live code)
```
