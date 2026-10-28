/*
 * Bot perception/tactics tests (npx tsx scripts/bot-ai.test.ts).
 * Headless stubs for World/Physics: rayCover runs a real sphere-ray against
 * the obstacle list, rayTerrain always misses, movement is identity unless
 * pinned. Verifies LOS gating, reaction delay, last-seen memory/search,
 * cover retreat, and stall-triggered repath — no renderer or DOM.
 */

import * as THREE from "three";
import { Bot, Player } from "../game/actors";
import { Rng } from "../game/rng";
import { CONFIG } from "../game/config";
import type { World } from "../game/world";
import type { Physics } from "../game/wasm/physics";
import type { CircleObstacle } from "../game/world";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

class CountingRng extends Rng {
  rangeCalls = 0;
  override range(min: number, max: number): number {
    this.rangeCalls++;
    return super.range(min, max);
  }
}

interface Harness {
  world: World;
  physics: Physics;
  obstacles: CircleObstacle[];
  pin: boolean;
  spawn: THREE.Vector3;
}

function makeHarness(obstacles: CircleObstacle[] = [], pin = false): Harness {
  const spawn = new THREE.Vector3(0, 1, 0);
  const h: Harness = {
    obstacles,
    pin,
    spawn,
    world: undefined as unknown as World,
    physics: undefined as unknown as Physics,
  };
  h.world = {
    obstacles,
    heightAt: () => 1, // above CONFIG.world.waterLevel (0.6)
  } as unknown as World;
  h.physics = {
    resolveCircles: (x: number, z: number): [number, number] => {
      if (pin) return [spawn.x, spawn.z];
      // Mirror the real core's static-circle push-out so bots cannot walk
      // through cover in the stub world.
      for (const o of obstacles) {
        const dx = x - o.x;
        const dz = z - o.z;
        const min = o.r + CONFIG.player.radius;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-6) {
          x = o.x + (dx / d) * min;
          z = o.z + (dz / d) * min;
        }
      }
      return [x, z];
    },
    resolveAgainstVehicles: (x: number, z: number): [number, number] => [x, z],
    rayTerrain: () => -1,
    rayCover(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
      // Faithful ray-vs-expanded-sphere test at the engine's cover height.
      let best = maxT;
      for (const o of obstacles) {
        const ex = origin.x - o.x;
        const ey = origin.y - 1.5;
        const ez = origin.z - o.z;
        const b = ex * dir.x + ey * dir.y + ez * dir.z;
        const c = ex * ex + ey * ey + ez * ez - o.r * o.r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const s = Math.sqrt(disc);
        let t = -b - s;
        if (t < 0.01) t = -b + s;
        if (t > 0.01 && t < best) best = t;
      }
      return best >= maxT ? -1 : best;
    },
  } as unknown as Physics;
  return h;
}

function makeBot(h: Harness, seed: number, rng = new Rng(seed)): Bot {
  return new Bot(h.world, h.physics, `BOT-${seed}`, h.spawn.clone(), rng);
}

function makePlayer(h: Harness): Player {
  return new Player(h.world, h.physics);
}

const DT = 1 / 30;
const ZONE_CENTER = new THREE.Vector3(0, 0, 0);
const ZONE_RADIUS = 200;

function step(bot: Bot, player: Player, frames: number): number {
  let shots = 0;
  for (let i = 0; i < frames; i++) {
    if (bot.update(DT, player, ZONE_CENTER, ZONE_RADIUS)) shots++;
  }
  return shots;
}

console.log("Reaction delay:");
{
  const h = makeHarness();
  const bot = makeBot(h, 11);
  const player = makePlayer(h);
  player.position.set(20, 1, 0);
  const earlyFrames = Math.floor(CONFIG.bot.reactMin / DT) - 2;
  const earlyShots = step(bot, player, earlyFrames);
  check("no shot before the minimum reaction window", earlyShots === 0,
    `got ${earlyShots} in ${earlyFrames} frames`);
  check("bot enters engage on confirmed sight", bot.aiState === "engage");
  const laterShots = step(bot, player, Math.ceil(4 / DT));
  check("bot fires after the reaction window", laterShots > 0, `got ${laterShots}`);
}

