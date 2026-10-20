import type { EventsSubsystem } from '../core/events.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type {
  EconomySubsystem,
  PlacementChecks,
  BuildingAffordability,
} from '../simulation/economy.ts';
import type { GuardPreviewSegment, MapSubsystem } from '../simulation/map.ts';
import type { NavigationSubsystem } from '../simulation/navigation.ts';
import type { RoadsSubsystem } from '../simulation/roads.ts';
import type { SimulationStateSubsystem } from '../simulation/state.ts';
import { walkSeconds } from '../simulation/travel.ts';
import type { Building, BuildingType, Inventory, TilePoint } from '../types.ts';
import { workTiles } from './work-area.ts';
import { goodsIn } from '../core/inventory.ts';

/** Placement feedback for one building type at one site. */
export interface PlacementPreview {
  key: string;
  x: number;
  y: number;
  /** Tile indices the producer could work from this site. */
  resources: number[];
  checks: PlacementChecks;
  spending: BuildingAffordability;
  canBuild: boolean;
  operatingSupport: { ok: boolean; reason: string } | null;
  /** Current preferred route from the nearest storage. */
  path: number[] | null;
  storage: Building | null;
  /** Estimated one-way walk from storage. */
  haulSeconds: number | null;
  /** Player-facing resource and delivery estimate. */
  summary: string;
}
/** Guard-post border feedback for one site. */
export interface GuardPostPreview {
  key: string;
  x: number;
  y: number;
  /** Tile indexes the post would newly claim. */
  fill: number[];
  /** New border edges in world pixels. */
  segs: GuardPreviewSegment[];
}
/** Road plan feedback for one pair of endpoints. */
export interface RoadPreview {
  key: string;
  ok: boolean;
  reason: string;
  cost: Inventory;
  /** Current preferred route between the endpoints. */
  path: number[] | null;
  /** Clear owned tiles that become roads. */
  paved: Record<number, boolean>;
  count: number;
  /** Walk along the preview route today. */
  beforeSeconds: number;
  /** Walk along that same route after paving. */
  afterSeconds: number;
  summary: string;
}

/**
 * Read-only placement, road and guard-post predictions shared by the map, catalog and HUD.
 * Each query reuses its last answer while the world and relevant stock are
 * unchanged; it consumes no RNG and never advances or mutates the colony.
 */
