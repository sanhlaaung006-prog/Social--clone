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

export const inputState = {
  moveX: 0, // strafe  -1..1 (move stick)
  moveY: 0, // forward -1..1 (move stick)
  aimX: 0,  // aim-stick rate -1..1
  aimY: 0,
  lookDX: 0, // accumulated mouse-drag deltas (consumed each frame)
  lookDY: 0,
  keys: new Set(),
  timeSkip: false, // set by the T key: jump the day/night cycle +3h
};

// Live perf counters, filled by the render loop, read by the React debug overlay.
export const debugStats = {
  fps: 0, frameMs: 0, calls: 0, tris: 0, points: 0, lines: 0,
  geometries: 0, textures: 0, programs: 0,
  width: 0, height: 0, cycle: 0, px: 0, pz: 0, _last: 0,
};

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
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
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

// ---------- world layout ----------
export const WORLD = {
  size: 640,
  playableRadius: 292,
  spawn: { x: -70, z: 120 },
  relay: { x: 70, z: -115 },
};

function rawHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm(x * 0.011 + 13.7, z * 0.011 - 4.2, 5) * 30;
  h += Math.pow(fbm(x * 0.0038 - 7.1, z * 0.0038 + 9.3, 3), 2) * 46;
  const rim = smoothstep(190, 315, d);
  h += rim * (58 + 34 * fbm(x * 0.017 + 31, z * 0.017 - 17, 3));
  return h;
}
const relayBase = rawHeight(WORLD.relay.x, WORLD.relay.z);
const spawnBase = rawHeight(WORLD.spawn.x, WORLD.spawn.z);

// ---------- river: meandering channel carved across the sector ----------
// A Catmull-Rom path is resampled; the terrain height function carves a
// channel toward a smoothed, monotonically descending bed profile so the
// water ribbon built on top always flows "downhill".
const RIVER_CTRL = [
  [-262, -218], [-185, -150], [-120, -95], [-58, -40], [0, 2],
  [52, 36], [98, 86], [150, 140], [205, 205], [260, 264],
];
function catmull2(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}
const RIVER = (() => {
  const pts = [];
  for (let s = 0; s < RIVER_CTRL.length - 1; s++) {
    const p0 = RIVER_CTRL[Math.max(0, s - 1)], p1 = RIVER_CTRL[s];
    const p2 = RIVER_CTRL[s + 1], p3 = RIVER_CTRL[Math.min(RIVER_CTRL.length - 1, s + 2)];
    for (let i = 0; i < 26; i++) pts.push(catmull2(p0, p1, p2, p3, i / 26));
  }
  pts.push(RIVER_CTRL[RIVER_CTRL.length - 1].slice());
  let prof = pts.map(([x, z]) => rawHeight(x, z));
  for (let pass = 0; pass < 2; pass++) {
    prof = prof.map((v, i) => {
      let sum = 0, n = 0;
      for (let k = -4; k <= 4; k++) {
        const q = prof[Math.max(0, Math.min(prof.length - 1, i + k))];
        sum += q; n++;
      }
      return sum / n;
    });
  }
  for (let i = 1; i < prof.length; i++) prof[i] = Math.min(prof[i], prof[i - 1] - 0.022);
  const samples = pts.map(([x, z], i) => ({ x, z, bed: prof[i] - 1.55, water: prof[i] - 0.62 }));
  return { samples };
})();
export function riverInfo(x, z) {
  let best = null, bestD2 = Infinity;
  const arr = RIVER.samples;
  for (let i = 0; i < arr.length; i++) {
    const dx = x - arr[i].x, dz = z - arr[i].z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = arr[i]; }
  }
  return { d: Math.sqrt(bestD2), bed: best.bed, water: best.water, x: best.x, z: best.z };
}

export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
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

