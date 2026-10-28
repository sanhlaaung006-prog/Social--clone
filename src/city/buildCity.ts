/*
 * ROYAL CITY BUILDER
 * ------------------------------------------------------------------
 * Turns a pure CityPlan into merged three.js meshes: terraced pads and
 * roads, moat ring and teak bridges, the battered citadel with twelve
 * zodiac gates and pyatthat pavilions, paired shophouses (twin houses),
 * the Shwezigon-type great pagoda with a ring of kyauksa-gu shrines,
 * the teak monastery, central market and clock tower.
 *
 * Batching follows src/render/world.ts: geometry is accumulated per
 * material family, vertex-tinted, and merged into one mesh per family.
 * No BoxGeometry is used anywhere (art gate) — see ./geometry.ts.
 *
 * Re-authored from the user-supplied Mandalay reconstruction; see
 * NOTICE.md. The frozen terrain modules are never touched.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  batteredWall,
  cuboid,
  gableRoof,
  moatRing,
  pyramidSpire,
  stupaGeometry
} from "./geometry";
import { createCityMaterials, type CityMaterialKey, type CityMaterials } from "./materials";
import {
  CITADEL,
  MOAT,
  type CityPlan,
  type HousePair,
  type Pad
} from "./layout";

export interface CityBuildResult {
  group: THREE.Group;
  materials: CityMaterials;
  stats: { triangles: number; meshes: number; pieces: number };
}

class CityBuilder {
  readonly buckets = new Map<CityMaterialKey, THREE.BufferGeometry[]>();
  readonly materials = createCityMaterials();
  private readonly frame = new THREE.Matrix4();
  private readonly work = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly tint = new THREE.Color();
  pieces = 0;

  add(
    key: CityMaterialKey,
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    yaw = 0,
    tintHex: THREE.ColorRepresentation = 0xffffff,
    sx = 1,
    sy = 1,
    sz = 1
  ): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    this.quat.setFromEuler(this.euler.set(0, yaw, 0));
    this.scl.set(sx, sy, sz);
    this.work.compose(this.pos.set(x, y, z), this.quat, this.scl).premultiply(this.frame);
    this.scl.set(1, 1, 1);
    g.applyMatrix4(this.work);

    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    this.tint.set(tintHex);
    for (let i = 0; i < p.count; i++) {
      colors[i * 3] = this.tint.r;
      colors[i * 3 + 1] = this.tint.g;
      colors[i * 3 + 2] = this.tint.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const list = this.buckets.get(key);
    if (list) list.push(g);
    else this.buckets.set(key, [g]);
    this.pieces++;
  }

  /** Stacked, shrinking tiered roof with a gilded spire (donor pyatthat). */
  pyatthat(
    x: number,
    z: number,
    base: number,
    tiers: number,
    tierH: number,
    size0: number,
    shrink = 0.78,
    tipH = 5
  ): void {
    let y = base;
    let s = size0;
    for (let t = 0; t < tiers; t++) {
      this.add("tile", cuboid(s, tierH * 0.8, s), x, y + tierH * 0.4, z);
      this.add("gold", cuboid(s + 1.6, 0.7, s + 1.6), x, y + 0.35, z);
      y += tierH;
      s *= shrink;
    }
    this.add("gold", pyramidSpire(Math.max(0.8, s * 0.34), tipH), x, y + tipH / 2, z, Math.PI / 4);
  }

  flush(group: THREE.Group): { triangles: number; meshes: number } {
    let triangles = 0;
    let meshes = 0;
    for (const [key, list] of this.buckets) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materials[key]);
      mesh.matrixAutoUpdate = false;
      mesh.name = `city/${key}`;
      // The locked renderer already runs a 4096 PCF shadow map; the walk
      // sun follows the player, so nearby city pieces shadow each other.
      // Transparent moat water receives but never casts.
      mesh.castShadow = key !== "water";
      mesh.receiveShadow = true;
      group.add(mesh);
      const pos = merged.getAttribute("position");
      triangles += pos.count / 3;
      meshes++;
      for (const g of list) g.dispose();
    }
    return { triangles, meshes };
  }
}

function padTopAt(pads: Pad[], x: number, z: number): number {
  let best = -Infinity;
  for (const p of pads) {
    if (p.kind === "block" && Math.abs(p.x - x) < 1 && Math.abs(p.z - z) < 1) {
      best = Math.max(best, p.topY);
    }
  }
  return best;
}

