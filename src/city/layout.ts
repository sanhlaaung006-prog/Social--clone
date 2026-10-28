/*
 * ROYAL CITY LAYOUT KERNEL (pure, deterministic)
 * ------------------------------------------------------------------
 * The plan for a compact Mandalay-inspired royal city placed in the
 * middle of the 5 km dry lowland. This module owns NO three.js, DOM or
 * wall-clock state: given a seed and a ground-height sampler it always
 * produces the identical CityPlan, so the city is testable headlessly
 * and safe to freeze behind a checksum lock.
 *
 * Techniques (city grid, paired shophouse plots, battered citadel with
 * 12 zodiac gates, moat ring + bridges, Shwezigon-type stupa court,
 * pyatthat tiered roofs, teak monastery on posts, central market) are
 * re-authored from the user-supplied "Mandalay textured reconstruction"
 * standalone (no license declared, project-owned reference). Dimensions
 * are rescaled ~0.3x so the 13 km donor city fits our 5 km battlefield.
 */

export type HeightSampler = (x: number, z: number) => number;

/** Mulberry32 — tiny deterministic PRNG (public-domain algorithm). */
export class CityRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(this.state, 0x4d2f) + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

/* ------------------------------ tunables ------------------------------ */

export const CITY_PLAN_VERSION = "mandalay-v1";
export const CITY_SEED = 730102;
export const CITY_CENTER = { x: 0, z: 0 } as const;
/** Half-extent of the whole terraced city, metres. */
export const CITY_FOOTPRINT = 560;

export const CITADEL = {
  /** Half-length of the square citadel wall (donor PAL=1000, scaled). */
  pal: 250,
  wallH: 5.2,
  wallT0: 2.6, // base thickness (battered)
  wallT1: 1.3, // crown thickness
  gateGap: 5.4,
  gateOffsets: [-125, 0, 125],
  bastionsPerSide: 7,
  bastionSize: 11
} as const;

export const MOAT = {
  inner: 262,
  outer: 284,
  /** Water surface height above the citadel platform top. */
  waterDepth: 1.1
} as const;

const BLOCK_PITCH_X = 104;
const BLOCK_PITCH_Z = 92;
const ROAD_W = 11;
const BAND_INNER = MOAT.outer + 26;
const BAND_OUTER = CITY_FOOTPRINT - 16;
export const SHRINE_COUNT = 84; // donor had 729; mobile budget

/** Exterior plaster wash for shophouses (donor PALETTE, re-authored). */
export const HOUSE_PALETTE = [
  0xe9e0cd, 0xdcd2bd, 0xccc0a9, 0xc6b39a, 0xe8dbc4, 0xc3bcb0,
  0xd9c6b4, 0xe2d2b6, 0xd7c9b2, 0xbfc7c2, 0xe4d3c2, 0xcfae9a
] as const;

/* ------------------------------- records ------------------------------ */

export interface Pad {
  x: number;
  z: number;
  hw: number;
  hd: number;
  topY: number;
  bottomY: number;
  kind: "block" | "citadel" | "court" | "market" | "tower";
}

export interface Surface {
  x: number;
  z: number;
  hw: number;
  hd: number;
  topY: number;
}

export interface Collider {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface RoadSeg {
  x: number;
  z: number;
  len: number;
  width: number;
  axis: "x" | "z";
  topY: number;
  bottomY: number;
}

export interface HouseUnit {
  /** Local offset along the pair's transverse axis, metres. */
  ox: number;
  w: number;
  d: number;
  h: number;
  floors: number;
  tint: number;
  roof: "tin" | "tile";
}

export interface HousePair {
  id: number;
  x: number;
  z: number;
  /** Yaw: 0 = ridge along z, PI/2 = ridge along x. */
  rot: number;
  units: [HouseUnit, HouseUnit];
  blockX: number;
  blockZ: number;
}

export type LandmarkKind =
  | "citadelHalls"
  | "greatPagoda"
  | "shrineCourt"
  | "monastery"
  | "market"
  | "clockTower";

export interface Landmark {
  kind: LandmarkKind;
  x: number;
  z: number;
  scale: number;
  baseY: number;
  colliders: Collider[];
}

export interface WallSeg {
  x: number;
  z: number;
  len: number;
  axis: "x" | "z";
}

export interface CityPlan {
  version: string;
  seed: number;
  center: { x: number; z: number };
  footprint: number;
  pads: Pad[];
  surfaces: Surface[];
  roads: RoadSeg[];
  pairs: HousePair[];
  landmarks: Landmark[];
  wallSegs: WallSeg[];
  bastions: Collider[];
  bridges: Array<{ x: number; z: number; axis: "x" | "z" }>;
  shrines: Array<{ x: number; z: number; yaw: number }>;
  colliders: Collider[];
  padY: number;
  waterY: number;
  stats: {
    houses: number;
    pairs: number;
    blocks: number;
    roads: number;
    landmarks: number;
  };
}

/* ----------------------------- planning math ---------------------------- */

interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

function sampleExtent(
  h: HeightSampler,
  x: number,
  z: number,
  hw: number,
  hd: number,
  n = 4
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k <= n; k++) {
      const v = h(x - hw + (2 * hw * i) / n, z - hd + (2 * hd * k) / n);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max };
}

