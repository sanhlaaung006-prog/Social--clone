/*
 * Low-poly humanoid actors: shared rounded stylized character (tapered
 * cylinders and sphere primitives — no box geometry), third-person player
 * controller and state-machine bots. All geometry is procedural.
 */

import * as THREE from "three";
import { CONFIG } from "./config";
import type { InputState } from "./input";
import type { Rng } from "./rng";
import type { World } from "./world";
import type { Physics } from "./wasm/physics";

export interface HumanoidParts {
  group: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  body: THREE.Mesh;
  muzzle: THREE.Object3D;
  barBg: THREE.Mesh;
  barFg: THREE.Mesh;
  barGroup: THREE.Group;
}

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true });
}

/** Horizontal cylinder along Z, for rifle barrels and similar details. */
function zCylinder(rTop: number, rBottom: number, length: number, segments = 8): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/**
 * Low-poly rifle assembled from cylinders (receiver, barrel, magazine,
 * stock). Shared by the third-person humanoid and the FPS view model.
 */
export function buildRifleModel(): THREE.Group {
  const metal = mat(0x2c3138);
  const rifle = new THREE.Group();
  rifle.name = "rifle";
  const receiver = new THREE.Mesh(zCylinder(0.09, 0.1, 0.7, 8), metal);
  receiver.castShadow = true;
  const barrel = new THREE.Mesh(zCylinder(0.045, 0.055, 0.7, 8), metal);
  barrel.position.z = 0.62;
  barrel.castShadow = true;
  const mag = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 6), metal);
  mag.position.set(0, -0.16, -0.05);
  mag.rotation.x = 0.25;
  const stock = new THREE.Mesh(zCylinder(0.08, 0.1, 0.34, 7), metal);
  stock.position.z = -0.48;
  rifle.add(receiver, barrel, mag, stock);
  return rifle;
}

export function buildHumanoid(uniform: number, accent: number): HumanoidParts {
  const g = new THREE.Group();
  const cloth = mat(uniform);
  const skin = mat(0xc99a6a);
  const dark = mat(0x3a3f38);

  // Torso: tapered faceted cylinder with a subtle chest.
  const torsoGeo = new THREE.CylinderGeometry(0.34, 0.44, 1.15, 8, 1);
  const body = new THREE.Mesh(torsoGeo, cloth);
  body.position.y = 1.78;
  body.castShadow = true;
  g.add(body);

  // Armor vest: a wider, shorter tapered band over the chest.
  const vestGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.6, 8, 1);
  const vest = new THREE.Mesh(vestGeo, mat(accent));
  vest.position.y = 1.9;
  vest.castShadow = true;
  g.add(vest);

  // Sphere head with a hemisphere helmet and a small neck.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 7), skin);
  neck.position.y = 2.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), skin);
  head.position.y = 2.66;
  head.castShadow = true;
  const helmetGeo = new THREE.SphereGeometry(0.35, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const helmet = new THREE.Mesh(helmetGeo, dark);
  helmet.position.y = 2.7;
  helmet.castShadow = true;
  g.add(neck, head, helmet);

  // Limbs: tapered cylinders translated so the mesh origin is the
  // hip/shoulder pivot — walk swings rotate around the joint, not the middle.
  const legGeo = new THREE.CylinderGeometry(0.13, 0.18, 1.0, 7, 1);
  legGeo.translate(0, -0.5, 0);
  const leftLeg = new THREE.Mesh(legGeo, dark);
  leftLeg.position.set(-0.24, 1.18, 0);
  const rightLeg = new THREE.Mesh(legGeo, dark);
  rightLeg.position.set(0.24, 1.18, 0);
  leftLeg.castShadow = rightLeg.castShadow = true;
  g.add(leftLeg, rightLeg);

  const armGeo = new THREE.CylinderGeometry(0.11, 0.15, 0.95, 7, 1);
  armGeo.translate(0, -0.47, 0);
  const leftArm = new THREE.Mesh(armGeo, cloth);
  leftArm.position.set(-0.52, 2.22, 0);
  const rightArm = new THREE.Mesh(armGeo, cloth);
  rightArm.position.set(0.52, 2.22, 0.1);
  leftArm.castShadow = rightArm.castShadow = true;
  g.add(leftArm, rightArm);

  // Low-poly rifle assembled from cylinders: receiver, barrel, magazine.
  const rifle = buildRifleModel();
  rifle.position.set(0.46, 1.72, 0.45);
  g.add(rifle);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.46, 1.72, 1.42);
  g.add(muzzle);

  // World-space health bar (billboarded by the engine).
  const barGroup = new THREE.Group();
  barGroup.position.y = 3.35;
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x1a1d1a, transparent: true, opacity: 0.75 })
  );
  const barFg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x57d657 })
  );
  barFg.position.z = 0.01;
  barGroup.add(barBg, barFg);
  barGroup.visible = false;
  g.add(barGroup);

  return { group: g, leftLeg, rightLeg, leftArm, rightArm, body, muzzle, barBg, barFg, barGroup };
}

