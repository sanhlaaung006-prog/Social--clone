# Warthog Airframe Factory — extraction report

**Source:** 21 files uploaded 2026-10-28, staged verbatim in `source/`.
**Nature:** a single-page *inspection* app — one procedurally generated A-10C, a
part list, a spec inspector and an export panel. Not a game: no loop, no input
beyond orbit/pick, no physics, no networking, no persistence.

It is useful here for exactly one reason: it is a **better-built version of the
problem this repo already has twice over** — a parametric Three.js vehicle plus
a UI that lets you take it apart. Everything below is judged against that.

Verdict up front: **two files are directly portable (extracted, typechecked,
smoke-tested). Maybe six ideas are worth re-implementing. The rest of the app —
components, styling system, dependency versions — should not come along.**

---

## 1. Inventory

| File | LOC | What it is | Verdict |
|---|---:|---|---|
| `factory/warthog.ts` | 1668 | Procedural A-10C: spec registry, loft/mirror primitives, livery, loadout, explode, isolate | **Harvest** (helpers + patterns) |
| `factory/scene.ts` | 585 | Renderer, OrbitControls, camera tweening, raycast picking, floating tag, dispose | **Harvest** (rig) |
| `factory/extract.ts` | 149 | Manifest JSON / CSV / source export + clipboard | **Idea only** |
| `hooks/useWarthogScene.ts` | 75 | Mount/dispose the scene in a ref, surface stats | **Idea only** |
| `App.tsx` | 441 | Page composition, ~15 pieces of UI state, toast | No |
| `components/Viewport.tsx` | 304 | Canvas shell, corner marks, tool buttons, view presets, fullscreen | No (design cues) |
| `components/Inspector.tsx` | 338 | Tabbed spec panel, live isolate/focus buttons | No |
| `components/Outputs.tsx` | 340 | Export cards, live stats | No |
| `components/AirframePlan.tsx` | 208 | Hand-drawn **SVG** top-view plan, click-a-region-to-select | **Idea only** |
| `components/PartRail.tsx` | 143 | Scrollable part list with hover sync | No |
| `components/Icons.tsx` | 210 | 22 inline SVG icons, no icon library | Optional |
| `index.css` | 316 | Tailwind 4 theme tokens + hand-written component CSS | Tokens only |
| `package.json` / `vite.config.ts` / `tsconfig.json` | — | React 19, three 0.186, Vite 7, Tailwind 4, single-file build | See §5 |

**Does not build as uploaded:** `App.tsx` imports `@/components/Header`, which was
not supplied. Nothing was tested end-to-end against a browser; there are no tests
in the project at all.

---

## 2. Tier A — extracted, portable, verified

Both live in `extracted/`, typecheck clean under `tsconfig.extracted.json`
(strict + `noUnusedLocals`), and `geometryKit` was smoke-tested in Node against
**three 0.170.0 — this repo's pinned version**, not the source's 0.186.

### `extracted/geometryKit.ts`

| Export | Why it earns its place |
|---|---|
| `loft(sections, segments)` | Superellipse sweep: one function gives a fuselage, a tank hull, a nose cone or a barrel shroud. Nothing in `game/vehicles/*` does this generically today. |
| `mirrorGeometryX(geometry)` | Mirrors across X **and repairs winding** — the part everyone gets wrong (`scale(-1,1,1)` inverts every face). Handles indexed and non-indexed layouts. |
| `addStrut(group, mat, from, to, radius)` | Cylinder between two arbitrary points — roll cages, suspension arms, aerials, technical-truck frames. |
| `addWheel(group, tyre, hub, pos, r, w)` | Torus tyre + drum, correctly axis-aligned. |
| `addBox(...)` | Trivial, kept for symmetry with the others. |
| `triangleCount(geometry)` | Indexed-or-not triangle count for budget checks. |
| `disposeObject3D(root)` | Recursive geometry/material/texture dispose. The reference project hand-rolls this per-object; the game needs it for vehicle respawn. |

