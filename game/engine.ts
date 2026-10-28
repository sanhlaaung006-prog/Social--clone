/*
 * Engine: owns the WebGLRenderer, scene graph, game loop and every gameplay
 * system. React only reads HudSnapshot objects and writes InputState.
 */

import * as THREE from "three";
import { CONFIG } from "./config";
import { InputState, attachDesktopInput } from "./input";
import { loadNoise, type NoiseImpl } from "./wasm/noise";
import { loadPhysics, bindJsPhysicsHeight, type Physics, type RayHit } from "./wasm/physics";
import { RayService } from "./wasm/rayService";
import { Rng, BOT_CALLSIGNS } from "./rng";
import { World } from "./world";
import { Player, Bot } from "./actors";
import { CameraRig } from "./cameraRig";
import { Zone } from "./zone";
import { TracerPool, MuzzleFlash, PickupManager } from "./combat";
import { VehicleManager } from "./vehicles/manager";
import type { Vehicle, Seat } from "./vehicles/vehicle";
import { detectTier } from "./device";
import type { HudSnapshot, KillFeedEntry, MatchStatus, MinimapBlip } from "./hud";

const FOG_HEX = CONFIG.world.fogColor;

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}

export class Engine {
  readonly input = new InputState();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private clock = new THREE.Clock();
  private raf = 0;
  private detached: (() => void) | null = null;
  private resizeObs: ResizeObserver;

  private noise!: NoiseImpl;
  private physics!: Physics;
  /** Off-thread WASM ray service; falls back to local physics when inactive. */
  private readonly rayService = new RayService();
  private world!: World;
  private player!: Player;
  private bots: Bot[] = [];
  private zone!: Zone;
  private tracers!: TracerPool;
  private flash!: MuzzleFlash;
  private pickups!: PickupManager;
  private vehicles!: VehicleManager;
  private activeVehicle: Vehicle | null = null;
  private activeSeat: Seat | null = null;
  private gunCooldown = 0;
  private nearbyVehicle: Vehicle | null = null;

  private status: MatchStatus = "menu";
  private rng = new Rng(CONFIG.seed);
  private fireCooldown = 0;
  private elapsed = 0;
  private kills = 0;
  private feed: KillFeedEntry[] = [];
  private feedId = 0;
  private hitMarkerAt = 0;
  private damageAt = 0;
  private pointerLocked = false;

  private readonly tier = detectTier();

  private constructor(private readonly container: HTMLElement) {
    this.input.touch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

    const q = CONFIG.quality[this.tier];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping gives the Standard materials soft, stylized
    // highlights instead of clipped Lambert bands.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(FOG_HEX);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    // Exponential mist fades distant jungle naturally (no hard fog plane).
    // Mobile gets denser fog so the shorter cull radius is fully hidden.
    this.scene.fog = new THREE.FogExp2(FOG_HEX, CONFIG.world.fogDensity * q.fogDensityMul);
    this.scene.background = new THREE.Color(FOG_HEX);

    this.rig = new CameraRig(
      container.clientWidth / Math.max(1, container.clientHeight)
    );
    // The FPS view-model rifle is parented to the camera, so the camera
    // itself must live in the scene graph to be rendered.
    this.scene.add(this.rig.camera);

    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(container);
  }

  static async create(container: HTMLElement): Promise<Engine> {
    const engine = new Engine(container);
    engine.noise = await loadNoise();
    engine.physics = await loadPhysics();
    bindJsPhysicsHeight((x, z) => engine.noise.terrainHeight(x, z, CONFIG.seed));
    engine.buildPermanentWorld();
    engine.physics.setObstacles(engine.world.obstacles);
    // Best-effort worker startup; RayService silently stays inactive on
    // failure and all rays then resolve on the local physics instance.
    const wasmUrl = new URL(
      `${import.meta.env.BASE_URL}wasm/math_core.wasm`,
      window.location.href
    ).href;
    await engine.rayService.init(wasmUrl);
    engine.rayService.setObstacles(engine.world.obstacles);
    engine.detached = attachDesktopInput(engine.input, engine.renderer.domElement, (locked) => {
      engine.pointerLocked = locked;
    });
    engine.clock.start();
    engine.loop();
    return engine;
  }

  /* ---------------------------- world construction ---------------------------- */

