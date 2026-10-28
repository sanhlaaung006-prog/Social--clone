/*
 * ═══════════════════════════════════════════════════════════════════
 * FROZEN MODULE — DO NOT EDIT.
 * Ported verbatim (logic unchanged; only ES imports + type annotations
 * added) from the user-supplied standalone "Myanmar, in Relief — One
 * Continuous Terrain" (index.html, received 2026-10-28). Enforced by
 * tests/terrain-lock.test.ts checksums. See locked/LOCKED.md.
 *
 * Structure builders — plain Object3Ds the engine can place through
 * ReliefTerrain.placeStructure(). Not instantiated by the current app;
 * reserved for the upcoming structures brick.
 * ═══════════════════════════════════════════════════════════════════
 */

import * as THREE from "three";
import { clamp, hash2 } from "./noise";

export const PAGODA_STONE = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.8, metalness: 0, flatShading: true });
export const PAGODA_GOLD = new THREE.MeshStandardMaterial({ color: 0xc9a24b, roughness: 0.45, metalness: 0.35, flatShading: true });
export const sharedTreeGeometry = new THREE.ConeGeometry(1, 1, 5, 1);
export const sharedRockGeometry = new THREE.ConeGeometry(1, 1, 6, 1);

export function buildPagoda(scale = 1): THREE.Group {
  const group = new THREE.Group();
  const tiers = [
    { r: 1.0, h: 0.55, mat: PAGODA_STONE },
    { r: 0.78, h: 0.45, mat: PAGODA_STONE },
    { r: 0.55, h: 0.95, mat: PAGODA_STONE },
    { r: 0.30, h: 0.50, mat: PAGODA_GOLD },
    { r: 0.14, h: 1.10, mat: PAGODA_GOLD }
  ];
  let y = 0;
  for (const tier of tiers) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 8, 1), tier.mat);
    y += tier.h / 2;
    mesh.position.y = y;
    y += tier.h / 2;
    group.add(mesh);
  }
  const hti = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.22, 8, 1), PAGODA_GOLD);
  hti.position.y = y + 0.14;
  group.add(hti);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 5, 1), PAGODA_GOLD);
  tip.position.y = y + 0.42;
  group.add(tip);
  group.scale.setScalar(scale);
  group.name = "Pagoda (structure)";
  return group;
}

export function buildVolcanoPlug(radius = 3.4, height = 5.8): THREE.Group {
  const geometry = new THREE.ConeGeometry(radius, height, 11, 7, false);
  const sourcePositions = geometry.attributes.position;
  for (let i = 0; i < sourcePositions.count; i++) {
    const x = sourcePositions.getX(i);
    const z = sourcePositions.getZ(i);
    const y = sourcePositions.getY(i);
    const t = clamp((y + height / 2) / height, 0, 1);
    const angle = Math.atan2(z, x);
    const irregular = 1 + 0.12 * Math.sin(angle * 3 + t * 8.5) + 0.07 * Math.sin(angle * 7 - t * 3.1);
    sourcePositions.setX(i, x * irregular);
    sourcePositions.setZ(i, z * irregular);
    sourcePositions.setY(i, y + (t > 0.02 && t < 0.98 ? 0.09 * Math.sin(angle * 5 + i) : 0));
  }
  const finalGeometry = geometry.toNonIndexed();
  geometry.dispose();
  const positions = finalGeometry.attributes.position as THREE.BufferAttribute;
  const colorData = new Float32Array(positions.count * 3);
  const low = new THREE.Color("#4e4a3b");
  const mid = new THREE.Color("#665745");
  const high = new THREE.Color("#81745f");
  const scratch = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const t = clamp((positions.getY(i) + height / 2) / height, 0, 1);
    if (t < 0.56) scratch.copy(low).lerp(mid, t / 0.56);
    else scratch.copy(mid).lerp(high, (t - 0.56) / 0.44);
    const angle = Math.atan2(positions.getZ(i), positions.getX(i));
    scratch.multiplyScalar(0.91 + 0.12 * hash2(angle * 7, t * 13, 5));
    colorData[i * 3] = scratch.r;
    colorData[i * 3 + 1] = scratch.g;
    colorData[i * 3 + 2] = scratch.b;
  }
  finalGeometry.setAttribute("color", new THREE.BufferAttribute(colorData, 3));
  finalGeometry.computeVertexNormals();
  finalGeometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(finalGeometry, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0
  }));
  const group = new THREE.Group();
  mesh.position.y = height / 2;
  group.add(mesh);
  group.name = "Mount Popa volcanic plug (structure)";
  group.userData.height = height;
  return group;
}
