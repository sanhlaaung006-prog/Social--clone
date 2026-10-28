/*
 * First-person camera rig.
 *
 * Revised and mixed from two MIT-licensed sources:
 *  - three.js r170 examples/.../PointerLockControls.js: the core YXZ Euler
 *    convention (yaw on Y, pitch on X, quaternion derived from the Euler)
 *    and ~0.002 rad/px sensitivity thinking.
 *  - Shellishack/3d-web-game-dev-skills player-controllers skill: eye-height
 *    grounding over a terrainHeight() function and head-bob/air-offset
 *    controller structure.
 * See reference/oss-research.md for attribution.
 *
 * Realism layer added on top: walk head-bob, look-input counter-sway,
 * idle breathing, strafe/turn roll, landing dip with pitch kick, sprint
 * FOV kick and an ADS (aim-down-sights) FOV/pose. A cylinder-built rifle
 * rides the camera as the first-person view model. Vehicles keep the
 * third-person chase camera via followTarget().
 */

import * as THREE from "three";
import type { Player } from "./actors";
import { buildRifleModel } from "./actors";
import { CONFIG } from "./config";
import type { World } from "./world";

const EYE_HEIGHT = 2.45;
const BASE_FOV = 62;
const ADS_FOV = 48;
const SPRINT_FOV = 70;
const PITCH_LIMIT = 1.15;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly viewModel: THREE.Group;
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  // Head bob / motion state.
  private bobPhase = 0;
  private elapsed = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private roll = 0;
  private landDip = 0;
  private landKick = 0;
  private wasAirborne = false;
  private peakY = 0;
  private adsMix = 0;

  // Third-person fallback state (death cam / vehicles).
  private readonly tpDesired = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.06, 420);
    this.camera.rotation.order = "YXZ";

    // View-model rifle hangs off the camera so it inherits every head
    // motion. The shared rifle model points +Z, so spin it to face the
    // camera's -Z view direction and tuck it into the lower-right quadrant.
    this.viewModel = buildRifleModel();
    this.viewModel.name = "fps-view-model";
    this.viewModel.scale.setScalar(0.7);
    this.viewModel.position.set(0.3, -0.34, -0.8);
    this.viewModel.rotation.y = Math.PI;
    this.viewModel.visible = false;
    this.camera.add(this.viewModel);
  }

  /** World-space direction the camera is looking (used for bullet rays). */
  getForward(out: THREE.Vector3): THREE.Vector3 {
    this.camera.getWorldDirection(out);
    return out;
  }

  /** First-person on-foot camera with the full realism layer. */
  update(dt: number, player: Player, world: World, aiming: boolean) {
    if (!player.alive) {
      this.updateDeathCam(dt, player, world);
      return;
    }

    this.elapsed += dt;
    const cam = this.camera;
    const pos = player.position;

    // The player's own body is hidden in first person; the view model shows.
    player.group.visible = false;
    this.viewModel.visible = true;

    // --- grounding / landing -------------------------------------------------
    const ground = world.heightAt(pos.x, pos.z);
    const airborne = pos.y > ground + 0.08;
    if (airborne) {
      this.wasAirborne = true;
      this.peakY = Math.max(this.peakY, pos.y);
    } else if (this.wasAirborne) {
      const fall = Math.max(0, this.peakY - pos.y);
      this.landDip = Math.min(0.26, 0.04 + fall * 0.11);
      this.landKick = Math.min(0.085, fall * 0.03);
      this.wasAirborne = false;
      this.peakY = pos.y;
    }
    this.landDip *= Math.exp(-9 * dt);
    this.landKick *= Math.exp(-7.5 * dt);

    // --- head bob -------------------------------------------------------------
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const moveAmt = Math.min(speed / CONFIG.player.speed, 1.4);
    if (!airborne && moveAmt > 0.05) {
      this.bobPhase += dt * (7.2 + speed * 0.95);
    }
    const bobAmp = (aiming ? 0.016 : 0.05) * Math.min(moveAmt, 1);
    const bobY = Math.sin(this.bobPhase * 2) * bobAmp;
    const bobX = Math.cos(this.bobPhase) * bobAmp * 0.7;

    // --- look counter-sway (kick opposite the flick, ease back) ---------------
    const dYaw = player.yaw - this.prevYaw;
    const dPitch = player.pitch - this.prevPitch;
    this.prevYaw = player.yaw;
    this.prevPitch = player.pitch;
    const swayK = 1 - Math.exp(-10 * dt);
    this.swayYaw += (-dYaw * 0.45 - this.swayYaw) * swayK;
    this.swayPitch += (-dPitch * 0.4 - this.swayPitch) * swayK;

    // Idle breathing, almost imperceptible while moving.
    const idle = THREE.MathUtils.clamp(1 - moveAmt, 0, 1);
    const breathP = Math.sin(this.elapsed * 1.6) * 0.0042 * idle;
    const breathY = Math.sin(this.elapsed * 0.9) * 0.003 * idle;

    // --- roll: strafe lean plus a touch of turn-in weight --------------------
    this.right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const lateral = player.velocity.x * this.right.x + player.velocity.z * this.right.z;
    const rollTarget = THREE.MathUtils.clamp(
      -lateral * 0.0038 - dYaw * 0.22,
      -0.028,
      0.028
    );
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-8 * dt));

    // --- pose ------------------------------------------------------------------
    cam.position.set(
      pos.x + this.right.x * bobX,
      pos.y + EYE_HEIGHT + bobY - this.landDip,
      pos.z + this.right.z * bobX
    );
    cam.rotation.y = player.yaw + this.swayYaw + breathY;
    cam.rotation.x = THREE.MathUtils.clamp(
      player.pitch + this.swayPitch + breathP + this.landKick,
      -PITCH_LIMIT,
      PITCH_LIMIT
    );
    cam.rotation.z = this.roll;

    // --- FOV: ADS tightens, sprint widens -------------------------------------
    const sprinting = speed > CONFIG.player.speed * 1.15;
    const targetFov = aiming ? ADS_FOV : sprinting ? SPRINT_FOV : BASE_FOV;
    if (Math.abs(cam.fov - targetFov) > 0.08) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 9);
      cam.updateProjectionMatrix();
    }

    // --- view-model pose: hip -> ADS slide, bob and sway follow ---------------
    this.adsMix += ((aiming ? 1 : 0) - this.adsMix) * (1 - Math.exp(-12 * dt));
    const hipX = 0.3 - this.adsMix * 0.3;
    const hipY = -0.34 + this.adsMix * 0.13;
    const hipZ = -0.8 + this.adsMix * 0.26;
    this.viewModel.position.set(
      hipX + bobX * 1.6,
      hipY + bobY * 1.4,
      hipZ
    );
    this.viewModel.rotation.set(
      this.swayPitch * 0.5,
      Math.PI + this.swayYaw * 0.5,
      -this.roll * 0.6
    );
  }

  /** Pulled-back third-person view of the fallen player (death / victory). */
  private updateDeathCam(dt: number, player: Player, world: World) {
    this.viewModel.visible = false;
    player.group.visible = true;
    const pos = player.position;
    const back = this.tmp.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    this.tpDesired.set(
      pos.x + back.x * 4.2,
      pos.y + 2.3,
      pos.z + back.z * 4.2
    );
    const ground = world.heightAt(this.tpDesired.x, this.tpDesired.z);
    if (this.tpDesired.y < ground + 0.9) this.tpDesired.y = ground + 0.9;

    const k = 1 - Math.exp(-8 * dt);
    this.camera.position.lerp(this.tpDesired, k);
    this.lookTarget.set(pos.x, pos.y + 1.4, pos.z);
    this.camera.lookAt(this.lookTarget);
  }

  /** Third-person follow for vehicles with an independent aim yaw/pitch. */
  followTarget(
    dt: number,
    center: THREE.Vector3,
    yaw: number,
    pitch: number,
    world: World,
    dist: number,
    height: number
  ) {
    this.viewModel.visible = false;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const desired = new THREE.Vector3(
      center.x + Math.sin(yaw) * cp * dist + Math.cos(yaw) * 0.6,
      center.y + height - sp * dist,
      center.z + Math.cos(yaw) * cp * dist - Math.sin(yaw) * 0.6
    );

    const ground = world.heightAt(desired.x, desired.z);
    if (desired.y < ground + 0.9) desired.y = ground + 0.9;

    const k = 1 - Math.exp(-10 * dt);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(
      center.x - Math.sin(yaw) * 3,
      center.y + 1.7 + pitch * 1.4,
      center.z - Math.cos(yaw) * 3
    );
    this.camera.fov += (BASE_FOV - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
  }

  /** Slow cinematic orbit used behind the main menu. */
  orbit(time: number, center: THREE.Vector3, radius: number) {
    this.viewModel.visible = false;
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
