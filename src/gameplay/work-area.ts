import type { Building, BuildingSpec, BuildingType, Tile } from '../types.ts';

/**
 * Natural-resource work areas shared by production and the placement preview.
 * Each rule is a pure query over the live colony: it consumes no RNG and
 * mutates nothing, so the preview highlights exactly the tiles a worker uses.
 */
export interface WorkAreaWorld {
  tiles: readonly Tile[];
  owned: ArrayLike<number>;
  buildings: readonly Building[];
  BSPEC: Readonly<Record<BuildingType, BuildingSpec>>;
  DX: readonly number[];
  DY: readonly number[];
  GRASS: number;
  WATER: number;
  MTN: number;
  inB: (x: number, y: number) => boolean;
  idx: (x: number, y: number) => number;
  buildingAt: (x: number, y: number) => Building | null | undefined;
}

export type WorkKind = 'gather' | 'rock' | 'fish' | 'mine' | 'plant';

/**
 * Tiles scanned around a centre: a disc of radius `r`, a square of half-width
 * `r` (both row-major), or the eight neighbours in direction order.
 */
export interface WorkArea {
  kind: WorkKind;
  x: number;
  y: number;
  r: number;
  shape: 'disc' | 'square' | 'neighbours';
}

/** A forester replants inside this radius of its nearest finished lumberjack. */
export const replantRadius = 5;
/** Fishing reaches water within this many tiles in either direction. */
export const fishingReach = 2;

type Site = Pick<Building, 'x' | 'y'>;

/** The finished lumberjack nearest by Manhattan distance; ties keep building order. */
export function nearestLumberjack(world: Pick<WorkAreaWorld, 'buildings'>, site: Site) {
  let closest: Building | null = null,
    dist = Infinity;
  for (const b of world.buildings) {
    if (!b.done || b.type !== 'lumberjack') continue;
    const d = Math.abs(b.x - site.x) + Math.abs(b.y - site.y);
    if (d < dist) {
      dist = d;
      closest = b;
    }
  }
  return closest;
}

/** Where a natural-resource producer of `type` at `site` works, or null for other producers. */
export function workArea(
  world: Pick<WorkAreaWorld, 'buildings' | 'BSPEC'>,
  type: BuildingType,
  site: Site,
): WorkArea | null {
  const sp = world.BSPEC[type];
  switch (sp.prod) {
    case 'gather':
    case 'rock':
      return sp.rad === undefined
        ? null
        : { kind: sp.prod, x: site.x, y: site.y, r: sp.rad, shape: 'disc' };
    case 'fish':
      return { kind: 'fish', x: site.x, y: site.y, r: fishingReach, shape: 'square' };
    case 'mine':
      return { kind: 'mine', x: site.x, y: site.y, r: 1, shape: 'neighbours' };
    case 'plant': {
      // Every planted tree must fall inside its lumberjack's chop zone; planting
      // around the forester itself can fill an unreachable crescent of its circle.
      const lumberjack = nearestLumberjack(world, site);
      if (lumberjack)
        return { kind: 'plant', x: lumberjack.x, y: lumberjack.y, r: replantRadius, shape: 'disc' };
      return sp.rad === undefined
        ? null
        : { kind: 'plant', x: site.x, y: site.y, r: sp.rad, shape: 'disc' };
    }
    default:
      return null;
  }
}

/** Visit area tiles in scan order until `visit` returns a value. */
export function scanArea<T>(
  world: Pick<WorkAreaWorld, 'DX' | 'DY' | 'inB' | 'idx'>,
  area: Pick<WorkArea, 'x' | 'y' | 'r' | 'shape'>,
  visit: (i: number, x: number, y: number) => T | undefined,
): T | undefined {
  if (area.shape === 'neighbours') {
    for (let d = 0; d < 8; d++) {
      const x = area.x + world.DX[d],
        y = area.y + world.DY[d];
      if (!world.inB(x, y)) continue;
      const found = visit(world.idx(x, y), x, y);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const r = area.r;
  for (let y = area.y - r; y <= area.y + r; y++)
    for (let x = area.x - r; x <= area.x + r; x++) {
      if (!world.inB(x, y)) continue;
      if (area.shape === 'disc' && (area.x - x) ** 2 + (area.y - y) ** 2 > r * r) continue;
      const found = visit(world.idx(x, y), x, y);
      if (found !== undefined) return found;
    }
  return undefined;
}

/** Whether tile `i` currently offers work of `kind`; `spec` names a mine's deposit. */
export function workable(
  world: WorkAreaWorld,
  kind: WorkKind,
  spec: BuildingSpec,
  i: number,
  x: number,
  y: number,
) {
  const tile = world.tiles[i];
  switch (kind) {
    case 'gather':
      return tile.tree >= 3;
    case 'rock':
      return !!tile.rock;
    case 'fish':
      return tile.t === world.WATER;
    case 'mine':
      return (
        tile.t === world.MTN &&
        !!tile.deposit &&
        tile.deposit.kind === spec.resKind &&
        tile.deposit.amt > 0
      );
    case 'plant':
      return (
        tile.t === world.GRASS &&
        !tile.tree &&
        !tile.rock &&
        !tile.road &&
        !!world.owned[i] &&
        !world.buildingAt(x, y)
      );
  }
}

/** The first workable tile in scan order that `accept` also takes, if any. */
export function findWork(
  world: WorkAreaWorld,
  type: BuildingType,
  site: Site,
  accept?: (i: number) => boolean,
) {
  const area = workArea(world, type, site);
  if (!area) return undefined;
  const spec = world.BSPEC[type];
  return scanArea(world, area, (i, x, y) =>
    workable(world, area.kind, spec, i, x, y) && (!accept || accept(i)) ? i : undefined,
  );
}

/** Every workable tile, in scan order, that a producer of `type` at `site` could use. */
export function workTiles(world: WorkAreaWorld, type: BuildingType, site: Site) {
  const area = workArea(world, type, site);
  const found: number[] = [];
  if (!area) return found;
  const spec = world.BSPEC[type];
  scanArea(world, area, (i, x, y) => {
    if (workable(world, area.kind, spec, i, x, y)) found.push(i);
    return undefined;
  });
  return found;
}
