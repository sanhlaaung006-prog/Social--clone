/*
 * STYLIZED LOW-POLY GEOMETRY KIT
 * ------------------------------------------------------------------
 * Shared, dependency-light (three.js only) geometry builders for the
 * anti-voxel art direction: curved lofts, jittered polyhedra, gabled
 * prisms and hand-wound slabs instead of raw box stacks.
 *
 * The loft/mirror/strut/wheel helpers are adapted from the Warthog
 * Airframe Factory extraction (reference/warthog-factory, MIT-compatible
 * technique port, re-authored for this codebase) per the art-direction
 * directive to embrace that project's parametric low-poly style.
 */

import * as THREE from "three";

export interface LoftSection {
  /** Position along the loft axis (metres). Order freely; sorted on use. */
  z: number;
  /** Half-width on X. */
  w: number;
  /** Half-height on Y. */
  h: number;
  /** Centre offset on Y. */
  y?: number;
  /** Superellipse exponent: 2 = ellipse, lower = squarer. */
  e?: number;
}

/**
 * Superellipse sweep: one function produces fuselages, hull noses,
 * barrels, rocks softened into blobs — any tube whose section changes.
 */
export function loft(sections: LoftSection[], segments = 24): THREE.BufferGeometry {
  const ordered = [...sections].sort((a, b) => b.z - a.z);
  const TAU = Math.PI * 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  ordered.forEach((section, row) => {
    const exponent = section.e ?? 2.2;
    const power = 2 / exponent;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * TAU;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = Math.sign(c) * Math.pow(Math.abs(c), power) * section.w;
      const y = (section.y ?? 0) + Math.sign(s) * Math.pow(Math.abs(s), power) * section.h;
      positions.push(x, y, section.z);
      uvs.push(i / segments, row / Math.max(1, ordered.length - 1));
    }
  });

  for (let row = 0; row < ordered.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = row * segments + i;
      const b = row * segments + next;
      const c = (row + 1) * segments + i;
      const d = (row + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  // End caps.
  const last = (ordered.length - 1) * segments;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(0, i, next);
    indices.push(last, last + next, last + i);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Mirror across X and repair triangle winding so faces stay outward. */
export function mirrorGeometryX(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = source.clone();
  geo.scale(-1, 1, 1);
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i];
      idx[i] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    geo.index.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

/** Cylinder strut between two arbitrary points (rails, aerials, limbs). */
export function strutBetween(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  segments = 8
): THREE.CylinderGeometry {
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(radius, radius * 0.94, len, segments, 1);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  geo.translate(mid.x, mid.y, mid.z);
  const dir = to.clone().sub(from).normalize();
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  return geo;
}

/**
 * Gabled house prism: rectangular walls plus a triangular roof ridge in
 * a single 10-vertex, 16-triangle BufferGeometry — the anti-box hut.
 * Width X, height Y (to ridge), depth Z.
 */
export function gabledHouseGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const hw = width / 2;
  const hd = depth / 2;
  // 4 wall corners (0..3) then 2 ridge endpoints (4..5).
  const p: number[] = [
    -hw, 0, -hd, // 0
    hw, 0, -hd, // 1
    hw, 0, hd, // 2
    -hw, 0, hd, // 3
    0, height, -hd, // 4 ridge rear
    0, height, hd, // 5 ridge front
  ];
  const idx = [
    // walls
    0, 1, 4, // rear gable
    3, 5, 2, // front gable
    0, 4, 5, 0, 5, 3, // left wall + roof slope
    1, 2, 5, 1, 5, 4, // right wall + roof slope
    0, 3, 2, 0, 2, 1, // floor
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Jittered polyhedron: an icosahedron (or other polyhedron) whose
 * vertices are nudged deterministically — stylized foliage clusters and
 * boulders with organic silhouettes, never perfect cloned spheres.
 */
export function jitteredBlobGeometry(
  radius: number,
  detail: number,
  jitter: number,
  seed: number
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Deterministic per-vertex hash in [1-jitter, 1+jitter].
    const h = hash3(v.x * 13.1 + seed, v.y * 7.7 - seed, v.z * 5.3);
    const k = 1 + (h * 2 - 1) * jitter;
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Stable 0..1 hash from three numbers (no allocations, deterministic). */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Merge several non-indexed geometries sharing the same attributes into
 * one BufferGeometry (for instanced multi-part props like tree crowns).
 */
export function mergeNonIndexed(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const input of geometries) {
    // PolyhedronGeometry is non-indexed; cylinders/cones are indexed —
    // expand indices so every triangle owns three explicit vertices.
    const geo = input.index ? input.toNonIndexed() : input;
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const n = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  return out;
}

/** Build a count-long palette of subtly varied colors from a base hex. */
export function varyPalette(baseHex: number, count: number, spread = 0.08): THREE.Color[] {
  const base = new THREE.Color(baseHex);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const out: THREE.Color[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push(
      new THREE.Color().setHSL(
        hsl.h + (hash3(i, 11, 3) - 0.5) * 0.02,
        THREE.MathUtils.clamp(hsl.s + (hash3(i, 23, 7) - 0.5) * spread, 0, 1),
        THREE.MathUtils.clamp(hsl.l + (t - 0.5) * spread * 2, 0.05, 0.95)
      )
    );
  }
  return out;
}

/** Recursively dispose geometries, materials and their textures. */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute("position").count) / 3;
}
