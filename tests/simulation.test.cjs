'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGame, pinClock, DEFAULT_MODULES } = require('./helpers/game.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

function engine(seed = 2024, modules = DEFAULT_MODULES) {
  const events = [];
  const noop = () => {};
  const { game: e } = createGame({
    seed,
    modules,
    stubs: {
      rebuildHighlights: noop,
      refreshGhost: noop,
      drawTile: noop,
      sctx: {},
      updateInfo: noop,
      SND: { fail: noop, place: noop, done: noop, demolish: noop, gone: noop, man: noop },
      commitRoad: noop,
      borderDirty: false,
      FX: { ring: noop, coin: noop },
      emitGameEvent: (name, payload) => events.push({ name, payload }),
    },
  });
  e.events = events;
  return e;
}

function flatMap(e, size = e.W) {
  e.tiles = Array.from({ length: e.W * e.H }, (_, i) => ({
    t: i % e.W < size && Math.floor(i / e.W) < size ? e.GRASS : e.WATER,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  e.owned.fill(1);
}

function pathCost(e, start, route) {
  let cost = 0;
  for (const next of route) {
    const diagonal =
      start % e.W !== next % e.W && Math.floor(start / e.W) !== Math.floor(next / e.W);
    cost += e.moveCost(next) * (diagonal ? Math.SQRT2 : 1);
    start = next;
  }
  return cost;
}

// Independent reference search: no heuristic, no game heap, exact double precision.
function dijkstra(e, start, goal) {
  const distances = new Float64Array(e.W * e.H).fill(Infinity);
  const seen = new Uint8Array(distances.length);
  distances[start] = 0;
  while (true) {
    let current = -1;
    let minimum = Infinity;
    for (let i = 0; i < distances.length; i++) {
      if (!seen[i] && distances[i] < minimum) {
        current = i;
        minimum = distances[i];
      }
    }
    if (current < 0 || current === goal) return distances[goal];
    seen[current] = 1;
    const x = current % e.W,
      y = Math.floor(current / e.W);
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + e.DX[direction],
        ny = y + e.DY[direction];
      if (!e.inB(nx, ny)) continue;
      const next = e.idx(nx, ny);
      if (!e.passI(next)) continue;
      if (direction >= 4 && (!e.passI(e.idx(x, ny)) || !e.passI(e.idx(nx, y)))) continue;
      const candidate = minimum + e.moveCost(next) * (direction >= 4 ? Math.SQRT2 : 1);
      if (candidate < distances[next]) distances[next] = candidate;
    }
  }
}

function building(e, type, x, y, stock = {}) {
  const b = e.newBuilding(type, x, y);
  b.done = true;
  b.stock = { ...stock };
  e.buildings.push(b);
  return b;
}

function totalResources(e, good) {
  let count = e.buildings.reduce((sum, b) => sum + (b.stock[good] || 0) + (b.got[good] || 0), 0);
  count += e.units.filter((u) => u.carry === good).length;
  return count;
}

function checkReservations(e) {
  for (const b of e.storages()) {
    for (const good of Object.keys(e.GOODS)) {
      const pending = e.jobs.filter(
        (j) =>
          (j.kind === 'fetch' || j.kind === 'transfer') &&
          j.s === b.id &&
          j.good === good &&
          !e.units.some((u) => u.job === j && u.carry),
      ).length;
      assert.equal(b.reservedStock[good] || 0, pending, `reservation ${b.id}/${good}`);
      assert.ok((b.stock[good] || 0) >= (b.reservedStock[good] || 0));
    }
  }
  for (const u of e.units)
    if (u.job) assert.ok(e.jobs.includes(u.job), 'assigned job remains in queue');
}

test('A* finds the same road, sand and forest route cost as Dijkstra', () => {
  const e = engine();
  flatMap(e, 20);
  // A longer road detour must beat the short direct meadow route.
  for (let x = 1; x <= 17; x++) e.tiles[e.idx(x, 8)].road = true;
  for (let y = 3; y <= 8; y++) {
    e.tiles[e.idx(1, y)].road = true;
    e.tiles[e.idx(17, y)].road = true;
  }
  const start = e.idx(1, 3),
    goal = e.idx(17, 3);
  const route = e.findPath(1, 3, 17, 3);
  assert.ok(
    route.some((i) => Math.floor(i / e.W) >= 7),
    'choose the road detour',
  );
  assert.ok(Math.abs(pathCost(e, start, route) - dijkstra(e, start, goal)) < 1e-4);

  for (const seed of [1, 42, 2024, 98123]) {
    flatMap(e, 20);
    const random = e.mulberry32(seed);
    for (let y = 1; y < 19; y++)
      for (let x = 1; x < 19; x++) {
        const t = e.tiles[e.idx(x, y)],
          roll = random();
        if (roll < 0.12) t.t = e.WATER;
        else if (roll < 0.3) t.road = true;
        else if (roll < 0.5) t.tree = 4;
        else if (roll < 0.65) t.t = e.SAND;
      }
    e.tiles[start].t = e.GRASS;
    e.tiles[goal].t = e.GRASS;
    const p = e.findPath(1, 3, 17, 3),
      optimal = dijkstra(e, start, goal);
    assert.equal(p === null, optimal === Infinity);
    if (p) assert.ok(Math.abs(pathCost(e, start, p) - optimal) < 1e-4, `seed ${seed}`);
  }
});

test('movement consumes remaining time across terrain and waypoints', () => {
  function run(parts) {
    const e = engine();
    flatMap(e);
    const route = [];
    for (let x = 2; x <= 30; x++) {
      const i = e.idx(x, 5);
      route.push(i);
      if (x % 5 < 2) e.tiles[i].road = true;
      else if (x % 5 === 2) e.tiles[i].tree = 4;
      else if (x % 5 === 3) e.tiles[i].t = e.SAND;
    }
    const u = { kind: 'carrier', x: 1.5, y: 5.5, path: route, pi: 0, lx: 0, ly: 0, phase: 'idle' };
    for (const dt of parts) e.stepUnit(u, dt);
    return u;
  }
  const large = run([5]);
  for (const parts of [Array(20).fill(0.25), Array(300).fill(1 / 60)]) {
    const small = run(parts);
    assert.ok(Math.abs(large.x - small.x) < 1e-8);
    assert.ok(Math.abs(large.y - small.y) < 1e-8);
    assert.ok(Math.abs(large.walkDistance - small.walkDistance) < 1e-8);
    assert.equal(large.pi, small.pi);
  }
  assert.ok(large.x > 10, 'large timestep crosses multiple waypoints');
});

test('a pickup followed by a same-tile drop cannot read an empty route', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { planks: 1 });
  const unreachable = e.newBuilding('mine_coal', 20, 20);
  e.buildings.push(unreachable);
  for (let d = 0; d < 4; d++) e.tiles[e.idx(20 + e.DX[d], 20 + e.DY[d])].t = e.WATER;
  e.spawnCarrier(store);
  const u = e.units[0];
  u.x = 5.5;
  u.y = 5.5;
  u.lx = 0;
  u.ly = 0;
  const j = { kind: 'fetch', good: 'planks', s: store.id, to: unreachable.id, state: 'p' };
  store.reservedStock.planks = 1;
  e.jobs.push(j);
  e.startJob(u, j);
  e.stepUnit(u, 0.25);
  assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y));
  assert.equal(u.phase, 'idle');
  assert.equal(u.carry, null);
  assert.equal(u.job, null);
  assert.equal(store.stock.planks, 1);
  assert.equal(store.reservedStock.planks, 0);
  assert.equal(e.jobs.length, 0);
});

