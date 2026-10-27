/*
 * Shared headless CPU rasterizer: walks a real THREE.Scene and paints its
 * triangles to a PNG without a browser/GPU. Used by screenshot.ts (game world)
 * and inspect-tank.ts (vendor model inspection).
 */

import * as THREE from "three";
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { CONFIG } from "../../game/config";

const W = 640;
const H = 360;
const FOCAL = H / 2 / Math.tan(((62 * Math.PI) / 180) / 2);
const FOG = new THREE.Color(CONFIG.world.fogColor);
const SUN_DIR = new THREE.Vector3(60, 90, 35).normalize();
const UP = new THREE.Vector3(0, 1, 0);

interface Tri {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  color: THREE.Color;
  unlit: boolean;
}

const isVisible = (obj: THREE.Object3D): boolean => {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
};

export function gatherTriangles(scene: THREE.Object3D): Tri[] {
  const tris: Tri[] = [];
  scene.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !isVisible(obj)) return;
    const material = obj.material as THREE.Material & { transparent?: boolean; fog?: boolean };
    if (material.transparent || material.fog === false) return;
    const geo = obj.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geo.getAttribute("color") as THREE.BufferAttribute | null;
    const baseColor = (material as THREE.MeshLambertMaterial).color ?? null;
    const unlit = (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;

    const instances = obj instanceof THREE.InstancedMesh ? obj.count : 1;
    for (let inst = 0; inst < instances; inst++) {
      if (obj instanceof THREE.InstancedMesh) {
        obj.getMatrixAt(inst, m);
        m.premultiply(obj.matrixWorld);
      } else {
        m.copy(obj.matrixWorld);
      }

      const index = geo.getIndex();
      const count = index ? index.count : pos.count;
      for (let t = 0; t < count; t += 3) {
        const i0 = index ? index.getX(t) : t;
        const i1 = index ? index.getX(t + 1) : t + 1;
        const i2 = index ? index.getX(t + 2) : t + 2;
        va.fromBufferAttribute(pos, i0).applyMatrix4(m);
        vb.fromBufferAttribute(pos, i1).applyMatrix4(m);
        vc.fromBufferAttribute(pos, i2).applyMatrix4(m);

        let color: THREE.Color;
        if (colAttr) {
          color = new THREE.Color(
            (colAttr.getX(i0) + colAttr.getX(i1) + colAttr.getX(i2)) / 3,
            (colAttr.getY(i0) + colAttr.getY(i1) + colAttr.getY(i2)) / 3,
            (colAttr.getZ(i0) + colAttr.getZ(i1) + colAttr.getZ(i2)) / 3
          );
        } else if (baseColor) {
          color = baseColor.clone();
        } else {
          color = new THREE.Color(0xaaaaaa);
        }
        tris.push({ a: va.clone(), b: vb.clone(), c: vc.clone(), color, unlit });
      }
    }
  });
  return tris;
}

export function makeCamera(eye: THREE.Vector3, target: THREE.Vector3) {
  const f = target.clone().sub(eye).normalize();
  const r = new THREE.Vector3().crossVectors(f, UP).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  return { f, r, u, eye };
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

export function renderPng(
  tris: Tri[],
  cam: ReturnType<typeof makeCamera>,
  out: string,
  opts: { fogNear?: number; fogFar?: number } = {}
) {
  const fogNear = opts.fogNear ?? CONFIG.world.fogNear;
  const fogFar = opts.fogFar ?? CONFIG.world.fogFar;
  const buf = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = FOG.r * 255;
    buf[i * 3 + 1] = FOG.g * 255;
    buf[i * 3 + 2] = FOG.b * 255;
  }

  const project = (p: THREE.Vector3) => {
    const vx = p.x - cam.eye.x;
    const vy = p.y - cam.eye.y;
    const vz = p.z - cam.eye.z;
    const z = vx * cam.f.x + vy * cam.f.y + vz * cam.f.z;
    if (z <= 0.2) return null;
    const x = vx * cam.r.x + vy * cam.r.y + vz * cam.r.z;
    const y = vx * cam.u.x + vy * cam.u.y + vz * cam.u.z;
    return { sx: W / 2 + (x / z) * FOCAL, sy: H / 2 - (y / z) * FOCAL, z };
  };

  interface RTri {
    p0: NonNullable<ReturnType<typeof project>>;
    p1: NonNullable<ReturnType<typeof project>>;
    p2: NonNullable<ReturnType<typeof project>>;
    depth: number;
    color: THREE.Color;
    unlit: boolean;
    normal: THREE.Vector3;
  }
  const ready: RTri[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  for (const t of tris) {
    const p0 = project(t.a);
    const p1 = project(t.b);
    const p2 = project(t.c);
    if (!p0 || !p1 || !p2) continue;
    e1.copy(t.b).sub(t.a);
    e2.copy(t.c).sub(t.a);
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    ready.push({
      p0, p1, p2,
      depth: (p0.z + p1.z + p2.z) / 3,
      color: t.color,
      unlit: t.unlit,
      normal,
    });
  }
  ready.sort((x, y) => y.depth - x.depth);

  for (const t of ready) {
    const { p0, p1, p2 } = t;
    const area = edge(p1.sx, p1.sy, p2.sx, p2.sy, p0.sx, p0.sy);
    if (Math.abs(area) < 1e-4) continue;

    const lit = t.unlit ? 1 : 0.4 + 0.75 * Math.max(0, t.normal.dot(SUN_DIR));
    const fogK = THREE.MathUtils.clamp((t.depth - fogNear) / (fogFar - fogNear), 0, 0.92);
    const r = THREE.MathUtils.clamp(t.color.r * Math.min(1.25, lit) * (1 - fogK) + FOG.r * fogK, 0, 1) * 255;
    const g = THREE.MathUtils.clamp(t.color.g * Math.min(1.25, lit) * (1 - fogK) + FOG.g * fogK, 0, 1) * 255;
    const b = THREE.MathUtils.clamp(t.color.b * Math.min(1.25, lit) * (1 - fogK) + FOG.b * fogK, 0, 1) * 255;

    const minX = Math.max(0, Math.floor(Math.min(p0.sx, p1.sx, p2.sx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0.sx, p1.sx, p2.sx)));
    const minY = Math.max(0, Math.floor(Math.min(p0.sy, p1.sy, p2.sy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0.sy, p1.sy, p2.sy)));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = edge(p1.sx, p1.sy, p2.sx, p2.sy, px, py) / area;
        const w1 = edge(p2.sx, p2.sy, p0.sx, p0.sy, px, py) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const i = (y * W + x) * 3;
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
      }
    }
  }

  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0, j = 0; i < buf.length; i += 3, j += 4) {
    rgba[j] = buf[i];
    rgba[j + 1] = buf[i + 1];
    rgba[j + 2] = buf[i + 2];
    rgba[j + 3] = 255;
  }
  const png = new PNG({ width: W, height: H });
  png.data.set(rgba);
  mkdirSync(out.substring(0, out.lastIndexOf("/") || "."), { recursive: true });
  writeFileSync(out, PNG.sync.write(png));
  console.log(`wrote ${out}`);
}