  private buildPermanentWorld() {
    this.world = new World(this.noise, this.tier);
    this.scene.add(this.world.group);

    this.player = new Player(this.world, this.physics);
    this.player.group.position.copy(this.world.randomSpawn(this.rng));
    this.scene.add(this.player.group);

    this.tracers = new TracerPool(this.scene);
    this.flash = new MuzzleFlash(this.scene);
    this.spawnMatchEntities();
  }

  private spawnMatchEntities() {
    // Bots.
    for (let i = 0; i < CONFIG.bot.count; i++) {
      const spawn = this.world.randomSpawn(this.rng);
      const name = BOT_CALLSIGNS[i % BOT_CALLSIGNS.length];
      const bot = new Bot(this.world, this.physics, `${name}-${i + 1}`, spawn, this.rng);
      this.bots.push(bot);
      this.scene.add(bot.group);
    }
    // Loot.
    this.pickups = new PickupManager(this.scene, this.world, this.world.obstacles, this.rng);
    // Vehicles (tanks + armed technicals).
    this.vehicles = new VehicleManager(this.scene, this.world, this.physics, this.rng);
    // Zone.
    this.zone = new Zone(this.scene);
  }

  private clearMatchEntities() {
    for (const b of this.bots) {
      this.scene.remove(b.group);
      disposeObject(b.group);
    }
    this.bots = [];
    for (const p of this.pickups.pickups) {
      this.scene.remove(p.group);
      disposeObject(p.group);
    }
    this.zone.dispose(this.scene);
    this.vehicles.dispose(this.scene);
  }

  /* --------------------------------- match flow -------------------------------- */

  startMatch() {
    if (this.status === "playing") return;
    if (this.status === "dead" || this.status === "won") {
      this.clearMatchEntities();
      // Reset player.
      this.player.hp = CONFIG.player.maxHp;
      this.player.alive = true;
      this.player.mag = CONFIG.weapon.magSize;
      this.player.reserve = CONFIG.weapon.reserveAmmo;
      this.player.group.position.copy(this.world.randomSpawn(this.rng));
      this.player.velocity.set(0, 0, 0);
      this.player.group.visible = true;
      this.spawnMatchEntities();
    }
    this.status = "playing";
    this.kills = 0;
    this.feed = [];
    this.elapsed = 0;
    this.fireCooldown = 0;
    this.gunCooldown = 0;
    this.activeVehicle = null;
    this.activeSeat = null;
    this.rayService.clearPending();
  }