test('an unowned meadow pocket surrounded by mountains cannot host a mine', () => {
  const e = engine();
  flatMap(e);
  e.owned.fill(0);
  for (let d = 0; d < 4; d++) {
    const t = e.tiles[e.idx(20 + e.DX[d], 20 + e.DY[d])];
    t.t = e.MTN;
    t.deposit = { kind: 'gold', amt: 100, amt0: 100 };
  }
  assert.equal(e.canPlace('mine_gold', 20, 20)[0], false);
  assert.deepEqual(e.canPlace('mine_gold', 20, 20)[1], { code: 'territory' });
});

test('seed42 coastal expansion fixture retains useful claims and advances the mining route', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/seed42-expansion-failure.json'), 'utf8'),
  );
  const e = engine(fixture.seed);
  e.genMap();
  building(e, 'hq', e.W >> 1, e.H >> 1);
  const previous = fixture.diagnosticCheckpoint.outposts[0];
  const guard = building(e, 'guard', previous.x, previous.y);
  guard.manned = true;
  e.recomputeTerritory();
  const corridor = e.buildCorridor(['gold']);
  assert.ok(corridor && corridor.length);
  const before = corridor.reduce(
    (furthest, i, q) => (e.owned[i] ? Math.max(furthest, q) : furthest),
    -1,
  );
  const next = e.spotOnCorridor(corridor, ['gold']);
  assert.ok(next, 'a useful outpost exists beside the coastal route');
  assert.equal(e.isFaceTile(next[0], next[1], ['gold']), false, 'leave mine faces free');
  e.computeGuardPreview(next[0], next[1]);
  const after = corridor.reduce(
    (furthest, i, q) => (e.gpOwned[i] ? Math.max(furthest, q) : furthest),
    -1,
  );
  assert.ok(after > before, 'the manned flood reaches new route tiles');
  const useful = building(e, 'guard', next[0], next[1]);
  useful.manned = true;
  e.recomputeTerritory();
  assert.equal(e.guardTerritoryRedundant(useful), false, 'a new essential claim is not recycled');
});