// ---------- world factory ----------
export function createWorld(canvas, hooks = {}) {
  const noop = { setPlaying() {}, shoot() {}, dispose() {} };
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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f0a); // behind the sky dome
  scene.fog = new THREE.Fog(0x0a0f0a, 55, 430);

  const camera = new THREE.PerspectiveCamera(71, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xbdd3a0, 0x0c100b, 0.85);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xd8e6c0, 1.5);
  sunLight.position.set(90, 150, 40);
  scene.add(sunLight);
  const moonLight = new THREE.DirectionalLight(0x8fa8d8, 0);
  moonLight.position.set(-60, 120, -30);
  scene.add(moonLight);

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
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -1.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.58));
          col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
          float sDot = max(dot(dir, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(sDot, 700.0) * 1.9 + pow(sDot, 20.0) * 0.22);
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

  const rand = mulberry32(90210);

  // ----- terrain -----
  const terrGeo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 160, 160);
  terrGeo.rotateX(-Math.PI / 2);
  {
    const pos = terrGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    terrGeo.computeVertexNormals();
    const norm = terrGeo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x232b1e), cMid = new THREE.Color(0x3d4a32);
    const cRock = new THREE.Color(0x5d6157), cPeak = new THREE.Color(0x878e80);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i), slope = 1 - norm.getY(i);
      tmp.copy(cLow).lerp(cMid, smoothstep(2, 26, h));
      tmp.lerp(cPeak, smoothstep(38, 78, h) * 0.8);
      tmp.lerp(cRock, smoothstep(0.18, 0.5, slope));
      const shade = 0.82 + 0.18 * hash2(pos.getX(i) * 3.1, pos.getZ(i) * 3.1);
      colors[i * 3] = tmp.r * shade; colors[i * 3 + 1] = tmp.g * shade; colors[i * 3 + 2] = tmp.b * shade;
    }
    terrGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  const terrain = new THREE.Mesh(
    terrGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })
  );
  scene.add(terrain);

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
    const midX = (WORLD.spawn.x + WORLD.relay.x) / 2;
    const midZ = (WORLD.spawn.z + WORLD.relay.z) / 2;
    let bi = 0, bd = Infinity;
    RIVER.samples.forEach((p, i) => {
      const d = Math.hypot(p.x - midX, p.z - midZ);
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
  const clearOf = (x, z, r) =>
    Math.hypot(x - WORLD.relay.x, z - WORLD.relay.z) > r &&
    Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) > r;
  function scatter(count, placer) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 285;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOf(x, z, 15)) continue;
      placer(x, terrainHeight(x, z), z, placed);
      placed++;
    }
    return placed;
  }
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x555a50, roughness: 1, flatShading: true }),
    150
  );
  scatter(150, (x, y, z, i) => {
    const s = 0.6 + rand() * 2.6;
    dummy.position.set(x, y + s * 0.25, z);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(s, s * (0.55 + rand() * 0.5), s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  });
  scene.add(rocks);

  const TREE_N = 280;
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.22, 1.7, 5),
    new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }),
    TREE_N
  );
  const canopies = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.55, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0x1b2a17, roughness: 1, flatShading: true }),
    TREE_N
  );
  scatter(TREE_N, (x, y, z, i) => {
    const s = 0.8 + rand() * 1.15, rot = rand() * Math.PI * 2;
    dummy.rotation.set(0, rot, 0);
    dummy.position.set(x, y + 0.8 * s, z); dummy.scale.setScalar(s); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + (1.7 + 2.1) * s, z); dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunks, canopies);

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
      group, body, eye, ax, az,
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
    const gm = new THREE.MeshStandardMaterial({ color: 0x2c352b, roughness: 0.5, metalness: 0.45, emissive: 0x11160f });
    const gm2 = new THREE.MeshStandardMaterial({ color: 0x3d4836, roughness: 0.6, metalness: 0.3, emissive: 0x161c13 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.15, 0.58), gm); gun.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), gm);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.035, -0.44); gun.add(barrel);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.3), gm2);
    guard.position.set(0, -0.01, -0.34); gun.add(guard);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), gm);
    mag.position.set(0, -0.15, -0.06); mag.rotation.x = 0.28; gun.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.22), gm2);
    stock.position.set(0, -0.02, 0.36); gun.add(stock);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.09), gm);
    sight.position.set(0, 0.105, -0.05); gun.add(sight);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5), new THREE.MeshBasicMaterial({ color: 0xc8f45c }));
    dot.position.set(0, 0.108, -0.05); gun.add(dot);
  }
  gun.position.set(0.22, -0.24, -0.62);
  gun.scale.setScalar(0.85);
  camera.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.035, -0.62); gun.add(muzzle);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0 }));
  flash.position.copy(muzzle.position); gun.add(flash);

  // ----- player / camera state -----
  const spawnDir = new THREE.Vector2(WORLD.relay.x - WORLD.spawn.x, WORLD.relay.z - WORLD.spawn.z).normalize();
  const player = {
    pos: new THREE.Vector3(WORLD.spawn.x, terrainHeight(WORLD.spawn.x, WORLD.spawn.z) + 1.7, WORLD.spawn.z),
    yaw: Math.atan2(-spawnDir.x, -spawnDir.y),
    pitch: -0.03,
    bobPhase: 0,
    recoil: 0,
    lastStep: 0,
    wading: false,
  };
  let playing = false;
  let transition = null; // { t, fromPos, fromQuat }
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
    const targets = [terrain];
    for (const d of drones) if (d.alive) targets.push(d.body);
    const hits = raycaster.intersectObjects(targets, false);
    muzzle.getWorldPosition(_muzzleWorld);
    if (hits.length) {
      const hit = hits[0];
      tracer(_muzzleWorld, hit.point);
      burst(hit.point, hit.object === terrain ? 12 : 22, hit.object === terrain ? 2.6 : 4.2);
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
  const MOVE_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];
  const onKeyDown = (e) => { if (MOVE_CODES.includes(e.code)) inputState.keys.add(e.code); };
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
  let raf = 0, elapsed = 0;

  function updatePlayer(dt) {
    // look: drag deltas + aim-stick rate
    player.yaw -= inputState.lookDX * 0.0026 + inputState.aimX * 2.5 * dt;
    player.pitch -= inputState.lookDY * 0.0026 + inputState.aimY * 1.9 * dt;
    player.pitch = clamp(player.pitch, -1.35, 1.35);
    inputState.lookDX = 0; inputState.lookDY = 0;

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
    const speed = (sprint ? 14.5 : 8.6) * (inWaterNow ? 0.52 : 1);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    player.pos.x += (-sin * mz + cos * mx) * speed * dt;
    player.pos.z += (-cos * mz - sin * mx) * speed * dt;
    const r = Math.hypot(player.pos.x, player.pos.z);
    if (r > WORLD.playableRadius) {
      player.pos.x *= WORLD.playableRadius / r;
      player.pos.z *= WORLD.playableRadius / r;
    }
    let ground = terrainHeight(player.pos.x, player.pos.z) + 1.7;
    const bdx = player.pos.x - bridge.cx, bdz = player.pos.z - bridge.cz;
    const alongB = bdx * bridge.ax + bdz * bridge.az;
    const acrossB = bdx * bridge.px + bdz * bridge.pz;
    if (Math.abs(alongB) < 5.8 && Math.abs(acrossB) < 1.7) ground = Math.max(ground, bridge.deckY + 1.7);
    player.pos.y += (ground - player.pos.y) * (1 - Math.exp(-11 * dt));
    const moving = Math.min(1, Math.hypot(mx, mz));
    player.bobPhase += dt * (sprint ? 11 : 8) * moving;
    const stepIdx = Math.floor(player.bobPhase / Math.PI);
    if (moving > 0.15 && stepIdx !== player.lastStep) {
      player.lastStep = stepIdx;
      if (hooks.onStep) hooks.onStep(inWaterNow);
    }
    const bobY = Math.sin(player.bobPhase) * 0.055 * moving;
    const bobX = Math.cos(player.bobPhase * 0.5) * 0.03 * moving;

    if (transition) {
      transition.t += dt / 0.9;
      const t = smoothstep(0, 1, Math.min(1, transition.t));
      playerPose(_v2, _q1);
      camera.position.lerpVectors(transition.fromPos, _v2, t);
      camera.position.y += bobY * t;
      camera.quaternion.slerpQuaternions(transition.fromQuat, _q1, t);
      if (transition.t >= 1) transition = null;
    } else {
      camera.position.set(player.pos.x + bobX * cos, player.pos.y + bobY, player.pos.z - bobX * sin);
      camera.rotation.set(player.pitch, player.yaw, -mx * 0.014);
    }

    // viewmodel sway + recoil
    player.recoil = Math.max(0, player.recoil - dt * 7);
    const rk = player.recoil * player.recoil;
    gun.position.set(
      0.22 + Math.cos(player.bobPhase * 0.5) * 0.012 * moving,
      -0.24 + Math.sin(player.bobPhase) * 0.014 * moving,
      -0.62 + rk * 0.07
    );
    gun.rotation.x = rk * 0.09;
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 16);
  }

  function updateCinematic(t) {
    const cx = (WORLD.spawn.x + WORLD.relay.x) / 2, cz = (WORLD.spawn.z + WORLD.relay.z) / 2;
    const a = t * 0.045;
    camera.position.set(
      cx + Math.sin(a) * 105,
      terrainHeight(cx, cz) + 36 + Math.sin(t * 0.1) * 5,
      cz + Math.cos(a) * 105
    );
    camera.lookAt(WORLD.relay.x, relayY + 13, WORLD.relay.z);
    gun.visible = false;
  }

  function updateDrones(dt, t) {
    for (const d of drones) {
      if (d.alive) {
        const a = t * d.speed + d.phase;
        const x = d.ax + Math.cos(a) * d.orbitR;
        const z = d.az + Math.sin(a) * d.orbitR;
        const y = terrainHeight(x, z) + d.hoverH + Math.sin(t * 1.4 + d.phase) * 0.7;
        d.group.position.set(x, y, z);
        d.group.rotation.y = -a;
        d.body.rotation.y += dt * 1.6;
      } else if (performance.now() / 1000 >= d.respawnAt) {
        d.alive = true;
        d.eye.material.color.set(0xff5040);
        d.group.rotation.set(0, 0, 0);
      } else {
        const groundY = terrainHeight(d.group.position.x, d.group.position.z) + 0.7;
        if (d.group.position.y > groundY) {
          d.vy += 22 * dt;
          d.group.position.y = Math.max(groundY, d.group.position.y - d.vy * dt);
          d.group.rotation.x += dt * 4; d.group.rotation.z += dt * 3;
          if (d.group.position.y <= groundY) burst(d.group.position, 10, 2);
        }
      }
    }
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


  // ----- day/night cycle (4-minute loop; T key skips +3h; ?phase= sets start) -----
  const DAY_LENGTH = 240;
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
  function updateSky(dt) {
    if (inputState.timeSkip) {
      inputState.timeSkip = false;
      cycleT = (cycleT + 0.125) % 1;
    }
    cycleT = (cycleT + dt / DAY_LENGTH) % 1;
    const th = cycleT * Math.PI * 2;
    const elev = Math.sin(th);
    const daylight = smoothstep(-0.06, 0.28, elev);
    const nightness = 1 - smoothstep(-0.32, -0.04, elev);
    const duskness = clamp(1 - Math.abs(elev + 0.02) / 0.3, 0, 1) * (1 - nightness * 0.55);

    const sunDir = _v1.set(Math.cos(th) * 0.88, elev, 0.38).normalize();
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uMoonDir.value.copy(sunDir).multiplyScalar(-1);
    skyUniforms.uNight.value = nightness;
    skyUniforms.uSunColor.value.lerpColors(SKY.sunLow, SKY.sunHigh, clamp(elev * 1.7, 0, 1));
    skyUniforms.uZenith.value.lerpColors(SKY.zenNight, SKY.zenDay, daylight);
    _c1.lerpColors(SKY.horNight, SKY.horDay, daylight).lerp(SKY.horDusk, duskness * 0.72);
    skyUniforms.uHorizon.value.copy(_c1);
    scene.fog.color.copy(_c1).multiplyScalar(0.82);

    sunLight.position.copy(sunDir).multiplyScalar(220).add(camera.position);
    sunLight.intensity = 2.3 * Math.pow(clamp(elev, 0, 1), 0.7) * (0.2 + 0.8 * daylight);
    sunLight.color.copy(skyUniforms.uSunColor.value);
    moonLight.position.copy(sunDir).multiplyScalar(-200).add(camera.position);
    moonLight.intensity = 0.55 * nightness;
    hemi.intensity = lerp(0.23, 0.8, daylight);
    hemi.color.lerpColors(SKY.hemiNight, SKY.hemiDay, daylight);
    renderer.toneMappingExposure = lerp(1.0, 1.08, daylight);

    starMat.opacity = nightness * (0.78 + 0.22 * Math.sin(elapsed * 2.7));
    for (const g of galaxies) {
      g.material.opacity = nightness * 0.9;
      g.material.rotation += dt * 0.004;
    }
    stars.rotation.y = cycleT * 0.6;
    skyGroup.position.set(camera.position.x, 0, camera.position.z);

    waterUniforms.uTime.value = elapsed;
    waterUniforms.uDay.value = daylight;

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
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
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
      debugStats.px = Math.round(camera.position.x);
      debugStats.pz = Math.round(camera.position.z);
    }
  }
  frame();

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onResize);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    });
    renderer.dispose();
  }

  return { setPlaying, shoot, dispose };
}
