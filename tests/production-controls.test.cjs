'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeStorage, pinClock } = require('./helpers/game.cjs');
pinClock(0);

function colony() {
  const { game, internals } = createGame({
    seed: 2024,
    headless: true,
    storage: fakeStorage().localStorage,
  });
  game.initializeColony();
  const events = [];
  game.gameEvents.on('productionControlChanged', (event) => events.push(event.building));
  return { game, internals, events };
}

function warehouse(game) {
  const store = game.newBuilding('warehouse', 54, 48);
  Object.assign(store, { done: true, prog: 1 });
  game.buildings.push(store);
  return store;
}

test('building priority accepts the three levels and announces each change', () => {
  const { game, events } = colony();
  const site = game.newBuilding('sawmill', 51, 48);
  game.buildings.push(site);
  assert.equal(game.setBuildingPriority(site, 2), true);
  assert.equal(site.priority, 2);
  assert.equal(game.setBuildingPriority(site, 0), true);
  assert.equal(site.priority, 0);
  assert.deepEqual(events, [site, site]);
});

test('building priority rejects values outside the three levels', () => {
  const { game, events } = colony();
  const site = game.newBuilding('sawmill', 51, 48);
  game.buildings.push(site);
  game.setBuildingPriority(site, 1);
  events.length = 0;
  for (const value of [3, -1, 1.5, NaN, '2', null, undefined])
    assert.equal(game.setBuildingPriority(site, value), false, String(value));
  assert.equal(site.priority, 1);
  assert.deepEqual(events, []);
});

test('warehouse reserves are whole numbers from 0 to 500 and reject non-numbers', () => {
  const { game, events } = colony();
  const store = warehouse(game);
  assert.equal(game.setStockTarget(store, 'planks', 12), true);
  assert.equal(store.targets.planks, 12);
  assert.equal(game.setStockTarget(store, 'stone', 9000), true);
  assert.equal(store.targets.stone, 500);
  assert.equal(game.setStockTarget(store, 'stone', -4), true);
  assert.equal(store.targets.stone, 0);
  assert.equal(game.setStockTarget(store, 'logs', 7.9), true);
  assert.equal(store.targets.logs, 7);
  assert.deepEqual(events, [store, store, store, store]);
  events.length = 0;
  for (const value of [NaN, Infinity, '12', null, undefined])
    assert.equal(game.setStockTarget(store, 'planks', value), false, String(value));
  assert.equal(game.setStockTarget(store, 'wood', 5), false, 'unknown goods are rejected');
  const mill = game.newBuilding('sawmill', 51, 48);
  Object.assign(mill, { done: true, prog: 1 });
  game.buildings.push(mill);
  assert.equal(game.setStockTarget(mill, 'planks', 5), false, 'only stores hold reserves');
  assert.equal(store.targets.planks, 12);
  assert.deepEqual(mill.targets, {});
  assert.deepEqual(events, []);
});

test('reserves drive carrier planning and both controls survive save round-trips', () => {
  const { game, internals } = colony();
  const store = warehouse(game);
  const site = game.newBuilding('sawmill', 51, 48);
  game.buildings.push(site);
  game.setStockTarget(store, 'planks', 5);
  game.setBuildingPriority(site, 2);
  internals.economy.replenishTargets();
  assert.ok(
    game.jobs.some(
      (job) => job.kind === 'transfer' && job.to === store.id && job.good === 'planks',
    ),
    'a reserve requests a transfer into the warehouse',
  );
  const raw = game.exportSave();
  const { game: loaded } = colony();
  loaded.importSave(raw);
  assert.equal(loaded.byId(store.id).targets.planks, 5);
  assert.equal(loaded.byId(site.id).priority, 2);
  assert.equal(loaded.exportSave(), raw);
});
