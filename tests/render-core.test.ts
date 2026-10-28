/*
 * Headless render-core tests for the rebuild foundation:
 * procedural forge, material family, anti-voxel world batching.
 * Run: npx tsx tests/render-core.test.ts
 */

import * as THREE from "three";
import { installDomStub } from "./lib/dom-stub";

installDomStub();

import { ForgeRng, forgeTextures } from "../src/render/textureForge";
import { createEnvironmentMaterials } from "../src/render/materials";
import { createWorld } from "../src/render/world";
import { FOG_COLOR, SKY_COLOR } from "../src/render/environment";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Forge RNG:");
{
  const a = new ForgeRng(42);
  const b = new ForgeRng(42);
  const seqA = Array.from({ length: 8 }, () => a.next());
  const seqB = Array.from({ length: 8 }, () => b.next());
  check("same seed yields identical sequence", seqA.every((v, i) => v === seqB[i]));
  check("values stay in [0,1)", seqA.every((v) => v >= 0 && v < 1));
  const c = new ForgeRng(43);
  check("different seeds diverge", c.next() !== seqA[0]);
}

console.log("Procedural textures:");
{
  const textures = forgeTextures();
  const entries = Object.entries(textures) as Array<[string, THREE.CanvasTexture]>;
  check("all seven surface families generated", entries.length === 7, `${entries.length}`);
  for (const [name, tex] of entries) {
    check(
      `${name} is a repeat-wrapped sRGB canvas texture`,
      tex instanceof THREE.CanvasTexture &&
        tex.wrapS === THREE.RepeatWrapping &&
        tex.wrapT === THREE.RepeatWrapping &&
        tex.colorSpace === THREE.SRGBColorSpace,
      name
    );
  }
  const t1 = forgeTextures(7);
  const t2 = forgeTextures(7);
  check("forge is deterministic per seed", t1.brick.image.width === t2.brick.image.width);
}

console.log("Material family:");
{
  const materials = createEnvironmentMaterials();
  const values = Object.values(materials);
  check("ten material families", values.length === 10, `${values.length}`);
  check(
    "all MeshStandardMaterial with vertex colors",
    values.every((m) => m instanceof THREE.MeshStandardMaterial && m.vertexColors === true)
  );
  check("grime stays transparent and depth-friendly", materials.grime.transparent === true);
}

console.log("Batched world:");
{
  const world = createWorld();
  check("returns a named group", world instanceof THREE.Group && world.name.length > 0);

  let boxCount = 0;
  let nonFinite = 0;
  let mergedMeshes = 0;
  const materialNames = new Set<string>();
  world.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    mergedMeshes++;
    if (obj.geometry.type === "BoxGeometry") boxCount++;
    materialNames.add((obj.material as THREE.Material).name);
    const p = obj.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) nonFinite++;
    }
  });
  check("anti-voxel gate: zero BoxGeometry", boxCount === 0, `${boxCount} boxes`);
  check("all vertex positions finite", nonFinite === 0, `${nonFinite} bad verts`);
  check("geometry is batched (fewer meshes than families*4)", mergedMeshes <= 12, `${mergedMeshes} meshes`);
  check("multiple material families present", materialNames.size >= 6, `${materialNames.size}`);

  const tris = world.userData.triangleCount as number;
  check("triangle budget for mobile (1k..60k)", tris > 1000 && tris < 60000, `${tris} tris`);

  const box = new THREE.Box3().setFromObject(world);
  const size = new THREE.Vector3();
  box.getSize(size);
  check("courtyard spans a playable area", size.x > 60 && size.z > 60, `${size.x.toFixed(1)}x${size.z.toFixed(1)}`);
  check("world sits on the ground plane", Math.abs(box.min.y) < 0.05, `minY=${box.min.y.toFixed(2)}`);

  // Determinism: identical seed → identical triangle counts and bounds.
  const again = createWorld();
  check(
    "world build is deterministic",
    again.userData.triangleCount === tris &&
      new THREE.Box3().setFromObject(again).equals(box)
  );
  // Different seed still produces a valid world (RNG-driven variation).
  const other = createWorld(999);
  check("seed variation stays valid", (other.userData.triangleCount as number) > 1000);
}

console.log("Environment palette:");
{
  check("sky and fog colors are valid hex", Number.isInteger(SKY_COLOR) && Number.isInteger(FOG_COLOR));
  check("fog is lighter than deep night", FOG_COLOR > 0x404040);
}

console.log(failures === 0 ? "\nRender core: all checks passed." : `\nRender core: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