  private endMatch(won: boolean) {
    this.status = won ? "won" : "dead";
    this.input.firing = false;
    // Do not resolve shots fired just before death into the next match.
    this.rayService.clearPending();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  /* ----------------------------------- loop ----------------------------------- */

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.world.updateAmbient(dt);

    if (this.status === "playing") {
      this.updatePlaying(dt);
    } else if (this.status === "menu") {
      this.rig.orbit(this.elapsed, new THREE.Vector3(0, 0, 0), 26);
      this.tracers.update(dt);
      this.flash.update(dt);
    } else {
      // Death / victory screen: keep the world alive behind the overlay.
      this.rig.update(dt, this.player, this.world, false);
      this.tracers.update(dt);
      this.flash.update(dt);
    }

    // Per-instance frustum/distance culling before the health-bar billboards.
    this.world.updateCulling(this.rig.camera);

    // Billboard every actor health bar.
    for (const b of this.bots) b.updateHealthBar(this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
  };

  private updatePlaying(dt: number) {
    // Resolve off-thread ray results from previous frames before new shots.
    this.rayService.drain();
    // Flush smoothed touch-look into the shared accumulator first, so both
    // the on-foot player and the vehicle turret read the same per-frame delta.
    this.input.pumpTouchLook(dt);
    this.fireCooldown -= dt;
    this.gunCooldown -= dt;

    if (this.activeVehicle) {
      this.updateInVehicle(dt);
    } else {
      this.updateOnFoot(dt);
    }
    this.input.resetTransient();
    this.syncActorCylinders();
    // Mirror vehicle volumes to the worker for its own sphere tests.
    this.rayService.setVehicles(
      this.vehicles.vehicles.map((v) => ({
        x: v.position.x,
        y: v.position.y,
        z: v.position.z,
        r: v.radius,
      }))
    );

    // --- bots ---
    for (const bot of this.bots) {
      const shot = bot.update(dt, this.player, this.zone.center, this.zone.radius);
      if (shot) this.resolveBotShot(bot, shot);
      if (bot.alive && !this.zone.isInside(bot.position.x, bot.position.z)) {
        const died = bot.applyDamage(this.zone.damagePerSecond * dt);
        if (died) this.pushFeed(`${bot.callsign} was claimed by the zone`);
      }
    }

    // --- zone ---
    this.zone.update(dt);
    if (this.player.alive && !this.zone.isInside(this.player.position.x, this.player.position.z)) {
      this.player.hp = Math.max(0, this.player.hp - this.zone.damagePerSecond * dt);
      this.damageAt = this.elapsed;
      if (this.player.hp <= 0) {
        this.player.alive = false;
        this.pushFeed("The zone claimed you");
        this.endMatch(false);
      }
    }

    // --- cosmetics ---
    this.tracers.update(dt);
    this.flash.update(dt);
    this.pickups.update(dt, this.elapsed);

    // --- win condition (only if the player is still alive this frame) ---
    if (this.status === "playing" && this.player.alive && this.bots.every((b) => !b.alive)) {
      this.endMatch(true);
    }
  }

  /* ------------------------------ vehicle flow ------------------------------- */

  private updateOnFoot(dt: number) {
    // --- player ---
    this.player.update(dt, this.input);
    this.world.updateSunTarget(this.player.position.x, this.player.position.z);
    this.rig.update(dt, this.player, this.world, this.input.aiming);

    // Vehicles roll/idle and stay synced as physics obstacles.
    this.vehicles.update(dt, null, this.physics, this.world);

    // Enter prompt + enter action.
    this.nearbyVehicle = this.vehicles.nearestEnterable(this.player.position);
    if (this.input.enterQueued && this.nearbyVehicle) {
      this.enterVehicle(this.nearbyVehicle, "driver");
    }

    this.handlePlayerShooting();
    this.handlePickups();
  }

  private updateInVehicle(dt: number) {
    const vehicle = this.activeVehicle!;

    // Look input aims the turret/camera independently of the hull.
    const look = this.input.consumeLook();
    vehicle.applyLook(look.dx, look.dy, this.input.touch);

    // Seat controls.
    if (this.input.exitQueued) this.exitVehicle();
    if (this.input.swapQueued && vehicle.occupied) {
      const next: Seat = vehicle.occupied === "driver" ? "passenger" : "driver";
      vehicle.occupied = next;
      this.activeSeat = next;
    }

    // Driving (the manager only feeds input to the occupied vehicle).
    this.vehicles.update(dt, this.input, this.physics, this.world);

    // Keep the hidden player glued to the vehicle for zone/minimap logic.
    this.player.position.copy(vehicle.position);
    this.world.updateSunTarget(vehicle.position.x, vehicle.position.z);
    this.rig.followTarget(
      dt,
      vehicle.position,
      vehicle.aimYaw,
      vehicle.aimPitch,
      this.world,
      CONFIG.vehicles.cameraDist,
      CONFIG.vehicles.cameraHeight
    );

    // Technical passenger operates the mounted machine gun.
    if (vehicle.hasGun && this.activeSeat === "passenger") {
      this.handleVehicleGun(vehicle);
    }
  }

  private enterVehicle(vehicle: Vehicle, seat: Seat) {
    if (vehicle.occupied) return;
    vehicle.occupied = seat;
    this.activeVehicle = vehicle;
    this.activeSeat = seat;
    this.player.group.visible = false;
    this.input.firing = false;
    this.pushFeed(`You boarded the ${vehicle.label} as ${seat}`);
  }

  private exitVehicle() {
    const vehicle = this.activeVehicle;
    if (!vehicle) return;

    // Place the player beside the hull, clear of its collision radius.
    const side = new THREE.Vector3(Math.cos(vehicle.yaw), 0, -Math.sin(vehicle.yaw));
    const px = vehicle.position.x + side.x * (vehicle.radius + 1.2);
    const pz = vehicle.position.z + side.z * (vehicle.radius + 1.2);
    this.player.position.set(px, this.world.heightAt(px, pz), pz);
    this.player.yaw = vehicle.yaw;
    this.player.velocity.set(0, 0, 0);
    this.player.group.visible = true;

    vehicle.occupied = null;
    this.activeVehicle = null;
    this.activeSeat = null;
    this.input.firing = false;
  }

  private handleVehicleGun(vehicle: Vehicle) {
    if (!this.input.firing || this.gunCooldown > 0) return;
    this.gunCooldown = CONFIG.vehicles.fireInterval;

    const origin = vehicle.muzzleWorld(new THREE.Vector3());
    const dir = this.rig.getForward(new THREE.Vector3());
    const vehicleIndex = this.vehicles.indexOf(vehicle);
    const aliveBots = this.aliveBotCylinders();
    this.flash.flash(origin);

    this.dispatchRay(origin, dir, CONFIG.vehicles.gunRange, vehicleIndex, (hit) => {
      const endPoint = hit
        ? origin.clone().addScaledVector(dir, hit.t)
        : origin.clone().addScaledVector(dir, CONFIG.vehicles.gunRange);

      if (hit?.kind === "actor" && hit.actorIndex !== undefined) {
        const target = aliveBots[hit.actorIndex];
        if (target) {
          const died = target.applyDamage(CONFIG.vehicles.gunDamage);
          this.hitMarkerAt = this.elapsed;
          if (died) {
            this.kills++;
            this.pushFeed(`Mounted gun eliminated ${target.callsign}`);
          }
        }
      }

      this.tracers.spawn(origin, endPoint, 0xffb347);
    });
  }

  /* --------------------------------- shooting --------------------------------- */

  /** Upload alive bots as physics hit cylinders for this frame's raycasts. */
  private syncActorCylinders() {
    const actors = this.bots
      .filter((b) => b.alive)
      .map((b) => ({
        x: b.position.x,
        y: b.position.y,
        z: b.position.z,
        r: b.radius,
        h: CONFIG.player.height,
      }));
    this.physics.setActors(actors);
    this.rayService.setActors(actors);
  }

  /** Alive-bot snapshot in the stable index order ray results refer to. */
  private aliveBotCylinders() {
    return this.bots.filter((b) => b.alive);
  }

  /**
   * Run a ray on the worker when available, else synchronously on the
   * local physics core. The callback receives the same RayHit shape either
   * way; worker results arrive one frame later through RayService.drain().
   */
  private dispatchRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxT: number,
    skipVehicle: number,
    onHit: (hit: RayHit | null) => void
  ) {
    const offloaded = this.rayService.request(
      [origin.x, origin.y, origin.z],
      [dir.x, dir.y, dir.z],
      maxT,
      skipVehicle,
      onHit
    );
    if (!offloaded) onHit(this.physics.raycast(origin, dir, maxT, skipVehicle));
  }

