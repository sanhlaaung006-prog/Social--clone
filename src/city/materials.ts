/*
 * ROYAL CITY MATERIAL FAMILY
 * ------------------------------------------------------------------
 * One flat-shaded MeshStandardMaterial per surface family; merged
 * geometry carries per-vertex tints (same batching technique as
 * src/render/world.ts), so hundreds of houses render in a handful of
 * draw calls on mobile. No external textures — fully offline, matching
 * the donor's palette of laterite, teak, tin, terracotta and gold leaf.
 */

import * as THREE from "three";

export interface CityMaterials {
  soil: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  teak: THREE.MeshStandardMaterial;
  tin: THREE.MeshStandardMaterial;
  tile: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
}

export type CityMaterialKey = keyof CityMaterials;

export function createCityMaterials(): CityMaterials {
  const std = (
    name: string,
    color: number,
    extra: Partial<THREE.MeshStandardMaterialParameters> = {}
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      name,
      color,
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
      metalness: 0,
      ...extra
    });
    return m;
  };

  return {
    soil: std("city laterite earth", 0x9c8a63),
    brick: std("city laterite brick", 0xa85a3c, { roughness: 0.82 }),
    plaster: std("city washed plaster", 0xd8cfba),
    teak: std("city teak timber", 0x6e4f2c, { roughness: 0.78 }),
    tin: std("city corrugated iron", 0x8f9598, { roughness: 0.55, metalness: 0.35 }),
    tile: std("city terracotta tile", 0x9e5536, { roughness: 0.85 }),
    gold: std("city gold leaf", 0xd4a93f, {
      roughness: 0.34,
      metalness: 0.62,
      emissive: 0x2a1c05,
      emissiveIntensity: 0.55
    }),
    marble: std("city marble stucco", 0xede7d8, { roughness: 0.6 }),
    concrete: std("city weathered concrete", 0xb3ada1),
    iron: std("city dark ironwork", 0x3d4145, { roughness: 0.6, metalness: 0.3 }),
    leaf: std("city foliage", 0x3f6d35),
    cloth: std("city market cloth", 0xd9d4c8),
    asphalt: std("city packed road", 0x7d7668, { roughness: 0.96 }),
    water: std("city moat water", 0x2f6f7e, {
      transparent: true,
      opacity: 0.78,
      roughness: 0.18,
      metalness: 0.25,
      vertexColors: false
    })
  };
}
