/*
 * Shared headless ground builder for CPU-raster screenshots (test
 * tooling only). Rebuilds the merged 5 km field as a faceted mesh with
 * the same height scale and a test-only color ramp; the authoritative
 * art runs in the locked ReliefTerrain engine in-browser.
 */

import * as THREE from "three";
import { clamp, smoothstep } from "../../src/terrain/locked/noise";
import {
  HEIGHT_SCALE,
  MAP_HALF,
  MAP_SIZE,
  mergedField
} from "../../src/terrain/myanmarMap";

export function buildGround(segments = 260): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const h =
      mergedField(positions.getX(i) / MAP_HALF, positions.getZ(i) / MAP_HALF) * HEIGHT_SCALE;
    positions.setY(i, h);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  const pos = flat.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const stops = [
    { t: 0.0, c: new THREE.Color("#17402c") },
    { t: 0.22, c: new THREE.Color("#55704a") },
    { t: 0.52, c: new THREE.Color("#8a7c5c") },
    { t: 0.8, c: new THREE.Color("#a29c8f") },
    { t: 1.0, c: new THREE.Color("#f2f1e8") }
  ];
  const seaDeep = new THREE.Color("#0c2827");
  const seaShelf = new THREE.Color("#155049");
  const color = new THREE.Color();
  const peakH = Math.max(1e-4, maxH);

  for (let i = 0; i < pos.count; i += 3) {
    const avg = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (avg < 0) {
      color.copy(seaDeep).lerp(seaShelf, clamp((avg + 45) / 45, 0, 1));
    } else {
      const t = clamp(avg / peakH, 0, 1);
      for (let s = 1; s < stops.length; s++) {
        if (t <= stops[s].t) {
          const a = stops[s - 1];
          const b = stops[s];
          color.copy(a.c).lerp(b.c, smoothstep(a.t, b.t, t));
          break;
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = color.r;
      colors[(i + k) * 3 + 1] = color.g;
      colors[(i + k) * 3 + 2] = color.b;
    }
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    flat,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })
  );
  mesh.userData.range = { minH, maxH };
  return mesh;
}
