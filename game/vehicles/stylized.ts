/*
 * STYLIZED LOW-POLY VEHICLE FACTORY
 * ------------------------------------------------------------------
 * Hand-authored Quaternius/PUBG-style geometry. Strict house rules:
 *
 *   1. No raw THREE.BoxGeometry for hulls or turrets. Every block-like
 *      part is either a custom BufferGeometry wedge, an ExtrudeGeometry
 *      side profile, or a vertex-manipulated tapered box.
 *   2. Hulls are angled wedges (sloped glacis, angled side belts).
 *      Turrets are faceted cylinders; barrels are horizontal cylinders;
 *      the jet nose is a cone and its wings are swept, tapered slabs.
 *   3. Every material uses flatShading: true. One slightly metallic grey
 *      chassis material plus a dark-green camo material unify the family.
 *   4. Turrets are proportioned to their hulls — nothing is box-stacked.
 *
 * Convention: +Z is forward (the Vehicle wrapper adds the yaw+PI vendor
 * correction). Units are metres. Three.js is the only dependency.
 */

import * as THREE from "three";

/* ------------------------------ materials ------------------------------ */

export interface VehicleMaterials {
  /** Slightly metallic grey — chassis, turrets, barrels, frames. */
  chassis: THREE.MeshStandardMaterial;
  /** Dark-green camo — armor plates, fenders, accent panels. */
  camo: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

export function createVehicleMaterials(): VehicleMaterials {
  return {
    chassis: new THREE.MeshStandardMaterial({
      color: 0x8d9398,
      metalness: 0.32,
      roughness: 0.55,
      flatShading: true,
    }),
    camo: new THREE.MeshStandardMaterial({
      color: 0x3c4a33,
      metalness: 0.15,
      roughness: 0.82,
      flatShading: true,
    }),
    darkMetal: new THREE.MeshStandardMaterial({
      color: 0x2b2f33,
      metalness: 0.6,
      roughness: 0.45,
      flatShading: true,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x17181a,
      metalness: 0.05,
      roughness: 0.95,
      flatShading: true,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x1d3338,
      metalness: 0.2,
      roughness: 0.15,
      transparent: true,
      opacity: 0.6,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  };
}

/* --------------------------- geometry helpers --------------------------- */

type V3 = [number, number, number];

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name?: string
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  parent.add(m);
  return m;
}

/**
 * Angled hull wedge: a side profile (rear-bottom → nose → glacis → roof →
 * rear) extruded across two widths. The top belt is narrower than the
 * bottom, so the side armor slopes outward — no vertical box walls.
 */
export function wedgeHullGeometry(opts: {
  length: number;
  bottomWidth: number;
  topWidth: number;
  height: number;
  /** Horizontal length of the sloped front glacis plate. */
  glacis: number;
  /** Height of the low nose edge the glacis rises from. */
  noseHeight?: number;
}): THREE.BufferGeometry {
  const { length: L, bottomWidth: wb, topWidth: wt, height: H, glacis: g } = opts;
  const hn = opts.noseHeight ?? H * 0.42;
  const hb = L / 2;

  // Side profile as (z, y), front of vehicle at +Z.
  const profile: Array<[number, number]> = [
    [-hb, 0], // p0 rear bottom
    [hb, 0], // p1 front bottom
    [hb, hn], // p2 nose lip
    [hb - g, H], // p3 top of glacis
    [-hb, H], // p4 rear top
  ];

  const positions: number[] = [];
  // Bottom edge (p0,p1) uses the full bottom width; the upper belt
  // (p2,p3,p4) uses the narrower top width.
  const widthAt = (i: number) => (i <= 1 ? wb : wt) / 2;
  for (let i = 0; i < profile.length; i++) {
    const [z, y] = profile[i];
    const x = widthAt(i);
    positions.push(-x, y, z, x, y, z);
  }

  const indices: number[] = [];
  const v = (i: number, side: 0 | 1) => i * 2 + side; // side 0 = left(-x), 1 = right(+x)
  const tri = (a: number, b: number, c: number) => indices.push(a, b, c);

  // Bottom, nose plate, glacis, roof, rear — each spans both side vertices.
  tri(v(0, 0), v(1, 1), v(1, 0));
  tri(v(0, 0), v(0, 1), v(1, 1));
  tri(v(1, 0), v(2, 1), v(2, 0));
  tri(v(1, 0), v(1, 1), v(2, 1));
  tri(v(2, 0), v(3, 1), v(3, 0));
  tri(v(2, 0), v(2, 1), v(3, 1));
  tri(v(3, 0), v(4, 1), v(4, 0));
  tri(v(3, 0), v(3, 1), v(4, 1));
  tri(v(4, 0), v(0, 1), v(0, 0));
  tri(v(4, 0), v(4, 1), v(0, 1));

  // Side polygons (fan from first profile vertex).
  for (const side of [0, 1] as const) {
    for (let i = 1; i < profile.length - 1; i++) {
      if (side === 1) tri(v(0, side), v(i, side), v(i + 1, side));
      else tri(v(0, side), v(i + 1, side), v(i, side));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Hand-authored slab BufferGeometry (8 vertices, 12 triangles) — NOT a
 * BoxGeometry. Corners are generated already tapered along X (per-side
 * width and chord scaling) and optionally swept back along Z. Used only
 * for wings, fins and bed rails, never for a hull or turret.
 */
export function taperedSlabGeometry(opts: {
  width: number;
  height: number;
  depth: number;
  /** 0..1 — how much narrower the outer tip is than the root. */
  taper?: number;
  /** How far the tip slides backward (sweep), in metres. */
  sweep?: number;
}): THREE.BufferGeometry {
  const { width, height, depth, taper = 0, sweep = 0 } = opts;
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;

  // Eight corners; corner index = x-bit + 2*y-bit + 4*z-bit.
  const corner = (sx: number, sy: number, sz: number): V3 => {
    const f = Math.abs(sx * hx) / hx; // 0 at root plane, 1 at tip
    const x = sx * hx;
    const y = sy * hy * (1 - taper * 0.15 * f);
    const z = sz * hz * (1 - taper * 0.55 * f) - sweep * f * Math.sign(sx);
    return [x, y, z];
  };
  const corners: V3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(corner(sx, sy, sz));
  const idx = (sx: number, sy: number, sz: number) =>
    (sx > 0 ? 1 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 4 : 0);

  const positions: number[] = [];
  for (const c of corners) positions.push(...c);
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) =>
    indices.push(a, b, c, a, c, d);
  // Faces: -Z, +Z, -Y, +Y, -X, +X (outward winding).
  quad(idx(-1, -1, -1), idx(1, -1, -1), idx(1, 1, -1), idx(-1, 1, -1));
  quad(idx(-1, -1, 1), idx(-1, 1, 1), idx(1, 1, 1), idx(1, -1, 1));
  quad(idx(-1, -1, -1), idx(-1, -1, 1), idx(1, -1, 1), idx(1, -1, -1));
  quad(idx(-1, 1, -1), idx(1, 1, -1), idx(1, 1, 1), idx(-1, 1, 1));
  quad(idx(-1, -1, -1), idx(-1, 1, -1), idx(-1, 1, 1), idx(-1, -1, 1));
  quad(idx(1, -1, -1), idx(1, -1, 1), idx(1, 1, 1), idx(1, 1, -1));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Horizontal cylinder along Z (barrels, axles, pedestals use rotations). */
function barrelGeometry(radiusTop: number, radiusBottom: number, length: number, segments = 8) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments, 1);
  geo.rotateX(Math.PI / 2); // cylinder Y axis -> world Z (forward)
  return geo;
}

/** Cylinder laid across X (track belts, wheel drums, axles). */
function crossCylinderGeometry(radius: number, length: number, segments = 10) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, segments, 1);
  geo.rotateZ(Math.PI / 2); // Y axis -> X
  return geo;
}

/** Extrude a longitudinal side profile across a chassis width. */
function extrudedProfileGeometry(profile: Array<[number, number]>, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 1,
  });
  // Local XY profile (X = longitudinal) extruded along local Z (width).
  // Rotate so longitudinal -> world +Z and extrusion -> world X.
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------- tank --------------------------------- */

