/*
 * Sky, fog and lighting rig. The GL-only PMREM image-based lighting step
 * is isolated in applyImageBasedLighting() so headless tests can build
 * scenes without a WebGL context. Renderer settings follow the sandline
 * presentation recipe (ACES tone mapping, sRGB output, PCF soft shadows)
 * re-authored for three r170.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const SKY_COLOR = 0xa9c7d6;
export const FOG_COLOR = 0xbdcbd0;

export interface EnvironmentRig {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
}

/** Adds background, distance fog and the three-light mobile rig. */
export function createEnvironmentRig(scene: THREE.Scene): EnvironmentRig {
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 48, 135);

  const hemi = new THREE.HemisphereLight(0xdcebf2, 0x6b5b43, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(-28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  const s = 46;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  scene.add(sun.target);

  // Cool fill from the opposite side keeps shadow sides readable.
  const fill = new THREE.DirectionalLight(0x9db8d8, 0.5);
  fill.position.set(24, 18, -26);
  scene.add(fill);

  return { sun, hemi, fill };
}

/**
 * Bakes a room-environment PMREM for soft specular IBL. WebGL only —
 * call from the engine after the renderer exists, never from tests.
 */
export function applyImageBasedLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const target = pmrem.fromScene(envScene, 0.04);
  scene.environment = target.texture;
  pmrem.dispose();
}

/** Renderer factory with the visual-quality baseline locked in one place. */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}
