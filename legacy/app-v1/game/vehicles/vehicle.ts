/*
 * Arcade wheeled-vehicle wrapper around the extracted low-poly models.
 * Kinematic physics (no rigid body): throttle/brake speed integration,
 * speed-scaled steering, circle-obstacle resolution via the C/WASM physics
 * core, and smooth terrain height follow.
 */

import * as THREE from "three";
import { CONFIG } from "../config";
import type { InputState } from "../input";
import type { Physics } from "../wasm/physics";
import type { World } from "../world";

export type VehicleKind = "tank" | "technical";
export type Seat = "driver" | "passenger";

export class Vehicle {
  readonly kind: VehicleKind;
  readonly group: THREE.Group;
  readonly radius: number;
  readonly label: string;

  speed = 0;
  yaw: number;
  /** Independent turret/camera aim (world convention, matches player yaw). */
  aimYaw: number;
  aimPitch = 0;

  occupied: Seat | null = null;

  private readonly turretYaw: THREE.Object3D | null;
  private readonly turretPitch: THREE.Object3D | null;
  private readonly gunMuzzle: THREE.Object3D | null;

  constructor(kind: VehicleKind, group: THREE.Group, yaw: number) {
    this.kind = kind;
    this.group = group;
    this.yaw = yaw;
    this.aimYaw = yaw;
    this.radius = kind === "tank" ? CONFIG.vehicles.radiusTank : CONFIG.vehicles.radiusTechnical;
    this.label = kind === "tank" ? "MBT tank" : "armed technical";

    this.turretYaw =
      group.getObjectByName("turretPivot") ??
      group.getObjectByName("GunMount.TurretYawGroup") ??
      null;
    this.turretPitch = group.getObjectByName("GunMount.GunPitchGroup") ?? null;
    this.gunMuzzle =
      group.getObjectByName("GunMount.MuzzleFlashEffect") ??
      group.getObjectByName("GunMount.RecoilGroup") ??
      this.turretYaw;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get hasGun(): boolean {
    return this.kind === "technical";
  }

  /** World-space point the mounted gun fires from. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.gunMuzzle) this.gunMuzzle.getWorldPosition(out);
    else out.copy(this.position).setY(this.position.y + 1.6);
    return out;
  }

  /** Aim look input (shared touch-drag / mouse deltas). */
  applyLook(dx: number, dy: number, touch: boolean) {
    const sens = CONFIG.vehicles.lookSens * (touch ? 1.3 : 0.75);
    this.aimYaw -= dx * sens;
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch - dy * sens, -0.7, 0.6);
  }

  update(dt: number, input: InputState | null, physics: Physics, world: World) {
    const v = CONFIG.vehicles;

    if (input && this.occupied === "driver") {
      const throttle = input.moveY; // +1 forward, -1 reverse
      if (throttle > 0.05) {
        this.speed += v.accel * throttle * dt;
      } else if (throttle < -0.05) {
        if (this.speed > 0.5) this.speed -= v.brake * dt;
        else this.speed -= v.accel * 0.6 * -throttle * dt;
      } else {
        // Rolling friction.
        const drop = v.drag * dt * 3;
        if (Math.abs(this.speed) <= drop) this.speed = 0;
        else this.speed -= Math.sign(this.speed) * drop;
      }
      this.speed = THREE.MathUtils.clamp(this.speed, -v.reverseSpeed, v.maxSpeed);

      const steer = input.moveX;
      const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 3.5, 0, 1);
      this.yaw -= steer * v.turnRate * speedFactor * dt * Math.sign(this.speed || 1);
    } else {
      const drop = v.drag * dt * 3;
      if (Math.abs(this.speed) <= drop) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * drop;
    }

    // Kinematic move along the actor forward convention (-Z at yaw 0).
    const dx = -Math.sin(this.yaw) * this.speed * dt;
    const dz = -Math.cos(this.yaw) * this.speed * dt;
    const [rx, rz] = physics.resolveCircles(
      this.position.x + dx,
      this.position.z + dz,
      this.radius
    );
    if (Math.hypot(rx - (this.position.x + dx), rz - (this.position.z + dz)) > 0.02) {
      this.speed *= 0.55; // bumped something: bleed speed
    }
    this.position.x = rx;
    this.position.z = rz;

    // Terrain follow (smoothed so hills don't jitter the hull).
    const ground = world.heightAt(this.position.x, this.position.z) + v.groundOffset;
    this.position.y += (ground - this.position.y) * Math.min(1, dt * 8);

    // Vendor models face +Z; the game faces -Z at yaw 0.
    this.group.rotation.y = this.yaw + Math.PI;

    // Turret aims independently of the hull.
    if (this.turretYaw) {
      this.turretYaw.rotation.y = this.aimYaw - this.group.rotation.y;
    }
    if (this.turretPitch) {
      this.turretPitch.rotation.x = -this.aimPitch;
    }
  }
}
