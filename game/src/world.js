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
import { rustCore, rustRawHeight, rustChunkTerrain } from "./wasm/ironveil-core.js";

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
  keys: new Set(),
  timeSkip: false, // set by the T key: jump the day/night cycle +3h
  jump: false, // pulsed by the touch JUMP button; the world consumes it
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
  grass: 0, pebbles: 0, blobShadows: 0, fogDensity: 0,
  terrainCore: "JS", rustChunks: 0,
  season: "COOL", weather: "SUNNY", macroDay: 0, seasonDay: 1,
  seasonBlend: 1, weatherBlend: 1, weatherRollS: 600, weatherRolls: 0,
  aiLosM: 300, dronesEngaged: 0, rain: 0, mud: 0, seasonTint: "ffffff",
  chunkJobs: 0, chunkBuildMs: 0, lod96: 0, lod48: 0, lod24: 0, bvhPending: 0,
};

// External debug/test control. The render loop consumes a pending teleport
// once; used by automated boundary/spawn verification.
export const worldControl = { teleport: null, weather: null, season: null, rollWeather: false };

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
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, octaves) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp; amp *= 0.5; freq *= 2.03;
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
export const CHUNK_SEGMENTS = 96; // ~10.4m per terrain vertex

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
};
let relayBase = 0, spawnBase = 0;
let RIVER = { samples: [], grid: new Map(), cellSize: 50, control: [] };

function baseHeight(x, z) {
  let h = fbm(x * 0.011 + 13.7, z * 0.011 - 4.2, 5) * 30;
  h += Math.pow(fbm(x * 0.0038 - 7.1, z * 0.0038 + 9.3, 3), 2) * 46;
  return h;
}
// Procedural rim mountains: past rimStart (BR 850m / Survival 1800m, square
// Chebyshev edge distance) height grows exponentially into an impassable
// ring. With the 200m fog wall it is only discovered near the edge.
function rimHeight(x, z) {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const start = activePreset.rimStart;
  if (edge <= start) return 0;
  const width = Math.max(1, activePreset.half - start);
  const t = (edge - start) / width;
  const shaped = (Math.exp(3.1 * Math.min(t, 1)) - 1) / (Math.exp(3.1) - 1);
  const ridge = 0.72 + 0.55 * fbm(x * 0.009 + 41.3, z * 0.009 - 23.8, 3);
  const beyond = t > 1 ? (t - 1) * width * 0.9 : 0;
  return shaped * 165 * ridge + beyond;
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
  const startZ = -(0.42 + rand() * 0.2) * span;
  const endZ = (0.42 + rand() * 0.2) * span;
  const phase = rand() * Math.PI * 2;
  const ctrl = [];
  const N = 11, mid = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const x = lerp(-span, span, u);
    const fade = Math.sin(u * Math.PI);
    let z = lerp(startZ, endZ, u)
      + Math.sin(u * Math.PI * 2.2 + phase) * span * 0.11 * fade
      + (rand() - 0.5) * span * 0.045 * fade;
    if (i === mid) z = (rand() < 0.5 ? -1 : 1) * (65 + rand() * 55); // keep spawn dry
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
  for (let pass = 0; pass < 2; pass++) {
    const src = prof, next = prof.slice();
    for (let i = 0; i < src.length; i++) {
      let sum = 0, n = 0;
      for (let k = -12; k <= 12; k++) {
        sum += src[Math.max(0, Math.min(src.length - 1, i + k))]; n++;
      }
      next[i] = sum / n;
    }
    prof = next;
  }
  for (let i = 1; i < prof.length; i++) prof[i] = Math.min(prof[i], prof[i - 1] - 0.045);
  const cellSize = 50;
  const grid = new Map();
  const samples = pts.map(([x, z], i) => {
    const sample = { x, z, bed: prof[i] - 1.55, water: prof[i] - 0.62 };
    const key = riverCellKey(Math.floor(x / cellSize), Math.floor(z / cellSize));
    const bucket = grid.get(key);
    if (bucket) bucket.push(sample); else grid.set(key, [sample]);
    return sample;
  });
  return { samples, grid, cellSize, control: ctrl };
}
export function riverInfo(x, z) {
  if (!RIVER.samples.length) return { d: 9999, bed: 0, water: -9999, x, z };
  const cell = RIVER.cellSize;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let best = null, bestD2 = Infinity;
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const bucket = RIVER.grid.get(riverCellKey(ix, iz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const s = bucket[i];
        const dx = x - s.x, dz = z - s.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = s; }
      }
    }
  }
  if (!best) return { d: 9999, bed: 0, water: -9999, x, z };
  return { d: Math.sqrt(bestD2), bed: best.bed, water: best.water, x: best.x, z: best.z };
}

