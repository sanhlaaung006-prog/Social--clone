// Reusable aircraft damage + performance model.
//
// This module intentionally knows nothing about Three.js meshes or the
// Warthog's authored geometry. A flyable airframe supplies stable
// component IDs (the supplied A-10 pack already publishes these through
// userData.partId), plus model-specific weapon/engine configuration.
// The same component health and derived-performance rules can therefore
// drive another jet, helicopter or prop aircraft without duplicating the
// damage, fire, advisory or HUD-diagram logic.

export const AIRCRAFT_COMPONENTS = Object.freeze([
  Object.freeze({ id: "fuselage", label: "FUSELAGE", short: "FUSE", maxHealth: 260, gunArmor: 0.82 }),
  Object.freeze({ id: "canopy", label: "COCKPIT", short: "CKPT", maxHealth: 150, gunArmor: 0.45 }),
  Object.freeze({ id: "wing-port", label: "PORT WING", short: "WING P", maxHealth: 170, gunArmor: 0.9 }),
  Object.freeze({ id: "wing-starboard", label: "STARBOARD WING", short: "WING S", maxHealth: 170, gunArmor: 0.9 }),
  Object.freeze({ id: "engine-port", label: "PORT ENGINE", short: "ENG P", maxHealth: 135, gunArmor: 0.85 }),
  Object.freeze({ id: "engine-starboard", label: "STARBOARD ENGINE", short: "ENG S", maxHealth: 135, gunArmor: 0.85 }),
  Object.freeze({ id: "empennage", label: "TAIL", short: "TAIL", maxHealth: 155, gunArmor: 0.9 }),
  Object.freeze({ id: "gun", label: "FORWARD GUN", short: "GUN", maxHealth: 95, gunArmor: 0.8 }),
  Object.freeze({ id: "stores", label: "STORES / LAUNCHERS", short: "STORES", maxHealth: 95, gunArmor: 1 }),
  Object.freeze({ id: "gear", label: "LANDING GEAR", short: "GEAR", maxHealth: 115, gunArmor: 0.9 }),
]);

export const AIRCRAFT_COMPONENT_MAP = Object.freeze(Object.fromEntries(
  AIRCRAFT_COMPONENTS.map((component) => [component.id, component]),
));

