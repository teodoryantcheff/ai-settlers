'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pinClock } = require('./helpers/game.cjs');
const { autoplay, checkEconomy, snapshot } = require('./helpers/economy.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

test('gold warehouse transfers preserve the treasury and remain saveable in transit', () => {
  const e = autoplay(42);
  e.state.auto = false;
  const hq = e.storages()[0],
    warehouse = e.newBuilding('warehouse', hq.x + 5, hq.y);
  warehouse.done = true;
  warehouse.constructionProgress = 1;
  warehouse.targets.gold = 10;
  e.buildings.push(warehouse);
  e.recomputeTerritory();
  hq.stock.gold = 20;
  e.state.gold = 20;
  let checkedCargo = false;
  for (let i = 0; i < 30 * 60; i++) {
    e.step(1 / 60);
    if (i % 30 === 0) {
      checkEconomy(e);
      if (e.units.some((u) => u.carry === 'gold' && u.carryTransfer)) checkedCargo = true;
    }
  }
  assert.ok(checkedCargo, 'validate a checkpoint while previously banked gold is carried');
  assert.equal(warehouse.stock.gold, 10);
  assert.equal(e.state.gold, 20);
  assert.equal(e.state.goldDelivered, 0);
});

test('a manually built timber, food and mining chain delivers gold without autoplay', () => {
  const e = autoplay(777);
  e.state.auto = false;
  const chain = [
    'lumberjack',
    'sawmill',
    'forester',
    'quarry',
    'farm',
    'windmill',
    'well',
    'bakery',
    'workshop',
    'warehouse',
  ];
  let next = 0,
    nextAction = 0;
  // Model deliberate player choices: complete the basic chain, then extend one
  // manned outpost at a time toward a deposit. No advisor/autoplay actions run.
  for (let tick = 0; tick < 900 * 60 && !e.state.goldDelivered; tick++) {
    e.step(1 / 60);
    if (e.state.time < nextAction) continue;
    nextAction = e.state.time + 2;
    if (next < chain.length) {
      const type = chain[next];
      if (e.afford(type)) {
        const spot = e.findSpot(type, null);
        if (spot && e.placeBuilding(type, ...spot)) next++;
      }
      continue;
    }
    const mines = e.buildings.filter((b) => b.type === 'mine_gold' && !b.exhausted).length;
    if (mines < 2 && e.afford('mine_gold')) {
      const spot = e.findSpot('mine_gold', null);
      if (spot && e.placeBuilding('mine_gold', ...spot)) continue;
    }
    if (
      mines < 2 &&
      e.buildings.every((b) => b.type !== 'guard' || b.manned) &&
      e.afford('guard')
    ) {
      const spot = e.spotOnCorridor(e.buildCorridor(['gold']), ['gold']);
      if (spot) e.placeBuilding('guard', ...spot);
    }
  }
  checkEconomy(e);
  assert.equal(e.state.auto, false);
  assert.ok(e.producedTotal('bread') > 0, 'the manual chain produces prepared food');
  assert.ok(e.state.goldDelivered > 0, JSON.stringify(snapshot(e)));
  assert.ok(e.state.gold > 0);
  assert.ok(e.buildings.some((b) => b.type === 'guard' && b.manned));
});
