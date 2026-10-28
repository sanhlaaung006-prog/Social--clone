/*
 * GameEngine — owns the WebGL renderer, scene graph and RAF loop.
 * This first rebuild milestone renders a slow cinematic orbit so the
 * new visual baseline (ACES tone mapping, IBL, soft shadows, procedural
 * materials) can be judged before gameplay modules are ported.
 */

import * as THREE from "three";
import { applyImageBasedLighting, createEnvironmentRig, createRenderer } from "../render/environment";
import { createWorld } from "../render/world";

export interface EngineStats {
  fps: number;
  triangles: number;
  draws: number;
}

export class GameEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly rig = createEnvironmentRig(this.scene);
  private readonly world: THREE.Group;
  private rafId = 0;
  private running = false;
  private angle = 0.6;
  private frameCount = 0;
  private fpsWindow = 0;
  private stats: EngineStats = { fps: 0, triangles: 0, draws: 0 };
  private onStats?: (stats: EngineStats) => void;

  constructor(canvas: HTMLCanvasElement, onStats?: (stats: EngineStats) => void) {
    this.renderer = createRenderer(canvas);
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 260);
    this.camera.position.set(26, 14, 30);
    this.world = createWorld();
    this.scene.add(this.world);
    applyImageBasedLighting(this.renderer, this.scene);
    this.onStats = onStats;
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      this.tick();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    // Slow cinematic orbit around the courtyard; gentle height bob.
    this.angle += dt * 0.06;
    const radius = 30;
    this.camera.position.set(
      Math.cos(this.angle) * radius,
      13 + Math.sin(this.angle * 0.7) * 2.2,
      Math.sin(this.angle) * radius
    );
    this.camera.lookAt(0, 2.4, 0);

    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    this.fpsWindow += dt;
    if (this.fpsWindow >= 0.5) {
      this.stats = {
        fps: Math.round(this.frameCount / this.fpsWindow),
        triangles: this.renderer.info.render.triangles,
        draws: this.renderer.info.render.calls,
      };
      this.frameCount = 0;
      this.fpsWindow = 0;
      this.onStats?.(this.stats);
    }
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const value of Object.values(m)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
  }

  get sun(): THREE.DirectionalLight {
    return this.rig.sun;
  }
}
