/*
 * Debug/inspection route for the extracted TankForge module.
 * Served at /tank.html by Vite (multipage build); not part of the game itself.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TankForge, TANK_PRESETS } from "@/game/vehicles/tankForge";

const container = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141a1e);
scene.fog = new THREE.Fog(0x141a1e, 34, 70);

const camera = new THREE.PerspectiveCamera(
  39,
  window.innerWidth / window.innerHeight,
  0.1,
  220
);
camera.position.set(9.6, 6.7, 13.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.8, 0.4);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 7;
controls.maxDistance = 28;
controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new THREE.HemisphereLight(0xd6e0e8, 0x262a24, 0.95));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.position.set(9, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
scene.add(sun);
scene.add(new THREE.DirectionalLight(0x9db4c9, 0.8));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 48),
  new THREE.MeshStandardMaterial({ color: 0x2b3134, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let tank: THREE.Group | null = null;
let rotating = true;

type PresetKey = keyof typeof TANK_PRESETS;

function mount(key: PresetKey) {
  if (tank) {
    tank.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    scene.remove(tank);
  }
  tank = TankForge.build(TANK_PRESETS[key]);
  scene.add(tank);

  let meshes = 0;
  tank.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes++;
  });
  const spec = TANK_PRESETS[key];
  document.getElementById("meta")!.textContent =
    `${spec.variant} (${spec.unit}) · ${meshes} meshes · hull ${spec.hullLength}m`;
  document.querySelectorAll<HTMLButtonElement>("#presets button").forEach((b) => {
    b.classList.toggle("active", b.dataset.key === key);
  });
}

const presetBar = document.getElementById("presets")!;
for (const key of Object.keys(TANK_PRESETS) as PresetKey[]) {
  const btn = document.createElement("button");
  btn.dataset.key = key;
  btn.textContent = TANK_PRESETS[key].label;
  btn.addEventListener("click", () => mount(key));
  presetBar.appendChild(btn);
}
document.getElementById("rotate")!.addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  rotating = !rotating;
  btn.textContent = rotating ? "Pause rotation" : "Resume rotation";
  btn.classList.toggle("active", rotating);
});

mount("long");

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (rotating && tank) tank.rotation.y += dt * 0.42;
  controls.update();
  renderer.render(scene, camera);
}
animate();
