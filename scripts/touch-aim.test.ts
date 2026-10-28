/*
 * TouchAim gesture-filter tests (npx tsx scripts/touch-aim.test.ts).
 * Verifies slop swallowing, frame-rate-independent smoothing, tail
 * preservation on lift, hard reset on cancel, and ADS gain — all without
 * a browser or DOM.
 */

import { TouchAim, SLOP_PX, SMOOTH_TAU, AIM_GAIN } from "../game/touchAim";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const alpha60 = 1 - Math.exp(-(1 / 60) / SMOOTH_TAU);

/** What TouchAim queues after one breaking move: the input vector with the
 *  slop radius removed along its own axis. */
function queued(dx: number, dy: number) {
  const r = Math.hypot(dx, dy);
  const f = (r - SLOP_PX) / r;
  return { x: dx * f, y: dy * f };
}

function drain(aim: TouchAim, frames: number, dt: number, gain = 1) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < frames; i++) {
    const d = aim.pump(dt, gain);
    x += d.dx;
    y += d.dy;
  }
  return { x, y };
}

console.log("Gesture slop:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(3, 4); // exactly SLOP_PX radius -> still inside
  let d = aim.pump(1 / 60);
  check("movement inside slop radius emits nothing", d.dx === 0 && d.dy === 0);
  aim.move(1, 0); // slop vector now (4,4), radius ~5.66 -> breaks
  d = aim.pump(1 / 60);
  check("slop break emits only the sub-pixel excess",
    d.dx > 0 && d.dy > 0 && Math.hypot(d.dx, d.dy) < 1,
    `got ${d.dx},${d.dy}`);
  check("slop constant is 5px", SLOP_PX === 5);
}

console.log("Slop excess magnitude:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(10, 0); // 5px swallowed, 5px queued
  const total = drain(aim, 120, 1 / 60);
  check("only motion beyond slop reaches the queue", approx(total.x, 5, 1e-6),
    `got ${total.x}`);
}

console.log("Smoothing behaviour:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(100, 0); // queues 95 after slop
  const first = aim.pump(1 / 60);
  check("first frame passes through only one low-pass fraction",
    approx(first.dx, 95 * alpha60, 1e-9), `got ${first.dx}`);
  check("smoothing never overshoots the queued input", first.dx < 95);
}

console.log("Energy conservation:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(100, -50);
  const q = queued(100, -50);
  const total = drain(aim, 180, 1 / 60);
  check("full drain reproduces the queued gesture on x", approx(total.x, q.x, 1e-4),
    `got ${total.x} want ${q.x}`);
  check("full drain reproduces the queued gesture on y", approx(total.y, q.y, 1e-4),
    `got ${total.y} want ${q.y}`);
  check("queue empties after draining", !aim.hasPending);
}

console.log("Frame-rate independence:");
{
  const slow = new TouchAim();
  slow.begin();
  slow.move(120, 40);
  const at30 = drain(slow, 15, 1 / 30); // 0.5 s at 30 fps

  const fast = new TouchAim();
  fast.begin();
  fast.move(120, 40);
  const at120 = drain(fast, 60, 1 / 120); // same 0.5 s at 120 fps

  check("30 fps and 120 fps converge on x", approx(at30.x, at120.x, 0.6),
    `${at30.x} vs ${at120.x}`);
  check("30 fps and 120 fps converge on y", approx(at30.y, at120.y, 0.3),
    `${at30.y} vs ${at120.y}`);
}

console.log("Gesture lifecycle:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(100, 0); // queues 95
  aim.pump(1 / 60); // consume one low-pass fraction
  aim.end(); // finger lifts: tail must survive
  const tail = drain(aim, 180, 1 / 60);
  check("end() preserves the unsmoothed tail", approx(tail.x, 95 * (1 - alpha60), 1e-4),
    `got ${tail.x}`);

  aim.begin(); // re-touch keeps any prior residual
  aim.move(20, 0); // 5px slop + 15px queued
  const second = drain(aim, 180, 1 / 60);
  check("begin() does not wipe the previous tail", approx(second.x, 15, 1e-4),
    `got ${second.x}`);

  aim.begin();
  aim.move(100, 0);
  aim.pump(1 / 60);
  aim.clear();
  const afterClear = drain(aim, 60, 1 / 60);
  check("clear() hard-drops the pending tail", afterClear.x === 0 && afterClear.y === 0);
  check("clear() leaves no pending state", !aim.hasPending);
}

console.log("ADS precision gain:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(100, 0); // queues 95
  const total = drain(aim, 180, 1 / 60, AIM_GAIN);
  check("aim gain scales output to the configured fraction",
    approx(total.x, 95 * AIM_GAIN, 1e-3), `got ${total.x}`);
  check("aim gain constant is 0.6", AIM_GAIN === 0.6);
}

console.log("Robustness:");
{
  const aim = new TouchAim();
  aim.begin();
  aim.move(50, 50);
  const hugeDt = aim.pump(1); // tab was backgrounded; dt clamps internally
  const q = queued(50, 50);
  check("huge dt stays bounded by the pending queue",
    Math.abs(hugeDt.dx) <= Math.abs(q.x) && Math.abs(hugeDt.dy) <= Math.abs(q.y));
  const zero = aim.pump(0);
  check("zero dt emits nothing", zero.dx === 0 && zero.dy === 0);
  const idle = new TouchAim();
  check("fresh aimer has no pending work", !idle.hasPending);
}

if (failures > 0) {
  console.error(`\nTouchAim: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nTouchAim: all checks passed");