test('pause status changes immediately even while simulation time is stopped', () => {
  const e = engine();
  flatMap(e);
  const forester = building(e, 'forester', 5, 5);
  assert.match(e.bStatus(forester).lines[0].t, /Planting/);
  forester.disabled = true;
  assert.match(e.bStatus(forester).lines[0].t, /Production paused/);
  forester.disabled = false;
  assert.match(e.bStatus(forester).lines[0].t, /Planting/);
});

test('tree growth uses elapsed simulation time and saves RNG continuation', () => {
  function run(parts) {
    const e = engine();
    flatMap(e);
    for (const tile of e.tiles) tile.tree = 1;
    for (const dt of parts) e.growTrees(dt);
    return e;
  }
  const reference = run([10]);
  for (const parts of [Array(40).fill(0.25), Array(600).fill(1 / 60)]) {
    const e = run(parts);
    assert.deepEqual(
      e.tiles.map((t) => t.tree),
      reference.tiles.map((t) => t.tree),
    );
    assert.equal(e.SR.getState(), reference.SR.getState());
    assert.ok(Math.abs(e.treeGrowthT - reference.treeGrowthT) < 1e-8);
  }
  const rng = reference.mulberry32(2);
  rng();
  const saved = rng.getState(),
    expected = [rng(), rng(), rng()];
  rng.setState(saved);
  assert.deepEqual([rng(), rng(), rng()], expected);
});

test('cancelling assigned jobs releases reservations and salvages carried cargo', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { logs: 6 });
  const mill = building(e, 'sawmill', 12, 5);
  e.spawnCarrier(store);
  e.ensureJobs();
  const u = e.units[0],
    j = e.jobs.find((j) => j.kind === 'fetch');
  e.startJob(u, j);
  checkReservations(e);
  e.cancelJobs((candidate) => candidate === j);
  checkReservations(e);
  assert.equal(u.job, null);
  assert.equal(totalResources(e, 'logs'), 6);

  e.ensureJobs();
  const second = e.jobs.find((j) => j.kind === 'fetch');
  e.startJob(u, second);
  e.stepUnit(u, 0.01); // pickup at the warehouse, now en route with cargo
  assert.equal(u.carry, 'logs');
  e.cancelJobs((candidate) => candidate === second);
  for (let i = 0; i < 100; i++) e.stepUnit(u, 0.1);
  checkReservations(e);
  assert.equal(totalResources(e, 'logs'), 6);
  assert.equal(u.job, null);
  assert.equal(u.carry, null);
  assert.equal(mill.stock.logs || 0, 0);
});