Verified output of the smoke run (4 sections × 24 segments):

```
loft tris: 144  bbox: [-1.15,-0.75,-2.6] → [1.15,0.75,3]     (3×24×2 = 144 ✓)
mirror X range: -1.15 → 1.15  tris: 144
first tri normal · centroid: +0.515                          (outward-facing ✓)
strut+box+wheel children: 4  tris: 796
dispose: OK
```

### `extracted/inspectionRig.ts`

The camera/picking half of `scene.ts`, decoupled from the A-10 and from React —
it drives any `Object3D` subtree with `userData.partId` markers:

- `flyTo` / `setView(preset)` / `focusOn(object)` — eased cubic tweens; framing
  maths clamps distance to the subject's bounding sphere, so no part is ever
  cropped
- user input (`controls` `start` event) **cancels** an in-flight tween instead of
  fighting it — the detail that makes orbit-then-click feel right
- tap-vs-drag disambiguation (5 px / 450 ms) so dragging the camera never selects
  a part, and `pointermove` hover picking is rAF-throttled
- `applyResponsiveFov` + `responsiveScale` — portrait phones get 43° FOV and a
  1.52× pull-back; desktop gets 32°. This is the single most phone-relevant piece
  in the whole upload and the repo has no equivalent for its viewer pages
- `update(now)` is caller-driven — the rig never owns the loop, so it drops into
  the game's existing engine frame cleanly

---

## 3. Tier B — patterns worth re-implementing (do not copy-paste)

These are architectural ideas, and they map onto things the game actually needs.

1. **Part registry as data, geometry as code.** One `PART_SPECS` array of
   `{id, code, name, category, material, massKg, dimensions, summary, note}`
   drives the model, the part rail, the inspector and the SVG plan from a single
   source. Every generated mesh carries `userData.partId`, so picking is a
   `parent` walk. → *directly reusable for vehicle modules and, later, for
   damage-per-part on the tank/technical.*
2. **Explode/assembly animation.** Each part stores a base position and an
   `explode` offset; `setExplode(0..1)` lerps groups apart. Cheap, no skeleton.
   → *vehicle destruction / "wreck" states, or a hangar assembly animation.*
3. **Blueprint (X-ray) mode.** Snapshots each material's `opacity`, `transparent`
   and `depthWrite` into `userData`, then drops opacity to 0.085 with
   `depthWrite:false` and reveals edge lines. Restores exactly on toggle.
   → *the good version of a "tech view"; also a debugging aid for interiors.*
4. **Livery by material-set swap.** Materials are grouped per slot (`body`,
   `panel`, `accent`, `dark`) in `Set`s and mutated in place — no re-instantiation,
   no material explosion. → *faction skins for vehicles without rebuilding them.*
5. **Isolate + emissive highlight.** `setSolo(id)` toggles `group.visible`;
   `setHighlight(id, strength)` sets `emissive`/`emissiveIntensity` on only that
   part's materials. → *selection feedback in any inspect UI.*
6. **Dispose discipline.** `scene.dispose()` removes listeners, cancels rAF,
   disconnects the ResizeObserver, disposes PMREM/RoomEnvironment, the canvas and
   the floating DOM tag. Sloppy disposal is the classic Three.js leak; copy the
   checklist even if not the code.
7. **SVG technical plan with click-to-select** (`AirframePlan.tsx`). Hand-authored
   paths with per-region `onClick` + keyboard handlers + `aria-label`. → *a
   battle-royale map screen or a tactical briefing; cheaper and sharper than
   canvas for static vector art. Note the repo already has a canvas `Minimap`;
   this is a different, complementary tool.*
8. **Export-as-artifact** (`extract.ts`). Manifest JSON, CSV and the raw factory
   source, downloadable or copied. → *shareable loadout cards / bug-report
   bundles.*

---

## 4. Tier C — deliberately not taken

