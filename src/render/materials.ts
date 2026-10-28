/*
 * Material library over the procedural forge. All surfaces are
 * MeshStandardMaterial with vertex-color tinting enabled, matching the
 * sandline batching technique: one material per surface family, many
 * merged meshes, cheap draw calls on mobile. Technique re-authored from
 * SANDLINE (MIT) — see NOTICE.md.
 */

import * as THREE from "three";
import { forgeTextures, type ForgeTextures } from "./textureForge";

export interface EnvironmentMaterials {
  ground: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  grime: THREE.MeshStandardMaterial;
  signs: THREE.MeshStandardMaterial;
}

export type MaterialKey = keyof EnvironmentMaterials;

export function createEnvironmentMaterials(textures: ForgeTextures = forgeTextures()): EnvironmentMaterials {
  const std = (parameters: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial({ vertexColors: true, ...parameters });

  const grime = new THREE.MeshStandardMaterial({
    map: textures.grime,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  grime.name = "grime";

  const named = (name: string, parameters: THREE.MeshStandardMaterialParameters) => {
    const material = std(parameters);
    material.name = name;
    return material;
  };

  return {
    ground: named("ground", { map: textures.ground, color: "#e3cda3", roughness: 0.96, metalness: 0.02 }),
    brick: named("brick", {
      map: textures.brick,
      bumpMap: textures.brick,
      bumpScale: 0.016,
      color: "#e3d2b2",
      roughness: 1,
    }),
    plaster: named("plaster", { map: textures.plaster, color: "#f0e4cb", roughness: 0.94 }),
    metal: named("metal", { map: textures.metal, color: "#c5c5ad", roughness: 0.72, metalness: 0.28 }),
    cloth: named("cloth", { map: textures.cloth, color: "#d3c8a4", roughness: 1, side: THREE.DoubleSide }),
    stone: named("stone", { map: textures.ground, color: "#c9b48f", roughness: 0.92 }),
    dark: named("dark", { color: "#23261f", roughness: 0.98 }),
    trim: named("trim", { color: "#e5d5b7", roughness: 0.82 }),
    grime,
    signs: named("signs", { map: textures.signs, roughness: 0.9, metalness: 0.1 }),
  };
}
