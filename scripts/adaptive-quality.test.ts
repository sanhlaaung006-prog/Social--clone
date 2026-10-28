/*
 * Adaptive render-scale governor tests (npx tsx scripts/adaptive-quality.test.ts).
 * Pure frame-time logic, no renderer: sustained-slow downgrade, cooldown,
 * floor, sustained-fast recovery, mid-range hold, disabled passthrough.
 */

import { AdaptiveResolution, type AdaptiveScaleOptions } from "../game/adaptiveQuality";
import { CONFIG } from "../game/config";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const approx = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const opts: AdaptiveScaleOptions = CONFIG.quality.adaptive;

function feed(g: AdaptiveResolution, dt: number, frames: number): number {
  let changes = 0;
  for (let i = 0; i < frames; i++) if (g.sample(dt)) changes++;
  return changes;
}

console.log("Downgrade path:");
{
  const g = new AdaptiveResolution(opts, true);
  check("starts at full scale", g.scale === 1);
  // 30 fps (dt 1/30) is below the 48 fps slow threshold. +2 frames covers
  // float accumulation (90 additions of 1/30 land just under 3.0).
  const changes = feed(g, 1 / 30, Math.ceil(opts.sustainSlow * 30) + 2);
  check("one downgrade after the sustained-slow window", changes === 1,
    `got ${changes}`);
  check("scale steps down by the configured step", approx(g.scale, 1 - opts.step));
  const more = feed(g, 1 / 30, Math.ceil((opts.cooldown + opts.sustainSlow) * 30) + 2);
  check("cooldown spaces further downgrades", more >= 1);
  // Run long enough to hit the floor.
  feed(g, 1 / 30, 60 * 30);
  check("scale never drops below the floor", g.scale >= opts.minScale,
    `got ${g.scale}`);
  check("scale settles exactly on the floor", approx(g.scale, opts.minScale));
}

console.log("Recovery path:");
{
  const g = new AdaptiveResolution(opts, true);
  feed(g, 1 / 30, Math.ceil(opts.sustainSlow * 30) + 2); // -> 0.9 (+2 float margin)
  const downgraded = g.scale;
  // 120 fps is above the 58 fps fast threshold. +2 frames for float margin.
  const changes = feed(g, 1 / 120, Math.ceil((opts.cooldown + opts.sustainFast) * 120) + 2);
  check("sustained fast frames buy one recovery step", changes === 1,
    `got ${changes}`);
  check("recovery returns toward full scale", g.scale > downgraded && g.scale <= 1);
  feed(g, 1 / 120, 60 * 120);
  check("recovery never exceeds full scale", g.scale === 1);
}

console.log("Mid-range hold:");
{
  const g = new AdaptiveResolution(opts, true);
  // 55 fps sits between slowFps (48) and fastFps (58): must hold scale.
  const changes = feed(g, 1 / 55, 10 * 55);
  check("comfortable frame rates never change scale", changes === 0 && g.scale === 1);
}

console.log("Lifecycle and guards:");
{
  const g = new AdaptiveResolution(opts, false);
  check("disabled governor reports inactive", !g.active);
  const changes = feed(g, 1 / 20, 60 * 20);
  check("disabled governor never changes scale", changes === 0 && g.scale === 1);

  const live = new AdaptiveResolution(opts, true);
  check("zero dt is ignored", live.sample(0) === false && live.scale === 1);
  check("negative dt is ignored", live.sample(-1 / 60) === false && live.scale === 1);
  check("single slow frame does nothing", live.sample(1 / 20) === false);
  check("enabled governor reports active", live.active);
}

if (failures > 0) {
  console.error(`\nAdaptive quality: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAdaptive quality: all checks passed");
