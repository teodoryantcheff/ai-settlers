import {
  hasWellCoverage,
  wellRadius,
  productionOutputLimit,
  productionOutputBlocked,
  intermediateReserves,
  productionReserves,
} from '../gameplay/colony-rules.ts';
import { deliveryStage } from './delivery-stage.ts';
import type { ObservationSubsystem } from './observations.ts';
import {
  edibleGoods,
  eligibleIngredients,
  ingredientsConsumedNext,
  ingredientShortages,
  productionTiming,
  foodVarietyBonus,
} from '../gameplay/production-rules.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { AutoplaySubsystem } from './autoplay.ts';
import type { NavigationSubsystem } from './navigation.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { ProgressionSubsystem } from '../gameplay/progression.ts';
import type { MapSubsystem } from './map.ts';
import type {
  Building,
  BuildingStatus,
  BuildingType,
  GameEvents,
  Good,
  Inventory,
  Job,
  ProductionMetrics,
  ProductionRateWindow,
  ProductionSample,
  ProductionWindowMetrics,
  Unit,
} from '../types.ts';

interface StorageSearchOptions {
  available?: Good;
  connected?: boolean;
  exclude?: Building;
  retainTarget?: boolean;
  /** Keep distance rounding identical to each original caller for deterministic ties. */
  euclidean?: boolean;
}

