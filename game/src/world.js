// === [WORLD: THREE_TERRAIN] ===
// Real-time first-person world for IRONVEIL: procedurally generated
// Karst-9 terrain (seeded value-noise fbm), relay station objective,
// hostile hover drones, hitscan shooting with tracers/impact bursts and a
// camera-attached weapon viewmodel.
//
// The render loop never touches React. Per-frame input flows through the
// mutable `inputState` object (written by the joystick / drag handlers in
// ironveil.jsx); HUD-bound values (compass heading, objective range) are
// pushed out through hooks only when their rounded value changes.

import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { rustCore, rustRawHeight, rustChunkTerrain, rustBuildChunkMesh, rustLocalScatter, rustAiBatch, rustFindPath, rustSkySample, setRustGroundProvider, rustPhysicsStep, rustSafetyReport } from "./wasm/ironveil-core.js";
import { stepPhysicsBuffer } from "./physics.js";
import { createWarthogAssembly, WARTHOG_SPECS } from "./aircraft/warthog.ts";

// BVH-accelerated raycasts (three-mesh-bvh, MIT —github.com/gkjohnson/three-mesh-bvh):
// shooting rays against 18k-triangle terrain chunks become a tree walk
// instead of a full triangle sweep. Meshes without a bounds tree keep the
// stock three.js raycast path.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// No rigid-body physics engine is loaded. Character motion below is a
// deterministic kinematic velocity solver against terrainHeight().

export const inputState = {
  moveX: 0, // strafe  -1..1 (move stick)
  moveY: 0, // forward -1..1 (move stick)
  aimX: 0,  // aim-stick rate -1..1
  aimY: 0,
  lookDX: 0, // accumulated mouse-drag deltas (consumed each frame)
  lookDY: 0,
  sensitivity: 0.55, // lower default look multiplier (settings slider writes this)
  adsSensitivity: 0.26, // scoped look multiplier (Settings > Controls writes this)
  quality: "MED", // render-quality preset label (resolution itself is always native DPR)
  fov: 71, // base vertical FOV in degrees (Settings > Display writes this)
  ads: false, // touch ADS toggle (thumb button)
  adsHeld: false, // desktop right-mouse hold
  firing: false, // trigger currently held (touch FIRE / mouse) — drives the forward fire pose
  weaponId: "kx9", // active gun (HUD weapon slots write this on swap)
  activeWeaponSlot: "primary",
  weaponSwap: null, // queued {slot,itemId,duration} draw animation from the HUD slots
  weaponAdsFactor: 0.58, // scope zoom factor for the active gun
  weaponSpread: 1, // spread multiplier for the active gun
  jetAction: null, // queued "enter" / "exit" from the Warthog DRIVE / EXIT buttons
  jetThrottleDelta: 0, // -1..1 held throttle input from the flight buttons
  jetBrake: false, // held wheel-brake input while seated in the Warthog
  flightPitchInput: 0, // dedicated touch sway-stick elevator (-1..1, + climbs)
  flightRollInput: 0, // dedicated touch sway-stick aileron (-1..1, + banks right)
  flightThrottleTarget: null, // absolute 0..1 target from the touch throttle slider
  staminaBoost: null, // queued {amount,duration,regen,powerFloor} from soda/drugs/medicine
  keys: new Set(),
  timeSkip: false, // set by the T key: jump the day/night cycle +3h
  jump: false, // pulsed by the touch JUMP button; the world consumes it
  touchCrouch: false, // latched by the touch CRCH toggle button
};

// Live perf counters, filled by the render loop, read by the React debug overlay.
export const debugStats = {
  fps: 0, frameMs: 0, calls: 0, tris: 0, points: 0, lines: 0,
  geometries: 0, textures: 0, programs: 0,
  width: 0, height: 0, cycle: 0, px: 0, pz: 0, _last: 0,
  cullNear: 0, cullMid: 0, cullFar: 0, dronesVisible: 0,
  shadowMapsFrozen: 1, shadowMapUpdates: 0,
  simSeconds: 0, travelM: 0,
  mapMode: "survival", mapSizeM: 4000, worldSeed: 0,
  chunksLoaded: 0, chunksVisible: 0, chunksTotal: 16,
  outOfBounds: 0, boundaryDamage: 0, relayX: 0, relayZ: 0,
  grounded: 0, vy: 0, speed: 0, accelRate: 0, swayYaw: 0, swayPitch: 0,
  stamina: 100, sprinting: 0, sprintHold: 0, sprintEffect: 0, staminaBoostT: 0, reloadT: 0,
  fov: 71, heading: 0, wadeDepth: 0, splashBursts: 0,
  groundedObjects: 0, groundingCorrections: 0,
  safetyRescues: 0, safetyReports: 0, safetyRustReports: 0, safetyLastCode: 0,
  treeLodFull: 0, treeLodMid: 0, treeLodFar: 0, dpr: 1,
  grass: 0, pebbles: 0, blobShadows: 0, fogDensity: 0,
  terrainCore: "JS", rustChunks: 0, rustMeshes: 0, rustScatter: 0, rustScatterBatches: 0, rustAiBatches: 0, rustPaths: 0, rustSky: 0,
  physicsCore: "JS", workerCore: "OFF", workerChunks: 0, workerPending: 0,
  workerScatterBatches: 0, workerAiBatches: 0, workerPaths: 0,
  cpuUpdateMs: 0, cpuRenderMs: 0, cpuFrameMs: 0, profileFrames: 0,
  season: "COOL", weather: "SUNNY", macroDay: 0, seasonDay: 1,
  seasonBlend: 1, weatherBlend: 1, weatherRollS: 600, weatherRolls: 0,
  aiLosM: 300, dronesEngaged: 0, rain: 0, mud: 0, seasonTint: "ffffff",
  chunkJobs: 0, chunkBuildMs: 0, lod96: 0, lod48: 0, lod24: 0, bvhPending: 0,
};

// External debug/test control. The render loop consumes a pending teleport
// once; used by automated boundary/spawn verification.
export const worldControl = { teleport: null, weather: null, season: null, rollWeather: false, safetyReports: [] };

// The opening orbit cinematic is a once-per-app-open flourish. It must not
// come back when Settings/pause closes and the player resumes.
let introCinematicPlayed = false;

// Opt-in CPU frame profiler (?profile=1). Samples land in preallocated
// ring-free typed arrays: enabling it adds three performance.now() calls
// per frame and no allocation in the render loop. The traversal harness
// reads update/render/total main-thread milliseconds from here.
const PROFILE_CAPACITY = 72000;
export const frameProfile = {
  enabled: typeof window !== "undefined" && typeof window.location !== "undefined"
    && /[?&]profile=1(?:&|$)/.test(window.location.search || ""),
  capacity: PROFILE_CAPACITY,
  count: 0,
  update: new Float32Array(PROFILE_CAPACITY),
  render: new Float32Array(PROFILE_CAPACITY),
  total: new Float32Array(PROFILE_CAPACITY),
};
if (frameProfile.enabled && typeof window !== "undefined") {
  window.__ironveilProfile = { debugStats, frameProfile, inputState, worldControl };
}

// ---------- deterministic rng / noise ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let NOISE_SEED = 0x2e7a04c9;
// Integer avalanche hash. The Rust (compiled to local, offline
// WebAssembly) port in game/wasm/ironveil-core mirrors this bit-exactly;
// this JS version remains as the zero-wait fallback.
// Unlike the old sin hash it stays precise for negative and large lattice
// coordinates, which the +/-2000m presets require.
function hash2(x, z) {
  let h = Math.imul(Math.floor(x) | 0, 0x27d4eb2d);
  h ^= Math.imul(Math.floor(z) | 0, 0x165667b1);
  h ^= NOISE_SEED | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  // Quintic interpolation: C2-continuous value noise. The old cubic
  // curve left visible lattice-aligned creases on broad slopes.
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, octaves) {
  let amp = 0.5, sum = 0, norm = 0;
  let px = x, pz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(px, pz);
    norm += amp; amp *= 0.5;
    // Rotate each octave so successive noise lattices do not reinforce
    // square, axis-aligned terrain facets.
    const nx = (px * 0.8 - pz * 0.6) * 2.03 + 11.31;
    const nz = (px * 0.6 + pz * 0.8) * 2.03 - 7.87;
    px = nx; pz = nz;
  }
  return sum / norm;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- map presets / deterministic layout ----------
export const MAP_PRESETS = Object.freeze({
  br: Object.freeze({
    id: "br", label: "BATTLE ROYALE", size: 2000, half: 1000,
    chunksPerAxis: 2, chunkCount: 4, rimStart: 850,
    hardClamp: 1000, boundaryMode: "damage", boundaryDamagePerSecond: 5,
  }),
  survival: Object.freeze({
    id: "survival", label: "SURVIVAL", size: 4000, half: 2000,
    chunksPerAxis: 4, chunkCount: 16, rimStart: 1800,
    hardClamp: 1950, boundaryMode: "clamp", boundaryDamagePerSecond: 0,
  }),
});
export const CHUNK_SIZE_M = 1000;
export const CHUNK_SEGMENTS = 96; // 10.4m near vertices; smooth landforms keep visible tris controlled

export function getMapPreset(id) {
  return MAP_PRESETS[id] || MAP_PRESETS.survival;
}
function getSearchParam(name) {
  try { return new URLSearchParams(window.location.search).get(name); }
  catch (e) { return null; }
}
let sessionWorldSeed = (() => {
  const raw = parseInt(getSearchParam("seed"), 10);
  return Number.isFinite(raw)
    ? raw >>> 0
    : ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
})();
let activePreset = getMapPreset(getSearchParam("map") || "survival");

// Mutable active layout. Only one world exists at a time; createWorld()
// reconfigures this before building its scene (menu mode switch = rebuild).
export const WORLD = {
  size: activePreset.size,
  half: activePreset.half,
  presetId: activePreset.id,
  chunksPerAxis: activePreset.chunksPerAxis,
  chunkCount: activePreset.chunkCount,
  playableRadius: activePreset.half, // legacy field; bounds are square now
  spawn: { x: 0, z: 0 },
  relay: { x: 0, z: 0 },
  warthog: { x: 18, z: 0, heading: 0 }, // parked at the south end of the dirt strip, facing north (-Z)
};
let relayBase = 0, spawnBase = 0;
let RIVER = { samples: [], grid: new Map(), cellSize: 50, control: [] };

export const SEA_LEVEL = 0.25;
// Myanmar-balanced landform model, mirrored in Rust. The playable square
// is an abstract sector rather than a literal country outline:
//   south      Ayeyarwady-style delta / wet coastal plain (2-8m)
//   centre     broad Dry-Zone lowland and gentle rolling ground (10-22m)
//   north/west Chin-Rakhine style hill country; east a lower Shan plateau
// Mountains are restricted to those outer belts and the border rim. The
// low frequencies and small lowland detail amplitude are deliberate: a
// future vehicle should meet long, readable grades instead of a field of
// 15m noise steps, and the rendered triangles stay close to physics.
function baseHeight(x, z, half = activePreset.half) {
  const invHalf = 1 / Math.max(1, half);
  const warpX = (fbm(x * 0.00125 + 31.7, z * 0.00125 - 18.2, 2) - 0.5) * 0.24;
  const warpZ = (fbm(x * 0.00115 - 24.6, z * 0.00115 + 9.4, 2) - 0.5) * 0.24;
  const u = clamp(x * invHalf + warpX, -1, 1);
  const v = clamp(z * invHalf + warpZ, -1, 1); // +v is south
  const macro = fbm(x * 0.00155 - 3.1, z * 0.00155 + 8.7, 3);
  const roll = fbm(x * 0.0042 + 17.4, z * 0.0042 - 5.6, 3);
  const detail = fbm(x * 0.011 - 9.8, z * 0.011 + 4.4, 2);
  const ridgeNoise = fbm(x * 0.0028 + 43.1, z * 0.0028 - 27.5, 3);
  const ridgeBand = clamp(1 - Math.abs(ridgeNoise * 2 - 1), 0, 1);
  const ridge = ridgeBand * ridgeBand;

  const south = smoothstep(0.02, 0.48, v);
  const north = smoothstep(-0.05, -0.58, v);
  const west = smoothstep(-0.12, -0.66, u);
  const east = smoothstep(0.28, 0.78, u);
  const hills = clamp(Math.max(north, west * 0.92, east * 0.62) * (1 - south * 0.88), 0, 1);

  const deltaH = 2.2 + macro * 3.6 + roll * 1.15 + detail * 0.28;
  const dryH = 9.0 + macro * 7.0 + roll * 3.4 + detail * 0.55;
  const hillH = 19.0 + macro * 15.0 + ridge * 25.0 + roll * 6.5 + detail * 1.5;
  let h = lerp(dryH, deltaH, south);
  h = lerp(h, hillH, hills);

  // Irregular southern shoreline: dry/delta ground eases through a beach
  // to a shallow seabed instead of meeting another mountain rim.
  const coastLine = 0.82 + (macro - 0.5) * 0.08;
  const coast = smoothstep(coastLine - 0.10, coastLine + 0.08, z * invHalf);
  return lerp(h, -2.4 + roll * 0.7, coast);
}
// Procedural rim mountains: past rimStart (BR 850m / Survival 1800m, square
// Chebyshev edge distance) height grows exponentially into an impassable
// ring. The southern coastal edge is suppressed so the delta can meet the
// sea; the hard map clamp/boundary rule still stops the player there.
function rimHeight(x, z) {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const start = activePreset.rimStart;
  if (edge <= start) return 0;
  const width = Math.max(1, activePreset.half - start);
  const t = (edge - start) / width;
  const shaped = (Math.exp(3.1 * Math.min(t, 1)) - 1) / (Math.exp(3.1) - 1);
  const ridge = 0.72 + 0.55 * fbm(x * 0.009 + 41.3, z * 0.009 - 23.8, 3);
  const beyond = t > 1 ? (t - 1) * width * 0.9 : 0;
  const southEdge = z > 0 && Math.abs(z) >= Math.abs(x)
    ? smoothstep(start, activePreset.half, z) * smoothstep(-0.78, -0.18, x / activePreset.half)
    : 0;
  return (shaped * 165 * ridge + beyond) * (1 - southEdge * 0.94);
}
function rawHeightJs(x, z) {
  return baseHeight(x, z) + rimHeight(x, z);
}
function rawHeight(x, z) {
  const rust = rustRawHeight(NOISE_SEED, x, z, activePreset.half, activePreset.rimStart);
  return rust === null ? rawHeightJs(x, z) : rust;
}

// ---------- river: seeded meander carved across the active map ----------
// A Catmull-Rom path is resampled at ~8m; terrain carves toward a smoothed,
// monotonically descending bed profile so the water ribbon flows downhill.
// Samples are bucketed into a 50m grid so height queries stay O(1)-ish even
// with ~700 samples on the 4km map.
function catmull2(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}
function riverCellKey(ix, iz) { return (ix + 128) * 512 + (iz + 128); }
function buildRiver(seed, preset) {
  const rand = mulberry32((seed ^ 0x713c51ab) >>> 0);
  const span = preset.rimStart * 0.94;
  // Ayeyarwady-like course: northern hills -> central Dry Zone -> southern
  // delta/coast (+Z is south). The centre control is pushed east/west so
  // the spawn remains on dry lowland.
  const startX = -(0.18 + rand() * 0.22) * span;
  const endX = (0.10 + rand() * 0.24) * span;
  const phase = rand() * Math.PI * 2;
  const ctrl = [];
  const N = 11, mid = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const z = lerp(-span, span, u);
    const fade = Math.sin(u * Math.PI);
    let x = lerp(startX, endX, u)
      + Math.sin(u * Math.PI * 2.2 + phase) * span * 0.10 * fade
      + (rand() - 0.5) * span * 0.04 * fade;
    if (i === mid) x = (rand() < 0.5 ? -1 : 1) * (65 + rand() * 55); // keep spawn dry
    ctrl.push([x, z]);
  }
  const pts = [];
  for (let s = 0; s < ctrl.length - 1; s++) {
    const p0 = ctrl[Math.max(0, s - 1)], p1 = ctrl[s];
    const p2 = ctrl[s + 1], p3 = ctrl[Math.min(ctrl.length - 1, s + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(8, Math.ceil(segLen / 8));
    for (let i = s === 0 ? 0 : 1; i <= steps; i++) pts.push(catmull2(p0, p1, p2, p3, i / steps));
  }
  let prof = pts.map(([x, z]) => rawHeight(x, z));
  for (let pass = 0; pass < 3; pass++) {
    const src = prof, next = prof.slice();
    for (let i = 0; i < src.length; i++) {
      let sum = 0, n = 0;
      for (let k = -18; k <= 18; k++) {
        sum += src[Math.max(0, Math.min(src.length - 1, i + k))]; n++;
      }
      next[i] = sum / n;
    }
    prof = next;
  }
  // Enforce only a gentle downstream fall. The former fixed 4.5cm/sample
  // rule forced a ~20m artificial drop and cut canyon-like banks through
  // otherwise flat lowland. Blend the smoothed terrain profile toward a
  // north-to-delta grade, then cap any remaining reverse slope.
  const startProf = prof[0], endProf = Math.max(1.2, prof[prof.length - 1]);
  for (let i = 0; i < prof.length; i++) {
    const u = prof.length <= 1 ? 0 : i / (prof.length - 1);
    prof[i] = lerp(prof[i], lerp(startProf, endProf, u), 0.38);
  }
  for (let i = 1; i < prof.length; i++) prof[i] = Math.min(prof[i], prof[i - 1] - 0.006);
  const cellSize = 50;
  const grid = new Map();
  const samples = pts.map(([x, z], i) => {
    // 0.9m wading depth (waist-deep): the old 1.6m gap put the 1.7m eye
    // essentially on the water surface while crossing.
    const sample = { x, z, i, bed: prof[i] - 1.85, water: prof[i] - 0.95 };
    const key = riverCellKey(Math.floor(x / cellSize), Math.floor(z / cellSize));
    const bucket = grid.get(key);
    if (bucket) bucket.push(sample); else grid.set(key, [sample]);
    return sample;
  });
  return { samples, grid, cellSize, control: ctrl };
}
const _riverHeightInfo = { d: 9999, bed: 0, water: -9999, x: 0, z: 0 };
const _riverWorldInfo = { d: 9999, bed: 0, water: -9999, x: 0, z: 0 };
const _riverPlayerInfo = { d: 9999, bed: 0, water: -9999, x: 0, z: 0 };
export function riverInfoInto(x, z, out) {
  out.d = 9999; out.bed = 0; out.water = -9999; out.x = x; out.z = z;
  if (!RIVER.samples.length) return out;
  const cell = RIVER.cellSize;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let bestD2 = Infinity;
  let bestX = x, bestZ = z, bestBed = 0, bestWater = -9999;
  // Distance to the river *polyline*, with bed/water interpolated along
  // the winning segment. Nearest-sample lookup made the carve jump every
  // ~8m and produced visibly stepped banks.
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const bucket = RIVER.grid.get(riverCellKey(ix, iz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i];
        const b = RIVER.samples[Math.min(RIVER.samples.length - 1, (a.i || 0) + 1)] || a;
        const abx = b.x - a.x, abz = b.z - a.z;
        const len2 = abx * abx + abz * abz;
        const t = len2 > 0.000001 ? clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1) : 0;
        const px = a.x + abx * t, pz = a.z + abz * t;
        const dx = x - px, dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2; bestX = px; bestZ = pz;
          bestBed = lerp(a.bed, b.bed, t);
          bestWater = lerp(a.water, b.water, t);
        }
      }
    }
  }
  if (!Number.isFinite(bestD2)) return out;
  out.d = Math.sqrt(bestD2); out.bed = bestBed; out.water = bestWater; out.x = bestX; out.z = bestZ;
  return out;
}
export function riverInfo(x, z) {
  return riverInfoInto(x, z, { d: 9999, bed: 0, water: -9999, x, z });
}

function chooseRelay(seed, preset) {
  const rand = mulberry32((seed ^ 0x04c2e7a) >>> 0);
  for (let attempt = 0; attempt < 64; attempt++) {
    const angle = rand() * Math.PI * 2;
    const radius = preset.half * (0.38 + rand() * 0.24);
    const x = Math.round(Math.cos(angle) * radius);
    const z = Math.round(Math.sin(angle) * radius);
    if (Math.max(Math.abs(x), Math.abs(z)) > preset.rimStart * 0.82) continue;
    if (riverInfoInto(x, z, _riverWorldInfo).d < 48) continue; // not in the widened river valley
    return { x, z };
  }
  return { x: Math.round(preset.half * 0.45), z: Math.round(-preset.half * 0.45) };
}

export function configureWorldLayout(presetId = activePreset.id, seed = sessionWorldSeed) {
  activePreset = getMapPreset(presetId);
  sessionWorldSeed = seed >>> 0;
  NOISE_SEED = (sessionWorldSeed ^ 0x2e7a04c9) >>> 0;
  WORLD.size = activePreset.size;
  WORLD.half = activePreset.half;
  WORLD.presetId = activePreset.id;
  WORLD.chunksPerAxis = activePreset.chunksPerAxis;
  WORLD.chunkCount = activePreset.chunkCount;
  WORLD.playableRadius = activePreset.half;
  WORLD.spawn.x = 0; WORLD.spawn.z = 0;
  WORLD.warthog = { x: 18, z: 0, heading: 0 };
  debugStats.warthogX = WORLD.warthog.x;
  debugStats.warthogZ = WORLD.warthog.z;
  RIVER = buildRiver(sessionWorldSeed, activePreset);
  WORLD.relay = chooseRelay(sessionWorldSeed, activePreset);
  spawnBase = rawHeight(WORLD.spawn.x, WORLD.spawn.z);
  relayBase = rawHeight(WORLD.relay.x, WORLD.relay.z);
  debugStats.mapMode = activePreset.id;
  debugStats.mapSizeM = activePreset.size;
  debugStats.worldSeed = sessionWorldSeed;
  debugStats.chunksTotal = activePreset.chunkCount;
  debugStats.relayX = WORLD.relay.x;
  debugStats.relayZ = WORLD.relay.z;
  return activePreset;
}
configureWorldLayout(activePreset.id, sessionWorldSeed);

export function terrainHeight(x, z) {
  return terrainHeightFromRaw(rawHeight(x, z), x, z);
}
function terrainHeightFromRaw(raw, x, z) {
  let h = raw;
  const dRelay = Math.hypot(x - WORLD.relay.x, z - WORLD.relay.z);
  const dSpawn = Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z);
  h = lerp(relayBase, h, smoothstep(9, 26, dRelay));
  h = lerp(spawnBase, h, smoothstep(7, 20, dSpawn));
  const ri = riverInfoInto(x, z, _riverHeightInfo);
  if (ri.d < 58) {
    // A 58m valley cross-section: channel bed -> low natural bank ->
    // broad floodplain -> untouched terrain. This replaces the narrow
    // 34m trench whose banks could rise faster than the mesh/physics
    // step and read as square walls in first person.
    const bank = ri.water + 0.55 + smoothstep(12, 58, ri.d) * 2.6;
    const target = lerp(ri.bed, bank, smoothstep(6.5, 19, ri.d));
    const blend = (1 - smoothstep(38, 58, ri.d)) * 0.94;
    h = lerp(h, target, blend);
  }
  return h;
}
export const heightAt = terrainHeight;

// Rendered-surface height used by actors. Physics previously sampled the
// continuous analytic height while the GPU drew large triangles between
// chunk vertices; on curved ground those surfaces could differ by metres,
// putting the camera *inside* a rendered hill (visible as see-through
// walls/floating trees). This function interpolates the same diagonal
// split as the Rust chunk indices on the near-LOD grid and clamps the
// result to within 22cm below the analytic authority.
const _surfaceCell = { key: "", a: 0, b: 0, c: 0, d: 0 };
export function terrainSurfaceHeight(x, z) {
  const step = CHUNK_SIZE_M / CHUNK_SEGMENTS;
  const origin = -activePreset.half;
  const gx = (x - origin) / step, gz = (z - origin) / step;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const x0 = origin + ix * step, z0 = origin + iz * step;
  const key = activePreset.id + "|" + sessionWorldSeed + "|" + ix + "|" + iz;
  if (_surfaceCell.key !== key) {
    _surfaceCell.key = key;
    _surfaceCell.a = terrainHeight(x0, z0);
    _surfaceCell.b = terrainHeight(x0 + step, z0);
    _surfaceCell.c = terrainHeight(x0, z0 + step);
    _surfaceCell.d = terrainHeight(x0 + step, z0 + step);
  }
  const tx = clamp(gx - ix, 0, 1), tz = clamp(gz - iz, 0, 1);
  const a = _surfaceCell.a, b = _surfaceCell.b, c = _surfaceCell.c, d = _surfaceCell.d;
  const tri = tx + tz <= 1
    ? a + (b - a) * tx + (c - a) * tz
    : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  return Math.max(tri, terrainHeight(x, z) - 0.22);
}

// Capsule-aware ground for the deterministic character step: the highest
// rendered/analytic shoulder inside a body radius becomes a step/wall
// before the camera centre can enter the slope. Rust physics receives
// this through its existing host import, so JS/Rust stay in lock-step.
export function collisionHeight(x, z) {
  const centre = terrainSurfaceHeight(x, z);
  const r = 0.38;
  const shoulder = Math.max(
    terrainHeight(x + r, z), terrainHeight(x - r, z),
    terrainHeight(x, z + r), terrainHeight(x, z - r)
  );
  return Math.max(centre, shoulder - 0.16);
}

// Footprint-aware support for physical props. A rigid rock/wreck/vehicle
// body rests on the HIGHEST rendered ground inside its footprint (so no
// corner can sink under a slope), while a rooted tree seats on the LOWEST
// point inside its root disc (so the downhill root edge touches instead of
// hovering). Every placement in the world funnels through these helpers,
// which is what guarantees nothing spawns floating or buried.
export function groundSupportHeight(x, z, radius = 0, support = "max") {
  const centre = terrainSurfaceHeight(x, z);
  if (!(radius > 0.04)) return centre;
  const diag = radius * 0.7071;
  const samples = [
    centre,
    terrainSurfaceHeight(x + radius, z), terrainSurfaceHeight(x - radius, z),
    terrainSurfaceHeight(x, z + radius), terrainSurfaceHeight(x, z - radius),
    terrainSurfaceHeight(x + diag, z + diag), terrainSurfaceHeight(x - diag, z + diag),
    terrainSurfaceHeight(x + diag, z - diag), terrainSurfaceHeight(x - diag, z - diag),
  ];
  return support === "min" ? Math.min(...samples) : Math.max(...samples);
}

// Resting centre-Y for a grounded body: support point + half height,
// optionally embedded a few cm so contact reads as weight, not hovering.
// Future vehicles settle through this same helper before their first frame.
export function groundedBodyY(x, z, radius = 0, halfHeight = 0, embed = 0.04, support = "max") {
  return groundSupportHeight(x, z, radius, support) + halfHeight - embed;
}

