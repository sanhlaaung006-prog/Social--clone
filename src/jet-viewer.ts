/*
 * Browser inspection route for the revised MiG-29 module.
 * Served at /jet.html by Vite (multipage build); not part of the game loop.
 * Deliberately simple: Lambert-friendly lights, no composer or bloom.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assembleMig29, AIRCRAFT } from "@/game/vehicles/mig29";

const container = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1114);
scene.fog = new THREE.Fog(0x0d1114, 40, 90);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  220
);
camera.position.set(11, 6, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.52;

scene.add(new THREE.HemisphereLight(0xd6e0e8, 0x262a24, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(9, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
scene.add(sun);
scene.add(new THREE.DirectionalLight(0x9db4c9, 0.7));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(18, 48),
  new THREE.MeshLambertMaterial({ color: 0x1b2226 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const jet = assembleMig29();
// Park on the showroom platform height from the vendor spec.
jet.position.y = AIRCRAFT.showroomY;
scene.add(jet);

let rotating = true;
document.getElementById("rotate")!.addEventListener("click", (e) => {
  rotating = !rotating;
  const btn = e.currentTarget as HTMLButtonElement;
  btn.textContent = rotating ? "Pause rotation" : "Resume rotation";
  btn.classList.toggle("active", rotating);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (rotating) jet.rotation.y += dt * 0.35;
  controls.update();
  renderer.render(scene, camera);
}
animate();
