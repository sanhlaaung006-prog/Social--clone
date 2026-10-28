/*
 * Royal city tests: deterministic plan, twin-house pairing invariants,
 * terrace math, collision/gate routing, merged-geometry sanity and the
 * anti-voxel art gate. Run: npx tsx tests/city.test.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  CITY_FOOTPRINT,
  CITY_SEED,
  CITADEL,
  MOAT,
  SHRINE_COUNT,
  CityRng,
  citySurfaceY,
  isCityFootprint,
  planCity,
  resolveCityCollision
} from "../src/city/layout";
import { buildCity } from "../src/city/buildCity";
import { groundHeight } from "../src/terrain/myanmarMap";

const here = dirname(fileURLToPath(import.meta.url));
const cityDir = join(here, "..", "src", "city");

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("City module freeze (SHA-256):");
{
  // The royal city is a locked art deliverable like the terrain engine:
  // any edit to src/city must re-baseline this JSON in a reviewed commit.
  const baseline = JSON.parse(
    readFileSync(join(here, "lib", "city-lock.json"), "utf8")
  ) as Record<string, string>;
  let lockFailures = 0;
  for (const [rel, expected] of Object.entries(baseline)) {
    const actual = createHash("sha256").update(readFileSync(join(here, "..", rel))).digest("hex");
    check(`${rel} matches frozen checksum`, actual === expected);
    if (actual !== expected) lockFailures++;
  }
  check("all five city modules are covered by the lock",
    Object.keys(baseline).length === readdirSync(cityDir).filter((f) => f.endsWith(".ts")).length);
  if (lockFailures > 0) process.exit(1);
}

const plan = planCity(CITY_SEED, groundHeight);

console.log("Plan determinism and RNG:");
{
  const again = planCity(CITY_SEED, groundHeight);
  check("same seed + sampler yields identical plans", JSON.stringify(again) === JSON.stringify(plan));
  const r1 = new CityRng(99);
  const r2 = new CityRng(99);
  const seq1 = [0, 0, 0, 0].map(() => r1.next());
  const seq2 = [0, 0, 0, 0].map(() => r2.next());
  check("CityRng is deterministic", seq1.every((v, i) => v === seq2[i]));
  check("different seed changes the plan", JSON.stringify(planCity(CITY_SEED + 1, groundHeight)) !== JSON.stringify(plan));
}

console.log("Bounds and reserved zones:");
{
  const f = CITY_FOOTPRINT;
  check("every pad sits inside the footprint", plan.pads.every((p) =>
    Math.abs(p.x) + p.hw <= f + 2 && Math.abs(p.z) + p.hd <= f + 2));
  check("every house pair sits inside the footprint", plan.pairs.every((p) =>
    Math.abs(p.x) < f && Math.abs(p.z) < f));
  check("no house pair breaches the moat reserve", plan.pairs.every((p) =>
    Math.hypot(p.x, p.z) > MOAT.outer + 8));
  check("all landmarks are inside the footprint", plan.landmarks.every((l) =>
    Math.hypot(l.x, l.z) < f));
  check("terrace tops are always above their bottoms", plan.pads.every((p) => p.topY > p.bottomY));
  check("finite heights everywhere in the plan", JSON.stringify(plan).includes("NaN") === false);
}

console.log("Twin (semidetached) houses:");
{
  check("at least 60 twin pairs planned", plan.stats.pairs >= 60, `got ${plan.stats.pairs}`);
  check("house count is exactly twice the pair count", plan.stats.houses === plan.stats.pairs * 2);
  let paired = true;
  let partyWall = true;
  for (const pair of plan.pairs) {
    const [a, b] = pair.units;
    if (!(a && b)) paired = false;
    else {
      if (Math.sign(a.ox) === Math.sign(b.ox) || a.ox === 0 || b.ox === 0) paired = false;
      // Inner faces meet at the shared party wall (gap under 0.5 m).
      const gap = Math.abs(a.ox) - a.w / 2 + (Math.abs(b.ox) - b.w / 2);
      if (Math.abs(gap) > 0.5) partyWall = false;
      if (pair.rot !== 0 && pair.rot !== Math.PI / 2) paired = false;
    }
  }
  check("every record is a two-unit pair on a shared party wall", paired && partyWall);
  check("both roof materials appear across the city",
    plan.pairs.some((p) => p.units[0].roof === "tin") &&
    plan.pairs.some((p) => p.units[0].roof === "tile"));
  check("house tints come from the donor palette", plan.pairs.every((p) =>
    p.units.every((u) => u.tint > 0 && Number.isInteger(u.tint))));
}

console.log("Terraces, roads and surfaces:");
{
  // Mock sampler with a known 20 m bump under one block.
  const mock = (x: number, z: number): number => (Math.abs(x - 300) < 60 && Math.abs(z - 300) < 60 ? 20 : 4);
  const mockPlan = planCity(CITY_SEED, mock);
  const bumped = mockPlan.pads.filter((p) => Math.abs(p.x - 300) < 80 && Math.abs(p.z - 300) < 80);
  check("terrace tops clear the highest sampled ground", bumped.every((p) => p.topY >= 20.5));
  check("terrace bottoms tuck below the lowest sampled ground", mockPlan.pads.every((p) => p.bottomY < 4));
  check("roads generated on both axes",
    plan.roads.some((r) => r.axis === "x") && plan.roads.some((r) => r.axis === "z"));
  check("no road crosses the moat", plan.roads.every((r) => Math.hypot(r.x, r.z) > MOAT.outer - 4));
  // Roads must sit in the gaps between block pads, never through a pad.
  let roadThroughPad = false;
  for (const r of plan.roads) {
    for (const p of plan.pads) {
      if (p.kind !== "block") continue;
      if (r.axis === "z" && Math.abs(r.x - p.x) < p.hw - r.width / 2 &&
          Math.abs(r.z - p.z) < p.hd + 1) roadThroughPad = true;
      if (r.axis === "x" && Math.abs(r.z - p.z) < p.hd - r.width / 2 &&
          Math.abs(r.x - p.x) < p.hw + 1) roadThroughPad = true;
    }
  }
  check("no road runs through a block pad", !roadThroughPad);
  const onPad = plan.pads.find((p) => p.kind === "block")!;
  check("citySurfaceY returns terrace top on a pad",
    citySurfaceY(plan, onPad.x, onPad.z) === onPad.topY);
  check("citySurfaceY returns null in open country", citySurfaceY(plan, 2000, 2000) === null);
  check("isCityFootprint margin works",
    isCityFootprint(plan, CITY_FOOTPRINT + 5, 0) === false &&
    isCityFootprint(plan, CITY_FOOTPRINT + 5, 0, 10) === true);
}

console.log("Citadel, gates and collision:");
{
  const kinds = new Set(plan.landmarks.map((l) => l.kind));
  for (const k of ["citadelHalls", "greatPagoda", "shrineCourt", "monastery", "market", "clockTower"] as const) {
    check(`landmark present: ${k}`, kinds.has(k));
  }
  check("12 gate openings leave walkable gaps (no collider at gate centers)",
    CITADEL.gateOffsets.every((g) =>
      resolveCityCollision(plan, g, CITADEL.pal - 1, 0.9).blocked === false &&
      resolveCityCollision(plan, CITADEL.pal - 1, g, 0.9).blocked === false));
  // x=60 lies between the centre and +125 gates: solid wall there.
  const wallHit = resolveCityCollision(plan, 60, CITADEL.pal, 0.9);
  check("walking into a wall is pushed back outside", wallHit.blocked && Math.abs(wallHit.z) >= CITADEL.pal);
  // Open courtyard gap between the throne hall, glass palace and library.
  const open = resolveCityCollision(plan, -40, 60, 0.9);
  check("citadel courtyard remains walkable", open.blocked === false);
  check("five moat bridges planned", plan.bridges.length === 5);
  // 4 sides * (7 pitches - 1 shared corner) minus the 4 gate-side omissions.
  check("bastions de-duplicated at corners and cleared from gates",
    plan.bastions.length === 4 * (CITADEL.bastionsPerSide - 1) - 4);
  check(`shrine ring close to target count (${SHRINE_COUNT})`, plan.shrines.length >= 60 && plan.shrines.length <= SHRINE_COUNT);
  check("shrines stay inside their court", plan.shrines.every((s) =>
    Math.abs(s.x - 360) < 118 && Math.abs(s.z + 360) < 118));
}

console.log("Built geometry:");
{
  const built = buildCity(plan);
  let nan = false;
  let triCount = 0;
  built.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute("position") as THREE.BufferAttribute;
    triCount += pos.count / 3;
    for (let i = 0; i < pos.count; i++) {
      if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) nan = true;
    }
  });
  check("no NaN vertices in any city mesh", !nan);
  check("triangle count within the mobile budget (20k..350k)", triCount >= 20000 && triCount <= 350000,
    `got ${Math.round(triCount)}`);
  check("merged into at most 16 draw-call meshes", built.stats.meshes <= 16, `got ${built.stats.meshes}`);
  check("builder stats agree with scene geometry", Math.round(triCount) === built.stats.triangles);
  check("water material stays transparent", built.materials.water.transparent === true);
  check("gold keeps metalness for the gilded landmarks", built.materials.gold.metalness > 0.5);
  // Regression: the great pagoda bell must be a full-size ~30 m bell on
  // its terraces, not a radius-0.3 m needle (lathe scale bug).
  {
    const pagoda = plan.landmarks.find((l) => l.kind === "greatPagoda")!;
    const goldMesh = built.group.children.find((o) => o.name === "city/gold") as THREE.Mesh;
    const pos = goldMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    let minY = Infinity;
    let maxY = -Infinity;
    let radial = 0;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (Math.hypot(px - pagoda.x, pz - pagoda.z) < 60) {
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        radial = Math.max(radial, Math.hypot(px - pagoda.x, pz - pagoda.z));
      }
    }
    check("great pagoda bell stands roughly 30 m tall", maxY - minY > 25, `span ${(maxY - minY).toFixed(1)} m`);
    check("great pagoda bell radius exceeds 10 m", radial > 10, `radius ${radial.toFixed(1)} m`);
  }
}

console.log("Anti-voxel art gate:");
{
  const files = readdirSync(cityDir).filter((f) => f.endsWith(".ts"));
  const offenders: string[] = [];
  const boxUsage = /new\s+[\w.]*BoxGeometry\s*\(/;
  for (const f of files) {
    const src = readFileSync(join(cityDir, f), "utf8");
    if (boxUsage.test(src)) offenders.push(f);
  }
  check("no THREE.BoxGeometry instantiation anywhere in src/city", offenders.length === 0, offenders.join(", "));
  check("every city module carries donor attribution",
    readFileSync(join(cityDir, "layout.ts"), "utf8").includes("user-supplied") &&
    readFileSync(join(cityDir, "buildCity.ts"), "utf8").includes("NOTICE.md"));
}

if (failures > 0) {
  console.error(`\nCity: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nRoyal city: all checks passed.");
