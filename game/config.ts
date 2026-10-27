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
    treeCount: 140,
    rockCount: 70,
    hutCount: 7,
    pickupCount: 16,
  },

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
} as const;

export interface PhaseSpec {
  delay: number; // seconds to wait before shrinking
  shrink: number; // seconds the shrink takes
  from: number;
  to: number;
  dmg: number; // hp per second outside the circle
}
