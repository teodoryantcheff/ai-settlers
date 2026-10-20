import type { Building, BuildingSpec, BuildingType } from '../types.ts';
import { territoryClaimRadius } from './colony-rules.ts';
import { workArea } from './work-area.ts';

/** Circular discovery covers the complete work geometry, including offset planting. */
export function discoveryRadius(
  world: { BSPEC: Readonly<Record<BuildingType, BuildingSpec>>; buildings: readonly Building[] },
  b: Pick<Building, 'type' | 'x' | 'y' | 'manned'>,
) {
  const spec = world.BSPEC[b.type];
  const claim = b.type === 'well' ? 0 : territoryClaimRadius(spec, b.manned);
  const area = workArea(world, b.type, b);
  const work = area
    ? Math.hypot(area.x - b.x, area.y - b.y) + area.r * (area.shape === 'disc' ? 1 : Math.SQRT2)
    : b.type === 'well'
      ? spec.rad || 0
      : 0;
  return claim || work ? Math.max(claim, work) + 2 : 4;
}

/** Shared clipped area for live discovery, save validation and planning. */
export function visitDiscovery(
  world: {
    W: number;
    H: number;
    BSPEC: Readonly<Record<BuildingType, BuildingSpec>>;
    buildings: readonly Building[];
  },
  b: Pick<Building, 'type' | 'x' | 'y' | 'manned'>,
  visit: (i: number) => void,
) {
  const r = discoveryRadius(world, b);
  for (let y = Math.max(0, Math.ceil(b.y - r)); y <= Math.min(world.H - 1, b.y + r); y++)
    for (let x = Math.max(0, Math.ceil(b.x - r)); x <= Math.min(world.W - 1, b.x + r); x++)
      if ((x - b.x) ** 2 + (y - b.y) ** 2 <= r * r) visit(y * world.W + x);
}