export function createEconomy(
  game: EconomyDependencies,
  internals?: EconomyInternals,
): EconomySubsystem {
  // Membership caches for the hot lookups below. buildingVersion covers mutations
  // performed here (placement, demolition, completion); the source-array identity
  // and length keys cover replacements (save load) and edits made elsewhere
  // (initial HQ placement, dev scenarios). storages() additionally validates a
  // per-building done/store signature so completion flips made outside this
  // subsystem (tests, tools) stay visible; a cache hit never allocates.
  // No caller mutates the array storages() returns.
  let buildingVersion = 0,
    storagesSource: Building[] = null,
    storagesVersion = -1,
    storagesLength = -1,
    storagesCache: Building[] = null,
    storagesSig: boolean[] = null,
    byIdSource: Building[] = null,
    byIdVersion = -1,
    byIdLength = -1;
  const byIdMap = new Map<number, Building>();
  let unitsDirty = false,
    unitsSource: Unit[] = null;
  function byId(id: number): Building | null {
    if (
      byIdSource !== game.buildings ||
      byIdVersion !== buildingVersion ||
      byIdLength !== game.buildings.length
    ) {
      byIdMap.clear();
      for (let i = 0; i < game.buildings.length; i++) {
        const b = game.buildings[i];
        if (!byIdMap.has(b.id)) byIdMap.set(b.id, b);
      }
      byIdSource = game.buildings;
      byIdVersion = buildingVersion;
      byIdLength = game.buildings.length;
    }
    const found = byIdMap.get(id);
    return found === undefined ? null : found;
  }
  function buildingAt(x: number, y: number): Building | null {
    for (let i = 0; i < game.buildings.length; i++)
      if (game.buildings[i].x === x && game.buildings[i].y === y) return game.buildings[i];
    return null;
  }
  function storages(): Building[] {
    const src = game.buildings,
      n = src.length;
    let i = 0,
      b: Building = null;
    if (
      storagesCache !== null &&
      storagesSource === src &&
      storagesVersion === buildingVersion &&
      storagesLength === n
    ) {
      let fresh = true;
      for (i = 0; i < n; i++) {
        b = src[i];
        if (!!(b.done && game.BSPEC[b.type].store) !== storagesSig[i]) {
          fresh = false;
          break;
        }
      }
      if (fresh) return storagesCache;
    }
    const r = [],
      sig = [];
    for (i = 0; i < n; i++) {
      b = src[i];
      const isStore = !!(b.done && game.BSPEC[b.type].store);
      sig.push(isStore);
      if (isStore) r.push(b);
    }
    storagesCache = r;
    storagesSig = sig;
    storagesSource = src;
    storagesVersion = buildingVersion;
    storagesLength = n;
    return r;
  }
  function anyStorage(): Building | null {
    const s = storages();
    return s.length ? s[0] : null;
  }
  /** Closest eligible store; strict comparison keeps the first store on equal distances. */
  function nearestStorage(
    ref: Pick<Building, 'x' | 'y'>,
    options: StorageSearchOptions = {},
  ): Building | null {
    let best = null,
      distance = options.euclidean ? Infinity : 1e9;
    const ss = storages();
    for (let i = 0; i < ss.length; i++) {
      const store = ss[i];
      if (store === options.exclude) continue;
      if (options.available) {
        const good = options.available;
        const free =
          (store.stock[good] | 0) -
          (store.res[good] | 0) -
          (options.retainTarget ? (store.targets || {})[good] | 0 : 0);
        if (free <= 0) continue;
      }
      if (options.connected && !game.connectedLand(ref.x, ref.y, store.x, store.y)) continue;
      const dx = store.x - ref.x,
        dy = store.y - ref.y;
      const d = options.euclidean ? Math.hypot(dx, dy) : dx * dx + dy * dy;
      if (d < distance) {
        best = store;
        distance = d;
      }
    }
    return best;
  }
  function nearestStoragePos(x: number, y: number): Building | null {
    return nearestStorage({ x, y }, { connected: true });
  }
  function totalGood(g: Good) {
    let s = 0;
    const ss = storages();
    for (let i = 0; i < ss.length; i++) s += ss[i].stock[g] | 0;
    return s;
  }
  function liveMines() {
    let n = 0;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i];
      if (b.done && !b.exhausted && game.BSPEC[b.type].prod === 'mine') n++;
    }
    return n;
  }
  function stockTargetTotal(g: Good) {
    let target = 0;
    const ss = storages();
    for (let i = 0; i < ss.length; i++) target += Math.max(0, (ss[i].targets || {})[g] | 0);
    return target;
  }
  function foodSaturated(good?: Good) {
    if (good) return totalGood(good) >= Math.max(6 + 2 * liveMines(), stockTargetTotal(good));
    return (
      edibleGoods.reduce((n, g) => n + totalGood(g), 0) >=
      Math.max(
        10 + 3 * liveMines(),
        edibleGoods.reduce((n, g) => n + stockTargetTotal(g), 0),
      )
    );
  }
  function intermediateSaturated(good: Good) {
    const reserve = intermediateReserves[good] || 0;
    return reserve > 0 && totalGood(good) >= Math.max(reserve, stockTargetTotal(good));
  }
  function hasLocalWater(b: Pick<Building, 'x' | 'y'>) {
    return hasWellCoverage(game, b, 'active');
  }
  function carrierCap() {
    return 8 + 8 * Math.max(0, storages().length - 1);
  }
  function countDeliver(g: Good, bid: number) {
    let n = 0;
    for (let i = 0; i < game.jobs.length; i++) {
      const j = game.jobs[i];
      if (j.kind === 'deliver' && j.good === g && j.from === bid) n++;
    }
    return n;
  }
  function countSoldier(bid: number) {
    let n = 0;
    for (let i = 0; i < game.jobs.length; i++) {
      const j = game.jobs[i];
      if (j.kind === 'soldier' && j.to === bid) n++;
    }
    return n;
  }
  function gameEvent<K extends keyof GameEvents>(name: K, payload: GameEvents[K]) {
    game.emitGameEvent(name, payload);
  }
  function productionMetrics(): ProductionMetrics {
    const m: ProductionMetrics = {
      elapsed: 0,
      active: 0,
      blocked: 0,
      inputBlocked: 0,
      outputBlocked: 0,
      produced: {},
      consumed: {},
      delivered: {},
      inputDelivered: {},
      outputDelivered: {},
      deliveryStarted: 0,
      recent: [],
    };
    m.recent.push(productionSample(m));
    return m;
  }
  function productionSample(m: ProductionMetrics): ProductionSample {
    return {
      elapsed: m.elapsed,
      inputBlocked: m.inputBlocked,
      produced: copyObj(m.produced),
      consumed: copyObj(m.consumed),
      inputDelivered: copyObj(m.inputDelivered || {}),
      outputDelivered: copyObj(m.outputDelivered || {}),
    };
  }
  function ensureProductionHistory(m: ProductionMetrics) {
    // Older saves retain their lifetime production/consumption, but cannot reconstruct
    // arrivals separately from construction, or outgoing delivery completion.
    if (m.deliveryStarted === undefined) {
      m.deliveryStarted = m.elapsed;
      m.inputDelivered = {};
      m.outputDelivered = {};
    }
    if (!m.recent || !m.recent.length) m.recent = [productionSample(m)];
  }
  function sampleProduction(m: ProductionMetrics) {
    ensureProductionHistory(m);
    const samples = m.recent;
    if (m.elapsed - samples[samples.length - 1].elapsed >= 2 - 1e-9)
      samples.push(productionSample(m));
    // Keep only complete covered intervals, never interpolate goods or invent a
    // missing pre-load baseline. The live counters cover the current partial interval.
    while (samples.length > 301 || samples[0].elapsed < m.elapsed - 600 - 1e-9) samples.shift();
  }
  function productionWindow(
    m: ProductionMetrics,
    window: ProductionRateWindow,
  ): ProductionWindowMetrics {
    const empty = {
      elapsed: 0,
      inputBlocked: 0,
      produced: {},
      consumed: {},
      inputDelivered: {},
      outputDelivered: {},
    };
    let baseline: ProductionSample = empty;
    if (window !== 'lifetime') {
      baseline = (m.recent || []).find(function (sample) {
        return sample.elapsed >= m.elapsed - window - 1e-9;
      });
      if (!baseline) baseline = productionSample(m);
    }
    const elapsed = Math.max(0, m.elapsed - baseline.elapsed),
      deliveryElapsed =
        m.deliveryStarted === undefined
          ? 0
          : Math.max(0, m.elapsed - Math.max(baseline.elapsed, m.deliveryStarted));
    function difference(current: Inventory, before: Inventory): Inventory {
      const out: Inventory = {};
      for (const good in current)
        out[good as Good] = Math.max(0, current[good as Good] - (before[good as Good] || 0));
      return out;
    }
    return {
      elapsed: elapsed,
      inputBlocked: Math.max(0, m.inputBlocked - baseline.inputBlocked),
      produced: difference(m.produced, baseline.produced),
      consumed: difference(m.consumed, baseline.consumed),
      inputDelivered: difference(m.inputDelivered || {}, baseline.inputDelivered),
      outputDelivered: difference(m.outputDelivered || {}, baseline.outputDelivered),
      deliveryElapsed: deliveryElapsed,
      sampleInterval: window === 'lifetime' ? 0 : 2,
    };
  }
  function addStock(b: Building, g: Good, n: number) {
    const accepted = Math.min(n, Math.max(0, productionOutputLimit - (b.stock[g] | 0)));
    b.stock[g] = (b.stock[g] | 0) + accepted;
    b.produced = (b.produced | 0) + accepted;
    if (!b.metrics) b.metrics = productionMetrics();
    b.metrics.produced[g] = (b.metrics.produced[g] | 0) + accepted;
    game.recordEconomicFlow('produced', g, accepted);
    if (accepted) gameEvent('goodsProduced', { building: b, good: g as Good, amount: accepted });
    return accepted;
  }
  function newBuilding(type: BuildingType, x: number, y: number): Building {
    return {
      id: game.nextId++,
      type: type,
      x: x,
      y: y,
      done: false,
      prog: 0,
      needs: copyObj(game.BSPEC[type].cost || {}),
      got: {},
      stock: {},
      res: {},
      timer: 1 + game.SR(),
      man: false,
      exhausted: false,
      nofood: false,
      norock: false,
      produced: 0,
      priority: 0,
      targets: {},
      disabled: false,
      blockedReason: '',
      metrics: productionMetrics(),
    };
  }
  function copyObj(o: Inventory): Inventory {
    const r: Inventory = {};
    for (const k in o) r[k as Good] = o[k as Good];
    return r;
  }
  function siteReady(b: Building) {
    for (const g in b.needs) if ((b.got[g as Good] | 0) < b.needs[g as Good]) return false;
    return true;
  }
  function onDone(b: Building) {
    b.done = true;
    buildingVersion++;
    game.recomputeTerritory();
    gameEvent('buildingCompleted', { building: b });
  }
  function pickStorageFor(g: Good, ref: Pick<Building, 'x' | 'y'>) {
    return nearestStorage(ref || { x: game.W / 2, y: game.H / 2 }, {
      available: g,
      connected: !!ref,
    });
  }
  function availableGood(g: Good, ref: Pick<Building, 'x' | 'y'>, includeTransfers: boolean) {
    let s = 0;
    const ss = storages();
    for (let i = 0; i < ss.length; i++) {
      const store = ss[i];
      if (ref && !game.connectedLand(ref.x, ref.y, store.x, store.y)) continue;
      let free = (store.stock[g] | 0) - (store.res[g] | 0);
      if (includeTransfers)
        for (let j = 0; j < game.jobs.length; j++) {
          const job = game.jobs[j];
          if (job.kind === 'transfer' && job.s === store.id && job.good === g && !collectedJob(job))
            free++;
        }
      s += Math.max(0, Math.min(store.stock[g] | 0, free));
    }
    return s;
  }
  function availGood(g: Good, ref?: Pick<Building, 'x' | 'y'>) {
    // Uncollected warehouse transfers are optional positioning, so their stock is
    // still available to construction and explicit spending. Fetches stay reserved.
    return availableGood(g, ref, true);
  }
  function buildingAffordability(
    type: BuildingType,
    ref?: Pick<Building, 'x' | 'y'>,
  ): BuildingAffordability {
    const cost = game.BSPEC[type].cost || {};
    const materials = Object.entries(cost).map(([name, required]) => {
      const good = name as Good;
      const free = availableGood(good, ref, false);
      const available = availableGood(good, ref, true);
      const optionalTransfers = Math.max(0, available - free);
      return {
        good,
        required,
        free,
        available,
        optionalTransfers,
        reclaim: Math.max(0, Math.min(required - free, optionalTransfers)),
      };
    });
    return {
      affordable: materials.every((material) => material.available >= material.required),
      materials,
    };
  }
  function requestStock(cost: Inventory, ref?: Pick<Building, 'x' | 'y'>) {
    const shortage: Inventory = {};
    // Validate every good before releasing anything: an unaffordable request must
    // not disturb existing logistics merely because one material was available.
    for (const g in cost) {
      if (availGood(g as Good, ref) < cost[g as Good]) return false;
      shortage[g as Good] = Math.max(0, cost[g as Good] - availableGood(g as Good, ref, false));
    }
    cancelJobs(function (job) {
      if (job.kind !== 'transfer' || !shortage[job.good] || collectedJob(job)) return false;
      const source = byId(job.s);
      if (!source || !source.done || !game.BSPEC[source.type].store) return false;
      if (ref && !game.connectedLand(ref.x, ref.y, source.x, source.y)) return false;
      shortage[job.good]--;
      return true;
    });
    return true;
  }
  function cancelJobs(pred: (j: Job) => boolean) {
    for (let i = game.jobs.length - 1; i >= 0; i--) {
      const j = game.jobs[i];
      if (!pred(j)) continue;
      game.jobs.splice(i, 1);
      unwindJob(j);
    }
  }
  // Both pending and assigned pickups hold a reservation until their cargo is collected.
  // Cancellation detaches units as well as queue entries so no ghost job can create goods.
  function unwindJob(j: Job) {
    let assigned = null;
    for (let i = 0; i < game.units.length; i++)
      if (game.units[i].job === j) {
        assigned = game.units[i];
        break;
      }
    if ((j.kind === 'fetch' || j.kind === 'transfer') && (!assigned || !assigned.carry)) {
      const s = byId(j.s);
      if (s) s.res[j.good] = Math.max(0, (s.res[j.good] | 0) - 1);
    }
    if (j.kind === 'soldier') {
      game.soldierPool++;
      if (assigned) {
        assigned.dead = true;
        unitsDirty = true;
      }
    }
    if (!assigned) return;
    assigned.job = null;
    if (assigned.carry) {
      assigned.dropB = null;
      assigned.dropIsSite = false;
      goDrop(assigned);
    } else {
      resetCarrier(assigned, 'destination');
    }
  }
  function evaluatePlacement(
    type: BuildingType,
    x: number,
    y: number,
    all: boolean,
  ): PlacementChecks {
    const checks: PlacementChecks = {
      ok: true,
      reason: '',
      terrain: { ok: true, reason: '' },
      ownership: { ok: true, reason: '' },
      resources: { ok: true, reason: '' },
    };
    function fail(kind: 'terrain' | 'ownership' | 'resources', reason: string) {
      if (checks[kind].ok !== false) checks[kind] = { ok: false, reason };
      if (checks.ok) {
        checks.ok = false;
        checks.reason = reason;
      }
      return !all;
    }
    if (!game.inB(x, y))
      return {
        ok: false,
        reason: 'Out of bounds',
        terrain: { ok: false, reason: 'Out of bounds' },
        ownership: { ok: null, reason: 'Choose a tile inside the map' },
        resources: { ok: null, reason: 'Choose a tile inside the map' },
      };
    const i = game.idx(x, y),
      tl = game.tiles[i];
    if (tl.t === game.WATER) if (fail('terrain', 'Cannot build on water')) return checks;
    if (tl.t === game.MTN) if (fail('terrain', 'Cannot build on mountains')) return checks;
    if (!game.owned[i]) if (fail('ownership', 'Outside your territory')) return checks;
    const sp = game.BSPEC[type];
    if (type === 'fisherman') {
      if (!game.owned[i]) if (fail('ownership', 'Outside your territory')) return checks;
      if (tl.t !== game.GRASS && tl.t !== game.SAND)
        if (fail('terrain', 'Must stand on land by the shore')) return checks;
      let wa = false;
      for (let wy2 = y - 2; wy2 <= y + 2 && !wa; wy2++)
        for (let wx2 = x - 2; wx2 <= x + 2 && !wa; wx2++)
          if (game.inB(wx2, wy2) && game.tiles[game.idx(wx2, wy2)].t === game.WATER) wa = true;
      if (!wa) if (fail('resources', 'No water nearby')) return checks;
      for (let d = 0; d < 4; d++) {
        const nx = x + game.DX[d],
          ny = y + game.DY[d];
        if (!game.inB(nx, ny)) continue;
        const n = game.idx(nx, ny);
        if (!game.passI(n)) continue;
        if (!game.owned[n]) if (fail('ownership', 'Outside your territory')) return checks;
      }
    } else {
      for (let d2 = 0; d2 < 4; d2++) {
        const nx2 = x + game.DX[d2],
          ny2 = y + game.DY[d2];
        if (!game.inB(nx2, ny2)) {
          if (fail('ownership', 'Outside your territory')) return checks;
          continue;
        }
        const n2 = game.idx(nx2, ny2);
        if (!game.passI(n2)) continue;
        if (!game.owned[n2]) if (fail('ownership', 'Outside your territory')) return checks;
      }
      if (tl.t !== game.GRASS) if (fail('terrain', 'Must stand on meadow')) return checks;
      if (sp.resKind) {
        let ok = false;
        for (let dd = 0; dd < 8; dd++) {
          const mx = x + game.DX[dd],
            my = y + game.DY[dd];
          if (game.inB(mx, my)) {
            const mt = game.tiles[game.idx(mx, my)];
            if (mt.t === game.MTN && mt.res && mt.res.kind === sp.resKind && mt.res.amt > 0)
              ok = true;
          }
        }
        if (!ok)
          if (
            fail(
              'resources',
              'Must border a mountain with ' +
                game.GOODS[sp.resKind].name.toLowerCase() +
                ' deposit',
            )
          )
            return checks;
      }
      if (type === 'quarry') {
        const fr = sp.rad;
        let found = false;
        for (let yy = y - fr; yy <= y + fr && !found; yy++)
          for (let xx = x - fr; xx <= x + fr && !found; xx++) {
            if (!game.inB(xx, yy)) continue;
            if ((x - xx) * (x - xx) + (y - yy) * (y - yy) > fr * fr) continue;
            if (game.tiles[game.idx(xx, yy)].rock) found = true;
          }
        if (!found) if (fail('resources', 'No rocks nearby')) return checks;
      }
    }
    if (buildingAt(x, y)) if (fail('terrain', 'Blocked')) return checks;
    const mind = type === 'hq' ? 2.8 : 1.9;
    for (let bi = 0; bi < game.buildings.length; bi++) {
      const ob = game.buildings[bi];
      if (Math.hypot(ob.x - x, ob.y - y) < mind)
        if (fail('terrain', 'Too close to ' + game.BSPEC[ob.type].name)) return checks;
    }
    return checks;
  }
  function canPlace(type: BuildingType, x: number, y: number): [boolean, string] {
    const checks = evaluatePlacement(type, x, y, false);
    return [checks.ok, checks.reason];
  }
  /** Independent read-only evidence; commands retain their original first-failure ordering. */
  function placementChecks(type: BuildingType, x: number, y: number): PlacementChecks {
    return evaluatePlacement(type, x, y, true);
  }
  function suggestFor(reason: string): PlacementAdvice {
    if (!reason) return '';
    if (reason.indexOf('Not enough') >= 0)
      return 'build more producers — or inspect a demolition quote for exact recoverable goods';
    if (reason.indexOf('Outside your territory') >= 0)
      return 'build an Outpost toward that spot \u2014 it pushes your border out';
    if (reason === 'No water nearby')
      return 'place it on a shore inside your border (grass or sand both work)';
    if (reason.indexOf('deposit') >= 0)
      return 'click mountains to scout them, then build against the wall with the colored dots';
    if (reason === 'No rocks nearby')
      return 'find a grey rock cluster \u2014 the map guarantees some near your start';
    if (reason.indexOf('Too close to') >= 0) return 'keep about 2 tiles of space between buildings';
    return '';
  }
  function placeBuilding(type: BuildingType, x: number, y: number) {
    const c = canPlace(type, x, y);
    if (!c[0]) {
      gameEvent('placementRejected', { type, x, y, reason: c[1], stock: false });
      return false;
    }
    const sp = game.BSPEC[type],
      needs = copyObj(sp.cost || {});
    for (const g in needs)
      if (availGood(g as Good, { x: x, y: y }) < needs[g as Good]) {
        const r = 'Not enough ' + game.GOODS[g as Good].name;
        gameEvent('placementRejected', { type, x, y, reason: r, stock: true });
        return false;
      }
    if (!requestStock(needs, { x: x, y: y })) return false;
    const i2 = game.idx(x, y),
      tl2 = game.tiles[i2];
    if (tl2.tree || tl2.rock) {
      const clearedTree = !!tl2.tree;
      game.tiles[i2].tree = 0;
      game.tiles[i2].rock = null;
      gameEvent('tileChanged', { index: i2 });
      gameEvent('siteCleared', { x, y, tree: clearedTree });
    }
    const placed = newBuilding(type, x, y);
    game.buildings.push(placed);
    buildingVersion++;
    gameEvent('buildingPlaced', { building: placed });
    return true;
  }
  /** Set a building's construction priority level; other values are rejected. */
  function setBuildingPriority(b: Building, priority: unknown) {
    if (priority !== 0 && priority !== 1 && priority !== 2) return false;
    b.priority = priority;
    gameEvent('productionControlChanged', { building: b });
    return true;
  }
  /** Request a warehouse reserve, clamped to a whole number from 0 to 500. */
  function setStockTarget(b: Building, good: Good, amount: unknown) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
    if (!game.BSPEC[b.type].store || !Object.hasOwn(game.GOODS, good)) return false;
    if (!b.targets) b.targets = {};
    b.targets[good] = Math.max(0, Math.min(500, Math.floor(amount)));
    gameEvent('productionControlChanged', { building: b });
    return true;
  }
  function demolitionQuote(b: Building): DemolitionQuote {
    const sp = game.BSPEC[b.type];
    const allowed = byId(b.id) === b && b.type !== 'hq' && !(sp.store && storages().length <= 1);
    const reason =
      byId(b.id) !== b
        ? 'This building no longer exists.'
        : b.type === 'hq'
          ? 'The headquarters cannot be demolished.'
          : sp.store && storages().length <= 1
            ? 'Storage demolition requires more than one completed storehouse. Complete another first.'
            : '';
    const receiver = nearestStorage(b, { exclude: b, euclidean: true });
    const refund: Inventory = {},
      salvage: Inventory = {};
    if (allowed && receiver) {
      for (const name in sp.cost) {
        const good = name as Good;
        const amount = Math.floor((b.done ? sp.cost[good] : b.got[good] | 0) / 2);
        if (amount > 0) refund[good] = amount;
      }
      for (const name in b.stock)
        if ((b.stock[name as Good] | 0) > 0) salvage[name as Good] = b.stock[name as Good] | 0;
    }
    const equipmentReceiver =
      allowed && b.type === 'guard' && b.man ? nearestStoragePos(b.x, b.y) : null;
    const touching = game.jobs.filter(
      (job) => job.from === b.id || job.to === b.id || job.s === b.id,
    );
    const cancelledDeliveries: DeliveryStages = { queued: 0, assigned: 0, carrying: 0 };
    for (const job of touching) {
      if (job.kind === 'soldier') continue;
      const owner = game.units.find((unit) => !unit.dead && unit.job === job);
      const stage = deliveryStage(job, owner);
      cancelledDeliveries[stage] = (cancelledDeliveries[stage] || 0) + 1;
    }
    let territoryLost = 0;
    const affectedBuildings: number[] = [];
    if (allowed && b.done && b.type !== 'well' && sp.rad) {
      const projected = game.projectTerritory(b.id);
      for (let i = 0; i < game.owned.length; i++)
        if (game.owned[i] && !projected[i]) territoryLost++;
      for (const other of game.buildings)
        if (
          other !== b &&
          game.owned[game.idx(other.x, other.y)] &&
          !projected[game.idx(other.x, other.y)]
        )
          affectedBuildings.push(other.id);
    }
    const location = (store: Building | null) =>
      store ? { id: store.id, type: store.type, x: store.x, y: store.y } : null;
    return {
      allowed,
      reason,
      completed: b.done,
      refund,
      salvage,
      receiver: location(receiver),
      returnedSoldiers: allowed
        ? (b.type === 'guard' && b.man ? 1 : 0) +
          touching.filter((job) => job.kind === 'soldier').length
        : 0,
      equipment: equipmentReceiver ? { weapons: 1 } : {},
      equipmentReceiver: location(equipmentReceiver),
      cancelledDeliveries,
      territoryLost,
      affectedBuildings,
    };
  }
  function demolish(b: Building) {
    const quote = demolitionQuote(b);
    if (!quote.allowed) {
      if (b.type === 'hq') gameEvent('demolitionRejected', { reason: 'headquarters' });
      else if (game.BSPEC[b.type].store && storages().length <= 1)
        gameEvent('demolitionRejected', { reason: 'last-store' });
      return;
    }
    // Job cancellation returns dispatched soldiers itself; add only the garrison here.
    const dispatched = game.jobs.filter(
      (job) => job.kind === 'soldier' && (job.from === b.id || job.to === b.id || job.s === b.id),
    ).length;
    game.soldierPool += quote.returnedSoldiers - dispatched;
    const equipmentStore = quote.equipmentReceiver ? byId(quote.equipmentReceiver.id) : null;
    if (equipmentStore)
      for (const name in quote.equipment) {
        const good = name as Good;
        const amount = quote.equipment[good];
        equipmentStore.stock[good] = (equipmentStore.stock[good] | 0) + amount;
        game.recordEconomicFlow('salvage', good, amount);
      }
    const sp = game.BSPEC[b.type];
    const receiver = quote.receiver ? byId(quote.receiver.id) : null;
    if (receiver) {
      for (const name in quote.refund) {
        const good = name as Good;
        const amount = quote.refund[good];
        receiver.stock[good] = (receiver.stock[good] | 0) + amount;
        game.recordEconomicFlow('refund', good, amount);
      }
      for (const name in quote.salvage) {
        const good = name as Good;
        const amount = quote.salvage[good];
        receiver.stock[good] = (receiver.stock[good] | 0) + amount;
        game.recordEconomicFlow('salvage', good, amount);
        if (good === 'gold' && !sp.store) {
          game.state.gold += amount;
          game.state.goldDelivered = (game.state.goldDelivered || 0) + amount;
          gameEvent('goodsDelivered', {
            building: receiver,
            good,
            amount,
            transfer: false,
          });
        }
      }
    }
    deleteJobsFor(b.id);
    game.buildings.splice(game.buildings.indexOf(b), 1);
    buildingVersion++;
    game.recomputeTerritory();
    for (let d = 0; d < 4; d++) {
      const nx = b.x + game.DX[d],
        ny = b.y + game.DY[d];
      if (game.inB(nx, ny) && game.tiles[game.idx(nx, ny)].road)
        gameEvent('tileChanged', { index: game.idx(nx, ny) });
    }
    gameEvent('buildingDemolished', { id: b.id, type: b.type, x: b.x, y: b.y });
  }
  function deleteJobsFor(id: number) {
    cancelJobs(function (j) {
      return j.from === id || j.to === id || j.s === id;
    });
  }
  /** Exact scheduling gate; also read by the inspector without mutating recorded reasons. */
  function productionConstraint(b: Building) {
    const sp = game.BSPEC[b.type];
    let reason = '';
    if (b.disabled) reason = 'paused';
    else if (b.exhausted) reason = 'exhausted';
    else if (productionOutputBlocked(b, sp)) reason = 'output';
    else if (sp.out && edibleGoods.includes(sp.out) && foodSaturated(sp.out)) reason = 'demand';
    else if (sp.out && intermediateSaturated(sp.out)) reason = 'demand';
    else if (
      sp.out === 'beer' &&
      totalGood('beer') >= Math.max(productionReserves.beer, stockTargetTotal('beer'))
    )
      reason = 'demand';
    else if (
      (b.type === 'toolsmith' || b.type === 'workshop') &&
      (totalGood('tools') >= Math.max(productionReserves.tools, stockTargetTotal('tools')) ||
        (b.type === 'workshop' && totalGood('planks') < productionReserves.planks))
    )
      reason = 'reserve';
    else if (
      b.type === 'armory' &&
      totalGood('weapons') >= Math.max(productionReserves.weapons, stockTargetTotal('weapons'))
    )
      reason = 'reserve';
    else if (sp.water && !hasLocalWater(b)) reason = 'water';
    else if (sp.in) {
      if (ingredientShortages(b, sp).length) reason = 'inputs';
    } else if (b.blockedReason === 'resources') reason = 'resources';
    return reason;
  }
  /** Live scheduling constraints plus the last attempt's blockage; a pure presentation query. */
  function buildingWorking(b: Building) {
    const sp = game.BSPEC[b.type];
    return !!(
      b.done &&
      sp.prod &&
      sp.prod !== 'none' &&
      !sp.store &&
      !sp.guard &&
      !b.blockedReason &&
      !productionConstraint(b)
    );
  }
  function productionProgress(b: Building): ProductionProgress | null {
    const sp = game.BSPEC[b.type];
    if (!b.done || sp.store || !sp.prod || sp.prod === 'none') return null;
    const timing = productionTiming(b, sp, game.state.upgrades?.production);
    let reason = productionConstraint(b);
    // Resource checks are pure. These timers continue towards another attempt, unlike suspension.
    if (
      !reason &&
      ((sp.prod === 'gather' && findTree(b, sp.rad) === undefined) ||
        (sp.prod === 'rock' && findRock(b, sp.rad) === undefined) ||
        (sp.prod === 'fish' && !hasWaterNear(b)))
    )
      reason = 'resources';
    const output = sp.prod === 'gather' ? 2 : 1;
    const explanations: Record<string, string> = {
      paused: 'Production paused by you.',
      exhausted: 'Deposit exhausted; no further output can be produced here.',
      output: `Output blocked: the next batch needs space for ${output} ${sp.out ? game.GOODS[sp.out].name.toLowerCase() : 'goods'}; ${b.stock[sp.out] || 0} of ${productionOutputLimit} local output slots are occupied. Waiting for collection.`,
      demand: 'Production suspended: colony demand is satisfied by current reserves.',
      reserve: 'Production suspended by the colony stock reserve policy.',
      water: `Production suspended: no working connected local well within ${wellRadius(game)} tiles.`,
      inputs: 'Production suspended: required ingredients are missing locally.',
      resources:
        'Natural resource availability will be checked at the next attempt; the retry countdown continues.',
    };
    const remainingWork = Math.max(0, b.timer);
    return {
      reason,
      explanation:
        explanations[reason] || 'Ready for the next production attempt when simulation runs.',
      suspended: !!reason && reason !== 'resources',
      remainingWork,
      remaining: (remainingWork * timing.upgradeFactor) / timing.foodMultiplier,
      duration: (timing.base * timing.upgradeFactor) / timing.foodMultiplier,
      base: timing.base,
      tier: timing.tier,
      variety: timing.variety,
    };
  }
  function bTick(b: Building, dt: number) {
    const sp = game.BSPEC[b.type];
    if (!b.done) {
      if (!siteReady(b)) return;
      b.prog += dt / 10;
      if (b.prog >= 1) onDone(b);
      return;
    }
    if (sp.prod === 'none' || sp.store) return;
    if (!b.metrics) b.metrics = productionMetrics();
    ensureProductionHistory(b.metrics);
    const reason = productionConstraint(b);
    let g: Good;
    b.blockedReason = reason;
    b.metrics.elapsed += dt;
    if (reason) {
      b.metrics.blocked += dt;
      if (reason === 'inputs') b.metrics.inputBlocked += dt;
      if (reason === 'output') b.metrics.outputBlocked += dt;
    } else b.metrics.active += dt;
    // Missing natural resources are retried on their own timer; other pauses preserve work.
    if (reason && reason !== 'resources') return;
    const timing = productionTiming(b, sp, game.state.upgrades?.production);
    b.timer -= (dt / timing.upgradeFactor) * timing.foodMultiplier;
    if (b.timer > 0) return;
    switch (sp.prod) {
      case 'gather': {
        const tr = findTree(b, sp.rad);
        if (tr >= 0) {
          game.tiles[tr].tree = 0;
          gameEvent('tileChanged', { index: tr });
          addStock(b, 'logs', 2);
          b.timer += timing.base;
          b.blockedReason = '';
        } else {
          b.timer = 3;
          b.blockedReason = 'resources';
        }
        break;
      }
      case 'plant': {
        // replant around the nearest done lumberjack: every planted tree must be inside its rad-6
        // chop zone (plant rad 5 around the LJ, gate on the LJ's own supply). Planting around the
        // forester itself can fill the un-choppable crescent of its circle, close the gate and
        // starve the pair (seen on ?autoplay&seed=2024).
        let lb4 = null,
          bd4 = 1e9;
        for (let i6 = 0; i6 < game.buildings.length; i6++) {
          const lb5 = game.buildings[i6];
          if (lb5.done && lb5.type === 'lumberjack') {
            const dd4 = Math.abs(lb5.x - b.x) + Math.abs(lb5.y - b.y);
            if (dd4 < bd4) {
              bd4 = dd4;
              lb4 = lb5;
            }
          }
        }
        const tgt6 = lb4 || b,
          gt6 = lb4 ? 20 : 25,
          pr6 = lb4 ? 5 : sp.rad;
        if (countTrees(tgt6, lb4 ? 6 : 7) < gt6) {
          const p = randPlantSpot(tgt6, pr6);
          if (p >= 0) {
            game.tiles[p].tree = 3;
            gameEvent('tileChanged', { index: p });
          }
          b.timer = timing.base;
        } else b.timer = 5;
        break;
      }
      case 'rock': {
        const rk = findRock(b, sp.rad);
        if (rk >= 0) {
          const t2 = game.tiles[rk];
          t2.rock.amt--;
          addStock(b, 'stone', 1);
          b.norock = false;
          b.blockedReason = '';
          if (t2.rock.amt <= 0) {
            t2.rock = null;
            gameEvent('tileChanged', { index: rk });
          }
          b.timer += timing.base;
        } else {
          if (!b.norock) {
            b.norock = true;
            gameEvent('rocksExhausted', { building: b });
          }
          b.timer = 4;
          b.blockedReason = 'resources';
        }
        break;
      }
      case 'fish': {
        if (!hasWaterNear(b)) {
          b.timer = 4;
          b.blockedReason = 'resources';
          break;
        }
        if (foodSaturated(sp.out)) {
          b.timer = 6;
          break;
        }
        addStock(b, sp.out, 1);
        b.timer += timing.base;
        b.blockedReason = '';
        break;
      }
      case 'farm': {
        addStock(b, sp.out, 1);
        b.timer += timing.base;
        break;
      }
      case 'craft':
      case 'mine': {
        if (ingredientShortages(b, sp).length) {
          b.timer = 1.5;
          if (sp.prod === 'mine' && !b.nofood) {
            b.nofood = true;
            gameEvent('foodBlocked', { building: b });
          }
          break;
        }
        const inputs = ingredientsConsumedNext(b, sp);
        if (sp.prod === 'mine' && !mineDeposit(b)) {
          b.exhausted = true;
          b.blockedReason = 'exhausted';
          gameEvent('depositExhausted', { building: b });
          break;
        }
        for (g in inputs) {
          b.stock[g] -= inputs[g];
          b.metrics.consumed[g] = (b.metrics.consumed[g] | 0) + inputs[g];
          game.recordEconomicFlow('consumed', g, inputs[g]);
        }
        b.nofood = false;
        addStock(b, sp.out, 1);
        b.timer += timing.base;
        b.blockedReason = '';
        break;
      }
    }
  }
  function forRadius<T>(
    b: Building,
    r: number,
    f: (i: number, x: number, y: number) => T | undefined,
  ) {
    for (let y = b.y - r; y <= b.y + r; y++)
      for (let x = b.x - r; x <= b.x + r; x++) {
        if (!game.inB(x, y)) continue;
        if ((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) > r * r) continue;
        const r2 = f(game.idx(x, y), x, y);
        if (r2 !== undefined) return r2;
      }
    return undefined;
  }
  function findTree(b: Building, r: number) {
    return forRadius(b, r, function (i) {
      return game.tiles[i].tree >= 3 ? i : undefined;
    });
  }
  function countTrees(b: Building, r: number) {
    let n = 0;
    forRadius(b, r, function (i) {
      if (game.tiles[i].tree >= 2) n++;
    });
    return n;
  }
  function findRock(b: Building, r: number) {
    return forRadius(b, r, function (i) {
      return game.tiles[i].rock ? i : undefined;
    });
  }
  function randPlantSpot(b: Building, r: number) {
    return forRadius(b, r, function (i, x, y) {
      const tl = game.tiles[i];
      return tl.t === game.GRASS &&
        !tl.tree &&
        !tl.rock &&
        !tl.road &&
        !buildingAt(x, y) &&
        game.owned[i] &&
        game.SR() < 0.12
        ? i
        : undefined;
    });
  }
  function hasWaterNear(b: Building) {
    for (let y = b.y - 2; y <= b.y + 2; y++)
      for (let x = b.x - 2; x <= b.x + 2; x++)
        if (game.inB(x, y) && game.tiles[game.idx(x, y)].t === game.WATER) return true;
    return false;
  }
  function mineDeposit(b: Building) {
    for (let d = 0; d < 8; d++) {
      const x = b.x + game.DX[d],
        y = b.y + game.DY[d];
      if (!game.inB(x, y)) continue;
      const t = game.tiles[game.idx(x, y)];
      if (t.t === game.MTN && t.res && t.res.kind === game.BSPEC[b.type].resKind && t.res.amt > 0) {
        t.res.amt--;
        gameEvent('tileChanged', { index: game.idx(x, y) });
        return true;
      }
    }
    return false;
  }
  function incomingStock(g: Good, bid: number) {
    let n = 0;
    for (let i = 0; i < game.jobs.length; i++)
      if (game.jobs[i].kind === 'transfer' && game.jobs[i].good === g && game.jobs[i].to === bid)
        n++;
    for (let i = 0; i < game.units.length; i++) {
      const u = game.units[i];
      if (u.carry === g && u.dropB === bid && (!u.job || u.job.kind !== 'transfer')) n++;
    }
    return n;
  }
  function collectedJob(job: Job) {
    for (let i = 0; i < game.units.length; i++)
      if (game.units[i].job === job && game.units[i].carry) return true;
    return false;
  }
  function deliveryStorage(g: Good, ref: Pick<Building, 'x' | 'y'>): Building | null {
    const ss = storages();
    let best = null,
      score = -Infinity;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i],
        d = Math.hypot(s.x - ref.x, s.y - ref.y);
      if (!game.connectedLand(ref.x, ref.y, s.x, s.y)) continue;
      const deficit = ((s.targets || {})[g] | 0) - (s.stock[g] | 0) - incomingStock(g, s.id);
      const value = deficit / (1 + d * 0.15);
      if (deficit > 0 && value > score) {
        best = s;
        score = value;
      }
    }
    return best || nearestStorage(ref, { connected: true, euclidean: true });
  }
  function replenishTargets() {
    const ss = storages();
    const carried: Record<string, number> = {},
      retained: Record<string, number> = {},
      exportBudget: Record<string, number> = {};
    for (let ji = 0; ji < game.jobs.length; ji++) {
      const pending = game.jobs[ji];
      if (pending.kind !== 'transfer' || collectedJob(pending)) continue;
      const source = byId(pending.s),
        sourceKey = pending.s + '/' + pending.good;
      if (exportBudget[sourceKey] === undefined)
        exportBudget[sourceKey] = source
          ? (source.stock[pending.good] | 0) -
            (source.res[pending.good] | 0) -
            ((source.targets || {})[pending.good] | 0)
          : 0;
      // Existing transfer reservations are eligible for reconsideration. Fetch
      // reservations still protect construction and production ingredients.
      exportBudget[sourceKey]++;
    }
    for (let ui = 0; ui < game.units.length; ui++) {
      const u = game.units[ui];
      if (!u.carry || !u.dropB) continue;
      const key = u.dropB + '/' + u.carry;
      carried[key] = (carried[key] || 0) + 1;
    }
    cancelJobs(function (job) {
      if (job.kind !== 'transfer') return false;
      if (collectedJob(job)) return false;
      const target = byId(job.to),
        source = byId(job.s),
        key = job.to + '/' + job.good,
        sourceKey = job.s + '/' + job.good;
      if (!target || !source || !game.connectedLand(source.x, source.y, target.x, target.y))
        return true;
      const needed = Math.max(
        0,
        ((target.targets || {})[job.good] | 0) - (target.stock[job.good] | 0) - (carried[key] || 0),
      );
      if ((retained[key] || 0) >= needed || exportBudget[sourceKey] <= 0) return true;
      retained[key] = (retained[key] || 0) + 1;
      exportBudget[sourceKey]--;
      return false;
    });
    for (let i = 0; i < ss.length; i++) {
      const target = ss[i],
        targets: Inventory = target.targets || {};
      for (const g in targets) {
        const missing = Math.max(
          0,
          (targets[g as Good] | 0) -
            (target.stock[g as Good] | 0) -
            incomingStock(g as Good, target.id),
        );
        // Keep a small queue: construction and producers retain first use of carriers.
        for (let k = 0; k < Math.min(2, missing); k++) {
          const source = nearestStorage(target, {
            available: g as Good,
            connected: true,
            exclude: target,
            retainTarget: true,
            euclidean: true,
          });
          if (!source) break;
          source.res[g as Good] = (source.res[g as Good] | 0) + 1;
          game.jobs.push({
            kind: 'transfer',
            good: g as Good,
            from: source.id,
            s: source.id,
            to: target.id,
            state: 'p',
          });
        }
      }
    }
  }
  function jobPriority(j: Job) {
    const b = j.to ? byId(j.to) : null;
    if (j.kind === 'fetch') return (b && !b.done ? 100 : 20) + 10 * (b ? b.priority || 0 : 0);
    if (j.kind === 'soldier') return 80;
    if (j.kind === 'deliver') {
      const source = byId(j.from);
      return 40 + (source ? source.stock[j.good] | 0 : 0);
    }
    return 5 + 10 * (b ? b.priority || 0 : 0);
  }
  function ensureJobs() {
    const ordered = game.buildings
      .slice()
      .sort(function (a, b) {
        return (
          (!a.done ? 100 : 0) +
          10 * (a.priority || 0) -
          (!b.done ? 100 : 0) -
          10 * (b.priority || 0)
        );
      })
      .reverse();
    for (let bi = 0; bi < ordered.length; bi++) {
      const b = ordered[bi],
        sp = game.BSPEC[b.type];
      let g: Good;
      if (!b.done) {
        for (g in b.needs) {
          const rem = b.needs[g] - (b.got[g] | 0);
          if (rem <= 0) {
            cancelJobs(
              (function (g2, g3) {
                return function (a) {
                  return a.kind === 'fetch' && a.good === g2 && a.to === g3;
                };
              })(g, b.id),
            );
            continue;
          }
          const pen = incomingCount(g, b.id);
          for (let c2 = pen; c2 < rem; c2++) {
            let s = pickStorageFor(g, b);
            if (!s) {
              const request: Inventory = {};
              request[g] = 1;
              if (requestStock(request, b)) s = pickStorageFor(g, b);
            }
            if (!s) break;
            s.res[g] = (s.res[g] | 0) + 1;
            game.jobs.push({ kind: 'fetch', good: g as Good, to: b.id, s: s.id, state: 'p' });
          }
        }
        continue;
      }
      if (sp.in && !b.disabled && !b.exhausted) {
        const fetchInputs = eligibleIngredients(b, sp);
        for (g in fetchInputs) {
          const want = 3,
            have = b.stock[g] | 0;
          if (have >= want) {
            cancelJobs(
              (function (g4, g5) {
                return function (a) {
                  return a.kind === 'fetch' && a.good === g4 && a.to === g5;
                };
              })(g, b.id),
            );
            continue;
          }
          const toC = want - have - incomingCount(g, b.id);
          for (let c3 = 0; c3 < toC; c3++) {
            const s3 = pickStorageFor(g, b);
            if (!s3) break;
            s3.res[g] = (s3.res[g] | 0) + 1;
            game.jobs.push({ kind: 'fetch', good: g as Good, to: b.id, s: s3.id, state: 'p' });
          }
        }
      } else if (sp.in) {
        cancelJobs(function (j) {
          if (j.kind !== 'fetch' || j.to !== b.id) return false;
          return !collectedJob(j);
        });
      }
      if (
        (b.type === 'farm' || b.type === 'fisherman') &&
        (b.stock.food || 0) > countDeliver('food', b.id)
      )
        game.jobs.push({ kind: 'deliver', good: 'food', from: b.id, state: 'p' });
      if (sp.out) {
        const outN = b.stock[sp.out] | 0,
          dlMax = outN >= 4 ? 2 : 1,
          dl = countDeliver(sp.out, b.id);
        if (outN <= 0) {
          if (dl)
            cancelJobs(
              (function (g6, g7) {
                return function (a) {
                  if (a.kind !== 'deliver' || a.good !== g6 || a.from !== g7) return false;
                  for (let ui = 0; ui < game.units.length; ui++)
                    if (game.units[ui].job === a && game.units[ui].carry) return false;
                  return true;
                };
              })(sp.out, b.id),
            );
        } else if (dl < dlMax)
          game.jobs.push({ kind: 'deliver', good: sp.out, from: b.id, state: 'p' });
      }
      if (sp.guard && !b.man && game.soldierPool > 0 && !countSoldier(b.id)) {
        game.soldierPool--;
        game.jobs.push({ kind: 'soldier', to: b.id, state: 'p' });
      }
    }
    replenishTargets();
  }
  function pickupPosOf(j: Job) {
    if (j.kind === 'fetch' || j.kind === 'transfer') {
      const s = byId(j.s);
      if (!s || (s.stock[j.good] | 0) <= 0) {
        const old = s;
        const nb = nearestStorage(old || { x: 0, y: 0 }, { available: j.good });
        if (!nb || j.kind === 'transfer') return null;
        if (old && old !== nb) old.res[j.good] = Math.max(0, (old.res[j.good] | 0) - 1);
        nb.res[j.good] = (nb.res[j.good] | 0) + 1;
        j.s = nb.id;
      }
      const s2 = byId(j.s);
      return s2 ? { x: s2.x, y: s2.y } : null;
    }
    if (j.kind === 'deliver') {
      const b = byId(j.from);
      return b ? { x: b.x, y: b.y } : null;
    }
    if (j.kind === 'soldier') {
      const s3 = anyStorage();
      return s3 ? { x: s3.x, y: s3.y } : null;
    }
    return null;
  }
  function nearestIdleCarrier(j: Job) {
    const pp = pickupPosOf(j);
    if (!pp) return null;
    let best = null,
      bd = 1e9;
    for (let i = 0; i < game.units.length; i++) {
      const u = game.units[i];
      if (u.kind !== 'carrier' || u.job || u.carry || u.phase !== 'idle') continue;
      if (!game.connectedLand(u.x, u.y, pp.x, pp.y)) continue;
      const d = (u.x - pp.x) * (u.x - pp.x) + (u.y - pp.y) * (u.y - pp.y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }
  function startJob(u: Unit, j: Job) {
    const pp = pickupPosOf(j);
    if (!pp) return;
    const p1 = game.findPath(Math.floor(u.x), Math.floor(u.y), pp.x, pp.y);
    if (!p1) return;
    j.state = 't';
    u.job = j;
    u.phase = 'p';
    u.path = p1;
    u.pi = 0;
  }
  function assign(dt: number) {
    game.assignT -= dt;
    if (game.assignT > 0) return;
    game.assignT = 0.5;
    ensureJobs();
    game.jobs.sort(function (a, b) {
      return jobPriority(b) - jobPriority(a);
    });
    for (let i = 0; i < game.jobs.length; i++) {
      const j = game.jobs[i];
      if (j.state !== 'p') continue;
      if (j.kind === 'soldier') {
        const g = byId(j.to),
          s = g ? nearestStoragePos(g.x, g.y) : null;
        if (!s || !g) {
          game.soldierPool++;
          game.jobs.splice(i, 1);
          i--;
          continue;
        }
        const p = game.findPath(s.x, s.y, g.x, g.y);
        if (!p) {
          game.soldierPool++;
          game.jobs.splice(i, 1);
          i--;
          continue;
        }
        j.state = 't';
        game.units.push({
          id: game.nextId++,
          kind: 'soldier',
          x: s.x + 0.5,
          y: s.y + 0.5,
          path: p,
          pi: 0,
          phase: 'd',
          job: j,
          carry: null,
          dropB: g.id,
          dropIsSite: false,
          dead: false,
          lx: 0,
          ly: 0,
        });
        continue;
      }
      const u = nearestIdleCarrier(j);
      if (!u) continue;
      startJob(u, j);
    }
  }
  function spawnCarrier(s: Building) {
    const u: Unit = {
      id: game.nextId++,
      kind: 'carrier',
      x: s.x + 0.5,
      y: s.y + 0.5,
      path: null,
      pi: 0,
      phase: 'idle',
      job: null,
      carry: null,
      dropB: null,
      dropIsSite: false,
      dead: false,
      lx: 0,
      ly: 0,
    };
    u.lx = ((u.id % 7) - 3) * 0.09;
    u.ly = ((u.id % 5) - 2) * 0.09;
    game.units.push(u);
    game.serfPool = Math.max(0, game.serfPool - 1);
  }
  function stepUnit(u: Unit, dt: number) {
    let remaining = dt,
      guard = 0;
    u.moving = false;
    // Spend time per segment, rather than dropping distance at each waypoint. Using the
    // destination tile's cost matches navigation and stays independent of frame size.
    while (remaining > 1e-10 && !u.dead && guard++ < game.W * game.H * 2) {
      if (!u.path || u.pi >= u.path.length) {
        u.path = null;
        if (u.kind === 'soldier') arriveSoldier(u);
        else arrive(u);
        if (!u.path || u.dead) break;
        // Pickup can create a valid empty drop route when already at its destination.
        // Resolve that arrival on the next iteration before reading a waypoint.
        if (u.pi >= u.path.length) continue;
      }
      const n = u.path[u.pi],
        tx = (n % game.W) + 0.5 + (u.lx || 0),
        ty = ((n / game.W) | 0) + 0.5 + (u.ly || 0);
      const dx = tx - u.x,
        dy = ty - u.y,
        dl = Math.hypot(dx, dy);
      if (dl < 1e-10) {
        u.pi++;
        continue;
      }
      const speed = speedOn(u, n),
        travel = Math.min(dl, speed * remaining);
      u.faceDX = dx / dl;
      u.faceDY = dy / dl;
      u.moving = true;
      u.walkDistance = (u.walkDistance || 0) + travel;
      u.x += (dx / dl) * travel;
      u.y += (dy / dl) * travel;
      remaining -= travel / speed;
      if (travel >= dl - 1e-10) {
        u.x = tx;
        u.y = ty;
        u.pi++;
      } else break;
    }
    // Resolve an arrival even when the final segment used exactly the available time.
    if (u.path && u.pi >= u.path.length) {
      u.path = null;
      if (u.kind === 'soldier') arriveSoldier(u);
      else arrive(u);
    }
  }
  function speedOn(u: Pick<Unit, 'x' | 'y'>, destination?: number) {
    const i =
      destination === undefined
        ? game.idx(
            Math.min(game.W - 1, Math.max(0, Math.floor(u.x))),
            Math.min(game.H - 1, Math.max(0, Math.floor(u.y))),
          )
        : destination;
    const haul = game.state.upgrades ? Math.min(3, game.state.upgrades.haul || 0) : 0;
    return (2.7 / game.moveCost(i)) * (1 + 0.12 * haul);
  }
  /** Preserve the narrower state transitions used by retries and cancelled pickups. */
  function resetCarrier(
    u: Unit,
    scope: 'route' | 'assignment' | 'destination' | 'complete' = 'complete',
  ) {
    if (scope === 'complete') {
      u.carry = null;
      u.carryTransfer = false;
      u.carryWarehouseTransfer = false;
      u.carryProducer = null;
    }
    if (scope !== 'route') u.job = null;
    u.phase = 'idle';
    u.path = null;
    if (scope === 'destination' || scope === 'complete') {
      u.dropB = null;
      u.dropIsSite = false;
    }
  }
  function dropFail(u: Unit) {
    // delivery unreachable: unwind the job cleanly. Orphaning a taken job in the queue makes
    // incomingCount count it forever, so ensureJobs never recreates the fetch and the site stalls.
    if (u.job) {
      const ji2 = game.jobs.indexOf(u.job);
      if (ji2 >= 0) game.jobs.splice(ji2, 1);
      if ((u.job.kind === 'fetch' || u.job.kind === 'transfer') && !u.carry) {
        const source = byId(u.job.s);
        if (source) source.res[u.job.good] = Math.max(0, (source.res[u.job.good] | 0) - 1);
      }
      u.job = null;
    }
    if (u.carry) dumpGood(u, u.carry); // salvage the cargo into storage instead of losing it
    resetCarrier(u);
  }
  function goDrop(u: Unit) {
    let dp = null,
      isSite = false;
    if (u.dropB) {
      const b = byId(u.dropB);
      if (b) {
        dp = b;
        isSite = u.dropIsSite;
      }
    }
    if (!dp) {
      const s = nearestStoragePos(u.x, u.y);
      if (s) dp = s;
    }
    if (!dp) {
      dropFail(u);
      return;
    }
    u.dropIsSite = isSite;
    let p = game.findPath(Math.floor(u.x), Math.floor(u.y), dp.x, dp.y);
    if (!p) {
      const s2 = nearestStoragePos(u.x, u.y);
      if (s2 && s2 !== dp) {
        dp = s2;
        u.dropIsSite = false;
        p = game.findPath(Math.floor(u.x), Math.floor(u.y), dp.x, dp.y);
      }
    }
    if (p) {
      u.dropB = dp.id;
      u.phase = 'd';
      u.path = p;
      u.pi = 0;
    } else dropFail(u);
  }
  function recordDelivery(b: Building, g: Good, transfer: boolean) {
    game.recordCargoArrival(g);
    if (!b.metrics) b.metrics = productionMetrics();
    ensureProductionHistory(b.metrics);
    b.metrics.delivered[g] = (b.metrics.delivered[g] | 0) + 1;
    const sp = game.BSPEC[b.type];
    if (b.done && !sp.store && sp.in && eligibleIngredients(b, sp)[g]) {
      b.metrics.inputDelivered[g] = (b.metrics.inputDelivered[g] || 0) + 1;
      game.recordEconomicFlow('inputArrived', g, 1);
    }
    gameEvent('goodsDelivered', { building: b, good: g as Good, amount: 1, transfer: !!transfer });
  }
  function recordOutputDelivery(u: Unit, g: Good) {
    // The pickup source survives a cancelled delivery job. Never count recovered
    // fetch cargo or warehouse transfers as producer throughput.
    if (!u.carryProducer || u.carryTransfer) return;
    const source = byId(u.carryProducer);
    if (source) {
      if (!source.metrics) source.metrics = productionMetrics();
      ensureProductionHistory(source.metrics);
      source.metrics.outputDelivered[g] = (source.metrics.outputDelivered[g] || 0) + 1;
    }
    game.recordEconomicFlow('outputStored', g, 1);
  }
  function dumpGood(u: Unit, g: Good) {
    let s = u.dropB && !u.dropIsSite ? byId(u.dropB) : null;
    if (!s || !s.done || !game.BSPEC[s.type].store || !game.connectedLand(u.x, u.y, s.x, s.y))
      s = nearestStoragePos(u.x, u.y);
    if (s) {
      s.stock[g] = (s.stock[g] | 0) + 1;
      const transfer = !!u.carryTransfer || (u.job && u.job.kind === 'transfer');
      recordDelivery(s, g, transfer);
      if (u.carryWarehouseTransfer) game.recordEconomicFlow('transferred', g, 1);
      recordOutputDelivery(u, g);
      if (g === 'gold' && !transfer) {
        game.state.gold++;
        game.state.goldDelivered = (game.state.goldDelivered || 0) + 1;
        gameEvent('goldBanked', { building: s });
        if (game.state.goldDelivered === 1) gameEvent('firstGold', { building: s });
      }
    }
  }
  function arrive(u: Unit) {
    const j = u.job;
    if (u.phase === 'p' && j) {
      if (j.kind === 'fetch' || j.kind === 'transfer') {
        let s = byId(j.s);
        if (!s || (s.stock[j.good] | 0) <= 0) {
          s = nearestStorage(u, { available: j.good, connected: true });
          if (!s || j.kind === 'transfer') {
            j.state = 'p';
            resetCarrier(u, 'assignment');
            return;
          }
          const old = byId(j.s);
          if (old && old !== s) old.res[j.good] = Math.max(0, (old.res[j.good] | 0) - 1);
          s.res[j.good] = (s.res[j.good] | 0) + 1;
          j.s = s.id;
        }
        s.stock[j.good]--;
        s.res[j.good] = Math.max(0, (s.res[j.good] | 0) - 1);
        u.carry = j.good;
        u.carryTransfer = true;
        u.carryWarehouseTransfer = j.kind === 'transfer';
        u.carryProducer = null;
        const tgt = byId(j.to);
        if (tgt) {
          u.dropB = j.to;
          u.dropIsSite = true;
        } else {
          u.dropB = null;
          u.dropIsSite = false;
        }
        goDrop(u);
        return;
      }
      if (j.kind === 'deliver') {
        const b = byId(j.from);
        if (!b || (b.stock[j.good] | 0) <= 0) {
          const ji2 = game.jobs.indexOf(j);
          if (ji2 >= 0) game.jobs.splice(ji2, 1);
          resetCarrier(u, 'assignment');
          return;
        }
        b.stock[j.good]--;
        u.carryProducer = b.id;
        u.carry = j.good;
        u.carryTransfer = false;
        u.carryWarehouseTransfer = false;
        const store = deliveryStorage(j.good, u);
        u.dropB = store ? store.id : null;
        u.dropIsSite = false;
        goDrop(u);
        return;
      }
    }
    if (u.phase === 'd') {
      const good = u.carry;
      if (good) {
        let dumped = false;
        if (u.dropIsSite && j && (j.kind === 'fetch' || j.kind === 'transfer')) {
          const site = byId(j.to);
          if (site) {
            if (site.done) site.stock[good] = (site.stock[good] | 0) + 1;
            else {
              site.got[good] = (site.got[good] | 0) + 1;
              game.recordEconomicFlow('constructionSpent', good, 1);
            }
            if (j.kind === 'transfer') game.recordEconomicFlow('transferred', good, 1);
            recordDelivery(site, good, true);
            dumped = true;
          }
        }
        if (!dumped) dumpGood(u, good);
      }
      if (j) {
        const ji = game.jobs.indexOf(j);
        if (ji >= 0) game.jobs.splice(ji, 1);
      }
      resetCarrier(u);
      return;
    }
    resetCarrier(u, 'route');
  }
  function arriveSoldier(u: Unit) {
    u.dead = true;
    unitsDirty = true;
    const j = u.job;
    if (j) {
      const ji = game.jobs.indexOf(j);
      if (ji >= 0) game.jobs.splice(ji, 1);
      u.job = null;
    }
    const g = u.dropB ? byId(u.dropB) : null;
    if (g && !g.man) {
      g.man = true;
      game.recomputeTerritory();
      gameEvent('outpostManned', { building: g });
    } else game.soldierPool++;
  }
  function growTrees(dt: number) {
    game.treeGrowthT += dt;
    while (game.treeGrowthT >= 0.1 - 1e-10) {
      game.treeGrowthT = Math.max(0, game.treeGrowthT - 0.1);
      for (let k = 0; k < 40; k++) {
        const i = (game.SR() * game.W * game.H) | 0,
          t = game.tiles[i];
        if (t.tree > 0 && t.tree < 4 && game.SR() < 0.5) {
          t.tree++;
          gameEvent('tileChanged', { index: i });
        }
      }
    }
  }
  function step(dt: number, planningSuspended = false) {
    if (dt <= 0) return;
    game.state.time += dt;
    for (let i = 0; i < game.buildings.length; i++) bTick(game.buildings[i], dt);
    for (let k = 0; k < game.units.length; k++) stepUnit(game.units[k], dt);
    // End-of-step samples include production AND successful carrier arrivals at
    // this simulation time. No HUD, wall clock, speed setting or RNG is involved.
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (b.done && sp.prod && sp.prod !== 'none' && !sp.store && b.metrics)
        sampleProduction(b.metrics);
    }
    // Reaping dead units only allocates when a death actually happened; the
    // identity check keeps save-load array replacements authoritative.
    if (unitsDirty || unitsSource !== game.units) {
      game.units = game.units.filter(function (u) {
        return !u.dead;
      });
      unitsSource = game.units;
      unitsDirty = false;
    }
    assign(dt);
    // Tutorial preferences used by autoplay must follow simulation time, including
    // fast-forward and saved-game continuation, without waiting for a HUD refresh.
    game.gameTick();
    if (game.state.auto) game.autoTick(dt, planningSuspended);
    game.spawnT -= dt;
    if (game.spawnT <= 0) {
      game.spawnT = 15;
      const cap = carrierCap();
      let n = 0;
      for (let k = 0; k < game.units.length; k++) if (game.units[k].kind === 'carrier') n++;
      if (game.serfPool > 0 && n < cap) {
        const s = anyStorage();
        if (s) {
          spawnCarrier(s);
          gameEvent('settlerSpawned', {});
        }
      }
    }
    game.serfT -= dt;
    if (game.serfT <= 0) {
      game.serfT = 15;
      if (game.serfPool < 40) game.serfPool++;
    }
    game.solT -= dt;
    if (game.solT <= 0) {
      game.solT = 40;
      if (game.soldierPool < 20) game.soldierPool++;
    }
    growTrees(dt);
    if (game.state.gold >= game.GOAL && !game.state.won) {
      game.state.won = true;
      gameEvent('victory', { time: game.state.time, gold: game.state.gold });
    }
    game.sampleEconomy();
    gameEvent('simulationObserved', {});
  }
  function incomingCount(g: Good, bid: number) {
    let n = 0;
    for (let i = 0; i < game.jobs.length; i++) {
      const j = game.jobs[i];
      if (j.kind === 'fetch' && j.good === g && j.to === bid) n++;
    }
    return n;
  }
  /** Known destination work only: queued delivery output has no receiver until pickup. */
  function incomingDeliveryStages(good: Good, bid: number): DeliveryStages {
    const stages: DeliveryStages = { queued: 0, assigned: 0, carrying: 0 };
    const counted = new Set<number>();
    for (const job of game.jobs) {
      if (job.kind === 'soldier' || job.good !== good) continue;
      const owner = game.units.find((unit) => !unit.dead && unit.job === job);
      if (
        !((job.kind === 'fetch' || job.kind === 'transfer') && job.to === bid) &&
        !(owner?.dropB === bid)
      )
        continue;
      const stage = deliveryStage(job, owner);
      // This is a per-good count: a carrier with different cargo has not picked up this good.
      const countedStage = stage === 'carrying' && owner.carry !== good ? 'assigned' : stage;
      stages[countedStage] = (stages[countedStage] || 0) + 1;
      if (countedStage === 'carrying') counted.add(owner.id);
    }
    for (const unit of game.units)
      if (!unit.dead && unit.carry === good && unit.dropB === bid && !counted.has(unit.id))
        stages.carrying++;
    return stages;
  }
  function deliveryEvidence(stages: DeliveryStages) {
    return (
      stages.queued +
      ' queued · ' +
      stages.assigned +
      ' assigned (not picked up) · ' +
      stages.carrying +
      ' carrying' +
      (stages.unknown
        ? ' · ' + stages.unknown + ' assignment records: live carrier evidence unavailable'
        : '')
    );
  }
  function buildingStatus(b: Building): BuildingStatus {
    const sp = game.BSPEC[b.type],
      lines = [];
    let g: Good;
    if (!b.done) {
      let allIn = true;
      for (g in b.needs) {
        const have = b.got[g] | 0,
          need = b.needs[g],
          inc = incomingCount(g, b.id);
        if (have < need) {
          allIn = false;
          lines.push({
            t:
              'Needs ' +
              (need - have) +
              ' more ' +
              game.GOODS[g].name.toLowerCase() +
              ' — ' +
              deliveryEvidence(incomingDeliveryStages(g, b.id)),
            w: inc === 0,
          });
        }
      }
      if (allIn) lines.push({ t: 'Materials on site \u2014 builders working', w: false });
      return {
        lines: lines,
        bad: lines.some(function (l) {
          return l.w;
        }),
      };
    }
    if (sp.store) {
      lines.push({ t: 'Storing goods for the colony', w: false });
      return { lines: lines, bad: false };
    }
    if (sp.guard) {
      lines.push(
        b.man
          ? { t: 'Manned \u2014 border extended (radius ' + sp.rad + ')', w: false }
          : { t: 'Needs a soldier \u2014 sent automatically when one is available', w: true },
      );
      if (!b.man) {
        let queued = 0,
          walking = 0,
          unavailable = 0;
        for (const job of game.jobs)
          if (job.kind === 'soldier' && job.to === b.id) {
            if (game.units.some((unit) => !unit.dead && unit.job === job)) walking++;
            else if (job.state === 't') unavailable++;
            else queued++;
          }
        lines.push({
          t:
            queued +
            ' queued for dispatch · ' +
            walking +
            ' walking to this outpost · ' +
            game.soldierPool +
            ' available soldiers in the colony pool' +
            (unavailable
              ? ' · ' + unavailable + ' deployment records: live soldier evidence unavailable'
              : ''),
          w: false,
        });
      }
      return { lines: lines, bad: !b.man };
    }
    if (b.disabled) {
      lines.push({ t: 'Production paused by you', w: false });
      return { lines: lines, bad: false };
    }
    switch (sp.prod) {
      case 'gather': {
        let trees = 0;
        forRadius(b, sp.rad, function (i) {
          if (game.tiles[i].tree >= 3) trees++;
        });
        if (trees === 0) lines.push({ t: 'NO TREES in range! Build a Forester nearby', w: true });
        else
          lines.push({
            t: 'Chopping wood \u2014 ' + trees + ' tree' + (trees > 1 ? 's' : '') + ' in range',
            w: false,
          });
        if (productionOutputBlocked(b, sp))
          lines.push({ t: 'Output full \u2014 waiting for a carrier to collect', w: true });
        break;
      }
      case 'plant':
        lines.push({ t: 'Planting saplings for the future', w: false });
        break;
      case 'rock': {
        let rocks = 0;
        forRadius(b, sp.rad, function (i) {
          if (game.tiles[i].rock) rocks++;
        });
        if (rocks === 0)
          lines.push({ t: 'NO ROCKS left in range! Rebuild the quarry elsewhere', w: true });
        else
          lines.push({
            t:
              'Quarrying \u2014 ' +
              rocks +
              ' rock tile' +
              (rocks > 1 ? 's' : '') +
              ' left in range',
            w: false,
          });
        break;
      }
      case 'fish':
        lines.push({
          t: foodSaturated(sp.out)
            ? 'Food stocks are plentiful \u2014 production paused'
            : 'Fishing \u2014 never runs out',
          w: false,
        });
        break;
      case 'farm':
        lines.push({
          t: intermediateSaturated('grain')
            ? 'Grain reserves are plentiful — production paused'
            : 'Growing grain',
          w: false,
        });
        break;
      case 'craft':
      case 'mine': {
        if (sp.prod === 'mine' && foodVarietyBonus(b) > 0)
          lines.push({
            t: 'Food variety: +' + Math.round(foodVarietyBonus(b) * 100) + '% mining speed',
            w: false,
          });
        if (b.exhausted) {
          lines.push({ t: 'Deposit exhausted! Build a replacement mine elsewhere', w: true });
          return { lines: lines, bad: true };
        }
        if (b.type === 'workshop' && totalGood('planks') < productionReserves.planks)
          lines.push({
            t: 'Paused \u2014 keeping a planks reserve for construction sites',
            w: false,
          });
        if (sp.out && edibleGoods.includes(sp.out) && foodSaturated(sp.out))
          lines.push({ t: 'Stocks are plentiful — production paused', w: false });
        if (sp.out && intermediateSaturated(sp.out))
          lines.push({
            t: game.GOODS[sp.out].name + ' reserves are plentiful — production paused',
            w: false,
          });
        if (
          sp.out === 'beer' &&
          totalGood('beer') >= Math.max(productionReserves.beer, stockTargetTotal('beer'))
        )
          lines.push({ t: 'Beer reserves are plentiful — production paused', w: false });
        if (sp.water && !hasLocalWater(b))
          lines.push({ t: `Needs a working well within ${wellRadius(game)} tiles`, w: true });
        for (const shortage of ingredientShortages(b, sp)) {
          const alternatives = sp.prod === 'mine' ? edibleGoods : [shortage.good];
          const stages: DeliveryStages = { queued: 0, assigned: 0, carrying: 0 };
          for (const good of alternatives) {
            const known = incomingDeliveryStages(good, b.id);
            stages.queued += known.queued;
            stages.assigned += known.assigned;
            stages.carrying += known.carrying;
            if (known.unknown) stages.unknown = (stages.unknown || 0) + known.unknown;
          }
          const incoming =
            stages.queued + stages.assigned + stages.carrying + (stages.unknown || 0);
          const available = alternatives.reduce(
            (n, good) =>
              n +
              Math.max(
                0,
                storages().reduce(
                  (n, store) => n + (store.stock[good] || 0) - (store.res[good] || 0),
                  0,
                ),
              ),
            0,
          );
          lines.push({
            t:
              (shortage.have === 0 && !incoming ? 'STARVED: no ' : 'Waiting for ') +
              (sp.prod === 'mine'
                ? 'fish, bread, meat or provisions'
                : game.GOODS[shortage.good].name.toLowerCase()) +
              ' · ' +
              shortage.have +
              ' locally · ' +
              deliveryEvidence(stages) +
              (incoming
                ? ' — delivery work exists; no arrival time is guaranteed'
                : available > 0
                  ? ' — ' +
                    available +
                    ' free in colony storage; delivery scheduling or route still required'
                  : ' — no free colony supply'),
            w: !incoming,
          });
        }
        if (productionOutputBlocked(b, sp))
          lines.push({ t: 'Output full \u2014 waiting for a carrier to collect', w: true });
        if (!lines.length)
          lines.push({
            t:
              (sp.prod === 'mine' ? 'Mining ' : 'Crafting ') +
              game.GOODS[sp.out].name.toLowerCase() +
              ' at full capacity',
            w: false,
          });
        break;
      }
    }
    return {
      lines: lines,
      bad: lines.some(function (l) {
        return l.w;
      }),
    };
  }
  // ---- AUTO-PLAY ----
  // Test-only view of closure internals; never merged into the runtime.
  if (internals)
    Object.assign(internals, {
      nearestStorage,
      ensureJobs,
      startJob,
      bTick,
      assign,
      cancelJobs,
      deliveryStorage,
      replenishTargets,
      growTrees,
      stepUnit,
    });

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    byId,
    buildingAt,
    storages,
    anyStorage,
    nearestStoragePos,
    totalGood,
    stockTargetTotal,
    foodSaturated,
    carrierCap,
    newBuilding,
    siteReady,
    availGood,
    requestStock,
    canPlace,
    placementChecks,
    buildingAffordability,
    hasLocalWater,
    suggestFor,
    placeBuilding,
    demolish,
    demolitionQuote,
    setBuildingPriority,
    setStockTarget,
    incomingDeliveryStages,
    productionProgress,
    buildingWorking,
    forRadius,
    spawnCarrier,
    speedOn,
    step,
    buildingStatus,
    productionWindow,
  };
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface EconomyInternals {
  nearestStorage: (
    ref: Pick<Building, 'x' | 'y'>,
    options?: StorageSearchOptions,
  ) => Building | null;
  ensureJobs: () => void;
  startJob: (u: Unit, j: Job) => void;
  bTick: (b: Building, dt: number) => void;
  assign: (dt: number) => void;
  cancelJobs: (pred: (j: Job) => boolean) => void;
  deliveryStorage: (g: Good, ref: Pick<Building, 'x' | 'y'>) => Building | null;
  replenishTargets: () => void;
  growTrees: (dt: number) => void;
  stepUnit: (u: Unit, dt: number) => void;
}