function buildHouses(b: CityBuilder, plan: CityPlan): void {
  for (const pair of plan.pairs) {
    buildPair(b, pair, padTopAt(plan.pads, pair.blockX, pair.blockZ));
  }
}

function buildPair(b: CityBuilder, pair: HousePair, baseY: number): void {
  for (const u of pair.units) {
    const dx = pair.rot === 0 ? u.ox : 0;
    const dz = pair.rot === 0 ? 0 : u.ox;
    const x = pair.x + dx;
    const z = pair.z + dz;
    b.add("plaster", cuboid(u.w, u.h, u.d), x, baseY + u.h / 2, z, pair.rot, u.tint);
    // Timber door recess on the street-facing side.
    b.add("teak", cuboid(u.w * 0.32, u.h * 0.42, 0.25), x, baseY + u.h * 0.21, z - u.d / 2 - 0.05, pair.rot);
    const rise = Math.max(0.9, u.d * 0.32);
    const roof = u.roof === "tin" ? "tin" : "tile";
    b.add(roof, gableRoof(u.w + 0.6, rise, u.d + 0.7), x, baseY + u.h, z, pair.rot);
    // A low brick chimney gives the semidetached pair a silhouette break.
    b.add("brick", cuboid(0.5, 1.1, 0.5), x + u.w * 0.22, baseY + u.h + rise * 0.55, z, pair.rot);
  }
}

function buildTerraces(b: CityBuilder, plan: CityPlan): void {
  for (const pad of plan.pads) {
    const h = pad.topY - pad.bottomY;
    const key: CityMaterialKey = pad.kind === "citadel" ? "brick" : "soil";
    b.add(key, cuboid(pad.hw * 2, h, pad.hd * 2), pad.x, pad.bottomY + h / 2, pad.z);
    // Paved coping along the terrace edge.
    b.add(
      "concrete",
      cuboid(pad.hw * 2 + 0.4, 0.35, pad.hd * 2 + 0.4),
      pad.x,
      pad.topY + 0.05,
      pad.z
    );
  }
  for (const r of plan.roads) {
    const h = Math.max(0.4, r.topY - r.bottomY);
    if (r.axis === "x") b.add("asphalt", cuboid(r.len, h, r.width), r.x, r.bottomY + h / 2, r.z);
    else b.add("asphalt", cuboid(r.width, h, r.len), r.x, r.bottomY + h / 2, r.z);
  }
}

function buildMoatAndBridges(b: CityBuilder, plan: CityPlan): void {
  const bed = moatRing(MOAT.outer, MOAT.inner);
  b.add("iron", bed, 0, plan.waterY - 0.55, 0);
  const water = moatRing(MOAT.outer - 0.6, MOAT.inner + 0.6);
  b.add("water", water, 0, plan.waterY, 0);

  for (const br of plan.bridges) {
    const len = MOAT.outer - MOAT.inner + 10;
    const horiz = br.axis === "x";
    for (let k = -1; k <= 1; k++) {
      const off = k * 3.2;
      const x = horiz ? br.x : br.x + off;
      const z = horiz ? br.z + off : br.z;
      b.add("teak", cuboid(horiz ? len : 1.1, 0.6, horiz ? 1.1 : len), x, plan.waterY + 0.5, z);
    }
    for (let k = -1; k <= 1; k++) {
      const t = (k / 2) * (len / 2 - 3);
      const x = horiz ? br.x + t : br.x;
      const z = horiz ? br.z : br.z + t;
      b.add("iron", new THREE.CylinderGeometry(0.5, 0.7, 3.4, 6), x, plan.waterY - 1.2, z);
    }
  }
}

