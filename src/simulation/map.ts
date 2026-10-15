import type { SimulationStateSubsystem } from './state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { NavigationSubsystem } from './navigation.ts';

export function createMap(game: MapDependencies, internals?: MapInternals): MapSubsystem {
  function genMap() {
    game.landRegionTiles = null;
    var att,
      ok = false;
    for (att = 0; att < 200 && !ok; att++) {
      ok = tryGen();
      if (!ok) game.seed += 7;
    }
  }
  function tryGen() {
    var i,
      x,
      y,
      land = 0,
      mtn = 0;
    var e = game.fbm(game.seed),
      e2 = game.fbm(game.seed + 101),
      tn = game.fbm(game.seed + 202),
      rn = game.fbm(game.seed + 303);
    var dr = game.mulberry32(game.seed + 404); // all map-gen rolls are seeded -> ?seed=N is fully reproducible
    for (i = 0; i < game.W * game.H; i++)
      game.tiles[i] = { t: game.GRASS, tree: 0, rock: null, road: false, owned: false, res: null };
    for (y = 0; y < game.H; y++)
      for (x = 0; x < game.W; x++) {
        var u = x / game.W,
          v = y / game.H,
          h = e(u, v) * 0.75 + e2(u, v) * 0.25,
          t = game.GRASS;
        if (h < 0.3) t = game.WATER;
        else if (h < 0.35) t = game.SAND;
        else if (h > 0.74) t = game.MTN;
        var tl = game.tiles[game.idx(x, y)];
        tl.t = t;
        if (t === game.GRASS && tn(u, v) > 0.6) tl.tree = 4;
        if (t === game.GRASS && rn(u, v) > 0.66)
          tl.rock = { amt: 30 + ((rn(u + 0.3, v + 0.7) * 40) | 0) };
        if (t === game.MTN) {
          mtn++;
          var r2 = dr();
          if (r2 < 0.3) tl.res = null;
          else if (r2 < 0.42) {
            var g0 = 60 + ((dr() * 40) | 0);
            tl.res = { kind: 'gold', amt: g0, amt0: g0 };
          } else if (r2 < 0.72) {
            var i0 = 60 + ((dr() * 50) | 0);
            tl.res = { kind: 'iron', amt: i0, amt0: i0 };
          } else {
            var c0 = 80 + ((dr() * 60) | 0);
            tl.res = { kind: 'coal', amt: c0, amt0: c0 };
          }
        }
        if (t !== game.WATER) land++;
      }
    var cx = game.W >> 1,
      cy = game.H >> 1,
      x2,
      y2;
    for (y2 = cy - 9; y2 <= cy + 9; y2++)
      for (x2 = cx - 9; x2 <= cx + 9; x2++) {
        var tl2 = game.tiles[game.idx(x2, y2)];
        tl2.t = game.GRASS;
        tl2.tree = 0;
        tl2.rock = null;
        tl2.res = null;
      }
    for (var a = 0; a < 360; a += 4) {
      var rr = 9 + dr() * 5,
        tx2 = Math.round(cx + Math.cos((a * Math.PI) / 180) * rr),
        ty2 = Math.round(cy + Math.sin((a * Math.PI) / 180) * rr);
      if (game.inB(tx2, ty2) && game.tiles[game.idx(tx2, ty2)].t === game.GRASS && dr() < 0.7)
        game.tiles[game.idx(tx2, ty2)].tree = 4;
    }
    for (var a2 = 0; a2 < 360; a2 += 45) {
      var rr2 = 12 + dr() * 4,
        rx = Math.round(cx + Math.cos((a2 * Math.PI) / 180) * rr2),
        ry = Math.round(cy + Math.sin((a2 * Math.PI) / 180) * rr2);
      if (
        game.inB(rx, ry) &&
        game.tiles[game.idx(rx, ry)].t === game.GRASS &&
        !game.tiles[game.idx(rx, ry)].tree &&
        !game.tiles[game.idx(rx, ry)].rock
      )
        game.tiles[game.idx(rx, ry)].rock = { amt: 30 + ((dr() * 30) | 0) };
    }
    // A ragged ridge keeps the guaranteed mining frontier readable without a rectangle.
    // The eastern face and its gold deposits remain fixed and accessible.
    for (x2 = cx + 20; x2 < cx + 27; x2++)
      for (y2 = cy - 5; y2 <= cy + 3; y2++) {
        var ridgeX = x2 - (cx + 20),
          ridgeY = y2 - cy;
        var ridgeEdge = [2, 3, 4, 3, 4, 3, 2][ridgeX];
        if (Math.abs(ridgeY + 1) > ridgeEdge && !(x2 === cx + 26 && (y2 === cy - 2 || y2 === cy)))
          continue;
        if (game.inB(x2, y2)) {
          var tm = game.tiles[game.idx(x2, y2)];
          tm.t = game.MTN;
          tm.tree = 0;
          tm.rock = null;
          tm.res =
            y2 === cy - 3 || y2 === cy
              ? { kind: 'coal', amt: 120, amt0: 120 }
              : { kind: 'iron', amt: 90, amt0: 90 };
        }
      }
    // Keep the optional investment budget at the familiar mining frontier. A
    // sparse map must not require a second distant campaign after buying upgrades.
    var guaranteedGold = game.GOAL + 180 + 60,
      faceGold = Math.ceil(guaranteedGold / 2),
      gA = faceGold + ((dr() * 40) | 0),
      gB = faceGold + ((dr() * 40) | 0);
    game.tiles[game.idx(cx + 26, cy - 2)].res = { kind: 'gold', amt: gA, amt0: gA };
    game.tiles[game.idx(cx + 26, cy)].res = { kind: 'gold', amt: gB, amt0: gB };
    for (y2 = cy - 5; y2 <= cy + 2; y2++)
      for (x2 = cx + 27; x2 <= cx + 29; x2++) {
        if (game.inB(x2, y2)) {
          var tg = game.tiles[game.idx(x2, y2)];
          tg.t = game.GRASS;
          tg.tree = 0;
          tg.rock = null;
          tg.res = null;
          tg.road = false;
        }
      }
    var lakeOK = false;
    for (var dy3 = -30; dy3 <= 30 && !lakeOK; dy3++)
      for (var dx3 = -30; dx3 <= 30 && !lakeOK; dx3++)
        if (
          game.inB(cx + dx3, cy + dy3) &&
          game.tiles[game.idx(cx + dx3, cy + dy3)].t === game.WATER
        )
          lakeOK = true;
    if (!lakeOK) {
      var la = dr() * 6.28,
        ld = 14 + dr() * 3,
        lx = Math.round(cx + Math.cos(la) * ld),
        ly = Math.round(cy + Math.sin(la) * ld);
      for (var wy2 = ly - 3; wy2 <= ly + 3; wy2++)
        for (var wx2 = lx - 4; wx2 <= lx + 4; wx2++) {
          if (!game.inB(wx2, wy2)) continue;
          var dn2 = (wx2 - lx) / 4.4,
            de2 = (wy2 - ly) / 3.4;
          if (dn2 * dn2 + de2 * de2 <= 1) {
            var lw = game.tiles[game.idx(wx2, wy2)];
            lw.t = game.WATER;
            lw.tree = 0;
            lw.rock = null;
            lw.res = null;
            lw.road = false;
          }
        }
      for (var wy3 = ly - 4; wy3 <= ly + 4; wy3++)
        for (var wx3 = lx - 5; wx3 <= lx + 5; wx3++) {
          if (!game.inB(wx3, wy3)) continue;
          var ls = game.tiles[game.idx(wx3, wy3)];
          if (ls.t === game.GRASS) {
            var adj2 = false;
            for (var d5 = 0; d5 < 4; d5++) {
              var aw = game.tiles[game.idx(wx3 + game.DX[d5], wy3 + game.DY[d5])];
              if (aw && aw.t === game.WATER) adj2 = true;
            }
            if (adj2) ls.t = game.SAND;
          }
        }
    }
    var reach = new Uint8Array(game.W * game.H);
    function floodReach() {
      reach.fill(0);
      var st5 = [game.idx(cx, cy)];
      reach[game.idx(cx, cy)] = 1;
      while (st5.length) {
        var s6 = st5.pop(),
          sx6 = s6 % game.W,
          sy6 = (s6 / game.W) | 0;
        for (var d8 = 0; d8 < 4; d8++) {
          var nx6 = sx6 + game.DX[d8],
            ny6 = sy6 + game.DY[d8];
          if (!game.inB(nx6, ny6)) continue;
          var n6 = game.idx(nx6, ny6);
          if (reach[n6] || !game.passI(n6)) continue;
          reach[n6] = 1;
          st5.push(n6);
        }
      }
    }
    function goldReachCount() {
      var n2 = 0;
      for (var i2 = 0; i2 < game.tiles.length; i2++) {
        var t6 = game.tiles[i2];
        if (t6.t !== game.MTN || !t6.res || t6.res.kind !== 'gold') continue;
        for (var d9 = 0; d9 < 8; d9++) {
          var nx7 = (i2 % game.W) + game.DX[d9],
            ny7 = ((i2 / game.W) | 0) + game.DY[d9];
          if (
            game.inB(nx7, ny7) &&
            reach[game.idx(nx7, ny7)] &&
            game.tiles[game.idx(nx7, ny7)].t === game.GRASS
          ) {
            n2++;
            break;
          }
        }
      }
      return n2;
    }
    function goldReachSum() {
      // Count buildable meadow faces; reachable sand cannot host a mine.
      var s2 = 0;
      for (var i5 = 0; i5 < game.tiles.length; i5++) {
        var t10 = game.tiles[i5];
        if (t10.t !== game.MTN || !t10.res || t10.res.kind !== 'gold') continue;
        for (var d13 = 0; d13 < 8; d13++) {
          var nx12 = (i5 % game.W) + game.DX[d13],
            ny12 = ((i5 / game.W) | 0) + game.DY[d13];
          if (
            game.inB(nx12, ny12) &&
            reach[game.idx(nx12, ny12)] &&
            game.tiles[game.idx(nx12, ny12)].t === game.GRASS
          ) {
            s2 += t10.res.amt;
            break;
          }
        }
      }
      return s2;
    }
    floodReach();
    for (var i3 = 0; i3 < game.tiles.length; i3++) {
      var t7 = game.tiles[i3];
      if (t7.t !== game.MTN || !t7.res || t7.res.kind !== 'gold') continue;
      var ok7 = false;
      for (var d10 = 0; d10 < 8; d10++) {
        var nx8 = (i3 % game.W) + game.DX[d10],
          ny8 = ((i3 / game.W) | 0) + game.DY[d10];
        if (
          game.inB(nx8, ny8) &&
          reach[game.idx(nx8, ny8)] &&
          game.tiles[game.idx(nx8, ny8)].t === game.GRASS
        ) {
          ok7 = true;
          break;
        }
      }
      if (!ok7) t7.res = null;
    }
    // All six upgrades cost 180 gold. Investing must still leave enough deposits
    // to win, with another 60 gold of margin even when no contracts are fulfilled.
    var guard8 = 0;
    while ((goldReachCount() < 3 || goldReachSum() < guaranteedGold) && guard8 < 80) {
      guard8++;
      var cands = [];
      for (var i4 = 0; i4 < game.tiles.length; i4++) {
        var t9 = game.tiles[i4];
        if (t9.t !== game.MTN) continue;
        if (t9.res && t9.res.kind === 'gold') continue;
        for (var d11 = 0; d11 < 8; d11++) {
          var nx9 = (i4 % game.W) + game.DX[d11],
            ny9 = ((i4 / game.W) | 0) + game.DY[d11];
          if (
            game.inB(nx9, ny9) &&
            reach[game.idx(nx9, ny9)] &&
            game.tiles[game.idx(nx9, ny9)].t === game.GRASS
          ) {
            cands.push(i4);
            break;
          }
        }
      }
      if (cands.length) {
        var pick = cands[(dr() * cands.length) | 0];
        var ga = 90 + ((dr() * 30) | 0);
        game.tiles[pick].res = { kind: 'gold', amt: ga, amt0: ga };
        floodReach();
        continue;
      }
      var done9 = false;
      for (var at9 = 0; at9 < 600 && !done9; at9++) {
        var ang9 = dr() * 6.28,
          di9 = 14 + dr() * 12;
        var gx9 = Math.round(cx + Math.cos(ang9) * di9),
          gy9 = Math.round(cy + Math.sin(ang9) * di9);
        if (!game.inB(gx9, gy9) || !reach[game.idx(gx9, gy9)]) continue;
        var t8 = game.tiles[game.idx(gx9, gy9)];
        if (t8.t !== game.GRASS || t8.tree || t8.rock) continue;
        var nb9 = 0;
        for (var d12 = 0; d12 < 4; d12++) {
          var ax9 = gx9 + game.DX[d12],
            ay9 = gy9 + game.DY[d12];
          if (game.inB(ax9, ay9) && game.passI(game.idx(ax9, ay9))) nb9++;
        }
        if (nb9 < 3) continue;
        var gb = 90 + ((dr() * 30) | 0);
        t8.t = game.MTN;
        t8.res = { kind: 'gold', amt: gb, amt0: gb };
        mtn++;
        done9 = true;
        floodReach();
      }
      if (!done9) break;
    }
    if (
      mtn < 20 ||
      land < game.W * game.H * 0.55 ||
      goldReachCount() < 3 ||
      goldReachSum() < guaranteedGold
    )
      return false;
    return true;
  }
  var owned = new Uint8Array(game.W * game.H);
  function projectTerritory(excludedId?: number) {
    const projected = new Uint8Array(game.W * game.H);
    for (var bi = 0; bi < game.buildings.length; bi++) {
      var b = game.buildings[bi];
      if (!b.done || b.type === 'well' || b.id === excludedId) continue;
      var sp = game.BSPEC[b.type];
      var rad = sp.rad || 0;
      if (sp.guard && !b.man) rad = Math.min(rad, 3);
      if (!rad) continue;
      var sx = b.x,
        sy = b.y,
        dist: Record<number, number> = {},
        q = [game.idx(sx, sy)],
        ds = [0];
      dist[game.idx(sx, sy)] = 0;
      for (var qi = 0; qi < q.length; qi++) {
        var i = q[qi],
          d = ds[qi];
        projected[i] = 1;
        if (d >= rad) continue;
        var x = i % game.W,
          y = (i / game.W) | 0;
        for (var dd = 0; dd < 4; dd++) {
          var nx = x + game.DX[dd],
            ny = y + game.DY[dd];
          if (!game.inB(nx, ny)) continue;
          var n = game.idx(nx, ny);
          if (dist[n] !== undefined || !game.passI(n)) continue;
          dist[n] = d + 1;
          q.push(n);
          ds.push(d + 1);
        }
      }
    }
    return projected;
  }
  function recomputeTerritory() {
    owned.set(projectTerritory());
    gpDirty = true;
    game.emitGameEvent('territoryChanged', {});
  }
  // ---- guard-post territory preview (read-only projection; never mutates `owned`) ----
  // Mirrors recomputeTerritory's flood exactly (manned radius) with a hypothetical guard at
  // x,y, so the placement ghost can show the *actual* new border — the plain radius diamond
  // in ghostDraw is wrong near water/ridges because territory floods around impassable tiles.
  var gpOwned = new Uint8Array(game.W * game.H),
    gpSegs: GuardPreviewSegment[] = [],
    gpFill: number[] = [],
    gpDirty = true,
    gpX = -1,
    gpY = -1;
  function gpFlood(sx: number, sy: number, rad: number) {
    var dist: Record<number, number> = {},
      q = [game.idx(sx, sy)],
      ds = [0];
    dist[game.idx(sx, sy)] = 0;
    for (var qi = 0; qi < q.length; qi++) {
      var i = q[qi],
        d = ds[qi];
      gpOwned[i] = 1;
      if (d >= rad) continue;
      var x = i % game.W,
        y = (i / game.W) | 0;
      for (var dd = 0; dd < 4; dd++) {
        var nx = x + game.DX[dd],
          ny = y + game.DY[dd];
        if (!game.inB(nx, ny)) continue;
        var n = game.idx(nx, ny);
        if (dist[n] !== undefined || !game.passI(n)) continue;
        dist[n] = d + 1;
        q.push(n);
        ds.push(d + 1);
      }
    }
  }
  function computeGuardPreview(x: number, y: number) {
    gpOwned.fill(0);
    gpSegs.length = 0;
    gpFill.length = 0;
    for (var bi = 0; bi < game.buildings.length; bi++) {
      var b = game.buildings[bi];
      if (!b.done || b.type === 'well') continue;
      var sp = game.BSPEC[b.type],
        rad = sp.rad || 0;
      if (sp.guard && !b.man) rad = Math.min(rad, 3);
      if (rad) gpFlood(b.x, b.y, rad);
    }
    gpFlood(x, y, game.BSPEC.guard.rad);
    for (var i = 0; i < game.W * game.H; i++) if (gpOwned[i] && !owned[i]) gpFill.push(i); // newly claimed tiles
    for (var y2 = 0; y2 < game.H; y2++)
      for (var x2 = 0; x2 < game.W; x2++) {
        // border edges not already in the live border
        var i2 = game.idx(x2, y2);
        if (!gpOwned[i2]) continue;
        var px = x2 * game.TS,
          py = y2 * game.TS;
        for (var d2 = 0; d2 < 4; d2++) {
          var nx2 = x2 + game.DX[d2],
            ny2 = y2 + game.DY[d2],
            outN = !game.inB(nx2, ny2) || !gpOwned[game.idx(nx2, ny2)];
          if (!outN) continue;
          if (owned[i2] && (!game.inB(nx2, ny2) || !owned[game.idx(nx2, ny2)])) continue; // existing live edge
          if (d2 === 0) gpSegs.push([px + game.TS, py, px + game.TS, py + game.TS]);
          else if (d2 === 1) gpSegs.push([px, py, px, py + game.TS]);
          else if (d2 === 2) gpSegs.push([px, py + game.TS, px + game.TS, py + game.TS]);
          else gpSegs.push([px, py, px + game.TS, py]);
        }
      }
    gpX = x;
    gpY = y;
    gpDirty = false;
  }
  // Test-only view of closure internals; never merged into the runtime.
  if (internals)
    Object.defineProperties(internals, {
      gpOwned: { get: () => gpOwned, enumerable: true },
    });

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    genMap,
    get owned() {
      return owned;
    },
    recomputeTerritory,
    projectTerritory,
    get gpSegs() {
      return gpSegs;
    },
    get gpFill() {
      return gpFill;
    },
    get gpDirty() {
      return gpDirty;
    },
    get gpX() {
      return gpX;
    },
    get gpY() {
      return gpY;
    },
    computeGuardPreview,
  };
}

