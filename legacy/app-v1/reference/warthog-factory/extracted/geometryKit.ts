/**
 * GEOMETRY KIT — extracted from `factory/warthog.ts`
 * ------------------------------------------------------------------
 * Dependency-free (Three.js only) procedural geometry helpers.
 * Verified against three 0.170.0 (the version this repo pins).
 *
 * Why these are worth keeping: they build vehicle/hull shapes out of
 * primitives with no external assets, which is exactly the constraint
 * the game project runs under (no downloaded meshes or textures).
 *
 * Reuse: `import { loft, mirrorGeometryX, addStrut, addWheel } from "..."`
 */

import * as THREE from "three";

const TAU = Math.PI * 2;

export interface LoftSection {
  /** Position along the loft axis (metres). Sections must be ordered descending. */
  z: number;
  /** Half-width on X. */
  w: number;
  /** Half-height on Y. */
  h: number;
  /** Centre offset on Y. */
  y?: number;
  /** Superellipse exponent: 2 = ellipse, higher = boxier. Default 2.5. */
  exponent?: number;
}

/**
 * Superellipse loft: sweeps a rounded-rectangle cross-section through a set of
 * sections and stitches them into a single indexed BufferGeometry.
 *
 * This is the single most reusable idea in the reference project — one call
 * produces a fuselage, a tank hull, a nose cone or a barrel shroud by varying
 * the section list.
 */
export function loft(sections: LoftSection[], segments = 32): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error("loft() needs at least two sections");

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  sections.forEach((section, row) => {
    const exponent = section.exponent ?? 2.5;
    const power = 2 / exponent;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = Math.sign(c) * Math.pow(Math.abs(c), power) * section.w;
      const y = (section.y ?? 0) + Math.sign(s) * Math.pow(Math.abs(s), power) * section.h;
      positions.push(x, y, section.z);
      uvs.push(i / segments, row / Math.max(1, sections.length - 1));
    }
  });

  for (let row = 0; row < sections.length - 1; row += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = row * segments + i;
      const b = row * segments + next;
      const c = (row + 1) * segments + i;
      const d = (row + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Mirror a geometry across X and repair winding order.
 * Naively calling `geometry.scale(-1, 1, 1)` inverts every face, so the index
 * (or position) triples must be swapped back — this handles both layouts.
 */
export function mirrorGeometryX(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.scale(-1, 1, 1);
  if (geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i];
      idx[i] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    geometry.index.needsUpdate = true;
  } else {
    for (const attribute of Object.values(geometry.attributes)) {
      const array = attribute.array as Float32Array;
      const size = attribute.itemSize;
      for (let tri = 0; tri < array.length; tri += size * 3) {
        for (let k = 0; k < size; k += 1) {
          const a = tri + k;
          const b = tri + size * 2 + k;
          const tmp = array[a];
          array[a] = array[b];
          array[b] = tmp;
        }
      }
      attribute.needsUpdate = true;
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function addBox(
  group: THREE.Group,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
  rotation?: [number, number, number]
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

/**
 * Cylinder spanning two arbitrary points — the workhorse for roll cages,
 * suspension arms, aerials and barrel struts.
 */
export function addStrut(
  group: THREE.Group,
  material: THREE.Material,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  radialSegments = 10
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.92, length, radialSegments),
    material
  );
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize()
  );
  group.add(mesh);
  return mesh;
}

/** Torus tyre + cylinder drum, oriented as a road wheel on the X axis. */
export function addWheel(
  group: THREE.Group,
  tyre: THREE.Material,
  hub: THREE.Material,
  position: [number, number, number],
  radius: number,
  width: number
): void {
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(radius, width, 12, 28), tyre);
  wheel.rotation.y = Math.PI / 2;
  wheel.position.set(...position);
  group.add(wheel);

  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 2.15, 18),
    hub
  );
  drum.rotation.z = Math.PI / 2;
  drum.position.set(...position);
  group.add(drum);
}

/** Triangle count for a single geometry (indexed or not). */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return geometry.index.count / 3;
  const position = geometry.attributes.position;
  return position ? position.count / 3 : 0;
}

/**
 * Deep dispose of an object tree: geometries, materials (and their texture
 * slots) and any render targets hanging off them. Prevents the GPU-memory
 * leak the reference project had to hand-roll in `assembly.dispose()`.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (!material) return;
    const list: THREE.Material[] = Array.isArray(material) ? material : [material];
    for (const item of list) {
      for (const value of Object.values(item)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      item.dispose();
    }
  });
}
