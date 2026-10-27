/*
 * Procedural low-poly Myanmar-inspired world: faceted heightfield terrain,
 * monsoon mist, teak/dipterocarp jungle (instanced), boulders, a golden
 * pagoda landmark and stilt village huts. No texture assets needed.
 */

import * as THREE from "three";
import { CONFIG } from "./config";
import type { NoiseImpl } from "./wasm/noise";
import { Rng } from "./rng";

export interface CircleObstacle {
  x: number;
  z: number;
  r: number;
}

const COLORS = {
  sand: new THREE.Color(0xd9c896),
  grass: new THREE.Color(0x6f9e4e),
  grassDark: new THREE.Color(0x4d7d3a),
  dirt: new THREE.Color(0x8a6b46),
  rock: new THREE.Color(0x7d7a72),
  underwater: new THREE.Color(0x5d7f73),
};

export class World {
  readonly group = new THREE.Group();
  readonly obstacles: CircleObstacle[] = [];
  readonly spawnPoints: THREE.Vector3[] = [];
  terrainMesh!: THREE.Mesh;

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
    this.buildSpawnPoints();
  }

  heightAt(x: number, z: number): number {
    return this.noise.terrainHeight(x, z, CONFIG.seed);
  }

  /* ------------------------------ lighting ------------------------------ */

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xdfeee0, 0x55603f, 1.05);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
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
    const geo = new THREE.SphereGeometry(380, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xaecfb8,
      side: THREE.BackSide,
      fog: false,
    });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  /* ------------------------------ terrain ------------------------------- */

  private buildTerrain() {
    const { size, terrainSegments, waterLevel } = CONFIG.world;
    const plane = new THREE.PlaneGeometry(size, size, terrainSegments, terrainSegments);
    const geo = plane.toNonIndexed();
    plane.dispose();
    geo.rotateX(-Math.PI / 2); // lie flat in XZ first, then displace Y

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);

      if (h < waterLevel - 0.25) c.copy(COLORS.underwater);
      else if (h < waterLevel + 0.55) c.copy(COLORS.sand);
      else if (h < 3.2) c.copy(COLORS.grass);
      else if (h < 7.5) c.copy(COLORS.grassDark);
      else if (h < 10.5) c.copy(COLORS.dirt);
      else c.copy(COLORS.rock);

      // subtle per-face brightness variation for a hand-painted feel
      const v = 0.92 + ((i * 7919) % 100) / 100 * 0.16;
      colors[i * 3] = c.r * v;
      colors[i * 3 + 1] = c.g * v;
      colors[i * 3 + 2] = c.b * v;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals(); // flat facets from non-indexed geometry

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrainMesh = mesh;
  }

  /* ------------------------------- water -------------------------------- */

  private buildWater() {
    const geo = new THREE.PlaneGeometry(CONFIG.world.size * 1.4, CONFIG.world.size * 1.4);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x3f7d8c,
      transparent: true,
      opacity: 0.72,
    });
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = CONFIG.world.waterLevel;
    this.group.add(water);
  }

  /* -------------------------- landmark: pagoda -------------------------- */

  private buildPagoda() {
    // Put it on the highest ground near the map centre.
    const spot = this.findHighGround(0, 0, 40);
    const g = new THREE.Group();
    const gold = new THREE.MeshLambertMaterial({ color: 0xd9a93b, flatShading: true });
    const stone = new THREE.MeshLambertMaterial({ color: 0xb9b2a0, flatShading: true });

    const base = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 10), stone);
    base.position.y = 0.6;
    g.add(base);

    // Stepped terraces + bell + spire: the classic zedi silhouette.
    let y = 1.2;
    for (let i = 0; i < 4; i++) {
      const w = 8.4 - i * 1.5;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, w), gold);
      tier.position.y = y + 0.4;
      g.add(tier);
      y += 0.8;
    }
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 3.2, 8), gold);
    bell.position.y = y + 1.6;
    g.add(bell);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.5, 8), gold);
    spire.position.y = y + 3.2 + 2.25;
    g.add(spire);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 6), gold);
    tip.position.y = y + 3.2 + 4.5 + 0.9;
    g.add(tip);

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
    const wood = new THREE.MeshLambertMaterial({ color: 0x9c7448, flatShading: true });
    const wall = new THREE.MeshLambertMaterial({ color: 0xc8b184, flatShading: true });
    const leaf = new THREE.MeshLambertMaterial({ color: 0x4f7a3c, flatShading: true });

    const makeHut = (): THREE.Group => {
      const g = new THREE.Group();
      const legGeo = new THREE.CylinderGeometry(0.14, 0.18, 2.4, 5);
      for (const [lx, lz] of [
        [-1.6, -1.6],
        [1.6, -1.6],
        [-1.6, 1.6],
        [1.6, 1.6],
      ]) {
        const leg = new THREE.Mesh(legGeo, wood);
        leg.position.set(lx, 1.2, lz);
        g.add(leg);
      }
      const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), wood);
      floor.position.y = 2.35;
      g.add(floor);
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2, 3.6), wall);
      body.position.y = 3.5;
      g.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.9, 4), leaf);
      roof.position.y = 5.45;
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
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
    const count = CONFIG.world.treeCount;
    const dummy = new THREE.Object3D();

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 5);
    trunkGeo.translate(0, 1.3, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5636, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    trunks.castShadow = true;

    const leafGeo = new THREE.ConeGeometry(1.7, 4.4, 6);
    leafGeo.translate(0, 4.6, 0);
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f6e35, flatShading: true });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
    leaves.castShadow = true;

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts++ < count * 6) {
      const x = rng.range(-this.half + 6, this.half - 6);
      const z = rng.range(-this.half + 6, this.half - 6);
      const h = this.heightAt(x, z);
      if (h < CONFIG.world.waterLevel + 0.4) continue;
      if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2.2)) continue;

      const scale = rng.range(0.8, 1.5);
      dummy.position.set(x, h, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      leaves.setMatrixAt(placed, dummy.matrix);
      this.obstacles.push({ x, z, r: 0.55 * scale });
      placed++;
    }
    trunks.count = placed;
    leaves.count = placed;
    this.group.add(trunks, leaves);
  }

  private buildRocks() {
    const rng = new Rng(CONFIG.seed + 99);
    const count = CONFIG.world.rockCount;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x827d72, flatShading: true });
    const rocks = new THREE.InstancedMesh(geo, mat, count);
    rocks.castShadow = true;
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
      this.obstacles.push({ x, z, r: s * 0.8 });
    }
    this.group.add(rocks);
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