test('full output pauses production without consuming inputs or natural resources', () => {
  const e = engine();
  flatMap(e);
  building(e, 'hq', 2, 2);
  const mill = building(e, 'sawmill', 5, 5, { logs: 4, planks: 8 });
  mill.timer = 0;
  const logger = building(e, 'lumberjack', 15, 15, { logs: 7 });
  logger.timer = 0;
  e.tiles[e.idx(16, 15)].tree = 4;
  e.bTick(mill, 30);
  e.bTick(logger, 30);
  assert.equal(mill.stock.logs, 4);
  assert.equal(logger.stock.logs, 7);
  assert.equal(e.tiles[e.idx(16, 15)].tree, 4);
  assert.equal(mill.metrics.outputBlocked, 30);
  mill.stock.planks = 7;
  e.bTick(mill, 0.01);
  assert.equal(mill.stock.planks, 8);
  assert.equal(mill.stock.logs, 2);
  assert.equal(mill.metrics.consumed.logs, 2);
  assert.equal(mill.metrics.produced.planks, 1);
});

test('warehouse stock targets transfer existing goods without minting gold', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { gold: 5, logs: 5 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets = { gold: 3, logs: 2 };
  e.state.gold = 5;
  for (let i = 0; i < 4; i++) e.spawnCarrier(source);
  for (let i = 0; i < 2000; i++) e.step(1 / 60);
  checkReservations(e);
  assert.equal(target.stock.gold, 3);
  assert.equal(target.stock.logs, 2);
  assert.equal(totalResources(e, 'gold'), 5);
  assert.equal(totalResources(e, 'logs'), 5);
  assert.equal(e.state.gold, 5);
  assert.equal(e.events.filter((event) => event.name === 'firstGold').length, 0);
});

test('cancelling a gold transfer preserves its storage provenance', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { gold: 5 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets.gold = 3;
  e.state.gold = 5;
  e.spawnCarrier(source);
  e.ensureJobs();
  const j = e.jobs.find((j) => j.kind === 'transfer'),
    u = e.units[0];
  e.startJob(u, j);
  e.stepUnit(u, 0.5);
  assert.equal(u.carry, 'gold');
  assert.equal(u.carryTransfer, true);
  e.cancelJobs((candidate) => candidate === j);
  e.stepUnit(u, 2);
  checkReservations(e);
  assert.equal(totalResources(e, 'gold'), 5);
  assert.equal(e.state.gold, 5);
  assert.equal(e.events.filter((event) => event.name === 'firstGold').length, 0);
});

test('producer deliveries keep their target after picking up the last output', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5);
  const target = building(e, 'warehouse', 15, 5);
  target.targets.gold = 2;
  const mine = building(e, 'mine_gold', 8, 5, { gold: 1 });
  mine.disabled = true;
  e.spawnCarrier(source);
  for (let i = 0; i < 1200; i++) e.step(1 / 60);
  checkReservations(e);
  assert.equal(target.stock.gold, 1);
  assert.equal(source.stock.gold || 0, 0);
  assert.equal(totalResources(e, 'gold'), 1);
  assert.equal(e.state.gold, 1);
  assert.equal(e.events.filter((event) => event.name === 'firstGold').length, 1);
});

test('higher construction priority gets scarce materials first', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { planks: 2, tools: 1 });
  const first = e.newBuilding('lumberjack', 12, 5),
    priority = e.newBuilding('lumberjack', 15, 5);
  priority.priority = 2;
  e.buildings.push(first, priority);
  e.ensureJobs();
  assert.ok(e.jobs.filter((j) => j.kind === 'fetch').every((j) => j.to === priority.id));
  checkReservations(e);
  assert.equal(store.reservedStock.planks, 2);
});

test('new construction reclaims pending warehouse transfers before rejecting stored materials', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { planks: 8, tools: 2 });
  const target = building(e, 'warehouse', 11, 5);
  target.targets.planks = 8;
  for (let i = 0; i < 4; i++) e.ensureJobs();
  assert.equal(source.reservedStock.planks, 8);
  assert.equal(e.totalGood('planks'), 8);
  assert.equal(e.canPlace('lumberjack', 5, 9)[0], true);
  assert.equal(e.placeBuilding('lumberjack', 5, 9), true);
  const site = e.buildingAt(5, 9);
  e.ensureJobs();
  assert.equal(
    e.jobs.filter((j) => j.kind === 'fetch' && j.to === site.id && j.good === 'planks').length,
    2,
  );
  assert.equal(e.jobs.filter((j) => j.kind === 'transfer' && j.good === 'planks').length, 6);
  checkReservations(e);
});