function buildCitadel(b: CityBuilder, plan: CityPlan): void {
  const { pal, wallH, wallT0, wallT1, bastionSize, gateGap, gateOffsets } = CITADEL;
  const y0 = plan.padY;

  // Battered walls, split around gate openings by the plan.
  for (const seg of plan.wallSegs) {
    const wall = batteredWall(seg.len, wallT0, wallT1, wallH);
    if (seg.axis === "x") wall.rotateY(Math.PI / 2);
    b.add("brick", wall, seg.x, y0, seg.z);
  }

  // Merlons along every wall crown (embrasure rhythm of the donor).
  const pitch = 5;
  for (const seg of plan.wallSegs) {
    const n = Math.floor(seg.len / pitch);
    for (let k = 0; k < n; k++) {
      const t = -seg.len / 2 + (k + 0.5) * pitch;
      const x = seg.axis === "x" ? seg.x : seg.x + t;
      const z = seg.axis === "x" ? seg.z + t : seg.z;
      b.add("brick", cuboid(1.9, 1.4, wallT1 + 0.4), x, y0 + wallH + 0.5, z);
    }
  }

  // Bastions with two-tier gilded pavilions.
  for (const c of plan.bastions) {
    b.add("brick", cuboid(bastionSize, 4.2, bastionSize), c.x, y0 + 2.1, c.z);
    b.add("plaster", cuboid(bastionSize - 2.4, 2.2, bastionSize - 2.4), c.x, y0 + 5.3, c.z);
    b.pyatthat(c.x, c.z, y0 + 6.4, 2, 1.7, bastionSize - 3, 0.74, 3.2);
  }

  // Twelve zodiac gates: masonry pavilion, dark portal, tiered crown.
  for (const axis of ["x", "z"] as const) {
    for (const sgn of [-1, 1]) {
      for (const g of gateOffsets) {
        const mid = g;
        const tiers = g === 0 ? 5 : 4;
        if (axis === "z") {
          const x = mid;
          const z = sgn * pal;
          b.add("brick", cuboid(gateGap + 5.6, 4.8, 6.4), x, y0 + 2.4, z);
          b.add("iron", cuboid(gateGap, 3.4, 0.4), x, y0 + 1.7, z + (sgn > 0 ? 0.1 : -0.1));
          b.pyatthat(x, z, y0 + 4.9, tiers, 2.1, 8.4, 0.74, 4);
        } else {
          const x = sgn * pal;
          const z = mid;
          b.add("brick", cuboid(6.4, 4.8, gateGap + 5.6), x, y0 + 2.4, z);
          b.add("iron", cuboid(0.4, 3.4, gateGap), x + (sgn > 0 ? 0.1 : -0.1), y0 + 1.7, z);
          b.pyatthat(x, z, y0 + 4.9, tiers, 2.1, 8.4, 0.74, 4);
        }
      }
    }
  }

  // Interior royal platform buildings (donor citadel, ~0.3 scale).
  // Great Hall of Audience (east) with a three-tier crown.
  b.add("brick", cuboid(34, 1.4, 30), 118, y0 + 0.7, 0);
  b.add("plaster", cuboid(28, 4.4, 24), 118, y0 + 3.6, 0);
  b.add("tin", cuboid(30, 1, 26), 118, y0 + 6.3, 0);
  b.pyatthat(118, 0, y0 + 6.8, 3, 2.2, 19, 0.74, 3.4);
  // Lion Throne Room at the exact centre: seven tiers and a gold spire.
  b.add("plaster", cuboid(18, 5, 18), 4, y0 + 2.5, 0);
  b.add("teak", cuboid(14, 3.4, 14), 4, y0 + 6.7, 0);
  b.pyatthat(4, 0, y0 + 8.4, 5, 2, 16, 0.78, 5.4);
  b.add("gold", new THREE.ConeGeometry(0.9, 8, 8), 4, y0 + 24, 0);
  // Glass Palace (west residential quarter).
  b.add("plaster", cuboid(24, 4, 20), -92, y0 + 2, -8);
  b.add("tin", cuboid(26, 0.9, 22), -92, y0 + 4.5, -8);
  b.pyatthat(-92, -8, y0 + 5, 3, 1.9, 15, 0.76, 3);
  // Hluttaw supreme court (SE).
  b.add("plaster", cuboid(16, 3.4, 12), 120, y0 + 1.7, 78);
  b.add("teak", cuboid(14, 2.4, 10), 120, y0 + 4.6, 78);
  b.pyatthat(120, 78, y0 + 5.8, 3, 1.7, 12, 0.76, 3);
  // Nanmyintsaung watch tower (cylinder + crown).
  b.add("teak", new THREE.CylinderGeometry(3.4, 4, 10, 12, 1, true), -96, y0 + 5, -64);
  b.add("tin", new THREE.CylinderGeometry(4.2, 4.2, 0.7, 12), -96, y0 + 10.3, -64);
  b.pyatthat(-96, -64, y0 + 10.7, 4, 1.5, 8, 0.8, 3.2);
  // Pitakataik royal library.
  b.add("brick", cuboid(10, 3.6, 10), -120, y0 + 1.8, 62);
  b.add("plaster", cuboid(11, 0.8, 11), -120, y0 + 4, 62);
  b.pyatthat(-120, 62, y0 + 4.4, 3, 1.5, 9, 0.74, 2.8);
  // Military/administrative rows inside the walls.
  for (let k = 0; k < 6; k++) {
    const side = k % 2 ? 1 : -1;
    const off = -160 + k * 64;
    b.add("brick", cuboid(26, 3, 9), off, y0 + 1.5, side * 200);
    b.add("tin", cuboid(27, 0.8, 10), off, y0 + 3.4, side * 200);
  }
}

