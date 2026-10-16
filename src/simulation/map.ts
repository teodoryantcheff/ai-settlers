import { projectTerritory as projectColonyTerritory } from '../gameplay/colony-rules.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { NavigationSubsystem } from './navigation.ts';

export function createMap(game: MapDependencies, internals?: MapInternals): MapSubsystem {
  function genMap() {
    game.landRegionTiles = null;
    let att,
      ok = false;
    for (att = 0; att < 200 && !ok; att++) {
      ok = tryGen();
      if (!ok) game.seed += 7;
    }
  }
  function tryGen() {
    let i,
      x,
      y,
      land = 0,
      mtn = 0;
    const e = game.fbm(game.seed),
      e2 = game.fbm(game.seed + 101),
      tn = game.fbm(game.seed + 202),
      rn = game.fbm(game.seed + 303);
    const dr = game.mulberry32(game.seed + 404); // all map-gen rolls are seeded -> ?seed=N is fully reproducible
    for (i = 0; i < game.W * game.H; i++)
      game.tiles[i] = {
        t: game.GRASS,
        tree: 0,
        rock: null,
        road: false,
        owned: false,
        deposit: null,
      };
    for (y = 0; y < game.H; y++)
      for (x = 0; x < game.W; x++) {
        const u = x / game.W,
          v = y / game.H,
          h = e(u, v) * 0.75 + e2(u, v) * 0.25;
        let t = game.GRASS;
        if (h < 0.3) t = game.WATER;
        else if (h < 0.35) t = game.SAND;
        else if (h > 0.74) t = game.MTN;
        const tl = game.tiles[game.idx(x, y)];
        tl.t = t;
        if (t === game.GRASS && tn(u, v) > 0.6) tl.tree = 4;
        if (t === game.GRASS && rn(u, v) > 0.66)
          tl.rock = { amt: 30 + ((rn(u + 0.3, v + 0.7) * 40) | 0) };
        if (t === game.MTN) {
          mtn++;
          const r2 = dr();
          if (r2 < 0.3) tl.deposit = null;
          else if (r2 < 0.42) {
            const g0 = 60 + ((dr() * 40) | 0);
            tl.deposit = { kind: 'gold', amt: g0, amt0: g0 };
          } else if (r2 < 0.72) {
            const i0 = 60 + ((dr() * 50) | 0);
            tl.deposit = { kind: 'iron', amt: i0, amt0: i0 };
          } else {
            const c0 = 80 + ((dr() * 60) | 0);
            tl.deposit = { kind: 'coal', amt: c0, amt0: c0 };
          }
        }
        if (t !== game.WATER) land++;
      }
    const cx = game.W >> 1,
      cy = game.H >> 1;
    let x2, y2;
    for (y2 = cy - 9; y2 <= cy + 9; y2++)
      for (x2 = cx - 9; x2 <= cx + 9; x2++) {
        const tl2 = game.tiles[game.idx(x2, y2)];
        tl2.t = game.GRASS;
        tl2.tree = 0;
        tl2.rock = null;
        tl2.deposit = null;
      }
    for (let a = 0; a < 360; a += 4) {
      const rr = 9 + dr() * 5,
        tx2 = Math.round(cx + Math.cos((a * Math.PI) / 180) * rr),
        ty2 = Math.round(cy + Math.sin((a * Math.PI) / 180) * rr);
      if (game.inB(tx2, ty2) && game.tiles[game.idx(tx2, ty2)].t === game.GRASS && dr() < 0.7)
        game.tiles[game.idx(tx2, ty2)].tree = 4;
    }
    for (let a2 = 0; a2 < 360; a2 += 45) {
      const rr2 = 12 + dr() * 4,
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
        const ridgeX = x2 - (cx + 20),
          ridgeY = y2 - cy;
        const ridgeEdge = [2, 3, 4, 3, 4, 3, 2][ridgeX];
        if (Math.abs(ridgeY + 1) > ridgeEdge && !(x2 === cx + 26 && (y2 === cy - 2 || y2 === cy)))
          continue;
        if (game.inB(x2, y2)) {
          const tm = game.tiles[game.idx(x2, y2)];
          tm.t = game.MTN;
          tm.tree = 0;
          tm.rock = null;
          tm.deposit =
            y2 === cy - 3 || y2 === cy
              ? { kind: 'coal', amt: 120, amt0: 120 }
              : { kind: 'iron', amt: 90, amt0: 90 };
        }
      }
    // Keep the optional investment budget at the familiar mining frontier. A
    // sparse map must not require a second distant campaign after buying upgrades.
    const guaranteedGold = game.GOAL + 180 + 60,
      faceGold = Math.ceil(guaranteedGold / 2),
      gA = faceGold + ((dr() * 40) | 0),
      gB = faceGold + ((dr() * 40) | 0);
    game.tiles[game.idx(cx + 26, cy - 2)].deposit = { kind: 'gold', amt: gA, amt0: gA };
    game.tiles[game.idx(cx + 26, cy)].deposit = { kind: 'gold', amt: gB, amt0: gB };
    for (y2 = cy - 5; y2 <= cy + 2; y2++)
      for (x2 = cx + 27; x2 <= cx + 29; x2++) {
        if (game.inB(x2, y2)) {
          const tg = game.tiles[game.idx(x2, y2)];
          tg.t = game.GRASS;
          tg.tree = 0;
          tg.rock = null;
          tg.deposit = null;
          tg.road = false;
        }
      }
    let lakeOK = false;
    for (let dy3 = -30; dy3 <= 30 && !lakeOK; dy3++)
      for (let dx3 = -30; dx3 <= 30 && !lakeOK; dx3++)
        if (
          game.inB(cx + dx3, cy + dy3) &&
          game.tiles[game.idx(cx + dx3, cy + dy3)].t === game.WATER
        )
          lakeOK = true;
    if (!lakeOK) {
      const la = dr() * 6.28,
        ld = 14 + dr() * 3,
        lx = Math.round(cx + Math.cos(la) * ld),
        ly = Math.round(cy + Math.sin(la) * ld);
      for (let wy2 = ly - 3; wy2 <= ly + 3; wy2++)
        for (let wx2 = lx - 4; wx2 <= lx + 4; wx2++) {
          if (!game.inB(wx2, wy2)) continue;
          const dn2 = (wx2 - lx) / 4.4,
            de2 = (wy2 - ly) / 3.4;
          if (dn2 * dn2 + de2 * de2 <= 1) {
            const lw = game.tiles[game.idx(wx2, wy2)];
            lw.t = game.WATER;
            lw.tree = 0;
            lw.rock = null;
            lw.deposit = null;
            lw.road = false;
          }
        }
      for (let wy3 = ly - 4; wy3 <= ly + 4; wy3++)
        for (let wx3 = lx - 5; wx3 <= lx + 5; wx3++) {
          if (!game.inB(wx3, wy3)) continue;
          const ls = game.tiles[game.idx(wx3, wy3)];
          if (ls.t === game.GRASS) {
            let adj2 = false;
            for (let d5 = 0; d5 < 4; d5++) {
              const aw = game.tiles[game.idx(wx3 + game.DX[d5], wy3 + game.DY[d5])];
              if (aw && aw.t === game.WATER) adj2 = true;
            }
            if (adj2) ls.t = game.SAND;
          }
        }
    }
    const reach = new Uint8Array(game.W * game.H);
    function floodReach() {
      reach.fill(0);
      const st5 = [game.idx(cx, cy)];
      reach[game.idx(cx, cy)] = 1;
      while (st5.length) {
        const s6 = st5.pop()!,
          sx6 = s6 % game.W,
          sy6 = (s6 / game.W) | 0;
        for (let d8 = 0; d8 < 4; d8++) {
          const nx6 = sx6 + game.DX[d8],
            ny6 = sy6 + game.DY[d8];
          if (!game.inB(nx6, ny6)) continue;
          const n6 = game.idx(nx6, ny6);
          if (reach[n6] || !game.passI(n6)) continue;
          reach[n6] = 1;
          st5.push(n6);
        }
      }
    }
    function goldReachCount() {
      let n2 = 0;
      for (let i2 = 0; i2 < game.tiles.length; i2++) {
        const t6 = game.tiles[i2];
        if (t6.t !== game.MTN || !t6.deposit || t6.deposit.kind !== 'gold') continue;
        for (let d9 = 0; d9 < 8; d9++) {
          const nx7 = (i2 % game.W) + game.DX[d9],
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
      let s2 = 0;
      for (let i5 = 0; i5 < game.tiles.length; i5++) {
        const t10 = game.tiles[i5];
        if (t10.t !== game.MTN || !t10.deposit || t10.deposit.kind !== 'gold') continue;
        for (let d13 = 0; d13 < 8; d13++) {
          const nx12 = (i5 % game.W) + game.DX[d13],
            ny12 = ((i5 / game.W) | 0) + game.DY[d13];
          if (
            game.inB(nx12, ny12) &&
            reach[game.idx(nx12, ny12)] &&
            game.tiles[game.idx(nx12, ny12)].t === game.GRASS
          ) {
            s2 += t10.deposit.amt;
            break;
          }
        }
      }
      return s2;
    }
    floodReach();
    for (let i3 = 0; i3 < game.tiles.length; i3++) {
      const t7 = game.tiles[i3];
      if (t7.t !== game.MTN || !t7.deposit || t7.deposit.kind !== 'gold') continue;
      let ok7 = false;
      for (let d10 = 0; d10 < 8; d10++) {
        const nx8 = (i3 % game.W) + game.DX[d10],
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
      if (!ok7) t7.deposit = null;
    }
    // All six upgrades cost 180 gold. Investing must still leave enough deposits
    // to win, with another 60 gold of margin even when no contracts are fulfilled.
    let guard8 = 0;
    while ((goldReachCount() < 3 || goldReachSum() < guaranteedGold) && guard8 < 80) {
      guard8++;
      const cands = [];
      for (let i4 = 0; i4 < game.tiles.length; i4++) {
        const t9 = game.tiles[i4];
        if (t9.t !== game.MTN) continue;
        if (t9.deposit && t9.deposit.kind === 'gold') continue;
        for (let d11 = 0; d11 < 8; d11++) {
          const nx9 = (i4 % game.W) + game.DX[d11],
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
        const pick = cands[(dr() * cands.length) | 0];
        const ga = 90 + ((dr() * 30) | 0);
        game.tiles[pick].deposit = { kind: 'gold', amt: ga, amt0: ga };
        floodReach();
        continue;
      }
      let done9 = false;
      for (let at9 = 0; at9 < 600 && !done9; at9++) {
        const ang9 = dr() * 6.28,
          di9 = 14 + dr() * 12;
        const gx9 = Math.round(cx + Math.cos(ang9) * di9),
          gy9 = Math.round(cy + Math.sin(ang9) * di9);
        if (!game.inB(gx9, gy9) || !reach[game.idx(gx9, gy9)]) continue;
        const t8 = game.tiles[game.idx(gx9, gy9)];
        if (t8.t !== game.GRASS || t8.tree || t8.rock) continue;
        let nb9 = 0;
        for (let d12 = 0; d12 < 4; d12++) {
          const ax9 = gx9 + game.DX[d12],
            ay9 = gy9 + game.DY[d12];
          if (game.inB(ax9, ay9) && game.passI(game.idx(ax9, ay9))) nb9++;
        }
        if (nb9 < 3) continue;
        const gb = 90 + ((dr() * 30) | 0);
        t8.t = game.MTN;
        t8.deposit = { kind: 'gold', amt: gb, amt0: gb };
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
  const owned = new Uint8Array(game.W * game.H);
  function projectTerritory(excludedId?: number) {
    return projectColonyTerritory(
      game,
      game.buildings.filter((building) => building.id !== excludedId),
    );
  }
  function recomputeTerritory() {
    owned.set(projectTerritory());
    gpDirty = true;
    game.emitGameEvent('territoryChanged', {});
  }
  // ---- guard-post territory preview (read-only projection; never mutates `owned`) ----
  // Project a hypothetical manned guard so the ghost shows the eventual border,
  // including detours around water and ridges, without changing the live colony.
  const gpOwned = new Uint8Array(game.W * game.H),
    gpSegs: GuardPreviewSegment[] = [],
    gpFill: number[] = [];
  let gpDirty = true,
    gpX = -1,
    gpY = -1;
  function computeGuardPreview(x: number, y: number) {
    gpOwned.set(
      projectColonyTerritory(game, [
        ...game.buildings,
        { type: 'guard', x, y, done: true, manned: true },
      ]),
    );
    gpSegs.length = 0;
    gpFill.length = 0;
    for (let i = 0; i < game.W * game.H; i++) if (gpOwned[i] && !owned[i]) gpFill.push(i); // newly claimed tiles
    for (let y2 = 0; y2 < game.H; y2++)
      for (let x2 = 0; x2 < game.W; x2++) {
        // border edges not already in the live border
        const i2 = game.idx(x2, y2);
        if (!gpOwned[i2]) continue;
        const px = x2 * game.TS,
          py = y2 * game.TS;
        for (let d2 = 0; d2 < 4; d2++) {
          const nx2 = x2 + game.DX[d2],
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
