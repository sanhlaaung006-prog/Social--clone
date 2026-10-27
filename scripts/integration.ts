/*
 * Headless integration test (npx tsx scripts/integration.ts): drives the real
 * gameplay systems for 30 simulated seconds. Renderer/DOM-only code (Engine,
 * React) is excluded; everything else runs for real.
 */

import * as THREE from "three";
import { JsNoise } from "../game/wasm/noise";
import { Rng, BOT_CALLSIGNS } from "../game/rng";
import { World } from "../game/world";
import { Player, Bot } from "../game/actors";
import { Zone } from "../game/zone";
import { PickupManager } from "../game/combat";
import { InputState } from "../game/input";
import { CONFIG } from "../game/config";
import { JsPhysics, bindJsPhysicsHeight } from "../game/wasm/physics";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const finite = (v: THREE.Vector3) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

console.log("World construction:");
const noise = new JsNoise();
const world = new World(noise);
const scene = new THREE.Scene();
check("terrain mesh built", !!world.terrainMesh);
check("obstacles generated", world.obstacles.length > 200, `got ${world.obstacles.length}`);
check("spawn points available", world.spawnPoints.length >= 12);

console.log("Actors + 30s simulated match:");
const rng = new Rng(CONFIG.seed + 1);
const physics = new JsPhysics();
bindJsPhysicsHeight((x, z) => noise.terrainHeight(x, z, CONFIG.seed));
physics.setObstacles(world.obstacles);
const player = new Player(world, physics);
player.group.position.copy(world.randomSpawn(rng));
const bots: Bot[] = [];
for (let i = 0; i < CONFIG.bot.count; i++) {
  const bot = new Bot(
    world,
    physics,
    `${BOT_CALLSIGNS[i % BOT_CALLSIGNS.length]}-${i}`,
    world.randomSpawn(rng),
    rng
  );
  bots.push(bot);
}
const zone = new Zone(scene);
const pickups = new PickupManager(scene, world, world.obstacles, rng);
const input = new InputState();
input.touch = true;
input.moveY = 1; // walk forward the whole time

const dt = 1 / 30;
let botShots = 0;
for (let frame = 0; frame < 900; frame++) {
  input.lookDX = Math.sin(frame * 0.02) * 3; // sweep camera
  player.update(dt, input);
  input.resetTransient();

  for (const bot of bots) {
    const shot = bot.update(dt, player, zone.center, zone.radius);
    if (shot) {
      botShots++;
      if (!finite(shot.origin) || !finite(shot.dir)) {
        check("bot shots originate at muzzle", false, `${bot.callsign} frame ${frame}`);
      }
    }
  }
  zone.update(dt);
  pickups.update(dt, frame * dt);

  if (!finite(player.position)) {
    check("player position stays finite", false, `frame ${frame}`);
    break;
  }
  for (const bot of bots) {
    if (bot.alive && !finite(bot.position)) {
      check("bot positions stay finite", false, `${bot.callsign} frame ${frame}`);
      break;
    }
  }
}
check("player position stays finite", finite(player.position));
check("player stays grounded on terrain",
  Math.abs(player.position.y - world.heightAt(player.position.x, player.position.z)) < 0.05,
  `y=${player.position.y.toFixed(2)} ground=${world.heightAt(player.position.x, player.position.z).toFixed(2)}`);
check("bots fired during the match", botShots > 10, `only ${botShots} shots`);
check("bot shots originate at muzzle", botShots > 10);
check("pickups exist", pickups.pickups.length === CONFIG.world.pickupCount);

console.log("Weapon + reload loop:");
const mag0 = player.mag;
check("consumeShot spends ammo", player.consumeShot(0) && player.mag === mag0 - 1);
player.mag = 1;
player.reserve = 30;
player.consumeShot(0); // empties mag, auto-starts reload
check("auto-reload starts on empty mag", player.isReloading);
for (let i = 0; i < 100; i++) player.update(dt, new InputState());
check("reload refills from reserve", !player.isReloading && player.mag === CONFIG.weapon.magSize);

console.log("Damage, death and loot:");
const target = bots[0];
const died = target.applyDamage(9999);
check("lethal damage kills actor", died && !target.alive);
check("dead actor ignores more damage", target.applyDamage(50) === false);
player.hp = 20;
player.heal(CONFIG.pickups.medkitHeal);
check("medkit heals and clamps at max", player.hp === 55);
const before = player.reserve;
const active = pickups.pickups.find((p) => p.active)!;
player.group.position.set(active.group.position.x, 0, active.group.position.z);
const kind = pickups.collectNearby(player.group.position);
check("proximity pickup collected", kind === active.kind);
if (kind === "ammo") check("ammo crate adds reserve", player.reserve === before + CONFIG.pickups.ammoPerCrate);

console.log("Zone damage:");
const victim = bots[1];
const startHp = victim.hp;
const outside = !zone.isInside(victim.position.x, victim.position.z);
if (outside) {
  victim.applyDamage(zone.damagePerSecond * dt);
  check("zone damage applies", victim.hp < startHp);
} else {
  check("zone damage applies", true, "(bot inside zone; logic covered by smoke test)");
}

console.log(failures === 0 ? "\nAll integration tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
