import type { WorldSubsystem } from '../core/world.ts';
import type { EconomySubsystem } from './economy.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { NavigationSubsystem } from './navigation.ts';
import type { ProgressionSubsystem } from '../gameplay/progression.ts';
import type { MapSubsystem } from './map.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { GameEvents, TilePoint } from '../types.ts';

type RoadRejection = { ok: false; reason: GameEvents['roadRejected']['reason'] };
type RoadRoute = { ok: true; path: number[] } | RoadRejection;
/** A current-world prediction, never an instruction to apply cached pavement. */
export type RoadPlan =
  { ok: true; path: number[]; paved: Record<number, boolean>; count: number } | RoadRejection;

export function createRoads(game: RoadsDependencies): RoadsSubsystem {
  function tileChanged(i: number) {
    game.emitGameEvent('tileChanged', { index: i });
  }
  function canPave(i: number) {
    var tile = game.tiles[i];
    return !!(
      game.owned[i] &&
      !game.buildingAt(i % game.W, (i / game.W) | 0) &&
      !tile.tree &&
      !tile.rock
    );
  }
  function roadRoute(a: TilePoint, b: TilePoint): RoadRoute {
    var path = game.findPath(a.x, a.y, b.x, b.y);
    // Preserve rejection precedence, including a blocked start with no route.
    if (!path) return { ok: false, reason: 'no-route' };
    if (!canPave(game.idx(a.x, a.y))) return { ok: false, reason: 'blocked-start' };
    return { ok: true, path };
  }
  function planRoad(a: TilePoint, b: TilePoint): RoadPlan {
    var route = roadRoute(a, b);
    if (route.ok === false) return route;
    var paved: Record<number, boolean> = {},
      count = 0;
    for (var i of [game.idx(a.x, a.y), ...route.path]) {
      if (canPave(i) && !game.tiles[i].road) {
        paved[i] = true;
        count++;
      }
    }
    return { ok: true, path: route.path, paved, count };
  }
  function commitRoad(a: TilePoint, b2: TilePoint) {
    // Replan from endpoints; a cached display plan cannot authorize construction.
    var route = roadRoute(a, b2);
    if (route.ok === false) {
      game.emitGameEvent('roadRejected', { reason: route.reason });
      return false;
    }
    var p = route.path;
    var ai = game.idx(a.x, a.y),
      at = game.tiles[ai];
    var n = at.road ? 0 : 1;
    at.road = true;
    tileChanged(ai);
    for (var i = 0; i < p.length; i++) {
      var t2 = p[i],
        x = t2 % game.W,
        y = (t2 / game.W) | 0,
        tt = game.tiles[t2];
      if (!canPave(t2)) continue;
      if (!tt.road) {
        tt.road = true;
        n++;
        tileChanged(t2);
      }
      for (var d = 0; d < 4; d++) {
        var nx = x + game.DX[d],
          ny = y + game.DY[d];
        if (game.inB(nx, ny) && game.tiles[game.idx(nx, ny)].road) tileChanged(game.idx(nx, ny));
      }
    }
    game.state.roadsBuilt = (game.state.roadsBuilt || 0) + n;
    if (n) {
      game.gameTick();
    }
    game.emitGameEvent('roadBuilt', { count: n });
    return true;
  }
  return { planRoad, commitRoad };
}
export interface RoadsSubsystem {
  /** Predict without changing the colony, consuming RNG or emitting feedback. */
  planRoad: (a: TilePoint, b: TilePoint) => RoadPlan;
  commitRoad: (a: TilePoint, b: TilePoint) => boolean;
}

export interface RoadsDependencies
  extends
    Pick<WorldSubsystem, 'DX' | 'DY' | 'W' | 'idx' | 'inB' | 'tiles'>,
    Pick<EconomySubsystem, 'buildingAt'>,
    Pick<EventsSubsystem, 'emitGameEvent'>,
    Pick<NavigationSubsystem, 'findPath'>,
    Pick<ProgressionSubsystem, 'gameTick'>,
    Pick<MapSubsystem, 'owned'>,
    Pick<SimulationStateSubsystem, 'state'> {}
