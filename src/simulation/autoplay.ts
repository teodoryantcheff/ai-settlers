import { discoveryRadius } from '../gameplay/discovery.ts';
import {
  countsAsWell,
  hasWellCoverage,
  projectTerritory,
  wellRadius,
  wellReaches,
} from '../gameplay/colony-rules.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { AdvisorSubsystem } from '../gameplay/advisor.ts';
import type { EconomySubsystem } from './economy.ts';
import type { StockLedgerSubsystem } from './stock-ledger.ts';
import type { RoadsSubsystem } from './roads.ts';
import type { NavigationSubsystem } from './navigation.ts';
import type { MapSubsystem } from './map.ts';
import type { Building, BuildingType, TilePoint } from '../types.ts';
import { goodsIn } from '../core/inventory.ts';

/** Deposit kinds a mine can be sited against. */
export type DepositKind = 'coal' | 'iron' | 'gold';

export function createAutoplay(
  game: AutoplayDependencies,
  internals?: AutoplayInternals,
): AutoplaySubsystem {
  function shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (game.SR() * (i + 1)) | 0,
        t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }
  function afford(bt: BuildingType) {
    const c = game.BSPEC[bt].cost || {};
    for (const g of goodsIn(c)) if (game.spendableStock(g) < (c[g] || 0)) return false;
    return true;
  }
  function randTile(): [number, number] {
    return [1 + ((game.SR() * (game.W - 2)) | 0), 1 + ((game.SR() * (game.H - 2)) | 0)];
  }
  function depositTiles(kinds: DepositKind[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < game.tiles.length; i++) {
      const tl = game.tiles[i];
      if (
        game.isRevealed(i) &&
        tl.t === game.MTN &&
        tl.deposit &&
        tl.deposit.amt > 0 &&
        kinds.indexOf(tl.deposit.kind) >= 0
      )
        out.push(i);
    }
    return out;
  }
  function mineDeficits(): DepositKind[] {
    const w: DepositKind[] = [],
      list = game.advTargets();
    for (const target of list) {
      const kind = game.BSPEC[target.bt].resKind;
      if (target.def > 0 && kind) w.push(kind);
    }
    return w;
  }
  function findSpot(bt: BuildingType, want?: DepositKind[] | null): [number, number] | null {
    const sp = game.BSPEC[bt];
    let i, d, nx, ny;
    if (sp.resKind) {
      const deps = depositTiles([sp.resKind]);
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
      const rr2 = sp.rad ?? 0,
        needTree = bt === 'lumberjack';
      for (let x = 1; x < game.W - 1; x++)
        for (let y = 1; y < game.H - 1; y++) {
          const ti = game.idx(x, y),
            tl3 = game.tiles[ti];
          if (!game.owned[ti] || tl3.t !== game.GRASS || tl3.tree || tl3.rock) continue;
          if (!game.canPlace(bt, x, y)[0]) continue;
          let hit = false;
          for (let yy = y - rr2; yy <= y + rr2 && !hit; yy++)
            for (let xx = x - rr2; xx <= x + rr2 && !hit; xx++) {
              if (!game.inB(xx, yy) || !game.isRevealed(game.idx(xx, yy))) continue;
              if ((x - xx) * (x - xx) + (y - yy) * (y - yy) > rr2 * rr2) continue;
              const tv = game.tiles[game.idx(xx, yy)];
              if (needTree ? tv.tree >= 3 : tv.rock) hit = true;
            }
          if (hit) return [x, y];
        }
      return null;
    }
    if (bt === 'guard') {
      if (game.state.explorationFog && (!want?.length || !depositTiles(want).length))
        return explorationSpot();
      const dep = want && want.length ? depositTiles(want) : null,
        top: Array<{ p: [number, number]; dd: number }> = [];
      for (let att = 0; att < 1200; att++) {
        const p = randTile(),
          gi = game.idx(p[0], p[1]);
        if (
          !game.isRevealed(gi) ||
          !game.owned[gi] ||
          game.tiles[gi].t !== game.GRASS ||
          isFaceTile(p[0], p[1], want) ||
          !game.canPlace(bt, p[0], p[1])[0]
        )
          continue;
        let frontier = false;
        for (d = 0; d < 8; d++) {
          nx = p[0] + game.DX[d];
          ny = p[1] + game.DY[d];
          if (
            game.inB(nx, ny) &&
            game.isRevealed(game.idx(nx, ny)) &&
            !game.owned[game.idx(nx, ny)] &&
            game.passI(game.idx(nx, ny))
          ) {
            frontier = true;
            break;
          }
        }
        if (!frontier) continue;
        if (!dep) return p;
        let dd = 1e9;
        for (i = 0; i < dep.length; i++) {
          const dx4 = Math.abs((dep[i] % game.W) - p[0]) + Math.abs(((dep[i] / game.W) | 0) - p[1]);
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
      let bestF: [number, number] | null = null,
        bdF = 1e9;
      for (let xf = 1; xf < game.W - 1; xf++)
        for (let yf = 1; yf < game.H - 1; yf++) {
          const tf = game.tiles[game.idx(xf, yf)];
          if (!game.owned[game.idx(xf, yf)] || tf.t !== game.GRASS || tf.tree || tf.rock) continue;
          if (!game.canPlace(bt, xf, yf)[0]) continue;
          let dF = 1e9;
          for (let k3 = 0; k3 < game.buildings.length; k3++) {
            const lb2 = game.buildings[k3];
            if (lb2.done && lb2.type === 'lumberjack') {
              const ddF = Math.abs(lb2.x - xf) + Math.abs(lb2.y - yf);
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
      const anchors = game.buildings.filter(function (b) {
        return bt === 'well'
          ? (b.type === 'bakery' || b.type === 'brewery') && !hasWellCoverage(game, b, 'planned')
          : countsAsWell(b, 'active');
      });
      // Candidate offsets stay one tile inside the service radius.
      const reach = wellRadius(game) - 1;
      for (const anchor of anchors)
        for (let oy = -reach; oy <= reach; oy++)
          for (let ox = -reach; ox <= reach; ox++) {
            const wx = anchor.x + ox,
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
      for (let sy = 1; sy < game.H - 1; sy++)
        for (let sx = 1; sx < game.W - 1; sx++) {
          if (!game.canPlace('well', sx, sy)[0]) continue;
          const storage = game.nearestStoragePos(sx, sy);
          if (storage && game.connectedLand(sx, sy, storage.x, storage.y)) return [sx, sy];
        }
    }
    if (bt === 'warehouse') {
      // site it beside the most remote worker so carriers spawn near the frontier cluster
      let farB: Building | null = null,
        fd = 0;
      for (let i = 0; i < game.buildings.length; i++) {
        const b4 = game.buildings[i];
        if (!b4.done || game.BSPEC[b4.type].store) continue;
        const s5 = game.nearestStoragePos(b4.x, b4.y);
        if (!s5) continue;
        const dd5 = Math.hypot(b4.x - s5.x, b4.y - s5.y);
        if (dd5 > fd) {
          fd = dd5;
          farB = b4;
        }
      }
      if (farB) {
        let bestW: [number, number] | null = null,
          bdW = 1e9;
        for (let xw = 1; xw < game.W - 1; xw++)
          for (let yw = 1; yw < game.H - 1; yw++) {
            const tw2 = game.tiles[game.idx(xw, yw)];
            if (!game.owned[game.idx(xw, yw)] || tw2.t !== game.GRASS || tw2.tree || tw2.rock)
              continue;
            if (!game.canPlace(bt, xw, yw)[0]) continue;
            const dw = Math.abs(farB.x - xw) + Math.abs(farB.y - yw);
            if (dw < bdW) {
              bdW = dw;
              bestW = [xw, yw];
            }
          }
        if (bestW) return bestW;
      }
    }
    for (let att2 = 0; att2 < 400; att2++) {
      const q = randTile();
      if (game.canPlace(bt, q[0], q[1])[0]) return q;
    }
    return null;
  }
  /** Choose a known buildable frontier by the unexplored area it would reveal.
   * Stable coordinate ties make exploration reproducible without consulting terrain under fog. */
  function explorationSpot(): [number, number] | null {
    let best: [number, number] | null = null;
    let score = 0;
    const r = discoveryRadius(game, { type: 'guard', x: 0, y: 0, manned: true });
    for (let y = 1; y < game.H - 1; y++)
      for (let x = 1; x < game.W - 1; x++) {
        if (
          !game.isRevealed(game.idx(x, y)) ||
          !game.owned[game.idx(x, y)] ||
          !game.canPlace('guard', x, y)[0]
        )
          continue;
        let unknown = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(game.H - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(game.W - 1, x + r); xx++)
            if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r && !game.isRevealed(game.idx(xx, yy)))
              unknown++;
        // Explore a coherent heading on ties rather than scattering scarce outposts.
        const value = unknown * 10000 + x * 10 - Math.abs(y - game.H / 2);
        if (unknown && value > score) {
          score = value;
          best = [x, y];
        }
      }
    return best;
  }
  function clearNeighbor(b: Building): TilePoint | null {
    for (let d = 0; d < 8; d++) {
      const nx = b.x + game.DX[d],
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
    let has = false;
    game.forRadius(b, r, function (i) {
      if (game.tiles[i].road) has = true;
    });
    return has;
  }
  function buildCorridor(want: DepositKind[]): number[] | null {
    // walking routes from the warehouse to the nearest live wanted deposits; the route to a live
    // GOLD deposit is always included when gold is wanted (it feeds the victory condition)
    const s = game.anyStorage();
    if (!s) return null;
    const deps = depositTiles(want),
      golds: number[] = [],
      others: number[] = [];
    for (let k = 0; k < deps.length; k++)
      (game.tiles[deps[k]].deposit?.kind === 'gold' ? golds : others).push(deps[k]);
    function byDist(arr: number[], storage: Building) {
      arr.sort(function (a, b) {
        const da =
          ((a % game.W) - storage.x) * ((a % game.W) - storage.x) +
          (((a / game.W) | 0) - storage.y) * (((a / game.W) | 0) - storage.y);
        const db =
          ((b % game.W) - storage.x) * ((b % game.W) - storage.x) +
          (((b / game.W) | 0) - storage.y) * (((b / game.W) | 0) - storage.y);
        return da - db;
      });
    }
    byDist(others, s);
    byDist(golds, s);
    // gold is the victory resource - go for the biggest live gold deposit, not the nearest one;
    // small deposits exhaust too fast and the re-expansion churn eats the whole guard budget
    golds.sort(function (a, b) {
      return (game.tiles[b].deposit?.amt || 0) - (game.tiles[a].deposit?.amt || 0);
    });
    const take: number[] = [];
    if (golds.length && want.indexOf('gold') >= 0) take.push(golds[0]);
    for (let k = 0; k < others.length && take.length < 6; k++) take.push(others[k]);
    if (!take.length) return null;
    let path: number[] | null = null;
    for (let k = 0; k < take.length; k++) {
      const di = take[k];
      let dl = -1;
      for (let d = 0; d < 8; d++) {
        const nx = (di % game.W) + game.DX[d],
          ny = ((di / game.W) | 0) + game.DY[d];
        if (game.inB(nx, ny) && game.isRevealed(game.idx(nx, ny)) && game.passI(game.idx(nx, ny))) {
          dl = game.idx(nx, ny);
          break;
        }
      }
      if (dl < 0) continue;
      const p = game.findPath(s.x, s.y, dl % game.W, (dl / game.W) | 0, game.isRevealed);
      if (!p) continue;
      if (!path || game.tiles[di].deposit?.kind === 'gold') path = p;
    }
    return path;
  }
  function isFaceTile(x: number, y: number, want?: DepositKind[] | null) {
    // Reserve both meadow mining faces and their building-spacing clearance.
    // An outpost one tile behind a face blocks that mine just as surely as an
    // outpost built on the face itself, even after its border reaches the ore.
    if (!want || !want.length) return false;
    for (let fy = y - 1; fy <= y + 1; fy++)
      for (let fx = x - 1; fx <= x + 1; fx++) {
        if (
          !game.inB(fx, fy) ||
          !game.isRevealed(game.idx(fx, fy)) ||
          game.tiles[game.idx(fx, fy)].t !== game.GRASS
        )
          continue;
        for (let d = 0; d < 8; d++) {
          const nx = fx + game.DX[d],
            ny = fy + game.DY[d];
          if (!game.inB(nx, ny) || !game.isRevealed(game.idx(nx, ny))) continue;
          const t = game.tiles[game.idx(nx, ny)];
          if (t.t === game.MTN && t.deposit && t.deposit.amt > 0 && want.includes(t.deposit.kind))
            return true;
        }
      }
    return false;
  }
  function spotOnCorridor(cor: number[] | null, want: DepositKind[]): [number, number] | null {
    if (!cor || !cor.length) return null;
    // The road can pass through reserved mine faces or a narrow coastal bend. Search
    // nearby buildable land and score the territory its manned flood would add.
    // Repeating an already-covered route tile cannot advance an expansion chain.
    const candidates = new Uint8Array(game.W * game.H);
    const goal = cor[cor.length - 1],
      gx = goal % game.W,
      gy = (goal / game.W) | 0;
    const critical = [goal];
    let missing = 0;
    if (!game.owned[goal]) missing++;
    for (let d = 0; d < 4; d++) {
      const nx = gx + game.DX[d],
        ny = gy + game.DY[d];
      if (!game.inB(nx, ny) || !game.isRevealed(game.idx(nx, ny)) || !game.passI(game.idx(nx, ny)))
        continue;
      critical.push(game.idx(nx, ny));
      if (!game.owned[game.idx(nx, ny)]) missing++;
    }
    let best: [number, number] | null = null,
      bestScore = -Infinity;
    for (let q = cor.length - 1; q >= 0; q--) {
      const px = cor[q] % game.W,
        py = (cor[q] / game.W) | 0;
      for (let oy = -3; oy <= 3; oy++)
        for (let ox = -3; ox <= 3; ox++) {
          const x = px + ox,
            y = py + oy;
          if (!game.inB(x, y)) continue;
          const site = game.idx(x, y);
          if (candidates[site]) continue;
          candidates[site] = 1;
          if (!game.owned[site] || isFaceTile(x, y, want) || !game.canPlace('guard', x, y)[0])
            continue;
          const projected = projectTerritory(
            { ...game, passI: (i) => game.isRevealed(i) && game.passI(i) },
            [{ type: 'guard', x, y, done: true, manned: true }],
          );
          let advance = -1,
            criticalHits = 0;
          for (let route = cor.length - 1; route >= 0; route--) {
            const current = cor[route];
            if (!game.owned[current] && projected[current]) {
              advance = route;
              break;
            }
          }
          for (const current of critical)
            if (!game.owned[current] && projected[current]) criticalHits++;
          if (advance < 0 && !criticalHits) continue;
          let score = advance * 100 + criticalHits * 1000 - Math.hypot(x - gx, y - gy);
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
    let best = -1;
    for (let q = 0; q < cor.length; q++) {
      const px2 = cor[q] % game.W,
        py2 = (cor[q] / game.W) | 0;
      if (Math.max(Math.abs(px2 - tx), Math.abs(py2 - ty)) <= 2 && q > best) best = q;
    }
    return best;
  }
  function guardCoverRedundant(g: Building, want: DepositKind[]) {
    // a manned guard earns its keep only while its territory covers a standing mine or a live
    // wanted deposit; rear-of-chain guards whose deposits are gone are recyclable scaffolding
    const r = (game.BSPEC[g.type].rad ?? 0) + 2;
    let keep = false;
    game.forRadius(g, r, function (i) {
      const tl = game.tiles[i],
        bAt = game.buildingAt(i % game.W, (i / game.W) | 0);
      if (bAt && game.BSPEC[bAt.type].prod === 'mine') keep = true;
      else if (
        game.isRevealed(i) &&
        tl.t === game.MTN &&
        tl.deposit &&
        tl.deposit.amt > 0 &&
        want.indexOf(tl.deposit.kind) >= 0
      )
        keep = true;
    });
    return !keep;
  }
  function guardTerritoryRedundant(guard: Building) {
    // A route index cannot prove a claim is dispensable around winding coastlines.
    // Project territory without this outpost and retain it whenever any land would
    // leave the colony. This also protects the approach to the next construction site.
    const covered = projectTerritory(
      game,
      game.buildings.filter((building) => building !== guard),
    );
    for (let i = 0; i < game.owned.length; i++) if (game.owned[i] && !covered[i]) return false;
    return true;
  }
  function autoRoad() {
    let best: Building | null = null,
      bs: Building | null = null,
      bd = 0;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i];
      if (!b.done || game.BSPEC[b.type].store) continue;
      const s = game.nearestStoragePos(b.x, b.y);
      if (!s) continue;
      const d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d > bd) {
        bd = d;
        best = b;
        bs = s;
      }
    }
    if (!best || !bs || bd < 12 || roadNear(best, 3)) return;
    const a1 = clearNeighbor(bs),
      a2 = clearNeighbor(best);
    if (a1 && a2) game.commitRoad(a1, a2);
  }
  let autoT = 0;
  function autoTick(dt: number, planningSuspended = false) {
    autoT -= dt;
    if (autoT > 0) return;
    autoT = 2;
    if (planningSuspended) return;
    // 1a) clear dead weight BEFORE siting the corridor - exhausted mines and starved quarries -
    // so the corridor targets the post-cleanup world
    for (let i = game.buildings.length - 1; i >= 0; i--) {
      const b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || b.type === 'hq') continue;
      if (b.exhausted || (sp.prod === 'rock' && game.buildingStatus(b).bad)) game.demolish(b); // fresh, never the 800ms wall-clock HUD cache - AI decisions must not depend on rAF timing
    }
    const list = game.advTargets(),
      want = mineDeficits();
    let gcount = 0,
      minesN = 0,
      farmN = 0;
    for (let i = 0; i < game.buildings.length; i++) {
      const ty2 = game.buildings[i].type;
      if (ty2 === 'guard') gcount++;
      else if (ty2 === 'farm') farmN++;
      if (game.BSPEC[ty2].prod === 'mine') minesN++;
    }
    const farmCap = 3 + 2 * minesN;
    const cor = buildCorridor(want);
    // 1b) recycle redundant manned guards (garrison+weapon return on raze) - one per tick,
    // Keep the newest manned outpost as well as the corridor's apparent front. Around
    // water, the next useful claim can sit earlier on that route; recycling it immediately
    // traps expansion in a build/raze loop before its territory can support the next site.
    let razed = false,
      frontB = null,
      newestGuard = null,
      frontQ = -1;
    for (let i = 0; i < game.buildings.length; i++) {
      const gb2 = game.buildings[i];
      if (gb2.type !== 'guard' || !gb2.manned) continue;
      if (!newestGuard || gb2.id > newestGuard.id) newestGuard = gb2;
      if (cor) {
        const gq = pathPos(cor, gb2.x, gb2.y);
        if (gq > frontQ) {
          frontQ = gq;
          frontB = gb2;
        }
      }
    }
    for (let i = game.buildings.length - 1; i >= 0; i--) {
      const b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || b.type === 'hq') continue;
      if (
        !razed &&
        sp.guard &&
        b.manned &&
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
    let expand = false;
    for (let i = 0; i < list.length; i++) {
      const r = list[i],
        bt: BuildingType = r.bt;
      if (r.def <= 0 || !game.BSPEC[bt].resKind) continue;
      if (!afford(bt)) {
        expand = true;
        continue;
      }
      const spot = findSpot(bt, null);
      if (spot && game.placeBuilding(bt, spot[0], spot[1])) return;
      expand = true;
    }
    // 3) push the border toward the wanted deposits with guard posts - one at a time: wait until
    // the previous guard is manned (its radius is what carries the next one forward)
    let unmanned = 0;
    for (let i = 0; i < game.buildings.length; i++)
      if (game.buildings[i].type === 'guard' && !game.buildings[i].manned) unmanned++;
    if (expand && gcount < 18 && unmanned === 0 && game.soldierPool > 0 && afford('guard')) {
      const gs = spotOnCorridor(cor, want) || findSpot('guard', want);
      if (gs && game.placeBuilding('guard', gs[0], gs[1])) return;
    }
    // 4) everything else (the advisor's guard row is deliberately skipped - expansion is
    // exclusively the corridor's job, gated by the manning chain in step 3)
    for (let i = 0; i < list.length; i++) {
      const r = list[i],
        bt: BuildingType = r.bt;
      if (r.def <= 0 || game.BSPEC[bt].resKind || bt === 'guard') continue;
      if (!afford(bt)) continue;
      const spot = findSpot(bt, null);

      if (spot && game.placeBuilding(bt, spot[0], spot[1])) return;
    }
    // 4) nothing buildable left this tick - recycle a surplus farm for its refund so the economy can reboot
    if (farmN > farmCap) {
      for (let i = 0; i < game.buildings.length; i++) {
        const fb = game.buildings[i];
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
  findSpot: (bt: BuildingType, want?: DepositKind[] | null) => [number, number] | null;
  buildCorridor: (want: DepositKind[]) => number[] | null;
  isFaceTile: (x: number, y: number, want?: DepositKind[] | null) => boolean;
  spotOnCorridor: (cor: number[] | null, want: DepositKind[]) => [number, number] | null;
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
    Pick<SimulationStateSubsystem, 'BSPEC' | 'buildings' | 'soldierPool' | 'state'>,
    Pick<
      WorldSubsystem,
      'DX' | 'DY' | 'GRASS' | 'H' | 'MTN' | 'SR' | 'W' | 'idx' | 'inB' | 'passI' | 'tiles'
    >,
    Pick<AdvisorSubsystem, 'advTargets'>,
    Pick<
      EconomySubsystem,
      | 'anyStorage'
      | 'buildingAt'
      | 'buildingStatus'
      | 'canPlace'
      | 'demolish'
      | 'forRadius'
      | 'nearestStoragePos'
      | 'placeBuilding'
    >,
    Pick<StockLedgerSubsystem, 'spendableStock'>,
    Pick<RoadsSubsystem, 'commitRoad'>,
    Pick<NavigationSubsystem, 'findPath' | 'connectedLand'>,
    Pick<MapSubsystem, 'owned' | 'isRevealed'> {}