export function buildStylizedTank(): THREE.Group {
  const mats = createVehicleMaterials();
  const root = new THREE.Group();
  root.name = "Stylized MBT";

  // Track belts: faceted octagonal prisms across the hull sides.
  const trackLen = 5.7;
  for (const side of [-1, 1]) {
    mesh(root, crossCylinderGeometry(0.74, trackLen, 8), mats.rubber, "track-belt");
    const belt = root.children[root.children.length - 1];
    belt.position.set(side * 1.42, 0.78, 0);
    // Road wheels (three per side) peeking out of the belt.
    for (const z of [-1.9, 0, 1.9]) {
      const wheel = mesh(root, crossCylinderGeometry(0.44, 0.55, 10), mats.darkMetal, "road-wheel");
      wheel.position.set(side * 1.42, 0.62, z);
    }
  }

  // Main hull: custom wedge with sloped glacis and angled side belts.
  const hull = mesh(
    root,
    wedgeHullGeometry({
      length: 6.3,
      bottomWidth: 3.15,
      topWidth: 2.65,
      height: 1.35,
      glacis: 1.75,
      noseHeight: 0.55,
    }),
    mats.chassis,
    "wedge-hull"
  );
  hull.position.y = 0.95;

  // Dark-green camo fender plates riding above each track (angled slabs).
  for (const side of [-1, 1]) {
    const fender = mesh(root, taperedSlabGeometry({ width: 0.5, height: 0.12, depth: 5.4 }), mats.camo, "camo-fender");
    fender.rotation.z = side * 0.06;
    fender.position.set(side * 1.5, 1.62, -0.1);
  }
  // Rear engine deck panel in camo green.
  const deck = mesh(root, taperedSlabGeometry({ width: 2.5, height: 0.1, depth: 1.5 }), mats.camo, "engine-deck");
  deck.position.set(0, 2.36, -2.25);

  // Turret: faceted oval dome (12-segment cylinder, scaled oval), properly
  // proportioned — diameter ~62% of the hull width, not a stacked box.
  const turret = new THREE.Group();
  turret.name = "turretPivot";
  turret.position.set(0, 2.28, 0.35);
  root.add(turret);

  const domeGeo = new THREE.CylinderGeometry(0.82, 1.08, 0.92, 12, 1);
  domeGeo.scale(1, 1, 1.28); // oval cast turret, longer fore-aft
  mesh(turret, domeGeo, mats.chassis, "turret-dome");
  const capGeo = new THREE.CylinderGeometry(0.55, 0.82, 0.34, 12, 1);
  capGeo.scale(1, 1, 1.28);
  const cap = mesh(turret, capGeo, mats.chassis, "turret-cap");
  cap.position.y = 0.6;
  // Commander's hatch and anti-air mount detail.
  const hatch = mesh(turret, new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), mats.darkMetal, "hatch");
  hatch.position.set(-0.3, 0.82, -0.35);

  // Gun mantlet + barrel: horizontal 8-segment cylinders.
  const mantlet = mesh(turret, barrelGeometry(0.34, 0.4, 0.7, 10), mats.darkMetal, "mantlet");
  mantlet.position.set(0, 0.05, 1.25);
  const barrel = mesh(turret, barrelGeometry(0.1, 0.15, 4.3, 8), mats.darkMetal, "gun-barrel");
  barrel.position.set(0, 0.05, 3.45);
  const brake = mesh(turret, barrelGeometry(0.17, 0.17, 0.5, 8), mats.darkMetal, "muzzle-brake");
  brake.position.set(0, 0.05, 5.55);

  // Muzzle marker consumed by Vehicle.muzzleWorld() / future tank cannon.
  const muzzle = new THREE.Object3D();
  muzzle.name = "GunMount.MuzzleFlashEffect";
  muzzle.position.set(0, 0.05, 5.85);
  turret.add(muzzle);

  return root;
}

