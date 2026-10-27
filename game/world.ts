/*
 * Procedural stylized low-poly Myanmar-inspired world.
 *
 * Art direction: smooth, rounded low-poly (Quaternius / PUBG-mobile feel),
 * explicitly anti-voxel. The terrain is an indexed heightfield with smooth
 * normals and blended color ramps; props use lofts, jittered polyhedra,
 * tapered cylinders and lathe geometry — never raw box stacks. Props stay
 * flat-shaded for the stylized faceted read; the ground itself is smooth.
 * No texture assets or downloads are required.
 */

import * as THREE from "three";
import { CONFIG } from "./config";
import type { NoiseImpl } from "./wasm/noise";
import { Rng } from "./rng";
import {
  gabledHouseGeometry,
  hash3,
  jitteredBlobGeometry,
  mergeNonIndexed,
  varyPalette,
} from "./geometry/kit";

export interface CircleObstacle {
  x: number;
  z: number;
  r: number;
}

/* Muted, naturalistic palette (Quaternius-style desaturation). */
const T = {
  silt: new THREE.Color(0x4a6b63),
  sand: new THREE.Color(0xd6c48f),
  grassLow: new THREE.Color(0x7aa85a),
  grassHigh: new THREE.Color(0x5e8c46),
  olive: new THREE.Color(0x6b7d43),
  dirt: new THREE.Color(0x8a6f4c),
  rock: new THREE.Color(0x8a8a86),
};

