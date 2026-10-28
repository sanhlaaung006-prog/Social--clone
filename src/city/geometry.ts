/*
 * CITY GEOMETRY WORKSHOP (anti-voxel)
 * ------------------------------------------------------------------
 * Every architectural mesh is hand-authored here: explicit cuboid
 * facets, gabled roof prisms, extruded trapezoid battered walls, lathed
 * stupa bells and holed moat rings. THREE.BoxGeometry is NEVER used
 * (the project art gate tests this), keeping the low-poly faceted art
 * language consistent with the locked relief terrain.
 *
 * Techniques re-authored from the user-supplied Mandalay reconstruction
 * (battered wall extrusion, Shwezigon bell profile, pyatthat stacking).
 */

import * as THREE from "three";

type V3 = [number, number, number];

function buildGeometry(positions: number[], uvs: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Push two triangles of a quad (a,b,c,d) in outward CCW winding. */
function quad(
  positions: number[],
  uvs: number[],
  a: V3,
  b: V3,
  c: V3,
  d: V3
): void {
  const verts = [a, b, c, a, c, d];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  for (const v of verts) positions.push(...v);
  uvs.push(...uv);
}

function tri(positions: number[], uvs: number[], a: V3, b: V3, c: V3): void {
  positions.push(...a, ...b, ...c);
  uvs.push(0, 0, 1, 0, 0.5, 1);
}

/**
 * Hand-built cuboid with 24 faceted vertices (flat shading). This is the
 * deliberate replacement for THREE.BoxGeometry across all city art.
 */
export function cuboid(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const p: number[] = [];
  const uv: number[] = [];
  // +z / -z
  quad(p, uv, [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]);
  quad(p, uv, [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]);
  // +x / -x
  quad(p, uv, [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]);
  quad(p, uv, [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]);
  // +y / -y
  quad(p, uv, [-x, y, z], [-x, y, -z], [x, y, -z], [x, y, z]);
  quad(p, uv, [-x, -y, -z], [-x, -y, z], [x, -y, z], [x, -y, -z]);
  return buildGeometry(p, uv);
}

/**
 * Gabled roof prism: ridge runs along z, base sits at y=0 and the ridge
 * rises `rise` metres. Open underside (sits on the house body).
 */
export function gableRoof(w: number, rise: number, d: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const A: V3 = [-x, 0, -z];
  const B: V3 = [x, 0, -z];
  const C: V3 = [0, rise, -z];
  const A2: V3 = [-x, 0, z];
  const B2: V3 = [x, 0, z];
  const C2: V3 = [0, rise, z];
  const p: number[] = [];
  const uv: number[] = [];
  tri(p, uv, A, C, B); // front gable (-z)
  tri(p, uv, A2, B2, C2); // rear gable (+z)
  quad(p, uv, B, C, C2, B2); // right slope
  quad(p, uv, A, A2, C2, C); // left slope
  return buildGeometry(p, uv);
}

/**
 * Battered citadel wall: trapezoid cross-section (wide base, narrow
 * crown) extruded along z. Rotate PI/2 about y for east-west walls.
 * Re-authored from the donor's ExtrudeGeometry trapezoid technique.
 */
export function batteredWall(
  len: number,
  t0: number,
  t1: number,
  h: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-t0 / 2, 0);
  shape.lineTo(t0 / 2, 0);
  shape.lineTo(t1 / 2, h);
  shape.lineTo(-t1 / 2, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { steps: 1, bevelEnabled: false, depth: len });
  geo.translate(0, 0, -len / 2);
  return geo;
}

/**
 * Shwezigon-type bell stupa: normalised lathe profile (base radius 1,
 * height 1) re-authored from the donor foundry measurements; the builder
 * scales per instance. 14 radial segments keep the faceted low-poly look.
 */
export function stupaGeometry(): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.55, 0], [1, 0], [1, 0.06], [0.86, 0.09], [0.86, 0.16],
    [0.74, 0.19], [0.62, 0.24], [0.6, 0.32], [0.5, 0.36], [0.44, 0.42],
    [0.4, 0.5], [0.365, 0.55], [0.33, 0.6], [0.28, 0.63], [0.24, 0.66],
    [0.2, 0.72], [0.16, 0.76], [0.12, 0.8], [0.075, 0.85], [0.05, 0.88],
    [0.03, 0.92], [0.018, 0.96], [0.01, 1]
  ];
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    14
  );
}

/** Square moat ring: outer square with an inner hole, flat at y=0. */
export function moatRing(outer: number, inner: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Four-sided pyramid spire (pyatthat finial alternative to cones). */
export function pyramidSpire(radius: number, h: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(radius, h, 4, 1);
}
