/*
 * Hyperreal arcade first-person locomotion — pure, deterministic kernel
 * with no THREE/IO imports. The camera rig (FirstPersonRig) only reads
 * this state. Ground contact comes from any (x,z)=>height sampler, so
 * the same kernel walks the locked terrain, test stubs or future meshes.
 *
 * Feel layers: acceleration-curved movement, sprint/crouch gaits,
 * jump arc with landing dip, two-frequency head bob, breathing, damped
 * look sway, body lean, slope blocking, wading, sprint FOV impulse.
 */

export interface FpInput {
  /** Strafe, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward, -1 (back) .. 1 (forward). */
  moveZ: number;
  /** Look deltas already scaled to radians by the input layer. */
  lookDX: number;
  lookDY: number;
  sprint: boolean;
  crouch: boolean;
  /** Edge-triggered jump request (input layer sets true for one frame). */
  jump: boolean;
  /** Lean -1 (left) .. 1 (right). */
  lean: number;
}

export interface FpState {
  x: number;
  y: number; // eye position
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  wading: boolean;
  bobPhase: number;
  bobX: number;
  bobY: number;
  swayX: number;
  swayY: number;
  lean: number;
  landDip: number;
  eyeHeight: number;
  speed: number;
  fovKick: number;
  /** Accumulated simulation time (deterministic breathing clock). */
  clock: number;
  /** True on the frame a footstep phase boundary is crossed (audio hook). */
  footPulse: boolean;
}

export const FP_CONFIG = {
  eyeStand: 1.7,
  eyeCrouch: 1.02,
  walkSpeed: 4.6,
  sprintSpeed: 7.8,
  crouchSpeed: 2.3,
  groundRate: 12.0,
  airRate: 2.6,
  gravity: 20.0,
  jumpSpeed: 7.4,
  pitchLimit: 1.55,
  lookGain: 2.3,
  maxStepHeight: 0.95,
  probeDistance: 1.1,
  maxSlopeLean: 0.09,
  waterEye: 0.34,
  wadeScale: 0.55,
  baseFov: 68,
  sprintFov: 77
} as const;

export const EMPTY_INPUT: FpInput = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  sprint: false,
  crouch: false,
  jump: false,
  lean: 0
};

export function createFpState(x: number, groundY: number, z: number, yaw = 0): FpState {
  return {
    x,
    y: groundY + FP_CONFIG.eyeStand,
    z,
    yaw,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    wading: groundY < 0,
    bobPhase: 0,
    bobX: 0,
    bobY: 0,
    swayX: 0,
    swayY: 0,
    lean: 0,
    landDip: 0,
    eyeHeight: FP_CONFIG.eyeStand,
    speed: 0,
    fovKick: 0,
    clock: 0,
    footPulse: false
  };
}

const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

