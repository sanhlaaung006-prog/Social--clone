/*
 * Utility AI tests (npx tsx scripts/bot-utility.test.ts).
 * Part 1 exercises the pure scorer/selector policy with crafted contexts.
 * Part 2 drives real Bots through a headless physics stub to verify ammo,
 * reload behaviour and zone-return execution. No renderer or DOM.
 */

import * as THREE from "three";
import {
  UtilitySelector,
  createUtilityActions,
  exponentialResponse,
  clamp01,
  type BotContext,
  type UtilityAction,
  type BotActionId,
} from "../game/botBrain";
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

const approx = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

function baseContext(over: Partial<BotContext> = {}): BotContext {
  return {
    hasLOS: false,
    distToPlayer: 20,
    attackRange: CONFIG.bot.attackRange,
    hpFrac: 1,
    memoryAge: Infinity,
    memoryTtl: CONFIG.bot.memoryTime,
    outsideZone: false,
    zoneDepth: 0,
    coverAvailable: false,
    coverCooldown: false,
    magFrac: 1,
    reloading: false,
    reloadLowFrac: CONFIG.bot.utility.reloadLowFrac,
    coverHpFrac: CONFIG.bot.coverHpFrac,
    ...over,
  };
}

const actions = createUtilityActions();
const scoreOf = (id: BotActionId, ctx: BotContext): number =>
  actions.find((a) => a.id === id)!.score(ctx);

console.log("Response curve helpers:");
check("clamp01 bounds", clamp01(-2) === 0 && clamp01(0.5) === 0.5 && clamp01(3) === 1);
check("exponential response starts at 0", approx(exponentialResponse(0, 3), 0));
check("exponential response is monotonic and bounded",
  exponentialResponse(1, 3) > exponentialResponse(0.2, 3) &&
  exponentialResponse(100, 3) <= 1);

console.log("Engage policy:");
{
  const ctx = baseContext({ hasLOS: true, distToPlayer: 10 });
  check("visible target makes engage legal and dominant",
    scoreOf("engage", ctx) > scoreOf("patrol", ctx) &&
    scoreOf("engage", ctx) > scoreOf("search", ctx));
  check("no LOS disallows engage", scoreOf("engage", baseContext()) === 0);
  check("empty magazine disallows engage",
    scoreOf("engage", baseContext({ hasLOS: true, magFrac: 0 })) === 0);
  check("reloading disallows engage",
    scoreOf("engage", baseContext({ hasLOS: true, reloading: true })) === 0);
  const close = scoreOf("engage", baseContext({ hasLOS: true, distToPlayer: 2 }));
  const far = scoreOf("engage", baseContext({ hasLOS: true, distToPlayer: 38 }));
  check("closer targets score higher", close > far);
}

console.log("Cover policy:");
{
  const wounded = baseContext({
    hasLOS: true,
    hpFrac: 0.2,
    coverAvailable: true,
  });
  check("wounded bot under fire rates cover above engage",
    scoreOf("cover", wounded) > scoreOf("engage", wounded));
  check("no cover point disallows cover",
    scoreOf("cover", baseContext({ hasLOS: true, hpFrac: 0.1 })) === 0);
  check("healthy bot with ammo does not want cover",
    scoreOf("cover", baseContext({ hasLOS: true, hpFrac: 1, coverAvailable: true })) === 0);
  check("cover cooldown disallows cover",
    scoreOf("cover", baseContext({ hasLOS: true, hpFrac: 0.1, coverAvailable: true, coverCooldown: true })) === 0);
  const dry = baseContext({ hasLOS: false, memoryAge: 1, magFrac: 0, coverAvailable: true });
  check("dry bot with a memory takes cover to reload", scoreOf("cover", dry) > 0);
}

console.log("Reload policy:");
{
  const safe = baseContext({ magFrac: 0.1 });
  check("low magazine without contact wants a reload",
    scoreOf("reload", safe) === 0.7);
  check("live contact blocks a fresh reload (cover wins instead)",
    scoreOf("reload", baseContext({ hasLOS: true, magFrac: 0.1 })) === 0);
  check("a reload in flight stays committed",
    scoreOf("reload", baseContext({ hasLOS: true, reloading: true })) === 0.8);
  check("healthy magazine never reloads",
    scoreOf("reload", baseContext({ magFrac: 0.9 })) === 0);
}

console.log("Search vs patrol policy:");
{
  const fresh = baseContext({ memoryAge: 0.5 });
  const stale = baseContext({ memoryAge: CONFIG.bot.memoryTime + 1 });
  check("fresh memory makes search outrank patrol",
    scoreOf("search", fresh) > scoreOf("patrol", fresh));
  check("stale memory disallows search, patrol remains",
    scoreOf("search", stale) === 0 && scoreOf("patrol", stale) === 0.1);
  check("live contact disallows search",
    scoreOf("search", baseContext({ hasLOS: true, memoryAge: 0 })) === 0);
}

console.log("Zone policy:");
{
  const outside = baseContext({ outsideZone: true, zoneDepth: 20 });
  let top: BotActionId = "patrol";
  let topScore = -1;
  for (const a of actions) {
    const s = a.score(outside);
    if (s > topScore) { topScore = s; top = a.id; }
  }
  check("being outside the zone makes returnToZone the top action", top === "returnToZone");
  check("inside the zone never scores returnToZone",
    scoreOf("returnToZone", baseContext()) === 0);
}