/** Border edge segment in world pixels: [x1, y1, x2, y2]. */
export type GuardPreviewSegment = [number, number, number, number];

export interface MapSubsystem {
  genMap: () => void;
  readonly owned: Uint8Array<ArrayBuffer>;
  recomputeTerritory: () => void;
  projectTerritory: (excludedId?: number) => Uint8Array;
  /** Border edge segments of the previewed territory in world pixels: [x1, y1, x2, y2]. */
  readonly gpSegs: GuardPreviewSegment[];
  /** Tile indexes newly claimed by the previewed guard post. */
  readonly gpFill: number[];
  readonly gpDirty: boolean;
  readonly gpX: number;
  readonly gpY: number;
  computeGuardPreview: (x: number, y: number) => void;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface MapInternals {
  readonly gpOwned: Uint8Array<ArrayBuffer>;
}

export interface MapDependencies
  extends
    Pick<SimulationStateSubsystem, 'BSPEC' | 'buildings'>,
    Pick<
      WorldSubsystem,
      | 'DX'
      | 'DY'
      | 'GOAL'
      | 'GRASS'
      | 'H'
      | 'MTN'
      | 'SAND'
      | 'TS'
      | 'W'
      | 'WATER'
      | 'fbm'
      | 'idx'
      | 'inB'
      | 'mulberry32'
      | 'passI'
      | 'seed'
      | 'tiles'
    >,
    Pick<EventsSubsystem, 'emitGameEvent'>,
    Pick<NavigationSubsystem, 'landRegionTiles'> {}