const smooth = (a: number, b: number, v: number) => {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class World {
  readonly group = new THREE.Group();
  readonly obstacles: CircleObstacle[] = [];
  readonly spawnPoints: THREE.Vector3[] = [];
  terrainMesh!: THREE.Mesh;

  private cloudMesh: THREE.InstancedMesh | null = null;
  private cloudData: Array<{
    x: number; y: number; z: number; speed: number; scale: number; rot: number;
  }> = [];
  private readonly half = CONFIG.world.size / 2;

  constructor(private readonly noise: NoiseImpl) {
    this.buildLights();
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildPagoda();
    this.buildHuts();
    this.buildForest();
    this.buildRocks();
    this.buildGrassTufts();
    this.buildClouds();
    this.buildSpawnPoints();
  }

  heightAt(x: number, z: number): number {
    return this.noise.terrainHeight(x, z, CONFIG.seed);
  }

  /* ------------------------------ lighting ------------------------------ */

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xdfeee0, 0x55603f, 1.15);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
    sun.position.set(60, 90, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = 55;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 220;
    sun.shadow.bias = -0.0008;
    this.group.add(sun);
    this.group.add(sun.target);
    this.sun = sun;

    // Cool fill from the opposite side lifts shadow detail without bloom.
    const fill = new THREE.DirectionalLight(0x9db8d6, 0.45);
    fill.position.set(-50, 35, -45);
    this.group.add(fill);
  }

  private sun!: THREE.DirectionalLight;

  /** Keep the shadow frustum centered on the player for crisp mobile shadows. */
  updateSunTarget(x: number, z: number) {
    this.sun.position.set(x + 60, 90, z + 35);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  /* -------------------------------- sky --------------------------------- */

  private buildSky() {
    const geo = new THREE.SphereGeometry(380, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x86b3d4) },
        horizon: { value: new THREE.Color(0xd6e1cc) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 top;
        uniform vec3 horizon;
        void main() {
          float h = smoothstep(-0.08, 0.55, vDir.y);
          gl_FragColor = vec4(mix(horizon, top, h), 1.0);
        }
      `,
    });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  /* ------------------------------ terrain ------------------------------- */

  private buildTerrain() {
    const { size, terrainSegments, waterLevel } = CONFIG.world;
    // Indexed geometry: shared vertices give smooth stylized normals,
    // instead of the non-indexed faceted voxel look.
    const geo = new THREE.PlaneGeometry(size, size, terrainSegments, terrainSegments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const normals = geo.getAttribute("normal") as THREE.BufferAttribute;

    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const tmp = new THREE.Color();
    const wl = waterLevel;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = pos.getY(i);
      const ny = normals.getY(i);

      // Height ramp with soft transitions — no hard band seams.
      if (h < wl - 0.3) c.copy(T.silt);
      else if (h < wl + 0.55) {
        c.copy(T.silt).lerp(T.sand, smooth(wl - 0.3, wl + 0.1, h));
        tmp.copy(T.sand).lerp(T.grassLow, smooth(wl + 0.1, wl + 0.55, h));
        c.lerp(tmp, smooth(wl + 0.1, wl + 0.55, h));
      } else {
        c.copy(T.grassLow);
        c.lerp(T.grassHigh, smooth(wl + 0.55, 4.5, h));
        c.lerp(T.olive, smooth(4.5, 8, h));
        c.lerp(T.dirt, smooth(8, 10.5, h));
        c.lerp(T.rock, smooth(10.5, 13, h));
      }

      // Steep faces become exposed rock regardless of altitude.
      const rockMix = smooth(0.78, 0.55, ny);
      c.lerp(T.rock, rockMix * 0.8);

      // Deterministic per-vertex brightness variation (hand-painted feel).
      const v = 0.93 + hash3(x * 3.1, h * 5.7, z * 2.3) * 0.14;
      colors[i * 3] = c.r * v;
      colors[i * 3 + 1] = c.g * v;
      colors[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
      flatShading: false, // smooth rolling hills
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrainMesh = mesh;
  }

  /* ------------------------------- water -------------------------------- */

  private waterMesh: THREE.Mesh | null = null;
  private waterBase: Float32Array | null = null;
  private waterTime = 0;

  private buildWater() {
    // Subdivided plane so gentle CPU-side waves can move real vertices.
    const span = CONFIG.world.size * 1.4;
    const geo = new THREE.PlaneGeometry(span, span, 56, 56);
    geo.rotateX(-Math.PI / 2);
    this.waterBase = (geo.getAttribute("position") as THREE.BufferAttribute).array.slice() as Float32Array;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3f7d8c,
      transparent: true,
      opacity: 0.72,
      roughness: 0.22,
      metalness: 0.12,
      flatShading: true,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = CONFIG.world.waterLevel;
    water.receiveShadow = true;
    this.waterMesh = water;
    this.group.add(water);
  }

  /* -------------------------- landmark: pagoda -------------------------- */

  private buildPagoda() {
    const spot = this.findHighGround(0, 0, 40);
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({
      color: 0xd9a93b,
      metalness: 0.45,
      roughness: 0.42,
      flatShading: true,
    });
    const stone = new THREE.MeshStandardMaterial({
      color: 0xb9b2a0,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });

    // Octagonal plinths (faceted cylinders, not boxes).
    const plinth1 = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 7.0, 0.9, 8), stone);
    plinth1.position.y = 0.45;
    const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.9, 0.8, 8), stone);
    plinth2.position.y = 1.3;
    g.add(plinth1, plinth2);

    // Lathe-turned zedi body: stepped terraces flow into the bell and neck.
    const profile = [
      [4.6, 1.7], [4.6, 2.15], [4.0, 2.15], [4.0, 2.55],
      [3.45, 2.55], [3.45, 2.95], [2.95, 2.95], [2.95, 3.3],
      [2.55, 3.6], [3.05, 4.15], [2.7, 4.9], [2.0, 5.5],
      [1.25, 5.95], [0.75, 6.25], [0.5, 6.45],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 8), gold);
    g.add(body);

    // Tapering spire + finial.
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.4, 8), gold);
    spire.position.y = 8.1;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), gold);
    finial.position.y = 9.9;
    g.add(spire, finial);

    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.position.set(spot.x, this.heightAt(spot.x, spot.z), spot.z);
    this.group.add(g);
    this.obstacles.push({ x: spot.x, z: spot.z, r: 6.2 });
  }

  /* --------------------------- stilt village ---------------------------- */

  private buildHuts() {
    const rng = new Rng(CONFIG.seed + 41);
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c7448, roughness: 0.85, flatShading: true });
    const wall = new THREE.MeshStandardMaterial({ color: 0xc8b184, roughness: 0.9, flatShading: true });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x4f7a3c, roughness: 0.85, flatShading: true });

    // Square prism from a 4-segment cylinder and a matching pyramid roof —
    // a gabled silhouette without a single box.
    const wallGeo = new THREE.CylinderGeometry(1.85, 1.95, 2.0, 4, 1);
    wallGeo.rotateY(Math.PI / 4);
    const roofGeo = new THREE.ConeGeometry(2.9, 1.9, 4);
    roofGeo.rotateY(Math.PI / 4);
    const legGeo = new THREE.CylinderGeometry(0.13, 0.17, 2.4, 6);
    legGeo.translate(0, 1.2, 0);

    const makeHut = (): THREE.Group => {
      const g = new THREE.Group();
      for (const [lx, lz] of [
        [-1.5, -1.5],
        [1.5, -1.5],
        [-1.5, 1.5],
        [1.5, 1.5],
      ]) {
        const leg = new THREE.Mesh(legGeo, wood);
        leg.position.set(lx, 0, lz);
        g.add(leg);
      }
      const bodyMesh = new THREE.Mesh(wallGeo, wall);
      bodyMesh.position.y = 3.4;
      const roof = new THREE.Mesh(roofGeo, leaf);
      roof.position.y = 5.3;
      // A gabled prism variant is kept available for porch extensions.
      const gable = new THREE.Mesh(gabledHouseGeometry(1.4, 1.1, 1.0), wood);
      gable.position.set(0, 2.3, 2.05);
      g.add(bodyMesh, roof, gable);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      return g;
    };

    let placed = 0;
    let attempts = 0;
    while (placed < CONFIG.world.hutCount && attempts++ < 120) {
      const x = rng.range(-this.half + 18, this.half - 18);
      const z = rng.range(-this.half + 18, this.half - 18);
      const h = this.heightAt(x, z);
      if (h < CONFIG.world.waterLevel + 0.8 || h > 8) continue;
      if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 9)) continue;
      const hut = makeHut();
      hut.position.set(x, h, z);
      hut.rotation.y = rng.range(0, Math.PI * 2);
      this.group.add(hut);
      this.obstacles.push({ x, z, r: 3.1 });
      placed++;
    }
  }

  /* ---------------------------- forest props ---------------------------- */

  private buildForest() {
    const rng = new Rng(CONFIG.seed + 7);
    const dummy = new THREE.Object3D();

    // Broadleaf: tapered trunk + a crown of merged jittered blobs.
    const broadTrunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 2.8, 7);
    broadTrunkGeo.translate(0, 1.4, 0);
    const broadCrownGeo = mergeNonIndexed([
      jitteredBlobGeometry(1.55, 0, 0.12, 11).translate(0, 3.5, 0),
      jitteredBlobGeometry(1.1, 0, 0.12, 23).translate(0.35, 4.55, 0.15),
      jitteredBlobGeometry(0.82, 0, 0.12, 37).translate(-0.25, 5.35, -0.1),
    ]);

    // Conifer: tapered trunk + two stacked, softly faceted cones.
    const coneTrunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.2, 7);
    coneTrunkGeo.translate(0, 1.1, 0);
    const lowerCone = new THREE.ConeGeometry(1.7, 2.7, 7);
    lowerCone.translate(0, 3.1, 0);
    const upperCone = new THREE.ConeGeometry(1.25, 2.3, 7);
    upperCone.translate(0, 4.55, 0);
    const coniferCrownGeo = mergeNonIndexed([lowerCone, upperCone]);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const trunkPalette = varyPalette(0x7a5636, 3, 0.1);
    const greenPalette = varyPalette(0x4d7d3a, 4, 0.12);
    const coniferPalette = varyPalette(0x355e2c, 4, 0.1);
    const tint = new THREE.Color();

    interface Placement {
      x: number;
      z: number;
      scale: number;
      rot: number;
      conifer: boolean;
    }
    const placements: Placement[] = [];
    let attempts = 0;
    while (placements.length < CONFIG.world.treeCount && attempts++ < CONFIG.world.treeCount * 6) {
      const x = rng.range(-this.half + 6, this.half - 6);
      const z = rng.range(-this.half + 6, this.half - 6);
      const h = this.heightAt(x, z);
      if (h < CONFIG.world.waterLevel + 0.4) continue;
      if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2.2)) continue;
      placements.push({
        x,
        z,
        scale: rng.range(0.8, 1.5),
        rot: rng.range(0, Math.PI * 2),
        conifer: hash3(x, z, 7) < 0.4,
      });
      this.obstacles.push({ x, z, r: 0.55 * placements[placements.length - 1].scale });
    }

    const broad = placements.filter((p) => !p.conifer);
    const conifers = placements.filter((p) => p.conifer);

    const addSpecies = (
      list: Placement[],
      trunkGeo: THREE.BufferGeometry,
      crownGeo: THREE.BufferGeometry,
      crownColors: THREE.Color[]
    ) => {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
      trunks.castShadow = true;
      crowns.castShadow = true;
      list.forEach((p, i) => {
        dummy.position.set(p.x, this.heightAt(p.x, p.z), p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        crowns.setMatrixAt(i, dummy.matrix);
        trunks.setColorAt(i, trunkPalette[i % trunkPalette.length]);
        tint.copy(crownColors[i % crownColors.length]);
        // Slight lightness variance per instance.
        tint.offsetHSL(0, 0, (hash3(p.x, i, p.z) - 0.5) * 0.06);
        crowns.setColorAt(i, tint);
      });
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      trunks.computeBoundingSphere();
      crowns.computeBoundingSphere();
      this.group.add(trunks, crowns);
    };

    addSpecies(broad, broadTrunkGeo, broadCrownGeo, greenPalette);
    addSpecies(conifers, coneTrunkGeo, coniferCrownGeo, coniferPalette);
  }

  private buildRocks() {
    const rng = new Rng(CONFIG.seed + 99);
    const count = CONFIG.world.rockCount;
    // One jittered polyhedron, varied per instance by non-uniform scale,
    // random rotation and palette shade — organic, never identical clones.
    const geo = jitteredBlobGeometry(1, 0, 0.28, 101);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(geo, mat, count);
    rocks.castShadow = true;
    const palette = varyPalette(0x827d72, 4, 0.1);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const x = rng.range(-this.half + 5, this.half - 5);
      const z = rng.range(-this.half + 5, this.half - 5);
      const h = this.heightAt(x, z);
      const s = rng.range(0.5, 1.8);
      dummy.position.set(x, h + s * 0.35, z);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      dummy.scale.set(s, s * rng.range(0.6, 0.9), s);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      rocks.setColorAt(i, palette[i % palette.length]);
      this.obstacles.push({ x, z, r: s * 0.8 });
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.group.add(rocks);
  }

  /* --------------------------- grass and clouds -------------------------- */

  private buildGrassTufts() {
    const rng = new Rng(CONFIG.seed + 314);
    const count = 260;
    // Three-blade tuft: merged tiny cones, one draw call via instancing.
    const blade = new THREE.ConeGeometry(0.16, 0.7, 3);
    blade.translate(0, 0.35, 0);
    const tuftGeo = mergeNonIndexed([
      blade,
      blade.clone().rotateY(Math.PI / 3).translate(0.08, 0, 0),
      blade.clone().rotateY(-Math.PI / 3).translate(-0.08, 0, 0),
    ]);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
    });
    const tufts = new THREE.InstancedMesh(tuftGeo, mat, count);
    const palette = varyPalette(0x6f9e4e, 4, 0.14);
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const x = rng.range(-this.half + 4, this.half - 4);
      const z = rng.range(-this.half + 4, this.half - 4);
      const h = this.heightAt(x, z);
      // Tufts only on open grassland — not underwater, not on bare rock.
      if (h < CONFIG.world.waterLevel + 0.7 || h > 8.5) continue;
      if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.6)) continue;
      const s = rng.range(0.7, 1.4);
      dummy.position.set(x, h, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      tufts.setMatrixAt(placed, dummy.matrix);
      tufts.setColorAt(placed, palette[placed % palette.length]);
      placed++;
    }
    tufts.count = placed;
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    tufts.receiveShadow = true;
    this.group.add(tufts);
  }

  private buildClouds() {
    const rng = new Rng(CONFIG.seed + 271);
    const count = 14;
    // A cloud is a cluster of flattened jittered blobs in one geometry.
    const blobs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const b = jitteredBlobGeometry(2.6 + i * 0.7, 0, 0.18, 71 + i * 13);
      b.scale(1, 0.42, 1);
      b.translate((i - 1.5) * 2.4, 0, (hash3(i, 2, 9) - 0.5) * 2);
      blobs.push(b);
    }
    const cloudGeo = mergeNonIndexed(blobs);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf2f4ee,
      roughness: 1,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, mat, count);
    const dummy = new THREE.Object3D();
    const cloudPalette = varyPalette(0xf2f4ee, 3, 0.05);
    this.cloudData = [];
    for (let i = 0; i < count; i++) {
      const x = rng.range(-this.half, this.half);
      const z = rng.range(-this.half, this.half);
      const y = rng.range(58, 82);
      const s = rng.range(1.6, 3.4);
      const rot = rng.range(0, Math.PI * 2);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.cloudMesh.setMatrixAt(i, dummy.matrix);
      this.cloudMesh.setColorAt(i, cloudPalette[i % cloudPalette.length]);
      this.cloudData.push({ x, y, z, speed: rng.range(0.6, 1.6), scale: s, rot });
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    this.cloudMesh.frustumCulled = false;
    this.group.add(this.cloudMesh);
  }

  /** Slow cloud drift and water waves, called once per frame. */
  updateAmbient(dt: number) {
    this.waterTime += dt;
    if (this.waterMesh && this.waterBase) {
      const attr = this.waterMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const t = this.waterTime;
      for (let i = 0; i < attr.count; i++) {
        const x = this.waterBase[i * 3];
        const z = this.waterBase[i * 3 + 2];
        // Two crossed sine fields read as small irregular ripples.
        const wave =
          Math.sin(x * 0.12 + t * 1.1) * 0.09 +
          Math.cos(z * 0.16 + t * 0.8) * 0.06;
        attr.setY(i, wave);
      }
      attr.needsUpdate = true;
      this.waterMesh.geometry.computeVertexNormals();
    }
    if (!this.cloudMesh) return;
    const dummy = new THREE.Object3D();
    const limit = this.half + 30;
    this.cloudData.forEach((c, i) => {
      c.x += c.speed * dt;
      if (c.x > limit) c.x = -limit;
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, c.rot, 0);
      dummy.scale.setScalar(c.scale);
      dummy.updateMatrix();
      this.cloudMesh!.setMatrixAt(i, dummy.matrix);
    });
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------ helpers ------------------------------- */

  private findHighGround(cx: number, cz: number, radius: number) {
    let best = { x: cx, z: cz, h: -Infinity };
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = radius * (0.3 + (i % 5) * 0.17);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h > best.h) best = { x, z, h };
    }
    return best;
  }

  private buildSpawnPoints() {
    const rng = new Rng(CONFIG.seed + 555);
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(this.half * 0.55, this.half * 0.92);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      if (y > CONFIG.world.waterLevel + 0.6) {
        this.spawnPoints.push(new THREE.Vector3(x, y, z));
      }
    }
  }

  randomSpawn(rng: Rng): THREE.Vector3 {
    const p = this.spawnPoints[rng.int(0, this.spawnPoints.length - 1)] ??
      new THREE.Vector3(0, this.heightAt(0, 0), 0);
    return p.clone();
  }
}