/** Advice copy keyed by a placement failure reason (reason → advice). */
export type PlacementAdvice =
  | ''
  | 'build more producers — or inspect a demolition quote for exact recoverable goods'
  | 'build an Outpost toward that spot — it pushes your border out'
  | 'place it on a shore inside your border (grass or sand both work)'
  | 'click mountains to scout them, then build against the wall with the colored dots'
  | 'find a grey rock cluster — the map guarantees some near your start'
  | 'keep about 2 tiles of space between buildings';

export interface ProductionProgress {
  reason: string;
  explanation: string;
  suspended: boolean;
  remainingWork: number;
  remaining: number;
  duration: number;
  base: number;
  tier: number;
  variety: number;
}

export interface EconomySubsystem {
  buildingWorking: (b: Building) => boolean;
  productionProgress: (b: Building) => ProductionProgress | null;
  byId: (id: number) => Building | null;
  buildingAt: (x: number, y: number) => Building | null;
  storages: () => Building[];
  anyStorage: () => Building | null;
  nearestStoragePos: (x: number, y: number) => Building | null;
  totalGood: (g: Good) => number;
  stockTargetTotal: (g: Good) => number;
  foodSaturated: (good?: Good) => boolean;
  carrierCap: () => number;
  newBuilding: (type: BuildingType, x: number, y: number) => Building;
  siteReady: (b: Building) => boolean;
  availGood: (g: Good, ref?: Pick<Building, 'x' | 'y'>) => number;
  requestStock: (cost: Inventory, ref?: Pick<Building, 'x' | 'y'>) => boolean;
  hasLocalWater: (b: Pick<Building, 'x' | 'y'>) => boolean;
  buildingAffordability: (
    type: BuildingType,
    ref?: Pick<Building, 'x' | 'y'>,
  ) => BuildingAffordability;
  placementChecks: (type: BuildingType, x: number, y: number) => PlacementChecks;
  canPlace: (type: BuildingType, x: number, y: number) => [boolean, string];
  suggestFor: (reason: string) => PlacementAdvice;
  placeBuilding: (type: BuildingType, x: number, y: number) => boolean;
  demolitionQuote: (b: Building) => DemolitionQuote;
  setBuildingPriority: (b: Building, priority: unknown) => boolean;
  setStockTarget: (b: Building, good: Good, amount: unknown) => boolean;
  incomingDeliveryStages: (good: Good, bid: number) => DeliveryStages;
  demolish: (b: Building) => void;
  forRadius: <T>(
    b: Building,
    r: number,
    f: (i: number, x: number, y: number) => T | undefined,
  ) => T | undefined;
  spawnCarrier: (s: Building) => void;
  speedOn: (u: Pick<Unit, 'x' | 'y'>, destination?: number) => number;
  step: (dt: number, planningSuspended?: boolean) => void;
  buildingStatus: (b: Building) => BuildingStatus;
  productionWindow: (
    metrics: ProductionMetrics,
    window: ProductionRateWindow,
  ) => ProductionWindowMetrics;
}