test('higher-priority stock requests preserve fetch reservations and collected transfer cargo', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { gold: 5, logs: 5 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets = { gold: 5, logs: 5 };
  const mill = building(e, 'sawmill', 12, 5);
  e.ensureJobs();
  e.spawnCarrier(source);
  const goldJob = e.jobs.find((j) => j.kind === 'transfer' && j.good === 'gold');
  e.startJob(e.units[0], goldJob);
  e.stepUnit(e.units[0], 0.1);
  assert.equal(e.units[0].carry, 'gold');
  const fetches = e.jobs.filter((j) => j.kind === 'fetch' && j.to === mill.id);
  assert.equal(fetches.length, 3);
  assert.equal(e.requestStock({ gold: 4, logs: 2 }), true);
  assert.ok(e.jobs.includes(goldJob), 'preserve the collected gold transfer');
  assert.ok(
    fetches.every((j) => e.jobs.includes(j)),
    'do not steal existing fetch reservations',
  );
  assert.equal(source.reservedStock.gold, 0);
  assert.equal(source.reservedStock.logs, 3);
  assert.equal(e.availGood('logs'), 2);
  assert.equal(e.requestStock({ logs: 3 }), false);
  checkReservations(e);
});

test('an unaffordable stock request leaves all transfer reservations unchanged', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { planks: 8, tools: 0 });
  const target = building(e, 'warehouse', 11, 5);
  target.targets.planks = 8;
  for (let i = 0; i < 4; i++) e.ensureJobs();
  const before = [...e.jobs];
  assert.equal(e.requestStock({ planks: 2, tools: 1 }), false);
  assert.deepEqual([...e.jobs], before);
  assert.equal(source.reservedStock.planks, 8);
  assert.equal(e.placeBuilding('lumberjack', 5, 9), false);
  assert.deepEqual([...e.jobs], before);
  checkReservations(e);
});

test('existing construction preempts an assigned transfer before pickup', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { planks: 2, tools: 1 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets.planks = 2;
  e.ensureJobs();
  e.spawnCarrier(target);
  const u = e.units[0],
    transfer = e.jobs[0];
  e.startJob(u, transfer);
  assert.equal(u.phase, 'p');
  assert.equal(u.carry, null);
  const site = e.newBuilding('lumberjack', 5, 9);
  e.buildings.push(site);
  e.ensureJobs();
  assert.equal(u.job, null);
  assert.equal(u.phase, 'idle');
  assert.equal(u.path, null);
  assert.ok(!e.jobs.includes(transfer));
  assert.equal(e.jobs.filter((j) => j.kind === 'fetch' && j.to === site.id).length, 3);
  assert.equal(totalResources(e, 'planks'), 2);
  checkReservations(e);
});

