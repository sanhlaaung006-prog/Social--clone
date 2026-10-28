/*
 * Per-instance culling for InstancedMesh.
 *
 * Three.js only frustum-culls an InstancedMesh as one blob, and these
 * prop meshes span the whole map — so without this they never cull.
 * Every frame we test each instance's world-space bounding sphere
 * against the camera frustum and a tier distance, compact the surviving
 * matrices to the front of the instance buffer and shrink mesh.count.
 * Fog hides the distance cutoff, so the pop is invisible in practice.
 *
 * Compaction is order-preserving and self-healing: visible instance i is
 * always copied to slot write <= i, memmove-safe, so every physical slot
 * keeps its original matrix between frames. Moving prop sets (clouds)
 * simply rewrite all slots before update() runs.
 */

import * as THREE from "three";

export class InstanceCuller {
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly activeCount: number;

  constructor(
    private readonly mesh: THREE.InstancedMesh,
    private readonly centers: Float32Array,
    private readonly radii: Float32Array,
    private readonly maxDist: number
  ) {
    this.activeCount = mesh.count;
    // We do the culling ourselves; a whole-mesh frustum test would always
    // pass because the bounding sphere covers the entire world.
    mesh.frustumCulled = false;
  }

  update(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);

    const maxDist2 = this.maxDist * this.maxDist;
    const cam = camera.position;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    let write = 0;

    for (let i = 0; i < this.activeCount; i++) {
      const cx = this.centers[i * 3];
      const cy = this.centers[i * 3 + 1];
      const cz = this.centers[i * 3 + 2];
      const dx = cx - cam.x;
      const dy = cy - cam.y;
      const dz = cz - cam.z;
      if (dx * dx + dy * dy + dz * dz > maxDist2) continue;

      this.sphere.center.set(cx, cy, cz);
      this.sphere.radius = this.radii[i];
      if (!this.frustum.intersectsSphere(this.sphere)) continue;

      arr.copyWithin(write * 16, i * 16, i * 16 + 16);
      write++;
    }

    this.mesh.count = write;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