function buildGreatPagoda(b: CityBuilder, x: number, z: number, s: number, baseY: number): void {
  // Three receding square terraces with gilded trim.
  const terraceH = 6 * s;
  for (let t = 0; t < 3; t++) {
    const w = ((3 - t) * 30 + 34) * s;
    const y = baseY + terraceH / 2 + t * terraceH;
    b.add("marble", cuboid(w, terraceH, w), x, y, z);
    b.add("gold", cuboid(w + 1.4 * s, 0.7 * s, w + 1.4 * s), x, baseY + (t + 1) * terraceH, z);
  }
  const bellBase = baseY + 3 * terraceH;
  const bellH = 66 * s;
  // The lathe profile is normalised (radius 1, height 1): the donor
  // scales by (0.62h, h, 0.62h), so the radial factor must track bellH,
  // not the landmark scale, or the bell collapses to a needle.
  const stupa = stupaGeometry();
  b.add("gold", stupa, x, bellBase, z, 0, 0xffffff, bellH * 0.62, bellH, bellH * 0.62);
  // Hti: stacked gilt rings, cone and finial ball.
  const htiS = 12 * s;
  for (let k = 0; k < 5; k++) {
    const ring = new THREE.TorusGeometry(htiS * (0.42 - k * 0.07), htiS * 0.035, 5, 12);
    ring.rotateX(Math.PI / 2);
    b.add("gold", ring, x, bellBase + bellH * 0.96 + k * htiS * 0.13, z);
  }
  b.add("gold", new THREE.ConeGeometry(htiS * 0.16, htiS * 0.9, 8), x, bellBase + bellH * 0.96 + htiS * 0.62, z);
  b.add("gold", new THREE.SphereGeometry(htiS * 0.07, 7, 5), x, bellBase + bellH * 1.1, z);
  // Four stairways and chinthe guardians.
  const bw = 34 * s;
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let k = 0; k < 5; k++) {
      const dist = bw / 2 + 12 * s - k * 2.6 * s;
      b.add(
        "marble",
        cuboid(10 * s, 1.2 * s, 2.6 * s),
        x + dx * dist,
        bellBase - 1.2 * s - k * 1.1 * s,
        z + dz * dist,
        a
      );
    }
    for (const sgn of [-1, 1]) {
      b.add(
        "marble",
        new THREE.ConeGeometry(1.8 * s, 4.6 * s, 6),
        x + dx * (bw / 2 + 6 * s) - dz * sgn * 4 * s,
        bellBase + 2.4 * s,
        z + dz * (bw / 2 + 6 * s) + dx * sgn * 4 * s
      );
    }
  }
}