console.log("Selector hysteresis:");
{
  // Custom deterministic scorers so score gaps are exactly controllable.
  const mutable = { v: 0.6 };
  const custom: UtilityAction[] = [
    { id: "patrol", score: () => mutable.v },
    { id: "search", score: () => 0.55 },
  ];
  const sel = new UtilitySelector(custom, 0.08, 0.3);
  const first = sel.decide(0.016, baseContext());
  check("first decision picks the initial highest scorer", first.id === "patrol");
  // Challenger now leads by 0.05 — inside the margin, incumbent must hold.
  mutable.v = 0.5;
  const held = sel.decide(0.016, baseContext());
  check("sub-margin challenger does not flip the action", held.id === "patrol");
  // After the hold time elapses, any strict lead is allowed to switch.
  const switched = sel.decide(0.4, baseContext());
  check("post-hold strict lead flips the action", switched.id === "search");
}

console.log("Selector abandons dead actions immediately:");
{
  const custom: UtilityAction[] = [
    { id: "engage", score: (c) => (c.hasLOS ? 0.9 : 0) },
    { id: "patrol", score: () => 0.1 },
  ];
  const sel = new UtilitySelector(custom, 0.08, 0.3);
  check("acquire", sel.decide(0.016, baseContext({ hasLOS: true })).id === "engage");
  check("zero-score incumbent is replaced without waiting",
    sel.decide(0.016, baseContext({ hasLOS: false })).id === "patrol");
}

/* --------------------------- bot-level execution --------------------------- */

interface Harness {
  world: World;
  physics: Physics;
  obstacles: CircleObstacle[];
  spawn: THREE.Vector3;
}

function makeHarness(obstacles: CircleObstacle[] = []): Harness {
  const spawn = new THREE.Vector3(0, 1, 0);
  const h: Harness = {
    obstacles,
    spawn,
    world: undefined as unknown as World,
    physics: undefined as unknown as Physics,
  };
  h.world = {
    obstacles,
    heightAt: () => 1,
  } as unknown as World;
  h.physics = {
    resolveCircles: (x: number, z: number): [number, number] => {
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

const DT = 1 / 30;
function step(bot: Bot, player: Player, frames: number, radius = 200): number {
  let shots = 0;
  for (let i = 0; i < frames; i++) {
    if (bot.update(DT, player, new THREE.Vector3(0, 0, 0), radius)) shots++;
  }
  return shots;
}

console.log("Bot magazine and reload:");
{
  const h = makeHarness();
  const bot = new Bot(h.world, h.physics, "UTIL-1", h.spawn.clone(), new Rng(71));
  const player = new Player(h.world, h.physics);
  player.position.set(20, 1, 0);
  check("bot starts with a full magazine", approx(bot.ammoFrac, 1));
  const shots = step(bot, player, Math.ceil(6 / DT));
  check("sustained contact fires rounds", shots > 5, `got ${shots}`);
  check("firing spends the magazine", bot.ammoFrac < 1 && bot.ammoFrac > 0);
}

{
  const h = makeHarness();
  const bot = new Bot(h.world, h.physics, "UTIL-2", h.spawn.clone(), new Rng(72));
  const player = new Player(h.world, h.physics);
  player.position.set(100, 1, 0); // beyond sight range: no contact, safe reload
  bot.debugDrainMag();
  check("drained magazine reads empty", bot.ammoFrac === 0);
  const frames = step(bot, player, 5);
  check("empty mag without contact selects reload", bot.aiState === "reload",
    `state=${bot.aiState}`);
  check("reloading bot fires nothing", frames === 0);
  // Wait out the reload timer plus a decision tick.
  step(bot, player, Math.ceil((CONFIG.weapon.reloadTime + 0.5) / DT));
  check("magazine refills after the reload", approx(bot.ammoFrac, 1));
  check("reload action exits when complete", bot.aiState !== "reload",
    `state=${bot.aiState}`);
}

console.log("Bot zone return:");
{
  const h = makeHarness();
  const bot = new Bot(h.world, h.physics, "UTIL-3", new THREE.Vector3(30, 1, 0), new Rng(73));
  const player = new Player(h.world, h.physics);
  player.position.set(100, 1, 0);
  const before = bot.position.x;
  const frames = step(bot, player, 10, 10); // small zone: bot starts outside
  check("outside bot selects returnToZone", bot.aiState === "returnToZone",
    `state=${bot.aiState}`);
  check("returnToZone moves the bot toward the center", bot.position.x < before - 1,
    `before=${before} after=${bot.position.x}`);
  check("zone-return bot never fires", frames === 0);
}

console.log("Utility score exposure:");
{
  const h = makeHarness();
  const bot = new Bot(h.world, h.physics, "UTIL-4", h.spawn.clone(), new Rng(74));
  const player = new Player(h.world, h.physics);
  player.position.set(20, 1, 0);
  step(bot, player, 2);
  const s = bot.utilityScores;
  check("all six actions are scored every frame",
    Object.keys(s).length === 6 && Object.values(s).every((v) => v >= 0 && v <= 1));
}

if (failures > 0) {
  console.error(`\nUtility AI: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nUtility AI: all checks passed");
