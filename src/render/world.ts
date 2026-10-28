/*
 * Procedural depot courtyard — the visual-rebuild foundation scene.
 *
 * Ported techniques from SANDLINE (MIT, src/render/world.ts): geometry
 * is accumulated per material family, transformed into world space,
 * shaded with per-vertex tints (height darkening, underside contact
 * shade) and world-scale UV tiling, then merged into one mesh per
 * material. Our anti-voxel rule is kept: zero BoxGeometry — walls are
 * curved cylinder rings, masonry is extruded arch/shape profiles,
 * details are cylinders and bent planes. See NOTICE.md.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ForgeRng } from "./textureForge";
import { createEnvironmentMaterials, type MaterialKey } from "./materials";

/** World-space UV tiling density per surface family (sandline technique). */
const TILE_DENSITY: Partial<Record<MaterialKey, number>> = {
  ground: 0.28,
  brick: 0.72,
  plaster: 0.34,
  metal: 0.7,
  stone: 0.6,
  cloth: 2.2,
};

const UP = new THREE.Vector3(0, 1, 0);

export function createWorld(seed = 20261028): THREE.Group {
  const root = new THREE.Group();
  root.name = "Golden Land / depot courtyard v0.4";
  const materials = createEnvironmentMaterials();
  const rng = new ForgeRng(seed);
  const buckets = new Map<MaterialKey, THREE.BufferGeometry[]>();
  let frame = new THREE.Matrix4();
  const work = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const euler = new THREE.Euler();
  const tint = new THREE.Color();

  const add = (
    key: MaterialKey,
    geometry: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    color: THREE.ColorRepresentation = "#ffffff",
    rx = 0,
    ry = 0,
    rz = 0
  ): void => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    quat.setFromEuler(euler.set(rx, ry, rz));
    work.compose(pos.set(x, y, z), quat, scl).premultiply(frame);
    g.applyMatrix4(work);

    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const colors = new Float32Array(p.count * 3);
    tint.set(color);
    const density = TILE_DENSITY[key];
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i);
      const py = p.getY(i);
      const pz = p.getZ(i);
      const heightShade =
        key === "plaster" || key === "brick" || key === "stone"
          ? 0.78 + 0.22 * Math.min(1, Math.max(0, py) / 1.4)
          : 1;
      const contact = n.getY(i) < -0.5 ? 0.72 : 1;
      const shade = heightShade * contact;
      colors[i * 3] = tint.r * shade;
      colors[i * 3 + 1] = tint.g * shade;
      colors[i * 3 + 2] = tint.b * shade;
      if (density && uv) {
        const nx = Math.abs(n.getX(i));
        const ny = Math.abs(n.getY(i));
        uv.setXY(
          i,
          (nx > 0.5 ? pz : px) * density,
          (ny > 0.5 ? pz : py) * density
        );
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const list = buckets.get(key);
    if (list) list.push(g);
    else buckets.set(key, [g]);
  };

  /** Run a builder inside a rotated/translated frame (sandline `within`). */
  const within = (x: number, y: number, z: number, yaw: number, fn: () => void): void => {
    const previous = frame.clone();
    const next = new THREE.Matrix4().makeRotationY(yaw);
    next.setPosition(x, y, z);
    next.premultiply(frame);
    frame = next;
    fn();
    frame = previous;
  };

  const archShape = (radius: number, spring: number): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-radius, 0);
    s.lineTo(radius, 0);
    s.lineTo(radius, spring);
    s.absarc(0, spring, radius, 0, Math.PI, false);
    s.closePath();
    return s;
  };

  /* ------------------------------- ground -------------------------------- */
  const ground = new THREE.CircleGeometry(62, 48);
  ground.rotateX(-Math.PI / 2);
  add("ground", ground, 0, 0, 0, "#d9c49c");

  /* ------------------------- curved perimeter wall ----------------------- */
  // Open cylinder arcs give a continuous curved compound wall — no boxes.
  const wallRadius = 44;
  const segments = 10;
  const arc = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    if (i === 2) continue; // gate opening
    const wall = new THREE.CylinderGeometry(wallRadius, wallRadius, 3.2, 10, 1, true, -arc / 2, arc * 0.94);
    add("plaster", wall, 0, 1.6, 0, i % 2 ? "#e7d9bd" : "#dccba9");
    const coping = new THREE.CylinderGeometry(wallRadius + 0.18, wallRadius + 0.18, 0.34, 10, 1, true, -arc / 2, arc * 0.94);
    add("stone", coping, 0, 3.35, 0, "#cdb892");
  }

  /* ------------------------------ gatehouse ------------------------------ */
  within(0, 0, -wallRadius + 1.2, 0, () => {
    for (const side of [-1, 1]) {
      const pier = new THREE.CylinderGeometry(0.85, 1.0, 4.4, 12);
      add("brick", pier, side * 2.3, 2.2, 0, rng.next() < 0.5 ? "#d8b894" : "#cdae88");
      const cap = new THREE.CylinderGeometry(1.0, 0.85, 0.4, 12);
      add("stone", cap, side * 2.3, 4.6, 0, "#d8c39b");
    }
    const arch = new THREE.ExtrudeGeometry(archShape(2.05, 1.7), {
      depth: 1.1,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 1,
    });
    arch.translate(0, 0, -0.55);
    // Bevel expands the profile by bevelSize below the shape's base.
    add("stone", arch, 0, 0.06, 0, "#c9b48c");
    const darkArch = new THREE.ShapeGeometry(archShape(1.75, 1.55), 18);
    add("dark", darkArch, 0, 0.05, 0.62, "#2a2b24");
  });

  /* ------------------------- perimeter buildings ------------------------- */
  const buildingSpots: Array<[number, number, number]> = [];
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.35;
    const r = 30 + rng.range(-2.5, 2.5);
    buildingSpots.push([Math.cos(angle) * r, Math.sin(angle) * r, -angle + Math.PI / 2]);
  }
  for (const [bx, bz, yaw] of buildingSpots) {
    const w = rng.range(5.5, 8);
    const d = rng.range(4.5, 6.5);
    const h = rng.range(3.2, 5.4);
    within(bx, 0, bz, yaw, () => {
      // Extruded rectangular mass with beveled edges — masonry, never a box.
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, h);
      shape.lineTo(-w / 2, h);
      shape.closePath();
      const body = new THREE.ExtrudeGeometry(shape, {
        depth: d,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.1,
        bevelSegments: 1,
      });
      body.translate(0, 0, -d / 2);
      // Bevel expands the profile by bevelSize below the shape's base.
      add(rng.next() < 0.5 ? "plaster" : "brick", body, 0, 0.1, 0, rng.next() < 0.5 ? "#e2d2b2" : "#d3b490");

      // Arched doorway and dark recess on the +Z face.
      const door = new THREE.ShapeGeometry(archShape(0.85, 1.05), 16);
      add("dark", door, 0, 0.04, d / 2 + 0.12, "#26281f");
      // Cornice and rounded roof edge.
      const cornice = new THREE.CylinderGeometry(0.16, 0.16, w + 0.3, 10);
      cornice.rotateZ(Math.PI / 2);
      add("trim", cornice, 0, h + 0.12, d / 2, "#e0cfab");
      // Corrugated steel awning: bent cloth-like plane, sagged at the lip.
      const awning = new THREE.PlaneGeometry(w * 0.7, 1.5, 8, 3);
      const ap = awning.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < ap.count; i++) {
        const lx = ap.getX(i);
        const ly = ap.getY(i);
        ap.setZ(i, -0.12 * Math.cos((lx / (w * 0.7)) * Math.PI) - 0.1 * (ly + 0.75));
      }
      awning.computeVertexNormals();
      add("cloth", awning, 0, 2.35, d / 2 + 0.8, "#d8cba6", 0.42, 0, 0);
    });
  }

  /* --------------------------- water tower ------------------------------- */
  within(-14, 0, 12, 0, () => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leg = new THREE.CylinderGeometry(0.12, 0.16, 6.4, 7);
      add("metal", leg, Math.cos(a) * 1.7, 3.2, Math.sin(a) * 1.7, "#9aa49e");
    }
    const tank = new THREE.CylinderGeometry(2.0, 2.0, 2.6, 16);
    add("metal", tank, 0, 7.4, 0, "#a8b2ab");
    const roof = new THREE.ConeGeometry(2.25, 1.1, 16);
    add("metal", roof, 0, 9.25, 0, "#8f9a93");
    const ring = new THREE.TorusGeometry(2.02, 0.09, 8, 20);
    ring.rotateX(Math.PI / 2);
    add("trim", ring, 0, 6.15, 0, "#d8c39b");
  });

  /* ------------------------ pipes, pillars, props ------------------------ */
  for (let i = 0; i < 8; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(8, 24);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const pillar = new THREE.CylinderGeometry(0.32, 0.4, rng.range(1.6, 2.6), 10);
    add("stone", pillar, x, pillar.parameters.height / 2, z, "#c6b189");
  }
  const pipe = new THREE.CylinderGeometry(0.11, 0.11, 9, 8);
  pipe.rotateZ(Math.PI / 2);
  add("metal", pipe, 9, 3.6, -6, "#7f8a84");
  const pipeBent = new THREE.CylinderGeometry(0.11, 0.11, 3.2, 8);
  add("metal", pipeBent, 13.4, 2.1, -6, "#7f8a84");

  /* --------------------- signage and grime decals ------------------------ */
  const signPlane = (tile: number, x: number, y: number, z: number, w: number, h: number, yaw: number): void => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (tile % 4 + 0.005 + uv.getX(i) * 0.99) / 4, 1 - (Math.floor(tile / 4) + 0.005 + (1 - uv.getY(i)) * 0.99) / 2);
    }
    within(x, y, z, yaw, () => add("signs", g, 0, 0, 0.02));
  };
  signPlane(0, 2.3, 2.6, -wallRadius + 1.9, 2.4, 1.2, 0);
  signPlane(1, -2.3, 2.9, -wallRadius + 1.9, 1.8, 0.9, 0);
  signPlane(4, 18, 2.4, 8, 1.8, 0.9, -0.8);

  // Grime decals laid flat on the ground (atlas tile 3 = road wear).
  for (let i = 0; i < 6; i++) {
    const g = new THREE.PlaneGeometry(rng.range(2, 4.5), rng.range(1.4, 3));
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let j = 0; j < uv.count; j++) {
      uv.setXY(j, (3 + 0.005 + uv.getX(j) * 0.99) / 4, 1 - (0.005 + (1 - uv.getY(j)) * 0.99) / 2);
    }
    within(rng.range(-20, 20), 0.03, rng.range(-20, 20), rng.range(0, Math.PI * 2), () => {
      add("grime", g, 0, 0, 0, "#ffffff", -Math.PI / 2);
    });
  }

  /* ------------------------------ merge ---------------------------------- */
  let triangleCount = 0;
  for (const [key, list] of buckets) {
    if (list.length === 0) continue;
    const merged = mergeGeometries(list, false);
    if (!merged) throw new Error(`geometry merge failed for ${key}`);
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.name = `batched-${key}`;
    mesh.castShadow = key !== "grime";
    mesh.receiveShadow = true;
    root.add(mesh);
    triangleCount += merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
    list.forEach((g) => g.dispose());
  }
  root.userData.triangleCount = Math.round(triangleCount);
  root.userData.materialCount = Object.keys(materials).length;
  return root;
}

export { UP as WORLD_UP };
