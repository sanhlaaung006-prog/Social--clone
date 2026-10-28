/*
 * Flight model + Aircraft tests (npx tsx scripts/flight.test.ts).
 * Part 1: pure aerodynamics — envelope, takeoff, turn, stall, landing,
 * ceiling, determinism, NaN guard. Part 2: Aircraft transform conventions
 * against a headless stub world/physics. No renderer or DOM.
 */

import * as THREE from "three";
import {
  createFlightState,
  stepFlight,
  clamp,
  type FlightState,
  type FlightInput,
} from "../game/flightModel";
import { CONFIG } from "../game/config";
import { Aircraft } from "../game/vehicles/aircraft";
import { buildStylizedJet } from "../game/vehicles/stylized";
import type { InputState } from "../game/input";
import type { Physics } from "../game/wasm/physics";
import type { World } from "../game/world";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const cfg = CONFIG.flight;
const GROUND = 2;
const noInput: FlightInput = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
const fullThrottle: FlightInput = { throttle: 1, roll: 0, pitch: 0, yaw: 0 };
const run = (s: FlightState, input: FlightInput, seconds: number, h = GROUND) => {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) stepFlight(s, input, dt, h, cfg);
};
const finiteState = (s: FlightState) =>
  [s.x, s.y, s.z, s.yaw, s.pitch, s.roll, s.speed, s.throttle, s.vs].every(Number.isFinite);

console.log("Ground handling:");
{
  const s = createFlightState(0, GROUND + cfg.groundOffset, 0, 0);
  check("starts grounded and stationary", s.onGround && s.speed === 0);
  run(s, fullThrottle, 4);
  check("throttle accelerates on the runway", s.speed > 12, `speed=${s.speed}`);
  check("stays grounded below rotation speed while level", s.onGround);
}
{
  const s = createFlightState(0, GROUND + cfg.groundOffset, 0, 0);
  s.speed = cfg.takeoffSpeed - 3; // fast roll, but below rotation speed
  run(s, { throttle: 0, roll: 0, pitch: 1, yaw: 0 }, 1);
  check("no lift-off before takeoff speed even when pulling back",
    s.onGround && s.speed < cfg.takeoffSpeed, `speed=${s.speed}`);
}
{
  const s = createFlightState(0, GROUND + cfg.groundOffset, 0, 0);
  run(s, noInput, 6);
  check("idle craft rolls to a stop", s.speed === 0 && s.onGround);
  check("throttle never leaves 0..1", s.throttle >= 0 && s.throttle <= 1);
}

console.log("Takeoff and envelope:");
{
  const s = createFlightState(0, GROUND + cfg.groundOffset, 0, 0);
  run(s, fullThrottle, 6); // build speed past takeoffSpeed
  check("reaches rotation speed", s.speed >= cfg.takeoffSpeed, `speed=${s.speed}`);
  run(s, { throttle: 1, roll: 0, pitch: 1, yaw: 0 }, 1.2);
  check("rotate at speed lifts off", !s.onGround && s.y > GROUND + cfg.groundOffset + 0.5,
    `y=${s.y} ground=${s.onGround}`);
  check("climb registers positive vertical speed", s.vs > 0);
}
{
  const s = createFlightState(0, 50, 0, 0);
  s.onGround = false;
  s.speed = 40;
  run(s, fullThrottle, 40);
  check("speed never exceeds the configured maximum", s.speed <= cfg.maxSpeed + 0.01,
    `speed=${s.speed}`);
  check("airborne state stays finite", finiteState(s));
}

console.log("Attitude and turns:");
{
  const s = createFlightState(0, 40, 0, 0);
  s.onGround = false;
  s.speed = 35;
  const yaw0 = s.yaw;
  run(s, { throttle: 0.6, roll: 1, pitch: 0, yaw: 0 }, 2);
  check("right bank yaws the nose to the right (yaw decreases)",
    s.yaw < yaw0 - 0.05, `yaw ${yaw0} -> ${s.yaw}`);
  check("bank approaches the max-bank limit", Math.abs(s.roll) <= cfg.maxBank + 1e-9);
}
{
  const s = createFlightState(0, 40, 0, 0);
  s.onGround = false;
  s.speed = 35;
  run(s, { throttle: 0.6, roll: 0, pitch: 1, yaw: 0 }, 1);
  check("pull-back pitches the nose up", s.pitch > 0.3, `pitch=${s.pitch}`);
  check("pitch is clamped", s.pitch <= cfg.maxPitch + 1e-9);
}

console.log("Stall and recovery:");
{
  const s = createFlightState(0, 80, 0, 0); // high enough to stay airborne
  s.onGround = false;
  s.speed = cfg.stallSpeed - 6;
  const y0 = s.y;
  run(s, { throttle: 0, roll: 0, pitch: 0, yaw: 0 }, 1);
  check("below stall speed the craft sinks", s.y < y0, `y0=${y0} y=${s.y}`);
  check("stall pushes the nose down by itself", s.pitch < 0, `pitch=${s.pitch}`);
}

