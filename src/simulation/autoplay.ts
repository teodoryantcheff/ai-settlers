import {
  countsAsWell,
  hasWellCoverage,
  wellRadius,
  wellReaches,
} from '../gameplay/colony-rules.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { AdvisorSubsystem } from '../gameplay/advisor.ts';
import type { EconomySubsystem } from './economy.ts';
import type { RoadsSubsystem } from './roads.ts';
import type { NavigationSubsystem } from './navigation.ts';
import type { MapSubsystem } from './map.ts';
import type { Building, BuildingType, Good, TilePoint } from '../types.ts';

/** Deposit kinds a mine can be sited against. */
export type DepositKind = 'coal' | 'iron' | 'gold';

export function createAutoplay(
  game: AutoplayDependencies,
  internals?: AutoplayInternals,
): AutoplaySubsystem {
  function shuffle<T>(a: T[]): T[] {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (game.SR() * (i + 1)) | 0,
        t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }
  function afford(bt: BuildingType) {
    var c = game.BSPEC[bt].cost || {};
    for (var g in c) if (game.availGood(g as Good) < c[g as Good]) return false;
    return true;
  }
  function randTile(): [number, number] {
    return [1 + ((game.SR() * (game.W - 2)) | 0), 1 + ((game.SR() * (game.H - 2)) | 0)];
  }
  function depositTiles(kinds: DepositKind[]): number[] {
    var out: number[] = [];
    for (var i = 0; i < game.tiles.length; i++) {
      var tl = game.tiles[i];
      if (tl.t === game.MTN && tl.res && tl.res.amt > 0 && kinds.indexOf(tl.res.kind) >= 0)
        out.push(i);
    }
    return out;
  }
  function mineDeficits(): DepositKind[] {
    var w: DepositKind[] = [],
      list = game.advTargets();
    for (var i = 0; i < list.length; i++)
      if (list[i].def > 0 && game.BSPEC[list[i].bt as BuildingType].resKind)
        w.push(game.BSPEC[list[i].bt as BuildingType].resKind);
    return w;
  }
  function findSpot(bt: BuildingType, want?: DepositKind[]): [number, number] | null {
    var sp = game.BSPEC[bt],
      i,
      d,
      nx,
      ny;
    if (sp.resKind) {
      var deps = depositTiles([sp.resKind]);
      shuffle(deps);
      for (i = 0; i < deps.length; i++)
        for (d = 0; d < 8; d++) {
          nx = (deps[i] % game.W) + game.DX[d];
          ny = ((deps[i] / game.W) | 0) + game.DY[d];
          if (game.inB(nx, ny) && game.canPlace(bt, nx, ny)[0]) return [nx, ny];
        }
      return null;
    }
    if (bt === 'lumberjack' || bt === 'quarry') {
      // needs a mature tree / rock anywhere inside its work radius, not just adjacent - frontier trees
      // sit outside the owned-4-neighbors rule, so interior sites with resource in range are the target
      var rr2 = sp.rad,
        needTree = bt === 'lumberjack';
      for (var x = 1; x < game.W - 1; x++)
        for (var y = 1; y < game.H - 1; y++) {
          var ti = game.idx(x, y),
            tl3 = game.tiles[ti];
          if (!game.owned[ti] || tl3.t !== game.GRASS || tl3.tree || tl3.rock) continue;
          if (!game.canPlace(bt, x, y)[0]) continue;
          var hit = false;
          for (var yy = y - rr2; yy <= y + rr2 && !hit; yy++)
            for (var xx = x - rr2; xx <= x + rr2 && !hit; xx++) {
              if (!game.inB(xx, yy)) continue;
              if ((x - xx) * (x - xx) + (y - yy) * (y - yy) > rr2 * rr2) continue;
              var tv = game.tiles[game.idx(xx, yy)];
              if (needTree ? tv.tree >= 3 : tv.rock) hit = true;
            }
          if (hit) return [x, y];
        }
      return null;
    }
    if (bt === 'guard') {
      var dep = want && want.length ? depositTiles(want) : null,
        top: Array<{ p: [number, number]; dd: number }> = [];
      for (var att = 0; att < 1200; att++) {
        var p = randTile(),
          gi = game.idx(p[0], p[1]);
        if (
          !game.owned[gi] ||
          game.tiles[gi].t !== game.GRASS ||
          isFaceTile(p[0], p[1], want) ||
          !game.canPlace(bt, p[0], p[1])[0]
        )
          continue;
        var frontier = false;
        for (d = 0; d < 8; d++) {
          nx = p[0] + game.DX[d];
          ny = p[1] + game.DY[d];
          if (game.inB(nx, ny) && !game.owned[game.idx(nx, ny)] && game.passI(game.idx(nx, ny))) {
            frontier = true;
            break;
          }
        }
        if (!frontier) continue;
        if (!dep) return p;
        var dd = 1e9;
        for (i = 0; i < dep.length; i++) {
          var dx4 = Math.abs((dep[i] % game.W) - p[0]) + Math.abs(((dep[i] / game.W) | 0) - p[1]);
          if (dx4 < dd) dd = dx4;
        }
        if (dd <= 1) return p;
        top.push({ p: p, dd: dd });
        if (top.length >= 40) break;
      }
      if (!top.length) return null;
      top.sort(function (a, b3) {
        return a.dd - b3.dd;
      });
      return top[(game.SR() * Math.min(6, top.length)) | 0].p;
    }
    if (bt === 'forester') {
      // site beside an existing lumberjack so replanting actually feeds its work radius
      var bestF: [number, number] = null,
        bdF = 1e9;
      for (var xf = 1; xf < game.W - 1; xf++)
        for (var yf = 1; yf < game.H - 1; yf++) {
          var tf = game.tiles[game.idx(xf, yf)];
          if (!game.owned[game.idx(xf, yf)] || tf.t !== game.GRASS || tf.tree || tf.rock) continue;
          if (!game.canPlace(bt, xf, yf)[0]) continue;
          var dF = 1e9;
          for (var k3 = 0; k3 < game.buildings.length; k3++) {
            var lb2 = game.buildings[k3];
            if (lb2.done && lb2.type === 'lumberjack') {
              var ddF = Math.abs(lb2.x - xf) + Math.abs(lb2.y - yf);
              if (ddF < dF) dF = ddF;
            }
          }
          if (dF < 1e9 && dF < bdF) {
            bdF = dF;
            bestF = [xf, yf];
          }
        }
      if (bestF) return bestF;
    }
    if (bt === 'well' || bt === 'bakery' || bt === 'brewery') {
      // Local water service must be established at the consumer, rather than
      // choosing an arbitrary owned tile that leaves the chain stalled.
      var anchors = game.buildings.filter(function (b) {
        return bt === 'well'
          ? (b.type === 'bakery' || b.type === 'brewery') && !hasWellCoverage(game, b, 'planned')
          : countsAsWell(b, 'active');
      });
      // Candidate offsets stay one tile inside the service radius.
      var reach = wellRadius(game) - 1;
      for (var anchor of anchors)
        for (var oy = -reach; oy <= reach; oy++)
          for (var ox = -reach; ox <= reach; ox++) {
            var wx = anchor.x + ox,
              wy = anchor.y + oy;
            if (
              game.inB(wx, wy) &&
              wellReaches(game, anchor, wx, wy) &&
              game.canPlace(bt, wx, wy)[0]
            )
              return [wx, wy];
          }
      if (bt !== 'well') return null;
      // A full existing service area needs a fresh owned footprint. Enumerate
      // it so small frontier settlements cannot miss a valid well by chance.
      for (var sy = 1; sy < game.H - 1; sy++)
        for (var sx = 1; sx < game.W - 1; sx++) {
          if (!game.canPlace('well', sx, sy)[0]) continue;
          var storage = game.nearestStoragePos(sx, sy);
          if (storage && game.connectedLand(sx, sy, storage.x, storage.y)) return [sx, sy];
        }
    }
    if (bt === 'warehouse') {
      // site it beside the most remote worker so carriers spawn near the frontier cluster
      var farB: Building = null,
        fd = 0;
      for (i = 0; i < game.buildings.length; i++) {
        var b4 = game.buildings[i];
        if (!b4.done || game.BSPEC[b4.type].store) continue;
        var s5 = game.nearestStoragePos(b4.x, b4.y);
        if (!s5) continue;
        var dd5 = Math.hypot(b4.x - s5.x, b4.y - s5.y);
        if (dd5 > fd) {
          fd = dd5;
          farB = b4;
        }
      }
      if (farB) {
        var bestW: [number, number] = null,
          bdW = 1e9;
        for (var xw = 1; xw < game.W - 1; xw++)
          for (var yw = 1; yw < game.H - 1; yw++) {
            var tw2 = game.tiles[game.idx(xw, yw)];
            if (!game.owned[game.idx(xw, yw)] || tw2.t !== game.GRASS || tw2.tree || tw2.rock)
              continue;
            if (!game.canPlace(bt, xw, yw)[0]) continue;
            var dw = Math.abs(farB.x - xw) + Math.abs(farB.y - yw);
            if (dw < bdW) {
              bdW = dw;
              bestW = [xw, yw];
            }
          }
        if (bestW) return bestW;
      }
    }
    for (var att2 = 0; att2 < 400; att2++) {
      var q = randTile();
      if (game.canPlace(bt, q[0], q[1])[0]) return q;
    }
    return null;
  }
  function clearNeighbor(b: Building): TilePoint | null {
    for (var d = 0; d < 8; d++) {
      var nx = b.x + game.DX[d],
        ny = b.y + game.DY[d],
        ni = game.idx(nx, ny);
      if (
        game.inB(nx, ny) &&
        game.owned[ni] &&
        game.passI(ni) &&
        !game.buildingAt(nx, ny) &&
        !game.tiles[ni].tree &&
        !game.tiles[ni].rock &&
        !game.tiles[ni].road
      )
        return { x: nx, y: ny };
    }
    return null;
  }
  function roadNear(b: Building, r: number) {
    var has = false;
    game.forRadius(b, r, function (i) {
      if (game.tiles[i].road) has = true;
    });
    return has;
  }
  function buildCorridor(want: DepositKind[]): number[] | null {
    // walking routes from the warehouse to the nearest live wanted deposits; the route to a live
    // GOLD deposit is always included when gold is wanted (it feeds the victory condition)
    var s = game.anyStorage();
    if (!s) return null;
    var deps = depositTiles(want),
      golds: number[] = [],
      others: number[] = [];
    for (var k = 0; k < deps.length; k++)
      (game.tiles[deps[k]].res.kind === 'gold' ? golds : others).push(deps[k]);
    function byDist(arr: number[]) {
      arr.sort(function (a, b) {
        var da =
          ((a % game.W) - s.x) * ((a % game.W) - s.x) +
          (((a / game.W) | 0) - s.y) * (((a / game.W) | 0) - s.y);
        var db =
          ((b % game.W) - s.x) * ((b % game.W) - s.x) +
          (((b / game.W) | 0) - s.y) * (((b / game.W) | 0) - s.y);
        return da - db;
      });
    }
    byDist(others);
    byDist(golds);
    // gold is the victory resource - go for the biggest live gold deposit, not the nearest one;
    // small deposits exhaust too fast and the re-expansion churn eats the whole guard budget
    golds.sort(function (a, b) {
      return game.tiles[b].res.amt - game.tiles[a].res.amt;
    });
    var take: number[] = [];
    if (golds.length && want.indexOf('gold') >= 0) take.push(golds[0]);
    for (k = 0; k < others.length && take.length < 6; k++) take.push(others[k]);
    if (!take.length) return null;
    var path: number[] = null;
    for (k = 0; k < take.length; k++) {
      var di = take[k],
        dl = -1;
      for (var d = 0; d < 8; d++) {
        var nx = (di % game.W) + game.DX[d],
          ny = ((di / game.W) | 0) + game.DY[d];
        if (game.inB(nx, ny) && game.passI(game.idx(nx, ny))) {
          dl = game.idx(nx, ny);
          break;
        }
      }
      if (dl < 0) continue;
      var p = game.findPath(s.x, s.y, dl % game.W, (dl / game.W) | 0);
      if (!p) continue;
      if (!path || game.tiles[di].res.kind === 'gold') path = p;
    }
    return path;
  }
  function isFaceTile(x: number, y: number, want: DepositKind[]) {
    // Reserve both meadow mining faces and their building-spacing clearance.
    // An outpost one tile behind a face blocks that mine just as surely as an
    // outpost built on the face itself, even after its border reaches the ore.
    if (!want || !want.length) return false;
    for (var fy = y - 1; fy <= y + 1; fy++)
      for (var fx = x - 1; fx <= x + 1; fx++) {
        if (!game.inB(fx, fy) || game.tiles[game.idx(fx, fy)].t !== game.GRASS) continue;
        for (var d = 0; d < 8; d++) {
          var nx = fx + game.DX[d],
            ny = fy + game.DY[d];
          if (!game.inB(nx, ny)) continue;
          var t = game.tiles[game.idx(nx, ny)];
          if (t.t === game.MTN && t.res && t.res.amt > 0 && want.includes(t.res.kind)) return true;
        }
      }
    return false;
  }
  function spotOnCorridor(cor: number[], want: DepositKind[]): [number, number] | null {
    if (!cor || !cor.length) return null;
    // The road can pass through reserved mine faces or a narrow coastal bend. Search
    // nearby buildable land and score the territory its manned flood would add.
    // Repeating an already-covered route tile cannot advance an expansion chain.
    var routeIndex = new Int16Array(game.W * game.H),
      candidates = new Uint8Array(game.W * game.H);
    routeIndex.fill(-1);
    for (var q = 0; q < cor.length; q++) routeIndex[cor[q]] = q;
    var goal = cor[cor.length - 1],
      gx = goal % game.W,
      gy = (goal / game.W) | 0;
    var critical = new Uint8Array(game.W * game.H),
      missing = 0;
    critical[goal] = 1;
    if (!game.owned[goal]) missing++;
    for (var d = 0; d < 4; d++) {
      var nx = gx + game.DX[d],
        ny = gy + game.DY[d];
      if (!game.inB(nx, ny) || !game.passI(game.idx(nx, ny))) continue;
      critical[game.idx(nx, ny)] = 1;
      if (!game.owned[game.idx(nx, ny)]) missing++;
    }
    var seen = new Int32Array(game.W * game.H),
      stamp = 0,
      best: [number, number] = null,
      bestScore = -Infinity;
    for (q = cor.length - 1; q >= 0; q--) {
      var px = cor[q] % game.W,
        py = (cor[q] / game.W) | 0;
      for (var oy = -3; oy <= 3; oy++)
        for (var ox = -3; ox <= 3; ox++) {
          var x = px + ox,
            y = py + oy;
          if (!game.inB(x, y)) continue;
          var site = game.idx(x, y);
          if (candidates[site]) continue;
          candidates[site] = 1;
          if (!game.owned[site] || isFaceTile(x, y, want) || !game.canPlace('guard', x, y)[0])
            continue;
          stamp++;
          var queue = [site],
            distances = [0],
            advance = -1,
            criticalHits = 0;
          seen[site] = stamp;
          for (var qi = 0; qi < queue.length; qi++) {
            var current = queue[qi],
              distance = distances[qi];
            if (!game.owned[current]) {
              if (routeIndex[current] > advance) advance = routeIndex[current];
              if (critical[current]) criticalHits++;
            }
            if (distance >= game.BSPEC.guard.rad) continue;
            var cx = current % game.W,
              cy = (current / game.W) | 0;
            for (d = 0; d < 4; d++) {
              nx = cx + game.DX[d];
              ny = cy + game.DY[d];
              if (!game.inB(nx, ny)) continue;
              var next = game.idx(nx, ny);
              if (seen[next] === stamp || !game.passI(next)) continue;
              seen[next] = stamp;
              queue.push(next);
              distances.push(distance + 1);
            }
          }
          if (advance < 0 && !criticalHits) continue;
          var score = advance * 100 + criticalHits * 1000 - Math.hypot(x - gx, y - gy);
          if (missing > 0 && criticalHits === missing) score += 50000;
          if (score > bestScore) {
            bestScore = score;
            best = [x, y];
          }
        }
    }
    return best;
  }
  function pathPos(cor: number[], tx: number, ty: number) {
    // furthest position along the corridor path within Chebyshev distance 2 of (tx,ty)
    var best = -1;
    for (var q = 0; q < cor.length; q++) {
      var px2 = cor[q] % game.W,
        py2 = (cor[q] / game.W) | 0;
      if (Math.max(Math.abs(px2 - tx), Math.abs(py2 - ty)) <= 2 && q > best) best = q;
    }
    return best;
  }
  function guardCoverRedundant(g: Building, want: DepositKind[]) {
    // a manned guard earns its keep only while its territory covers a standing mine or a live
    // wanted deposit; rear-of-chain guards whose deposits are gone are recyclable scaffolding
    var r = game.BSPEC[g.type].rad + 2,
      keep = false;
    game.forRadius(g, r, function (i) {
      var tl = game.tiles[i],
        bAt = game.buildingAt(i % game.W, (i / game.W) | 0);
      if (bAt && game.BSPEC[bAt.type].prod === 'mine') keep = true;
      else if (tl.t === game.MTN && tl.res && tl.res.amt > 0 && want.indexOf(tl.res.kind) >= 0)
        keep = true;
    });
    return !keep;
  }
  function guardTerritoryRedundant(guard: Building) {
    // A route index cannot prove a claim is dispensable around winding coastlines.
    // Project territory without this outpost and retain it whenever any land would
    // leave the colony. This also protects the approach to the next construction site.
    var covered = new Uint8Array(game.W * game.H),
      seen = new Uint16Array(game.W * game.H),
      stamp = 0;
    for (var bi = 0; bi < game.buildings.length; bi++) {
      var b = game.buildings[bi];
      if (b === guard || !b.done || b.type === 'well') continue;
      var sp = game.BSPEC[b.type],
        radius = sp.rad || 0;
      if (sp.guard && !b.man) radius = Math.min(radius, 3);
      if (!radius) continue;
      stamp++;
      var start = game.idx(b.x, b.y),
        queue = [start],
        distances = [0];
      seen[start] = stamp;
      for (var qi = 0; qi < queue.length; qi++) {
        var current = queue[qi],
          distance = distances[qi];
        covered[current] = 1;
        if (distance >= radius) continue;
        var x = current % game.W,
          y = (current / game.W) | 0;
        for (var d = 0; d < 4; d++) {
          var nx = x + game.DX[d],
            ny = y + game.DY[d];
          if (!game.inB(nx, ny)) continue;
          var next = game.idx(nx, ny);
          if (seen[next] === stamp || !game.passI(next)) continue;
          seen[next] = stamp;
          queue.push(next);
          distances.push(distance + 1);
        }
      }
    }
    for (var i = 0; i < game.owned.length; i++) if (game.owned[i] && !covered[i]) return false;
    return true;
  }
  function autoRoad() {
    var best: Building = null,
      bs: Building = null,
      bd = 0;
    for (var i = 0; i < game.buildings.length; i++) {
      var b = game.buildings[i];
      if (!b.done || game.BSPEC[b.type].store) continue;
      var s = game.nearestStoragePos(b.x, b.y);
      if (!s) continue;
      var d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d > bd) {
        bd = d;
        best = b;
        bs = s;
      }
    }
    if (!best || bd < 12 || roadNear(best, 3)) return;
    var a1 = clearNeighbor(bs),
      a2 = clearNeighbor(best);
    if (a1 && a2) game.commitRoad(a1, a2);
  }
  var autoT = 0;
  function autoTick(dt: number, planningSuspended = false) {
    autoT -= dt;
    if (autoT > 0) return;
    autoT = 2;
    if (planningSuspended) return;
    // 1a) clear dead weight BEFORE siting the corridor - exhausted mines and starved quarries -
    // so the corridor targets the post-cleanup world
    for (var i = game.buildings.length - 1; i >= 0; i--) {
      var b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || b.type === 'hq') continue;
      if (b.exhausted || (sp.prod === 'rock' && game.buildingStatus(b).bad)) game.demolish(b); // fresh, never the 800ms wall-clock HUD cache - AI decisions must not depend on rAF timing
    }
    var list = game.advTargets(),
      want = mineDeficits(),
      gcount = 0,
      minesN = 0,
      farmN = 0;
    for (i = 0; i < game.buildings.length; i++) {
      var ty2 = game.buildings[i].type;
      if (ty2 === 'guard') gcount++;
      else if (ty2 === 'farm') farmN++;
      if (game.BSPEC[ty2].prod === 'mine') minesN++;
    }
    var farmCap = 3 + 2 * minesN;
    var cor = buildCorridor(want);
    // 1b) recycle redundant manned guards (garrison+weapon return on raze) - one per tick,
    // Keep the newest manned outpost as well as the corridor's apparent front. Around
    // water, the next useful claim can sit earlier on that route; recycling it immediately
    // traps expansion in a build/raze loop before its territory can support the next site.
    var razed = false,
      frontB = null,
      newestGuard = null,
      frontQ = -1;
    for (i = 0; i < game.buildings.length; i++) {
      var gb2 = game.buildings[i];
      if (gb2.type !== 'guard' || !gb2.man) continue;
      if (!newestGuard || gb2.id > newestGuard.id) newestGuard = gb2;
      if (cor) {
        var gq = pathPos(cor, gb2.x, gb2.y);
        if (gq > frontQ) {
          frontQ = gq;
          frontB = gb2;
        }
      }
    }
    for (var i = game.buildings.length - 1; i >= 0; i--) {
      var b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || b.type === 'hq') continue;
      if (
        !razed &&
        sp.guard &&
        b.man &&
        want.length &&
        b !== frontB &&
        b !== newestGuard &&
        guardCoverRedundant(b, want) &&
        guardTerritoryRedundant(b)
      ) {
        game.demolish(b);
        razed = true;
      }
    }
    // 2) mines first - they are the victory path; a wanted mine that can't be sited means the border must move
    var expand = false;
    for (i = 0; i < list.length; i++) {
      var r = list[i],
        bt: BuildingType = r.bt;
      if (r.def <= 0 || !game.BSPEC[bt].resKind) continue;
      if (!afford(bt)) {
        expand = true;
        continue;
      }
      var spot = findSpot(bt, null);
      if (spot && game.placeBuilding(bt, spot[0], spot[1])) return;
      expand = true;
    }
    // 3) push the border toward the wanted deposits with guard posts - one at a time: wait until
    // the previous guard is manned (its radius is what carries the next one forward)
    var unmanned = 0;
    for (i = 0; i < game.buildings.length; i++)
      if (game.buildings[i].type === 'guard' && !game.buildings[i].man) unmanned++;
    if (expand && gcount < 18 && unmanned === 0 && game.soldierPool > 0 && afford('guard')) {
      var gs = spotOnCorridor(cor, want) || findSpot('guard', want);
      if (gs && game.placeBuilding('guard', gs[0], gs[1])) return;
    }
    // 4) everything else (the advisor's guard row is deliberately skipped - expansion is
    // exclusively the corridor's job, gated by the manning chain in step 3)
    for (i = 0; i < list.length; i++) {
      var r = list[i],
        bt: BuildingType = r.bt;
      if (r.def <= 0 || game.BSPEC[bt].resKind || bt === 'guard') continue;
      if (!afford(bt)) continue;
      var spot = findSpot(bt, null);

      if (spot && game.placeBuilding(bt, spot[0], spot[1])) return;
    }
    // 4) nothing buildable left this tick - recycle a surplus farm for its refund so the economy can reboot
    if (farmN > farmCap) {
      for (i = 0; i < game.buildings.length; i++) {
        var fb = game.buildings[i];
        if (fb.done && fb.type === 'farm') {
          game.demolish(fb);
          return;
        }
      }
    }
    if (game.SR() < 0.15) autoRoad();
  }

  // Test-only view of closure internals; never merged into the runtime.
  if (internals)
    Object.assign(internals, {
      afford,
      mineDeficits,
      findSpot,
      clearNeighbor,
      buildCorridor,
      isFaceTile,
      spotOnCorridor,
      pathPos,
      guardCoverRedundant,
      guardTerritoryRedundant,
    });

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    get autoT() {
      return autoT;
    },
    set autoT(value: typeof autoT) {
      autoT = value;
    },
    autoTick,
  };
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface AutoplayInternals {
  afford: (bt: BuildingType) => boolean;
  mineDeficits: () => DepositKind[];
  findSpot: (bt: BuildingType, want?: DepositKind[]) => [number, number] | null;
  clearNeighbor: (b: Building) => TilePoint | null;
  buildCorridor: (want: DepositKind[]) => number[] | null;
  isFaceTile: (x: number, y: number, want: DepositKind[]) => boolean;
  spotOnCorridor: (cor: number[], want: DepositKind[]) => [number, number] | null;
  pathPos: (cor: number[], tx: number, ty: number) => number;
  guardCoverRedundant: (g: Building, want: DepositKind[]) => boolean;
  guardTerritoryRedundant: (guard: Building) => boolean;
}

export interface AutoplaySubsystem {
  autoT: number;
  autoTick: (dt: number, planningSuspended?: boolean) => void;
}

export interface AutoplayDependencies
  extends
    Pick<SimulationStateSubsystem, 'BSPEC' | 'buildings' | 'soldierPool'>,
    Pick<
      WorldSubsystem,
      'DX' | 'DY' | 'GRASS' | 'H' | 'MTN' | 'SR' | 'W' | 'idx' | 'inB' | 'passI' | 'tiles'
    >,
    Pick<AdvisorSubsystem, 'advTargets'>,
    Pick<
      EconomySubsystem,
      | 'anyStorage'
      | 'availGood'
      | 'buildingAt'
      | 'buildingStatus'
      | 'canPlace'
      | 'demolish'
      | 'forRadius'
      | 'nearestStoragePos'
      | 'placeBuilding'
    >,
    Pick<RoadsSubsystem, 'commitRoad'>,
    Pick<NavigationSubsystem, 'findPath' | 'connectedLand'>,
    Pick<MapSubsystem, 'owned'> {}
