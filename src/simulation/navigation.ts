import type { WorldSubsystem } from '../core/world.ts';
import type { Tile } from '../types.ts';

export function createNavigation(game: NavigationDependencies): NavigationSubsystem {
  var NAVG = new Float32Array(game.W * game.H),
    NAVPI = new Int32Array(game.W * game.H),
    NAVST = new Int32Array(game.W * game.H),
    NAVCL = new Int32Array(game.W * game.H),
    navStamp = 0;
  var landRegionTiles: Tile[] | null = null,
    landRegions = new Uint16Array(game.W * game.H);
  function connectedLand(ax: number, ay: number, bx: number, by: number) {
    ax = Math.floor(ax);
    ay = Math.floor(ay);
    bx = Math.floor(bx);
    by = Math.floor(by);
    if (!game.inB(ax, ay) || !game.inB(bx, by)) return false;
    // Water and mountains never change during play. Roads, trees and exhausted
    // deposits change travel cost, but not connectivity. Imports replace tiles.
    if (landRegionTiles !== game.tiles) {
      landRegions.fill(0);
      var region = 0;
      for (var i = 0; i < game.tiles.length; i++) {
        if (landRegions[i] || !game.passI(i)) continue;
        region++;
        var queue = [i];
        landRegions[i] = region;
        for (var q = 0; q < queue.length; q++) {
          var current = queue[q],
            x = current % game.W,
            y = (current / game.W) | 0;
          for (var d = 0; d < 4; d++) {
            var nx = x + game.DX[d],
              ny = y + game.DY[d];
            if (!game.inB(nx, ny)) continue;
            var next = game.idx(nx, ny);
            if (landRegions[next] || !game.passI(next)) continue;
            landRegions[next] = region;
            queue.push(next);
          }
        }
      }
      landRegionTiles = game.tiles;
    }
    var source = landRegions[game.idx(ax, ay)];
    return source > 0 && source === landRegions[game.idx(bx, by)];
  }
  function moveCost(n: number) {
    var tl = game.tiles[n];
    if (tl.road) return 0.3;
    if (tl.tree) return 1.6;
    if (tl.t === game.SAND) return 1.15;
    return 1;
  }
  function hex(a: number, b: number) {
    var ax = a % game.W,
      ay = (a / game.W) | 0,
      bx = b % game.W,
      by = (b / game.W) | 0,
      dx = Math.abs(ax - bx),
      dy = Math.abs(ay - by);
    return 0.3 * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  }
  var heapI: number[] = [],
    heapF: number[] = [];
  function hPush(i: number, f: number) {
    heapI.push(i);
    heapF.push(f);
    var c = heapF.length - 1;
    while (c > 0) {
      var p = (c - 1) >> 1;
      if (heapF[p] <= heapF[c]) break;
      var tf = heapF[p];
      heapF[p] = heapF[c];
      heapF[c] = tf;
      var ti = heapI[p];
      heapI[p] = heapI[c];
      heapI[c] = ti;
      c = p;
    }
  }
  function hPop() {
    var i = heapI[0],
      li = heapI.length - 1;
    if (li === 0) {
      heapI.length = 0;
      heapF.length = 0;
      return i;
    }
    heapI[0] = heapI[li];
    heapF[0] = heapF[li];
    heapI.length = li;
    heapF.length = li;
    var c = 0;
    for (;;) {
      var l = 2 * c + 1,
        r2 = l + 1,
        m = c;
      if (l < li && heapF[l] < heapF[m]) m = l;
      if (r2 < li && heapF[r2] < heapF[m]) m = r2;
      if (m === c) break;
      var tf = heapF[c];
      heapF[c] = heapF[m];
      heapF[m] = tf;
      var ti = heapI[c];
      heapI[c] = heapI[m];
      heapI[m] = ti;
      c = m;
    }
    return i;
  }
  function findPath(sx: number, sy: number, tx: number, ty: number) {
    if (!game.inB(sx, sy) || !game.inB(tx, ty)) return null;
    var s = game.idx(sx, sy),
      g = game.idx(tx, ty);
    if (!game.passI(s) || !game.passI(g)) return null;
    if (s === g) return [];
    navStamp++;
    heapI.length = 0;
    heapF.length = 0;
    NAVG[s] = 0;
    NAVST[s] = navStamp;
    NAVPI[s] = -1;
    hPush(s, hex(s, g));
    var exp = 0;
    while (heapI.length) {
      var cur = hPop();
      if (NAVCL[cur] === navStamp) continue;
      NAVCL[cur] = navStamp;
      if (cur === g) {
        var path: number[] = [],
          c2 = cur;
        while (c2 !== s) {
          path.push(c2);
          c2 = NAVPI[c2];
        }
        path.reverse();
        return path;
      }
      if (++exp > 15000) break;
      var cx2 = cur % game.W,
        cy2 = (cur / game.W) | 0;
      for (var d = 0; d < 8; d++) {
        var nx = cx2 + game.DX[d],
          ny = cy2 + game.DY[d];
        if (!game.inB(nx, ny)) continue;
        var n = game.idx(nx, ny);
        if (!game.passI(n) || NAVCL[n] === navStamp) continue;
        if (d >= 4 && (!game.passI(game.idx(cx2, ny)) || !game.passI(game.idx(nx, cy2)))) continue;
        var step = moveCost(n) * (d >= 4 ? Math.SQRT2 : 1),
          ng = NAVG[cur] + step;
        if (NAVST[n] !== navStamp || ng < NAVG[n] - 1e-6) {
          NAVST[n] = navStamp;
          NAVG[n] = ng;
          NAVPI[n] = cur;
          hPush(n, ng + hex(n, g));
        }
      }
    }
    return null;
  }
  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    get landRegionTiles() {
      return landRegionTiles;
    },
    set landRegionTiles(value: typeof landRegionTiles) {
      landRegionTiles = value;
    },
    connectedLand,
    moveCost,
    findPath,
  };
}

export interface NavigationSubsystem {
  landRegionTiles: Tile[] | null;
  connectedLand: (ax: number, ay: number, bx: number, by: number) => boolean;
  moveCost: (n: number) => 1 | 0.3 | 1.6 | 1.15;
  /** Tile indexes from the first step after the start to the target, or null when unreachable. */
  findPath: (sx: number, sy: number, tx: number, ty: number) => number[];
}

export interface NavigationDependencies extends Pick<
  WorldSubsystem,
  'DX' | 'DY' | 'H' | 'SAND' | 'W' | 'idx' | 'inB' | 'passI' | 'tiles'
> {}