console.log("Line of sight gating (no wallhack):");
{
  const h = makeHarness([{ x: 4, z: 0, r: 3 }]);
  const bot = makeBot(h, 22);
  const player = makePlayer(h);
  player.position.set(10, 1, 0); // obstacle sits directly between them
  // Two seconds: enough to prove LOS is respected but shorter than the
  // long walk around the obstacle's perimeter.
  const shots = step(bot, player, Math.ceil(2 / DT));
  check("occluded bot never fires", shots === 0, `got ${shots}`);
  check("occluded bot never enters engage", bot.aiState === "patrol",
    `state=${bot.aiState}`);
}

console.log("Last-seen memory and search:");
{
  const h = makeHarness();
  const bot = makeBot(h, 33);
  const player = makePlayer(h);
  player.position.set(15, 1, 0);
  step(bot, player, 40); // 1.33s of confirmed contact
  check("acquires engage first", bot.aiState === "engage");
  player.position.set(100, 1, 0); // vanishes beyond sight range
  step(bot, player, 2);
  check("losing sight transitions to search", bot.aiState === "search",
    `state=${bot.aiState}`);
  const x0 = bot.position.x;
  step(bot, player, 15);
  check("search moves toward the last-known position", bot.position.x > x0 + 1,
    `x0=${x0} x=${bot.position.x}`);
  step(bot, player, Math.ceil((CONFIG.bot.memoryTime + 1) / DT));
  check("stale memory falls back to patrol", bot.aiState === "patrol",
    `state=${bot.aiState}`);
}

console.log("Cover retreat on low HP:");
{
  // Off-axis obstacle: direct LOS to the player stays clear, but the
  // far-side candidate behind the obstacle is occluded from the player.
  const h = makeHarness([{ x: -6, z: 8, r: 3 }]);
  const bot = makeBot(h, 44);
  const player = makePlayer(h);
  player.position.set(20, 1, 0);
  bot.applyDamage(CONFIG.bot.maxHp * (1 - CONFIG.bot.coverHpFrac / 2));
  step(bot, player, 3);
  check("wounded bot breaks off to cover", bot.aiState === "cover",
    `state=${bot.aiState}`);
  // The hold timer starts only after arrival; mid-window it must still be
  // holding rather than oscillating back into engage.
  step(bot, player, Math.ceil(3.5 / DT));
  check("bot stays committed to cover while holding", bot.aiState === "cover",
    `state=${bot.aiState}`);
  step(bot, player, Math.ceil(2.5 / DT)); // past travel (~2.5s) + hold (2.4s)
  check("cover hold ends back in search", bot.aiState === "search",
    `state=${bot.aiState}`);
}

console.log("Stall-triggered repath:");
{
  const h = makeHarness([], true); // physics pins the bot at spawn
  const rng = new CountingRng(55);
  const bot = makeBot(h, 55, rng);
  const player = makePlayer(h);
  const baseline = rng.rangeCalls;
  step(bot, player, Math.ceil(3 / DT));
  check("a stuck patrol bot keeps requesting new waypoints",
    rng.rangeCalls > baseline + 2, `baseline=${baseline} now=${rng.rangeCalls}`);
}

console.log("Long-run stability:");
{
  const h = makeHarness([{ x: 8, z: 4, r: 2.5 }, { x: -10, z: -6, r: 2 }]);
  const bot = makeBot(h, 66);
  const player = makePlayer(h);
  player.position.set(30, 1, 0);
  step(bot, player, 600);
  check("bot position stays finite",
    Number.isFinite(bot.position.x) && Number.isFinite(bot.position.z));
  check("AI state stays inside the known state set",
    ["patrol", "search", "engage", "cover", "dead"].includes(bot.aiState));
}

if (failures > 0) {
  console.error(`\nBot AI: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nBot AI: all checks passed");
