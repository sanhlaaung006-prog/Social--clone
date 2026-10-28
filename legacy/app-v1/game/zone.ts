/*
 * Battle royale safe zone: timed phases with a shrinking circle and a
 * translucent wall + ground ring. Players/bots outside take escalating damage.
 */

import * as THREE from "three";
import { CONFIG, type PhaseSpec } from "./config";
import { Rng } from "./rng";

export class Zone {
  center = new THREE.Vector3(0, 0, 0);
  radius: number;
  phaseIndex = -1;
  state: "waiting" | "shrinking" | "done" = "waiting";
  timer: number;
  damagePerSecond = 0;

  private fromCenter = new THREE.Vector3();
  private targetCenter = new THREE.Vector3();
  private fromRadius: number;
  private toRadius: number;

  private readonly ring: THREE.Mesh;
  private readonly wall: THREE.Mesh;
  private readonly rng: Rng;

  constructor(scene: THREE.Scene) {
    this.rng = new Rng(CONFIG.seed + 909);
    const first = CONFIG.zone.phases[0];
    this.radius = first.from;
    this.fromRadius = first.from;
    this.toRadius = first.from;
    this.timer = first.delay;

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0x69d2ff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.4;
    scene.add(this.ring);

    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 14, 96, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x69d2ff,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    scene.add(this.wall);
  }

  private get phase(): PhaseSpec {
    return CONFIG.zone.phases[Math.max(0, this.phaseIndex)];
  }

  beginNextPhase() {
    this.phaseIndex++;
    if (this.phaseIndex >= CONFIG.zone.phases.length) {
      this.state = "done";
      return;
    }
    const spec = this.phase;
    this.state = "waiting";
    this.timer = spec.delay;
    this.damagePerSecond = spec.dmg;
    this.fromRadius = spec.from;
    this.toRadius = spec.to;
    this.radius = spec.from;
    this.fromCenter.copy(this.center);

    // New center must keep the smaller circle inside the current one.
    const maxOffset = spec.from - spec.to;
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(0, maxOffset);
    this.targetCenter.set(
      this.fromCenter.x + Math.cos(a) * d,
      0,
      this.fromCenter.z + Math.sin(a) * d
    );
  }

  update(dt: number) {
    if (this.state === "done") {
      this.syncVisuals();
      return;
    }

    if (this.phaseIndex === -1) this.beginNextPhase();

    this.timer -= dt;

    if (this.state === "waiting" && this.timer <= 0) {
      this.state = "shrinking";
      this.timer = this.phase.shrink;
    }

    if (this.state === "shrinking") {
      const spec = this.phase;
      const t = THREE.MathUtils.clamp(1 - this.timer / spec.shrink, 0, 1);
      const e = t * t * (3 - 2 * t); // smoothstep
      this.radius = THREE.MathUtils.lerp(this.fromRadius, this.toRadius, e);
      this.center.lerpVectors(this.fromCenter, this.targetCenter, e);
      if (t >= 1) this.beginNextPhase();
    }

    this.syncVisuals();
  }

  private syncVisuals() {
    this.ring.position.set(this.center.x, 0.4, this.center.z);
    this.ring.scale.set(this.radius, this.radius, 1);
    this.wall.position.set(this.center.x, 7, this.center.z);
    this.wall.scale.set(this.radius, 1, this.radius);
  }

  isInside(x: number, z: number): boolean {
    return Math.hypot(x - this.center.x, z - this.center.z) <= this.radius;
  }

  /** HUD data: seconds left in the current wait/shrink step. */
  get countdown(): number {
    return Math.max(0, this.timer);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.ring, this.wall);
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.wall.geometry.dispose();
    (this.wall.material as THREE.Material).dispose();
  }
}
