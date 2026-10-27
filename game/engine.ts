/*
 * Engine: owns the WebGLRenderer, scene graph, game loop and every gameplay
 * system. React only reads HudSnapshot objects and writes InputState.
 */

import * as THREE from "three";
import { CONFIG } from "./config";
import { InputState, attachDesktopInput } from "./input";
import { loadNoise, type NoiseImpl } from "./wasm/noise";
import { loadPhysics, bindJsPhysicsHeight, type Physics } from "./wasm/physics";
import { Rng, BOT_CALLSIGNS } from "./rng";
import { World } from "./world";
import { Player, Bot } from "./actors";
import { CameraRig } from "./cameraRig";
import { Zone } from "./zone";
import { TracerPool, MuzzleFlash, PickupManager } from "./combat";
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
  private world!: World;
  private player!: Player;
  private bots: Bot[] = [];
  private zone!: Zone;
  private tracers!: TracerPool;
  private flash!: MuzzleFlash;
  private pickups!: PickupManager;

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

  private constructor(private readonly container: HTMLElement) {
    this.input.touch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.input.touch ? 1.6 : 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(FOG_HEX);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    this.scene.fog = new THREE.Fog(FOG_HEX, CONFIG.world.fogNear, CONFIG.world.fogFar);
    this.scene.background = new THREE.Color(FOG_HEX);

    this.rig = new CameraRig(
      container.clientWidth / Math.max(1, container.clientHeight)
    );

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
    engine.detached = attachDesktopInput(engine.input, engine.renderer.domElement, (locked) => {
      engine.pointerLocked = locked;
    });
    engine.clock.start();
    engine.loop();
    return engine;
  }

  /* ---------------------------- world construction ---------------------------- */

  private buildPermanentWorld() {
    this.world = new World(this.noise);
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
      this.spawnMatchEntities();
    }
    this.status = "playing";
    this.kills = 0;
    this.feed = [];
    this.elapsed = 0;
    this.fireCooldown = 0;
  }

  private endMatch(won: boolean) {
    this.status = won ? "won" : "dead";
    this.input.firing = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  /* ----------------------------------- loop ----------------------------------- */

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

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

    // Billboard every actor health bar.
    for (const b of this.bots) b.updateHealthBar(this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
  };

  private updatePlaying(dt: number) {
    this.fireCooldown -= dt;

    // --- player ---
    this.player.update(dt, this.input);
    this.input.resetTransient();
    this.world.updateSunTarget(this.player.position.x, this.player.position.z);
    this.rig.update(dt, this.player, this.world, this.input.aiming);

    this.handlePlayerShooting();
    this.handlePickups();
    this.syncActorCylinders();

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

  /* --------------------------------- shooting --------------------------------- */

  /** Upload alive bots as physics hit cylinders for this frame's raycasts. */
  private syncActorCylinders() {
    this.physics.setActors(
      this.bots
        .filter((b) => b.alive)
        .map((b) => ({
          x: b.position.x,
          y: b.position.y,
          z: b.position.z,
          r: b.radius,
          h: CONFIG.player.height,
        }))
    );
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

    // All ray tests (heightfield, cover spheres, actor cylinders) run in
    // the clang/WASM physics core — or the identical JS fallback.
    const aliveBots = this.bots.filter((b) => b.alive);
    this.physics.setActors(
      aliveBots.map((b) => ({
        x: b.position.x,
        y: b.position.y,
        z: b.position.z,
        r: b.radius,
        h: CONFIG.player.height,
      }))
    );
    const hit = this.physics.raycast(origin, dir, CONFIG.weapon.range);
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

    this.flash.flash(this.player.muzzleWorld);
    this.tracers.spawn(this.player.muzzleWorld, endPoint, 0xffe2a1);
  }

  private resolveBotShot(bot: Bot, shot: { origin: THREE.Vector3; dir: THREE.Vector3 }) {
    if (!this.player.alive) return;

    const dist = Math.hypot(
      bot.position.x - this.player.position.x,
      bot.position.z - this.player.position.z
    );

    // Cover check: terrain, trees, rocks and huts can block bot fire.
    const blocker = this.physics.raycast(shot.origin, shot.dir, dist);
    const end = blocker
      ? shot.origin.clone().addScaledVector(shot.dir, blocker.t)
      : shot.origin.clone().addScaledVector(shot.dir, CONFIG.weapon.range);
    this.tracers.spawn(shot.origin, end, 0xff7a5c);
    if (blocker) return;

    if (this.rng.next() < bot.hitChanceAgainst(dist)) {
      const died = this.player.applyDamage(CONFIG.bot.burstDamage);
      this.damageAt = this.elapsed;
      if (died) {
        this.pushFeed(`${bot.callsign} eliminated you`);
        this.endMatch(false);
      }
    }
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