function chooseRelay(seed, preset) {
  const rand = mulberry32((seed ^ 0x04c2e7a) >>> 0);
  for (let attempt = 0; attempt < 64; attempt++) {
    const angle = rand() * Math.PI * 2;
    const radius = preset.half * (0.38 + rand() * 0.24);
    const x = Math.round(Math.cos(angle) * radius);
    const z = Math.round(Math.sin(angle) * radius);
    if (Math.max(Math.abs(x), Math.abs(z)) > preset.rimStart * 0.82) continue;
    if (riverInfo(x, z).d < 28) continue; // not in the river
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
  const ri = riverInfo(x, z);
  if (ri.d < 17) {
    const t = 1 - smoothstep(4.2, 17, ri.d);
    h = lerp(h, ri.bed, Math.pow(t, 1.35) * 0.94);
  }
  return h;
}
export const heightAt = terrainHeight;

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
  const noop = { setPlaying() {}, shoot() {}, teleport() {}, dispose() {} };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    return noop; // very old device: UI still works over the CSS gradient
  }
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
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

  const camera = new THREE.PerspectiveCamera(71, window.innerWidth / window.innerHeight, 0.1, 900);
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
    new THREE.SphereGeometry(780, 28, 16),
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
    vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
  });
  const terrainGroup = new THREE.Group();
  terrainGroup.name = "terrain-chunks";
  scene.add(terrainGroup);
  const terrainChunks = new Map();
  const terrainMeshes = [];
  let chunkStreamAcc = Infinity;
  function chunkBounds(ix, iz) {
    const minX = -mapPreset.half + ix * CHUNK_SIZE_M;
    const minZ = -mapPreset.half + iz * CHUNK_SIZE_M;
    return { minX, maxX: minX + CHUNK_SIZE_M, minZ, maxZ: minZ + CHUNK_SIZE_M, cx: minX + CHUNK_SIZE_M / 2, cz: minZ + CHUNK_SIZE_M / 2 };
  }
  const LOD_SEGMENTS = [96, 96, 48, 24]; // by Chebyshev ring from camera chunk
  const chunkJobs = new Map(); // key -> build job
  const chunkQueue = []; // job keys, best score first
  const bvhQueue = []; // finished meshes awaiting an idle-frame BVH build
  const _vFwd = new THREE.Vector3();
  function chunkIndexAt(x, z) {
    const n = mapPreset.chunksPerAxis;
    return {
      ix: clamp(Math.floor((x + mapPreset.half) / CHUNK_SIZE_M), 0, n - 1),
      iz: clamp(Math.floor((z + mapPreset.half) / CHUNK_SIZE_M), 0, n - 1),
    };
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
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE_M, CHUNK_SIZE_M, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const job = { key, ix, iz, seg, b, geo, pos: geo.attributes.position, stage: "heights", i: 0, colors: null, norm: null, raw: undefined, light: null, score: 1e9 };
    chunkJobs.set(key, job);
    chunkQueue.push(key);
    return job;
  }
  const _cLow = new THREE.Color(0x232b1e), _cMid = new THREE.Color(0x3d4a32);
  const _cRock = new THREE.Color(0x5d6157), _cPeak = new THREE.Color(0x878e80);
  const _ctmp = new THREE.Color();
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
  // Advances one job until `deadline` (performance.now() ms). Returns true
  // when the mesh is finished. Heights and vertex colors are the two hot
  // loops; each checks the clock every 256 vertices.
  function stepChunkJob(job, deadline) {
    const pos = job.pos, b = job.b;
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
      while (job.i < pos.count) {
        const wx = pos.getX(job.i) + b.cx, wz = pos.getZ(job.i) + b.cz;
        if (job.raw) {
          const col = Math.round((wx - b.minX) / (CHUNK_SIZE_M / job.seg));
          const row = Math.round((wz - b.minZ) / (CHUNK_SIZE_M / job.seg));
          pos.setY(job.i, terrainHeightFromRaw(job.raw[row * rawRowW + col], wx, wz));
        } else {
          pos.setY(job.i, terrainHeight(wx, wz));
        }
        job.i++;
        if ((job.i & 127) === 0 && performance.now() > deadline) return false;
      }
      job.colors = new Float32Array(pos.count * 3);
      job.stage = "colors";
      job.i = 0;
    }
    // Slope for coloring comes from the height gradient over grid
    // neighbours — the material is flat-shaded (fragment-derivative
    // normals), so no computeVertexNormals pass is needed at all.
    const colors = job.colors;
    const rowW = job.seg + 1, cell = CHUNK_SIZE_M / job.seg;
    while (job.i < pos.count) {
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
      _ctmp.lerp(_cRock, smoothstep(0.18, 0.5, slope));
      // Rust-baked AO (when present) grounds valleys/ridges with no
      // shadow-map pass; JS-built chunks keep the plain hash shade.
      const shade = (0.82 + 0.18 * hash2(wx * 3.1, wz * 3.1)) * (job.light ? job.light[i] : 1);
      colors[i * 3] = _ctmp.r * shade; colors[i * 3 + 1] = _ctmp.g * shade; colors[i * 3 + 2] = _ctmp.b * shade;
      job.i++;
      if ((job.i & 127) === 0 && performance.now() > deadline) return false;
    }
    job.geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
        const b = chunkBounds(ix, iz);
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
          if (mesh.userData.seg >= 96) l96++; else if (mesh.userData.seg >= 48) l48++; else l24++;
        }
      }
    }
    chunkQueue.sort((a, b2) => {
      const ja = chunkJobs.get(a), jb = chunkJobs.get(b2);
      return (ja ? ja.score : 1e9) - (jb ? jb.score : 1e9);
    });
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
    { uTime: { value: 0 }, uDay: { value: 1 } },
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
      const hw = 3.4 * taper;
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
          p.y += sin(p.x * 0.55 + uTime * 1.9) * cos(p.z * 0.5 + uTime * 1.35) * 0.045;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uDay;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          float flow = sin(vUv.y * 46.0 - uTime * 2.4 + sin(vUv.x * 14.0 + uTime) * 0.8) * 0.5 + 0.5;
          float sparkle = pow(flow, 7.0);
          float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          vec3 dayCol = mix(vec3(0.05, 0.19, 0.29), vec3(0.21, 0.44, 0.55), 0.25 + sparkle * 0.75);
          vec3 nightCol = mix(vec3(0.012, 0.05, 0.09), vec3(0.06, 0.14, 0.21), sparkle * 0.7);
          vec3 col = mix(nightCol, dayCol, uDay);
          gl_FragColor = vec4(col, 0.52 + edge * 0.36);
          #include <fog_fragment>
        }`,
    });
    const water = new THREE.Mesh(wgeo, wmat);
    water.renderOrder = 2;
    water.frustumCulled = false;
    scene.add(water);
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
    for (let s = -5; s <= 5; s++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.94), wood);
      plank.position.set(c.x + axis.x * s, deckY + 0.14 * (1 - (s / 5.6) * (s / 5.6)), c.z + axis.y * s);
      plank.rotation.y = rotY;
      group.add(plank);
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 11.4), wood);
      rail.position.set(c.x - axis.y * side * 1.45, deckY + 0.85, c.z + axis.x * side * 1.45);
      rail.rotation.y = rotY;
      group.add(rail);
    }
    scene.add(group);
    return { cx: c.x, cz: c.z, deckY, ax: axis.x, az: axis.y, px: -axis.y, pz: axis.x };
  })();


  // ----- scatter: rocks + pines (instanced) -----
  const dummy = new THREE.Object3D();
  const blobShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x020403, transparent: true, opacity: 0.34, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const blobShadowGeometry = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  const clearOf = (x, z, r) =>
    Math.hypot(x - WORLD.relay.x, z - WORLD.relay.z) > r &&
    Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) > r;
  const scatterLimit = mapPreset.rimStart - 12;
  function scatter(count, placer) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const x = (rand() * 2 - 1) * scatterLimit;
      const z = (rand() * 2 - 1) * scatterLimit;
      if (!clearOf(x, z, 15)) continue;
      if (riverInfo(x, z).d < 5.5) continue; // not in the water
      placer(x, terrainHeight(x, z), z, placed);
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
    dummy.position.set(x, y + s * 0.25, z);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(s, s * (0.55 + rand() * 0.5), s);
    dummy.updateMatrix();
    rockPlacements.push({
      x, y: dummy.position.y, z,
      rx: dummy.rotation.x, ry: dummy.rotation.y, rz: dummy.rotation.z,
      sx: dummy.scale.x, sy: dummy.scale.y, sz: dummy.scale.z,
    });
    rocks.setMatrixAt(i, dummy.matrix);
  });
  scene.add(rocks);

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.22, 1.7, 5),
    new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }),
    TREE_N
  );
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2a17, roughness: 1, flatShading: true });
  const canopies = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.55, 5, 6),
    canopyMaterial,
    TREE_N
  );
  const treeBlobShadows = new THREE.InstancedMesh(blobShadowGeometry, blobShadowMaterial, TREE_N);
  treeBlobShadows.renderOrder = 1;
  // Local jungle-floor tufts: three tapered triangles per instance. A
  // deterministic world-space grid around the camera keeps a dense 60m
  // floor available anywhere on the 4km map without storing hundreds of
  // thousands of placements.
  const grassGeometry = (() => {
    const verts = [];
    const normals = [];
    const blades = [
      { a: 0.2, h: 0.72, bend: 0.10 },
      { a: 2.25, h: 0.9, bend: 0.14 },
      { a: 4.2, h: 0.78, bend: 0.08 },
    ];
    for (const b of blades) {
      const dx = Math.sin(b.a), dz = Math.cos(b.a);
      const sx = dz * 0.14, sz = -dx * 0.14;
      verts.push(-sx, 0, -sz, sx, 0, sz, dx * b.bend, b.h, dz * b.bend);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return g;
  })();
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x35542a, roughness: 1, flatShading: true, side: THREE.DoubleSide,
  });
  const grassTufts = new THREE.InstancedMesh(grassGeometry, grassMaterial, 900);
  scatter(TREE_N, (x, y, z, i) => {
    const s = 0.8 + rand() * 1.15, rot = rand() * Math.PI * 2;
    treePlacements.push({ x, y, z, s, rot });
    dummy.rotation.set(0, rot, 0);
    dummy.position.set(x, y + 0.8 * s, z); dummy.scale.setScalar(s); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + (1.7 + 2.1) * s, z); dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunks, canopies, treeBlobShadows, grassTufts);
  for (const mesh of [rocks, trunks, canopies, treeBlobShadows, grassTufts]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // contents are per-instance distance-compacted below
  }

  // ----- combat distance bands: 60m detail / 150m silhouette / culled -----
  // The macro terrain, river and relay remain as navigation landmarks (they
  // are only a few draw calls). Scatter detail uses:
  //   <= 60m: rocks + trunks + canopies
  //   <=150m: canopies only (cover silhouettes at engagement range)
  //    >150m: no scatter instances submitted
  // Compaction reuses the existing three InstancedMeshes, so culling does
  // not change the draw-call count; it cuts vertex/instance processing.
  const CULL_NEAR_M = 60;
  const CULL_MID_M = 150;
  const CULL_NEAR2 = CULL_NEAR_M * CULL_NEAR_M;
  const CULL_MID2 = CULL_MID_M * CULL_MID_M;
  let scatterCullAcc = Infinity;
  function refreshScatterCulling() {
    const cx = camera.position.x, cz = camera.position.z;
    let rockN = 0, trunkN = 0, canopyN = 0, blobN = 0, grassN = 0, pebbleN = 0, farTrees = 0;

    for (const p of rockPlacements) {
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz > CULL_NEAR2) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockN++, dummy.matrix);
    }

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
          if (dx * dx + dz * dz > CULL_NEAR2 || !clearOf(x, z, 4) || riverInfo(x, z).d < 4.8) continue;
          const s = 0.13 + hash2(gx * 29 + 3, gz * 31 + 9) * 0.34;
          dummy.position.set(x, terrainHeight(x, z) + s * 0.22, z);
          dummy.rotation.set(hash2(gx, gz) * 3, hash2(gx + 9, gz - 4) * 3, hash2(gx - 6, gz + 8) * 3);
          dummy.scale.set(s, s * 0.62, s * (0.75 + hash2(gx + 2, gz + 2) * 0.45));
          dummy.updateMatrix();
          rocks.setMatrixAt(rockN++, dummy.matrix);
          pebbleN++;
        }
      }
    }

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
          if (dx * dx + dz * dz > CULL_NEAR2 || !clearOf(x, z, 3) || riverInfo(x, z).d < 4.7) continue;
          dummy.position.set(x, terrainHeight(x, z) - 0.02, z);
          dummy.rotation.set(0, hash2(gx * 43, gz * 47) * Math.PI * 2, 0);
          dummy.scale.setScalar(0.75 + hash2(gx * 53 + 7, gz * 59 - 5) * 0.85);
          dummy.updateMatrix();
          grassTufts.setMatrixAt(grassN++, dummy.matrix);
        }
      }
    }

    for (const p of treePlacements) {
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > CULL_MID2) { farTrees++; continue; }
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.position.set(p.x, p.y + 3.8 * p.s, p.z);
      dummy.updateMatrix();
      canopies.setMatrixAt(canopyN++, dummy.matrix);
      dummy.position.set(p.x, p.y + 0.045, p.z);
      dummy.scale.setScalar(2.15 * p.s);
      dummy.updateMatrix();
      treeBlobShadows.setMatrixAt(blobN++, dummy.matrix);
      if (d2 <= CULL_NEAR2) {
        dummy.position.set(p.x, p.y + 0.8 * p.s, p.z);
        dummy.updateMatrix();
        trunks.setMatrixAt(trunkN++, dummy.matrix);
      }
    }

    rocks.count = rockN;
    trunks.count = trunkN;
    canopies.count = canopyN;
    treeBlobShadows.count = blobN;
    grassTufts.count = grassN;
    rocks.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    treeBlobShadows.instanceMatrix.needsUpdate = true;
    grassTufts.instanceMatrix.needsUpdate = true;

    // The relay point light has a 90m radius; don't include it in material
    // lighting once the objective is outside the 150m combat band.
    const rdx = WORLD.relay.x - cx, rdz = WORLD.relay.z - cz;
    beaconLight.visible = rdx * rdx + rdz * rdz <= CULL_MID2;

    debugStats.cullNear = rockN + trunkN;
    debugStats.cullMid = canopyN;
    debugStats.grass = grassN;
    debugStats.pebbles = pebbleN;
    debugStats.blobShadows = blobN;
    debugStats.cullFar = farTrees;
    debugStats.shadowMapsFrozen = renderer.shadowMap.autoUpdate ? 0 : 1;
    debugStats.shadowMapUpdates = 0;
  }

  // ----- relay station -----
  const relay = new THREE.Group();
  const relayY = terrainHeight(WORLD.relay.x, WORLD.relay.z);
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
    drones.push({
      group, body, eye, ax, az, cx: ax, cz: az, engaged: false,
      hoverH: 6.5 + rand() * 4,
      phase: rand() * Math.PI * 2,
      orbitR: 4 + rand() * 4.5,
      speed: 0.25 + rand() * 0.3,
      alive: true, vy: 0, respawnAt: 0,
    });
  }

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
  {
    // Refined stylized low-poly tactical rifle: tapered receiver and
    // handguard prisms, segmented Picatinny rail, detailed optic,
    // three-segment curved magazine, skeletal stock and small controls.
    // Everything is merged by material (4 meshes + lens/dot), so the
    // detail costs no meaningful draw calls and loads no external model.
    const gm = new THREE.MeshStandardMaterial({ color: 0x2a302b, roughness: 0.38, metalness: 0.62, emissive: 0x050705, flatShading: true });
    const gm2 = new THREE.MeshStandardMaterial({ color: 0x4b5a3c, roughness: 0.78, metalness: 0.12, emissive: 0x0d120a, flatShading: true });
    const gm3 = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.6, metalness: 0.3, emissive: 0x171207, flatShading: true });
    const gm4 = new THREE.MeshStandardMaterial({ color: 0x11150f, roughness: 0.95, metalness: 0.02, emissive: 0x030403, flatShading: true });
    const dark = [], polymer = [], accent = [], rubber = [];
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
    // Three-segment curved magazine + ribs + baseplate.
    box(polymer, 0.054, 0.15, 0.09, 0, -0.145, -0.07, 0.16);
    box(polymer, 0.051, 0.14, 0.086, 0, -0.235, -0.045, 0.33);
    box(polymer, 0.048, 0.125, 0.082, 0, -0.31, -0.01, 0.5);
    box(accent, 0.056, 0.013, 0.02, 0, -0.18, -0.118, 0.2);
    box(accent, 0.053, 0.013, 0.02, 0, -0.255, -0.095, 0.35);
    box(accent, 0.05, 0.013, 0.02, 0, -0.322, -0.062, 0.5);
    box(accent, 0.056, 0.026, 0.092, 0, -0.362, 0.012, 0.5);
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
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.023, 18),
      new THREE.MeshBasicMaterial({ color: 0x86d9e8 })
    );
    lens.position.set(0, 0.148, 0.037); gun.add(lens);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 6, 5), new THREE.MeshBasicMaterial({ color: 0xc8f45c }));
    dot.position.set(0, 0.148, 0.04); gun.add(dot);
  }
  gun.position.set(0.22, -0.24, -0.62);
  gun.scale.setScalar(0.82);
  camera.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.032, -0.93); gun.add(muzzle);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0 }));
  flash.position.copy(muzzle.position); gun.add(flash);

  // ----- player / camera state -----
  const spawnDir = new THREE.Vector2(WORLD.relay.x - WORLD.spawn.x, WORLD.relay.z - WORLD.spawn.z).normalize();
  const player = {
    pos: new THREE.Vector3(WORLD.spawn.x, terrainHeight(WORLD.spawn.x, WORLD.spawn.z) + 1.7, WORLD.spawn.z),
    vel: new THREE.Vector3(), // horizontal velocity (m/s); vy is vertical
    vy: 0,
    grounded: true,
    jumpHeld: false,
    coyote: 0,
    landDip: 0, // camera settle after a hard landing
    swayYaw: 0, swayPitch: 0, swayYawVel: 0, swayPitchVel: 0,
    yaw: Math.atan2(-spawnDir.x, -spawnDir.y),
    pitch: -0.03,
    bobPhase: 0,
    recoil: 0,
    lastStep: 0,
    wading: false,
  };
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
    player.pos.y = terrainHeight(player.pos.x, player.pos.z) + 1.7;
    player.vel.set(0, 0, 0);
    player.vy = 0;
    player.grounded = true;
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
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion();

  function playerPose(outPos, outQuat) {
    outPos.copy(player.pos);
    camera.rotation.set(player.pitch, player.yaw, 0);
    outQuat.copy(camera.quaternion);
  }

  function setPlaying(next) {
    if (next === playing) return;
    playing = next;
    if (playing) {
      transition = { t: 0, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone() };
    } else {
      transition = null;
    }
  }

  // ----- shooting -----
  const raycaster = new THREE.Raycaster();
  raycaster.far = 700;
  const _muzzleWorld = new THREE.Vector3(), _far = new THREE.Vector3();
  function shoot() {
    if (!playing) return;
    player.recoil = 1;
    player.pitch = clamp(player.pitch + 0.0055, -1.35, 1.35);
    flash.material.opacity = 0.95;
    flash.scale.setScalar(0.8 + rand() * 0.7);
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const targets = [];
    for (const mesh of terrainMeshes) if (mesh.visible) targets.push(mesh);
    for (const d of drones) if (d.alive && d.group.visible) targets.push(d.body);
    const hits = raycaster.intersectObjects(targets, false);
    muzzle.getWorldPosition(_muzzleWorld);
    if (hits.length) {
      const hit = hits[0];
      tracer(_muzzleWorld, hit.point);
      const hitTerrain = !!hit.object.userData.isTerrainChunk;
      burst(hit.point, hitTerrain ? 12 : 22, hitTerrain ? 2.6 : 4.2);
      const drone = drones.find((d) => d.body === hit.object);
      if (drone && drone.alive) {
        drone.alive = false;
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
  const MOVE_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"];
  const onKeyDown = (e) => {
    if (MOVE_CODES.includes(e.code)) {
      inputState.keys.add(e.code);
      if (e.code === "Space") e.preventDefault(); // jump, not page scroll
    }
  };
  const onKeyUp = (e) => inputState.keys.delete(e.code);
  const onBlur = () => inputState.keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);

  // ----- HUD hook caches -----
  let lastHeading = -1, lastDist = -1, lastBearing = -1;
  function pushHud() {
    camera.getWorldDirection(_v1);
    const heading = Math.round(((Math.atan2(_v1.x, -_v1.z) * 180) / Math.PI + 360) % 360);
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

  function updatePlayer(dt) {
    // look: drag deltas + aim-stick rate
    const prevYaw = player.yaw, prevPitch = player.pitch;
    player.yaw -= inputState.lookDX * 0.0026 + inputState.aimX * 2.5 * dt;
    player.pitch -= inputState.lookDY * 0.0026 + inputState.aimY * 1.9 * dt;
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
    const swayYawTarget = clamp(-yawRate * 0.035, -0.15, 0.15);
    const swayPitchTarget = clamp(-pitchRate * 0.03, -0.12, 0.12);
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
    const riNow = riverInfo(player.pos.x, player.pos.z);
    const inWaterNow = riNow.d < 4.4 && terrainHeight(player.pos.x, player.pos.z) < riNow.water - 0.12;
    if (inWaterNow && !player.wading && hooks.onSplash) hooks.onSplash();
    player.wading = inWaterNow;
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    const maxSpeed = (sprint ? 14.5 : 8.6) * (inWaterNow ? 0.52 : 1);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const prevX = player.pos.x, prevZ = player.pos.z;
    // --- kinematic inertia: explicit accel/decel response, weak air
    // control, gravity + coyote jump. Exponential rates give roughly
    // 86% of a start in 0.20s and 88% of a stop in 0.15s, so starts
    // and stops carry visible weight without a rigid-body engine.
    const wishX = -sin * mz + cos * mx, wishZ = -cos * mz - sin * mx;
    const wishMag = Math.hypot(mx, mz);
    let slopeSpeedMul = 1;
    if (player.grounded && wishMag > 0.01) {
      const ahead = 2.2;
      const grade = (terrainHeight(player.pos.x + wishX * ahead, player.pos.z + wishZ * ahead) - terrainHeight(player.pos.x, player.pos.z)) / ahead;
      slopeSpeedMul = clamp(1 - grade * 0.55, 0.35, 1.12);
    }
    const targetX = wishX * maxSpeed * slopeSpeedMul;
    const targetZ = wishZ * maxSpeed * slopeSpeedMul;
    const decelerating = wishMag < 0.03 || (player.vel.x * targetX + player.vel.z * targetZ) < 0;
    const mud = climateNow.mud;
    const accelRate = !player.grounded ? 2.3
      : decelerating ? 14 * (1 - 0.45 * mud)  // monsoon mud: longer slide
      : 10 * (1 - 0.3 * mud);                 // monsoon mud: -30% acceleration
    debugStats.accelRate = accelRate;
    const vBlend = 1 - Math.exp(-accelRate * dt);
    player.vel.x += (targetX - player.vel.x) * vBlend;
    player.vel.z += (targetZ - player.vel.z) * vBlend;
    const jumpDown = k.has("Space") || inputState.jump;
    inputState.jump = false;
    if (jumpDown && !player.jumpHeld && (player.grounded || player.coyote > 0)) {
      player.vy = 7.7; // ~1.4m apex at GRAVITY=-21
      player.grounded = false;
      player.coyote = 0;
    }
    player.jumpHeld = jumpDown;
    player.coyote = player.grounded ? 0.12 : Math.max(0, player.coyote - dt);
    player.vy = Math.max(player.vy + GRAVITY * dt, -38);
    const wasGrounded = player.grounded;
    const fallSpeed = Math.max(0, -player.vy);
    // Integrate from the feet; player.pos is the eye (feet + 1.7m).
    let feetX = player.pos.x, feetY = player.pos.y - 1.7, feetZ = player.pos.z;
    const mdx = player.vel.x * dt, mdy = player.vy * dt, mdz = player.vel.z * dt;
    feetX += mdx; feetY += mdy; feetZ += mdz;
    player.grounded = false;
    player.pos.x = feetX;
    player.pos.z = feetZ;
    // Mode-specific square boundary.
    // Survival: hard clamp at +/-1950m (inside the rim ring).
    // BR: terrain ends at +/-1000m; pressing on that line is out of bounds
    // and drains 5 HP/s until the player returns inside.
    const clampLimit = mapPreset.hardClamp;
    player.pos.x = clamp(player.pos.x, -clampLimit, clampLimit);
    player.pos.z = clamp(player.pos.z, -clampLimit, clampLimit);
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
    // Analytic ground truth (matches the rendered surface exactly).
    let groundY = terrainHeight(player.pos.x, player.pos.z);
    const bdx = player.pos.x - bridge.cx, bdz = player.pos.z - bridge.cz;
    const alongB = bdx * bridge.ax + bdz * bridge.az;
    const acrossB = bdx * bridge.px + bdz * bridge.pz;
    if (Math.abs(alongB) < 5.8 && Math.abs(acrossB) < 1.7) groundY = Math.max(groundY, bridge.deckY);
    const snapDistance = wasGrounded && player.vy <= 0 ? 0.55 : 0;
    if (feetY <= groundY + snapDistance) {
      if (feetY < groundY) feetY = groundY;
      else feetY += (groundY - feetY) * Math.min(1, dt * 20); // smooth downhill snap
      player.grounded = true;
    }
    if (player.grounded) {
      if (!wasGrounded && fallSpeed > 6) {
        player.landDip = Math.min(0.16, fallSpeed * 0.012);
        if (hooks.onLand) hooks.onLand();
      }
      if (player.vy < 0) player.vy = 0;
    }
    player.pos.y = feetY + 1.7;
    playerBlobShadow.visible = true;
    playerBlobShadow.position.set(player.pos.x, groundY + 0.04, player.pos.z);
    const airH = clamp(feetY - groundY, 0, 3);
    playerBlobShadow.scale.setScalar(0.62 * (1 - airH * 0.1));
    playerBlobMaterial.opacity = clamp(climateNow.blobOpacity + 0.02 - airH * 0.055, 0.05, 0.42);
    debugStats.grounded = player.grounded ? 1 : 0;
    debugStats.vy = Math.round(player.vy * 10) / 10;
    debugStats.speed = Math.round(Math.hypot(player.vel.x, player.vel.z) * 10) / 10;
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const moving = clamp(hSpeed / 8, 0, 1) * (player.grounded ? 1 : 0.2);
    player.bobPhase += dt * hSpeed * 1.18 * (player.grounded ? 1 : 0.25);
    const stepIdx = Math.floor(player.bobPhase / Math.PI);
    if (moving > 0.15 && stepIdx !== player.lastStep && player.grounded) {
      player.lastStep = stepIdx;
      if (hooks.onStep) hooks.onStep(inWaterNow);
    }
    const bobY = Math.sin(player.bobPhase) * 0.055 * moving;
    const bobX = Math.cos(player.bobPhase * 0.5) * 0.03 * moving;
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
      camera.rotation.set(player.pitch, player.yaw, -mx * 0.014);
    }

    // Viewmodel: camera-synced walking bob + spring sway + recoil.
    player.recoil = Math.max(0, player.recoil - dt * 7);
    const rk = player.recoil * player.recoil;
    gun.position.set(
      0.22 + Math.cos(player.bobPhase * 0.5) * 0.012 * moving - player.swayYaw * 0.16,
      -0.24 + Math.sin(player.bobPhase) * 0.014 * moving + player.swayPitch * 0.11,
      -0.62 + rk * 0.07
    );
    gun.rotation.set(rk * 0.09 + player.swayPitch * 0.85, player.swayYaw, player.swayYaw * 0.35);
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
    gun.visible = false;
    playerBlobShadow.visible = false;
  }

  function updateDrones(dt, t) {
    const nowSec = performance.now() / 1000;
    const losM = climateNow.losM;
    const renderRange = Math.max(CULL_MID_M, losM);
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
          d.vy = 0;
          d.eye.material.color.set(0xffb347);
          d.group.rotation.set(0, 0, 0);
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
        d.engaged = playing && actualDist <= losM;
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
        if (d.engaged) {
          const hx = camera.position.x - d.ax, hz = camera.position.z - d.az;
          const hd = Math.hypot(hx, hz) || 1;
          const leash = Math.min(28, hd);
          targetX = d.ax + (hx / hd) * leash;
          targetZ = d.az + (hz / hd) * leash;
        }
        const mx2 = targetX - d.cx, mz2 = targetZ - d.cz;
        const md = Math.hypot(mx2, mz2);
        if (md > 0.001) {
          const step = Math.min(md, (d.engaged ? 0.9 : 0.55) * stepDt);
          d.cx += (mx2 / md) * step;
          d.cz += (mz2 / md) * step;
          x = d.cx + Math.cos(a) * d.orbitR;
          z = d.cz + Math.sin(a) * d.orbitR;
        }
        const y = terrainHeight(x, z) + d.hoverH + Math.sin(t * 1.4 + d.phase) * 0.7;
        d.group.position.set(x, y, z);
        d.group.rotation.y = -a;
        d.body.rotation.y += dt * (d.engaged ? 3.0 : 1.6);
      } else if (nowSec >= d.respawnAt) {
        d.alive = true;
        d.engaged = false;
        d.eye.material.color.set(0xffb347);
        d.group.rotation.set(0, 0, 0);
      } else {
        d.engaged = false;
        const groundY = terrainHeight(d.group.position.x, d.group.position.z) + 0.7;
        if (d.group.position.y > groundY) {
          d.vy += 22 * dt;
          d.group.position.y = Math.max(groundY, d.group.position.y - d.vy * dt);
          d.group.rotation.x += dt * 4; d.group.rotation.z += dt * 3;
          if (d.group.position.y <= groundY) burst(d.group.position, 10, 2);
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
    }
    if (any) pGeo.attributes.position.needsUpdate = true;
    for (const t of tracers) {
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
  let ambAcc = 1;

  // ----- macro seasons + micro weather -----
  // Macro clock: macroDays advances with the sun cycle (900s/day); a
  // season is 10 macro days. Micro clock: an active-time real-seconds
  // accumulator rolls weather every 600s using the current season's
  // weights. Season palette and all weather scalars transition over 30s.
  const SEASON_ORDER = ["dry", "cool", "monsoon"];
  const SEASON_PALETTES = {
    dry: {
      terrain: new THREE.Color(0xd8bd83), canopy: new THREE.Color(0x716b35), grass: new THREE.Color(0x8a8142),
      weights: [["sunny", 0.60], ["mist", 0.30], ["monsoon", 0.10]],
    },
    cool: {
      terrain: new THREE.Color(0xffffff), canopy: new THREE.Color(0x1b2a17), grass: new THREE.Color(0x35542a),
      weights: [["sunny", 0.50], ["mist", 0.40], ["monsoon", 0.10]],
    },
    monsoon: {
      terrain: new THREE.Color(0x9fd3a8), canopy: new THREE.Color(0x0e3520), grass: new THREE.Color(0x1f6b32),
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
  let weatherFrom = snapshotWeather(WEATHER_TARGETS.sunny);
  let weatherTo = snapshotWeather(WEATHER_TARGETS.sunny);
  let weatherBlend = 1;
  // Shared live parameters consumed by movement, drones and sky. Defined
  // before the first rendered frame; earlier function bodies only read it
  // once the frame loop starts.
  const climateNow = snapshotWeather(WEATHER_TARGETS.sunny);
  function setWeather(name) {
    name = normalizeWeather(name);
    if (!name || name === weatherName && weatherBlend >= 1) return;
    weatherFrom = snapshotWeather(climateNow);
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
    for (const f of WEATHER_FIELDS) climateNow[f] = lerp(weatherFrom[f], weatherTo[f], wb);
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

    debugStats.season = seasonName.toUpperCase();
    debugStats.weather = weatherName.toUpperCase();
    debugStats.macroDay = Math.round(macroDays * 100) / 100;
    debugStats.seasonDay = Math.floor(macroDays % 10) + 1;
    debugStats.seasonBlend = Math.round(seasonBlend * 100) / 100;
    debugStats.weatherBlend = Math.round(weatherBlend * 100) / 100;
    debugStats.weatherRollS = Math.max(0, Math.round(600 - weatherRollAcc));
    debugStats.rain = Math.round(climateNow.rain * 100) / 100;
    debugStats.mud = Math.round(climateNow.mud * 100) / 100;
    debugStats.seasonTint = terrainMaterial.color.getHexString();
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
    skyUniforms.uSunColor.value.lerpColors(SKY.sunLow, SKY.sunHigh, clamp(elev * 1.7, 0, 1));
    skyUniforms.uZenith.value.lerpColors(SKY.zenNight, SKY.zenDay, daylight);
    _c1.lerpColors(SKY.horNight, SKY.horDay, daylight).lerp(SKY.horDusk, duskness * 0.72);
    _c1.lerp(climate.tint, climate.tintStrength * (0.35 + 0.65 * daylight));
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
    hemi.color.lerpColors(SKY.hemiNight, SKY.hemiDay, daylight);
    renderer.toneMappingExposure = lerp(1.0, 1.08, daylight) * climate.exposureMul;

    starMat.opacity = nightness * (0.78 + 0.22 * Math.sin(elapsed * 2.7)) * (1 - climate.cloud * 0.82);
    for (const g of galaxies) {
      g.material.opacity = nightness * 0.9 * (1 - climate.cloud * 0.82);
      g.material.rotation += dt * 0.004;
    }
    stars.rotation.y = cycleT * 0.6;
    skyGroup.position.set(camera.position.x, 0, camera.position.z);

    waterUniforms.uTime.value = elapsed;
    waterUniforms.uDay.value = daylight;
    rainUniforms.uTime.value = elapsed;
    rainUniforms.uIntensity.value = climate.rain;
    rainUniforms.uAspect.value = camera.aspect || 1;
    rainOverlay.visible = playing && climate.rain > 0.01;

    ambAcc += dt;
    if (ambAcc > 0.18 && hooks.onAmbience) {
      ambAcc = 0;
      const focus = playing ? player.pos : camera.position;
      const rw = riverInfo(focus.x, focus.z);
      hooks.onAmbience({
        water: clamp(1 - (rw.d - 3) / 70, 0, 1),
        day: daylight,
        night: nightness,
      });
    }
  }

  function frame() {
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
    } else {
      updateCinematic(elapsed);
    }
    // beacon blink: sharp double-pulse
    const pulse = Math.pow(Math.max(0, Math.sin(elapsed * 2.6)), 6);
    beaconLight.intensity = pulse * 260;
    beacon.scale.setScalar(1 + pulse * 0.9);
    ringMat.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(elapsed * 1.8));
    const ringScale = 1 + 0.05 * Math.sin(elapsed * 1.8);
    ring.scale.set(ringScale, ringScale, 1);
    updateDrones(dt, elapsed);
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
    renderer.render(scene, camera);
    { // debug counters (renderer.info is valid right after render)
      const now = performance.now();
      const ft = debugStats._last ? now - debugStats._last : 16.7;
      debugStats._last = now;
      debugStats.frameMs = debugStats.frameMs * 0.92 + ft * 0.08;
      debugStats.fps = debugStats.frameMs > 0 ? 1000 / debugStats.frameMs : 0;
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
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onResize);
    scene.traverse((obj) => {
      if (obj.geometry) {
        if (obj.geometry.disposeBoundsTree) obj.geometry.disposeBoundsTree();
        obj.geometry.dispose();
      }
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    });
    renderer.dispose();
  }

  return { setPlaying, shoot, teleport, dispose };
}