export function createPreviews(game: PreviewsDependencies): PreviewsSubsystem {
  let revision = 0,
    placementCache: PlacementPreview | null = null,
    roadCache: RoadPreview | null = null,
    guardCache: GuardPostPreview | null = null;
  // Tile, territory and world replacement all change routes, reach and storage choice.
  const changed = () => revision++;
  game.gameEvents.on('tileChanged', changed);
  game.gameEvents.on('territoryChanged', changed);
  game.gameEvents.on('worldLoaded', changed);

  function worldKey() {
    let key = revision + ':' + (game.state.upgrades ? game.state.upgrades.haul || 0 : 0);
    // Completion and manning alter storage choice and territory without changing
    // the building count. These states also need to refresh a paused preview.
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i];
      key +=
        ':' +
        b.id +
        ',' +
        b.x +
        ',' +
        b.y +
        ',' +
        (b.done ? 1 : 0) +
        ',' +
        (b.manned ? 1 : 0) +
        ',' +
        (b.disabled ? 1 : 0);
    }
    return key;
  }
  function stockKey(type: BuildingType) {
    const goods = goodsIn(game.BSPEC[type].cost || {});
    let key = '';
    for (const store of game.storages())
      for (const good of goods)
        key +=
          ':' +
          store.id +
          ',' +
          good +
          ',' +
          (store.stock[good] || 0) +
          ',' +
          (store.reservedStock[good] || 0);
    for (const job of game.jobs)
      if (job.kind === 'transfer' && job.good && goods.includes(job.good))
        key += ':' + job.sourceId + ',' + job.to + ',' + job.good + ',' + job.status;
    for (const unit of game.units)
      if (unit.job?.kind === 'transfer' && unit.carry) key += ':cargo' + unit.id + ',' + unit.carry;
    return key;
  }
  // Simulation time refreshes estimates that depend on moving goods while play runs.
  const timeKey = () => Math.floor(game.state.time / 2);

  function previewPlacement(type: BuildingType, site: TilePoint): PlacementPreview {
    const key =
      type +
      ':' +
      site.x +
      ':' +
      site.y +
      ':' +
      worldKey() +
      ':' +
      stockKey(type) +
      ':' +
      timeKey();
    if (placementCache && placementCache.key === key) return placementCache;
    const checks = game.placementChecks(type, site.x, site.y);
    const spending = game.buildingAffordability(type, site);
    const sp = game.BSPEC[type],
      resources = workTiles(game, type, site),
      storage = game.nearestStoragePos(site.x, site.y);
    const path =
      storage && game.passI(game.idx(site.x, site.y))
        ? game.findPath(storage.x, storage.y, site.x, site.y)
        : null;
    const haul =
      path && storage
        ? walkSeconds(game, path, storage.x, storage.y, game.state.upgrades?.haul)
        : null;
    let supply = '';
    if (sp.prod === 'gather') supply = resources.length + ' mature trees';
    else if (sp.prod === 'rock') supply = resources.length + ' rock tiles';
    else if (sp.resKind) {
      let amount = 0;
      for (let i = 0; i < resources.length; i++)
        amount += game.tiles[resources[i]].deposit?.amt ?? 0;
      supply = amount + ' ' + game.GOODS[sp.resKind].name.toLowerCase() + ' in reach';
    } else if (sp.prod === 'fish')
      supply = resources.length ? 'Shore in reach' : 'No shore in reach';
    else if (sp.prod === 'plant') supply = resources.length + ' clear nursery tiles';
    const summary =
      (supply ? supply + ' · ' : '') +
      (haul === null || !storage
        ? 'No storage route'
        : 'Estimated one-way walk: ~' +
          haul.toFixed(1) +
          's to ' +
          game.BSPEC[storage.type].name.toLowerCase());
    const watered = sp.water ? game.hasLocalWater(site) : false;
    return (placementCache = {
      key,
      x: site.x,
      y: site.y,
      resources,
      checks,
      spending,
      canBuild: checks.ok && spending.affordable,
      operatingSupport: sp.water
        ? {
            ok: watered,
            reason: watered
              ? 'Working connected Well within 6 tiles'
              : 'No working connected Well within 6 tiles. Construction is allowed; production will wait.',
          }
        : null,
      path,
      storage,
      haulSeconds: haul,
      summary,
    });
  }

  function previewRoad(anchor: TilePoint, end: TilePoint): RoadPreview {
    const key =
      anchor.x + ':' + anchor.y + ':' + end.x + ':' + end.y + ':' + worldKey() + ':' + timeKey();
    if (roadCache && roadCache.key === key) return roadCache;
    const plan = game.planRoad(anchor, end);
    if (plan.ok === false) {
      const blocked = plan.reason === 'blocked-start';
      return (roadCache = {
        key,
        ok: false,
        reason: blocked
          ? 'Road must start on clear ground inside your territory'
          : 'No walking route connects these endpoints',
        cost: {},
        path: null,
        paved: {},
        count: 0,
        beforeSeconds: 0,
        afterSeconds: 0,
        summary: blocked
          ? 'Road must start on clear ground inside your territory'
          : 'No route here',
      });
    }
    const { path, paved, count } = plan;
    const haul = game.state.upgrades?.haul,
      before = walkSeconds(game, path, anchor.x, anchor.y, haul),
      after = walkSeconds(game, path, anchor.x, anchor.y, haul, paved);
    const pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
    return (roadCache = {
      key,
      ok: true,
      reason: '',
      cost: {},
      path,
      paved,
      count,
      beforeSeconds: before,
      afterSeconds: after,
      summary:
        count +
        ' new tiles · 0 goods · estimated walk ~' +
        before.toFixed(1) +
        's → ' +
        after.toFixed(1) +
        's (' +
        pct +
        '% faster along this route)',
    });
  }

  function previewGuardPost(site: TilePoint): GuardPostPreview {
    const key = site.x + ':' + site.y + ':' + worldKey();
    if (guardCache && guardCache.key === key) return guardCache;
    const { fill, segs } = game.guardPostClaim(site.x, site.y);
    return (guardCache = { key, x: site.x, y: site.y, fill, segs });
  }

  return { previewPlacement, previewRoad, previewGuardPost };
}

export interface PreviewsSubsystem {
  /** Placement validity, spending, reach and storage walk for `type` at `site`. */
  previewPlacement: (type: BuildingType, site: TilePoint) => PlacementPreview;
  /** The road plan between two endpoints with its walk-time benefit. */
  previewRoad: (anchor: TilePoint, end: TilePoint) => RoadPreview;
  /** The border a manned guard post at `site` would add. */
  previewGuardPost: (site: TilePoint) => GuardPostPreview;
}

export interface PreviewsDependencies
  extends
    Pick<
      WorldSubsystem,
      'DX' | 'DY' | 'GRASS' | 'MTN' | 'W' | 'WATER' | 'idx' | 'inB' | 'passI' | 'tiles'
    >,
    Pick<SimulationStateSubsystem, 'BSPEC' | 'GOODS' | 'buildings' | 'jobs' | 'state' | 'units'>,
    Pick<
      EconomySubsystem,
      | 'buildingAffordability'
      | 'buildingAt'
      | 'hasLocalWater'
      | 'nearestStoragePos'
      | 'placementChecks'
      | 'storages'
    >,
    Pick<EventsSubsystem, 'gameEvents'>,
    Pick<MapSubsystem, 'guardPostClaim' | 'owned'>,
    Pick<NavigationSubsystem, 'findPath' | 'moveCost'>,
    Pick<RoadsSubsystem, 'planRoad'> {}
