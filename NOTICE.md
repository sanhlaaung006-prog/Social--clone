# Third-party notices

This project re-uses techniques and re-authored code from open-source
projects. Original copyright notices and license text are preserved below.

## "Mandalay textured reconstruction" (user-supplied)

The royal city in `src/city/` re-authors techniques from a third
user-supplied standalone (received 2026-10-28, no license declared,
treated as project-owned work): the 144-block shophouse grid with paired
semidetached ("twin") houses, battered citadel walls with twelve zodiac
gates and pyatthat pavilions, square moat ring with teak bridges,
Shwezigon-type lathed stupa and hti foundry, concentric kyauksa-gu
shrine rings, teak monastery on posts, tiered market hall and clock
tower. Geometry, dimensions (rescaled ~0.3x), layout math and palette
were re-implemented, not copied verbatim; no external assets or
textures are used. This donor also supplied the Warthog airframe plan
files, which are not part of this brick.

## "Myanmar — Living Terrain Atlas" (user-supplied)

The geo-coordinate outline polygon, ocean/coast masking, river
incision and chunk-LOD/skirt techniques in `src/terrain/myanmarMap.ts`
(staged outline utility) and the roadmap's LOD brick are re-authored
from a second user-supplied standalone (`index.html`, received
2026-10-28, no license declared, treated as project-owned work). No
code was copied verbatim; only techniques and geo data were reused.

## "Myanmar, in Relief" terrain engine (user-supplied)

The frozen modules under `src/terrain/locked/` (`noise.ts`,
`ReliefTerrain.ts`, `structures.ts`) are TypeScript ports of the
standalone web piece **"Myanmar, in Relief — One Continuous Terrain"**
(`index.html`, provided by the project owner on 2026-10-28). No license
was declared in the file; it is treated as a project-owned work product.
The code is frozen by checksum (`tests/lib/terrain-lock.json`, enforced
by `tests/terrain-lock.test.ts`); see `src/terrain/locked/LOCKED.md`.

## SANDLINE (sandline-threejs-fps)

Source: https://github.com/xilinnihao-afk/sandline-threejs-fps
License: MIT — Copyright (c) 2026 SANDLINE contributors

Ported/re-authored modules in this repository:

- `src/render/textureForge.ts` — deterministic LCG and procedural canvas
  texture atlases (brick, corrugated metal, woven cloth, grime/rain
  decals, signage), derived from `src/render/materials.ts`.
- `src/render/world.ts` — per-material geometry bucketing, world-space
  UV tiling, vertex height/contact shading and merged-mesh batching,
  derived from `src/render/world.ts`.
- `src/render/environment.ts` — ACES tone mapping, sRGB output, PCF soft
  shadow and fog presentation recipe, derived from `src/main.ts`.

Code was adapted to three.js r170, our React 18 + Vite 5 shell, and the
in-house physics stack (the upstream Rapier dependency was not imported).

### MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
