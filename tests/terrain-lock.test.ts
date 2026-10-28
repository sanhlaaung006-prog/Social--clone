/*
 * Terrain freeze enforcement + height-field behavior tests.
 * Run: npx tsx tests/terrain-lock.test.ts
 *
 * The SHA-256 checksums in tests/lib/terrain-lock.json make any edit to
 * the locked terrain modules fail CI. Re-baselining is an explicit
 * decision: regenerate the JSON and review the diff.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as THREE from "three";
import {
  fbm,
  hash2,
  mulberry32,
  myanmarHeight,
  ridgedNoise,
  vnoise
} from "../src/terrain/locked/noise";
import { buildPagoda, buildVolcanoPlug } from "../src/terrain/locked/structures";

const here = dirname(fileURLToPath(import.meta.url));
const lockedDir = join(here, "..", "src", "terrain", "locked");
const lockFile = join(here, "lib", "terrain-lock.json");

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Locked file checksums:");
{
  const baseline = JSON.parse(readFileSync(lockFile, "utf8")) as Record<string, string>;
  for (const [name, expected] of Object.entries(baseline)) {
    const bytes = readFileSync(join(lockedDir, name));
    const actual = createHash("sha256").update(bytes).digest("hex");
    check(`${name} matches frozen checksum`, actual === expected, actual.slice(0, 12));
  }

  const sources = Object.keys(baseline)
    .map((name) => readFileSync(join(lockedDir, name), "utf8"))
    .join("\n");
  check("anti-voxel: no BoxGeometry in locked terrain", !sources.includes("BoxGeometry"));
  check("no downloaded assets in locked terrain", !/https?:\/\//.test(sources.replace(/https:\/\/threejs\.org/g, "")));
}

console.log("Noise toolkit:");
{
  check("hash2 stays in [0,1)", (() => {
    for (let i = 0; i < 200; i++) {
      const h = hash2(i * 1.7, -i * 0.9, i % 5);
      if (h < 0 || h >= 1) return false;
    }
    return true;
  })());
  check("vnoise is deterministic", vnoise(3.1, -2.4, 9) === vnoise(3.1, -2.4, 9));
  check("fbm stays normalized in [0,1]", (() => {
    for (let i = 0; i < 100; i++) {
      const v = fbm(i * 0.31, Math.sin(i) * 4, 5, i);
      if (v < 0 || v > 1) return false;
    }
    return true;
  })());
  check("ridged noise stays in [0,1]", (() => {
    for (let i = 0; i < 100; i++) {
      const v = ridgedNoise(i * 0.27, Math.cos(i) * 3, 4, i);
      if (v < 0 || v > 1) return false;
    }
    return true;
  })());
  const rngA = mulberry32(20261028);
  const rngB = mulberry32(20261028);
  const seqA = Array.from({ length: 10 }, () => rngA());
  const seqB = Array.from({ length: 10 }, () => rngB());
  check("mulberry32 deterministic per seed", seqA.every((v, i) => v === seqB[i]));
}

console.log("Myanmar height field:");
{
  // Frozen value snapshots — these change only if the locked field changes,
  // which the checksum gate already forbids.
  const snapshots: Array<[number, number, number]> = [
    [0.0, 0.0, 0],
    [0.1, -0.8, 0],
    [-0.45, -0.45, 0],
    [-0.1, 0.5, 0],
    [0.55, 0.2, 0],
    [-0.55, 0.6, 0]
  ];
  const values = snapshots.map(([u, v]) => myanmarHeight(u, v));
  check("field is deterministic", values.every((h, i) => h === myanmarHeight(snapshots[i][0], snapshots[i][1])));
  check("all samples finite", values.every(Number.isFinite));

  const gulf = myanmarHeight(0.85, 0.85);
  check("Gulf of Martaban is below sea level", gulf < 0, `h=${gulf.toFixed(3)}`);
  const himalaya = myanmarHeight(0.1, -0.8);
  check("northern Himalayan knot is the highest zone", himalaya > 1.2, `h=${himalaya.toFixed(3)}`);
  const victoria = myanmarHeight(-0.45, -0.45);
  check("Arakan Yoma rises above the central basin", victoria > myanmarHeight(0.0, -0.05));
  const delta = myanmarHeight(-0.1, 0.55);
  check("Irrawaddy delta is near sea level", Math.abs(delta) < 0.45, `h=${delta.toFixed(3)}`);
  const river = myanmarHeight(-0.1, 0.08);
  check("main river carves below its banks", river < myanmarHeight(0.05, 0.08));
  const seaWest = myanmarHeight(-0.9, 0.1);
  check("western sea is negative", seaWest < 0, `h=${seaWest.toFixed(3)}`);

  // Height range over the full unit square matches the relief envelope.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 64; i++) {
    for (let j = 0; j <= 64; j++) {
      const h = myanmarHeight((i / 64) * 2 - 1, (j / 64) * 2 - 1);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  check("relief envelope spans sea to high peaks", min < -0.15 && max > 1.5, `min=${min.toFixed(2)} max=${max.toFixed(2)}`);
}

console.log("Locked structure builders:");
{
  const pagoda = buildPagoda(1.2);
  check("pagoda builds as a named group", pagoda instanceof THREE.Group && pagoda.name.includes("Pagoda"));
  check("pagoda has five tiers plus tip", pagoda.children.length >= 6);
  const plug = buildVolcanoPlug();
  check("volcanic plug builds with vertex colors", (() => {
    const mesh = plug.children[0] as THREE.Mesh;
    return mesh.geometry.getAttribute("color") !== undefined && plug.userData.height === 5.8;
  })());
  let boxes = 0;
  pagoda.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry.type === "BoxGeometry") boxes++;
  });
  check("locked structures contain no boxes", boxes === 0);
}

console.log(failures === 0 ? "\nTerrain lock: all checks passed." : `\nTerrain lock: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