const PART_ALIASES = Object.freeze({
  cockpit: "canopy",
  canopy: "canopy",
  tail: "empennage",
  empennage: "empennage",
  "left-wing": "wing-port",
  "right-wing": "wing-starboard",
  "engine-left": "engine-port",
  "engine-right": "engine-starboard",
  landingGear: "gear",
  landing_gear: "gear",
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function normalizeAircraftPartId(partId) {
  const raw = String(partId || "fuselage");
  return PART_ALIASES[raw] || (AIRCRAFT_COMPONENT_MAP[raw] ? raw : "fuselage");
}

export function createAircraftComponents(overrides = {}) {
  const components = {};
  for (const component of AIRCRAFT_COMPONENTS) {
    const requested = overrides[component.id];
    components[component.id] = requested == null
      ? component.maxHealth
      : Math.max(0, Math.min(component.maxHealth, requested));
  }
  return components;
}

export function aircraftComponentPct(components, partId) {
  const id = normalizeAircraftPartId(partId);
  const component = AIRCRAFT_COMPONENT_MAP[id];
  return clamp01((components?.[id] ?? component.maxHealth) / component.maxHealth);
}

export function aircraftComponentState(pct) {
  if (pct <= 0) return "destroyed";
  if (pct <= 0.18) return "critical";
  if (pct <= 0.42) return "heavy";
  if (pct <= 0.72) return "damaged";
  return "intact";
}

export function aircraftComponentColor(pct) {
  if (pct <= 0) return "#2b1114";
  if (pct <= 0.18) return "#e23b2e";
  if (pct <= 0.42) return "#f07818";
  if (pct <= 0.72) return "#f2c230";
  return "#5fd66c";
}

// Guns, cannon, missiles, rockets, bombs, artillery and collisions all
// enter through this one door. Armor only attenuates small-arms style
// impacts; explosive and kinetic structural loads are not magically
// reduced by the cockpit's armored tub.
export function damageAircraftComponent(components, partId, amount, source = "gun") {
  const id = normalizeAircraftPartId(partId);
  const component = AIRCRAFT_COMPONENT_MAP[id];
  const before = Math.max(0, components[id] ?? component.maxHealth);
  const sourceKey = String(source || "gun").toLowerCase();
  const gunLike = sourceKey === "gun" || sourceKey === "bullet" || sourceKey === "small-arms";
  const scaled = Math.max(0, Number(amount) || 0) * (gunLike ? component.gunArmor : 1);
  const after = Math.max(0, before - scaled);
  components[id] = after;
  const pct = after / component.maxHealth;
  return {
    id,
    label: component.label,
    before,
    after,
    applied: before - after,
    pct,
    state: aircraftComponentState(pct),
    destroyedNow: before > 0 && after <= 0,
  };
}

export function deriveAircraftPerformance(components) {
  const fuselage = aircraftComponentPct(components, "fuselage");
  const cockpit = aircraftComponentPct(components, "canopy");
  const wingPort = aircraftComponentPct(components, "wing-port");
  const wingStarboard = aircraftComponentPct(components, "wing-starboard");
  const enginePort = aircraftComponentPct(components, "engine-port");
  const engineStarboard = aircraftComponentPct(components, "engine-starboard");
  const tail = aircraftComponentPct(components, "empennage");
  const gear = aircraftComponentPct(components, "gear");
  const gun = aircraftComponentPct(components, "gun");
  const stores = aircraftComponentPct(components, "stores");
  const wingAverage = (wingPort + wingStarboard) * 0.5;
  const engineAverage = (enginePort + engineStarboard) * 0.5;

  return {
    // A missing wing still leaves the centre-section/fuselage producing a
    // little lift, but not enough for sustainable level flight.
    liftFactor: 0.06 + 0.94 * (wingAverage * 0.76 + fuselage * 0.24),
    thrustFactor: engineAverage,
    pitchAuthority: 0.08 + 0.92 * tail,
    rollAuthority: 0.07 + 0.93 * wingAverage,
    dragBonus:
      (1 - wingAverage) * 0.055 +
      (1 - fuselage) * 0.045 +
      (1 - engineAverage) * 0.018 +
      (1 - gear) * 0.012,
    // Positive means an uncommanded roll toward the more damaged wing.
    asymmetricRoll: (wingStarboard - wingPort) * 0.62,
    // Single-engine yaw moment. The sign is interpreted by the flight
    // model's own yaw convention.
    asymmetricYaw: (engineStarboard - enginePort) * 0.16,
    gearFactor: gear,
    cockpitFactor: cockpit,
    gunOperational: gun > 0,
    storesOperational: stores > 0,
    engineFire: enginePort > 0 && enginePort < 0.34 || engineStarboard > 0 && engineStarboard < 0.34,
    fuselageFire: fuselage > 0 && fuselage < 0.28,
    catastrophic:
      fuselage <= 0 ||
      (wingPort <= 0 && wingStarboard <= 0) ||
      (enginePort <= 0 && engineStarboard <= 0 && fuselage < 0.35),
    percentages: {
      fuselage,
      canopy: cockpit,
      "wing-port": wingPort,
      "wing-starboard": wingStarboard,
      "engine-port": enginePort,
      "engine-starboard": engineStarboard,
      empennage: tail,
      gun,
      stores,
      gear,
    },
  };
}

export function aircraftKineticEnergyMJ(massKg, speedMps) {
  return 0.5 * Math.max(0, massKg) * Math.max(0, speedMps) ** 2 / 1_000_000;
}

// Structural collision damage scales with the energy that has to go
// somewhere. A slow taxi brush bends metal; a fast wing strike removes
// the wing. The flight model adds orientation/load-path multipliers.
export function collisionDamageFromEnergy(kineticEnergyMJ, closingSpeedMps = 0) {
  const energyTerm = Math.sqrt(Math.max(0, kineticEnergyMJ)) * 13;
  const speedTerm = Math.max(0, closingSpeedMps) * 0.55;
  return Math.max(0, Math.min(320, energyTerm + speedTerm));
}

export function aircraftAdvisoryFor(snapshot = {}) {
  if (snapshot.exploded) return { level: "warning", text: "AIRCRAFT DESTROYED" };
  if (snapshot.ejectAdvised) return { level: "warning", text: "EJECT · EJECT · EJECT" };
  if (snapshot.engineFire) return { level: "warning", text: "ENGINE FIRE — LAND OR EJECT" };
  if (snapshot.fuselageFire) return { level: "warning", text: "FIRE WARNING — EJECT IF UNCONTROLLED" };
  if (snapshot.stall) return { level: "warning", text: "STALL — LOWER NOSE · ADD POWER" };
  if (snapshot.airborne && snapshot.altitudeAgl < 55 && snapshot.verticalSpeed < -9) {
    return { level: "warning", text: "PULL UP · TERRAIN" };
  }
  if (snapshot.worstComponentPct != null && snapshot.worstComponentPct <= 0.35) {
    return { level: "caution", text: `${snapshot.worstComponentLabel || "AIRFRAME"} CRITICAL` };
  }
  if (!snapshot.airborne && snapshot.speed > 48 && snapshot.speed < 72) {
    return { level: "command", text: "ROTATE" };
  }
  if (snapshot.airborne && snapshot.altitudeAgl < 35 && snapshot.verticalSpeed < -3.5) {
    return { level: "command", text: "GEAR DOWN · CHECK SINK RATE" };
  }
  if (snapshot.missileAway) return { level: "command", text: "FOX TWO — MISSILE AWAY" };
  if (snapshot.gunAmmo === 0 && snapshot.hasGun) return { level: "caution", text: "WINCHESTER — GUN EMPTY" };
  if (snapshot.airborne) return { level: "info", text: "AIRBORNE · SYSTEMS NOMINAL" };
  if (snapshot.speed > 1) return { level: "info", text: "TAXI · WATCH WINGTIPS" };
  return { level: "info", text: "ENGINE READY · SET THRUST" };
}

export function worstAircraftComponent(components) {
  let worst = AIRCRAFT_COMPONENTS[0];
  let worstPct = 1;
  for (const component of AIRCRAFT_COMPONENTS) {
    const pct = aircraftComponentPct(components, component.id);
    if (pct < worstPct) {
      worst = component;
      worstPct = pct;
    }
  }
  return { ...worst, pct: worstPct, state: aircraftComponentState(worstPct) };
}
