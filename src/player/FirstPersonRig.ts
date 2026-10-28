/*
 * Applies the pure FpState to a THREE.PerspectiveCamera every frame.
 * Kept separate from the kernel so locomotion stays headless-testable.
 */

import * as THREE from "three";
import { FP_CONFIG, type FpState } from "./controller";

export class FirstPersonRig {
  private readonly camera: THREE.PerspectiveCamera;
  private currentFov: number;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.currentFov = FP_CONFIG.baseFov;
    camera.fov = this.currentFov;
    camera.rotation.order = "YXZ";
    camera.near = 0.08;
    camera.updateProjectionMatrix();
  }

  apply(state: FpState): void {
    this.camera.position.set(
      state.x + state.bobX,
      state.y + state.bobY - state.landDip,
      state.z
    );
    this.camera.rotation.set(
      state.pitch - state.swayX,
      state.yaw + state.swayY,
      -state.lean + state.swayY * 0.18,
      "YXZ"
    );

    const targetFov = FP_CONFIG.baseFov + (FP_CONFIG.sprintFov - FP_CONFIG.baseFov) * state.fovKick;
    if (Math.abs(targetFov - this.currentFov) > 0.02) {
      this.currentFov = targetFov;
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