test('explicit spending reclaims optional transfers while keeping construction materials reserved', () => {
  const e = engine(2024, [...DEFAULT_MODULES, 'progression']);
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { planks: 12, stone: 3, gold: 25 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets = { planks: 8, gold: 25 };
  const site = e.newBuilding('warehouse', 5, 9);
  e.buildings.push(site);
  for (let i = 0; i < 13; i++) e.ensureJobs();
  e.state.gold = 25;
  e.state.spentGold = 0;
  assert.equal(source.reservedStock.planks, 12);
  assert.equal(source.reservedStock.gold, 25);
  assert.equal(e.spendStock({ planks: 8, gold: 15 }), true);
  assert.equal(source.stock.planks, 4);
  assert.equal(source.reservedStock.planks, 4);
  assert.equal(source.stock.gold, 10);
  assert.equal(source.reservedStock.gold, 10);
  assert.equal(e.state.gold, 10);
  assert.equal(e.state.spentGold, 15);
  assert.equal(e.jobs.filter((j) => j.kind === 'fetch' && j.to === site.id).length, 7);
  checkReservations(e);
});

test('a nearby carrier across water does not block a reachable carrier', () => {
  const e = engine();
  flatMap(e);
  for (let y = 0; y < e.H; y++) e.tiles[e.idx(10, y)].t = e.WATER;
  const store = building(e, 'hq', 13, 5);
  const farm = building(e, 'farm', 11, 5, { grain: 1 });
  farm.disabled = true;
  e.spawnCarrier(store);
  e.spawnCarrier(store);
  const stranded = e.units[0],
    reachable = e.units[1];
  stranded.x = 9.5;
  reachable.x = 20.5;
  e.assign(1);
  assert.equal(stranded.job, null);
  assert.equal(reachable.job?.from, farm.id, 'try the carrier that can reach the producer');
  for (let i = 0; i < 600; i++) e.stepUnit(reachable, 1 / 60);
  assert.equal(store.stock.grain, 1);
  checkReservations(e);
});

test('construction reserves reachable stock instead of a closer disconnected warehouse', () => {
  const e = engine();
  flatMap(e);
  for (let y = 0; y < e.H; y++) e.tiles[e.idx(10, y)].t = e.WATER;
  const disconnected = building(e, 'hq', 8, 5, { planks: 3 });
  const reachable = building(e, 'warehouse', 20, 5, { planks: 3 });
  const site = e.newBuilding('warehouse', 12, 5);
  e.buildings.push(site);
  e.ensureJobs();
  assert.ok(e.jobs.length > 0);
  assert.ok(e.jobs.every((j) => j.s === reachable.id));
  assert.equal(disconnected.reservedStock.planks || 0, 0);
  checkReservations(e);
});

test('lowering a stock target releases uncollected transfers without losing cargo', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { logs: 6 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets.logs = 4;
  e.spawnCarrier(source);
  e.ensureJobs();
  e.startJob(e.units[0], e.jobs[0]);
  e.stepUnit(e.units[0], 0.1);
  assert.equal(e.units[0].carry, 'logs');
  target.targets.logs = 0;
  e.ensureJobs();
  assert.equal(e.jobs.filter((j) => j.kind === 'transfer' && j.state === 'p').length, 0);
  assert.equal(source.reservedStock.logs, 0);
  for (let i = 0; i < 600; i++) e.stepUnit(e.units[0], 1 / 60);
  assert.equal(totalResources(e, 'logs'), 6);
  checkReservations(e);
});

test('raising the source reserve cancels exports that have not been collected', () => {
  const e = engine();
  flatMap(e);
  const source = building(e, 'hq', 5, 5, { logs: 6 });
  const target = building(e, 'warehouse', 15, 5);
  target.targets.logs = 4;
  e.ensureJobs();
  assert.equal(source.reservedStock.logs, 2);
  source.targets.logs = 6;
  e.ensureJobs();
  assert.equal(source.reservedStock.logs, 0);
  assert.equal(e.jobs.length, 0);
  checkReservations(e);
});

test('warehouse demand and producer drops ignore disconnected destinations', () => {
  const e = engine();
  flatMap(e);
  for (let y = 0; y < e.H; y++) e.tiles[e.idx(10, y)].t = e.WATER;
  const disconnected = building(e, 'hq', 9, 5, { logs: 4 });
  const reachable = building(e, 'warehouse', 20, 5, { logs: 4 });
  disconnected.targets.food = 40;
  reachable.targets.logs = 8;
  assert.equal(e.deliveryStorage('food', { x: 11, y: 5 }), reachable);
  e.replenishTargets();
  assert.equal(e.jobs.length, 0, 'do not reserve goods for an impossible transfer');
  assert.equal(disconnected.reservedStock.logs || 0, 0);
});

test('pausing a producer releases ingredient reservations for construction', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { planks: 2, stone: 1 });
  const smith = building(e, 'workshop', 12, 5);
  e.ensureJobs();
  assert.equal(store.reservedStock.planks, 2);
  smith.disabled = true;
  e.ensureJobs();
  assert.equal(store.reservedStock.planks, 0);
  assert.equal(store.reservedStock.stone, 0);
  assert.equal(e.jobs.filter((j) => j.kind === 'fetch').length, 0);
  checkReservations(e);
});