export interface EconomyDependencies
  extends
    Pick<
      SimulationStateSubsystem,
      | 'BSPEC'
      | 'GOODS'
      | 'assignT'
      | 'buildings'
      | 'jobs'
      | 'nextId'
      | 'serfPool'
      | 'serfT'
      | 'solT'
      | 'soldierPool'
      | 'spawnT'
      | 'state'
      | 'treeGrowthT'
      | 'units'
    >,
    Pick<
      WorldSubsystem,
      | 'DX'
      | 'DY'
      | 'GOAL'
      | 'GRASS'
      | 'H'
      | 'MTN'
      | 'SAND'
      | 'SR'
      | 'W'
      | 'WATER'
      | 'idx'
      | 'inB'
      | 'passI'
      | 'tiles'
    >,
    Pick<AutoplaySubsystem, 'autoTick'>,
    Pick<NavigationSubsystem, 'connectedLand' | 'findPath' | 'moveCost'>,
    Pick<ObservationSubsystem, 'recordEconomicFlow' | 'sampleEconomy' | 'recordCargoArrival'>,
    Pick<EventsSubsystem, 'emitGameEvent'>,
    Pick<ProgressionSubsystem, 'gameTick'>,
    Pick<MapSubsystem, 'owned' | 'recomputeTerritory' | 'projectTerritory'> {}

/** Placement permission stays separate from click-time spending permission. */
export interface PlacementCheck {
  ok: boolean | null;
  reason: string;
}
export interface PlacementChecks {
  ok: boolean;
  reason: string;
  terrain: PlacementCheck;
  ownership: PlacementCheck;
  resources: PlacementCheck;
}

export interface BuildingAffordability {
  affordable: boolean;
  materials: Array<{
    good: Good;
    required: number;
    free: number;
    available: number;
    optionalTransfers: number;
    reclaim: number;
  }>;
}

export interface DemolitionQuote {
  allowed: boolean;
  reason: string;
  completed: boolean;
  refund: Inventory;
  salvage: Inventory;
  receiver: Pick<Building, 'id' | 'type' | 'x' | 'y'> | null;
  returnedSoldiers: number;
  equipment: Inventory;
  equipmentReceiver: Pick<Building, 'id' | 'type' | 'x' | 'y'> | null;
  cancelledDeliveries: DeliveryStages;
  territoryLost: number;
  affectedBuildings: number[];
}

export interface DeliveryStages {
  queued: number;
  assigned: number;
  carrying: number;
  unknown?: number;
}