export function stepFp(
  state: FpState,
  input: FpInput,
  dtRaw: number,
  groundAt: (x: number, z: number) => number
): FpState {
  const dt = Math.min(0.05, Math.max(0, dtRaw));
  const cfg = FP_CONFIG;
  state.footPulse = false;
  state.clock += dt;

  /* ----------------------------- look ---------------------------------- */
  state.yaw -= input.lookDX * cfg.lookGain;
  state.pitch = Math.max(
    -cfg.pitchLimit,
    Math.min(cfg.pitchLimit, state.pitch - input.lookDY * cfg.lookGain)
  );
  // Restrained inertia lag behind look impulses.
  state.swayX = damp(state.swayX, Math.max(-0.05, Math.min(0.05, -input.lookDY * 0.55)), 9, dt);
  state.swayY = damp(state.swayY, Math.max(-0.06, Math.min(0.06, -input.lookDX * 0.55)), 9, dt);
  state.lean = damp(state.lean, input.lean * cfg.maxSlopeLean, 8, dt);

  /* --------------------------- stance ---------------------------------- */
  const targetEye = input.crouch ? cfg.eyeCrouch : cfg.eyeStand;
  state.eyeHeight = damp(state.eyeHeight, targetEye, 10, dt);

  /* ---------------------- horizontal locomotion ------------------------ */
  const mag = Math.min(1, Math.hypot(input.moveX, input.moveZ));
  const groundHere = groundAt(state.x, state.z);
  state.wading = groundHere < 0;
  let targetSpeed = input.crouch
    ? cfg.crouchSpeed
    : input.sprint && input.moveZ > 0.1
      ? cfg.sprintSpeed
      : cfg.walkSpeed;
  if (state.wading) targetSpeed *= cfg.wadeScale;

  // Yaw 0 looks down -Z: forward = (-sin, -cos), right = (cos, -sin).
  const fx = -Math.sin(state.yaw);
  const fz = -Math.cos(state.yaw);
  const rx = Math.cos(state.yaw);
  const rz = -Math.sin(state.yaw);
  let wishX = (rx * input.moveX + fx * input.moveZ) * targetSpeed * mag;
  let wishZ = (rz * input.moveX + fz * input.moveZ) * targetSpeed * mag;

  // Slope blocker: an unjumpable step directly ahead cancels movement.
  if (state.onGround && mag > 0) {
    const ahead = groundAt(
      state.x + (wishX / (targetSpeed || 1)) * cfg.probeDistance,
      state.z + (wishZ / (targetSpeed || 1)) * cfg.probeDistance
    );
    if (ahead - groundHere > cfg.maxStepHeight) {
      wishX = 0;
      wishZ = 0;
    }
  }

  const rate = state.onGround ? cfg.groundRate : cfg.airRate;
  state.vx = damp(state.vx, wishX, rate, dt);
  state.vz = damp(state.vz, wishZ, rate, dt);
  state.speed = Math.hypot(state.vx, state.vz);

  /* ------------------------------ vertical ----------------------------- */
  if (state.onGround && input.jump && !state.wading) {
    state.vy = cfg.jumpSpeed;
    state.onGround = false;
  }
  state.vy -= cfg.gravity * dt;
  if (state.wading && state.vy < 0) state.vy *= 0.82; // buoyant settle in water

  const feetY = state.y - state.eyeHeight;
  const nextFeet = feetY + state.vy * dt;
  const groundY = groundAt(state.x, state.z);

  if (nextFeet <= groundY) {
    if (!state.onGround && state.vy < -6) {
      state.landDip = Math.min(0.22, (-state.vy - 6) * 0.022);
    }
    state.vy = 0;
    state.onGround = true;
    state.y = groundY + state.eyeHeight;
  } else {
    state.onGround = false;
    state.y = nextFeet + state.eyeHeight;
  }
  // Swimming: eye never sinks below the wade line.
  if (state.wading) state.y = Math.max(state.y, cfg.waterEye);

  state.x += state.vx * dt;
  state.z += state.vz * dt;

  /* --------------------------- feel layers ----------------------------- */
  const moving = state.onGround && state.speed > 0.25 && mag > 0;
  const before = Math.floor(state.bobPhase);
  if (moving) {
    state.bobPhase += dt * (5.6 + state.speed * 1.18);
  }
  if (Math.floor(state.bobPhase) !== before) state.footPulse = true;

  const intensity = Math.min(1, state.speed / 5);
  const breathing = Math.sin(state.clock * 1.6) * 0.004;
  state.bobY =
    (moving ? Math.sin(state.bobPhase * 2) * 0.046 * intensity + Math.sin(state.bobPhase * 4) * 0.013 * intensity : 0) +
    breathing;
  state.bobX = moving ? Math.cos(state.bobPhase * 2) * 0.034 * intensity : 0;
  state.landDip = Math.max(0, state.landDip - dt * 0.85);
  state.fovKick = damp(state.fovKick, moving && input.sprint ? 1 : 0, 6, dt);

  return state;
}
