/*
 * Flyable aircraft wrapper. All aerodynamics live in the pure flight model
 * (game/flightModel.ts); this class maps InputState onto flight controls,
 * keeps the kinematic body clear of static obstacles while on the ground,
 * and synchronises the procedural airframe's transform.
 */

import * as THREE from "three";
import { CONFIG } from "../config";
import type { InputState } from "../input";
import type { Physics } from "../wasm/physics";
import type { World } from "../world";
import {
  clamp,
  createFlightState,
  stepFlight,
  type FlightInput,
  type FlightState,
} from "../flightModel";

export type AircraftKind = "jet" | "warthog";

/** Per-frame pixel look deltas are normalised by this divisor into -1..1. */
const LOOK_GAIN = 36;

export class Aircraft {
  readonly kind: AircraftKind;
  readonly group: THREE.Group;
  readonly radius: number;
  readonly label: string;
  /** Single-seat craft: occupied by the driver or free to board. */
  occupied = false;
  readonly flight: FlightState;

  constructor(kind: AircraftKind, group: THREE.Group, spawn: THREE.Vector3, yaw: number) {
    this.kind = kind;
    this.group = group;
    this.radius = CONFIG.flight.radius;
    this.label = kind === "warthog" ? "A-10 warthog" : "ground-attack jet";
    this.flight = createFlightState(
      spawn.x,
      spawn.y + CONFIG.flight.groundOffset,
      spawn.z,
      yaw
    );
    // Heading, then pitch, then bank — the standard aircraft Euler order.
    group.rotation.order = "YXZ";
    this.syncTransform();
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get onGround(): boolean {
    return this.flight.onGround;
  }

  /** Collision volumes fed to the C/WASM vehicle rays each frame. */
  volume(): { x: number; y: number; z: number; r: number } {
    return { x: this.flight.x, y: this.flight.y, z: this.flight.z, r: this.radius };
  }

  update(dt: number, input: InputState | null, physics: Physics, world: World): void {
    const ground = world.heightAt(this.flight.x, this.flight.z);

    let controls: FlightInput;
    if (input && this.occupied) {
      const look = input.consumeLook();
      controls = {
        throttle: clamp(input.moveY, -1, 1),
        roll: clamp(input.moveX, -1, 1),
        // Drag down = pull back = nose up, hence the inverted sign.
        pitch: clamp(-look.dy / LOOK_GAIN, -1, 1),
        yaw: clamp(-look.dx / LOOK_GAIN, -1, 1),
      };
    } else {
      // Idle craft spools down and settles onto the terrain by itself.
      controls = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    }

    stepFlight(this.flight, controls, dt, ground, CONFIG.flight);

    // Only the ground roll collides with static cover; airborne flight
    // clears obstacles by altitude.
    if (this.flight.onGround) {
      const [rx, rz] = physics.resolveCircles(
        this.flight.x,
        this.flight.z,
        this.radius
      );
      this.flight.x = rx;
      this.flight.z = rz;
    }

    this.syncTransform();
  }

  private syncTransform(): void {
    this.group.position.set(this.flight.x, this.flight.y, this.flight.z);
    // The airframe models face +Z; the game faces -Z at yaw 0. For a +Z
    // model, nose-up is negative local X and a right bank is negative Z.
    this.group.rotation.set(
      -this.flight.pitch,
      this.flight.yaw + Math.PI,
      -this.flight.roll
    );
  }
}
