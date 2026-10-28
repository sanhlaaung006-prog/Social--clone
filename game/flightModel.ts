/*
 * Pure arcade flight model — no THREE, no I/O, deterministic given the same
 * inputs. The Aircraft class (game/vehicles/aircraft.ts) owns the scene
 * object and feeds ground heights in; everything aerodynamic lives here so
 * the whole flight envelope is headless-testable.
 *
 * Conventions match the ground vehicles: yaw 0 faces world -Z, positive
 * pitch means nose-up, positive roll means banking right.
 */

export interface FlightState {
  x: number;
  y: number;
  z: number;
  /** Heading around Y (world convention, 0 = -Z). */
  yaw: number;
  /** Nose angle, +up, clamped to CONFIG.flight.maxPitch. */
  pitch: number;
  /** Bank angle, +right, clamped to CONFIG.flight.maxBank. */
  roll: number;
  /** Airspeed in m/s along the nose. */
  speed: number;
  /** Throttle setting, 0..1. */
  throttle: number;
  /** Vertical speed in m/s (positive climbing). */
  vs: number;
  onGround: boolean;
}

export interface FlightInput {
  /** Joystick Y: +1 throttle up, -1 throttle down / brake. */
  throttle: number;
  /** Joystick X: +1 bank/steer right, -1 left. */
  roll: number;
  /** Look drag mapped to -1..1: +1 pull back (nose up). */
  pitch: number;
  /** Look drag mapped to -1..1: rudder trim. */
  yaw: number;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Move `current` toward `target` at most `maxDelta`. */
function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

export function createFlightState(
  x: number,
  y: number,
  z: number,
  yaw: number
): FlightState {
  return {
    x,
    y,
    z,
    yaw,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    vs: 0,
    onGround: true,
  };
}

/**
 * Advance the flight state by dt seconds.
 * @param groundHeight terrain elevation under the craft (metres)
 */
export function stepFlight(
  s: FlightState,
  input: FlightInput,
  dt: number,
  groundHeight: number,
  cfg: FlightConfig
): FlightState {
  const throttleTarget = clamp(input.throttle, -1, 1);
  s.throttle = approach(
    s.throttle,
    clamp(s.throttle + throttleTarget * cfg.throttleRate * dt, 0, 1),
    cfg.throttleRate * dt
  );

  // Longitudinal: engine thrust minus quadratic drag; extra rolling
  // friction on the ground when the pilot is off the throttle.
  let accel = s.throttle * cfg.engineAccel - cfg.dragK * s.speed * s.speed;
  if (s.onGround && throttleTarget <= 0) accel -= cfg.groundFriction;
  s.speed = clamp(s.speed + accel * dt, 0, cfg.maxSpeed);

  if (s.onGround) {
    // Ground roll: wings level, nose-wheel steering speed-scaled.
    s.roll = approach(s.roll, 0, cfg.rollRate * dt);
    s.pitch = approach(s.pitch, 0, cfg.pitchRate * dt);
    const steerFactor = clamp(s.speed / 8, 0, 1);
    s.yaw -= input.roll * cfg.groundSteer * steerFactor * dt;

    // Rotate once the wing has flying speed and the pilot pulls back.
    if (s.speed >= cfg.takeoffSpeed && input.pitch > 0.3) {
      s.onGround = false;
    }
    s.y = groundHeight + cfg.groundOffset;
    s.vs = 0;
    return s;
  }

  /* -------------------------------- airborne ------------------------------- */

  // Attitude targets approached at fixed rates (no instant control).
  const targetRoll = clamp(input.roll, -1, 1) * cfg.maxBank;
  s.roll = approach(s.roll, targetRoll, cfg.rollRate * dt);
  const targetPitch = clamp(input.pitch, -1, 1) * cfg.maxPitch;
  s.pitch = approach(s.pitch, targetPitch, cfg.pitchRate * dt);

  // Stall: below flying speed the wing cannot hold altitude and the nose
  // drops by itself regardless of stick input.
  if (s.speed < cfg.stallSpeed) {
    s.pitch = clamp(s.pitch - cfg.stallMoment * dt, -cfg.maxPitch, cfg.maxPitch);
  }

  // Coordinated turn: bank pulls the nose around; rudder trims on top.
  const bankPull =
    Math.sin(s.roll) *
    cfg.turnCoordinator *
    clamp(s.speed / cfg.stallSpeed, 0, 1);
  s.yaw -= bankPull * dt;
  s.yaw += clamp(input.yaw, -1, 1) * cfg.yawRate * dt;

  // Velocity follows the nose vector (yaw 0 -> -Z, pitch lifts +Y).
  const cp = Math.cos(s.pitch);
  const fx = -Math.sin(s.yaw) * cp;
  const fz = -Math.cos(s.yaw) * cp;
  const fy = Math.sin(s.pitch);
  s.x += fx * s.speed * dt;
  s.z += fz * s.speed * dt;

  // Lift vs weight: at/above stall speed the wing supports the craft; below
  // it the deficit becomes a sink rate, which is what makes a stall descend.
  const liftK = cfg.gravity / (cfg.stallSpeed * cfg.stallSpeed);
  const sink = Math.max(0, cfg.gravity - liftK * s.speed * s.speed);
  s.vs = fy * s.speed - sink;
  s.y += s.vs * dt;

  // Hard ceiling: level the nose so the craft cannot hang on its prop.
  if (s.y > cfg.ceiling) {
    s.y = cfg.ceiling;
    s.pitch = Math.min(s.pitch, 0);
    s.vs = Math.min(s.vs, 0);
  }

  // Terrain contact: gentle touchdown lands, a hard impact bleeds speed.
  const floor = groundHeight + cfg.groundOffset;
  if (s.y <= floor) {
    const hardLanding = s.vs < -cfg.hardLandingVs;
    s.y = floor;
    s.onGround = true;
    s.vs = 0;
    s.roll = 0;
    s.pitch = 0;
    if (hardLanding) s.speed *= 0.7;
  }

  return s;
}

export interface FlightConfig {
  groundOffset: number;
  maxSpeed: number;
  takeoffSpeed: number;
  stallSpeed: number;
  throttleRate: number;
  engineAccel: number;
  dragK: number;
  groundFriction: number;
  rollRate: number;
  maxBank: number;
  pitchRate: number;
  maxPitch: number;
  yawRate: number;
  turnCoordinator: number;
  groundSteer: number;
  stallMoment: number;
  gravity: number;
  ceiling: number;
  hardLandingVs: number;
}