/* ------------------------------- base actor ------------------------------ */

export abstract class Actor {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  hp: number;
  alive = true;
  yaw = 0;
  protected grounded = true;
  protected vy = 0;
  protected walkPhase = 0;
  protected readonly parts: HumanoidParts;
  readonly radius: number;
  /** meshes that bullets can hit */
  readonly hitMeshes: THREE.Object3D[] = [];

  constructor(
    protected readonly world: World,
    protected readonly physics: Physics,
    uniform: number,
    accent: number,
    maxHp: number
  ) {
    this.parts = buildHumanoid(uniform, accent);
    this.group.add(this.parts.group);
    this.hp = maxHp;
    this.radius = CONFIG.player.radius;
    this.parts.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.userData.actor = this;
        this.hitMeshes.push(o);
      }
    });
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  applyDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      this.onDeath();
      return true;
    }
    return false;
  }

  protected onDeath() {
    this.parts.barGroup.visible = false;
  }

  protected collideAndMove(dx: number, dz: number) {
    // All capsule collision runs through the C/WASM physics core (or its
    // bit-identical JS fallback): world bounds + static obstacles, then the
    // dynamic vehicle collision radii.
    let [x, z] = this.physics.resolveCircles(
      this.position.x + dx,
      this.position.z + dz,
      this.radius
    );
    [x, z] = this.physics.resolveAgainstVehicles(x, z, this.radius);
    this.position.x = x;
    this.position.z = z;
  }

  protected applyGravity(dt: number) {
    const ground = this.world.heightAt(this.position.x, this.position.z);
    if (this.grounded) {
      this.vy = 0;
      this.position.y = ground;
      return;
    }
    this.vy -= CONFIG.player.gravity * dt;
    this.position.y += this.vy * dt;
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.vy = 0;
      this.grounded = true;
    }
  }

  protected animateWalk(speed: number, dt: number) {
    const p = this.parts;
    if (speed > 0.4) {
      this.walkPhase += dt * speed * 1.7;
      const swing = Math.sin(this.walkPhase) * 0.65;
      p.leftLeg.rotation.x = swing;
      p.rightLeg.rotation.x = -swing;
      p.leftArm.rotation.x = -swing * 0.6;
      p.rightArm.rotation.x = swing * 0.4;
    } else {
      this.walkPhase = 0;
      p.leftLeg.rotation.x *= 0.8;
      p.rightLeg.rotation.x *= 0.8;
      p.leftArm.rotation.x *= 0.8;
    }
    this.parts.group.rotation.y = this.yaw;
  }

  updateHealthBar(camera: THREE.Camera) {
    if (!this.alive) return;
    const ratio = Math.max(0, this.hp / this.maxHp());
    this.parts.barGroup.visible = ratio < 0.999;
    this.parts.barGroup.quaternion.copy(camera.quaternion);
    this.parts.barFg.scale.x = ratio;
    this.parts.barFg.position.x = -(1 - ratio) * 0.575;
    const m = this.parts.barFg.material as THREE.MeshBasicMaterial;
    m.color.setHSL(ratio * 0.33, 0.8, 0.5);
  }

  protected maxHp(): number {
    return CONFIG.player.maxHp;
  }

  get muzzleWorld(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.parts.muzzle.getWorldPosition(v);
    return v;
  }
}

/* --------------------------------- player -------------------------------- */

export class Player extends Actor {
  pitch = 0;
  private reloadT = 0;
  mag: number = CONFIG.weapon.magSize;
  reserve: number = CONFIG.weapon.reserveAmmo;
  reloading = false;

  constructor(world: World, physics: Physics) {
    super(world, physics, 0x5f7a4a, 0x3d4f33, CONFIG.player.maxHp);
  }

  get isReloading() {
    return this.reloading;
  }

