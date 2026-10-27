/*
 * Combat presentation and loot: pooled bullet tracers, muzzle flashes and
 * rotating medkit / ammo crates scattered around the map.
 */

import * as THREE from "three";
import { CONFIG } from "./config";
import type { Rng } from "./rng";
import type { World, CircleObstacle } from "./world";

/* ------------------------------- tracers -------------------------------- */

interface Tracer {
  line: THREE.Line;
  life: number;
}

export class TracerPool {
  private readonly pool: Tracer[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, size = 28) {
    for (let i = 0; i < size; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd98a,
        transparent: true,
        opacity: 0,
        fog: true,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      scene.add(line);
      this.pool.push({ line, life: 0 });
    }
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3, color = 0xffd98a) {
    const t = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;

    const pos = t.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    (t.line.material as THREE.LineBasicMaterial).color.setHex(color);
    (t.line.material as THREE.LineBasicMaterial).opacity = 0.95;
    t.line.visible = true;
    t.life = CONFIG.weapon.tracerLife;
  }

  update(dt: number) {
    for (const t of this.pool) {
      if (!t.line.visible) continue;
      t.life -= dt;
      const m = t.line.material as THREE.LineBasicMaterial;
      m.opacity = Math.max(0, t.life / CONFIG.weapon.tracerLife) * 0.95;
      if (t.life <= 0) t.line.visible = false;
    }
  }
}

/* ----------------------------- muzzle flash ------------------------------ */

export class MuzzleFlash {
  readonly mesh: THREE.Mesh;
  private life = 0;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffcf6b })
    );
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  flash(at: THREE.Vector3) {
    this.mesh.position.copy(at);
    this.mesh.visible = true;
    this.life = 0.05;
  }

  update(dt: number) {
    if (this.mesh.visible) {
      this.life -= dt;
      if (this.life <= 0) this.mesh.visible = false;
    }
  }
}

/* -------------------------------- pickups -------------------------------- */

export type PickupKind = "medkit" | "ammo";

export class Pickup {
  readonly group = new THREE.Group();
  kind: PickupKind;
  active = true;
  private respawnT = 0;
  private readonly home: THREE.Vector3;

  constructor(kind: PickupKind, x: number, y: number, z: number) {
    this.kind = kind;
    this.home = new THREE.Vector3(x, y, z);

    if (kind === "medkit") {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.55, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xf2f2ee, flatShading: true })
      );
      const crossV = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.4, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xd83b3b })
      );
      const crossH = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.16, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xd83b3b })
      );
      crossV.position.z = 0.37;
      crossH.position.z = 0.37;
      this.group.add(box, crossV, crossH);
    } else {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.7, 0.85),
        new THREE.MeshLambertMaterial({ color: 0x6b7256, flatShading: true })
      );
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.18, 0.9),
        new THREE.MeshBasicMaterial({ color: 0xc9a23c })
      );
      this.group.add(crate, band);
    }

    this.group.position.set(x, y + 0.8, z);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  update(dt: number, time: number) {
    if (!this.active) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.active = true;
        this.group.visible = true;
      }
      return;
    }
    this.group.rotation.y = time * 1.4;
    this.group.position.y = this.home.y + 0.8 + Math.sin(time * 2.2 + this.home.x) * 0.18;
  }

  collect(respawnDelay: number) {
    this.active = false;
    this.group.visible = false;
    this.respawnT = respawnDelay;
  }
}

export class PickupManager {
  readonly pickups: Pickup[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly obstacles: CircleObstacle[],
    private readonly rng: Rng
  ) {
    for (let i = 0; i < CONFIG.world.pickupCount; i++) {
      const kind: PickupKind = i % 3 === 0 ? "medkit" : "ammo";
      const spot = this.findSpot();
      const p = new Pickup(kind, spot.x, spot.y, spot.z);
      this.pickups.push(p);
      scene.add(p.group);
    }
  }

  private findSpot(): THREE.Vector3 {
    const half = CONFIG.world.size / 2 - 10;
    for (let i = 0; i < 30; i++) {
      const x = this.rng.range(-half, half);
      const z = this.rng.range(-half, half);
      const y = this.world.heightAt(x, z);
      if (y < CONFIG.world.waterLevel + 0.5) continue;
      if (this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
      return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(0, this.world.heightAt(0, 0) + 1, 0);
  }

  update(dt: number, time: number) {
    for (const p of this.pickups) p.update(dt, time);
  }

  /** Auto-loot on proximity (mobile friendly). Returns collected kind or null. */
  collectNearby(pos: THREE.Vector3): PickupKind | null {
    for (const p of this.pickups) {
      if (!p.active) continue;
      if (Math.hypot(p.group.position.x - pos.x, p.group.position.z - pos.z) < CONFIG.pickups.radius) {
        p.collect(25);
        return p.kind;
      }
    }
    return null;
  }
}
