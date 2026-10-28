/*
 * First-person controller kernel tests — pure, deterministic, no DOM.
 * Run: npx tsx tests/controller.test.ts
 */

import { createFpState, EMPTY_INPUT, FP_CONFIG, stepFp, type FpInput, type FpState } from "../src/player/controller";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DT = 1 / 60;
const flat = () => 0;

function run(s: FpState, input: FpInput, seconds: number, ground: (x: number, z: number) => number = flat) {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepFp(s, input, DT, ground);
}

console.log("Stance and ground follow:");
{
  const s = createFpState(0, 0, 0);
  check("idle starts grounded at eye height", s.onGround && Math.abs(s.y - FP_CONFIG.eyeStand) < 1e-9);
  run(s, { ...EMPTY_INPUT }, 0.5);
  check("idle stays grounded with zero drift", s.onGround && Math.abs(s.x) < 1e-6 && Math.abs(s.z) < 1e-6);
  check("idle bob is zero except breathing", Math.abs(s.bobX) < 1e-9 && Math.abs(s.bobY) < 0.01);
}

console.log("Movement:");
{
  const s = createFpState(0, 0, 0);
  run(s, { ...EMPTY_INPUT, moveZ: 1 }, 1.2);
  check("forward walks toward -Z at yaw 0", s.z < -3 && Math.abs(s.x) < 0.5, `z=${s.z.toFixed(2)}`);
  check("cruise near walk speed", Math.abs(s.speed - FP_CONFIG.walkSpeed) < 0.6, `${s.speed.toFixed(2)}`);

  const sprint = createFpState(0, 0, 0);
  run(sprint, { ...EMPTY_INPUT, moveZ: 1, sprint: true }, 1.2);
  check("sprint beats walk", sprint.speed > s.speed + 1.2, `${sprint.speed.toFixed(2)} vs ${s.speed.toFixed(2)}`);

  const back = createFpState(0, 0, 0);
  run(back, { ...EMPTY_INPUT, moveZ: -1 }, 1.0);
  check("backpedal heads toward +Z", back.z > 2);

  const strafe = createFpState(0, 0, 0);
  run(strafe, { ...EMPTY_INPUT, moveX: 1 }, 1.0);
  check("right strafe heads toward +X", strafe.x > 2);
}

console.log("Look and lean:");
{
  const s = createFpState(0, 0, 0);
  stepFp(s, { ...EMPTY_INPUT, lookDX: 0.3 }, DT, flat);
  check("look right turns yaw negative", s.yaw < 0);
  for (let i = 0; i < 40; i++) stepFp(s, { ...EMPTY_INPUT, lookDY: 1 }, DT, flat);
  check("pitch clamps at the limit", Math.abs(s.pitch) <= FP_CONFIG.pitchLimit + 1e-9);
  const lean = createFpState(0, 0, 0);
  run(lean, { ...EMPTY_INPUT, lean: 1 }, 0.6);
  check("lean settles toward the configured max", Math.abs(lean.lean - FP_CONFIG.maxSlopeLean) < 0.02);
}

console.log("Jump and landing:");
{
  const s = createFpState(0, 0, 0);
  stepFp(s, { ...EMPTY_INPUT, jump: true }, DT, flat);
  check("jump leaves the ground", !s.onGround && s.vy > 0);
  run(s, { ...EMPTY_INPUT }, 1.4);
  check("lands back on the ground", s.onGround && Math.abs(s.y - FP_CONFIG.eyeStand) < 0.02, `${s.y.toFixed(2)}`);

  // Hard landing dip: spawn on a 6 m ledge and walk off onto the floor.
  const ledge = (x: number) => (x > 0.5 ? 6 : 0);
  const l2 = createFpState(1, 6, 0);
  run(l2, { ...EMPTY_INPUT, moveX: -1 }, 1.4, ledge);
  check("hard landing registers a dip", l2.onGround && l2.landDip >= 0, `dip=${l2.landDip.toFixed(3)}`);
}

console.log("Slope blocking:");
{
  // A >0.95m step 1.1m ahead should block horizontal movement.
  const wall = (x: number) => (x > 0.6 ? 3 : 0);
  const s = createFpState(0, 0, 0);
  run(s, { ...EMPTY_INPUT, moveX: 1 }, 1.0, wall);
  check("unclimbable step blocks the player", s.x < 0.7, `x=${s.x.toFixed(2)}`);
}

console.log("Wading:");
{
  const state = createFpState(0, -2, 0);
  run(state, { ...EMPTY_INPUT, moveZ: 1 }, 1.0, () => -2);
  check("wading flag raises below sea level", state.wading);
  check("wading slows the player", state.speed < FP_CONFIG.walkSpeed * 0.7, `${state.speed.toFixed(2)}`);
  check("eye stays above the wade line", state.y >= FP_CONFIG.waterEye - 1e-9);
}

console.log("Bob and footstep:");
{
  const moving = createFpState(0, 0, 0);
  run(moving, { ...EMPTY_INPUT, moveZ: 1 }, 1.0);
  check("moving bob displaces the head", Math.abs(moving.bobX) > 0.005 || Math.abs(moving.bobY) > 0.005);
  let pulses = 0;
  const walker = createFpState(0, 0, 0);
  for (let i = 0; i < 120; i++) {
    stepFp(walker, { ...EMPTY_INPUT, moveZ: 1 }, DT, flat);
    if (walker.footPulse) pulses++;
  }
  check("footstep pulses fire while walking", pulses >= 4, `${pulses}`);
}

console.log("Determinism and NaN fuzz:");
{
  const a = createFpState(2, 1, -3, 0.4);
  const b = createFpState(2, 1, -3, 0.4);
  const inA: FpInput = { moveX: 0.4, moveZ: 0.8, lookDX: 0.02, lookDY: -0.01, sprint: true, crouch: false, jump: false, lean: 0.3 };
  const inB = { ...inA };
  for (let i = 0; i < 240; i++) {
    stepFp(a, inA, DT, (x, z) => Math.sin(x * 0.1) * 2 + Math.cos(z * 0.13) * 2);
    stepFp(b, inB, DT, (x, z) => Math.sin(x * 0.1) * 2 + Math.cos(z * 0.13) * 2);
  }
  check("identical inputs give identical states", a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw);

  let nan = false;
  const fuzz = createFpState(0, 0, 0);
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2000; i++) {
    stepFp(
      fuzz,
      {
        moveX: rnd() * 2 - 1,
        moveZ: rnd() * 2 - 1,
        lookDX: (rnd() - 0.5) * 0.2,
        lookDY: (rnd() - 0.5) * 0.2,
        sprint: rnd() > 0.5,
        crouch: rnd() > 0.7,
        jump: rnd() > 0.9,
        lean: rnd() * 2 - 1
      },
      rnd() * 0.05,
      (x, z) => Math.sin(x * 0.3) * 4 + Math.cos(z * 0.21) * 4
    );
    if (![fuzz.x, fuzz.y, fuzz.z, fuzz.yaw, fuzz.pitch, fuzz.vx, fuzz.vy, fuzz.vz].every(Number.isFinite)) {
      nan = true;
      break;
    }
  }
  check("2000 random frames produce no NaN/Infinity", !nan);
}

console.log(failures === 0 ? "\nFP controller: all checks passed." : `\nFP controller: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