  startReload() {
    if (this.reloading || this.mag >= CONFIG.weapon.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = CONFIG.weapon.reloadTime;
  }

  /** Returns true when a shot can be fired this frame. */
  consumeShot(fireCooldown: number): boolean {
    if (fireCooldown > 0 || this.reloading || this.mag <= 0 || !this.alive) return false;
    this.mag--;
    if (this.mag === 0) this.startReload();
    return true;
  }

  addAmmo(n: number) {
    this.reserve += n;
  }

  heal(n: number) {
    this.hp = Math.min(CONFIG.player.maxHp, this.hp + n);
  }

  update(dt: number, input: InputState) {
    if (!this.alive) return;

    // Reload timer.
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = CONFIG.weapon.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }
    if (input.reloadQueued) this.startReload();

    // Look.
    const sens = input.touch ? 0.0042 : 0.0024;
    const look = input.consumeLook();
    this.yaw -= look.dx * sens;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - look.dy * sens,
      -1.15,
      1.15
    );

    // Movement relative to facing.
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3()
      .addScaledVector(f, input.moveY)
      .addScaledVector(r, input.moveX);
    if (wish.lengthSq() > 1) wish.normalize();

    const speed =
      CONFIG.player.speed * (input.sprint && input.moveY > 0 ? CONFIG.player.sprintMul : 1);
    const targetVx = wish.x * speed;
    const targetVz = wish.z * speed;
    const k = Math.min(1, CONFIG.player.accel * dt);
    this.velocity.x += (targetVx - this.velocity.x) * k;
    this.velocity.z += (targetVz - this.velocity.z) * k;

    this.collideAndMove(this.velocity.x * dt, this.velocity.z * dt);

    if (input.jumpQueued && this.grounded) {
      this.vy = CONFIG.player.jumpSpeed;
      this.grounded = false;
    }
    this.applyGravity(dt);

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.animateWalk(horizSpeed, dt);
  }
}

/* ---------------------------------- bot ---------------------------------- */

export interface BotShot {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

type BotState = "patrol" | "search" | "engage" | "cover" | "dead";

export class Bot extends Actor {
  state: BotState = "patrol";
  readonly callsign: string;
  private waypoint = new THREE.Vector3();
  private waypointT = 0;
  private fireT = 0;
  private burstLeft = 0;
  private burstT = 0;
  private strafe = 1;
  private strafeT = 0;
  private deathT = 0;
  /* Perception: last-known player position plus how long it stays believable.
     A bot never reads the live player position while the player is unseen. */
  private readonly lastSeen = new THREE.Vector3();
  private lastSeenT = -1e9;
  private aiTime = 0;
  private reactT = 0;
  /* Stall detector: no positional progress forces a navigation repair. */
  private readonly progressAt = new THREE.Vector3();
  private stallT = 0;
  /* Cover retreat point and its hold timer. */
  private readonly coverPoint = new THREE.Vector3();
  private coverT = 0;
  /* Cooldown after a retreat so cover cannot re-trigger every frame. */
  private coverCdT = 0;

  constructor(
    world: World,
    physics: Physics,
    callsign: string,
    spawn: THREE.Vector3,
    private readonly rng: Rng
  ) {
    super(world, physics, 0x8a5a4a, 0x6e3328, CONFIG.bot.maxHp);
    this.callsign = callsign;
    this.group.position.copy(spawn);
    this.progressAt.copy(spawn);
    this.yaw = rng.range(0, Math.PI * 2);
    this.pickWaypoint();
  }

  /** Debug/HUD-visible AI state (no mutable internals exposed). */
  get aiState(): BotState {
    return this.state;
  }

  protected override maxHp() {
    return CONFIG.bot.maxHp;
  }

  protected override onDeath() {
    super.onDeath();
    this.state = "dead";
    this.velocity.set(0, 0, 0);
  }

  private pickWaypoint() {
    const half = CONFIG.world.size / 2 - 8;
    for (let i = 0; i < 12; i++) {
      const x = this.rng.range(-half, half);
      const z = this.rng.range(-half, half);
      if (this.world.heightAt(x, z) > CONFIG.world.waterLevel) {
        this.waypoint.set(x, 0, z);
        break;
      }
    }
    this.waypointT = this.rng.range(4, 9);
  }

  /** True when no static cover sphere or terrain ridge blocks the segment
   *  from this bot's eye line to the target's chest. Both physics rays
   *  return -1 on a clean miss, so only a non-negative t shorter than the
   *  segment counts as occlusion. */
  private hasLineOfSight(target: THREE.Vector3): boolean {
    const eye = this.position.clone();
    eye.y += 1.6;
    const aim = target.clone();
    aim.y += 1.5;
    const dir = aim.sub(eye);
    const dist = dir.length();
    if (dist < 1e-4) return true;
    dir.divideScalar(dist);
    const coverT = this.physics.rayCover(eye, dir, dist);
    if (coverT >= 0 && coverT < dist - 0.3) return false;
    const terrainT = this.physics.rayTerrain(eye, dir, dist);
    if (terrainT >= 0 && terrainT < dist - 0.3) return false;
    return true;
  }

