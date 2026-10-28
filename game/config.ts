/* Central tuning constants for the battle royale vertical slice. */

export const CONFIG = {
  seed: 20261027,

  world: {
    size: 220, // playable square edge (units)
    terrainSegments: 128, // smooth stylized heightfield resolution
    waterLevel: 0.6,
    fogColor: 0xbfd4c0,
    fogNear: 45,
    fogFar: 150,
    fogDensity: 0.0062,
    treeCount: 140,
    rockCount: 70,
    hutCount: 7,
    pickupCount: 16,
  },

  /*
   * Per-tier rendering budgets. Low = aggressive-but-clean mobile:
   * cull radii stay inside the fog envelope, so nothing visibly pops;
   * geometry density drops before pixel/shadow budgets do.
   */
  quality: {
    // Runtime render-scale governor (low tier only); see adaptiveQuality.ts.
    adaptive: {
      slowFps: 48,
      fastFps: 58,
      sustainSlow: 3,
      sustainFast: 5,
      cooldown: 6,
      minScale: 0.65,
      step: 0.1,
    },
    high: {
      terrainSegments: 128,
      waterSegments: 56,
      treeScale: 1,
      rockScale: 1,
      grassCount: 260,
      cloudCount: 14,
      shadowMapSize: 1024,
      pixelRatioCap: 2,
      fogDensityMul: 1,
      cull: { tree: 150, rock: 150, grass: 95, cloud: 320 },
    },
    low: {
      terrainSegments: 72,
      waterSegments: 32,
      treeScale: 0.6,
      rockScale: 0.6,
      grassCount: 130,
      cloudCount: 8,
      shadowMapSize: 512,
      pixelRatioCap: 1.25,
      fogDensityMul: 1.22,
      cull: { tree: 88, rock: 88, grass: 55, cloud: 260 },
    },
  } as const,

  player: {
    maxHp: 100,
    speed: 9.5,
    sprintMul: 1.45,
    accel: 14,
    jumpSpeed: 8.2,
    gravity: 22,
    radius: 0.7,
    height: 2.4,
  },

  bot: {
    count: 11,
    maxHp: 100,
    speed: 5.4,
    sightRange: 48,
    attackRange: 40,
    fireInterval: 0.85,
    burstShots: 3,
    burstGap: 0.11,
    hitChance: 0.32,
    burstDamage: 7,
    // Perception & tactics (revised from sandline-threejs-fps patterns).
    reactMin: 0.35, // reaction delay on fresh target acquisition
    reactMax: 0.8,
    memoryTime: 4, // seconds a last-seen position stays believable
    coverHpFrac: 0.4, // retreat to cover below this HP fraction
    coverTime: 2.4, // seconds to hold cover before re-acquiring
    coverRadius: 14, // how far a bot will look for a cover obstacle
    stallTime: 1.2, // no-progress seconds before a patrol/search repath
    stallDist: 0.45, // progress threshold for the stall detector
    // Utility AI selector (game/botBrain.ts).
    utility: {
      margin: 0.08, // a challenger must beat the incumbent by this score
      holdTime: 0.3, // minimum seconds before a smaller score gap can switch
      reloadLowFrac: 0.25, // safe reload becomes attractive below this mag fraction
    },
  },

  weapon: {
    magSize: 30,
    reserveAmmo: 120,
    fireInterval: 0.115, // ~520 rpm
    reloadTime: 1.7,
    damage: 26,
    range: 120,
    spread: 0.012,
    tracerLife: 0.07,
  },

  zone: {
    phases: [
      { delay: 12, shrink: 16, from: 105, to: 72, dmg: 1 },
      { delay: 10, shrink: 14, from: 72, to: 48, dmg: 2 },
      { delay: 8, shrink: 12, from: 48, to: 28, dmg: 4 },
      { delay: 8, shrink: 10, from: 28, to: 14, dmg: 7 },
      { delay: 6, shrink: 24, from: 14, to: 4, dmg: 12 },
    ] as PhaseSpec[],
  },

  pickups: {
    medkitHeal: 35,
    ammoPerCrate: 60,
    radius: 2.6,
  },

  vehicles: {
    tankCount: 2,
    technicalCount: 2,
    enterRadius: 4.5,
    maxSpeed: 13.5,
    reverseSpeed: 6,
    accel: 10,
    brake: 16,
    drag: 1.4,
    turnRate: 1.8, // rad/s at full speed
    radiusTank: 2.5,
    radiusTechnical: 2.2,
    groundOffset: 0.06,
    lookSens: 0.0032,
    cameraDist: 7.6,
    cameraHeight: 3.6,
    gunDamage: 18,
    gunRange: 90,
    fireInterval: 0.14,
  },

  flight: {
    jetCount: 1,
    warthogCount: 1,
    radius: 2.4,
    groundOffset: 1.1,
    maxSpeed: 62,
    takeoffSpeed: 18,
    stallSpeed: 15,
    throttleRate: 0.8,
    engineAccel: 24,
    dragK: 0.0062, // terminal at full throttle ~= maxSpeed
    groundFriction: 6,
    rollRate: 2.0,
    maxBank: 1.05,
    pitchRate: 1.2,
    maxPitch: 0.75,
    yawRate: 0.6,
    turnCoordinator: 1.4,
    groundSteer: 1.1,
    stallMoment: 1.1,
    gravity: 22,
    ceiling: 95,
    hardLandingVs: 12,
    cameraDist: 11,
    cameraHeight: 4.2,
  },
} as const;

export interface PhaseSpec {
  delay: number; // seconds to wait before shrinking
  shrink: number; // seconds the shrink takes
  from: number;
  to: number;
  dmg: number; // hp per second outside the circle
}
