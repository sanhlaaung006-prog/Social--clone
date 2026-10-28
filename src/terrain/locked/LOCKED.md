# FROZEN terrain engine — do not modify

Everything in this directory (`noise.ts`, `ReliefTerrain.ts`,
`structures.ts`) is a faithful TypeScript port of the user-supplied
standalone web piece **"Myanmar, in Relief — One Continuous Terrain"**
(`index.html`, received 2026-10-28; no license declared in the file,
used as a user-owned work product).

## Freeze policy

- The terrain visuals are approved and locked. No edits to logic,
  constants, colors, noise, shaders, segments or light rigs.
- The only port adaptations allowed were: ES module imports/exports,
  TypeScript type annotations, and `three`/`OrbitControls` resolved from
  npm instead of a CDN import map.
- New game content (structures, props, vehicles, gameplay) goes on top
  through the public API — `placeStructure()`, `scatter()`,
  `sampleHeight()`, `sampleNormal()` — or in separate modules, never by
  editing these files.
- `tests/terrain-lock.test.ts` stores SHA-256 checksums of the locked
  files and fails if any byte changes. Re-baselining a checksum is an
  explicit, reviewed decision, not a routine edit.

## Module map

| file | role |
| --- | --- |
| `noise.ts` | deterministic noise toolkit, river paths, `myanmarHeight(u,v)` unit height field (sea level 0) |
| `ReliefTerrain.ts` | WebGL engine: displaced ground mesh with elevation/slope vertex colors, animated water shader, light/fog rig, OrbitControls framing, `placeStructure`/`scatter`/marker/pick APIs, RAF loop |
| `structures.ts` | locked pagoda and volcanic-plug builders (reserved for the structures brick) |
