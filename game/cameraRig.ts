/*
 * Third-person orbit camera with terrain collision pull-in and an
 * over-the-shoulder aim pose.
 */

import * as THREE from "three";
import type { Player } from "./actors";
import type { World } from "./world";

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly tmp = new THREE.Vector3();
  private readonly target = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 420);
  }

  /** World-space direction the camera is looking (used for bullet rays). */
  getForward(out: THREE.Vector3): THREE.Vector3 {
    this.camera.getWorldDirection(out);
    return out;
  }

  update(dt: number, player: Player, world: World, aiming: boolean) {
    const cam = this.camera;
    const dist = aiming ? 3.1 : 5.6;
    const shoulder = aiming ? 0.85 : 0.55;

    // Orbit from the player's yaw + pitch.
    const cp = Math.cos(player.pitch);
    const sp = Math.sin(player.pitch);
    const offset = this.tmp.set(
      Math.sin(player.yaw) * cp * dist + Math.cos(player.yaw) * shoulder,
      2.2 - sp * dist,
      Math.cos(player.yaw) * cp * dist - Math.sin(player.yaw) * shoulder
    );

    const desired = this.target.copy(player.position).add(offset);

    // Pull the camera in if the terrain clips it.
    const ground = world.heightAt(desired.x, desired.z);
    if (desired.y < ground + 0.9) desired.y = ground + 0.9;

    // Smooth follow (snappier while aiming).
    const lerpK = 1 - Math.exp(-(aiming ? 18 : 11) * dt);
    cam.position.lerp(desired, lerpK);

    const lookAt = new THREE.Vector3(
      player.position.x - Math.sin(player.yaw) * 2.2,
      player.position.y + 1.9 + player.pitch * 1.4,
      player.position.z - Math.cos(player.yaw) * 2.2
    );
    cam.lookAt(lookAt);

    const targetFov = aiming ? 48 : 62;
    if (Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10);
      cam.updateProjectionMatrix();
    }
  }

  /** Slow cinematic orbit used behind the main menu. */
  orbit(time: number, center: THREE.Vector3, radius: number) {
    const a = time * 0.12;
    this.camera.position.set(
      center.x + Math.cos(a) * radius,
      center.y + 9,
      center.z + Math.sin(a) * radius
    );
    this.camera.lookAt(center);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
