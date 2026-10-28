# Third-party notices

This project re-uses techniques and re-authored code from open-source
projects. Original copyright notices and license text are preserved below.

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
