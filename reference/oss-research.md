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

## Also reviewed (search only, not cloned)
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
