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
export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  const dRelay = Math.hypot(x - WORLD.relay.x, z - WORLD.relay.z);
  const dSpawn = Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z);
  h = lerp(relayBase, h, smoothstep(9, 26, dRelay));
  h = lerp(spawnBase, h, smoothstep(7, 20, dSpawn));
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
  scene.background = new THREE.Color(0x0a0f0a);
  scene.fog = new THREE.Fog(0x0a0f0a, 55, 430);

  const camera = new THREE.PerspectiveCamera(71, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xbdd3a0, 0x0c100b, 0.85));
  const moon = new THREE.DirectionalLight(0xd8e6c0, 1.5);
  moon.position.set(90, 150, 40);
  scene.add(moon);

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
    const gm = new THREE.MeshStandardMaterial({ color: 0x2c352b, roughness: 0.5, metalness: 0.45 });
    const gm2 = new THREE.MeshStandardMaterial({ color: 0x3d4836, roughness: 0.6, metalness: 0.3 });
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
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    const speed = sprint ? 14.5 : 8.6;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    player.pos.x += (-sin * mz + cos * mx) * speed * dt;
    player.pos.z += (-cos * mz - sin * mx) * speed * dt;
    const r = Math.hypot(player.pos.x, player.pos.z);
    if (r > WORLD.playableRadius) {
      player.pos.x *= WORLD.playableRadius / r;
      player.pos.z *= WORLD.playableRadius / r;
    }
    const ground = terrainHeight(player.pos.x, player.pos.z) + 1.7;
    player.pos.y += (ground - player.pos.y) * (1 - Math.exp(-11 * dt));
    const moving = Math.min(1, Math.hypot(mx, mz));
    player.bobPhase += dt * (sprint ? 11 : 8) * moving;
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
    pushHud();
    renderer.render(scene, camera);
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