  private handlePlayerShooting() {
    if (!this.input.firing || !this.player.alive) return;
    if (!this.player.consumeShot(this.fireCooldown)) {
      if (this.player.mag === 0 && this.player.reserve === 0) this.input.firing = false;
      return;
    }
    this.fireCooldown = CONFIG.weapon.fireInterval;

    const origin = this.rig.camera.position.clone();
    const dir = this.rig.getForward(new THREE.Vector3());
    const s = CONFIG.weapon.spread;
    dir.x += (this.rng.next() - 0.5) * 2 * s;
    dir.y += (this.rng.next() - 0.5) * 2 * s;
    dir.z += (this.rng.next() - 0.5) * 2 * s;
    dir.normalize();

    // Ray tests run on the physics worker when available (heightfield
    // raymarch off the main thread), else the identical local core.
    const aliveBots = this.aliveBotCylinders();
    const muzzle = this.player.muzzleWorld; // capture now; deferred callback
    this.flash.flash(muzzle);

    this.dispatchRay(origin, dir, CONFIG.weapon.range, -1, (hit) => {
      const endPoint = hit
        ? origin.clone().addScaledVector(dir, hit.t)
        : origin.clone().addScaledVector(dir, CONFIG.weapon.range);

      if (hit?.kind === "actor" && hit.actorIndex !== undefined) {
        const target = aliveBots[hit.actorIndex];
        if (target) {
          const died = target.applyDamage(CONFIG.weapon.damage);
          this.hitMarkerAt = this.elapsed;
          if (died) {
            this.kills++;
            this.pushFeed(`You eliminated ${target.callsign}`);
          }
        }
      }

      this.tracers.spawn(muzzle, endPoint, 0xffe2a1);
    });
  }