/* ------------------------------ technical ------------------------------- */

export function buildStylizedTechnical(): THREE.Group {
  const mats = createVehicleMaterials();
  const root = new THREE.Group();
  root.name = "Stylized Technical";

  // Chassis + cabin as one extruded side profile (sloped hood and raked
  // windshield are part of the shape — no stacked boxes).
  const profile: Array<[number, number]> = [
    [-2.95, 0.62], // rear bottom
    [2.95, 0.62], // front bottom
    [2.95, 1.18], // nose top
    [1.55, 1.5], // hood cowl
    [1.32, 2.28], // windshield top
    [-0.45, 2.28], // cabin roof rear
    [-0.45, 1.55], // cabin back
    [-2.95, 1.55], // bed wall top
  ];
  mesh(root, extrudedProfileGeometry(profile, 2.35), mats.chassis, "extruded-chassis");

  // Wheels: four faceted drums with dark hubs.
  for (const z of [-1.85, 1.85]) {
    for (const side of [-1, 1]) {
      const wheel = mesh(root, crossCylinderGeometry(0.56, 0.42, 10), mats.rubber, "wheel");
      wheel.position.set(side * 1.12, 0.58, z);
      const hub = mesh(root, crossCylinderGeometry(0.24, 0.46, 8), mats.darkMetal, "wheel-hub");
      hub.position.set(side * 1.12, 0.58, z);
    }
  }

  // Windshield glass following the raked cabin slope.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.72), mats.glass);
  glass.name = "windshield";
  glass.position.set(0, 1.86, 1.46);
  glass.rotation.x = -0.36;
  glass.castShadow = false;
  root.add(glass);

  // Bed rails: tapered slabs, angled outward slightly.
  for (const side of [-1, 1]) {
    const rail = mesh(root, taperedSlabGeometry({ width: 0.12, height: 0.55, depth: 2.4, taper: 0.2 }), mats.camo, "bed-rail");
    rail.position.set(side * 1.18, 1.55, -1.75);
  }
  const tailgate = mesh(root, taperedSlabGeometry({ width: 2.2, height: 0.5, depth: 0.12, taper: 0.2 }), mats.camo, "tailgate");
  tailgate.position.set(0, 1.5, -2.9);

  // Mounted gun: yaw pedestal + pitch cradle, named for the Vehicle wrapper.
  const yaw = new THREE.Group();
  yaw.name = "GunMount.TurretYawGroup";
  yaw.position.set(0, 1.62, -1.7);
  root.add(yaw);
  const pedestal = mesh(yaw, new THREE.CylinderGeometry(0.34, 0.42, 0.5, 10), mats.darkMetal, "gun-pedestal");
  pedestal.position.y = 0.25;

  const pitch = new THREE.Group();
  pitch.name = "GunMount.GunPitchGroup";
  pitch.position.y = 0.55;
  yaw.add(pitch);
  const receiver = mesh(pitch, barrelGeometry(0.2, 0.24, 0.9, 8), mats.darkMetal, "gun-receiver");
  receiver.position.z = 0.2;
  const gunBarrel = mesh(pitch, barrelGeometry(0.07, 0.1, 1.7, 8), mats.darkMetal, "gun-barrel");
  gunBarrel.position.z = 1.35;
  // Ring sight and shoulder stock.
  const sight = mesh(pitch, new THREE.TorusGeometry(0.16, 0.03, 6, 12), mats.darkMetal, "ring-sight");
  sight.position.set(0, 0.28, 0.25);
  const stock = mesh(pitch, barrelGeometry(0.1, 0.14, 0.6, 6), mats.camo, "stock");
  stock.position.z = -0.55;

  const muzzle = new THREE.Object3D();
  muzzle.name = "GunMount.MuzzleFlashEffect";
  muzzle.position.set(0, 0, 2.25);
  pitch.add(muzzle);

  return root;
}

