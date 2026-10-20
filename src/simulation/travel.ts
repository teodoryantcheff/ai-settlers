/**
 * Carrier travel rules shared by unit movement and walk-time estimates. A unit
 * moves at the speed of the tile it is stepping onto.
 */

/** Movement cost of a road tile; navigation and paving estimates use the same value. */
export const ROAD_COST = 0.3;
/** Tiles per second across a tile of cost 1, before haul upgrades. */
export const BASE_CARRIER_SPEED = 2.7;
/** Each haul upgrade tier (at most three) adds this fraction of speed. */
export const HAUL_SPEED_STEP = 0.12;
export const MAX_HAUL_TIER = 3;

/** The effective haul tier for an upgrade level, clamped to the supported range. */
export function haulTier(upgrade: number | undefined) {
  return Math.min(MAX_HAUL_TIER, upgrade || 0);
}

/** Tiles per second stepping onto a tile of movement `cost` at haul upgrade `upgrade`. */
export function carrierSpeed(cost: number, upgrade: number | undefined) {
  return (BASE_CARRIER_SPEED / cost) * (1 + HAUL_SPEED_STEP * haulTier(upgrade));
}

export interface WalkWorld {
  W: number;
  moveCost: (n: number) => number;
}

/**
 * Seconds a carrier takes to walk `path` from tile (sx, sy). `paved` treats the
 * listed tiles as roads, for estimates of a road plan before it is built.
 */
export function walkSeconds(
  world: WalkWorld,
  path: readonly number[],
  sx: number,
  sy: number,
  upgrade: number | undefined,
  paved?: Readonly<Record<number, boolean>>,
) {
  let seconds = 0,
    px = sx,
    py = sy;
  for (const n of path) {
    const x = n % world.W,
      y = (n / world.W) | 0;
    const cost = paved && paved[n] ? ROAD_COST : world.moveCost(n);
    seconds += Math.hypot(x - px, y - py) / carrierSpeed(cost, upgrade);
    px = x;
    py = y;
  }
  return seconds;
}