  /** Pick a point on the far side of a nearby obstacle from the threat.
   *  Decision-time only (called on low HP, never per frame); candidates must
   *  be free of other obstacles and genuinely occluded from the threat. */
  private findCover(threat: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const o of this.world.obstacles) {
      const fromBot = Math.hypot(o.x - this.position.x, o.z - this.position.z);
      if (fromBot > CONFIG.bot.coverRadius || fromBot < 0.5) continue;
      const ax = o.x - threat.x;
      const az = o.z - threat.z;
      const al = Math.hypot(ax, az) || 1;
      const cx = o.x + (ax / al) * (o.r + this.radius + 0.6);
      const cz = o.z + (az / al) * (o.r + this.radius + 0.6);
      // Reject candidates embedded in another obstacle.
      if (
        this.world.obstacles.some(
          (q) => Math.hypot(q.x - cx, q.z - cz) < q.r + this.radius
        )
      ) {
        continue;
      }
      // The obstacle must actually block the threat's view of the candidate.
      const from = threat.clone();
      from.y += 1.5;
      const to = new THREE.Vector3(cx, this.position.y + 1.4, cz);
      const dir = to.clone().sub(from);
      const len = dir.length();
      dir.divideScalar(len);
      const block = this.physics.rayCover(from, dir, len);
      if (block < 0 || block >= len - 0.3) continue;
      const score = Math.hypot(cx - this.position.x, cz - this.position.z);
      if (score < bestScore) {
        bestScore = score;
        best = new THREE.Vector3(cx, 0, cz);
      }
    }
    return best;
  }

  /** Navigation repair: when the bot makes no progress for stallTime it
   *  abandons the current goal and picks a fresh route (search → patrol). */
  private detectStall(dt: number): boolean {
    this.stallT += dt;
    if (this.position.distanceTo(this.progressAt) > CONFIG.bot.stallDist) {
      this.progressAt.copy(this.position);
      this.stallT = 0;
      return false;
    }
    if (this.stallT > CONFIG.bot.stallTime) {
      this.stallT = 0;
      this.progressAt.copy(this.position);
      return true;
    }
    return false;
  }

  /**
   * Runs the AI. Returns a shot descriptor when the bot fires this frame.
   */
  update(
    dt: number,
    player: Player,
    zoneCenter: THREE.Vector3,
    zoneRadius: number
  ): BotShot | null {
    if (!this.alive) {
      // Topple over once.
      if (this.deathT < 0.5) {
        this.deathT += dt;
        this.parts.group.rotation.z = -Math.min(1, this.deathT * 2.5) * (Math.PI / 2);
      }
      return null;
    }

    this.aiTime += dt;
    this.reactT = Math.max(0, this.reactT - dt);
    this.coverCdT = Math.max(0, this.coverCdT - dt);

    const toPlayer = new THREE.Vector3(
      player.position.x - this.position.x,
      0,
      player.position.z - this.position.z
    );
    const dist = toPlayer.length();
    const canSee =
      player.alive && dist < CONFIG.bot.sightRange && this.hasLineOfSight(player.position);

    let shot: BotShot | null = null;
    let moveX = 0;
    let moveZ = 0;

    /* --- perception → state transitions --- */
    if (canSee) {
      // Cover is a committed retreat: keep refreshing last-known data, but
      // do not let a fresh sighting cancel the retreat before its timer ends.
      const fresh = this.state !== "engage" && this.state !== "cover";
      this.lastSeen.copy(player.position);
      this.lastSeenT = this.aiTime;
      if (fresh) {
        // Reaction delay on every fresh acquisition; no instant snap fire.
        this.state = "engage";
        this.reactT = this.rng.range(CONFIG.bot.reactMin, CONFIG.bot.reactMax);
        this.burstLeft = 0;
      }
    } else if (this.state === "engage") {
      this.state = "search";
    }

    // Wounded bots with live contact break off to cover when a valid
    // occluded retreat point exists nearby.
    if (
      canSee &&
      this.state === "engage" &&
      this.coverCdT <= 0 &&
      this.hp / CONFIG.bot.maxHp < CONFIG.bot.coverHpFrac
    ) {
      const cover = this.findCover(player.position);
      if (cover) {
        this.state = "cover";
        this.coverPoint.copy(cover);
        this.coverT = CONFIG.bot.coverTime;
        this.coverCdT = CONFIG.bot.coverTime + CONFIG.bot.memoryTime;
      }
    }

    // Stay inside the safe zone: waypoint bias toward circle center.
    const distCenter = Math.hypot(
      this.position.x - zoneCenter.x,
      this.position.z - zoneCenter.z
    );
    const outside = distCenter > zoneRadius - 3;

    if (this.state === "engage" && canSee) {
      const dir = toPlayer.clone().normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);

      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafe *= -1;
        this.strafeT = this.rng.range(0.8, 1.8);
      }
      if (dist > 14) {
        moveX = dir.x;
        moveZ = dir.z;
      } else if (dist < 8) {
        moveX = -dir.x;
        moveZ = -dir.z;
      } else {
        moveX = -dir.z * this.strafe;
        moveZ = dir.x * this.strafe;
      }

