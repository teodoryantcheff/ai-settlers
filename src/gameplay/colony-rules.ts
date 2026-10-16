import type { Building, BuildingSpec, BuildingType, Inventory } from '../types.ts';

/**
 * Colony rules shared by production, autoplay and the advisor. Each rule is a
 * pure query over the live colony: it consumes no RNG and mutates nothing.
 */
export interface ColonyRulesWorld {
  buildings: readonly Building[];
  BSPEC: Readonly<Record<BuildingType, BuildingSpec>>;
  connectedLand: (ax: number, ay: number, bx: number, by: number) => boolean;
}

/**
 * Which wells count. Planning counts wells still under construction, so it does
 * not order a second well; production needs a finished one. Paused wells count
 * for neither.
 */
export type WellCoverage = 'planned' | 'active';

type Site = Pick<Building, 'x' | 'y'>;

/** The building table's well service radius, in tiles. */
export function wellRadius(world: Pick<ColonyRulesWorld, 'BSPEC'>) {
  return world.BSPEC.well.rad ?? 0;
}

/** Whether a building is a well counted under the given meaning of coverage. */
export function countsAsWell(well: Building, coverage: WellCoverage) {
  return well.type === 'well' && !well.disabled && (coverage === 'planned' || well.done);
}

/** Whether a well at `well` reaches tile x, y: within the radius over connected land. */
export function wellReaches(world: ColonyRulesWorld, well: Site, x: number, y: number) {
  const radius = wellRadius(world);
  return (
    (well.x - x) ** 2 + (well.y - y) ** 2 <= radius ** 2 &&
    world.connectedLand(x, y, well.x, well.y)
  );
}

/** Whether a water-using producer at `site` has a counted well in range. */
export function hasWellCoverage(world: ColonyRulesWorld, site: Site, coverage: WellCoverage) {
  return world.buildings.some(
    (well) => countsAsWell(well, coverage) && wellReaches(world, well, site.x, site.y),
  );
}

/** Finished goods held at a producer before collection. */
export const productionOutputLimit = 8;

/** Colony-wide stored-stock thresholds; explicit storage targets may raise them. */
export const intermediateReserves: Readonly<Inventory> = Object.freeze({
  grain: 24,
  flour: 12,
  pigs: 12,
  iron_bars: 12,
});
export const productionReserves = Object.freeze({ beer: 12, tools: 12, weapons: 15, planks: 4 });

/** Space is reserved for the entire next batch, including a lumberjack's two logs. */
export function productionOutputBlocked(building: Pick<Building, 'stock'>, spec: BuildingSpec) {
  return !!(
    spec.out &&
    (building.stock[spec.out] || 0) + (spec.prod === 'gather' ? 2 : 1) > productionOutputLimit
  );
}
