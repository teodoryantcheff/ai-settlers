const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeStorage, pinClock } = require('./helpers/game.cjs');

pinClock(0);

function colony() {
  const { localStorage } = fakeStorage();
  return createGame({ seed: 2024, headless: true, storage: localStorage });
}

function flatWorld(game) {
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
}

test('empty economy lookups stay nullable and caches follow a loaded world with the same ids', () => {
  const { game } = colony();
  assert.equal(game.byId(1), null);
  assert.equal(game.byId(undefined), null);
  assert.equal(game.byId(null), null);
  assert.equal(game.buildingAt(48, 48), null);
  assert.deepEqual(game.storages(), []);
  assert.equal(game.anyStorage(), null);
  assert.equal(game.nearestStoragePos(48, 48), null);
  assert.equal(game.totalGood('logs'), 0);
  assert.equal(game.availGood('logs'), 0);

  game.initializeColony();
  const original = game.anyStorage();
  assert.equal(game.byId(original.id), original);
  assert.equal(game.buildingAt(original.x, original.y), original);
  const cached = game.storages();
  assert.equal(game.storages(), cached, 'unchanged queries reuse the storage cache');
  const exported = game.exportSave();
  game.importSave(exported);
  const loaded = game.anyStorage();
  assert.notEqual(loaded, original);
  assert.notEqual(game.storages(), cached);
  assert.equal(game.byId(original.id), loaded);
  assert.equal(game.nearestStoragePos(loaded.x, loaded.y), loaded);
  assert.equal(game.exportSave(), exported, 'lookup refresh does not change the loaded world');
});

test('empty resource searches retry and recover when a tree or rock becomes available', () => {
  for (const [type, good, retry] of [
    ['lumberjack', 'logs', 3],
    ['quarry', 'stone', 4],
  ]) {
    const { game, internals } = colony();
    flatWorld(game);
    const producer = game.newBuilding(type, 0, 0);
    producer.done = true;
    producer.timer = 0;
    game.buildings.push(producer);
    const rng = game.SR.getState();
    internals.economy.bTick(producer, 0.25);
    assert.equal(producer.blockedReason, 'resources');
    assert.equal(producer.timer, retry);
    assert.equal(producer.stock[good], undefined);
    const tile = game.tiles[0];
    if (type === 'lumberjack') tile.tree = 3;
    else tile.rock = { amt: 1 };
    internals.economy.bTick(producer, retry);
    assert.equal(producer.stock[good], type === 'lumberjack' ? 2 : 1);
    assert.equal(producer.blockedReason, '');
    assert.equal(tile.tree, 0);
    assert.equal(tile.rock, null);
    assert.equal(game.SR.getState(), rng, 'resource search does not consume simulation RNG');
  }
});

test('a cargo job with no good cannot reserve stock or start a carrier pickup', () => {
  for (const kind of ['fetch', 'transfer', 'deliver']) {
    const { game, internals } = colony();
    game.initializeColony();
    const store = game.anyStorage();
    const unit = game.units[0];
    const job = { kind, sourceId: store.id, to: store.id, status: 'pending' };
    const before = game.exportSave();
    game.jobs.push(job);
    internals.economy.startJob(unit, job);
    assert.equal(job.status, 'pending');
    assert.equal(unit.job, null);
    assert.equal(unit.path, null);
    assert.deepEqual(store.reservedStock, {});
    // Recover malformed untyped input even though typed cargo jobs require a good.
    Object.assign(unit, { job, phase: 'p', path: [] });
    job.status = 'assigned';
    internals.economy.stepUnit(unit, 0.25);
    assert.equal(unit.job, null);
    assert.equal(unit.carry, null);
    assert.equal(unit.phase, 'idle');
    assert.equal(game.jobs.length, 0);
    assert.deepEqual(store.reservedStock, {});
    assert.equal(game.exportSave(), before);
  }
});

test('producer arrivals record goods in their delivery counters', () => {
  for (const field of ['inputDelivered', 'outputDelivered']) {
    const { game, internals } = colony();
    flatWorld(game);
    const store = game.newBuilding('hq', 5, 5);
    const producer = game.newBuilding('sawmill', 7, 5);
    store.done = producer.done = true;
    game.buildings.push(store, producer);
    const input = field === 'inputDelivered';
    const good = input ? 'logs' : 'planks';
    const source = input ? store : producer;
    source.stock[good] = 1;
    if (input) store.reservedStock.logs = 1;
    const job = input
      ? { kind: 'fetch', good, sourceId: store.id, to: producer.id, status: 'pending' }
      : { kind: 'deliver', good, sourceId: producer.id, status: 'pending' };
    game.jobs.push(job);
    game.spawnCarrier(store);
    const unit = game.units[0];
    const rng = game.SR.getState();
    internals.economy.startJob(unit, job);
    internals.economy.stepUnit(unit, 10);
    assert.equal(producer.metrics[field][good], 1);
    assert.equal((input ? producer : store).stock[good], 1);
    assert.equal(source.stock[good], 0);
    assert.equal(unit.carry, null);
    assert.equal(unit.job, null);
    assert.equal(game.jobs.length, 0);
    assert.equal(game.SR.getState(), rng);
  }
});