| Thing | Why not |
|---|---|
| **All `components/*.tsx` and `App.tsx`** | Every class string is Tailwind, every prop is A-10-shaped, and the layout is a desktop datasheet (2-col, `h-[592px]`). Porting means porting the styling system too. Design cues only. |
| **Tailwind 4 + `@tailwindcss/vite`** | This repo has no Tailwind. Adding a second styling system for a ground-up rewrite is a new dependency to maintain in the Capacitor WebView, in exchange for code we are rewriting anyway. |
| **`vite-plugin-singlefile`** | Inlines everything into one HTML file. Fights this repo's multipage build (`index`/`tank`/`jet`), kills chunk caching (the 132 KB gzip three chunk currently caches across visits), and bloats the APK's first load. |
| **React 19 / three 0.186 / Vite 7** | This repo is React 18.3 / three 0.170 / Vite 5 with Capacitor 6 and a WASM toolchain validated on that set. Version-bumping mid-rewrite turns one project into two. `geometryKit` is the only code worth taking and it is version-independent. |
| **The A-10 model itself** | Out of scope for this game's fiction, and unnecessary — Tier A gives the technique without the airframe. |
| **`preserveDrawingBuffer: true`** | Buys `toDataURL()` at the cost of a permanent extra framebuffer copy. On a mid-range Android phone that is real bandwidth. Render-then-read on demand instead. |
| **Per-part materials, no instancing/LOD** | Fine for one hero model on a desktop; wrong for a battle royale with several vehicles on a phone. Take the *pattern*, budget the draw calls. |

---

## 5. Design language (worth keeping as tokens, not classes)

The reference app is a light "engineering datasheet" — cream paper, olive ink,
lime accent. The game HUD is dark and should stay dark, so this palette is a fit
for the **hangar / inspection / pause-menu** screens only.

```
paper #eeece4   panel #f8f6f0   panel-deep #e9e6dc
ink   #1b1e18   ink-soft #2b3027  muted #727568   faint #96988c
line  #d7d3c6   line-dark #bdb9ab
lime  #d5ec6e   lime-soft #eaf3bd  olive #343a2c   viewport #171b14
mono-label: 10px / 0.13em / uppercase        display: letter-spacing -0.045em, line-height 0.96
motion: fade-rise 550ms, toast-in 260ms, pulse-dot 2.4s — all cubic-bezier(0.22,1,0.36,1)
accessibility: full prefers-reduced-motion override; focus-visible rings on a/input
```

The `corner-mark` framing brackets and the floating part tag are the two visual
ideas most worth borrowing: they read as "instrument", not as "web app".

---

## 6. Files

```
reference/warthog-factory/
  EXTRACTION.md              this report
  source/                    uploads, verbatim, path layout preserved
    App.tsx  index.css  index.html  main.tsx  cn.ts  package.json  package-lock.json
    tsconfig.json  vite.config.ts  vite-env.d.ts
    components/{AirframePlan,Icons,Inspector,Outputs,PartRail,Viewport}.tsx
    factory/{extract,scene,warthog}.ts
    hooks/useWarthogScene.ts
  extracted/
    geometryKit.ts           Tier A — verified against three 0.170.0
    inspectionRig.ts         Tier A — verified against three 0.170.0
  tsconfig.extracted.json    strict typecheck config for extracted/
```

`reference/` is already excluded from this repo's `tsconfig.json` and untouched
by `vite build`, so staging here cannot affect the game build.

Re-verify at any time:

```bash
npx tsc -p reference/warthog-factory/tsconfig.extracted.json
```

---

## 7. What this says about the reconstruction

Taking this upload seriously changes one thing about a ground-up rebuild: the
project does **not** need a new dependency stack to get better vehicle visuals —
it needs the *parameterised* approach (`loft` + part registry + material sets)
applied to the models it already has, and a proper inspection rig for the viewer
pages. That is a refactor of existing files, not a new app.