  private resolveBotShot(bot: Bot, shot: { origin: THREE.Vector3; dir: THREE.Vector3 }) {
    if (!this.player.alive) return;

    const dist = Math.hypot(
      bot.position.x - this.player.position.x,
      bot.position.z - this.player.position.z
    );

    // Cover check: terrain, trees, rocks and huts can block bot fire.
    // Runs on the physics worker when available (result resolves next
    // frame); clone the shot vectors since the bot reuses its allocations.
    const origin = shot.origin.clone();
    const dir = shot.dir.clone();
    const callsign = bot.callsign;
    this.dispatchRay(origin, dir, dist, -1, (blocker) => {
      const end = blocker
        ? origin.clone().addScaledVector(dir, blocker.t)
        : origin.clone().addScaledVector(dir, CONFIG.weapon.range);
      this.tracers.spawn(origin, end, 0xff7a5c);
      if (blocker) return;
      if (!this.player.alive) return;

      if (this.rng.next() < bot.hitChanceAgainst(dist)) {
        const died = this.player.applyDamage(CONFIG.bot.burstDamage);
        this.damageAt = this.elapsed;
        if (died) {
          this.pushFeed(`${callsign} eliminated you`);
          this.endMatch(false);
        }
      }
    });
  }

  /* ---------------------------------- pickups --------------------------------- */

  private handlePickups() {
    const kind = this.pickups.collectNearby(this.player.position);
    if (kind === "medkit") this.player.heal(CONFIG.pickups.medkitHeal);
    if (kind === "ammo") this.player.addAmmo(CONFIG.pickups.ammoPerCrate);
  }

  private pushFeed(text: string) {
    this.feed.push({ id: ++this.feedId, text });
    if (this.feed.length > 5) this.feed.shift();
  }

  /* ---------------------------------- HUD ---------------------------------- */

  getHud(): HudSnapshot {
    const aliveBots = this.bots.filter((b) => b.alive).length;
    const playerAlive = this.player.alive ? 1 : 0;
    const blips: MinimapBlip[] = this.bots
      .filter((b) => b.alive)
      .map((b) => ({ x: b.position.x, z: b.position.z, kind: "bot" as const }));
    for (const p of this.pickups?.pickups ?? []) {
      if (p.active) blips.push({ x: p.group.position.x, z: p.group.position.z, kind: "pickup" });
    }
    for (const v of this.vehicles?.vehicles ?? []) {
      blips.push({ x: v.position.x, z: v.position.z, kind: "vehicle" });
    }

    return {
      status: this.status,
      hp: Math.round(this.player?.hp ?? 0),
      maxHp: CONFIG.player.maxHp,
      mag: this.player?.mag ?? 0,
      magSize: CONFIG.weapon.magSize,
      reserve: this.player?.reserve ?? 0,
      reloading: this.player?.isReloading ?? false,
      kills: this.kills,
      alive: aliveBots + playerAlive,
      placement: aliveBots + 1,
      zonePhase: Math.min((this.zone?.phaseIndex ?? 0) + 1, CONFIG.zone.phases.length),
      zonePhases: CONFIG.zone.phases.length,
      zoneTimer: this.zone?.countdown ?? 0,
      zoneState: this.zone?.state ?? "waiting",
      outsideZone: this.zone ? !this.zone.isInside(this.player.position.x, this.player.position.z) : false,
      hitMarkerAt: this.hitMarkerAt,
      damageAt: this.damageAt,
      killFeed: [...this.feed],
      wasmReady: this.noise?.wasm ?? false,
      pointerLocked: this.pointerLocked,
      player: {
        x: this.player?.position.x ?? 0,
        z: this.player?.position.z ?? 0,
        yaw: this.player?.yaw ?? 0,
      },
      zone: {
        x: this.zone?.center.x ?? 0,
        z: this.zone?.center.z ?? 0,
        r: this.zone?.radius ?? 100,
      },
      blips,
      inVehicle: this.activeVehicle !== null,
      vehicleKind: this.activeVehicle?.kind ?? null,
      vehicleSeat: this.activeSeat,
      canEnterVehicle: !this.activeVehicle && this.nearbyVehicle !== null,
      nearbyVehicleLabel: this.nearbyVehicle?.label ?? null,
      gunnerActive:
        this.activeVehicle?.hasGun === true && this.activeSeat === "passenger",
    };
  }

  /* --------------------------------- plumbing --------------------------------- */

  private onResize() {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
  }

  // Local type alias removed — CameraRig is imported at the top.

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.detached?.();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