/* ---------------------------------- jet --------------------------------- */

export function buildStylizedJet(): THREE.Group {
  const mats = createVehicleMaterials();
  const root = new THREE.Group();
  root.name = "Stylized Jet";

  // Fuselage: faceted 12-segment tube, pointed cone nose, tapered tail.
  const fuselage = mesh(root, barrelGeometry(0.5, 0.74, 5.4, 12), mats.chassis, "fuselage");
  fuselage.scale.set(1, 1, 1);
  const noseGeo = new THREE.ConeGeometry(0.5, 2.0, 12);
  noseGeo.rotateX(Math.PI / 2); // cone tip -> +Z forward
  const nose = mesh(root, noseGeo, mats.chassis, "cone-nose");
  nose.position.z = 3.7;
  const tailGeo = new THREE.ConeGeometry(0.74, 1.5, 12);
  tailGeo.rotateX(-Math.PI / 2); // cone tip -> -Z aft
  const tail = mesh(root, tailGeo, mats.chassis, "tail-cone");
  tail.position.z = -3.45;

  // Bubble canopy: curved primitive, not a box.
  const canopy = mesh(root, new THREE.SphereGeometry(0.5, 10, 7), mats.glass, "canopy");
  canopy.scale.set(0.82, 0.62, 1.5);
  canopy.position.set(0, 0.55, 1.5);

  // Main wings: thin, swept-back tapered slabs (vertex-manipulated boxes).
  for (const side of [-1, 1]) {
    const wing = mesh(
      root,
      taperedSlabGeometry({ width: 3.3, height: 0.14, depth: 1.9, taper: 0.65, sweep: 1.0 }),
      mats.camo,
      "swept-wing"
    );
    wing.position.set(side * 1.65, -0.05, -0.55);
    // Gentle dihedral.
    wing.rotation.z = side * 0.07;
  }

  // Twin vertical stabilizers and horizontal tail planes.
  for (const side of [-1, 1]) {
    const fin = mesh(
      root,
      taperedSlabGeometry({ width: 0.12, height: 1.25, depth: 1.5, taper: 0.55, sweep: 0.45 }),
      mats.chassis,
      "tail-fin"
    );
    fin.position.set(side * 0.55, 0.72, -3.0);
    fin.rotation.z = side * 0.18;

    const stab = mesh(
      root,
      taperedSlabGeometry({ width: 1.5, height: 0.1, depth: 0.95, taper: 0.6, sweep: 0.4 }),
      mats.camo,
      "tail-plane"
    );
    stab.position.set(side * 0.78, 0.12, -3.5);
  }

  // Engine exhaust ring at the tail tip.
  const exhaust = mesh(root, new THREE.TorusGeometry(0.42, 0.09, 8, 14), mats.darkMetal, "exhaust-ring");
  exhaust.position.z = -4.15;

  // Simple tricycle landing gear so the airframe rests at a believable height.
  const strutGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.85, 6);
  for (const [x, z] of [[-1.1, -0.9], [1.1, -0.9], [0, 2.6]] as Array<[number, number]>) {
    const strut = mesh(root, strutGeo, mats.darkMetal, "gear-strut");
    strut.position.set(x, -0.42, z);
    const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheel = mesh(root, wheelGeo, mats.rubber, "gear-wheel");
    wheel.position.set(x, -0.88, z);
  }

  return root;
}