      /* --- burst firing (gated by reaction time) --- */
      if (this.reactT <= 0) {
        this.fireT -= dt;
        if (this.burstLeft > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burstLeft--;
            this.burstT = CONFIG.bot.burstGap;
            shot = this.makeShot(player, dist);
          }
        } else if (this.fireT <= 0 && dist < CONFIG.bot.attackRange) {
          this.burstLeft = CONFIG.bot.burstShots;
          this.fireT = CONFIG.bot.fireInterval * this.rng.range(0.8, 1.4);
          this.burstT = 0;
        }
      }
    } else if (this.state === "cover") {
      const d = new THREE.Vector3(
        this.coverPoint.x - this.position.x,
        0,
        this.coverPoint.z - this.position.z
      );
      if (d.length() > 1.2) {
        // Still retreating: the hold timer starts only on arrival.
        d.normalize();
        moveX = d.x;
        moveZ = d.z;
        this.yaw = Math.atan2(-d.x, -d.z);
      } else {
        // Hold: watch the last known approach while the timer runs.
        const face = this.lastSeen.clone().sub(this.position);
        if (face.lengthSq() > 0.01) this.yaw = Math.atan2(-face.x, -face.z);
        this.coverT -= dt;
      }
      if (this.coverT <= 0) this.state = "search";
    } else {
      /* --- search (last-known position) or patrol --- */
      if (this.state === "search") {
        const memoryFresh = this.aiTime - this.lastSeenT < CONFIG.bot.memoryTime;
        const reached = this.position.distanceTo(this.lastSeen) < 1.5;
        if (!memoryFresh || reached) {
          this.state = "patrol";
          this.pickWaypoint();
        }
      }
      if (this.state === "search" && this.detectStall(dt)) {
        this.state = "patrol";
        this.pickWaypoint();
      }
      if (this.state === "search") {
        const d = this.lastSeen
          .clone()
          .sub(this.position)
          .setY(0);
        if (d.length() > 1.2) {
          d.normalize();
          moveX = d.x;
          moveZ = d.z;
          this.yaw = Math.atan2(-d.x, -d.z);
        }
      } else {
        this.waypointT -= dt;
        if (this.waypointT <= 0) this.pickWaypoint();
        if (this.detectStall(dt)) this.pickWaypoint();
        const wp = outside ? zoneCenter : this.waypoint;
        const d = new THREE.Vector3(wp.x - this.position.x, 0, wp.z - this.position.z);
        const l = d.length();
        if (l > 1.2) {
          d.multiplyScalar(1 / l);
          moveX = d.x;
          moveZ = d.z;
          this.yaw = Math.atan2(-d.x, -d.z);
        }
      }
    }

    const sp = CONFIG.bot.speed * (outside ? 1.35 : 1);
    this.collideAndMove(moveX * sp * dt, moveZ * sp * dt);
    this.applyGravity(dt);
    this.animateWalk(Math.hypot(moveX, moveZ) * sp, dt);
    return shot;
  }

  private makeShot(player: Player, dist: number): BotShot {
    const origin = this.muzzleWorld;
    const target = player.position.clone();
    target.y += 1.5;
    // Aim error grows with distance.
    const err = 0.6 + dist * 0.035;
    target.x += this.rng.range(-err, err);
    target.y += this.rng.range(-err, err) * 0.5;
    target.z += this.rng.range(-err, err);
    const dir = target.sub(origin).normalize();
    return { origin, dir };
  }

  /** Probability that one bot tracer actually damages the player. */
  hitChanceAgainst(dist: number): number {
    const base = CONFIG.bot.hitChance;
    return THREE.MathUtils.clamp(base * (1.1 - (dist / CONFIG.bot.attackRange) * 0.6), 0.05, 0.5);
  }
}