// ---------- world factory ----------
export function createWorld(canvas, hooks = {}, options = {}) {
  const mapPreset = configureWorldLayout(
    options.mapPreset || options.mapMode || activePreset.id,
    options.seed !== undefined ? options.seed : sessionWorldSeed
  );
  debugStats.travelM = 0;
  debugStats.outOfBounds = 0;
  debugStats.boundaryDamage = 0;
  debugStats.chunksLoaded = 0;
  debugStats.chunksVisible = 0;

  // Optional Rust terrain/AI worker. It is an accelerator only: streamed
  // chunk jobs use it when ready, while boot/teleport cuts and every
  // failure keep the synchronous main-thread Rust/JS paths below.
  const workerPending = new Map();
  let terrainWorker = null;
  let workerReady = false;
  let workerSeq = 1;
  let workerAiPending = false;
  const workerScatterCache = [null, null];
  const workerScatterPending = [false, false];
  const workerScatterCenter = new Float64Array([0, 0, 0, 0]);
  function setWorkerPendingStats() { debugStats.workerPending = workerPending.size; }
  function markWorkerRequestFailed(rec) {
    if (!rec) return;
    if (rec.kind === "chunk") {
      const job = chunkJobs.get(rec.key);
      if (job && job.workerId === rec.id) job.workerFailed = true;
    } else if (rec.kind === "scatter") {
      workerScatterPending[rec.scatterKind] = false;
    } else if (rec.kind === "ai") {
      workerAiPending = false;
    } else if (rec.kind === "path") {
      const d = drones[rec.drone];
      if (d && d.pathId === rec.id) d.pathPending = false;
    }
  }
  function disableWorker() {
    if (terrainWorker) { try { terrainWorker.terminate(); } catch (e) {} }
    terrainWorker = null;
    workerReady = false;
    workerAiPending = false;
    workerScatterPending[0] = false;
    workerScatterPending[1] = false;
    debugStats.workerCore = "FALLBACK";
    for (const rec of workerPending.values()) markWorkerRequestFailed(rec);
    workerPending.clear();
    setWorkerPendingStats();
  }
  function handleWorkerMessage(e) {
    const data = e.data || {};
    if (data.type === "ready") {
      workerReady = !!data.ok;
      debugStats.workerCore = workerReady ? "RUST" : "FALLBACK";
      if (!workerReady) disableWorker();
      return;
    }
    const rec = workerPending.get(data.id);
    if (!rec) return;
    workerPending.delete(data.id);
    setWorkerPendingStats();
    if (!data.ok) { markWorkerRequestFailed(rec); return; }
    if (data.type === "chunk") {
      const job = chunkJobs.get(rec.key);
      if (job && job.workerId === data.id) job.workerResult = data;
    } else if (data.type === "scatter") {
      workerScatterPending[rec.scatterKind] = false;
      workerScatterCache[rec.scatterKind] = data.records;
      workerScatterCenter[rec.scatterKind * 2] = data.cx;
      workerScatterCenter[rec.scatterKind * 2 + 1] = data.cz;
    } else if (data.type === "ai") {
      workerAiPending = false;
      debugStats.workerAiBatches++;
      const out = data.out;
      const n = Math.min(rec.count || 0, drones.length);
      for (let i = 0; i < n; i++) {
        const d = drones[i], o = i * 8;
        d.rustLos = out[o + 1] > 0.5;
        d.rustThreat = out[o + 2];
        d.rustWayX = out[o + 3];
        d.rustWayZ = out[o + 4];
        if (d.rustLos) { d.path = null; d.pathPending = false; }
      }
    } else if (data.type === "path") {
      const d = drones[rec.drone];
      if (d && d.pathId === rec.id) {
        d.pathPending = false;
        if (data.path && data.path.length >= 4) {
          d.path = data.path; d.pathI = 2; debugStats.workerPaths++;
        }
      }
    }
  }
  function postWorker(kind, msg, rec, transfer) {
    if (!terrainWorker || !workerReady) return 0;
    const id = workerSeq++;
    rec.kind = kind;
    rec.id = id;
    msg.id = id;
    workerPending.set(id, rec);
    setWorkerPendingStats();
    try {
      if (transfer && transfer.length) terrainWorker.postMessage(msg, transfer);
      else terrainWorker.postMessage(msg);
      return id;
    } catch (e) {
      workerPending.delete(id);
      setWorkerPendingStats();
      disableWorker();
      return 0;
    }
  }
  function getWorkerScatter(kind, cx, cz, radius) {
    if (!workerReady) return null;
    const records = workerScatterCache[kind];
    const dx = cx - workerScatterCenter[kind * 2];
    const dz = cz - workerScatterCenter[kind * 2 + 1];
    const stale = !records || dx * dx + dz * dz > 36;
    if (stale && !workerScatterPending[kind]) {
      const rec = { scatterKind: kind };
      // Request an 8m apron: the deterministic world-grid records then
      // still cover the full current 60m disc after <=6m of camera travel,
      // so using the cached reply cannot drop placements at the far edge.
      const id = postWorker("scatter", { type: "scatter", kind, cx, cz, radius: radius + 8 }, rec);
      if (id) workerScatterPending[kind] = true;
    }
    if (stale) return null;
    debugStats.workerScatterBatches++;
    return records;
  }
  try {
    if (typeof Worker !== "undefined") {
      terrainWorker = new Worker(new URL("./wasm/terrain-worker.js", import.meta.url), { type: "module" });
    }
  } catch (e) { terrainWorker = null; }
  if (terrainWorker) {
    debugStats.workerCore = "LOADING";
    terrainWorker.onmessage = handleWorkerMessage;
    terrainWorker.onerror = () => disableWorker();
    const workerSamples = new Float64Array(RIVER.samples.length * 4);
    for (let i = 0; i < RIVER.samples.length; i++) {
      const sm = RIVER.samples[i], o = i * 4;
      workerSamples[o] = sm.x; workerSamples[o + 1] = sm.z;
      workerSamples[o + 2] = sm.bed; workerSamples[o + 3] = sm.water;
    }
    try {
      terrainWorker.postMessage({
        type: "init",
        layout: {
          noiseSeed: NOISE_SEED, half: mapPreset.half, rimStart: mapPreset.rimStart,
          spawnX: WORLD.spawn.x, spawnZ: WORLD.spawn.z,
          relayX: WORLD.relay.x, relayZ: WORLD.relay.z,
          spawnBase, relayBase, cellSize: RIVER.cellSize, samples: workerSamples,
        },
      }, [workerSamples.buffer]);
    } catch (e) { disableWorker(); }
  } else {
    debugStats.workerCore = "OFF";
  }

  const noop = { setPlaying() {}, shoot() {}, reload() {}, teleport() {}, dispose() {} };
  const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  let renderer;
  try {
    // MSAA is a major mobile fill-rate cost; coarse pointers rely on the
    // native-resolution backbuffer below instead of a separate MSAA pass.
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: "high-performance", stencil: false });
  } catch (err) {
    return noop; // very old device: UI still works over the CSS gradient
  }
  // Landscape "gaming mode" stays UNCOMPRESSED: always render at the
  // device's native pixel ratio. The previous quality-capped adaptive
  // governor started phones at DPR 1.1 and shed toward 1.0 under load,
  // which looked compressed/blurry as soon as the phone was tilted.
  const nativePixelRatio = () => Math.max(1, window.devicePixelRatio || 1);
  const viewportSize = () => {
    // visualViewport follows the real on-screen size through rotation and
    // mobile browser-chrome changes more reliably than innerWidth alone.
    const vv = window.visualViewport;
    return {
      w: Math.max(1, Math.round((vv && vv.width) || window.innerWidth || 1)),
      h: Math.max(1, Math.round((vv && vv.height) || window.innerHeight || 1)),
    };
  };
  let renderDpr = nativePixelRatio();
  renderer.setPixelRatio(renderDpr);
  debugStats.dpr = renderDpr;
  debugStats.cssWidth = 0;
  debugStats.cssHeight = 0;
  debugStats.nativeDpr = renderDpr;
  {
    const { w, h } = viewportSize();
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px";
    renderer.domElement.style.height = h + "px";
    debugStats.cssWidth = w;
    debugStats.cssHeight = h;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  // Combat-perf policy: shadow maps are frozen out of the frame loop.
  // This world has no shadow-casting lights, so disabling the shadow-map
  // system (rather than merely pausing updates) guarantees zero shadow
  // passes and zero shadow-map allocations during combat.
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f0a); // behind the sky dome
  scene.fog = new THREE.FogExp2(0xb7c8ae, 0.0026); // exponential atmosphere; density is climate-driven

  const camera = new THREE.PerspectiveCamera(71, debugStats.cssWidth / Math.max(1, debugStats.cssHeight), 0.1, 900);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xbdd3a0, 0x0c100b, 0.85);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xd8e6c0, 1.5);
  sunLight.position.set(90, 150, 40);
  sunLight.castShadow = false;
  scene.add(sunLight);
  const moonLight = new THREE.DirectionalLight(0x8fa8d8, 0);
  moonLight.position.set(-60, 120, -30);
  moonLight.castShadow = false;
  scene.add(moonLight);
  // Light targets ride on the camera (updated in updateSky). Without this,
  // Three.js aims both lights at the world origin and sun direction skews
  // badly at 2-4km map distances.
  scene.add(sunLight.target);
  scene.add(moonLight.target);

  // ----- sky: gradient dome + sun/moon discs, star field, galaxies -----
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const skyUniforms = {
    uZenith: { value: new THREE.Color(0x3f76b8) },
    uHorizon: { value: new THREE.Color(0xb7c8ae) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff2d8) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uSunGlow: { value: 1 },
  };
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(780, 20, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uMoonDir;
        uniform float uNight;
        uniform float uSunGlow;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -1.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.58));
          col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
          float sDot = max(dot(dir, normalize(uSunDir)), 0.0);
          col += uSunColor * ((pow(sDot, 700.0) * 1.9 + pow(sDot, 20.0) * 0.22) * (0.3 + uSunGlow) + pow(sDot, 3.0) * 0.16 * uSunGlow);
          float mDot = max(dot(dir, normalize(uMoonDir)), 0.0);
          col += vec3(0.78, 0.85, 0.97) * (smoothstep(0.9992, 0.99965, mDot) * 0.9 + pow(mDot, 120.0) * 0.12) * uNight;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -10;
  skyGroup.add(skyDome);

  const starGeo = new THREE.BufferGeometry();
  {
    const starRand = mulberry32(777);
    const sp = new Float32Array(1700 * 3);
    for (let i = 0; i < 1700; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(
        750,
        Math.acos(1 - starRand() * 1.15),
        starRand() * Math.PI * 2
      );
      sp[i * 3] = v.x; sp[i * 3 + 1] = v.y; sp[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  }
  const starMat = new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 1.7, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  skyGroup.add(stars);

  function makeGalaxyTexture(core, arm, seed) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 95);
    grad.addColorStop(0, "rgba(255,246,220,0.95)");
    grad.addColorStop(0.22, core);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const R = mulberry32(seed);
    for (let i = 0; i < 1500; i++) {
      const a0 = (i % 3) * ((Math.PI * 2) / 3);
      const r = Math.pow(R(), 0.62) * 118;
      const a = a0 + r * 0.045 + (R() - 0.5) * 0.6 * (1 - r / 170);
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r * 0.62;
      g.fillStyle = R() < 0.14 ? arm : `rgba(235,240,255,${0.25 + R() * 0.6})`;
      g.beginPath();
      g.arc(x, y, R() * 1.7 + 0.3, 0, 7);
      g.fill();
    }
    return new THREE.CanvasTexture(c);
  }
  const galaxies = [];
  {
    const defs = [
      { tex: makeGalaxyTexture("rgba(150,140,255,0.4)", "rgba(170,160,255,0.9)", 101), phi: 0.62, theta: 0.7, scale: 430, rot: 0.4 },
      { tex: makeGalaxyTexture("rgba(255,170,210,0.35)", "rgba(255,190,220,0.9)", 202), phi: 0.95, theta: 2.9, scale: 300, rot: 1.8 },
      { tex: makeGalaxyTexture("rgba(140,220,255,0.35)", "rgba(160,225,255,0.9)", 303), phi: 0.45, theta: 4.6, scale: 250, rot: 2.9 },
    ];
    for (const d of defs) {
      const mat = new THREE.SpriteMaterial({
        map: d.tex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, rotation: d.rot,
      });
      const spr = new THREE.Sprite(mat);
      spr.position.setFromSphericalCoords(735, d.phi, d.theta);
      spr.scale.set(d.scale, d.scale * 0.62, 1);
      spr.renderOrder = -8;
      skyGroup.add(spr);
      galaxies.push(spr);
    }
  }

  const rand = mulberry32((sessionWorldSeed ^ 0x90210) >>> 0);

  // ----- terrain: 1km chunks, tiered LOD + time-sliced builds -----
  // Resolution by Chebyshev chunk distance from the camera chunk: the
  // current chunk and ring-1 stay at the full 96x96 segments (nothing
  // inside or near the 200m fog wall is ever downgraded), ring-2 builds
  // at 48 and ring-3+ at 24 — those chunks sit fully behind fog, so the
  // reduction is invisible. Builds run as sliced jobs (~3.5ms of work
  // per frame) prioritised by distance and view direction, so crossing
  // into a new chunk never stalls a frame on a synchronous build.
  // Center four chunks are still built synchronously at boot (menu
  // backdrop), and a teleport builds its destination synchronously (cut).
  // Only chunks whose bounds come within 340m are visible, giving clear
  // ~300m combat sightlines under exponential fog.
  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, flatShading: false,
  });
  // Vibrant atlas-style detail without an atlas texture, extra draw call,
  // render target or per-vertex splat upload: two world-space value-noise
  // scales modulate the Rust-baked vertex colour/AO and roughness in the
  // existing terrain program. Smooth vertex normals (not flat shading)
  // remove the square facet read; detail fades out before the fog wall.
  terrainMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 vTerrainWorld;\nvarying vec3 vTerrainNormalW;\nvarying float vTerrainDist;\n" + shader.vertexShader
      .replace("#include <project_vertex>", `#include <project_vertex>
        vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormalW = normalize(mat3(modelMatrix) * objectNormal);
        vTerrainDist = -mvPosition.z;`);
    shader.fragmentShader = `varying vec3 vTerrainWorld;
      varying vec3 vTerrainNormalW;
      varying float vTerrainDist;
      float ironTerrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float ironTerrainNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(ironTerrainHash(i), ironTerrainHash(i + vec2(1.0, 0.0)), u.x),
                   mix(ironTerrainHash(i + vec2(0.0, 1.0)), ironTerrainHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    ` + shader.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>
        float ironDetailFade = 1.0 - smoothstep(45.0, 180.0, vTerrainDist);
        float ironN1 = ironTerrainNoise(vTerrainWorld.xz * 0.045);
        float ironN2 = ironTerrainNoise(vTerrainWorld.xz * 0.21 + 17.31);
        float ironDetail = mix(0.5, ironN1 * 0.62 + ironN2 * 0.38, ironDetailFade);
        diffuseColor.rgb *= 0.93 + 0.14 * ironDetail;
        float ironPatch = ironTerrainNoise(vTerrainWorld.xz * 0.012 - 9.17);
        diffuseColor.rgb *= mix(vec3(0.97, 1.03, 0.94), vec3(1.07, 1.00, 0.88), smoothstep(0.35, 0.75, ironPatch) * 0.45 * ironDetailFade);
        float ironLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(ironLuma), diffuseColor.rgb, 1.14);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        float ironSlope = 1.0 - clamp(vTerrainNormalW.y, 0.0, 1.0);
        roughnessFactor = clamp(0.98 - smoothstep(0.45, 0.8, ironN2) * 0.10 * ironDetailFade - ironSlope * 0.12, 0.68, 1.0);`);
  };
  terrainMaterial.customProgramCacheKey = () => "ironveil-terrain-vibrant-v2";
  const terrainGroup = new THREE.Group();
  terrainGroup.name = "terrain-chunks";
  scene.add(terrainGroup);
  const terrainChunks = new Map();
  const terrainMeshes = [];
  let chunkStreamAcc = Infinity;
  const _chunkBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, cx: 0, cz: 0 };
  function chunkBounds(ix, iz, out) {
    const minX = -mapPreset.half + ix * CHUNK_SIZE_M;
    const minZ = -mapPreset.half + iz * CHUNK_SIZE_M;
    if (out) {
      out.minX = minX; out.maxX = minX + CHUNK_SIZE_M;
      out.minZ = minZ; out.maxZ = minZ + CHUNK_SIZE_M;
      out.cx = minX + CHUNK_SIZE_M / 2; out.cz = minZ + CHUNK_SIZE_M / 2;
      return out;
    }
    return { minX, maxX: minX + CHUNK_SIZE_M, minZ, maxZ: minZ + CHUNK_SIZE_M, cx: minX + CHUNK_SIZE_M / 2, cz: minZ + CHUNK_SIZE_M / 2 };
  }
  const LOD_SEGMENTS = [96, 64, 32, 16]; // near/mid detail restored; smoother landforms offset the vertex cost
  const chunkJobs = new Map(); // key -> build job
  const chunkQueue = []; // job keys, best score first
  const bvhQueue = []; // finished meshes awaiting an idle-frame BVH build
  const _vFwd = new THREE.Vector3();
  const _chunkIndex = { ix: 0, iz: 0 };
  function chunkIndexAt(x, z) {
    const n = mapPreset.chunksPerAxis;
    _chunkIndex.ix = clamp(Math.floor((x + mapPreset.half) / CHUNK_SIZE_M), 0, n - 1);
    _chunkIndex.iz = clamp(Math.floor((z + mapPreset.half) / CHUNK_SIZE_M), 0, n - 1);
    return _chunkIndex;
  }
  function compareChunkKeys(a, b2) {
    const ja = chunkJobs.get(a), jb = chunkJobs.get(b2);
    return (ja ? ja.score : 1e9) - (jb ? jb.score : 1e9);
  }
  function desiredSegments(ix, iz, cix, ciz) {
    const d = Math.max(Math.abs(ix - cix), Math.abs(iz - ciz));
    return LOD_SEGMENTS[Math.min(d, LOD_SEGMENTS.length - 1)];
  }
  function startChunkJob(ix, iz, seg) {
    const key = ix + "," + iz;
    const existing = chunkJobs.get(key);
    if (existing) return existing;
    const b = chunkBounds(ix, iz);
    // Do not allocate a PlaneGeometry up front: Rust/worker chunks replace
    // it with final typed-array geometry, so the plane is created lazily
    // only if the JS color fallback is actually needed.
    const geo = new THREE.BufferGeometry();
    const job = { key, ix, iz, seg, b, geo, pos: null, vertexCount: (seg + 1) * (seg + 1), posHeightsReady: false, stage: "heights", i: 0, colors: null, norm: null, raw: undefined, light: null, final: null, rustTried: false, workerTried: false, workerId: 0, workerResult: null, workerFailed: false, workerSentAt: 0, score: 1e9 };
    chunkJobs.set(key, job);
    chunkQueue.push(key);
    return job;
  }
  const _cLow = new THREE.Color(0x2f6b2f), _cMid = new THREE.Color(0x68813e);
  const _cRock = new THREE.Color(0x7a7567), _cPeak = new THREE.Color(0x9aa08e);
  const _cSand = new THREE.Color(0xb79b68), _cRice = new THREE.Color(0x4c9a3e);
  const _cDry = new THREE.Color(0xa8894e), _cForest = new THREE.Color(0x245c2d);
  const _ctmp = new THREE.Color();
  const _terrainPalette = new Array(12);
  function fillTerrainPalette() {
    _terrainPalette[0] = _cLow.r; _terrainPalette[1] = _cLow.g; _terrainPalette[2] = _cLow.b;
    _terrainPalette[3] = _cMid.r; _terrainPalette[4] = _cMid.g; _terrainPalette[5] = _cMid.b;
    _terrainPalette[6] = _cRock.r; _terrainPalette[7] = _cRock.g; _terrainPalette[8] = _cRock.b;
    _terrainPalette[9] = _cPeak.r; _terrainPalette[10] = _cPeak.g; _terrainPalette[11] = _cPeak.b;
    return _terrainPalette;
  }
  function finishChunkJob(job) {
    const geo = job.geo;
    geo.computeBoundingSphere();
    // BVH build is deferred to an idle frame (pumpBvh): it is atomic and
    // must not inflate the chunk-build slice. Until it runs, shooting
    // raycasts against this chunk use the stock three.js path.
    const mesh = new THREE.Mesh(geo, terrainMaterial);
    mesh.position.set(job.b.cx, 0, job.b.cz);
    mesh.userData.isTerrainChunk = true;
    mesh.userData.chunkKey = job.key;
    mesh.userData.seg = job.seg;
    mesh.visible = distanceToChunk(camera.position.x, camera.position.z, job.b) <= 340;
    const old = terrainChunks.get(job.key);
    if (old) { // LOD swap: the new mesh replaces the old with no gap
      terrainGroup.remove(old);
      old.geometry.disposeBoundsTree();
      old.geometry.dispose();
      const oi = terrainMeshes.indexOf(old);
      if (oi >= 0) terrainMeshes.splice(oi, 1);
    }
    terrainGroup.add(mesh);
    terrainChunks.set(job.key, mesh);
    terrainMeshes.push(mesh);
    bvhQueue.push(mesh);
    chunkJobs.delete(job.key);
    return mesh;
  }
  function ensureFallbackGeometry(job) {
    if (job.pos) return job.pos;
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE_M, CHUNK_SIZE_M, job.seg, job.seg);
    geo.rotateX(-Math.PI / 2);
    job.geo.dispose();
    job.geo = geo;
    job.pos = geo.attributes.position;
    if (job.final) {
      for (let i = 0; i < job.pos.count; i++) job.pos.setY(i, job.final[i]);
      job.posHeightsReady = true;
    }
    return job.pos;
  }
  function finishRustMesh(job, rustMesh, fromWorker) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(rustMesh.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(rustMesh.normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(rustMesh.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(rustMesh.indices, 1));
    job.geo.dispose();
    job.geo = geo;
    job.pos = geo.attributes.position;
    job.light = rustMesh.light;
    debugStats.rustMeshes++;
    if (fromWorker) { debugStats.workerChunks++; debugStats.rustChunks++; }
    finishChunkJob(job);
    return true;
  }
  // Advances one job until `deadline` (performance.now() ms). Returns true
  // when the mesh is finished. Heights and vertex colors are the two hot
  // loops; each checks the clock every 256 vertices.
  function stepChunkJob(job, deadline) {
    const b = job.b;
    const vertexCount = job.vertexCount;
    if (job.stage === "worker") {
      if (job.workerResult) {
        const result = job.workerResult;
        job.workerResult = null;
        return finishRustMesh(job, result, true);
      }
      if (job.workerFailed || performance.now() - job.workerSentAt > 10000) {
        job.workerFailed = false;
        job.stage = "heights";
      } else {
        return false;
      }
    }
    if (job.stage === "heights" && deadline !== Infinity && !job.workerTried && workerReady) {
      job.workerTried = true;
      fillTerrainPalette();
      const rec = { key: job.key };
      const id = postWorker("chunk", {
        type: "chunk", key: job.key, minX: b.minX, minZ: b.minZ,
        sizeM: CHUNK_SIZE_M, segments: job.seg, palette: _terrainPalette,
      }, rec);
      if (id) {
        job.workerId = id;
        job.workerSentAt = performance.now();
        job.stage = "worker";
        return false;
      }
    }
    if (job.stage === "heights") {
      if (job.raw === undefined) {
        const rust = rustChunkTerrain(
          NOISE_SEED, b.minX, b.minZ, CHUNK_SIZE_M, job.seg,
          mapPreset.half, mapPreset.rimStart
        );
        job.raw = rust ? rust.heights : null;
        job.light = rust ? rust.light : null;
        if (job.raw) debugStats.rustChunks++;
      }
      const rawRowW = job.seg + 1;
      const cellStep = CHUNK_SIZE_M / job.seg;
      if (!job.final) job.final = new Float64Array(vertexCount);
      while (job.i < vertexCount) {
        const idx = job.i;
        const col = idx % rawRowW;
        const row = (idx / rawRowW) | 0;
        const wx = b.minX + col * cellStep;
        const wz = b.minZ + row * cellStep;
        job.final[idx] = job.raw
          ? terrainHeightFromRaw(job.raw[idx], wx, wz)
          : terrainHeight(wx, wz);
        job.i++;
        if ((job.i & 127) === 0 && performance.now() > deadline) return false;
      }
      job.stage = "colors";
      job.i = 0;
    }
    // Rust can finish the whole mesh (positions/normals/vertex-colors/
    // indices) from the final-height grid. If it is unavailable,
    // the original JS color loop below remains the exact fallback.
    if (!job.rustTried) {
      job.rustTried = true;
      fillTerrainPalette();
      const rustMesh = job.final ? rustBuildChunkMesh(
        job.final, NOISE_SEED, b.minX, b.minZ, CHUNK_SIZE_M, job.seg, _terrainPalette
      ) : null;
      if (rustMesh) return finishRustMesh(job, rustMesh, false);
    }
    // Slope for coloring comes from the height gradient over grid
    // neighbours — the material is flat-shaded (fragment-derivative
    // normals), so no computeVertexNormals pass is needed at all.
    const pos = ensureFallbackGeometry(job);
    if (!job.colors) job.colors = new Float32Array(vertexCount * 3);
    const colors = job.colors;
    const rowW = job.seg + 1, cell = CHUNK_SIZE_M / job.seg;
    while (job.i < vertexCount) {
      const i = job.i;
      const col = i % rowW, row = (i / rowW) | 0;
      const iL = col > 0 ? i - 1 : i, iR = col < job.seg ? i + 1 : i;
      const iU = row > 0 ? i - rowW : i, iD = row < job.seg ? i + rowW : i;
      const gx = (pos.getY(iR) - pos.getY(iL)) / (((col < job.seg ? 1 : 0) + (col > 0 ? 1 : 0)) * cell || cell);
      const gz = (pos.getY(iD) - pos.getY(iU)) / (((row < job.seg ? 1 : 0) + (row > 0 ? 1 : 0)) * cell || cell);
      const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const wx = pos.getX(i) + b.cx, wz = pos.getZ(i) + b.cz;
      const h = pos.getY(i);
      _ctmp.copy(_cLow).lerp(_cMid, smoothstep(2, 26, h));
      _ctmp.lerp(_cPeak, smoothstep(38, 78, h) * 0.8);
      const moisture = fbm(wx * 0.0035 + 8.4, wz * 0.0035 - 2.7, 2);
      const dryNoise = fbm(wx * 0.006 - 5.1, wz * 0.006 + 11.9, 2);
      _ctmp.lerp(_cRice, smoothstep(10, 5, h) * smoothstep(0.38, 0.72, moisture) * 0.55);
      _ctmp.lerp(_cDry, smoothstep(0.55, 0.84, dryNoise) * smoothstep(7, 13, h) * (1 - smoothstep(24, 38, h)) * 0.42);
      _ctmp.lerp(_cForest, smoothstep(20, 34, h) * smoothstep(0.42, 0.74, moisture) * 0.48);
      _ctmp.lerp(_cSand, smoothstep(2.6, 0.5, h) * (1 - smoothstep(0.12, 0.32, slope)) * 0.72);
      _ctmp.lerp(_cRock, smoothstep(0.18, 0.5, slope));
      // Rust-baked AO (when present) grounds valleys/ridges with no
      // shadow-map pass; JS-built chunks keep the plain hash shade.
      const shade = (0.9 + 0.1 * hash2(wx * 3.1, wz * 3.1)) * (job.light ? job.light[i] : 1);
      colors[i * 3] = _ctmp.r * shade; colors[i * 3 + 1] = _ctmp.g * shade; colors[i * 3 + 2] = _ctmp.b * shade;
      job.i++;
      if ((job.i & 127) === 0 && performance.now() > deadline) return false;
    }
    job.geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    job.geo.computeVertexNormals(); // JS fallback uses the same smooth shading as Rust meshes
    finishChunkJob(job);
    return true;
  }
  function pumpChunkJobs(budgetMs) {
    debugStats.chunkJobs = chunkQueue.length;
    if (!chunkQueue.length) return;
    const t0 = performance.now();
    const deadline = t0 + budgetMs;
    while (chunkQueue.length) {
      const job = chunkJobs.get(chunkQueue[0]);
      if (!job) { chunkQueue.shift(); continue; }
      const done = stepChunkJob(job, deadline);
      if (done) chunkQueue.shift();
      if (!done || performance.now() > deadline) break;
    }
    const used = performance.now() - t0;
    if (used > debugStats.chunkBuildMs) debugStats.chunkBuildMs = used;
    debugStats.chunkJobs = chunkQueue.length;
  }
  function pumpBvh() {
    debugStats.bvhPending = bvhQueue.length;
    if (chunkQueue.length || !bvhQueue.length) return;
    const mesh = bvhQueue.shift();
    if (mesh.geometry && !mesh.geometry.boundsTree && terrainChunks.get(mesh.userData.chunkKey) === mesh) {
      mesh.geometry.computeBoundsTree();
    }
    debugStats.bvhPending = bvhQueue.length;
  }
  function buildTerrainChunkSync(ix, iz, seg) {
    const job = startChunkJob(ix, iz, seg);
    const qi = chunkQueue.indexOf(job.key);
    if (qi >= 0) chunkQueue.splice(qi, 1);
    while (!stepChunkJob(job, Infinity)) { /* monotone progress; runs to completion */ }
    return terrainChunks.get(job.key);
  }

  const GRAVITY = -21; // kinematic jump/fall acceleration (m/s^2)

  function distanceToChunk(x, z, b) {
    const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
    const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
    return Math.hypot(dx, dz);
  }
  function updateChunkStreaming() {
    const fx = camera.position.x, fz = camera.position.z;
    const cam = chunkIndexAt(fx, fz);
    camera.getWorldDirection(_vFwd);
    let visible = 0, l96 = 0, l48 = 0, l24 = 0;
    for (let ix = 0; ix < mapPreset.chunksPerAxis; ix++) {
      for (let iz = 0; iz < mapPreset.chunksPerAxis; iz++) {
        const b = chunkBounds(ix, iz, _chunkBounds);
        const d = distanceToChunk(fx, fz, b);
        const key = ix + "," + iz;
        const mesh = terrainChunks.get(key);
        let job = chunkJobs.get(key);
        const want = desiredSegments(ix, iz, cam.ix, cam.iz);
        if (!mesh && !job && d <= 1700) job = startChunkJob(ix, iz, want); // prefetch
        else if (mesh && !job && mesh.userData.seg < want) job = startChunkJob(ix, iz, want); // upgrade on approach
        else if (mesh && !job && mesh.userData.seg > want && d > 500) job = startChunkJob(ix, iz, want); // downgrade behind fog
        if (job) {
          // Priority: near chunks first, view-direction bonus, and any
          // missing chunk before an LOD swap of an existing mesh.
          const dx = b.cx - fx, dz = b.cz - fz;
          const dl = Math.hypot(dx, dz) || 1;
          const fwd = (dx / dl) * _vFwd.x + (dz / dl) * _vFwd.z;
          job.score = d - fwd * 300 + (mesh ? 400 : 0);
        }
        if (mesh) {
          mesh.visible = d <= 340;
          if (mesh.visible) visible++;
          if (mesh.userData.seg >= 64) l96++; else if (mesh.userData.seg >= 28) l48++; else l24++;
        }
      }
    }
    chunkQueue.sort(compareChunkKeys);
    debugStats.chunksLoaded = terrainChunks.size;
    debugStats.chunksVisible = visible;
    debugStats.chunksTotal = mapPreset.chunkCount;
    debugStats.lod96 = l96; debugStats.lod48 = l48; debugStats.lod24 = l24;
  }
  // Boot: the four chunks meeting at the center spawn, full detail, so the
  // menu backdrop is complete on the first frame.
  for (let ix = 0; ix < mapPreset.chunksPerAxis; ix++) {
    for (let iz = 0; iz < mapPreset.chunksPerAxis; iz++) {
      const b = chunkBounds(ix, iz);
      if (b.minX <= 0 && b.maxX >= 0 && b.minZ <= 0 && b.maxZ >= 0) buildTerrainChunkSync(ix, iz, CHUNK_SEGMENTS);
    }
  }
  updateChunkStreaming();

  // ----- river water ribbon + plank bridge on the spawn->relay line -----
  const waterUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 }, uDay: { value: 1 },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
      uHorizon: { value: new THREE.Color(0xb7c8ae) },
    },
  ]);
  {
    const pts = RIVER.samples;
    const positions = new Float32Array(pts.length * 2 * 3);
    const uvs = new Float32Array(pts.length * 2 * 2);
    const indices = [];
    let distAcc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const pn = pts[Math.min(pts.length - 1, i + 1)];
      const pp = pts[Math.max(0, i - 1)];
      let tx = pn.x - pp.x, tz = pn.z - pp.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      if (i > 0) distAcc += Math.hypot(p.x - pp.x, p.z - pp.z);
      const taper = Math.min(1, Math.min(i, pts.length - 1 - i) / 8 + 0.25);
      const hw = 8.6 * taper;
      const sx = -tz * hw, sz = tx * hw;
      positions.set([p.x - sx, p.water, p.z - sz, p.x + sx, p.water, p.z + sz], i * 6);
      uvs.set([0, distAcc / 9, 1, distAcc / 9], i * 4);
      if (i < pts.length - 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    wgeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    wgeo.setIndex(indices);
    const wmat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec3 p = position;
          p.y += sin(uv.y * 16.0 - uTime * 1.5) * 0.035;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uDay;
        uniform vec3 uSunColor;
        uniform vec3 uHorizon;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          float flow = sin(vUv.y * 34.0 - uTime * 2.0) * 0.5 + 0.5;
          // Cross-ripple breaks the perfect transverse bands that read as
          // road markings from a hillside.
          flow *= 0.72 + 0.28 * sin(vUv.x * 11.0 + vUv.y * 23.0 + uTime * 0.7);
          float glint = pow(clamp(flow, 0.0, 1.0), 7.0) * uDay;
          // Fade the sparkle with view distance so the ribbon does not
          // alias into dashed road markings from a hillside.
          glint *= clamp(1.0 - vFogDepth / 240.0, 0.12, 1.0);
          float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
          vec3 deep = mix(vec3(0.012, 0.05, 0.09), vec3(0.05, 0.21, 0.26), uDay);
          vec3 col = mix(deep, uHorizon * 0.55, 0.38 * uDay);
          col += uSunColor * glint * 0.4;
          gl_FragColor = vec4(col, 0.58 + edge * 0.30);
          #include <fog_fragment>
        }`,
    });
    const water = new THREE.Mesh(wgeo, wmat);
    water.renderOrder = 2;
    water.frustumCulled = false;
    scene.add(water);
    // Southern sea: one reused-material plane. Inland it is hidden below
    // the delta; at the irregular southern shoreline it becomes the coast.
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(mapPreset.size + 500, mapPreset.half * 0.5),
      wmat
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, SEA_LEVEL, mapPreset.half * 0.82);
    sea.renderOrder = 2;
    sea.frustumCulled = false;
    scene.add(sea);
  }
  const bridge = (() => {
    // Plank bridge where the river passes closest to the spawn->relay line.
    const ax0 = WORLD.spawn.x, az0 = WORLD.spawn.z;
    const abx = WORLD.relay.x - ax0, abz = WORLD.relay.z - az0;
    const abLen2 = Math.max(1, abx * abx + abz * abz);
    let bi = 0, bd = Infinity;
    RIVER.samples.forEach((p, i) => {
      const t = clamp(((p.x - ax0) * abx + (p.z - az0) * abz) / abLen2, 0, 1);
      const d = Math.hypot(p.x - (ax0 + abx * t), p.z - (az0 + abz * t));
      if (d < bd) { bd = d; bi = i; }
    });
    const c = RIVER.samples[bi];
    const axis = new THREE.Vector2(WORLD.relay.x - WORLD.spawn.x, WORLD.relay.z - WORLD.spawn.z).normalize();
    const deckY = c.water + 0.55;
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    const group = new THREE.Group();
    const rotY = Math.atan2(axis.x, axis.y);
    for (let s = -12; s <= 12; s += 2) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 1.8), wood);
      plank.position.set(c.x + axis.x * s, deckY + 0.32 * (1 - (s / 13.5) * (s / 13.5)), c.z + axis.y * s);
      plank.rotation.y = rotY;
      group.add(plank);
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 25.5), wood);
      rail.position.set(c.x - axis.y * side * 1.45, deckY + 0.85, c.z + axis.x * side * 1.45);
      rail.rotation.y = rotY;
      group.add(rail);
    }
    scene.add(group);
    return { cx: c.x, cz: c.z, deckY, ax: axis.x, az: axis.y, px: -axis.y, pz: axis.x };
  })();
  let relayDeckY = -Infinity; // set when the relay platform is built below
  function groundHeightWithBridge(x, z) {
    let y = collisionHeight(x, z);
    const dx = x - bridge.cx, dz = z - bridge.cz;
    const along = dx * bridge.ax + dz * bridge.az;
    const across = dx * bridge.px + dz * bridge.pz;
    if (Math.abs(along) < 13.2 && Math.abs(across) < 1.8) y = Math.max(y, bridge.deckY);
    // The relay platform is a solid walkable deck (8.2m radius), not a
    // visual the player sinks through: step/jump onto it like any ledge.
    if (relayDeckY > -Infinity) {
      const rdx = x - WORLD.relay.x, rdz = z - WORLD.relay.z;
      if (rdx * rdx + rdz * rdz < 67.24) y = Math.max(y, relayDeckY);
    }
    return y;
  }
  setRustGroundProvider(groundHeightWithBridge);


  // ----- scatter: rocks + pines (instanced) -----
  const dummy = new THREE.Object3D();
  const blobShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x020403, transparent: true, opacity: 0.34, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const blobShadowGeometry = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  const clearOf = (x, z, r) =>
    Math.hypot(x - WORLD.relay.x, z - WORLD.relay.z) > r &&
    Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) > r &&
    Math.hypot(x - WORLD.warthog.x, z - WORLD.warthog.z) > Math.max(r, 18) &&
    // Keep the whole 460m dirt strip (X 18, Z +18..-442) free of scatter.
    !(Math.abs(x - WORLD.warthog.x) < 13 && z < 18 && z > -448);
  const scatterLimit = mapPreset.rimStart - 12;
  function scatter(count, placer) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const x = (rand() * 2 - 1) * scatterLimit;
      const z = (rand() * 2 - 1) * scatterLimit;
      if (!clearOf(x, z, 15)) continue;
      if (riverInfoInto(x, z, _riverWorldInfo).d < 12.5) continue; // not in the widened river
      const y = terrainSurfaceHeight(x, z);
      if (y < SEA_LEVEL + 0.35) continue; // no trees/rocks standing in the sea
      placer(x, y, z, placed);
      placed++;
    }
    return placed;
  }
  // Same density per m^2 as the original 640m sector (280 trees / 150 rocks
  // inside r<=285m). Instancing + the 60/150m compaction keeps frame cost
  // flat even at ~14k trees on Survival.
  const REFERENCE_AREA = Math.PI * 285 * 285;
  const scatterArea = (scatterLimit * 2) * (scatterLimit * 2);
  const ROCK_N = Math.max(150, Math.round(150 * scatterArea / REFERENCE_AREA));
  const TREE_N = Math.max(280, Math.round(280 * scatterArea / REFERENCE_AREA));
  // Placement transforms are retained once at startup so the culler can
  // compact the same preallocated InstancedMesh buffers without allocating
  // replacement meshes or matrices in the frame loop.
  const rockPlacements = [];
  const treePlacements = [];
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x555a50, roughness: 1, flatShading: true }),
    ROCK_N
  );
  scatter(ROCK_N, (x, y, z, i) => {
    const s = 0.6 + rand() * 2.6;
    const sy = s * (0.55 + rand() * 0.5);
    // Rigid-body seating before the first frame: rest on the highest ground
    // inside the boulder footprint, embedded a third of its height, so it
    // can neither hover on a downhill edge nor sink through a crest.
    const support = groundSupportHeight(x, z, Math.min(1.35, s * 0.58), "max");
    dummy.position.set(x, support + sy * 0.34, z);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(s, sy, s);
    dummy.updateMatrix();
    rockPlacements.push({
      x, y: dummy.position.y, z, groundY: support,
      rx: dummy.rotation.x, ry: dummy.rotation.y, rz: dummy.rotation.z,
      sx: dummy.scale.x, sy: dummy.scale.y, sz: dummy.scale.z,
    });
    rocks.setMatrixAt(i, dummy.matrix);
  });
  scene.add(rocks);

  // ---- Myanmar trees: five unified whole-tree archetypes ----
  // Every archetype is ONE merged, vertex-colored geometry per LOD band.
  // Trunk and canopy can therefore never be culled independently (the old
  // split trunk/canopy submission produced floating leaves beyond 60m).
  // Bands: full detail <=45m, low-poly <=95m, merged trunk+silhouette
  // imposter at 95-150m (past the requested 100m transition zone).
  const canopyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const _partColor = new THREE.Color();
  function coloredPart(geo, hex) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _partColor.setHex(hex);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = _partColor.r; colors[i * 3 + 1] = _partColor.g; colors[i * 3 + 2] = _partColor.b; }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (g !== geo) geo.dispose();
    return g;
  }
  function partCyl(rt, rb, h, seg, x, y, z, hex, rz = 0, rx = 0) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); g.translate(x, y, z);
    return coloredPart(g, hex);
  }
  function partBlob(r, sx, sy, sz, x, y, z, hex) {
    const g = new THREE.IcosahedronGeometry(r, 0); g.scale(sx, sy, sz); g.translate(x, y, z);
    return coloredPart(g, hex);
  }
  // A limb is authored by its two joint centres, never by a guessed
  // centre+rotation. Its caps are extended into both joints, and every
  // fork below also gets a small joint blob, so trunk/branch/root pieces
  // overlap in volume instead of merely touching (or missing) at a point.
  function partLimb(x1, y1, z1, x2, y2, z2, r1, r2, seg, hex) {
    const start = new THREE.Vector3(x1, y1, z1), end = new THREE.Vector3(x2, y2, z2);
    const dir = end.clone().sub(start);
    // Thicker limbs pushed deeper into both joints: at gameplay distance a
    // branch must read as one grown piece of wood, never as segments that
    // merely meet at a point.
    const len = Math.max(0.05, dir.length()) + (r1 + r2) * 0.95;
    const g = new THREE.CylinderGeometry(r2 * 1.22, r1 * 1.18, len, seg);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const mid = start.add(end).multiplyScalar(0.5);
    g.applyMatrix4(new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)));
    return coloredPart(g, hex);
  }
  function partJoint(r, x, y, z, hex) { return partBlob(r * 1.3, 1.08, 0.96, 1.08, x, y, z, hex); }
  function partRoot(rTop, rBottom, hex) {
    // Shaft + a wide flare skirt: the skirt is the visual weld between
    // trunk and soil, spreading past the placement sink on every side.
    const shaft = partCyl(rTop, rBottom, 1.2, 7, 0, -0.08, 0, hex);
    const flareGeo = new THREE.CylinderGeometry(rTop * 0.95, rBottom * 1.6, 0.55, 7);
    flareGeo.translate(0, 0.16, 0);
    return mergeGeometries([shaft, coloredPart(flareGeo, hex)], false);
  }
  function partCone(r, h, seg, x, y, z, hex) {
    const g = new THREE.ConeGeometry(r, h, seg); g.translate(x, y, z);
    return coloredPart(g, hex);
  }
  function partFrond(angle, tilt, len, x, y, z, hex) {
    const g = new THREE.ConeGeometry(0.44, len, 4);
    g.translate(0, len / 2, 0); g.rotateZ(tilt); g.rotateY(angle); g.translate(x, y, z);
    return coloredPart(g, hex);
  }
  function fronds(count, len, x, y, z, hex) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(partFrond((i / count) * Math.PI * 2, 0.94 + (i % 2) * 0.24, len, x, y, z, hex));
    return out;
  }
  const BARK = 0x3a2a1a, BARK_DARK = 0x2a1d12, PALM_BARK = 0x6a5136;
  // Species order: teak, padauk, rain tree, banyan, toddy/coconut palm.
  const treeGeometries = [
    [mergeGeometries([partRoot(0.20,0.35,BARK),partLimb(0,-0.45,0,0.08,3.62,0,0.27,0.15,6,BARK),partJoint(0.20,0.05,2.92,0,BARK),partJoint(0.17,0.08,3.62,0,BARK),partLimb(0.05,2.92,0,1.02,4.18,0.18,0.11,0.055,5,BARK),partLimb(0.06,3.05,0,-0.94,4.28,-0.14,0.11,0.055,5,BARK),partLimb(0.08,3.62,0,0.28,4.62,0.16,0.09,0.05,5,BARK),partBlob(1.52,1.02,1.24,1.02,0,4.68,0,0x356f2c),partBlob(0.98,1,0.95,1,0.92,4.48,0.16,0x477a36),partBlob(0.94,1,0.95,1,-0.86,4.56,-0.12,0x3b6d30),partBlob(0.92,1,1.02,1,0.30,5.58,-0.08,0x477a36)],false),
     mergeGeometries([partRoot(0.21,0.36,BARK),partLimb(0,-0.45,0,0.05,3.88,0,0.28,0.16,5,BARK),partJoint(0.19,0.05,3.88,0,BARK),partBlob(1.62,1,1.18,1,0,4.72,0,0x356f2c)],false),
     mergeGeometries([partRoot(0.18,0.30,BARK_DARK),partLimb(0,-0.45,0,0,3.72,0,0.24,0.14,4,BARK_DARK),partJoint(0.17,0,3.72,0,BARK_DARK),partCone(1.55,3.45,6,0,4.78,0,0x2d5a26)],false)],
    [mergeGeometries([partRoot(0.23,0.40,0x4a3020),partLimb(0,-0.45,0,0.04,3.18,0,0.31,0.18,6,0x4a3020),partJoint(0.22,0.03,2.72,-0.02,0x4a3020),partJoint(0.19,0.04,3.18,0,0x4a3020),partLimb(0.03,2.72,-0.02,1.10,3.88,-0.30,0.12,0.06,5,0x4a3020),partLimb(0.02,2.86,0,-1.08,3.82,0.30,0.12,0.06,5,0x4a3020),partLimb(0.04,3.18,0,0.16,4.05,0.55,0.09,0.05,5,0x4a3020),partBlob(1.58,1.20,0.78,1.08,0,4.22,0,0x3d7031),partBlob(1.02,1.08,0.70,0.98,-1.08,3.92,0.30,0x35632c),partBlob(0.98,1.04,0.69,0.94,1.08,3.98,-0.32,0x4a7a38),partBlob(0.82,1,0.65,1,0.18,4.28,0.58,0x477a36)],false),
     mergeGeometries([partRoot(0.24,0.41,0x4a3020),partLimb(0,-0.45,0,0.03,3.42,0,0.32,0.18,5,0x4a3020),partJoint(0.20,0.03,3.42,0,0x4a3020),partBlob(1.68,1.20,0.72,1.06,0,4.12,0,0x3d7031)],false),
     mergeGeometries([partRoot(0.21,0.35,0x3a2518),partLimb(0,-0.45,0,0,3.28,0,0.27,0.16,4,0x3a2518),partJoint(0.18,0,3.28,0,0x3a2518),partBlob(1.62,1.18,0.68,1.04,0,4.02,0,0x35632c)],false)],
    [mergeGeometries([partRoot(0.25,0.44,BARK),partLimb(0,-0.45,0,0.03,3.05,0.02,0.35,0.20,6,BARK),partJoint(0.24,0.02,2.68,0.01,BARK),partJoint(0.20,0.03,3.05,0.02,BARK),partLimb(0.02,2.68,0.01,1.78,4.22,0.10,0.13,0.065,5,BARK),partLimb(0.02,2.78,0.01,-1.72,4.28,-0.08,0.13,0.065,5,BARK),partLimb(0.03,3.05,0.02,0.18,4.38,1.42,0.11,0.06,5,BARK),partLimb(0.03,3.05,0.02,-0.12,4.42,-1.35,0.11,0.06,5,BARK),partBlob(1.86,1.32,0.50,1.30,0,4.78,0,0x477a36),partBlob(1.18,1.18,0.44,1.05,1.72,4.52,0.12,0x406f35),partBlob(1.14,1.16,0.44,1.02,-1.66,4.58,-0.08,0x4a7a3b),partBlob(1.30,1.22,0.44,1.16,0.22,5.08,-0.16,0x52823e)],false),
     mergeGeometries([partRoot(0.25,0.44,BARK),partLimb(0,-0.45,0,0.02,3.30,0,0.35,0.20,5,BARK),partJoint(0.22,0.02,3.30,0,BARK),partLimb(0.02,3.30,0,1.35,4.35,0,0.11,0.06,5,BARK),partLimb(0.02,3.30,0,-1.30,4.38,0,0.11,0.06,5,BARK),partBlob(1.94,1.30,0.48,1.28,0,4.74,0,0x477a36)],false),
     mergeGeometries([partRoot(0.22,0.38,BARK_DARK),partLimb(0,-0.45,0,0,3.55,0,0.29,0.18,4,BARK_DARK),partJoint(0.20,0,3.55,0,BARK_DARK),partCone(2.48,1.35,7,0,4.38,0,0x3b6d30)],false)],
    [mergeGeometries([partRoot(0.48,0.74,0x33251b),partLimb(0,-0.50,0,0.04,3.02,0,0.57,0.40,7,0x33251b),partJoint(0.42,0.04,3.02,0,0x33251b),partLimb(0.04,3.02,0,1.42,3.88,-0.32,0.18,0.09,5,0x33251b),partLimb(0.04,3.02,0,-1.40,3.84,0.36,0.18,0.09,5,0x33251b),partLimb(0.04,3.02,0,0.18,4.18,0.72,0.15,0.08,5,0x33251b),partJoint(0.11,1.42,3.62,-0.32,0x33251b),partJoint(0.11,-1.40,3.58,0.36,0x33251b),partLimb(1.42,3.62,-0.32,1.34,-0.55,-0.24,0.065,0.085,4,0x33251b),partLimb(-1.40,3.58,0.36,-1.30,-0.55,0.28,0.065,0.085,4,0x33251b),partLimb(0.18,3.92,0.72,0.24,-0.55,1.28,0.06,0.08,4,0x33251b),partLimb(-0.10,3.88,-0.70,-0.24,-0.55,-1.26,0.06,0.08,4,0x33251b),partBlob(1.78,1.24,0.68,1.14,0,4.24,0,0x274f27),partBlob(1.22,1.14,0.62,1,-1.42,3.92,0.36,0x2f5d2e),partBlob(1.18,1.10,0.60,1,1.42,3.96,-0.34,0x356331),partBlob(1.02,1,0.58,1,0.20,4.70,0.70,0x2a552b),partBlob(0.92,1,0.56,1,-0.12,4.42,-0.72,0x24491f)],false),
     mergeGeometries([partRoot(0.50,0.76,0x33251b),partLimb(0,-0.50,0,0.03,3.28,0,0.59,0.42,6,0x33251b),partJoint(0.43,0.03,3.28,0,0x33251b),partLimb(1.25,3.55,0.18,1.18,-0.55,0.12,0.06,0.08,4,0x33251b),partLimb(-1.22,3.55,-0.16,-1.14,-0.55,-0.10,0.06,0.08,4,0x33251b),partBlob(1.88,1.22,0.68,1.12,0,4.14,0,0x274f27)],false),
     mergeGeometries([partRoot(0.45,0.68,0x291c14),partLimb(0,-0.50,0,0,3.22,0,0.51,0.38,5,0x291c14),partJoint(0.39,0,3.22,0,0x291c14),partBlob(1.82,1.20,0.64,1.08,0,4.02,0,0x24491f)],false)],
    [mergeGeometries([partRoot(0.17,0.30,PALM_BARK),partLimb(0,-0.55,0,0.10,1.72,0,0.22,0.20,6,PALM_BARK),partJoint(0.215,0.10,1.72,0,PALM_BARK),partLimb(0.10,1.72,0,0.38,3.30,0.04,0.20,0.17,6,PALM_BARK),partJoint(0.185,0.38,3.30,0.04,PALM_BARK),partLimb(0.38,3.30,0.04,0.78,4.88,0.08,0.17,0.14,6,PALM_BARK),partJoint(0.16,0.78,4.88,0.08,PALM_BARK),partLimb(0.78,4.88,0.08,0.95,5.34,0.10,0.14,0.12,6,PALM_BARK),partJoint(0.29,0.95,5.34,0.10,0x5d6f31),partBlob(0.20,1,1,1,0.80,5.18,0.22,0x77863a),partBlob(0.18,1,1,1,1.06,5.14,-0.04,0x85943d),...fronds(7,2.6,0.95,5.38,0.10,0x52883b)],false),
     mergeGeometries([partRoot(0.16,0.29,PALM_BARK),partLimb(0,-0.55,0,0.24,2.62,0.02,0.21,0.17,5,PALM_BARK),partJoint(0.185,0.24,2.62,0.02,PALM_BARK),partLimb(0.24,2.62,0.02,0.82,5.18,0.08,0.17,0.13,5,PALM_BARK),partJoint(0.27,0.82,5.18,0.08,0x5d6f31),...fronds(5,2.35,0.82,5.22,0.08,0x52883b)],false),
     mergeGeometries([partRoot(0.15,0.27,0x54402a),partLimb(0,-0.55,0,0.78,5.08,0.06,0.19,0.12,4,0x54402a),partJoint(0.25,0.78,5.08,0.06,0x50602d),...fronds(4,2.15,0.78,5.12,0.06,0x477a36)],false)],
  ];
  const TREE_LOD_CAP = 384;
  const treeLodCounts = treeGeometries.map(() => new Int32Array(3));
  const treeLodMeshes = treeGeometries.map((typeGeos) => typeGeos.map((geo) => {
    const mesh = new THREE.InstancedMesh(geo, canopyMaterial, TREE_LOD_CAP);
    mesh.count = 0; scene.add(mesh); return mesh;
  }));
  const treeBlobShadows = new THREE.InstancedMesh(blobShadowGeometry, blobShadowMaterial, 768);
  treeBlobShadows.count = 0;
  treeBlobShadows.renderOrder = 1;
  // Local jungle-floor tufts: three tapered triangles per instance. A
  // deterministic world-space grid around the camera keeps a dense 60m
  // floor available anywhere on the 4km map without storing hundreds of
  // thousands of placements.
  const grassGeometry = (() => {
    const verts = [];
    const normals = [];
    // Knee-height tufts: the old 0.72-0.9m blades at up to 1.6x instance
    // scale read as waist-high black fins across every screenshot.
    const blades = [
      { a: 0.2, h: 0.5, bend: 0.08 },
      { a: 2.25, h: 0.62, bend: 0.11 },
      { a: 4.2, h: 0.55, bend: 0.06 },
    ];
    for (const b of blades) {
      const dx = Math.sin(b.a), dz = Math.cos(b.a);
      const sx = dz * 0.09, sz = -dx * 0.09;
      verts.push(-sx, 0, -sz, sx, 0, sz, dx * b.bend, b.h, dz * b.bend);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return g;
  })();
  // flatShading:false is load-bearing: blade normals point UP so tufts
  // light like the ground. Derivative flat normals turned every blade
  // into a near-black fin (visible in the corrective-round screenshots).
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x406631, roughness: 1, flatShading: false, side: THREE.DoubleSide,
  });
  const grassTufts = new THREE.InstancedMesh(grassGeometry, grassMaterial, 900);
  scatter(TREE_N, (x, y, z) => {
    const s = 0.8 + rand() * 1.15, rot = rand() * Math.PI * 2;
    // Myanmar biome mix instead of an even species carousel: palms and
    // banyans dominate the wet south/coast, teak/padauk the hill forest,
    // and rain trees + toddy palms the central Dry Zone.
    const south = smoothstep(mapPreset.half * 0.18, mapPreset.half * 0.72, z);
    const hill = smoothstep(15, 34, y);
    const dry = 1 - fbm(x * 0.0035 + 8.4, z * 0.0035 - 2.7, 2);
    const r = rand();
    let type;
    if (south > 0.55) type = r < 0.58 ? 4 : r < 0.78 ? 3 : r < 0.92 ? 2 : 0;
    else if (hill > 0.45) type = r < 0.58 ? 0 : r < 0.82 ? 1 : r < 0.94 ? 3 : 2;
    else if (dry > 0.58) type = r < 0.36 ? 2 : r < 0.58 ? 1 : r < 0.78 ? 4 : r < 0.91 ? 3 : 0;
    else type = r < 0.28 ? 0 : r < 0.52 ? 1 : r < 0.72 ? 2 : r < 0.88 ? 3 : 4;
    // Rooted seating: anchor on the LOWEST ground inside the root disc so
    // the downhill side of the flare touches soil on any slope.
    const seatY = groundSupportHeight(x, z, 0.55 * s, "min");
    treePlacements.push({ x, y: seatY, z, s, rot, type });
  });
  scene.add(treeBlobShadows, grassTufts);
  for (const mesh of [rocks, treeBlobShadows, grassTufts, ...treeLodMeshes.flat()]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // contents are per-instance distance-compacted below
  }

  // ----- combat distance bands: 35m ground detail / unified tree LOD -----
  // Rocks, pebbles and grass are submitted inside 35m only. Trees always
  // submit one whole merged mesh: full <=45m, low-poly <=95m, and a merged
  // trunk+silhouette imposter from 95m to the 150m cull. Nothing can leave
  // a canopy floating after its trunk leaves a band.
  const CULL_NEAR_M = 35;
  const CULL_MID_M = 150;
  const CULL_NEAR2 = CULL_NEAR_M * CULL_NEAR_M;
  const CULL_MID2 = CULL_MID_M * CULL_MID_M;
  let scatterCullAcc = Infinity;
  // Cheap local solid-object collision: the scatter refresh (5Hz) copies
  // nearby tree trunks / boulders into a preallocated ring. The player
  // resolver below then costs only a few hundred XZ checks per frame and
  // prevents walking (and putting the camera) through trunks and rocks.
  const MAX_LOCAL_OBSTACLES = 640;
  const localObstacles = new Float32Array(MAX_LOCAL_OBSTACLES * 4); // x,z,radius,topY
  let localObstacleCount = 0;
  let warthog = null; // assigned below once the airframe is built
  function addLocalObstacle(x, z, radius, topY) {
    if (localObstacleCount >= MAX_LOCAL_OBSTACLES) return;
    const o = localObstacleCount++ * 4;
    localObstacles[o] = x; localObstacles[o + 1] = z;
    localObstacles[o + 2] = radius; localObstacles[o + 3] = topY;
  }
  function refreshScatterCulling() {
    localObstacleCount = 0;
    const cx = camera.position.x, cz = camera.position.z;
    if (warthog && !warthog.occupied) {
      const p = warthog.group.position;
      const fx = -Math.sin(warthog.yaw), fz = -Math.cos(warthog.yaw);
      if (Math.hypot(p.x - cx, p.z - cz) < CULL_MID_M) {
        addLocalObstacle(p.x, p.z, 2.1, p.y + 3.2);
        addLocalObstacle(p.x + fx * 4.6, p.z + fz * 4.6, 1.55, p.y + 2.7);
        addLocalObstacle(p.x - fx * 4.6, p.z - fz * 4.6, 1.7, p.y + 3.4);
      }
    }
    let rockN = 0, blobN = 0, grassN = 0, pebbleN = 0, farTrees = 0;
    let treeFullN = 0, treeMidN = 0, treeFarN = 0;
    for (let ti = 0; ti < treeLodCounts.length; ti++) treeLodCounts[ti].fill(0);

    for (const p of rockPlacements) {
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz > CULL_NEAR2) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockN++, dummy.matrix);
      addLocalObstacle(p.x, p.z, Math.max(0.28, Math.max(p.sx, p.sz) * 0.62), p.y + p.sy * 0.9);
    }

    const rustPebbles = getWorkerScatter(0, cx, cz, CULL_NEAR_M) || rustLocalScatter(NOISE_SEED, 0, cx, cz, CULL_NEAR_M);
    if (rustPebbles) {
      debugStats.rustScatterBatches++;
      for (let ri = 0; ri < rustPebbles.length && rockN < ROCK_N; ri += 10) {
        const x = rustPebbles[ri + 1], z = rustPebbles[ri + 2];
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz > CULL_NEAR2 || !clearOf(x, z, 4) || riverInfoInto(x, z, _riverWorldInfo).d < 9.6) continue;
        dummy.position.set(x, groundedBodyY(x, z, Math.min(0.35, rustPebbles[ri + 3] * 0.5), rustPebbles[ri + 4] * 0.34, 0.02), z);
        dummy.rotation.set(rustPebbles[ri + 6], rustPebbles[ri + 7], rustPebbles[ri + 8]);
        dummy.scale.set(rustPebbles[ri + 3], rustPebbles[ri + 4], rustPebbles[ri + 5]);
        dummy.updateMatrix();
        rocks.setMatrixAt(rockN++, dummy.matrix);
        if (Math.max(rustPebbles[ri + 3], rustPebbles[ri + 5]) >= 0.55) {
          addLocalObstacle(x, z, Math.max(rustPebbles[ri + 3], rustPebbles[ri + 5]) * 0.62, dummy.position.y + rustPebbles[ri + 4] * 0.8);
        }
        pebbleN++;
        debugStats.rustScatter++;
      }
    } else {
    // Supplement the sparse global rock field with deterministic small
    // pebbles in a 6m world grid, compacted into the same InstancedMesh.
    {
      const cell = 6;
      const gx0 = Math.floor((cx - CULL_NEAR_M) / cell), gx1 = Math.floor((cx + CULL_NEAR_M) / cell);
      const gz0 = Math.floor((cz - CULL_NEAR_M) / cell), gz1 = Math.floor((cz + CULL_NEAR_M) / cell);
      for (let gx = gx0; gx <= gx1 && rockN < ROCK_N; gx++) {
        for (let gz = gz0; gz <= gz1 && rockN < ROCK_N; gz++) {
          if (hash2(gx * 19 + 401, gz * 23 - 137) < 0.24) continue;
          const x = (gx + 0.18 + hash2(gx * 7 - 31, gz * 11 + 71) * 0.64) * cell;
          const z = (gz + 0.18 + hash2(gx * 13 + 97, gz * 5 - 53) * 0.64) * cell;
          const dx = x - cx, dz = z - cz;
          if (dx * dx + dz * dz > CULL_NEAR2 || !clearOf(x, z, 4) || riverInfoInto(x, z, _riverWorldInfo).d < 9.6) continue;
          const s = 0.13 + hash2(gx * 29 + 3, gz * 31 + 9) * 0.34;
          dummy.position.set(x, groundedBodyY(x, z, s * 0.5, s * 0.62 * 0.34, 0.02), z);
          dummy.rotation.set(hash2(gx, gz) * 3, hash2(gx + 9, gz - 4) * 3, hash2(gx - 6, gz + 8) * 3);
          dummy.scale.set(s, s * 0.62, s * (0.75 + hash2(gx + 2, gz + 2) * 0.45));
          dummy.updateMatrix();
          rocks.setMatrixAt(rockN++, dummy.matrix);
          pebbleN++;
        }
      }
    }
    }

    const rustGrass = getWorkerScatter(1, cx, cz, CULL_NEAR_M) || rustLocalScatter(NOISE_SEED, 1, cx, cz, CULL_NEAR_M);
    if (rustGrass) {
      debugStats.rustScatterBatches++;
      for (let ri = 0; ri < rustGrass.length && grassN < 900; ri += 10) {
        const x = rustGrass[ri + 1], z = rustGrass[ri + 2];
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz > CULL_NEAR2 || !clearOf(x, z, 3) || riverInfoInto(x, z, _riverWorldInfo).d < 9.5) continue;
        dummy.position.set(x, terrainSurfaceHeight(x, z) - 0.06, z); // roots buried, never floating
        dummy.rotation.set(0, rustGrass[ri + 7], 0);
        dummy.scale.setScalar(rustGrass[ri + 3]);
        dummy.updateMatrix();
        grassTufts.setMatrixAt(grassN++, dummy.matrix);
        debugStats.rustScatter++;
      }
    } else {
    // Dense deterministic grass within the 60m detail radius (4m cells).
    {
      const cell = 4;
      const gx0 = Math.floor((cx - CULL_NEAR_M) / cell), gx1 = Math.floor((cx + CULL_NEAR_M) / cell);
      const gz0 = Math.floor((cz - CULL_NEAR_M) / cell), gz1 = Math.floor((cz + CULL_NEAR_M) / cell);
      for (let gx = gx0; gx <= gx1 && grassN < 900; gx++) {
        for (let gz = gz0; gz <= gz1 && grassN < 900; gz++) {
          if (hash2(gx * 37 - 811, gz * 41 + 609) < 0.12) continue;
          const x = (gx + 0.2 + hash2(gx * 17 + 19, gz * 19 - 23) * 0.6) * cell;
          const z = (gz + 0.2 + hash2(gx * 23 - 41, gz * 29 + 13) * 0.6) * cell;
          const dx = x - cx, dz = z - cz;
          if (dx * dx + dz * dz > CULL_NEAR2 || !clearOf(x, z, 3) || riverInfoInto(x, z, _riverWorldInfo).d < 9.5) continue;
          dummy.position.set(x, terrainSurfaceHeight(x, z) - 0.06, z); // roots buried, never floating
          dummy.rotation.set(0, hash2(gx * 43, gz * 47) * Math.PI * 2, 0);
          dummy.scale.setScalar(0.75 + hash2(gx * 53 + 7, gz * 59 - 5) * 0.85);
          dummy.updateMatrix();
          grassTufts.setMatrixAt(grassN++, dummy.matrix);
        }
      }
    }
    }

    for (const p of treePlacements) {
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > CULL_MID2) { farTrees++; continue; }
      const band = d2 <= 2025 ? 0 : (d2 <= 9025 ? 1 : 2); // 45m / 95m squared
      const type = p.type || 0;
      const slot = treeLodCounts[type][band];
      if (slot < TREE_LOD_CAP) {
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.s);
        dummy.position.set(p.x, p.y - 0.28, p.z); // root flare stays buried on downhill edges
        dummy.updateMatrix();
        treeLodMeshes[type][band].setMatrixAt(slot, dummy.matrix);
        treeLodCounts[type][band] = slot + 1;
        if (band === 0) treeFullN++; else if (band === 1) treeMidN++; else treeFarN++;
        if (d2 <= CULL_NEAR2) {
          const trunkR = (type === 3 ? 0.74 : type === 4 ? 0.3 : 0.43) * p.s;
          addLocalObstacle(p.x, p.z, trunkR, p.y + (type === 4 ? 5.2 : 3.4) * p.s);
          if (type === 3) {
            // Banyan aerial roots are solid too — no walking through the
            // root cage. Local root discs rotated into world space.
            const c = Math.cos(p.rot), sn = Math.sin(p.rot);
            const roots = [[1.34, -0.24], [-1.3, 0.28], [0.24, 1.28], [-0.24, -1.26]];
            for (let rI = 0; rI < roots.length; rI++) {
              const lx = roots[rI][0] * p.s, lz = roots[rI][1] * p.s;
              addLocalObstacle(p.x + lx * c + lz * sn, p.z - lx * sn + lz * c, 0.14 * p.s, p.y + 3.5 * p.s);
            }
          }
        }
      }
      if (band < 2 && blobN < 768) {
        dummy.rotation.set(0, p.rot, 0);
        dummy.position.set(p.x, terrainSurfaceHeight(p.x, p.z) + 0.045, p.z);
        dummy.scale.setScalar(2.3 * p.s);
        dummy.updateMatrix();
        treeBlobShadows.setMatrixAt(blobN++, dummy.matrix);
      }
    }

    rocks.count = rockN;
    treeBlobShadows.count = blobN;
    grassTufts.count = grassN;
    rocks.instanceMatrix.needsUpdate = true;
    treeBlobShadows.instanceMatrix.needsUpdate = true;
    grassTufts.instanceMatrix.needsUpdate = true;
    for (let ti = 0; ti < treeLodMeshes.length; ti++) {
      for (let bi = 0; bi < 3; bi++) {
        treeLodMeshes[ti][bi].count = treeLodCounts[ti][bi];
        treeLodMeshes[ti][bi].instanceMatrix.needsUpdate = true;
      }
    }

    // The relay point light has a 90m radius; don't include it in material
    // lighting once the objective is outside the 150m combat band.
    const rdx = WORLD.relay.x - cx, rdz = WORLD.relay.z - cz;
    beaconLight.visible = rdx * rdx + rdz * rdz <= CULL_MID2;
    if (rdx * rdx + rdz * rdz <= CULL_NEAR2) {
      addLocalObstacle(WORLD.relay.x, WORLD.relay.z, 0.55, relayY + 27); // mast
      // Equipment hut + crates on the deck are solid bodies, not ghosts.
      addLocalObstacle(WORLD.relay.x - 3.4, WORLD.relay.z + 2.2, 1.75, relayY + 2.4);
      addLocalObstacle(WORLD.relay.x + 3.6, WORLD.relay.z - 2.6, 1.05, relayY + 2.25);
      addLocalObstacle(WORLD.relay.x + 4.6, WORLD.relay.z - 1.4, 0.78, relayY + 1.85);
      addLocalObstacle(WORLD.relay.x - 4.4, WORLD.relay.z - 3.0, 0.92, relayY + 2.05);
    }
    // A downed drone wreck resting on the ground is a solid obstacle.
    for (let di = 0; di < drones.length; di++) {
      const d = drones[di];
      if (d.alive || !d.landed) continue;
      const dx = d.group.position.x - cx, dz = d.group.position.z - cz;
      if (dx * dx + dz * dz <= CULL_NEAR2) {
        addLocalObstacle(d.group.position.x, d.group.position.z, 0.9, d.group.position.y + 0.75);
      }
    }

    debugStats.cullNear = rockN + treeFullN;
    debugStats.cullMid = treeMidN + treeFarN;
    debugStats.treeLodFull = treeFullN;
    debugStats.treeLodMid = treeMidN;
    debugStats.treeLodFar = treeFarN;
    debugStats.grass = grassN;
    debugStats.pebbles = pebbleN;
    debugStats.blobShadows = blobN;
    debugStats.cullFar = farTrees;
    debugStats.shadowMapsFrozen = renderer.shadowMap.autoUpdate ? 0 : 1;
    debugStats.shadowMapUpdates = 0;
  }

  // ----- relay station -----
  const relay = new THREE.Group();
  // Seat the whole station on the lowest ground inside the platform disc so
  // no edge hovers; the deck top then becomes walkable physics ground.
  const relayY = groundSupportHeight(WORLD.relay.x, WORLD.relay.z, 8.4, "min");
  relayDeckY = relayY + 0.95;
  relay.position.set(WORLD.relay.x, relayY, WORLD.relay.z);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b322a, roughness: 0.55, metalness: 0.55 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x171c16, roughness: 0.7, metalness: 0.35 });
  const addBox = (parent, w, h, d, x, y, z, mat = metal, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
  };
  {
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 9, 1.1, 8), darkMetal);
    platform.position.y = 0.4; relay.add(platform);
    const relayBlob = new THREE.Mesh(blobShadowGeometry, blobShadowMaterial);
    relayBlob.scale.setScalar(10.5); relayBlob.position.y = 0.06; relayBlob.renderOrder = 1;
    relay.add(relayBlob);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 27, 6), metal);
    mast.position.y = 13.5; relay.add(mast);
    addBox(relay, 7.5, 0.18, 0.18, 0, 21, 0);
    addBox(relay, 5.2, 0.16, 0.16, 0, 17.4, 0, metal, Math.PI / 3);
    addBox(relay, 3.4, 0.14, 0.14, 0, 24.2, 0, metal, -Math.PI / 5);
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 18, 8, 0, Math.PI * 2, 0, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x39412f, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide })
    );
    dish.position.set(1.9, 15.2, 0); dish.rotation.z = -1.15; relay.add(dish);
    addBox(relay, 2.6, 1.6, 1.8, -3.4, 1.6, 2.2, darkMetal, 0.4);   // equipment hut
    addBox(relay, 1.5, 1.5, 1.5, 3.6, 1.5, -2.6, metal, 0.2);      // crates
    addBox(relay, 1.1, 1.1, 1.1, 4.6, 1.3, -1.4, darkMetal, -0.3);
    addBox(relay, 1.3, 1.3, 1.3, -4.4, 1.4, -3, metal, 0.9);
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xc8f45c });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), beaconMat);
  beacon.position.y = 27.4; relay.add(beacon);
  const beaconLight = new THREE.PointLight(0xc8f45c, 0, 90, 1.6);
  beaconLight.position.y = 27.4; relay.add(beaconLight);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xc8f45c, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(10.4, 11.1, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.22; relay.add(ring);
  scene.add(relay);

  // ----- A-10-style Warthog + dirt strip -----
  // Real airframe dimensions (16.3m long / 17.5m span) built from the same
  // low-poly primitives as the rest of the world. It is parked facing north
  // at WORLD.warthog (X 18, Z 0); the 460m strip ahead of it is kept clear
  // of scatter above so a full takeoff roll is flyable, not decorative.
  {
    const stripX = WORLD.warthog.x;
    const ribbon = (width, material, dashes = false) => {
      const pos = [], idx = [];
      const z0 = 18, z1 = -442, step = 10;
      const rows = Math.floor((z0 - z1) / step);
      if (!dashes) {
        for (let i = 0; i <= rows; i++) {
          const z = z0 - i * step;
          for (const sx of [-width / 2, width / 2]) {
            pos.push(stripX + sx, terrainSurfaceHeight(stripX + sx, z) + 0.07, z);
          }
          if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
      } else {
        for (let i = 0; i < rows; i += 2) {
          const za = z0 - i * step - 2, zb = za - 4.5, base = pos.length / 3;
          for (const [sx, z] of [[-width / 2, za], [width / 2, za], [-width / 2, zb], [width / 2, zb]]) {
            pos.push(stripX + sx, terrainSurfaceHeight(stripX + sx, z) + 0.1, z);
          }
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = 1; scene.add(mesh); return mesh;
    };
    ribbon(14, new THREE.MeshStandardMaterial({ color: 0x4b4f4c, roughness: 0.96, metalness: 0.02, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    ribbon(0.42, new THREE.MeshBasicMaterial({ color: 0xd8ddd6, side: THREE.DoubleSide }), true);

    const jetGroup = new THREE.Group();
    jetGroup.rotation.order = "YXZ";
    // The player-supplied A-10C pack is the airframe now. Its authoring
    // convention is nose +Z / wheels below origin; the flight model uses
    // forward -Z with the tyre contact patch at local Y=0, so only the
    // inner model gets the 180-degree yaw and the measured +2.36 m offset
    // (main torus tyres: centre Y -1.78, outer radius 0.43 + 0.15).
    const warthogAssembly = createWarthogAssembly("ghost", "standard");
    const warthogModel = warthogAssembly.root;
    warthogModel.rotation.y = Math.PI;
    warthogModel.position.y = 2.36;
    // The supplied viewer's realistic PBR read came from RoomEnvironment.
    // Give only the airframe's standard/physical materials that environment
    // so importing the model does not relight the whole game world.
    const warthogPmrem = new THREE.PMREMGenerator(renderer);
    const warthogEnvTex = warthogPmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    warthogPmrem.dispose();
    const warthogEnvMats = new Set();
    warthogModel.traverse((object) => {
      if (!object.isMesh) return;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of mats) {
        if (mat && mat.isMeshStandardMaterial && !warthogEnvMats.has(mat)) {
          warthogEnvMats.add(mat);
          mat.envMap = warthogEnvTex;
          mat.needsUpdate = true;
        }
      }
    });
    jetGroup.add(warthogModel);
    const gearPart = warthogAssembly.parts.get("gear");
    const gear = gearPart ? gearPart.group : new THREE.Group();
    const jetBlob = new THREE.Mesh(blobShadowGeometry, blobShadowMaterial);
    jetBlob.scale.set(9.6, 1, 9.6); jetBlob.position.y = 0.05; jetBlob.renderOrder = 1; jetGroup.add(jetBlob);
    const warthogModelStats = warthogAssembly.getStats();
    debugStats.warthogModelParts = warthogModelStats.parts;
    debugStats.warthogModelMeshes = warthogModelStats.meshes;
    debugStats.warthogModelTriangles = warthogModelStats.triangles;

    const parkY = groundSupportHeight(WORLD.warthog.x, WORLD.warthog.z, 4.2, "max") + 0.05;
    jetGroup.position.set(WORLD.warthog.x, parkY, WORLD.warthog.z);
    scene.add(jetGroup);
    warthog = {
      group: jetGroup, gear, assembly: warthogAssembly,
      aileronL: null, aileronR: null, elevator: null,
      yaw: 0, pitch: 0, roll: 0, throttle: 0, spool: 0,
      velocity: new THREE.Vector3(), airborne: false, occupied: false,
      gearDown: true, crashed: false, stall: false, aoaDeg: 0,
      speed: 0, verticalSpeed: 0, altitudeAgl: 0, nearDistance: 999,
      canopyOpen: 0, canopyTarget: 0, entryPhase: "parked",
      controlPitch: 0, controlRoll: 0,
      // Light ferry load above the pack's 11,321 kg empty mass, in SI units.
      massKg: 12000, wingAreaM2: WARTHOG_SPECS.wingAreaM2,
      maxThrustN: WARTHOG_SPECS.thrustKN * 1000,
    };
    debugStats.warthogVisible = 1;
  }

  // ----- hostile drones -----
  const droneBodyGeo = new THREE.OctahedronGeometry(1.05, 0);
  const droneEyeGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const droneBodyMat = new THREE.MeshStandardMaterial({ color: 0x23271f, roughness: 0.45, metalness: 0.6, flatShading: true });
  const drones = [];
  const droneAnchors = [[-18, 42], [34, 8], [-52, -28], [12, -66], [58, 58], [-6, 92]];
  for (let i = 0; i < droneAnchors.length; i++) {
    const [ax, az] = droneAnchors[i];
    const group = new THREE.Group();
    const body = new THREE.Mesh(droneBodyGeo, droneBodyMat);
    body.scale.y = 0.62;
    const eye = new THREE.Mesh(droneEyeGeo, new THREE.MeshBasicMaterial({ color: 0xff5040 }));
    eye.position.set(0, -0.28, 0);
    group.add(body, eye);
    scene.add(group);
    const hoverH = 6.5 + rand() * 4;
    // Settled above its anchor before the first frame — never spawned at
    // the origin or inside the terrain waiting for an update to rescue it.
    group.position.set(ax, terrainSurfaceHeight(ax, az) + hoverH, az);
    drones.push({
      group, body, eye, ax, az, cx: ax, cz: az, engaged: false,
      rustLos: true, rustThreat: 0, rustWayX: ax, rustWayZ: az,
      path: null, pathI: 0, pathPending: false, pathId: 0, nextPathAt: 0,
      hoverH,
      phase: rand() * Math.PI * 2,
      orbitR: 4 + rand() * 4.5,
      speed: 0.25 + rand() * 0.3,
      alive: true, landed: false, vy: 0, respawnAt: 0,
    });
  }

  debugStats.groundedObjects = rockPlacements.length + treePlacements.length + drones.length + 1; // + relay
  const rustAiAgents = new Float32Array(Math.max(1, drones.length) * 6);
  let lastRustAiT = -1;

  // ----- impact particles (pooled) -----
  const PMAX = 300;
  const pPos = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX);
  pPos.fill(-9999);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xdfe9b4, size: 0.34, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true,
  }));
  particles.frustumCulled = false;
  scene.add(particles);
  let pCursor = 0;
  function burst(point, n = 14, spread = 3.4) {
    // Impact FX obey the same 150m combat band; hits still register beyond it.
    if (camera.position.distanceToSquared(point) > CULL_MID2) return;
    for (let k = 0; k < n; k++) {
      const i = pCursor; pCursor = (pCursor + 1) % PMAX;
      pPos[i * 3] = point.x; pPos[i * 3 + 1] = point.y; pPos[i * 3 + 2] = point.z;
      pVel[i * 3] = (rand() - 0.5) * spread;
      pVel[i * 3 + 1] = rand() * spread * 0.9 + 0.6;
      pVel[i * 3 + 2] = (rand() - 0.5) * spread;
      pLife[i] = 0.45 + rand() * 0.5;
    }
  }

  // ----- wading splash droplets (pooled, one extra draw call) -----
  const SMAX = 180;
  const sPos = new Float32Array(SMAX * 3), sVel = new Float32Array(SMAX * 3), sLife = new Float32Array(SMAX);
  sPos.fill(-9999);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  const splashPoints = new THREE.Points(sGeo, new THREE.PointsMaterial({
    color: 0xcfeeff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true,
  }));
  splashPoints.frustumCulled = false;
  scene.add(splashPoints);
  let sCursor = 0;
  function splashBurst(x, y, z, n = 10, power = 1) {
    debugStats.splashBursts++;
    for (let k = 0; k < n; k++) {
      const i = sCursor; sCursor = (sCursor + 1) % SMAX;
      sPos[i * 3] = x + (rand() - 0.5) * 0.22;
      sPos[i * 3 + 1] = y;
      sPos[i * 3 + 2] = z + (rand() - 0.5) * 0.22;
      sVel[i * 3] = (rand() - 0.5) * 1.7 * power;
      sVel[i * 3 + 1] = (0.9 + rand() * 1.6) * power;
      sVel[i * 3 + 2] = (rand() - 0.5) * 1.7 * power;
      sLife[i] = 0.28 + rand() * 0.3;
    }
  }

  // ----- tracers (pooled) -----
  const tracers = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.035, 1),
      new THREE.MeshBasicMaterial({ color: 0xeaffb0, transparent: true, opacity: 0 })
    );
    m.visible = false; scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  let tCursor = 0;
  const _mid = new THREE.Vector3();
  function tracer(from, to) {
    const t = tracers[tCursor]; tCursor = (tCursor + 1) % tracers.length;
    const len = from.distanceTo(to);
    t.mesh.position.copy(_mid.addVectors(from, to).multiplyScalar(0.5));
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = 0.06;
  }

  // ----- weapon viewmodel -----
  const gun = new THREE.Group();
  let gunMagazine = null;
  let gunSidearm = null;
  let rifleParts = [];
  {
    // Refined stylized low-poly tactical rifle: tapered receiver and
    // handguard prisms, segmented Picatinny rail, detailed optic,
    // three-segment curved magazine, skeletal stock and small controls.
    // Everything is merged by material (4 meshes + lens/dot), so the
    // detail costs no meaningful draw calls and loads no external model.
    const gm = new THREE.MeshStandardMaterial({ color: 0x3b453e, roughness: 0.34, metalness: 0.58, emissive: 0x0b0f0b, flatShading: true });
    const gm2 = new THREE.MeshStandardMaterial({ color: 0x5d7048, roughness: 0.74, metalness: 0.12, emissive: 0x14200e, flatShading: true });
    const gm3 = new THREE.MeshStandardMaterial({ color: 0xa28259, roughness: 0.55, metalness: 0.3, emissive: 0x201708, flatShading: true });
    const gm4 = new THREE.MeshStandardMaterial({ color: 0x1a201a, roughness: 0.92, metalness: 0.02, emissive: 0x050605, flatShading: true });
    const dark = [], polymer = [], accent = [], rubber = [], magazinePolymer = [], magazineAccent = [];
    const finish = (list, g) => list.push(g.index ? g.toNonIndexed() : g);
    const box = (list, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
      g.translate(x, y, z); finish(list, g);
    };
    // Cylinder along Z: rBack sits toward the shooter (+Z), rFront to muzzle.
    const cyl = (list, rBack, rFront, len, x, y, z, seg = 12) => {
      const g = new THREE.CylinderGeometry(rBack, rFront, len, seg);
      g.rotateX(Math.PI / 2); g.translate(x, y, z); finish(list, g);
    };
    const cylY = (list, r, len, x, y, z, seg = 12) => {
      const g = new THREE.CylinderGeometry(r, r, len, seg);
      g.translate(x, y, z); finish(list, g);
    };
    const cylX = (list, r, len, x, y, z, seg = 10) => {
      const g = new THREE.CylinderGeometry(r, r, len, seg);
      g.rotateZ(Math.PI / 2); g.translate(x, y, z); finish(list, g);
    };
    // Tapered rectangular prism along Z (back face at +len/2).
    const prism = (list, wB, hB, wF, hF, len, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const bw = wB / 2, bh = hB / 2, fw = wF / 2, fh = hF / 2, zb = len / 2, zf = -len / 2;
      const v = [
        [-bw, -bh, zb], [bw, -bh, zb], [bw, bh, zb], [-bw, bh, zb],
        [-fw, -fh, zf], [fw, -fh, zf], [fw, fh, zf], [-fw, fh, zf],
      ];
      const idx = [
        0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6,
        0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
        0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
      ];
      const posArr = [], uvArr = [];
      for (const i of idx) { posArr.push(v[i][0], v[i][1], v[i][2]); uvArr.push(0, 0); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));
      g.computeVertexNormals();
      if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
      g.translate(x, y, z); finish(list, g);
    };

    // --- receiver / handguard (tapered toward the muzzle) ---
    prism(dark, 0.072, 0.105, 0.064, 0.092, 0.58, 0, 0.025, -0.03);
    prism(dark, 0.066, 0.082, 0.06, 0.07, 0.34, 0, -0.045, 0.08);
    prism(dark, 0.078, 0.09, 0.062, 0.074, 0.40, 0, 0.01, -0.39);
    box(dark, 0.062, 0.09, 0.025, 0, 0.01, 0.285); // end plate
    box(dark, 0.064, 0.018, 0.055, 0, 0.055, 0.30); // charging handle
    box(accent, 0.018, 0.014, 0.04, -0.036, 0.055, 0.30);
    box(accent, 0.018, 0.014, 0.04, 0.036, 0.055, 0.30);
    // Segmented top rail teeth.
    for (let i = 0; i < 7; i++) box(dark, 0.038, 0.016, 0.055, 0, 0.096, -0.52 + i * 0.105);
    // Side details: ejection port, bolt lines, selector, mag release.
    box(rubber, 0.008, 0.032, 0.105, 0.038, 0.03, -0.02);
    box(accent, 0.006, 0.012, 0.09, 0.039, 0.052, -0.13);
    box(accent, 0.006, 0.012, 0.09, -0.039, 0.052, -0.13);
    cylX(accent, 0.012, 0.02, 0.042, -0.025, 0.11);
    box(accent, 0.008, 0.014, 0.05, 0.052, -0.035, 0.13, 0.5);
    cylX(dark, 0.011, 0.018, 0.041, -0.045, 0.02);
    // Trigger + guard.
    box(dark, 0.012, 0.055, 0.018, 0, -0.105, 0.055, 0.25);
    {
      const tg = new THREE.TorusGeometry(0.048, 0.007, 6, 14, Math.PI);
      tg.rotateZ(Math.PI); tg.rotateY(Math.PI / 2); tg.translate(0, -0.085, 0.055);
      finish(dark, tg);
    }

    // --- barrel group ---
    cyl(dark, 0.015, 0.015, 0.36, 0, 0.032, -0.66, 10);
    cyl(dark, 0.008, 0.008, 0.28, 0, 0.066, -0.48, 8); // gas tube
    prism(dark, 0.05, 0.07, 0.042, 0.06, 0.07, 0, 0.038, -0.55);
    cyl(dark, 0.027, 0.031, 0.15, 0, 0.032, -0.83, 14); // suppressor body
    cyl(accent, 0.033, 0.033, 0.012, 0, 0.032, -0.775, 14);
    cyl(accent, 0.033, 0.033, 0.012, 0, 0.032, -0.835, 14);
    cyl(accent, 0.033, 0.033, 0.012, 0, 0.032, -0.89, 14);
    cyl(rubber, 0.019, 0.016, 0.018, 0, 0.032, -0.912, 10);

    // --- optic + backup sights ---
    prism(dark, 0.034, 0.045, 0.03, 0.04, 0.09, 0, 0.108, -0.08);
    cyl(dark, 0.03, 0.034, 0.19, 0, 0.148, -0.08, 18);
    cyl(dark, 0.034, 0.041, 0.055, 0, 0.148, -0.198, 18); // objective bell
    cyl(rubber, 0.033, 0.031, 0.028, 0, 0.148, 0.022, 18); // ocular ring
    cylY(dark, 0.016, 0.03, 0, 0.19, -0.08, 12); // elevation turret
    cylX(dark, 0.015, 0.028, 0.04, 0.148, -0.08, 12); // windage turret
    for (const sz of [-0.52, 0.18]) {
      box(dark, 0.009, 0.05, 0.014, -0.016, 0.112, sz);
      box(dark, 0.009, 0.05, 0.014, 0.016, 0.112, sz);
      box(dark, 0.04, 0.008, 0.008, 0, 0.132, sz);
    }

    // --- polymer furniture ---
    prism(polymer, 0.042, 0.055, 0.036, 0.045, 0.20, 0, -0.005, 0.37); // stock adapter
    prism(polymer, 0.066, 0.15, 0.058, 0.125, 0.18, 0, -0.04, 0.47); // buttstock
    prism(polymer, 0.06, 0.032, 0.052, 0.026, 0.15, 0, 0.045, 0.46); // cheek riser
    prism(rubber, 0.07, 0.16, 0.066, 0.15, 0.03, 0, -0.04, 0.565); // buttpad
    box(polymer, 0.055, 0.165, 0.075, 0, -0.145, 0.135, 0.35); // pistol grip
    box(rubber, 0.057, 0.02, 0.082, 0, -0.22, 0.162, 0.35); // grip base
    box(polymer, 0.045, 0.135, 0.055, 0, -0.105, -0.39, -0.18); // angled foregrip
    box(rubber, 0.047, 0.018, 0.057, 0, -0.168, -0.378, -0.18);
    // Three-segment curved magazine + ribs + baseplate. Kept as its own
    // two-material group (same merged geometry technique) so reload can
    // physically drop and re-seat it without extra per-frame allocations.
    box(magazinePolymer, 0.054, 0.15, 0.09, 0, -0.145, -0.07, 0.16);
    box(magazinePolymer, 0.051, 0.14, 0.086, 0, -0.235, -0.045, 0.33);
    box(magazinePolymer, 0.048, 0.125, 0.082, 0, -0.31, -0.01, 0.5);
    box(magazineAccent, 0.056, 0.013, 0.02, 0, -0.18, -0.118, 0.2);
    box(magazineAccent, 0.053, 0.013, 0.02, 0, -0.255, -0.095, 0.35);
    box(magazineAccent, 0.05, 0.013, 0.02, 0, -0.322, -0.062, 0.5);
    box(magazineAccent, 0.056, 0.026, 0.092, 0, -0.362, 0.012, 0.5);
    // Handguard side panels + M-LOK style slots.
    prism(polymer, 0.012, 0.052, 0.012, 0.042, 0.28, -0.041, -0.005, -0.39);
    prism(polymer, 0.012, 0.052, 0.012, 0.042, 0.28, 0.041, -0.005, -0.39);
    for (const sx of [-0.049, 0.049]) {
      for (let i = 0; i < 4; i++) box(rubber, 0.006, 0.014, 0.055, sx, -0.006, -0.26 - i * 0.085);
    }
    box(accent, 0.016, 0.045, 0.18, -0.045, 0.055, -0.36);
    box(accent, 0.016, 0.045, 0.18, 0.045, 0.055, -0.36);
    // QD sling loop on the stock.
    {
      const qd = new THREE.TorusGeometry(0.019, 0.004, 6, 14);
      qd.rotateY(Math.PI / 2); qd.translate(-0.04, -0.01, 0.43);
      finish(dark, qd);
    }

    gun.add(new THREE.Mesh(mergeGeometries(dark, false), gm));
    gun.add(new THREE.Mesh(mergeGeometries(polymer, false), gm2));
    gun.add(new THREE.Mesh(mergeGeometries(accent, false), gm3));
    gun.add(new THREE.Mesh(mergeGeometries(rubber, false), gm4));
    gunMagazine = new THREE.Group();
    gunMagazine.add(new THREE.Mesh(mergeGeometries(magazinePolymer, false), gm2));
    gunMagazine.add(new THREE.Mesh(mergeGeometries(magazineAccent, false), gm3));
    gun.add(gunMagazine);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.019, 18),
      new THREE.MeshStandardMaterial({ color: 0x102f38, roughness: 0.16, metalness: 0.1, emissive: 0x1d5d6b, emissiveIntensity: 0.55 })
    );
    lens.position.set(0, 0.148, 0.037); gun.add(lens);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 5), new THREE.MeshBasicMaterial({ color: 0xb7e34f }));
    dot.position.set(0, 0.148, 0.04); gun.add(dot);

    // Compact VP-70 sidearm viewmodel: thumb-swapping slot 2 must put a
    // visibly different gun in the hands, not reskin the carbine. It shares
    // the rifle's local optic axis (y=0.148) so one ADS alignment serves both.
    rifleParts = gun.children.slice();
    gunSidearm = new THREE.Group();
    {
      const sDark = [], sPolymer = [], sAccent = [], sRubber = [];
      prism(sDark, 0.05, 0.065, 0.044, 0.055, 0.36, 0, 0.085, -0.06); // slide
      prism(sDark, 0.044, 0.05, 0.04, 0.042, 0.30, 0, 0.04, -0.03); // frame
      cyl(sDark, 0.012, 0.012, 0.34, 0, 0.102, -0.13, 10); // barrel
      cyl(sRubber, 0.017, 0.015, 0.026, 0, 0.102, -0.31, 10); // muzzle
      box(sPolymer, 0.05, 0.17, 0.07, 0, -0.075, 0.105, 0.28); // grip
      box(sRubber, 0.055, 0.025, 0.075, 0, -0.165, 0.132, 0.28); // magazine base
      box(sDark, 0.012, 0.045, 0.018, 0, -0.055, -0.01, 0.2); // trigger
      box(sAccent, 0.006, 0.015, 0.08, 0.027, 0.06, -0.05);
      box(sAccent, 0.006, 0.015, 0.08, -0.027, 0.06, -0.05);
      prism(sDark, 0.03, 0.04, 0.026, 0.035, 0.07, 0, 0.12, 0); // optic mount
      cyl(sDark, 0.026, 0.03, 0.14, 0, 0.148, -0.01, 16); // mini optic
      cyl(sRubber, 0.029, 0.027, 0.02, 0, 0.148, 0.065, 16); // ocular ring
      gunSidearm.add(new THREE.Mesh(mergeGeometries(sDark, false), gm));
      gunSidearm.add(new THREE.Mesh(mergeGeometries(sPolymer, false), gm2));
      gunSidearm.add(new THREE.Mesh(mergeGeometries(sAccent, false), gm3));
      gunSidearm.add(new THREE.Mesh(mergeGeometries(sRubber, false), gm4));
      const sLens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 16), lens.material);
      sLens.position.set(0, 0.148, 0.077); gunSidearm.add(sLens);
      const sDot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 5), dot.material);
      sDot.position.set(0, 0.148, 0.08); gunSidearm.add(sDot);
    }
    gunSidearm.visible = false;
    gun.add(gunSidearm);
  }
  gun.position.set(0.205, -0.225, -0.65);
  gun.scale.setScalar(0.82);
  camera.add(gun);
  // Short-range camera-side fill so the receiver/optic facets remain
  // readable when the sun is behind the player; its 1.5m cutoff keeps
  // it from becoming a general scene light.
  const gunFill = new THREE.PointLight(0xe8f0d8, 0.65, 1.5, 2);
  gunFill.position.set(0.18, 0.22, 0.34);
  gun.add(gunFill);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.032, -0.93); gun.add(muzzle);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0 }));
  flash.position.copy(muzzle.position); gun.add(flash);

  // ----- player / camera state -----
  const spawnDir = new THREE.Vector2(WORLD.relay.x - WORLD.spawn.x, WORLD.relay.z - WORLD.spawn.z).normalize();
  const player = {
    pos: new THREE.Vector3(WORLD.spawn.x, terrainSurfaceHeight(WORLD.spawn.x, WORLD.spawn.z) + 1.7, WORLD.spawn.z),
    vel: new THREE.Vector3(), // horizontal velocity (m/s); vy is vertical
    vy: 0,
    grounded: true,
    jumpHeld: false,
    coyote: 0,
    eyeHeight: 1.7,
    crouching: false,
    sliding: false,
    landDip: 0, // camera settle after a hard landing
    swayYaw: 0, swayPitch: 0, swayYawVel: 0, swayPitchVel: 0,
    yaw: Math.atan2(-spawnDir.x, -spawnDir.y),
    pitch: -0.03,
    bobPhase: 0,
    recoil: 0,
    stamina: 100,
    sprintHold: 0,
    sprinting: false,
    sprintEffect: 0, // 0..1 smoothed sprint power (speed + FOV + gun pose)
    boostT: 0, boostRegen: 0, boostPowerFloor: 0, // soda / stimulant / medicine window
    wadeBlend: 0, // 0..1 smoothed wading depth for animation/FOV
    adsBlend: 0, // 0..1 smoothed aim-down-sights blend (zoom + centered gun + scope overlay)
    firePose: 0, // 0..1 forward "charging" gun pose while the trigger is live
    shotsFired: 0,
    lastShotAt: -10, // sim seconds of the most recent shot
    lastSpreadDeg: 0,
    swapT: 0, swapDur: 0.45, // weapon-draw animation after a HUD slot swap
    reloadT: 0,
    reloadDur: 1.55,
    safetyBadFrames: 0,
    lastStep: 0,
    wading: false,
  };
  const physBuf = new Float64Array(32);
  function resetPhysics(x, feetY, z) {
    physBuf.fill(0);
    physBuf[0] = x; physBuf[1] = feetY; physBuf[2] = z;
    physBuf[6] = 1; physBuf[7] = 0.12; physBuf[24] = feetY;
    player.vel.set(0, 0, 0);
    player.vy = 0;
    player.grounded = true;
    player.coyote = 0.12;
    player.sliding = false;
  }
  resetPhysics(player.pos.x, player.pos.y - 1.7, player.pos.z);
  const playerBlobMaterial = blobShadowMaterial.clone();
  const playerBlobShadow = new THREE.Mesh(blobShadowGeometry, playerBlobMaterial);
  playerBlobShadow.scale.setScalar(0.62);
  playerBlobShadow.renderOrder = 1;
  playerBlobShadow.visible = false;
  scene.add(playerBlobShadow);
  let playing = false;
  let transition = null; // { t, fromPos, fromQuat }
  let outOfBounds = false;
  let boundaryDamageAcc = 0;
  function setOutOfBounds(next) {
    if (next === outOfBounds) return;
    outOfBounds = next;
    debugStats.outOfBounds = next ? 1 : 0;
    if (!next) { boundaryDamageAcc = 0; debugStats.boundaryDamage = 0; }
    if (hooks.onOutOfBoundsChange) hooks.onOutOfBoundsChange(next);
  }
  function teleport(x, z, headingDeg = 0) {
    const limit = mapPreset.hardClamp;
    player.pos.set(clamp(x, -limit, limit), 0, clamp(z, -limit, limit));
    player.pos.y = terrainSurfaceHeight(player.pos.x, player.pos.z) + 1.7;
    player.vel.set(0, 0, 0);
    player.vy = 0;
    player.grounded = true;
    player.eyeHeight = 1.7;
    resetPhysics(player.pos.x, player.pos.y - 1.7, player.pos.z);
    player.yaw = -(headingDeg * Math.PI) / 180; // heading = -yaw in this engine
    player.pitch = -0.03;
    transition = null;
    // A teleport is a cut: build the destination neighbourhood
    // synchronously so arrival never shows a hole in the ground.
    const t = chunkIndexAt(player.pos.x, player.pos.z);
    const n = mapPreset.chunksPerAxis;
    for (let ix = Math.max(0, t.ix - 1); ix <= Math.min(n - 1, t.ix + 1); ix++) {
      for (let iz = Math.max(0, t.iz - 1); iz <= Math.min(n - 1, t.iz + 1); iz++) {
        const key = ix + "," + iz;
        const want = desiredSegments(ix, iz, t.ix, t.iz);
        const mesh = terrainChunks.get(key);
        if (!mesh || mesh.userData.seg < want) buildTerrainChunkSync(ix, iz, want);
      }
    }
    if (playing) {
      camera.position.copy(player.pos);
      updateChunkStreaming();
    }
  }
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q1 = new THREE.Quaternion();

  function playerPose(outPos, outQuat) {
    outPos.copy(player.pos);
    camera.rotation.set(player.pitch, player.yaw, 0);
    outQuat.copy(camera.quaternion);
  }

  // ----- Warthog interaction + flight model -----
  // SI-unit point-mass aerodynamics: thrust, lift from angle of attack,
  // induced/parasitic drag, air density with altitude, coordinated banked
  // turns, stall break, rolling resistance, brakes and gear drag. It is a
  // game model, but the airplane has to accelerate, rotate, climb, stall,
  // descend and land for physical reasons — there is no hover/fly-up key.
  const _jetFwd = new THREE.Vector3(), _jetRight = new THREE.Vector3(), _jetUp = new THREE.Vector3();
  const _jetDir = new THREE.Vector3(), _jetForce = new THREE.Vector3();
  function warthogGroundY(x, z) {
    return Math.max(
      terrainSurfaceHeight(x, z),
      terrainSurfaceHeight(x + 3.5, z), terrainSurfaceHeight(x - 3.5, z),
      terrainSurfaceHeight(x, z + 3.5), terrainSurfaceHeight(x, z - 3.5)
    ) + 0.05;
  }
  function animateWarthogCanopy(j, dt) {
    const step = Math.max(0, dt) / 0.85;
    const delta = clamp(j.canopyTarget - j.canopyOpen, -step, step);
    if (delta !== 0) j.canopyOpen = clamp(j.canopyOpen + delta, 0, 1);
    j.assembly.setCanopyOpen(j.canopyOpen);
  }
  function seatPlayerInWarthog() {
    const j = warthog;
    j.occupied = true;
    j.entryPhase = "closing-seated";
    j.canopyTarget = 0;
    j.assembly.setCockpitView(true);
    inputState.ads = false; inputState.adsHeld = false; inputState.firing = false;
    inputState.flightPitchInput = 0; inputState.flightRollInput = 0;
    inputState.flightThrottleTarget = j.throttle;
    player.yaw = j.yaw; player.pitch = j.pitch;
    debugStats.jetMessage = j.crashed ? "AIRFRAME DAMAGED" : "CANOPY CLOSING // ENGINE READY";
  }
  function enterWarthog() {
    if (!warthog || warthog.occupied || warthog.nearDistance > 10.5) return;
    if (warthog.entryPhase === "opening") return;
    warthog.entryPhase = "opening";
    warthog.canopyTarget = 1;
    warthog.assembly.setCockpitView(false);
    debugStats.jetMessage = "OPENING CANOPY";
  }
  function completeWarthogExit() {
    const j = warthog;
    j.occupied = false; j.throttle = 0; j.spool = 0; j.velocity.set(0, 0, 0); j.speed = 0;
    j.entryPhase = "closing";
    j.canopyTarget = 0;
    j.assembly.setCockpitView(false);
    inputState.flightPitchInput = 0; inputState.flightRollInput = 0;
    inputState.flightThrottleTarget = null;
    const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw);
    const rx = Math.cos(j.yaw), rz = -Math.sin(j.yaw);
    const ex = clamp(j.group.position.x + rx * 4.6 + fx * 0.5, -mapPreset.hardClamp + 2, mapPreset.hardClamp - 2);
    const ez = clamp(j.group.position.z + rz * 4.6 + fz * 0.5, -mapPreset.hardClamp + 2, mapPreset.hardClamp - 2);
    const gy = groundHeightWithBridge(ex, ez);
    player.pos.set(ex, gy + player.eyeHeight, ez);
    player.yaw = j.yaw; player.pitch = -0.03;
    resetPhysics(ex, gy, ez);
    debugStats.jetMessage = "ON FOOT";
  }
  function exitWarthog() {
    if (!warthog || !warthog.occupied || warthog.entryPhase === "exit-opening") return;
    if (warthog.entryPhase !== "seated" && warthog.entryPhase !== "closing-seated") return;
    if (warthog.airborne || warthog.speed > 3) {
      debugStats.jetMessage = "LAND AND STOP TO EXIT";
      return;
    }
    warthog.entryPhase = "exit-opening";
    warthog.canopyTarget = 1;
    warthog.throttle = 0;
    warthog.assembly.setCockpitView(false);
    debugStats.jetMessage = "OPENING CANOPY";
  }
  function updateWarthog(dt) {
    if (!warthog) return false;
    const j = warthog, pos = j.group.position;
    j.nearDistance = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
    debugStats.jetNear = !j.occupied && j.nearDistance <= 10.5 ? 1 : 0;
    debugStats.jetDistance = Math.round(j.nearDistance * 10) / 10;
    debugStats.jetOccupied = j.occupied ? 1 : 0;
    if (inputState.jetAction === "enter") enterWarthog();
    else if (inputState.jetAction === "exit") exitWarthog();
    inputState.jetAction = null;
    if (!j.occupied) {
      if (j.entryPhase === "opening" && j.nearDistance > 13) {
        j.entryPhase = "closing"; j.canopyTarget = 0;
      }
      animateWarthogCanopy(j, dt);
      if (j.entryPhase === "opening" && j.canopyOpen >= 0.92) seatPlayerInWarthog();
      else if (j.entryPhase === "closing" && j.canopyOpen <= 0.02) j.entryPhase = "parked";
      j.spool = Math.max(0, j.spool - dt * 0.5);
      j.assembly.setGearDown(j.gearDown);
      debugStats.jetSpeedKmh = 0; debugStats.jetAltitudeM = 0;
      debugStats.jetThrottlePct = Math.round(j.throttle * 100);
      debugStats.jetAirborne = 0; debugStats.jetStall = 0;
      debugStats.jetCanopyPct = Math.round(j.canopyOpen * 100);
      debugStats.jetEntryPhase = j.entryPhase;
      debugStats.aircraftName = "A-10C WARTHOG";
      debugStats.aircraftPitchDeg = Math.round(j.pitch * 180 / Math.PI * 10) / 10;
      debugStats.aircraftRollDeg = Math.round(j.roll * 180 / Math.PI * 10) / 10;
      debugStats.aircraftHeadingDeg = Math.round(((-j.yaw * 180 / Math.PI) % 360 + 360) % 360) % 360;
      debugStats.aircraftVerticalMps = 0;
      if (j.occupied) {
        // Fall through in the same frame after seating so the cockpit
        // camera and HUD appear without a one-frame on-foot flash.
      } else {
        if (!debugStats.jetMessage) debugStats.jetMessage = j.nearDistance <= 10.5 ? "WARTHOG IN REACH" : "WARTHOG PARKED X18 Z0";
        return false;
      }
    }

    animateWarthogCanopy(j, dt);
    if (j.entryPhase === "closing-seated" && j.canopyOpen <= 0.02) j.entryPhase = "seated";
    if (j.entryPhase === "exit-opening") {
      j.throttle = 0;
      j.spool = Math.max(0, j.spool - dt);
      j.group.rotation.set(j.pitch, j.yaw, -j.roll);
      debugStats.jetCanopyPct = Math.round(j.canopyOpen * 100);
      debugStats.jetEntryPhase = j.entryPhase;
      if (j.canopyOpen >= 0.92) { completeWarthogExit(); return false; }
      return true;
    }

    const k = inputState.keys;
    let throttleDelta = clamp(inputState.jetThrottleDelta || 0, -1, 1);
    if (k.has("ShiftLeft") || k.has("ShiftRight")) throttleDelta += 1;
    if (k.has("ControlLeft") || k.has("ControlRight")) throttleDelta -= 1;
    if (inputState.flightThrottleTarget != null && throttleDelta === 0) {
      const target = clamp(inputState.flightThrottleTarget, 0, 1);
      const step = clamp(target - j.throttle, -dt * 1.4, dt * 1.4);
      j.throttle = clamp(j.throttle + step, 0, 1);
    } else {
      j.throttle = clamp(j.throttle + throttleDelta * dt * 0.55, 0, 1);
      if (throttleDelta !== 0) inputState.flightThrottleTarget = j.throttle;
    }
    j.spool += (j.throttle - j.spool) * (1 - Math.exp(-dt / 1.05)); // turbofan lag
    if (j.crashed) { j.throttle = 0; j.spool = Math.max(0, j.spool - dt); }
    let rawPitchInput = clamp((inputState.flightPitchInput || 0) + inputState.moveY + ((k.has("KeyW") || k.has("ArrowUp")) ? 1 : 0) - ((k.has("KeyS") || k.has("ArrowDown")) ? 1 : 0), -1, 1);
    let rawRollInput = clamp((inputState.flightRollInput || 0) + inputState.moveX + ((k.has("KeyD") || k.has("ArrowRight")) ? 1 : 0) - ((k.has("KeyA") || k.has("ArrowLeft")) ? 1 : 0), -1, 1);
    // Cubic-centred, exponentially smoothed stick: tiny thumb sways make
    // gentle corrections, while a full deliberate throw still reaches the
    // complete A-10 control authority already modelled below.
    const shapeStick = (v) => v * (0.62 + 0.38 * v * v);
    const stickBlend = 1 - Math.exp(-dt * 6.5);
    j.controlPitch += (shapeStick(rawPitchInput) - j.controlPitch) * stickBlend;
    j.controlRoll += (shapeStick(rawRollInput) - j.controlRoll) * stickBlend;
    if (Math.abs(rawPitchInput) < 0.02 && Math.abs(j.controlPitch) < 0.012) j.controlPitch = 0;
    if (Math.abs(rawRollInput) < 0.02 && Math.abs(j.controlRoll) < 0.012) j.controlRoll = 0;
    let pitchInput = j.controlPitch;
    let rollInput = j.controlRoll;
    const braking = !!(inputState.jetBrake || k.has("Space"));
    const weightN = j.massKg * 9.81;
    const substeps = clamp(Math.ceil(dt / (1 / 120)), 1, 6), sdt = dt / substeps;
    let liftN = 0, aoa = 0;
    for (let si = 0; si < substeps; si++) {
      let groundY = warthogGroundY(pos.x, pos.z);
      let altitude = pos.y - groundY;
      const onGround = !j.airborne || altitude <= 0.03;
      const speed0 = j.velocity.length();
      const fwdHx = -Math.sin(j.yaw), fwdHz = -Math.cos(j.yaw);
      const rightHx = Math.cos(j.yaw), rightHz = -Math.sin(j.yaw);
      let pitchTarget;
      if (onGround) {
        const frontY = terrainSurfaceHeight(pos.x + fwdHx * 8, pos.z + fwdHz * 8);
        const backY = terrainSurfaceHeight(pos.x - fwdHx * 8, pos.z - fwdHz * 8);
        const slopePitch = Math.atan2(frontY - backY, 16);
        pitchTarget = slopePitch + (speed0 > 48 ? pitchInput * 0.21 : 0);
        pitchTarget = clamp(pitchTarget, -0.08, 0.26);
        const rightY = terrainSurfaceHeight(pos.x + rightHx * 5, pos.z + rightHz * 5);
        const leftY = terrainSurfaceHeight(pos.x - rightHx * 5, pos.z - rightHz * 5);
        const groundRoll = -Math.atan2(rightY - leftY, 10);
        j.roll += (groundRoll - j.roll) * (1 - Math.exp(-sdt * 3.2));
        // Stick roll is only a gentle taxi aid. Nosewheel authority fades
        // out by 18 m/s so holding a fun diagonal sway during the takeoff
        // roll cannot steer the jet off the strip like a car.
        const steeringAuthority = clamp(speed0 / 8, 0, 1) * clamp((18 - speed0) / 8, 0, 1);
        j.yaw -= rollInput * steeringAuthority * 0.32 * sdt;
        if (speed0 > 0.05) {
          const keep = Math.exp(-sdt * 4.5); // tires reject lateral slide
          j.velocity.x = j.velocity.x * keep + fwdHx * speed0 * (1 - keep);
          j.velocity.z = j.velocity.z * keep + fwdHz * speed0 * (1 - keep);
        }
      } else {
        pitchTarget = pitchInput * 0.52;
        if (j.stall) pitchTarget -= 0.18; // nose drops through the stall break
        const rollTarget = rollInput * 1.13; // 65 degrees
        j.roll += (rollTarget - j.roll) * (1 - Math.exp(-sdt * 2.4));
        j.yaw -= (9.81 * Math.tan(j.roll)) / Math.max(speed0, 28) * sdt; // coordinated turn
      }
      j.pitch += (pitchTarget - j.pitch) * (1 - Math.exp(-sdt * (onGround ? 3.0 : 1.85)));
      const cp = Math.cos(j.pitch);
      _jetFwd.set(-Math.sin(j.yaw) * cp, Math.sin(j.pitch), -Math.cos(j.yaw) * cp).normalize();
      _jetRight.set(rightHx, 0, rightHz);
      _jetUp.crossVectors(_jetRight, _jetFwd).normalize();
      const rolledUp = _v3.copy(_jetUp).multiplyScalar(Math.cos(j.roll)).addScaledVector(_jetRight, Math.sin(j.roll)).normalize();
      const speed = j.velocity.length();
      if (speed > 0.05) _jetDir.copy(j.velocity).multiplyScalar(1 / speed); else _jetDir.copy(_jetFwd);
      const flightPath = Math.asin(clamp(_jetDir.y, -1, 1));
      aoa = speed > 1 ? j.pitch - flightPath : 0;
      const aoaDegAbs = Math.abs(aoa * 180 / Math.PI);
      const stallLimit = aoa >= 0 ? 15 : 12;
      const stallFactor = 1 - clamp((aoaDegAbs - stallLimit) / 12, 0, 0.65);
      j.stall = j.airborne && aoaDegAbs > stallLimit && speed > 5;
      const cl = clamp((0.25 + 5.0 * aoa) * stallFactor, -1.0, 1.5);
      const cd = 0.024 + 0.052 * cl * cl + (j.gearDown ? 0.018 : 0) + (j.stall ? 0.075 : 0) + Math.max(0, speed - 165) * 0.0011;
      const rho = 1.225 * Math.exp(-Math.max(0, pos.y) / 8500);
      const q = 0.5 * rho * speed * speed;
      liftN = q * j.wingAreaM2 * cl;
      const dragN = q * j.wingAreaM2 * cd;
      const thrustN = j.crashed ? 0 : j.maxThrustN * j.spool * (0.72 + 0.28 * (rho / 1.225));
      _jetForce.set(0, -weightN, 0)
        .addScaledVector(_jetFwd, thrustN)
        .addScaledVector(rolledUp, liftN)
        .addScaledVector(_jetDir, -dragN);
      if (onGround) {
        const normalN = Math.max(0, weightN - liftN * rolledUp.y - thrustN * _jetFwd.y);
        const mu = braking ? 0.3 : 0.032;
        if (speed > 0.05) {
          _jetForce.addScaledVector(_jetDir, -mu * normalN);
        } else if (j.throttle < 0.16) {
          j.velocity.multiplyScalar(Math.max(0, 1 - sdt * 5)); // parking brake
        }
      }
      j.velocity.addScaledVector(_jetForce, sdt / j.massKg);
      if (j.velocity.lengthSq() > 230 * 230) j.velocity.setLength(230);
      pos.addScaledVector(j.velocity, sdt);
      pos.x = clamp(pos.x, -mapPreset.hardClamp + 25, mapPreset.hardClamp - 25);
      pos.z = clamp(pos.z, -mapPreset.hardClamp + 25, mapPreset.hardClamp - 25);
      groundY = warthogGroundY(pos.x, pos.z);
      if (pos.y <= groundY + 0.02) {
        const impactVy = j.velocity.y;
        if (j.airborne) {
          if (impactVy < -7.5 || Math.abs(j.roll) > 0.49 || j.pitch < -0.18) {
            j.crashed = true; j.throttle = 0;
            j.velocity.multiplyScalar(0.25);
            debugStats.jetMessage = "HARD IMPACT // AIRFRAME DAMAGED";
          }
          j.airborne = false;
        }
        pos.y = groundY;
        if (j.velocity.y < 0) j.velocity.y = 0;
        const liftVertical = liftN * rolledUp.y + thrustN * _jetFwd.y;
        if (!j.crashed && liftVertical > weightN * 1.01 && j.pitch > 0.035 && j.velocity.length() > 42) {
          j.airborne = true; pos.y = groundY + 0.04;
          j.velocity.y = Math.max(j.velocity.y, 1.1);
        }
      } else {
        j.airborne = true;
      }
      j.speed = j.velocity.length();
      j.verticalSpeed = j.velocity.y;
      j.altitudeAgl = Math.max(0, pos.y - groundY);
    }
    if (j.airborne && j.altitudeAgl > 14) j.gearDown = false;
    if (!j.airborne || j.altitudeAgl < 28 || j.speed < 78) j.gearDown = true;
    j.assembly.setGearDown(j.gearDown);
    j.group.rotation.set(j.pitch, j.yaw, -j.roll);
    if (j.elevator) j.elevator.rotation.x = -pitchInput * 0.32;
    if (j.aileronL) j.aileronL.rotation.x = rollInput * 0.3;
    if (j.aileronR) j.aileronR.rotation.x = -rollInput * 0.3;
    j.aoaDeg = Math.round(aoa * 180 / Math.PI * 10) / 10;
    debugStats.jetSpeedKmh = Math.round(j.speed * 3.6);
    debugStats.jetAltitudeM = Math.round(j.altitudeAgl * 10) / 10;
    debugStats.jetThrottlePct = Math.round(j.throttle * 100);
    debugStats.jetSpoolPct = Math.round(j.spool * 100);
    debugStats.jetAirborne = j.airborne ? 1 : 0;
    debugStats.jetStall = j.stall ? 1 : 0;
    debugStats.jetCrashed = j.crashed ? 1 : 0;
    debugStats.jetGearDown = j.gearDown ? 1 : 0;
    debugStats.jetAoaDeg = j.aoaDeg;
    debugStats.jetVerticalMps = Math.round(j.verticalSpeed * 10) / 10;
    debugStats.jetLoadG = Math.round((liftN / weightN) * 100) / 100;
    debugStats.jetCanExit = !j.airborne && j.speed <= 3 ? 1 : 0;
    debugStats.jetCanopyPct = Math.round(j.canopyOpen * 100);
    debugStats.jetEntryPhase = j.entryPhase;
    // Generic aircraft telemetry: future airframes can publish these same
    // fields and reuse the React HUD without Warthog-specific branches.
    debugStats.aircraftName = "A-10C WARTHOG";
    debugStats.aircraftPitchDeg = Math.round(j.pitch * 180 / Math.PI * 10) / 10;
    debugStats.aircraftRollDeg = Math.round(j.roll * 180 / Math.PI * 10) / 10;
    debugStats.aircraftHeadingDeg = Math.round(((-j.yaw * 180 / Math.PI) % 360 + 360) % 360) % 360;
    debugStats.aircraftVerticalMps = debugStats.jetVerticalMps;
    debugStats.aircraftControlPitch = Math.round(j.controlPitch * 100) / 100;
    debugStats.aircraftControlRoll = Math.round(j.controlRoll * 100) / 100;
    debugStats.jetMessage = j.crashed ? "AIRFRAME DAMAGED // STOPPED EXIT ONLY"
      : j.stall ? "STALL // LOWER THE NOSE"
      : j.airborne ? "AIRBORNE"
      : j.speed > 42 ? "ROTATE // PULL GENTLY UP"
      : j.speed > 3 ? "TAKEOFF ROLL" : "ENGINE READY // THR +";
    return true;
  }

  function snapToPlayerCamera() {
    playerPose(_v2, _q1);
    camera.position.copy(_v2);
    camera.quaternion.copy(_q1);
  }
  function setPlaying(next) {
    if (next === playing) return;
    playing = next;
    if (playing) {
      // Hand keyboard focus to the game itself: drop focus from the
      // START/menu button that was just clicked and focus the canvas so
      // WASD/arrows/Space reach the world even inside a preview iframe.
      try {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
      } catch (e) { /* focus is best-effort */ }
      if (!introCinematicPlayed) {
        // Only the first deployment of this app-open sweeps in from the
        // opening orbit. Every Settings/pause resume after that is instant.
        introCinematicPlayed = true;
        transition = { t: 0, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone() };
      } else {
        transition = null;
        snapToPlayerCamera();
      }
    } else {
      transition = null;
      if (introCinematicPlayed) snapToPlayerCamera(); // freeze on the player, never the orbit again
    }
    debugStats.introCinematicPlayed = introCinematicPlayed ? 1 : 0;
  }

  // ----- shooting -----
  const raycaster = new THREE.Raycaster();
  raycaster.far = 700;
  const _muzzleWorld = new THREE.Vector3(), _far = new THREE.Vector3();
  const _center2 = new THREE.Vector2(0, 0);
  const _shootTargets = [];
  function reload() {
    if (!playing || player.reloadT > 0) return;
    player.reloadT = player.reloadDur;
  }
  function shoot() {
    if (!playing) return;
    player.recoil = 1;
    player.shotsFired += 1;
    player.lastShotAt = performance.now() / 1000;
    player.pitch = clamp(player.pitch + 0.0055 * (1 - player.adsBlend * 0.45), -1.35, 1.35);
    flash.material.opacity = 0.95;
    flash.scale.setScalar(0.8 + rand() * 0.7);
    raycaster.setFromCamera(_center2, camera);
    // Hip fire blooms with movement/sprint; ADS collapses the cone to a
    // near-pinpoint so the scope actually buys precision at range.
    const moveBloom = clamp(player.vel.length() / 7.6, 0, 1);
    const hipSpread = (0.006 + moveBloom * 0.013 + player.sprintEffect * 0.006) * (inputState.weaponSpread || 1);
    const spread = THREE.MathUtils.lerp(hipSpread, 0.0006 * (inputState.weaponSpread || 1), player.adsBlend);
    player.lastSpreadDeg = Math.round(spread * (180 / Math.PI) * 100) / 100;
    if (spread > 0.00001) {
      const ang = rand() * Math.PI * 2;
      const rad = spread * Math.sqrt(rand());
      _v2.setFromMatrixColumn(camera.matrixWorld, 0); // camera right
      _v3.setFromMatrixColumn(camera.matrixWorld, 1); // camera up
      raycaster.ray.direction
        .addScaledVector(_v2, Math.cos(ang) * rad)
        .addScaledVector(_v3, Math.sin(ang) * rad)
        .normalize();
    }
    const targets = _shootTargets;
    targets.length = 0;
    for (const mesh of terrainMeshes) if (mesh.visible) targets.push(mesh);
    for (const d of drones) if (d.alive && d.group.visible) targets.push(d.body);
    const hits = raycaster.intersectObjects(targets, false);
    muzzle.getWorldPosition(_muzzleWorld);
    if (hits.length) {
      const hit = hits[0];
      tracer(_muzzleWorld, hit.point);
      const hitTerrain = !!hit.object.userData.isTerrainChunk;
      burst(hit.point, hitTerrain ? 12 : 22, hitTerrain ? 2.6 : 4.2);
      let drone = null;
      for (let di = 0; di < drones.length; di++) {
        if (drones[di].body === hit.object) { drone = drones[di]; break; }
      }
      if (drone && drone.alive) {
        drone.alive = false;
        drone.landed = false;
        drone.vy = 0;
        drone.respawnAt = performance.now() / 1000 + 9;
        drone.eye.material.color.set(0x3a1512);
        if (hooks.onDroneDown) hooks.onDroneDown();
      }
    } else {
      raycaster.ray.at(320, _far);
      tracer(_muzzleWorld, _far);
    }
  }

  // ----- keyboard movement -----
  // Capture-phase listeners + an e.key fallback: movement keys must land
  // even when a menu button/slider still has focus, when an IME or a
  // non-US layout reports an unfamiliar code, or when the game runs in a
  // preview iframe that only just received focus.
  const MOVE_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space", "KeyC", "ControlLeft", "ControlRight"];
  const KEY_FALLBACK = {
    w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD", c: "KeyC",
    arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
    " ": "Space", spacebar: "Space", shift: "ShiftLeft", control: "ControlLeft",
  };
  const normMoveCode = (e) => {
    if (e.code && MOVE_CODES.includes(e.code)) return e.code;
    const byKey = KEY_FALLBACK[(e.key || "").toLowerCase()];
    return byKey || null;
  };
  const onKeyDown = (e) => {
    const code = normMoveCode(e);
    if (!code) return;
    inputState.keys.add(code);
    // While deployed, movement keys belong to the game — not to a still-
    // focused START button (Space/Enter re-click) or page scrolling.
    if (playing && (code === "Space" || code.startsWith("Arrow"))) e.preventDefault();
  };
  const onKeyUp = (e) => {
    const code = normMoveCode(e);
    if (code) inputState.keys.delete(code);
    if (e.code) inputState.keys.delete(e.code);
  };
  const onBlur = () => inputState.keys.clear();
  const onFocus = () => inputState.keys.clear(); // no stuck keys after alt-tab back
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  let resizeTimers = [];
  const applyViewportSize = () => {
    const { w, h } = viewportSize();
    renderDpr = nativePixelRatio(); // re-lock native DPR on every resize/rotation
    renderer.setPixelRatio(renderDpr);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px";
    renderer.domElement.style.height = h + "px";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    debugStats.dpr = renderDpr;
    debugStats.nativeDpr = renderDpr;
    debugStats.cssWidth = w;
    debugStats.cssHeight = h;
  };
  const onResize = () => {
    applyViewportSize();
    // Mobile browsers report intermediate sizes while rotating; re-apply
    // once the rotation settles so the backbuffer and aspect land exact.
    for (const t of resizeTimers) clearTimeout(t);
    resizeTimers = [80, 250, 600].map((ms) => setTimeout(applyViewportSize, ms));
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

  // ----- HUD hook caches -----
  let lastHeading = -1, lastDist = -1, lastBearing = -1;
  function pushHud() {
    camera.getWorldDirection(_v1);
    const heading = Math.round(((Math.atan2(_v1.x, -_v1.z) * 180) / Math.PI + 360) % 360);
    debugStats.heading = heading;
    debugStats.playerX = Math.round(player.pos.x * 10) / 10;
    debugStats.playerY = Math.round(player.pos.y * 10) / 10;
    debugStats.playerZ = Math.round(player.pos.z * 10) / 10;
    debugStats.groundY = Math.round(terrainSurfaceHeight(player.pos.x, player.pos.z) * 10) / 10;
    if (heading !== lastHeading) { lastHeading = heading; if (hooks.onHeading) hooks.onHeading(heading); }
    const dx = WORLD.relay.x - player.pos.x, dz = WORLD.relay.z - player.pos.z;
    const dist = Math.round(Math.hypot(dx, dz));
    const bearing = Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360);
    if (dist !== lastDist || bearing !== lastBearing) {
      lastDist = dist; lastBearing = bearing;
      if (hooks.onObjective) hooks.onObjective(dist, bearing);
    }
  }

  // ----- main loop -----
  const clock = new THREE.Clock();
  let raf = 0, elapsed = 0, frameSerial = 0;

  function resolveLocalObstacles() {
    if (!localObstacleCount) return;
    let px = physBuf[0], pz = physBuf[2];
    const feetY = physBuf[1];
    let vx = physBuf[3], vz = physBuf[5];
    for (let i = 0; i < localObstacleCount; i++) {
      const o = i * 4;
      if (feetY > localObstacles[o + 3] - 0.12) continue;
      const minD = localObstacles[o + 2] + 0.38;
      let dx = px - localObstacles[o], dz = pz - localObstacles[o + 1];
      let d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      if (d2 < 0.000001) { dx = 1; dz = 0; d2 = 1; }
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      px = localObstacles[o] + nx * minD;
      pz = localObstacles[o + 1] + nz * minD;
      const vn = vx * nx + vz * nz;
      if (vn < 0) { vx -= vn * nx; vz -= vn * nz; }
    }
    physBuf[0] = px; physBuf[2] = pz; physBuf[3] = vx; physBuf[5] = vz;
    physBuf[31] = Math.hypot(vx, vz);
  }

  function setCameraFov(target, dt, rate = 7) {
    const next = camera.fov + (target - camera.fov) * Math.min(1, dt * rate);
    if (Math.abs(next - camera.fov) > 0.01) {
      camera.fov = next;
      camera.updateProjectionMatrix();
    }
    debugStats.fov = Math.round(camera.fov * 10) / 10;
  }

  function updatePlayer(dt) {
    if (updateWarthog(dt)) {
      // Cockpit seat: the airframe owns position, velocity and camera until
      // the player lands, stops and exits beside it.
      _v3.set(0, 4.01, -2.95); // pack eye point (model Y 1.65/Z 2.95 + gear offset), 180° yaw
      warthog.group.localToWorld(_v3);
      camera.position.copy(_v3);
      camera.quaternion.copy(warthog.group.quaternion);
      player.pos.copy(_v3);
      player.vel.copy(warthog.velocity);
      player.yaw = warthog.yaw;
      player.pitch = warthog.pitch;
      physBuf[31] = warthog.speed;
      gun.visible = false;
      playerBlobShadow.visible = false;
      setCameraFov(clamp(inputState.fov || 71, 55, 100) + clamp(warthog.speed / 190, 0, 1) * 8, dt, 5);
      inputState.lookDX = 0; inputState.lookDY = 0; inputState.jump = false;
      debugStats.speed = Math.round(warthog.speed * 10) / 10;
      return;
    }
    // Weapon swap queued by tapping a HUD gun slot: lower + draw animation,
    // and ADS always drops while a new gun is coming up.
    if (inputState.weaponSwap) {
      player.swapDur = clamp(inputState.weaponSwap.duration || 0.45, 0.15, 0.8);
      player.swapT = player.swapDur;
      inputState.weaponSwap = null;
      inputState.ads = false;
    }
    if (player.swapT > 0) player.swapT = Math.max(0, player.swapT - dt);
    // ADS / scope blend (touch toggle or right-mouse hold). It drives the
    // zoom FOV, the slower scoped sensitivity, the centered optic and the
    // scope overlay opacity read by the HUD.
    const adsWanted = (inputState.ads || inputState.adsHeld) && player.reloadT <= 0 && player.swapT <= 0;
    const adsRate = adsWanted ? 10 : 12;
    player.adsBlend = clamp(player.adsBlend + clamp((adsWanted ? 1 : 0) - player.adsBlend, -dt * adsRate, dt * adsRate), 0, 1);
    // Firing pose: the instant shots start, the rifle charges FORWARD to
    // point where the bullets go instead of staying canted in the sprint
    // carry. Kept up briefly after the last shot so bursts don't flicker.
    const nowSec = performance.now() / 1000;
    const firingNow = inputState.firing || player.recoil > 0.35 || nowSec - player.lastShotAt < 0.28;
    const firePoseRate = firingNow ? 14 : 7;
    player.firePose = clamp(player.firePose + clamp((firingNow ? 1 : 0) - player.firePose, -dt * firePoseRate, dt * firePoseRate), 0, 1);
    debugStats.adsBlend = Math.round(player.adsBlend * 100) / 100;
    debugStats.adsActive = player.adsBlend > 0.6 ? 1 : 0;
    debugStats.firePose = Math.round(player.firePose * 100) / 100;
    debugStats.firing = firingNow ? 1 : 0;
    debugStats.shotsFired = player.shotsFired;
    debugStats.spreadDeg = player.lastSpreadDeg;
    debugStats.weaponId = inputState.weaponId;
    debugStats.weaponSlot = inputState.activeWeaponSlot;
    debugStats.swapT = Math.round(player.swapT * 100) / 100;
    // look: drag deltas; scoped looking uses the ADS sensitivity so a
    // magnified view can settle precisely on a distant drone.
    const prevYaw = player.yaw, prevPitch = player.pitch;
    const hipLookScale = clamp(inputState.sensitivity || 0.55, 0.15, 1.5);
    const adsLookScale = clamp(inputState.adsSensitivity == null ? 0.26 : inputState.adsSensitivity, 0.05, 1.5);
    const lookScale = THREE.MathUtils.lerp(hipLookScale, adsLookScale, player.adsBlend);
    player.yaw -= inputState.lookDX * 0.0024 * lookScale + inputState.aimX * 1.55 * lookScale * dt;
    player.pitch -= inputState.lookDY * 0.0024 * lookScale + inputState.aimY * 1.15 * lookScale * dt;
    player.pitch = clamp(player.pitch, -1.35, 1.35);
    inputState.lookDX = 0; inputState.lookDY = 0;
    // Viewmodel spring: while the camera is turning, the rifle's target
    // offset trails that angular velocity; a damped spring then returns
    // it to center with a small physical overshoot.
    let yawDelta = player.yaw - prevYaw;
    if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    const yawRate = dt > 0.0001 ? yawDelta / dt : 0;
    const pitchRate = dt > 0.0001 ? (player.pitch - prevPitch) / dt : 0;
    const swayDamping = 1 - player.adsBlend * 0.82; // a braced scope barely sways
    const swayYawTarget = clamp(-yawRate * 0.035, -0.15, 0.15) * swayDamping;
    const swayPitchTarget = clamp(-pitchRate * 0.03, -0.12, 0.12) * swayDamping;
    player.swayYawVel += ((swayYawTarget - player.swayYaw) * 110 - player.swayYawVel * 16) * dt;
    player.swayPitchVel += ((swayPitchTarget - player.swayPitch) * 110 - player.swayPitchVel * 16) * dt;
    player.swayYaw = clamp(player.swayYaw + player.swayYawVel * dt, -0.22, 0.22);
    player.swayPitch = clamp(player.swayPitch + player.swayPitchVel * dt, -0.18, 0.18);
    debugStats.swayYaw = Math.round(player.swayYaw * 1000) / 1000;
    debugStats.swayPitch = Math.round(player.swayPitch * 1000) / 1000;

    // move: keys + move stick
    let mx = inputState.moveX, mz = inputState.moveY;
    const k = inputState.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) mz += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) mz -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const riNow = riverInfoInto(player.pos.x, player.pos.z, _riverPlayerInfo);
    const terrainNow = terrainSurfaceHeight(player.pos.x, player.pos.z);
    const inRiverNow = riNow.d < 9.2 && terrainNow < riNow.water - 0.12;
    const inSeaNow = terrainNow < SEA_LEVEL - 0.12 && player.pos.z > mapPreset.half * 0.68;
    const inWaterNow = inRiverNow || inSeaNow;
    const waterSurfaceNow = inRiverNow ? riNow.water : SEA_LEVEL;
    if (inWaterNow && !player.wading) {
      // Crossing the waterline: one big entry splash (visual + sound).
      splashBurst(player.pos.x, waterSurfaceNow + 0.04, player.pos.z, 16, 1.25);
      if (hooks.onSplash) hooks.onSplash(1);
    }
    player.wading = inWaterNow;
    const crouch = inputState.touchCrouch || k.has("KeyC") || k.has("ControlLeft") || k.has("ControlRight");
    player.crouching = crouch;
    // Consumable stamina boosts (soda / stimulants / medicine queue one of
    // these): instant restore plus a timed regen + sprint-power floor.
    if (inputState.staminaBoost) {
      const b = inputState.staminaBoost;
      inputState.staminaBoost = null;
      player.stamina = clamp(player.stamina + (b.amount || 0), 0, 125);
      player.boostT = Math.max(player.boostT, b.duration || 0);
      player.boostRegen = Math.max(player.boostRegen, b.regen || 0);
      player.boostPowerFloor = Math.max(player.boostPowerFloor, b.powerFloor || 0);
    }
    if (player.boostT > 0) {
      player.boostT = Math.max(0, player.boostT - dt);
      player.stamina = Math.min(125, player.stamina + player.boostRegen * dt);
      if (player.boostT <= 0) { player.boostRegen = 0; player.boostPowerFloor = 0; }
    } else if (player.stamina > 100) {
      player.stamina = Math.max(100, player.stamina - dt * 3); // overcharge bleeds off
    }
    // Sprint is available whenever stamina remains, but its POWER is a
    // smooth function of the tank: full effect down to ~55 stamina, then
    // speed, FOV kick and gun-pose all fade gradually to a jog at empty.
    const forwardPull = !crouch && !inWaterNow && player.adsBlend < 0.25 && mz > 0.88 && Math.abs(mx) < 0.45; // no sprinting through a scope
    player.sprintHold = forwardPull ? player.sprintHold + dt : 0;
    let staminaPower = clamp(player.stamina / 55, 0, 1);
    staminaPower = staminaPower * staminaPower * (3 - 2 * staminaPower);
    if (player.boostT > 0) staminaPower = Math.max(staminaPower, player.boostPowerFloor);
    const sprintTarget = forwardPull && player.stamina > 0.5 ? staminaPower : 0;
    const sprintRate = sprintTarget > player.sprintEffect ? 1.9 : 2.6;
    player.sprintEffect += clamp(sprintTarget - player.sprintEffect, -dt * sprintRate, dt * sprintRate);
    player.sprinting = player.sprintEffect > 0.08;
    if (forwardPull && player.sprintEffect > 0.03) {
      player.stamina = Math.max(0, player.stamina - dt * (6 + 10 * player.sprintEffect));
    } else {
      player.stamina = Math.min(100, player.stamina + dt * (len > 0.1 ? 7 : 13));
    }
    debugStats.stamina = Math.round(clamp(player.stamina, 0, 100));
    debugStats.sprinting = player.sprinting ? 1 : 0;
    debugStats.sprintHold = Math.round(player.sprintHold * 100) / 100;
    debugStats.sprintEffect = Math.round(player.sprintEffect * 100) / 100;
    debugStats.staminaBoostT = Math.round(player.boostT * 10) / 10;
    const maxSpeed = (5.2 + (7.6 - 5.2) * player.sprintEffect) * (inWaterNow ? 0.45 : 1) * (crouch ? 0.5 : 1) * (1 - player.adsBlend * 0.45);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const prevX = player.pos.x, prevZ = player.pos.z;
    const wasGrounded = physBuf[6] > 0.5;
    const wishX = -sin * mz + cos * mx, wishZ = -cos * mz - sin * mx;
    const mud = climateNow.mud;
    const jumpDown = k.has("Space") || inputState.jump;
    inputState.jump = false;
    const jumpPressed = jumpDown && !player.jumpHeld;
    player.jumpHeld = jumpDown;

    // PUBG-style kinematic step shared field-for-field with Rust ABI v4:
    // control-speed friction, projection-capped acceleration, weak air
    // control, slope gravity/sliding, 0.55m step-up and hard-landing
    // momentum damping. Analog walk/jog tops out at 5.2 m/s; sprint is
    // 7.6 m/s and only latches after 1s of near-straight forward input.
    // 120Hz substeps cap one integration move at ~6cm while sprinting.
    // That is the same swept-step discipline a future fast vehicle needs:
    // a slope/step is sampled and resolved instead of tunneled through.
    const physSubsteps = clamp(Math.ceil(dt / (1 / 120)), 1, 4);
    physBuf[8] = dt / physSubsteps;
    physBuf[9] = wishX;
    physBuf[10] = wishZ;
    physBuf[11] = maxSpeed;
    physBuf[12] = jumpPressed ? 1 : 0;
    physBuf[13] = 8.5 * (1 - 0.3 * mud) * (inWaterNow ? 0.65 : 1);
    physBuf[14] = 1.4;
    physBuf[15] = 8.5 * (1 - 0.45 * mud) * (inWaterNow ? 0.7 : 1);
    physBuf[16] = 1.0;
    physBuf[17] = 0.9;
    physBuf[18] = GRAVITY;
    physBuf[19] = 7.7;
    physBuf[20] = 0.55;
    physBuf[21] = 0.55;
    physBuf[22] = 0.74; // ~42deg walkable limit: hills block/slide instead of climb-warping
    physBuf[23] = 0.85;
    let usedRustPhysics = false;
    for (let sub = 0; sub < physSubsteps; sub++) {
      if (sub > 0) physBuf[12] = 0; // jump impulse only on the first substep
      if (rustPhysicsStep(physBuf)) usedRustPhysics = true;
      else stepPhysicsBuffer(physBuf, groundHeightWithBridge);
      resolveLocalObstacles();
    }
    debugStats.physicsCore = usedRustPhysics ? "RUST" : "JS";
    debugStats.accelRate = physBuf[6] > 0.5 ? physBuf[13] : physBuf[14];

    // Swim float: in water deeper than ~1.35m (sea shallows, any residual
    // deep river pool) hold the feet at water-1.35 so the eye stays ~0.35m
    // above the surface instead of walking the seabed with the camera
    // submerged. On the bridge feet are above water, so this never fires.
    const swimWaterY = inRiverNow ? riNow.water : (inSeaNow ? SEA_LEVEL : null);
    if (swimWaterY !== null && physBuf[1] < swimWaterY - 1.35) {
      physBuf[1] = swimWaterY - 1.35;
      if (physBuf[4] < 0) physBuf[4] = 0;
    }

    let feetX = physBuf[0], feetY = physBuf[1], feetZ = physBuf[2];
    const clampLimit = mapPreset.hardClamp;
    feetX = clamp(feetX, -clampLimit, clampLimit);
    feetZ = clamp(feetZ, -clampLimit, clampLimit);
    physBuf[0] = feetX; physBuf[2] = feetZ;
    player.pos.x = feetX;
    player.pos.z = feetZ;
    if (mapPreset.boundaryMode === "damage") {
      const edge = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z));
      const isOob = edge >= mapPreset.half - 0.01;
      setOutOfBounds(isOob);
      if (isOob) {
        debugStats.boundaryDamage = mapPreset.boundaryDamagePerSecond;
        boundaryDamageAcc += dt * mapPreset.boundaryDamagePerSecond;
        const whole = Math.floor(boundaryDamageAcc);
        if (whole > 0) {
          boundaryDamageAcc -= whole;
          if (hooks.onBoundaryDamage) hooks.onBoundaryDamage(whole);
        }
      }
    } else {
      setOutOfBounds(false);
    }
    debugStats.travelM += Math.hypot(player.pos.x - prevX, player.pos.z - prevZ);

    player.vel.set(physBuf[3], physBuf[4], physBuf[5]);
    player.vy = physBuf[4];
    player.grounded = physBuf[6] > 0.5;
    player.coyote = physBuf[7];
    player.sliding = physBuf[29] > 0.5;
    const landedImpact = physBuf[28];
    if (!wasGrounded && player.grounded && landedImpact > 6) {
      player.landDip = Math.min(0.16, landedImpact * 0.012);
      if (hooks.onLand) hooks.onLand();
    }
    const targetEyeHeight = crouch ? 1.25 : 1.7;
    player.eyeHeight += (targetEyeHeight - player.eyeHeight) * Math.min(1, dt * 12);
    player.pos.y = feetY + player.eyeHeight;
    const groundY = groundHeightWithBridge(player.pos.x, player.pos.z);
    playerBlobShadow.visible = true;
    playerBlobShadow.position.set(player.pos.x, groundY + 0.04, player.pos.z);
    const airH = clamp(feetY - groundY, 0, 3);
    playerBlobShadow.scale.setScalar(0.62 * (1 - airH * 0.1));
    playerBlobMaterial.opacity = clamp(climateNow.blobOpacity + 0.02 - airH * 0.055, 0.05, 0.42);
    debugStats.grounded = player.grounded ? 1 : 0;
    debugStats.vy = Math.round(player.vy * 10) / 10;
    debugStats.speed = Math.round(physBuf[31] * 10) / 10;
    const hSpeed = physBuf[31];
    // Actual submersion (feet vs surface) — on the bridge deck this stays
    // false even though the bed below is wet, so no phantom splashing.
    const feetSubmerged = inWaterNow && feetY < waterSurfaceNow - 0.03;
    const wadeDepth = feetSubmerged ? clamp(waterSurfaceNow - feetY, 0, 1.5) : 0;
    player.wadeBlend += ((feetSubmerged ? clamp(wadeDepth / 0.9, 0, 1) : 0) - player.wadeBlend) * Math.min(1, dt * 7);
    debugStats.wadeDepth = Math.round(wadeDepth * 100) / 100;
    const moving = clamp(hSpeed / 5, 0, 1) * (player.grounded ? 1 : 0.2);
    player.bobPhase += dt * hSpeed * 1.18 * (player.grounded ? 1 : 0.25) * (1 - player.wadeBlend * 0.18);
    const stepIdx = Math.floor(player.bobPhase / Math.PI);
    if (moving > 0.15 && stepIdx !== player.lastStep && player.grounded) {
      player.lastStep = stepIdx;
      if (hooks.onStep) {
        hooks.onStep(feetSubmerged, {
          depth: wadeDepth, speed: hSpeed,
          intensity: clamp(0.35 + moving * 0.65 + player.sprintEffect * 0.35, 0, 1.4),
        });
      }
      if (feetSubmerged) {
        const sideSign = stepIdx % 2 ? 0.17 : -0.17;
        splashBurst(
          player.pos.x + (-sin) * 0.5 + cos * sideSign,
          waterSurfaceNow + 0.04,
          player.pos.z + (-cos) * 0.5 - sin * sideSign,
          Math.round(5 + wadeDepth * 7 + hSpeed * 0.8),
          0.65 + wadeDepth * 0.35 + hSpeed * 0.05
        );
      }
    }
    const strideAmp = moving * (1 + player.sprintEffect * 0.55 + player.wadeBlend * 0.35) * (1 - player.adsBlend * 0.8);
    const bobY = Math.sin(player.bobPhase) * 0.055 * strideAmp;
    const bobX = Math.cos(player.bobPhase * 0.5) * 0.03 * strideAmp;
    player.landDip = Math.max(0, player.landDip - dt * 0.5);

    if (transition) {
      transition.t += dt / 0.9;
      const t = smoothstep(0, 1, Math.min(1, transition.t));
      playerPose(_v2, _q1);
      camera.position.lerpVectors(transition.fromPos, _v2, t);
      camera.position.y += bobY * t;
      camera.quaternion.slerpQuaternions(transition.fromQuat, _q1, t);
      if (transition.t >= 1) transition = null;
    } else {
      camera.position.set(player.pos.x + bobX * cos, player.pos.y + bobY - player.landDip, player.pos.z - bobX * sin);
      camera.rotation.set(player.pitch, player.yaw, -mx * 0.014 + Math.sin(player.bobPhase * 0.5) * 0.01 * strideAmp);
    }
    // Final camera-terrain clearance: even if a streamed LOD swap changes
    // a triangle under the player, the near plane must never enter the
    // hill in front of the eye. This lifts only the camera, not physics.
    {
      const fx = -sin, fz = -cos;
      const camGround = Math.max(
        terrainSurfaceHeight(camera.position.x, camera.position.z),
        terrainSurfaceHeight(camera.position.x + fx * 0.55, camera.position.z + fz * 0.55),
        terrainSurfaceHeight(camera.position.x + cos * 0.35, camera.position.z - sin * 0.35),
        terrainSurfaceHeight(camera.position.x - cos * 0.35, camera.position.z + sin * 0.35)
      );
      const targetLift = clamp(camGround + 0.48 - camera.position.y, 0, 0.75);
      player.cameraLift = (player.cameraLift || 0) + (targetLift - (player.cameraLift || 0)) * Math.min(1, dt * 14);
      camera.position.y += player.cameraLift;
    }

    // Dynamic FOV: the Settings base angle plus a sprint stretch that
    // fades WITH stamina, a subtle walk-cycle pulse, a small wading push
    // and a landing punch-in. ADS lerps that whole hip target into the
    // active gun's scoped angle so distant targets grow large enough to
    // hit precisely. All smoothed, never snapping.
    {
      const baseFov = clamp(inputState.fov || 71, 55, 100);
      const hipTargetFov = baseFov
        + player.sprintEffect * 7
        + moving * 1.1
        + Math.sin(player.bobPhase) * 0.5 * moving
        + player.wadeBlend * 1.6
        - player.landDip * 7;
      const adsFactor = clamp(inputState.weaponAdsFactor || 0.58, 0.3, 0.75);
      const adsTargetFov = clamp(baseFov * adsFactor, 24, 55);
      const targetFov = THREE.MathUtils.lerp(hipTargetFov, adsTargetFov, player.adsBlend);
      setCameraFov(targetFov, dt, player.adsBlend > 0.02 ? 12 : 7);
      debugStats.hipFov = Math.round(hipTargetFov * 10) / 10;
      debugStats.adsFov = Math.round(adsTargetFov * 10) / 10;
    }

    // Viewmodel: camera-synced walking bob + spring sway + recoil + reload.
    player.recoil = Math.max(0, player.recoil - dt * 7);
    const rk = player.recoil * player.recoil;
    let reloadDip = 0, reloadTilt = 0, reloadYaw = 0;
    if (player.reloadT > 0) {
      player.reloadT = Math.max(0, player.reloadT - dt);
      const rp = 1 - player.reloadT / player.reloadDur;
      const env = Math.sin(Math.min(1, rp * 1.08) * Math.PI);
      reloadDip = env * 0.11;
      reloadTilt = env * 0.42;
      reloadYaw = env * 0.20;
      if (gunMagazine) {
        let magY = 0, magZ = 0, magRot = 0;
        if (rp < 0.32) {
          const q = rp / 0.32;
          magY = -0.24 * q; magZ = 0.055 * q; magRot = 0.38 * q;
        } else if (rp < 0.52) {
          magY = -0.24; magZ = 0.055; magRot = 0.38;
        } else if (rp < 0.80) {
          const q = (rp - 0.52) / 0.28;
          magY = -0.24 * (1 - q); magZ = 0.055 * (1 - q); magRot = 0.38 * (1 - q);
        }
        gunMagazine.position.set(0, magY, magZ);
        gunMagazine.rotation.set(magRot, 0, 0);
      }
    } else if (gunMagazine) {
      gunMagazine.position.set(0, 0, 0);
      gunMagazine.rotation.set(0, 0, 0);
    }
    debugStats.reloadT = Math.round(player.reloadT * 100) / 100;
    // Locomotion poses layered over the base bob/sway:
    // - sprint: rifle cants across the body and pumps with the stride,
    //   scaling with sprintEffect so it relaxes as stamina fades;
    // - wading: rifle lifts clear of the water with a slower drag sway;
    // - FIRING overrides the cant: the rifle charges forward, level and
    //   shouldered, so the muzzle visibly points where the shots travel;
    // - ADS has final authority and centers the optic on the crosshair.
    const adsPose = player.adsBlend;
    const forwardPose = Math.max(player.firePose, adsPose);
    const sprintPose = player.sprintEffect * (player.grounded ? 1 : 0.3) * (1 - forwardPose);
    const runSwing = Math.sin(player.bobPhase) * sprintPose;
    const wadePose = player.wadeBlend * (1 - forwardPose * 0.75);
    const sidearmActive = inputState.weaponId === "vp70";
    const viewScale = sidearmActive ? 0.95 : inputState.weaponId === "dmr7" ? 0.88 : inputState.weaponId === "r11" ? 0.94 : 0.82;
    const swapP = player.swapT > 0 ? 1 - player.swapT / Math.max(0.01, player.swapDur) : 1;
    const swapDip = player.swapT > 0 ? Math.sin(Math.min(1, swapP) * Math.PI) * 0.16 : 0;
    const swapTilt = player.swapT > 0 ? Math.sin(Math.min(1, swapP) * Math.PI) * 0.35 : 0;
    let gunX = 0.205 + Math.cos(player.bobPhase * 0.5) * 0.012 * moving - player.swayYaw * 0.16 - reloadYaw * 0.10
      + Math.cos(player.bobPhase) * 0.012 * sprintPose - sprintPose * 0.045;
    let gunY = -0.225 + (sidearmActive ? 0.07 : 0) + Math.sin(player.bobPhase) * 0.014 * moving + player.swayPitch * 0.11 - reloadDip
      - Math.abs(runSwing) * 0.022 + runSwing * 0.01 + wadePose * 0.075;
    let gunZ = -0.65 + (sidearmActive ? 0.08 : 0) + rk * 0.07 + reloadDip * 0.35 + sprintPose * 0.045 + wadePose * 0.02;
    let gunRotX = rk * 0.09 + player.swayPitch * 0.85 + reloadTilt + sprintPose * 0.12 - wadePose * 0.1;
    let gunRotY = player.swayYaw + reloadYaw + sprintPose * 0.38 + wadePose * 0.06;
    let gunRotZ = player.swayYaw * 0.35 - reloadTilt * 0.45 - sprintPose * 0.26 + runSwing * 0.05
      + Math.sin(player.bobPhase * 0.7) * 0.02 * wadePose;
    // Forward charge while the trigger is live (sprint-shooting included).
    const chargePose = player.firePose * (1 - adsPose);
    gunX = THREE.MathUtils.lerp(gunX, 0.16, chargePose);
    gunY = THREE.MathUtils.lerp(gunY, sidearmActive ? -0.17 : -0.205, chargePose);
    gunZ = THREE.MathUtils.lerp(gunZ, (sidearmActive ? -0.60 : -0.68) + rk * 0.05, chargePose);
    gunRotX = THREE.MathUtils.lerp(gunRotX, rk * 0.05, chargePose);
    gunRotY = THREE.MathUtils.lerp(gunRotY, 0, chargePose);
    gunRotZ = THREE.MathUtils.lerp(gunRotZ, 0, chargePose);
    // ADS: both viewmodels keep their optic axis at local (0, 0.148), so
    // gun y=-(0.148 * viewScale) puts the lens on the camera center line.
    gunX = THREE.MathUtils.lerp(gunX, 0, adsPose);
    gunY = THREE.MathUtils.lerp(gunY, -0.148 * viewScale, adsPose);
    gunZ = THREE.MathUtils.lerp(gunZ, -0.50 + rk * 0.035, adsPose);
    gunRotX = THREE.MathUtils.lerp(gunRotX, rk * 0.035, adsPose);
    gunRotY = THREE.MathUtils.lerp(gunRotY, 0, adsPose);
    gunRotZ = THREE.MathUtils.lerp(gunRotZ, 0, adsPose);
    // Weapon-swap draw dip rides on top of every other pose.
    gunY -= swapDip;
    gunZ += swapDip * 0.25;
    gunRotX += swapTilt;
    gunRotZ -= swapTilt * 0.4;
    gun.position.set(gunX, gunY, gunZ);
    gun.rotation.set(gunRotX, gunRotY, gunRotZ);
    gun.scale.setScalar(viewScale);
    for (const part of rifleParts) part.visible = !sidearmActive;
    if (gunSidearm) gunSidearm.visible = sidearmActive;
    muzzle.position.set(0, sidearmActive ? 0.102 : 0.032, sidearmActive ? -0.34 : -0.93);
    flash.position.copy(muzzle.position);
    debugStats.viewmodel = sidearmActive ? "sidearm" : "rifle";
    debugStats.gunScale = viewScale;
    // Deep in ADS the HUD scope overlay becomes the sight picture, so the
    // low-poly receiver steps aside instead of blocking the magnified view.
    gun.visible = player.adsBlend < 0.72;
    debugStats.gunX = Math.round(gunX * 1000) / 1000;
    debugStats.gunY = Math.round(gunY * 1000) / 1000;
    debugStats.gunZ = Math.round(gunZ * 1000) / 1000;
    debugStats.gunYawDeg = Math.round(gunRotY * (180 / Math.PI) * 10) / 10;
    debugStats.gunRollDeg = Math.round(gunRotZ * (180 / Math.PI) * 10) / 10;
    debugStats.gunVisible = gun.visible ? 1 : 0;
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 16);
  }

  function updateCinematic(t) {
    // Menu camera orbits the center spawn (relay is far beyond the fog wall).
    const cx = WORLD.spawn.x, cz = WORLD.spawn.z;
    const a = t * 0.045;
    camera.position.set(
      cx + Math.sin(a) * 85,
      terrainHeight(cx, cz) + 30 + Math.sin(t * 0.1) * 5,
      cz + Math.cos(a) * 85
    );
    camera.lookAt(cx, terrainHeight(cx, cz) + 8, cz);
    setCameraFov(clamp(inputState.fov || 71, 55, 100), 1 / 60, 5);
    gun.visible = false;
    playerBlobShadow.visible = false;
  }

  function updateDrones(dt, t) {
    const nowSec = performance.now() / 1000;
    const losM = climateNow.losM;
    const renderRange = Math.max(CULL_MID_M, losM);
    if (playing && t - lastRustAiT >= 0.25) {
      lastRustAiT = t;
      let aiN = 0;
      for (let di2 = 0; di2 < drones.length; di2++) {
        const d = drones[di2];
        const a = t * d.speed + d.phase;
        const x = d.cx + Math.cos(a) * d.orbitR;
        const z = d.cz + Math.sin(a) * d.orbitR;
        const ao = aiN * 6;
        rustAiAgents[ao] = x;
        rustAiAgents[ao + 1] = terrainHeight(x, z) + d.hoverH;
        rustAiAgents[ao + 2] = z;
        rustAiAgents[ao + 3] = d.ax;
        rustAiAgents[ao + 4] = d.az;
        rustAiAgents[ao + 5] = d.hoverH;
        aiN++;
      }
      let usedWorkerAi = false;
      if (workerReady && !workerAiPending) {
        const rec = { count: aiN };
        const id = postWorker("ai", {
          type: "ai", agents: rustAiAgents.subarray(0, aiN * 6), count: aiN,
          px: camera.position.x, py: camera.position.y, pz: camera.position.z, losM,
        }, rec);
        if (id) { workerAiPending = true; usedWorkerAi = true; }
      }
      if (!usedWorkerAi) {
        const aiOut = rustAiBatch(
          NOISE_SEED, rustAiAgents.subarray(0, aiN * 6),
          camera.position.x, camera.position.y, camera.position.z,
          losM, mapPreset.half, mapPreset.rimStart
        );
        if (aiOut) {
          debugStats.rustAiBatches++;
          for (let i = 0; i < aiN; i++) {
            const d = drones[i], o = i * 8;
            d.rustLos = aiOut[o + 1] > 0.5;
            d.rustThreat = aiOut[o + 2];
            d.rustWayX = aiOut[o + 3];
            d.rustWayZ = aiOut[o + 4];
            if (d.rustLos) { d.path = null; d.pathPending = false; }
          }
        }
      }
    }
    let visibleN = 0, engagedN = 0;
    for (let di = 0; di < drones.length; di++) {
      const d = drones[di];
      const adx = d.cx - camera.position.x, adz = d.cz - camera.position.z;
      const approxDist = Math.max(0, Math.sqrt(adx * adx + adz * adz) - d.orbitR);
      if (approxDist > renderRange) {
        d.group.visible = false;
        d.engaged = false;
        if (!d.alive && nowSec >= d.respawnAt) {
          d.alive = true;
          d.landed = false;
          d.vy = 0;
          d.eye.material.color.set(0xffb347);
          d.group.rotation.set(0, 0, 0);
          d.group.position.set(d.cx, terrainSurfaceHeight(d.cx, d.cz) + d.hoverH, d.cz);
        }
        continue;
      }
      d.group.visible = true;
      visibleN++;
      if (d.alive) {
        const a = t * d.speed + d.phase;
        let x = d.cx + Math.cos(a) * d.orbitR;
        let z = d.cz + Math.sin(a) * d.orbitR;
        const actualDist = Math.hypot(x - camera.position.x, z - camera.position.z);
        d.engaged = playing && actualDist <= losM && d.rustLos !== false;
        if (d.engaged) engagedN++;
        d.eye.material.color.set(d.engaged ? 0xff5040 : 0xffb347);
        // Positional updates remain quarter-rate at 60m+, as before.
        // Engagement above is evaluated from the analytic orbit
        // every frame, so LOS changes take effect immediately as the
        // weather value itself lerps.
        if (approxDist > CULL_NEAR_M && ((frameSerial + di) & 3) !== 0) continue;
        const stepDt = approxDist > CULL_NEAR_M ? dt * 4 : dt;
        // Hunt inside a 28m anchor leash while engaged; drift home when
        // weather LOS no longer reaches the player.
        let targetX = d.ax, targetZ = d.az;
        let huntX = targetX, huntZ = targetZ;
        if (playing && actualDist <= losM) {
          const hx = camera.position.x - d.ax, hz = camera.position.z - d.az;
          const hd = Math.hypot(hx, hz) || 1;
          const leash = Math.min(28, hd);
          huntX = d.ax + (hx / hd) * leash;
          huntZ = d.az + (hz / hd) * leash;
          if (d.engaged) { targetX = huntX; targetZ = huntZ; }
        }
        // Blocked by terrain: move through the Rust tactical waypoint,
        // following a coarse Rust A* path when one is available.
        if (playing && actualDist <= losM && d.rustLos === false) {
          huntX = d.rustWayX; huntZ = d.rustWayZ;
          if (!d.path && !d.pathPending && t >= d.nextPathAt) {
            d.nextPathAt = t + 3;
            let sentPath = false;
            if (workerReady) {
              const rec = { drone: di };
              const id = postWorker("path", {
                type: "path", drone: di, sx: d.cx, sz: d.cz, gx: huntX, gz: huntZ,
              }, rec);
              if (id) { d.pathPending = true; d.pathId = id; sentPath = true; }
            }
            if (!sentPath) {
              const p = rustFindPath(NOISE_SEED, d.cx, d.cz, huntX, huntZ, mapPreset.half, mapPreset.rimStart);
              if (p && p.length >= 4) { d.path = p; d.pathI = 2; debugStats.rustPaths++; }
            }
          }
          targetX = huntX; targetZ = huntZ;
        }
        if (d.path) {
          while (d.pathI < d.path.length
            && Math.hypot(d.path[d.pathI] - d.cx, d.path[d.pathI + 1] - d.cz) < 2.5) d.pathI += 2;
          if (d.pathI < d.path.length) { targetX = d.path[d.pathI]; targetZ = d.path[d.pathI + 1]; }
          else d.path = null;
        }
        const mx2 = targetX - d.cx, mz2 = targetZ - d.cz;
        const md = Math.hypot(mx2, mz2);
        if (md > 0.001) {
          const step = Math.min(md, ((d.engaged || d.path) ? 0.9 : 0.55) * stepDt);
          d.cx += (mx2 / md) * step;
          d.cz += (mz2 / md) * step;
          x = d.cx + Math.cos(a) * d.orbitR;
          z = d.cz + Math.sin(a) * d.orbitR;
        }
        const y = terrainSurfaceHeight(x, z) + d.hoverH + Math.sin(t * 1.4 + d.phase) * 0.7;
        d.group.position.set(x, y, z);
        d.group.rotation.y = -a;
        d.body.rotation.y += dt * (d.engaged ? 3.0 : 1.6);
      } else if (nowSec >= d.respawnAt) {
        d.alive = true;
        d.landed = false;
        d.engaged = false;
        d.vy = 0;
        d.eye.material.color.set(0xffb347);
        d.group.rotation.set(0, 0, 0);
        d.group.position.set(d.cx, terrainSurfaceHeight(d.cx, d.cz) + d.hoverH, d.cz);
      } else {
        d.engaged = false;
        // Wreck physics: fall once, then REST on the highest ground inside
        // the body footprint. It can tumble while falling, but it can never
        // sink into or under the terrain, on a slope or anywhere else.
        const restY = groundSupportHeight(d.group.position.x, d.group.position.z, 0.85, "max") + 0.68;
        if (!d.landed) {
          if (d.group.position.y > restY) {
            d.vy += 22 * dt;
            d.group.position.y = Math.max(restY, d.group.position.y - d.vy * dt);
            d.group.rotation.x += dt * 4; d.group.rotation.z += dt * 3;
          }
          if (d.group.position.y <= restY) {
            d.group.position.y = restY;
            d.vy = 0;
            d.landed = true;
            burst(d.group.position, 10, 2);
          }
        } else {
          d.group.position.y = restY;
        }
      }
    }
    debugStats.dronesVisible = visibleN;
    debugStats.dronesEngaged = engagedN;
    debugStats.aiLosM = Math.round(losM * 10) / 10;
  }

  function updateFx(dt) {
    let any = false;
    for (let i = 0; i < PMAX; i++) {
      if (pLife[i] <= 0) continue;
      any = true;
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -9999; continue; }
      pVel[i * 3 + 1] -= 7.5 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      // Debris lands and skids on the rendered ground instead of falling
      // through the world.
      if (pVel[i * 3 + 1] < 0) {
        const gy = terrainSurfaceHeight(pPos[i * 3], pPos[i * 3 + 2]) + 0.03;
        if (pPos[i * 3 + 1] < gy) {
          pPos[i * 3 + 1] = gy;
          pVel[i * 3 + 1] *= -0.22;
          pVel[i * 3] *= 0.6; pVel[i * 3 + 2] *= 0.6;
          if (pLife[i] > 0.18) pLife[i] = 0.18;
        }
      }
    }
    if (any) pGeo.attributes.position.needsUpdate = true;
    let anySplash = false;
    for (let i = 0; i < SMAX; i++) {
      if (sLife[i] <= 0) continue;
      anySplash = true;
      sLife[i] -= dt;
      if (sLife[i] <= 0) { sPos[i * 3 + 1] = -9999; continue; }
      sVel[i * 3 + 1] -= 5.5 * dt;
      sPos[i * 3] += sVel[i * 3] * dt;
      sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
      sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
    }
    if (anySplash) sGeo.attributes.position.needsUpdate = true;
    for (let ti = 0; ti < tracers.length; ti++) {
      const t = tracers[ti];
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.06) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }


  // ----- day/night + macro climate (15-min in-game day; T skips +3h) -----
  const DAY_SECONDS = 600; // 10-minute daylight half
  const NIGHT_SECONDS = 300; // 5-minute night half = 15-minute macro day
  let cycleT = (() => {
    try {
      const p = parseFloat(new URLSearchParams(window.location.search).get("phase"));
      return Number.isFinite(p) ? ((p % 1) + 1) % 1 : 0.1;
    } catch (e) { return 0.1; }
  })();
  const SKY = {
    zenDay: new THREE.Color(0x3f76b8), zenNight: new THREE.Color(0x030510),
    horDay: new THREE.Color(0xb7c8ae), horNight: new THREE.Color(0x0a111c),
    horDusk: new THREE.Color(0xe0914f),
    sunLow: new THREE.Color(0xff9448), sunHigh: new THREE.Color(0xfff2d8),
    hemiDay: new THREE.Color(0xaec6de), hemiNight: new THREE.Color(0x243049),
  };
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const _skyLutOut = new Float32Array(12);
  let ambAcc = 1;
  const _ambience = { water: 0, day: 0, night: 0 };

  // ----- macro seasons + micro weather -----
  // Macro clock: macroDays advances with the sun cycle (900s/day); a
  // season is 10 macro days. Micro clock: an active-time real-seconds
  // accumulator rolls weather every 600s using the current season's
  // weights. Season palette and all weather scalars transition over 30s.
  const SEASON_ORDER = ["dry", "cool", "monsoon"];
  const SEASON_PALETTES = {
    dry: {
      terrain: new THREE.Color(0xd8bd83), canopy: new THREE.Color(0xe4d49a), grass: new THREE.Color(0x8a8142),
      weights: [["sunny", 0.60], ["mist", 0.30], ["monsoon", 0.10]],
    },
    cool: {
      terrain: new THREE.Color(0xffffff), canopy: new THREE.Color(0xffffff), grass: new THREE.Color(0x4a7038),
      weights: [["sunny", 0.50], ["mist", 0.40], ["monsoon", 0.10]],
    },
    monsoon: {
      terrain: new THREE.Color(0x9fd3a8), canopy: new THREE.Color(0xbde8c5), grass: new THREE.Color(0x2e7d3e),
      weights: [["monsoon", 0.50], ["mist", 0.40], ["sunny", 0.10]],
    },
  };
  const WEATHER_TARGETS = {
    sunny: {
      density: 0.0024, tint: new THREE.Color(0xd7e4c2), tintStrength: 0.08,
      sunMul: 1.12, hemiMul: 1.05, exposureMul: 1.05, cloud: 0.05,
      sunGlow: 1, rain: 0, mud: 0, losM: 300, blobOpacity: 0.36,
    },
    mist: {
      density: 0.034, tint: new THREE.Color(0xd8ddd6), tintStrength: 0.72,
      sunMul: 0.38, hemiMul: 0.82, exposureMul: 0.94, cloud: 0.55,
      sunGlow: 0.08, rain: 0, mud: 0, losM: 50, blobOpacity: 0.18,
    },
    monsoon: {
      density: 0.0215, tint: new THREE.Color(0x5f7162), tintStrength: 0.68,
      sunMul: 0.28, hemiMul: 0.68, exposureMul: 0.88, cloud: 0.9,
      sunGlow: 0.03, rain: 1, mud: 1, losM: 80, blobOpacity: 0.16,
    },
  };
  const WEATHER_FIELDS = ["density", "tintStrength", "sunMul", "hemiMul", "exposureMul", "cloud", "sunGlow", "rain", "mud", "losM", "blobOpacity"];
  const WEATHER_CODE = { sunny: 0, mist: 1, monsoon: 2 };
  function normalizeSeason(name) {
    name = String(name || "").toLowerCase();
    return SEASON_ORDER.includes(name) ? name : null;
  }
  function normalizeWeather(name) {
    name = String(name || "").toLowerCase();
    if (name === "rain") return "monsoon";
    return Object.prototype.hasOwnProperty.call(WEATHER_TARGETS, name) ? name : null;
  }
  function snapshotWeather(p) {
    const out = { tint: p.tint.clone() };
    for (const f of WEATHER_FIELDS) out[f] = p[f];
    return out;
  }
  function clonePalette(p) {
    return { terrain: p.terrain.clone(), canopy: p.canopy.clone(), grass: p.grass.clone() };
  }
  function currentMaterialPalette() {
    return {
      terrain: terrainMaterial.color.clone(),
      canopy: canopyMaterial.color.clone(),
      grass: grassMaterial.color.clone(),
    };
  }
  function applySeasonPalette(p) {
    terrainMaterial.color.copy(p.terrain);
    canopyMaterial.color.copy(p.canopy);
    grassMaterial.color.copy(p.grass);
  }

  const dayParam = parseFloat(getSearchParam("day"));
  let macroDays = Number.isFinite(dayParam) ? Math.max(0, dayParam) : 0;
  const requestedSeason = normalizeSeason(getSearchParam("season")) || "cool";
  let seasonOffset = SEASON_ORDER.indexOf(requestedSeason) - Math.floor(macroDays / 10);
  function seasonForMacroDay(days) {
    const idx = ((seasonOffset + Math.floor(days / 10)) % 3 + 3) % 3;
    return SEASON_ORDER[idx];
  }
  let seasonName = seasonForMacroDay(macroDays);
  let seasonFrom = clonePalette(SEASON_PALETTES[seasonName]);
  let seasonTo = clonePalette(SEASON_PALETTES[seasonName]);
  let seasonBlend = 1;
  applySeasonPalette(seasonTo);
  function setSeason(name, adjustOffset = true) {
    name = normalizeSeason(name);
    if (!name || name === seasonName && seasonBlend >= 1) return;
    seasonFrom = currentMaterialPalette();
    seasonTo = clonePalette(SEASON_PALETTES[name]);
    seasonName = name;
    seasonBlend = 0;
    if (adjustOffset) seasonOffset = SEASON_ORDER.indexOf(name) - Math.floor(macroDays / 10);
  }

  let weatherName = "sunny";
  let weatherFromName = "sunny";
  let weatherFrom = snapshotWeather(WEATHER_TARGETS.sunny);
  let weatherTo = snapshotWeather(WEATHER_TARGETS.sunny);
  let weatherBlend = 1;
  // Shared live parameters consumed by movement, drones and sky. Defined
  // before the first rendered frame; earlier function bodies only read it
  // once the frame loop starts.
  const climateNow = snapshotWeather(WEATHER_TARGETS.sunny);
  let debugSeasonName = "", debugWeatherName = "", debugSeasonTintHex = -1;
  function setWeather(name) {
    name = normalizeWeather(name);
    if (!name || name === weatherName && weatherBlend >= 1) return;
    weatherFrom = snapshotWeather(climateNow);
    weatherFromName = weatherName;
    weatherTo = snapshotWeather(WEATHER_TARGETS[name]);
    weatherName = name;
    weatherBlend = 0;
  }
  function rollWeather() {
    const weights = SEASON_PALETTES[seasonName].weights;
    let r = rand();
    debugStats.weatherRolls++;
    for (const [name, w] of weights) {
      if (r < w) { setWeather(name); return; }
      r -= w;
    }
    setWeather(weights[weights.length - 1][0]);
  }
  let weatherRollAcc = 0;
  let lastClimateReal = performance.now() / 1000;
  const initialWeather = normalizeWeather(getSearchParam("weather")) || "sunny";
  if (initialWeather !== "sunny") setWeather(initialWeather);

  // Screen-space rain: one fullscreen shader quad, no particle system.
  const rainUniforms = {
    uTime: { value: 0 }, uIntensity: { value: 0 }, uAspect: { value: camera.aspect || 1 },
  };
  const rainOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: rainUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uAspect;
        varying vec2 vUv;
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        void main() {
          vec2 uv = vUv;
          vec2 rainUv = vec2(uv.x * uAspect, uv.y);
          // Slanted falling streak cells.
          vec2 gv = vec2(rainUv.x * 95.0 + rainUv.y * 18.0 + uTime * 9.0,
                         rainUv.y * 7.0 + uTime * 2.8);
          vec2 id = floor(gv);
          vec2 f = fract(gv);
          float rnd = hash21(id);
          float x = 0.15 + 0.7 * rnd;
          float streak = smoothstep(0.08, 0.0, abs(f.x - x))
            * smoothstep(0.0, 0.25, f.y) * smoothstep(1.0, 0.55, f.y)
            * step(0.45, rnd);
          // Slow visor droplets crawling down in hashed columns.
          vec2 dg = vec2(rainUv.x * 30.0, rainUv.y * 18.0);
          vec2 did = floor(dg);
          float speed = 0.12 + hash21(did) * 0.35;
          vec2 center = vec2(0.25 + hash21(did + 4.0) * 0.5,
                             fract(hash21(did + 9.0) - uTime * speed));
          float drop = smoothstep(0.22, 0.03, distance(fract(dg), center))
            * step(0.58, hash21(did + 2.0));
          float edgeWet = smoothstep(0.42, 1.0, length(uv - 0.5)) * 0.06;
          float a = (streak * 0.28 + drop * 0.18 + edgeWet) * uIntensity;
          gl_FragColor = vec4(vec3(0.78, 0.86, 0.88), a);
        }`,
    })
  );
  rainOverlay.frustumCulled = false;
  rainOverlay.renderOrder = 999;
  rainOverlay.visible = false;
  scene.add(rainOverlay);

  let safetyAcc = 0;
  function recordSafetyReport(code, x, y, z, groundY) {
    debugStats.safetyReports++;
    debugStats.safetyLastCode = code;
    const rustReport = rustSafetyReport(code, x, y, z, groundY, elapsed);
    debugStats.safetyRustReports = rustReport;
    const reports = worldControl.safetyReports;
    reports.push({ code, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 10) / 10, groundY: Math.round(groundY * 10) / 10, t: Math.round(elapsed * 10) / 10, core: rustCore.ready ? "RUST" : "JS", rustReport });
    if (reports.length > 24) reports.shift();
    if (hooks.onSafetyReport) hooks.onSafetyReport(reports[reports.length - 1]);
  }
  function isSafeGround(x, z) {
    const limit = mapPreset.hardClamp - 2;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > limit || Math.abs(z) > limit) return false;
    const h = terrainSurfaceHeight(x, z);
    const gx = (terrainSurfaceHeight(x + 1, z) - terrainSurfaceHeight(x - 1, z)) * 0.5;
    const gz = (terrainSurfaceHeight(x, z + 1) - terrainSurfaceHeight(x, z - 1)) * 0.5;
    const normalY = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    if (normalY < 0.72 || h < SEA_LEVEL + 0.2) return false;
    const ri = riverInfoInto(x, z, _riverWorldInfo);
    if (ri.d < 14 && h < ri.water + 0.05) return false;
    return true;
  }
  function findSafePlace(x, z) {
    if (isSafeGround(x, z)) return { x, z, y: groundHeightWithBridge(x, z) };
    const radii = [3, 6, 10, 16, 24, 36, 54, 80];
    for (let r = 0; r < radii.length; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const sx = clamp(x + Math.cos(ang) * radii[r], -mapPreset.hardClamp + 2, mapPreset.hardClamp - 2);
        const sz = clamp(z + Math.sin(ang) * radii[r], -mapPreset.hardClamp + 2, mapPreset.hardClamp - 2);
        if (isSafeGround(sx, sz)) return { x: sx, z: sz, y: groundHeightWithBridge(sx, sz) };
      }
    }
    return { x: WORLD.spawn.x, z: WORLD.spawn.z, y: terrainSurfaceHeight(WORLD.spawn.x, WORLD.spawn.z) };
  }
  function rescuePlayer(code, groundY) {
    const feetY = physBuf[1];
    const safe = findSafePlace(player.pos.x, player.pos.z);
    recordSafetyReport(code, player.pos.x, feetY, player.pos.z, groundY);
    debugStats.safetyRescues++;
    player.pos.x = safe.x;
    player.pos.z = safe.z;
    player.pos.y = safe.y + player.eyeHeight;
    player.safetyBadFrames = 0;
    transition = null;
    resetPhysics(safe.x, safe.y, safe.z);
  }
  function safetySweep(dt) {
    if (playing && !(warthog && warthog.occupied)) {
      const feetY = physBuf[1];
      const groundY = groundHeightWithBridge(player.pos.x, player.pos.z);
      const bad = !Number.isFinite(feetY) || !Number.isFinite(player.pos.x) || !Number.isFinite(player.pos.z)
        || feetY < groundY - 0.38 || feetY > groundY + 260;
      if (bad) {
        player.safetyBadFrames++;
        if (player.safetyBadFrames >= 2) rescuePlayer(1, groundY);
      } else {
        player.safetyBadFrames = 0;
      }
    }
    safetyAcc += dt;
    if (safetyAcc < 0.25) return;
    safetyAcc = 0;
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i];
      const gy = terrainSurfaceHeight(d.group.position.x, d.group.position.z);
      if (d.alive) {
        if (!Number.isFinite(d.group.position.y) || d.group.position.y < gy + 1.0) {
          recordSafetyReport(2, d.group.position.x, d.group.position.y, d.group.position.z, gy);
          debugStats.safetyRescues++;
          d.cx = d.ax; d.cz = d.az; d.vy = 0;
          d.group.position.set(d.ax, terrainSurfaceHeight(d.ax, d.az) + d.hoverH, d.az);
        }
      } else if (d.landed) {
        // A wreck must stay resting ON the ground, never under it.
        const restY = groundSupportHeight(d.group.position.x, d.group.position.z, 0.85, "max") + 0.68;
        if (!Number.isFinite(d.group.position.y) || d.group.position.y < restY - 0.05) {
          d.group.position.y = restY;
          d.vy = 0;
          debugStats.groundingCorrections++;
        }
      }
    }
  }

  function updateClimate(dt) {
    const computedSeason = seasonForMacroDay(macroDays);
    if (computedSeason !== seasonName) setSeason(computedSeason, false);
    seasonBlend = Math.min(1, seasonBlend + dt / 30);
    const sb = seasonBlend;
    // The terrain material color multiplies every baked terrain vertex
    // color in-shader; canopy/grass material colors lerp in parallel.
    terrainMaterial.color.lerpColors(seasonFrom.terrain, seasonTo.terrain, sb);
    canopyMaterial.color.lerpColors(seasonFrom.canopy, seasonTo.canopy, sb);
    grassMaterial.color.lerpColors(seasonFrom.grass, seasonTo.grass, sb);

    weatherBlend = Math.min(1, weatherBlend + dt / 30);
    const wb = weatherBlend;
    for (let fi = 0; fi < WEATHER_FIELDS.length; fi++) {
      const f = WEATHER_FIELDS[fi];
      climateNow[f] = lerp(weatherFrom[f], weatherTo[f], wb);
    }
    climateNow.tint.lerpColors(weatherFrom.tint, weatherTo.tint, wb);
    blobShadowMaterial.opacity = climateNow.blobOpacity;

    const nowReal = performance.now() / 1000;
    const realDt = Math.min(1, Math.max(0, nowReal - lastClimateReal));
    lastClimateReal = nowReal;
    weatherRollAcc += realDt;
    if (weatherRollAcc >= 600) {
      weatherRollAcc -= 600;
      rollWeather();
    }

    if (seasonName !== debugSeasonName) {
      debugSeasonName = seasonName;
      debugStats.season = seasonName.toUpperCase();
    }
    if (weatherName !== debugWeatherName) {
      debugWeatherName = weatherName;
      debugStats.weather = weatherName.toUpperCase();
    }
    debugStats.macroDay = Math.round(macroDays * 100) / 100;
    debugStats.seasonDay = Math.floor(macroDays % 10) + 1;
    debugStats.seasonBlend = Math.round(seasonBlend * 100) / 100;
    debugStats.weatherBlend = Math.round(weatherBlend * 100) / 100;
    debugStats.weatherRollS = Math.max(0, Math.round(600 - weatherRollAcc));
    debugStats.rain = Math.round(climateNow.rain * 100) / 100;
    debugStats.mud = Math.round(climateNow.mud * 100) / 100;
    const seasonTintHex = terrainMaterial.color.getHex();
    if (seasonTintHex !== debugSeasonTintHex) {
      debugSeasonTintHex = seasonTintHex;
      debugStats.seasonTint = terrainMaterial.color.getHexString();
    }
    return climateNow;
  }

  function updateSky(dt) {
    if (inputState.timeSkip) {
      inputState.timeSkip = false;
      cycleT = (cycleT + 0.125) % 1;
      macroDays += 0.125;
    }
    // Sun-up half (cycleT 0..0.5) lasts DAY_SECONDS, night half
    // NIGHT_SECONDS; together exactly one 900s macro day.
    const seg = cycleT < 0.5 ? DAY_SECONDS : NIGHT_SECONDS;
    const cycleAdvance = (dt * 0.5) / seg;
    cycleT = (cycleT + cycleAdvance) % 1;
    macroDays += cycleAdvance;
    const th = cycleT * Math.PI * 2;
    const elev = Math.sin(th);
    const daylight = smoothstep(-0.06, 0.28, elev);
    const nightness = 1 - smoothstep(-0.32, -0.04, elev);
    const duskness = clamp(1 - Math.abs(elev + 0.02) / 0.3, 0, 1) * (1 - nightness * 0.55);

    const climate = updateClimate(dt);
    const sunDir = _v1.set(Math.cos(th) * 0.88, elev, 0.38).normalize();
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uMoonDir.value.copy(sunDir).multiplyScalar(-1);
    skyUniforms.uNight.value = nightness * (1 - climate.cloud * 0.75);
    skyUniforms.uSunGlow.value = climate.sunGlow * daylight;
    let usedSkyLut = false;
    if (rustSkySample(cycleT, WEATHER_CODE[weatherFromName] ?? 0,
      WEATHER_CODE[weatherName] ?? 0, weatherBlend, _skyLutOut)) {
      usedSkyLut = true;
      debugStats.rustSky = 1;
      skyUniforms.uZenith.value.setRGB(_skyLutOut[0], _skyLutOut[1], _skyLutOut[2], THREE.SRGBColorSpace);
      _c1.setRGB(_skyLutOut[3], _skyLutOut[4], _skyLutOut[5], THREE.SRGBColorSpace);
      skyUniforms.uSunColor.value.setRGB(_skyLutOut[6], _skyLutOut[7], _skyLutOut[8], THREE.SRGBColorSpace);
      _c2.setRGB(_skyLutOut[9], _skyLutOut[10], _skyLutOut[11], THREE.SRGBColorSpace);
    } else {
      skyUniforms.uSunColor.value.lerpColors(SKY.sunLow, SKY.sunHigh, clamp(elev * 1.7, 0, 1));
      skyUniforms.uZenith.value.lerpColors(SKY.zenNight, SKY.zenDay, daylight);
      _c1.lerpColors(SKY.horNight, SKY.horDay, daylight).lerp(SKY.horDusk, duskness * 0.72);
      _c1.lerp(climate.tint, climate.tintStrength * (0.35 + 0.65 * daylight));
    }
    skyUniforms.uHorizon.value.copy(_c1);
    scene.fog.color.copy(_c1); // exact weather-tinted sky horizon: no seam
    scene.fog.density = climate.density * lerp(1.28, 1, daylight);
    debugStats.fogDensity = Math.round(scene.fog.density * 100000) / 100000;

    sunLight.position.copy(sunDir).multiplyScalar(220).add(camera.position);
    sunLight.target.position.copy(camera.position);
    sunLight.intensity = 2.3 * Math.pow(clamp(elev, 0, 1), 0.7) * (0.2 + 0.8 * daylight) * climate.sunMul;
    sunLight.color.copy(skyUniforms.uSunColor.value);
    moonLight.position.copy(sunDir).multiplyScalar(-200).add(camera.position);
    moonLight.target.position.copy(camera.position);
    moonLight.intensity = 0.55 * nightness * (1 - climate.cloud * 0.6);
    hemi.intensity = lerp(0.23, 0.8, daylight) * climate.hemiMul;
    if (usedSkyLut) hemi.color.copy(_c2).lerp(skyUniforms.uZenith.value, 0.35);
    else hemi.color.lerpColors(SKY.hemiNight, SKY.hemiDay, daylight);
    renderer.toneMappingExposure = lerp(1.0, 1.08, daylight) * climate.exposureMul;

    starMat.opacity = nightness * (0.78 + 0.22 * Math.sin(elapsed * 2.7)) * (1 - climate.cloud * 0.82);
    for (let gi = 0; gi < galaxies.length; gi++) {
      const g = galaxies[gi];
      g.material.opacity = nightness * 0.9 * (1 - climate.cloud * 0.82);
      g.material.rotation += dt * 0.004;
    }
    stars.rotation.y = cycleT * 0.6;
    skyGroup.position.set(camera.position.x, 0, camera.position.z);

    waterUniforms.uTime.value = elapsed;
    waterUniforms.uDay.value = daylight;
    if (waterUniforms.uSunColor) waterUniforms.uSunColor.value.copy(skyUniforms.uSunColor.value);
    if (waterUniforms.uHorizon) waterUniforms.uHorizon.value.copy(_c1);
    rainUniforms.uTime.value = elapsed;
    rainUniforms.uIntensity.value = climate.rain;
    rainUniforms.uAspect.value = camera.aspect || 1;
    rainOverlay.visible = playing && climate.rain > 0.01;

    ambAcc += dt;
    if (ambAcc > 0.18 && hooks.onAmbience) {
      ambAcc = 0;
      const focus = playing ? player.pos : camera.position;
      const rw = riverInfoInto(focus.x, focus.z, _riverWorldInfo);
      _ambience.water = clamp(1 - (rw.d - 3) / 70, 0, 1);
      _ambience.day = daylight;
      _ambience.night = nightness;
      hooks.onAmbience(_ambience);
    }
  }

  function frame() {
    const profileStart = frameProfile.enabled ? performance.now() : 0;
    raf = requestAnimationFrame(frame);
    frameSerial++;
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    if (worldControl.teleport) {
      const tp = worldControl.teleport;
      worldControl.teleport = null;
      teleport(tp.x || 0, tp.z || 0, tp.heading || 0);
    }
    if (worldControl.weather) {
      setWeather(worldControl.weather);
      worldControl.weather = null;
    }
    if (worldControl.season) {
      setSeason(worldControl.season);
      worldControl.season = null;
    }
    if (worldControl.rollWeather) {
      worldControl.rollWeather = false;
      rollWeather();
    }
    if (playing) {
      gun.visible = true;
      updatePlayer(dt);
    } else if (!introCinematicPlayed) {
      updateCinematic(elapsed); // opening backdrop, once per app-open
    } else {
      snapToPlayerCamera(); // paused on the exact player view — no cinematic on resume
      gun.visible = !(warthog && warthog.occupied);
      playerBlobShadow.visible = false;
    }
    debugStats.cinematicActive = !playing && !introCinematicPlayed ? 1 : 0;
    debugStats.introCinematicPlayed = introCinematicPlayed ? 1 : 0;
    // beacon blink: sharp double-pulse
    const pulse = Math.pow(Math.max(0, Math.sin(elapsed * 2.6)), 6);
    beaconLight.intensity = pulse * 260;
    beacon.scale.setScalar(1 + pulse * 0.9);
    ringMat.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(elapsed * 1.8));
    const ringScale = 1 + 0.05 * Math.sin(elapsed * 1.8);
    ring.scale.set(ringScale, ringScale, 1);
    updateDrones(dt, elapsed);
    safetySweep(dt);
    updateFx(dt);
    updateSky(dt);
    pushHud();
    scatterCullAcc += dt;
    if (scatterCullAcc >= 0.2) {
      scatterCullAcc = 0;
      refreshScatterCulling();
    }
    chunkStreamAcc += dt;
    if (chunkStreamAcc >= 0.25) {
      chunkStreamAcc = 0;
      updateChunkStreaming();
    }
    // Time-sliced chunk work remains capped so terrain streaming does
    // not hitch movement.
    pumpChunkJobs(3.5);
    pumpBvh();
    const renderStart = frameProfile.enabled ? performance.now() : 0;
    renderer.render(scene, camera);
    { // debug counters (renderer.info is valid right after render)
      const now = performance.now();
      if (frameProfile.enabled) {
        const cpuUpdate = renderStart - profileStart;
        const cpuRender = now - renderStart;
        debugStats.cpuUpdateMs = cpuUpdate;
        debugStats.cpuRenderMs = cpuRender;
        debugStats.cpuFrameMs = now - profileStart;
        if (frameProfile.count < frameProfile.capacity) {
          const pi = frameProfile.count++;
          frameProfile.update[pi] = cpuUpdate;
          frameProfile.render[pi] = cpuRender;
          frameProfile.total[pi] = now - profileStart;
        }
        debugStats.profileFrames = frameProfile.count;
      }
      const ft = debugStats._last ? now - debugStats._last : 16.7;
      debugStats._last = now;
      debugStats.frameMs = debugStats.frameMs * 0.92 + ft * 0.08;
      debugStats.fps = debugStats.frameMs > 0 ? 1000 / debugStats.frameMs : 0;
      // No adaptive resolution shedding: renderDpr is locked to the native
      // devicePixelRatio in applyViewportSize() so tilting into landscape
      // never compresses the image.
      debugStats.dpr = Math.round(renderDpr * 100) / 100;
      debugStats.nativeDpr = Math.round(nativePixelRatio() * 100) / 100;
      const ri = renderer.info;
      debugStats.calls = ri.render.calls;
      debugStats.tris = ri.render.triangles;
      debugStats.points = ri.render.points;
      debugStats.lines = ri.render.lines;
      debugStats.geometries = ri.memory.geometries;
      debugStats.textures = ri.memory.textures;
      debugStats.programs = ri.programs ? ri.programs.length : 0;
      debugStats.width = renderer.domElement.width;
      debugStats.height = renderer.domElement.height;
      debugStats.cycle = cycleT;
      debugStats.px = camera.position.x;
      debugStats.pz = camera.position.z;
      debugStats.simSeconds = elapsed;
      debugStats.terrainCore = rustCore.ready ? "RUST" : "JS";
    }
  }
  frame();

  function dispose() {
    if (outOfBounds && hooks.onOutOfBoundsChange) hooks.onOutOfBoundsChange(false);
    if (terrainWorker) { terrainWorker.terminate(); terrainWorker = null; }
    setRustGroundProvider(null);
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    if (window.visualViewport) window.visualViewport.removeEventListener("resize", onResize);
    for (const t of resizeTimers) clearTimeout(t);
    resizeTimers = [];
    scene.traverse((obj) => {
      if (obj.geometry) {
        if (obj.geometry.disposeBoundsTree) obj.geometry.disposeBoundsTree();
        obj.geometry.dispose();
      }
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    });
    renderer.dispose();
  }

  return { setPlaying, shoot, reload, teleport, dispose };
}