console.log("Ceiling and landing:");
{
  const s = createFlightState(0, cfg.ceiling - 2, 0, 0);
  s.onGround = false;
  s.speed = 40;
  s.pitch = 0.5;
  run(s, { throttle: 1, roll: 0, pitch: 1, yaw: 0 }, 3);
  check("altitude never passes the ceiling", s.y <= cfg.ceiling + 1e-9, `y=${s.y}`);
}
{
  const s = createFlightState(0, 12, 0, 0);
  s.onGround = false;
  s.speed = 20;
  run(s, noInput, 8);
  check("descending craft eventually touches down", s.onGround, `y=${s.y}`);
  check("rests exactly on the terrain floor",
    Math.abs(s.y - (GROUND + cfg.groundOffset)) < 1e-6, `y=${s.y}`);
  check("wings level after landing", s.roll === 0 && s.pitch === 0);
}

console.log("Determinism and robustness:");
{
  const a = createFlightState(3, GROUND + cfg.groundOffset, -4, 0.7);
  const b = createFlightState(3, GROUND + cfg.groundOffset, -4, 0.7);
  const inputs: FlightInput[] = [
    { throttle: 1, roll: 0.4, pitch: 0.2, yaw: 0 },
    { throttle: 0.7, roll: -0.8, pitch: -0.3, yaw: 0.2 },
    noInput,
    { throttle: 1, roll: 0, pitch: 1, yaw: 0 },
  ];
  const dt = 1 / 60;
  for (let i = 0; i < 600; i++) {
    const inp = inputs[i % inputs.length];
    stepFlight(a, inp, dt, GROUND, cfg);
    stepFlight(b, inp, dt, GROUND, cfg);
  }
  check("identical input sequences produce identical states",
    JSON.stringify(a) === JSON.stringify(b));
}
{
  const s = createFlightState(0, GROUND + cfg.groundOffset, 0, 0);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 1200; i++) {
    stepFlight(
      s,
      { throttle: rnd() * 2 - 1, roll: rnd() * 2 - 1, pitch: rnd() * 2 - 1, yaw: rnd() * 2 - 1 },
      1 / 60,
      GROUND,
      cfg
    );
  }
  check("randomized 20-second run never produces NaN/Infinity", finiteState(s));
  check("clamp helper", clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0 && clamp(0.5, 0, 1) === 0.5);
}

/* ------------------------------ Aircraft class ----------------------------- */

console.log("Aircraft transform conventions:");
{
  const world = { heightAt: () => GROUND } as unknown as World;
  const physics = {
    resolveCircles: (x: number, z: number): [number, number] => [x, z],
  } as unknown as Physics;
  const craft = new Aircraft("jet", buildStylizedJet(), new THREE.Vector3(0, GROUND, 0), 0);
  craft.flight.onGround = false;
  craft.flight.y = 40; // clear the terrain-contact branch
  craft.flight.speed = 35;
  craft.flight.pitch = 0.4;
  craft.flight.roll = 0.35;
  // dt 0 freezes the attitude integration while still applying the transform.
  craft.update(0, null, physics, world);
  craft.group.updateMatrixWorld(true);

  const nose = new THREE.Vector3(0, 0, 1).transformDirection(craft.group.matrixWorld);
  check("nose points along world -Z at yaw 0", nose.z < -0.5, `z=${nose.z}`);
  check("positive pitch lifts the nose", nose.y > 0.1, `y=${nose.y}`);

  const rightWing = new THREE.Vector3(1, 0, 0).transformDirection(craft.group.matrixWorld);
  check("positive roll dips the right wing", rightWing.y < -0.05, `y=${rightWing.y}`);
}

console.log("Aircraft input mapping:");
{
  const world = { heightAt: () => GROUND } as unknown as World;
  const physics = {
    resolveCircles: (x: number, z: number): [number, number] => [x, z],
  } as unknown as Physics;
  const craft = new Aircraft("jet", buildStylizedJet(), new THREE.Vector3(0, GROUND, 0), 0);
  craft.occupied = true;
  const input = {
    moveX: 1,
    moveY: 1,
    lookDX: 0,
    lookDY: 0,
    consumeLook: () => ({ dx: -18, dy: 36 }), // drag down -> nose up; drag left -> rudder
  } as unknown as InputState;
  craft.update(1 / 60, input, physics, world);
  check("boarded craft accepts joystick + look without NaN",
    Number.isFinite(craft.flight.speed) && Number.isFinite(craft.flight.pitch));
  check("joystick throttle opens up", craft.flight.throttle > 0);
}

console.log("Idle aircraft settle:");
{
  const world = { heightAt: () => GROUND } as unknown as World;
  const physics = {
    resolveCircles: (x: number, z: number): [number, number] => [x, z],
  } as unknown as Physics;
  const craft = new Aircraft("jet", buildStylizedJet(), new THREE.Vector3(0, GROUND, 0), 0);
  craft.flight.speed = 30;
  craft.flight.onGround = false;
  craft.flight.y = 30;
  for (let i = 0; i < 600; i++) craft.update(1 / 30, null, physics, world);
  check("vacated craft auto-lands and stops", craft.onGround && craft.flight.speed === 0,
    `ground=${craft.onGround} speed=${craft.flight.speed}`);
}

if (failures > 0) {
  console.error(`\nFlight: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nFlight: all checks passed");