test('pausing a producer preserves an ingredient already in transit', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { logs: 4 });
  const mill = building(e, 'sawmill', 12, 5);
  e.spawnCarrier(store);
  e.ensureJobs();
  const u = e.units[0];
  e.startJob(u, e.jobs[0]);
  e.stepUnit(u, 0.1);
  mill.disabled = true;
  e.ensureJobs();
  assert.equal(store.reservedStock.logs, 0, 'release every uncollected reservation');
  for (let i = 0; i < 600; i++) e.stepUnit(u, 1 / 60);
  assert.equal(mill.stock.logs, 1);
  assert.equal(totalResources(e, 'logs'), 4);
  checkReservations(e);
});

test('food production respects a pantry target above the normal reserve', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { meat: 10 });
  const farm = building(e, 'butcher', 12, 5, { pigs: 2 });
  store.targets.meat = 20;
  farm.timer = 0;
  e.bTick(farm, 1);
  assert.equal(farm.stock.meat, 1, 'stock target creates demand without live mines');
  store.stock.meat = 20;
  farm.timer = 0;
  e.bTick(farm, 1);
  assert.equal(farm.stock.meat, 1, 'the satisfied target still pauses excess production');
});

test('tools and weapons targets create demand while retaining the plank safety reserve', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { tools: 12, weapons: 15, planks: 8 });
  store.targets = { tools: 16, weapons: 18 };
  const smith = building(e, 'workshop', 12, 5, { planks: 2, stone: 1 });
  const armory = building(e, 'armory', 20, 5, { iron_bars: 1, coal: 1 });
  smith.timer = 0;
  armory.timer = 0;
  e.bTick(smith, 1);
  e.bTick(armory, 1);
  assert.equal(smith.stock.tools, 1);
  assert.equal(armory.stock.weapons, 1);
  store.stock.planks = 3;
  smith.stock.planks = 2;
  smith.stock.stone = 1;
  smith.timer = 0;
  e.bTick(smith, 1);
  assert.equal(smith.stock.tools, 1);
  assert.equal(smith.stock.planks, 2);
});

test('demolishing an empty construction site cannot mint material refunds', () => {
  const e = engine();
  flatMap(e);
  const store = building(e, 'hq', 5, 5, { planks: 10, tools: 4 });
  const site = e.newBuilding('lumberjack', 10, 5);
  e.buildings.push(site);
  e.ensureJobs();
  e.demolish(site);
  assert.equal(store.stock.planks, 10);
  assert.equal(store.stock.tools, 4);
  assert.equal(e.jobs.length, 0);
  checkReservations(e);
});

test('seeded maps fund victory and every upgrade from reachable meadow mining faces', () => {
  for (const seed of [1, 7, 27, 42, 2024, 65535, 999999]) {
    const e = engine(seed);
    e.genMap();
    const copy = engine(seed);
    copy.genMap();
    assert.equal(JSON.stringify(e.tiles), JSON.stringify(copy.tiles), `reproducible map ${seed}`);
    const reachable = new Set([e.idx(e.W >> 1, e.H >> 1)]),
      queue = [...reachable];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const i = queue[cursor],
        x = i % e.W,
        y = Math.floor(i / e.W);
      for (let d = 0; d < 4; d++) {
        const nx = x + e.DX[d],
          ny = y + e.DY[d];
        if (!e.inB(nx, ny)) continue;
        const next = e.idx(nx, ny);
        if (e.passI(next) && !reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    let gold = 0,
      deposits = 0;
    for (let i = 0; i < e.tiles.length; i++) {
      const t = e.tiles[i];
      if (!t.deposit || t.deposit.kind !== 'gold') continue;
      const x = i % e.W,
        y = Math.floor(i / e.W);
      if (
        e.DX.some((dx, d) => {
          const nx = x + dx,
            ny = y + e.DY[d];
          return (
            e.inB(nx, ny) && e.tiles[e.idx(nx, ny)].t === e.GRASS && reachable.has(e.idx(nx, ny))
          );
        })
      ) {
        gold += t.deposit.amt;
        deposits++;
      }
    }
    assert.ok(
      gold >= e.GOAL + 180 + 60,
      `gold for victory, upgrades and margin (seed ${seed}): ${gold}`,
    );
    assert.ok(deposits >= 3, `deposits for seed ${seed}: ${deposits}`);
  }
});