function buildOuterLandmarks(b: CityBuilder, plan: CityPlan): void {
  const miniStupa = stupaGeometry();
  for (const lm of plan.landmarks) {
    if (lm.kind === "citadelHalls") continue;
    const { x, z, baseY, scale } = lm;
    if (lm.kind === "greatPagoda") {
      buildGreatPagoda(b, x, z, scale, baseY);
    } else if (lm.kind === "shrineCourt") {
      // Kyauksa-gu shrines: whitewashed grotto, mini bell, gilt top.
      for (const sh of plan.shrines) {
        b.add("marble", cuboid(4.2, 3.4, 4.2), sh.x, baseY + 1.7, sh.z, sh.yaw, 0xf2ece0);
        const bell = miniStupa.clone();
        b.add("marble", bell, sh.x, baseY + 3.6, sh.z, sh.yaw, 0xfaf6ec, 1.9, 3.6, 1.9);
        b.add("gold", new THREE.ConeGeometry(0.62, 2.1, 6), sh.x, baseY + 6.6, sh.z);
      }
    } else if (lm.kind === "monastery") {
      // Shwenandaw-style teak monastery on posts with a five-tier roof.
      b.add("brick", cuboid(44, 1.6, 32), x, baseY + 0.8, z);
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 4; j++) {
          b.add(
            "teak",
            new THREE.CylinderGeometry(0.32, 0.38, 3.4, 6),
            x - 18 + i * 6,
            baseY + 3.3,
            z - 12 + j * 8
          );
        }
      }
      b.add("teak", cuboid(38, 4.2, 26), x, baseY + 6.4, z);
      b.pyatthat(x, z, baseY + 8.6, 5, 1.7, 22, 0.78, 3.4);
    } else if (lm.kind === "market") {
      // Zegyo-style tiered market hall with a gilt spire and stall grid.
      for (let t = 0; t < 4; t++) {
        const size = 64 - t * 13;
        b.add("concrete", cuboid(size, 4.6, size), x, baseY + 2.3 + t * 4.4, z, Math.PI / 4);
      }
      b.add("gold", new THREE.ConeGeometry(5, 14, 4), x, baseY + 25, z, Math.PI / 4);
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          if (Math.abs(i) < 1 && Math.abs(j) < 1) continue;
          const sx = x + i * 13;
          const sz = z + j * 12;
          b.add("iron", cuboid(5, 0.5, 5), sx, baseY + 0.7, sz);
          b.add("cloth", new THREE.ConeGeometry(3.4, 1.7, 7), sx, baseY + 1.9, sz, 0, (i + j) % 2 ? 0xb0342b : 0xe8e3d6);
        }
      }
    } else if (lm.kind === "clockTower") {
      b.add("concrete", cuboid(7, 12, 7), x, baseY + 6, z);
      b.add("plaster", cuboid(8, 0.9, 8), x, baseY + 12.4, z);
      b.add("concrete", cuboid(5.4, 4.4, 5.4), x, baseY + 15, z);
      const dial = new THREE.CylinderGeometry(1.8, 1.8, 0.4, 16);
      dial.rotateX(Math.PI / 2);
      b.add("marble", dial, x, baseY + 15.4, z - 2.8);
      b.pyatthat(x, z, baseY + 17.2, 2, 1.6, 5.6, 0.7, 3.2);
    }
  }
}

/**
 * Remove scatter instances (trees/rocks) that fall inside the city
 * footprint. Operates only on runtime InstancedMesh objects — the
 * locked engine files and their scatter rules are not modified.
 */
export function pruneInstancedInside(
  scene: THREE.Scene,
  center: { x: number; z: number },
  half: number,
  margin = 14
): number {
  let removed = 0;
  const m = new THREE.Matrix4();
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.InstancedMesh)) return;
    const keep: THREE.Matrix4[] = [];
    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, m);
      const x = m.elements[12];
      const z = m.elements[14];
      if (Math.abs(x - center.x) <= half + margin && Math.abs(z - center.z) <= half + margin) {
        removed++;
        continue;
      }
      keep.push(m.clone());
    }
    if (keep.length === obj.count) return;
    for (let i = 0; i < keep.length; i++) obj.setMatrixAt(i, keep[i]);
    obj.count = keep.length;
    obj.instanceMatrix.needsUpdate = true;
    obj.computeBoundingSphere();
  });
  return removed;
}

export function buildCity(plan: CityPlan): CityBuildResult {
  const group = new THREE.Group();
  group.name = "Royal city / Mandalay v1";
  const b = new CityBuilder();

  buildTerraces(b, plan);
  buildMoatAndBridges(b, plan);
  buildCitadel(b, plan);
  buildHouses(b, plan);
  buildOuterLandmarks(b, plan);

  const { triangles, meshes } = b.flush(group);
  return {
    group,
    materials: b.materials,
    stats: { triangles: Math.round(triangles), meshes, pieces: b.pieces }
  };
}
