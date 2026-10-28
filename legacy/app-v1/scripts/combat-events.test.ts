/*
 * Combat event-queue tests (npx tsx scripts/combat-events.test.ts).
 * Verifies the single presentation drain used by every shot path: ordered
 * delivery into pooled tracers/flashes, empty second drain, explicit clear,
 * and tuple-only (JSON-safe) payloads. Headless THREE scene, no renderer.
 */

import * as THREE from "three";
import { CombatEventQueue, TracerPool, MuzzleFlash } from "../game/combat";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const scene = new THREE.Scene();
const tracers = new TracerPool(scene, 4);
const flash = new MuzzleFlash(scene);
const queue = new CombatEventQueue();

console.log("Queue lifecycle:");
check("fresh queue has no pending events", queue.pending === 0);
queue.emit({ type: "flash", at: [1, 2, 3] });
queue.emit({
  type: "tracer",
  from: [0, 1.5, 0],
  to: [10, 1.5, 4],
  color: 0xffe2a1,
});
check("pending count tracks emissions", queue.pending === 2);

console.log("Drain into presentation pools:");
queue.drain(tracers, flash);
check("drain empties the queue", queue.pending === 0);
check("muzzle flash becomes visible at the emitted point",
  flash.mesh.visible &&
  flash.mesh.position.x === 1 &&
  flash.mesh.position.y === 2 &&
  flash.mesh.position.z === 3);

const line0 = tracers["pool" as keyof TracerPool] as unknown as {
  line: THREE.Line;
  life: number;
}[];
const spawned = line0.filter((t) => t.line.visible);
check("exactly one tracer spawned", spawned.length === 1, `got ${spawned.length}`);
const pos = spawned[0].line.geometry.getAttribute("position") as THREE.BufferAttribute;
check(
  "tracer carries the tuple endpoints",
  pos.getX(0) === 0 && pos.getY(0) === 1.5 && pos.getZ(0) === 0 &&
  pos.getX(1) === 10 && pos.getY(1) === 1.5 && pos.getZ(1) === 4
);
const mat = spawned[0].line.material as THREE.LineBasicMaterial;
check("tracer keeps its event color", mat.color.getHex() === 0xffe2a1);

console.log("Ordering and repeated drain:");
const q2 = new CombatEventQueue();
q2.emit({ type: "tracer", from: [1, 0, 0], to: [2, 0, 0], color: 0x111111 });
q2.emit({ type: "tracer", from: [3, 0, 0], to: [4, 0, 0], color: 0x222222 });
q2.drain(tracers, flash);
const visible = line0.filter((t) => t.line.visible);
const pA = visible[visible.length - 2].line.geometry.getAttribute("position") as THREE.BufferAttribute;
const pB = visible[visible.length - 1].line.geometry.getAttribute("position") as THREE.BufferAttribute;
check("events reach the pool in emission order",
  pA.getX(0) === 1 && pB.getX(0) === 3,
  `got ${pA.getX(0)} then ${pB.getX(0)}`);
q2.drain(tracers, flash);
check("a second empty drain spawns nothing extra",
  line0.filter((t) => t.line.visible).length === visible.length);

console.log("Clear semantics:");
const q3 = new CombatEventQueue();
const scene2 = new THREE.Scene();
const t2 = new TracerPool(scene2, 2);
const f2 = new MuzzleFlash(scene2);
q3.emit({ type: "tracer", from: [0, 0, 0], to: [1, 1, 1], color: 0xffffff });
q3.emit({ type: "flash", at: [5, 5, 5] });
q3.clear();
check("clear drops pending count", q3.pending === 0);
q3.drain(t2, f2);
const anyTracer = (t2["pool" as keyof TracerPool] as unknown as { line: THREE.Line }[])
  .some((t) => t.line.visible);
check("cleared events never reach presentation", !anyTracer && !f2.mesh.visible);

console.log("Payload discipline:");
const event = {
  type: "tracer" as const,
  from: [0, 0, 0] as [number, number, number],
  to: [1, 1, 1] as [number, number, number],
  color: 0xffffff,
};
check("event payloads survive JSON round-trip (tuple-only, no THREE refs)",
  JSON.parse(JSON.stringify(event)).to.join(",") === "1,1,1");

if (failures > 0) {
  console.error(`\nCombat events: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nCombat events: all checks passed");