function overlaps(a: Box, b: Box, pad = 0): boolean {
  return (
    Math.abs(a.x - b.x) < a.hw + b.hw + pad &&
    Math.abs(a.z - b.z) < a.hd + b.hd + pad
  );
}

/** Fixed landmark plots (donor PLOTS, rescaled and re-centered). */
function landmarkPlots(): Array<Box & { kind: LandmarkKind }> {
  return [
    { x: 360, z: -360, hw: 92, hd: 92, kind: "greatPagoda" },
    { x: 360, z: -360, hw: 118, hd: 118, kind: "shrineCourt" },
    { x: 150, z: -420, hw: 84, hd: 78, kind: "monastery" },
    { x: -380, z: -260, hw: 98, hd: 82, kind: "market" },
    { x: 332, z: -148, hw: 24, hd: 24, kind: "clockTower" }
  ];
}

function makePad(
  h: HeightSampler,
  x: number,
  z: number,
  hw: number,
  hd: number,
  kind: Pad["kind"],
  lift = 0.6
): Pad {
  const ext = sampleExtent(h, x, z, hw, hd);
  const topY = ext.max + lift;
  const bottomY = ext.min - 1.4;
  return { x, z, hw, hd, topY, bottomY, kind };
}

function planCitadel(h: HeightSampler): {
  pad: Pad;
  walls: WallSeg[];
  bastions: Collider[];
  bridges: CityPlan["bridges"];
  colliders: Collider[];
  landmarks: Landmark[];
} {
  const { pal, gateGap, gateOffsets, bastionsPerSide, bastionSize } = CITADEL;
  const pad = makePad(h, 0, 0, pal + 14, pal + 14, "citadel", 1.1);
  const colliders: Collider[] = [];
  const walls: WallSeg[] = [];

  // Four walls split around the three gate openings per side.
  for (const axis of ["x", "z"] as const) {
    for (const sgn of [-1, 1]) {
      const cuts = [...gateOffsets].sort((a, b) => a - b);
      let cursor = -pal;
      const pushSeg = (a: number, b: number) => {
        if (b - a < 4) return;
        const mid = (a + b) / 2;
        const len = b - a;
        if (axis === "x") {
          walls.push({ x: mid, z: sgn * pal, len, axis });
          colliders.push({ x: mid, z: sgn * pal, hw: len / 2, hd: CITADEL.wallT0 / 2 + 0.2 });
        } else {
          walls.push({ x: sgn * pal, z: mid, len, axis });
          colliders.push({ x: sgn * pal, z: mid, hw: CITADEL.wallT0 / 2 + 0.2, hd: len / 2 });
        }
      };
      for (const g of cuts) {
        pushSeg(cursor, g - gateGap / 2);
        cursor = g + gateGap / 2;
      }
      pushSeg(cursor, pal);
    }
  }

  // Bastions on a regular pitch, corners de-duplicated.
  const bastions: Collider[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < bastionsPerSide; k++) {
    const t = -pal + (2 * pal * k) / (bastionsPerSide - 1);
    // Zodiac gates own their wall position: a bastion pitched on a gate
    // offset is omitted so the opening stays walkable.
    if (gateOffsets.some((g) => Math.abs(g - t) < 1)) continue;
    for (const [x, z] of [
      [t, -pal], [t, pal], [-pal, t], [pal, t]
    ]) {
      const key = `${x.toFixed(1)},${z.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = { x, z, hw: bastionSize / 2, hd: bastionSize / 2 };
      bastions.push(b);
      colliders.push(b);
    }
  }

  // Five teak bridges: four royal gates plus the SW amingala gate.
  const bridgeMid = (MOAT.inner + MOAT.outer) / 2;
  const bridges: CityPlan["bridges"] = [
    { x: 0, z: -bridgeMid, axis: "z" },
    { x: 0, z: bridgeMid, axis: "z" },
    { x: -bridgeMid, z: 0, axis: "x" },
    { x: bridgeMid, z: 0, axis: "x" },
    { x: -bridgeMid, z: bridgeMid, axis: "x" }
  ];

  // Interior royal masses (donor citadel buildings, rescaled ~0.3).
  const y = pad.topY;
  const hallColliders: Collider[] = [
    { x: 46, z: 0, hw: 17, hd: 15 }, // Lion Throne Room
    { x: 118, z: 0, hw: 30, hd: 26 }, // Great Audience Hall
    { x: -92, z: -8, hw: 24, hd: 19 }, // Glass Palace
    { x: 120, z: 78, hw: 15, hd: 11 }, // Hluttaw court
    { x: -96, z: -64, hw: 7, hd: 7 }, // watch tower
    { x: -120, z: 62, hw: 9, hd: 9 } // Pitakataik library
  ];
  colliders.push(...hallColliders);
  const landmarks: Landmark[] = [
    { kind: "citadelHalls", x: 0, z: 0, scale: 1, baseY: y, colliders: hallColliders }
  ];

  return { pad, walls, bastions, bridges, colliders, landmarks };
}

function planBlocks(
  rng: CityRng,
  h: HeightSampler,
  reserved: Box[]
): { pads: Pad[]; surfaces: Surface[]; pairs: HousePair[]; blocks: number } {
  const pads: Pad[] = [];
  const surfaces: Surface[] = [];
  const pairs: HousePair[] = [];
  let blocks = 0;
  let pairId = 0;

  // Pads extend all the way to the road carriageway edge so no raw
  // terrain seam is visible between terraces.
  const blockHw = BLOCK_PITCH_X / 2 - ROAD_W / 2;
  const blockHd = BLOCK_PITCH_Z / 2 - ROAD_W / 2;

  for (let cx = -BAND_OUTER; cx <= BAND_OUTER; cx += BLOCK_PITCH_X) {
    for (let cz = -BAND_OUTER; cz <= BAND_OUTER; cz += BLOCK_PITCH_Z) {
      const block: Box = { x: cx, z: cz, hw: blockHw, hd: blockHd };
      if (Math.hypot(cx, cz) < BAND_INNER) continue;
      if (Math.abs(cx) + blockHw > CITY_FOOTPRINT || Math.abs(cz) + blockHd > CITY_FOOTPRINT) continue;
      if (reserved.some((r) => overlaps(block, r, 6))) continue;
      if (rng.chance(0.07)) continue; // occasional vacant lot / grove
      blocks++;

      const pad = makePad(h, cx, cz, blockHw, blockHd, "block", 0.5);
      pads.push(pad);
      surfaces.push({ x: cx, z: cz, hw: pad.hw, hd: pad.hd, topY: pad.topY });

      // Two or three TWIN HOUSE pairs per block: semidetached units
      // sharing a party wall, mirrored under one ridge line.
      const pairCount = rng.chance(0.3) ? 3 : 2;
      for (let p = 0; p < pairCount; p++) {
        const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
        const along = (p - (pairCount - 1) / 2) * (rot === 0 ? BLOCK_PITCH_Z / pairCount : BLOCK_PITCH_X / pairCount);
        const px = cx + (rot === 0 ? rng.range(-6, 6) : along);
        const pz = cz + (rot === 0 ? along : rng.range(-6, 6));
        const downtown = Math.hypot(px + 380, pz + 260) < 260;
        const units: HouseUnit[] = [];
        const w = rng.range(10.5, 14);
        const d = rng.range(9, 12.5);
        for (const side of [-1, 1]) {
          const tall = downtown && rng.chance(0.3);
          const floors = tall ? rng.int(3, 4) : rng.int(1, 2);
          const hh = tall ? rng.range(10, 14.5) : rng.range(3.6, 8.4);
          units.push({
            ox: side * (w / 2 + 0.2),
            w,
            d,
            h: hh,
            floors,
            tint: rng.pick(HOUSE_PALETTE),
            roof: rng.chance(0.32) ? "tin" : "tile"
          });
        }
        pairs.push({
          id: pairId++,
          x: px,
          z: pz,
          rot,
          units: [units[0], units[1]],
          blockX: cx,
          blockZ: cz
        });
      }
    }
  }
  return { pads, surfaces, pairs, blocks };
}

function planRoads(h: HeightSampler): { roads: RoadSeg[]; surfaces: Surface[] } {
  const roads: RoadSeg[] = [];
  const surfaces: Surface[] = [];
  const lift = 0.25;

  const addSeg = (x: number, z: number, len: number, axis: "x" | "z") => {
    const hw = axis === "x" ? len / 2 : ROAD_W / 2;
    const hd = axis === "z" ? len / 2 : ROAD_W / 2;
    const ext = sampleExtent(h, x, z, hw, hd, Math.max(2, Math.round(len / 30)));
    const topY = ext.max + lift;
    const seg: RoadSeg = {
      x, z, len, width: ROAD_W, axis,
      topY, bottomY: ext.min - 1.2
    };
    roads.push(seg);
    surfaces.push({ x, z, hw, hd, topY });
  };

  // Grid lines run through the MIDPOINTS between block pads (half-pitch
  // offset), clipped so no road crosses the moat (bridges do that).
  for (let c = -BAND_OUTER + BLOCK_PITCH_X / 2; c <= BAND_OUTER; c += BLOCK_PITCH_X) {
    if (Math.abs(c) < MOAT.outer + 8) continue;
    addSeg(c, 0, 2 * (BAND_OUTER - 4), "z");
  }
  for (let c = -BAND_OUTER + BLOCK_PITCH_Z / 2; c <= BAND_OUTER; c += BLOCK_PITCH_Z) {
    if (Math.abs(c) < MOAT.outer + 8) continue;
    addSeg(0, c, 2 * (BAND_OUTER - 4), "x");
  }
  // Ring road around the moat, four strips with gate-side gaps implied.
  const ring = MOAT.outer + 11;
  addSeg(0, -ring, 2 * ring + 24, "x");
  addSeg(0, ring, 2 * ring + 24, "x");
  addSeg(-ring, 0, 2 * ring + 24, "z");
  addSeg(ring, 0, 2 * ring + 24, "z");

  // Every road segment is itself a shallow retaining box down to the
  // sampled low, so seams between terraced blocks never float.
  return { roads, surfaces };
}

function planOuterLandmarks(
  h: HeightSampler,
  plots: Array<Box & { kind: LandmarkKind }>
): { pads: Pad[]; surfaces: Surface[]; landmarks: Landmark[]; shrines: CityPlan["shrines"]; colliders: Collider[] } {
  const pads: Pad[] = [];
  const surfaces: Surface[] = [];
  const landmarks: Landmark[] = [];
  const colliders: Collider[] = [];
  const shrines: CityPlan["shrines"] = [];

  for (const plot of plots) {
    const kind = plot.kind;
    const padKind: Pad["kind"] =
      kind === "market" ? "market" : kind === "clockTower" ? "tower" : "court";
    const pad = makePad(h, plot.x, plot.z, plot.hw, plot.hd, padKind, 0.8);
    pads.push(pad);
    surfaces.push({ x: plot.x, z: plot.z, hw: plot.hw, hd: plot.hd, topY: pad.topY });

    const scale = kind === "greatPagoda" ? 0.46 : kind === "market" ? 0.9 : 1;
    const localColliders: Collider[] = [];
    if (kind === "greatPagoda") {
      localColliders.push({ x: plot.x, z: plot.z, hw: 30, hd: 30 });
      // Square concentric rings of kyauksa-gu shrines around the stupa.
      let placed = 0;
      for (let ring = 0; ring < 8 && placed < SHRINE_COUNT; ring++) {
        const rad = 44 + ring * 9;
        const n = Math.min(SHRINE_COUNT - placed, Math.max(12, Math.floor((8 * rad) / 10.5)));
        for (let k = 0; k < n && placed < SHRINE_COUNT; k++) {
          const a = (k / n) * Math.PI * 2;
          const rr = rad / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
          const sx = plot.x + Math.cos(a) * rr;
          const sz = plot.z + Math.sin(a) * rr;
          if (Math.abs(sx - plot.x) < 34 && Math.abs(sz - plot.z) < 34) continue;
          if (Math.abs(sx - plot.x) > plot.hw - 6 || Math.abs(sz - plot.z) > plot.hd - 6) continue;
          shrines.push({ x: sx, z: sz, yaw: a });
          placed++;
        }
      }
    } else if (kind === "monastery") {
      localColliders.push({ x: plot.x, z: plot.z, hw: 26, hd: 18 });
    } else if (kind === "market") {
      localColliders.push({ x: plot.x, z: plot.z, hw: 34, hd: 26 });
    } else if (kind === "clockTower") {
      localColliders.push({ x: plot.x, z: plot.z, hw: 6, hd: 6 });
    }
    landmarks.push({ kind, x: plot.x, z: plot.z, scale, baseY: pad.topY, colliders: localColliders });
    colliders.push(...localColliders);
  }
  return { pads, surfaces, landmarks, shrines, colliders };
}

/* ------------------------------ public API ----------------------------- */

export function planCity(seed: number, height: HeightSampler): CityPlan {
  const rng = new CityRng(seed);
  const plots = landmarkPlots();
  const reserved: Box[] = [
    { x: 0, z: 0, hw: MOAT.outer + 4, hd: MOAT.outer + 4 },
    ...plots.map((p) => ({ x: p.x, z: p.z, hw: p.hw, hd: p.hd }))
  ];

  const citadel = planCitadel(height);
  const blocks = planBlocks(rng, height, reserved);
  const roads = planRoads(height);
  const outer = planOuterLandmarks(height, plots);

  const pads = [citadel.pad, ...blocks.pads, ...outer.pads];
  const surfaces = [...blocks.surfaces, ...roads.surfaces, ...outer.surfaces];

  // House footprint colliders (rot 0/PI2 only -> swap half extents).
  const houseColliders: Collider[] = [];
  for (const pair of blocks.pairs) {
    for (const u of pair.units) {
      const dx = pair.rot === 0 ? u.ox : 0;
      const dz = pair.rot === 0 ? 0 : u.ox;
      const hw = pair.rot === 0 ? u.w / 2 : u.d / 2;
      const hd = pair.rot === 0 ? u.d / 2 : u.w / 2;
      houseColliders.push({ x: pair.x + dx, z: pair.z + dz, hw, hd });
    }
  }

  const padY = citadel.pad.topY;
  const plan: CityPlan = {
    version: CITY_PLAN_VERSION,
    seed,
    center: { ...CITY_CENTER },
    footprint: CITY_FOOTPRINT,
    pads,
    surfaces,
    roads: roads.roads,
    pairs: blocks.pairs,
    landmarks: [...citadel.landmarks, ...outer.landmarks],
    wallSegs: citadel.walls,
    bastions: citadel.bastions,
    bridges: citadel.bridges,
    shrines: outer.shrines,
    colliders: [...citadel.colliders, ...houseColliders, ...outer.colliders],
    padY,
    waterY: padY + MOAT.waterDepth,
    stats: {
      houses: blocks.pairs.length * 2,
      pairs: blocks.pairs.length,
      blocks: blocks.blocks,
      roads: roads.roads.length,
      landmarks: citadel.landmarks.length + outer.landmarks.length
    }
  };
  return plan;
}

export function isCityFootprint(plan: CityPlan, x: number, z: number, margin = 0): boolean {
  const f = plan.footprint + margin;
  return Math.abs(x - plan.center.x) <= f && Math.abs(z - plan.center.z) <= f;
}

/** Highest terraced surface under a point, or null outside the city. */
export function citySurfaceY(plan: CityPlan, x: number, z: number): number | null {
  let best: number | null = null;
  for (const s of plan.surfaces) {
    if (Math.abs(x - s.x) <= s.hw && Math.abs(z - s.z) <= s.hd) {
      if (best === null || s.topY > best) best = s.topY;
    }
  }
  return best;
}

/**
 * Circle-vs-AABB push-out for the first-person controller. Two passes
 * resolve adjacent colliders; gate openings are simply absent from the
 * collider list, so routes through the walls remain walkable.
 */
export function resolveCityCollision(
  plan: CityPlan,
  x: number,
  z: number,
  radius: number
): { x: number; z: number; blocked: boolean } {
  let px = x;
  let pz = z;
  let blocked = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of plan.colliders) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const ox = c.hw + radius - Math.abs(dx);
      const oz = c.hd + radius - Math.abs(dz);
      if (ox <= 0 || oz <= 0) continue;
      blocked = true;
      if (ox < oz) px = c.x + (dx >= 0 ? 1 : -1) * (c.hw + radius);
      else pz = c.z + (dz >= 0 ? 1 : -1) * (c.hd + radius);
    }
  }
  return { x: px, z: pz, blocked };
}
