/*
 * City walking support: composes the terraced city surfaces with the
 * natural terrain height sampler and applies AABB push-out collision
 * against every planned building, wall and bastion. Pure and
 * deterministic — no three.js, DOM or clock state — so the same rules
 * run headlessly in tests and in the live first-person loop.
 */

import { groundHeight } from "../terrain/myanmarMap";
import {
  citySurfaceY,
  resolveCityCollision,
  type CityPlan
} from "./layout";

/** Player capsule radius used for city collision, metres. */
export const CITY_PLAYER_RADIUS = 0.55;
/** Curbs/terrace lips up to this height are mounted without jumping. */
export const CITY_STEP_UP = 1.6;

/**
 * Ground sampler for the first-person controller: a terraced city
 * surface wins where one exists, otherwise the natural merged field.
 */
export function createCityGroundSampler(plan: CityPlan): (x: number, z: number) => number {
  return (x: number, z: number): number => citySurfaceY(plan, x, z) ?? groundHeight(x, z);
}

export interface CityWalkResolve {
  /** True when the player contacted a solid collider this frame. */
  blocked: boolean;
  /** True when the player is standing inside the city footprint. */
  inCity: boolean;
}

/**
 * Push the player out of any city collider after a locomotion step.
 * Mutates state.x/state.z in place and kills horizontal velocity on
 * impact so walls feel solid instead of sticky-slidey.
 */
export function resolveCityWalk(
  plan: CityPlan,
  state: { x: number; z: number; vx: number; vz: number }
): CityWalkResolve {
  const before = resolveCityCollision(plan, state.x, state.z, CITY_PLAYER_RADIUS);
  if (before.blocked) {
    state.x = before.x;
    state.z = before.z;
    state.vx = 0;
    state.vz = 0;
  }
  return {
    blocked: before.blocked,
    inCity:
      Math.abs(state.x - plan.center.x) <= plan.footprint &&
      Math.abs(state.z - plan.center.z) <= plan.footprint
  };
}
