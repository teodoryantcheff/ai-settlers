'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./helpers/game.cjs');
function setup() {
  const { game, internals } = createGame({ seed: 7, headless: true });
  game.genMap();
  const hq = game.newBuilding('hq', game.W >> 1, game.H >> 1);
  hq.done = true;
  hq.stock = { planks: 20, stone: 20, tools: 0, bread: 4, fish: 4, meat: 4 };
  game.buildings.push(hq);
  game.recomputeTerritory();
  function building(type, dx = 2) {
    const b = game.newBuilding(type, hq.x + dx, hq.y);
    b.done = true;
    b.timer = 0;
    game.buildings.push(b);
    return b;
  }
  return { game, hooks: internals.economy, hq, building };
}
test('mines reserve distinct meals from warehouse without relabeling cargo', () => {
  const { game, hooks, hq, building } = setup();
  const mine = building('mine_iron');
  hooks.ensureJobs();
  const meals = game.jobs.filter((j) => j.kind === 'fetch' && j.to === mine.id);
  assert.deepEqual(
    meals.map((j) => j.good),
    ['bread', 'bread', 'bread', 'meat', 'meat', 'meat', 'fish', 'fish', 'fish'],
  );
  assert.equal(hq.reservedStock.bread, 3);
  assert.equal(hq.reservedStock.fish, 3);
  assert.equal(hq.stock.food, undefined);
  hooks.cancelJobs((j) => j.to === mine.id);
  assert.equal(hq.reservedStock.bread, 0);
  assert.equal(hq.reservedStock.fish, 0);
});
test('bakery needs a local working well and consumes flour only after service returns', () => {
  const { hooks, building } = setup();
  const bakery = building('bakery');
  bakery.stock.flour = 2;
  hooks.bTick(bakery, 1);
  assert.equal(bakery.blockedReason, 'water');
  assert.equal(bakery.stock.flour, 2);
  const well = building('well', 4);
  hooks.bTick(bakery, 1);
  assert.equal(bakery.stock.bread, 1);
  assert.equal(bakery.stock.flour, 1);
  well.disabled = true;
  hooks.bTick(bakery, 20);
  assert.equal(bakery.stock.bread, 1);
  assert.equal(bakery.blockedReason, 'water');
});
test('metal tools require smelted bars; basic workshop recovers without starting tools', () => {
  const { game, hooks, building } = setup();
  const smelter = building('smelter');
  smelter.stock = { iron: 1, coal: 1 };
  hooks.bTick(smelter, 1);
  assert.equal(smelter.stock.iron_bars, 1);
  assert.equal(smelter.metrics.consumed.iron, 1);
  const toolsmith = building('toolsmith', 4);
  toolsmith.stock = { iron: 1, planks: 1 };
  hooks.bTick(toolsmith, 1);
  assert.equal(toolsmith.blockedReason, 'inputs');
  toolsmith.stock.iron_bars = 1;
  hooks.bTick(toolsmith, 1);
  assert.equal(toolsmith.stock.tools, 1);
  const workshop = building('workshop', 6);
  assert.equal(game.BSPEC.workshop.cost.tools, undefined);
  workshop.stock = { planks: 2, stone: 1 };
  hooks.bTick(workshop, 1);
  assert.equal(workshop.stock.tools, 1);
  assert.ok(game.BSPEC.workshop.time > game.BSPEC.toolsmith.time);
});
test('grain and prepared food remain separate goods', () => {
  const { game, hooks, building } = setup();
  const farm = building('farm');
  hooks.bTick(farm, 1);
  assert.equal(farm.stock.grain, 1);
  assert.equal(farm.stock.food, undefined);
  const mill = building('windmill', 4);
  mill.stock.grain = 1;
  hooks.bTick(mill, 1);
  assert.equal(mill.stock.flour, 1);
  assert.equal(game.GOODS.iron.name, 'Iron ore');
});

test('expanded goods and completed contracts survive validated saves', () => {
  const { createEngine } = require('../src/simulation/engine.ts');
  const { createPersistence } = require('../src/core/persistence.ts');
  const { fakeStorage } = require('./helpers/game.cjs');
  const game = createEngine({ seed: 7, storage: fakeStorage().localStorage });
  game.initializeColony();
  const hooks = {};
  createPersistence(game, hooks);
  game.state.contracts = [0, 3, 4, 5];
  game.buildings[0].stock.beer = 7;
  const data = hooks.snapshotGame();
  const prepared = hooks.prepareLoad(JSON.stringify(data));
  assert.deepEqual(prepared.data.st.contracts, [0, 3, 4, 5]);
  assert.equal(prepared.buildings[0].stock.beer, 7);
});

test('food variety accelerates mines while consuming one real meal', () => {
  const { game, hooks, building } = setup();
  const mine = building('mine_iron');
  const tile = game.tiles[game.idx(mine.x + 1, mine.y)];
  tile.t = game.MTN;
  tile.deposit = { kind: 'iron', amt: 10, amt0: 10 };
  mine.stock = { fish: 1, bread: 1, meat: 1 };
  mine.timer = 1.05;
  hooks.bTick(mine, 1);
  assert.equal(mine.stock.iron, 1);
  assert.equal(mine.stock.bread, 0);
  assert.equal(mine.stock.fish, 1);
  assert.equal(mine.metrics.consumed.bread, 1);
  assert.equal(mine.metrics.consumed.food, undefined);
  mine.timer = 0;
  hooks.bTick(mine, 1);
  assert.equal(mine.metrics.consumed.meat, 1);
  mine.timer = 0;
  hooks.bTick(mine, 1);
  assert.equal(mine.metrics.consumed.fish, 1);
  assert.equal(mine.stock.iron, 3);
});
test('prepared meals respect individual pantry targets and beer keeps a modest reserve', () => {
  const { game, hooks, hq, building } = setup();
  const butcher = building('butcher');
  butcher.stock.pigs = 2;
  hq.stock.meat = 6;
  hooks.bTick(butcher, 1);
  assert.equal(butcher.blockedReason, 'demand');
  hq.targets.meat = 10;
  hooks.bTick(butcher, 1);
  assert.equal(butcher.stock.meat, 1);
  const brewery = building('brewery', 4);
  building('well', 6);
  brewery.stock.grain = 2;
  hq.stock.beer = 12;
  hooks.bTick(brewery, 1);
  assert.equal(brewery.blockedReason, 'demand');
  assert.equal(brewery.stock.grain, 2);
  hq.targets.beer = 15;
  hooks.bTick(brewery, 1);
  assert.equal(brewery.stock.beer, 1);
});

test('well service radius does not claim territory', () => {
  const { game, building } = setup();
  const before = Array.from(game.owned);
  building('well', 9);
  game.recomputeTerritory();
  assert.deepEqual(Array.from(game.owned), before);
});

test('intermediate reserves pause production, resume after consumption and respect raised targets', () => {
  for (const [type, good, cap, inputs] of [
    ['farm', 'grain', 24, {}],
    ['windmill', 'flour', 12, { grain: 2 }],
    ['pigfarm', 'pigs', 12, { grain: 2 }],
    ['smelter', 'iron_bars', 12, { iron: 2, coal: 2 }],
  ]) {
    const { game, hooks, hq, building } = setup();
    const producer = building(type);
    producer.stock = { ...inputs };
    hq.stock[good] = cap;
    hooks.bTick(producer, 1);
    assert.equal(producer.blockedReason, 'demand', good);
    assert.equal(producer.stock[good], undefined, good);
    assert.ok(
      game.buildingStatus(producer).lines.some((line) => line.t.includes('reserves are plentiful')),
      good,
    );
    hq.stock[good]--;
    hooks.bTick(producer, 1);
    assert.equal(producer.stock[good], 1, good);
    hq.stock[good] = cap;
    producer.timer = 0;
    hooks.bTick(producer, 1);
    assert.equal(producer.stock[good], 1, good);
    hq.targets[good] = cap + 4;
    hooks.bTick(producer, 1);
    assert.equal(producer.stock[good], 2, good);
  }
});

test('mine consumption preserves greatest-stock choice, every tie and empty-food status', () => {
  for (const [stock, expected] of [
    [{ bread: 1, meat: 2, fish: 3, food: 4 }, 'food'],
    [{ bread: 1, meat: 2, fish: 3, food: 1 }, 'fish'],
    [{ bread: 1, meat: 2, fish: 2, food: 2 }, 'meat'],
    [{ bread: 2, meat: 2, fish: 2, food: 2 }, 'bread'],
    [{ food: 1 }, 'food'],
  ]) {
    const { game, hooks, building } = setup();
    const mine = building('mine_iron');
    const tile = game.tiles[game.idx(mine.x + 1, mine.y)];
    tile.t = game.MTN;
    tile.deposit = { kind: 'iron', amt: 10, amt0: 10 };
    mine.stock = { ...stock };
    const before = structuredClone(mine);
    const rng = game.SR.getState();
    game.buildingStatus(mine);
    game.advisorDecision();
    assert.deepEqual(mine, before, 'recipe queries cannot change production');
    assert.equal(game.SR.getState(), rng);
    hooks.bTick(mine, 1);
    assert.deepEqual(mine.metrics.consumed, { [expected]: 1 });
    assert.equal(mine.stock[expected], stock[expected] - 1);
    assert.equal(mine.stock.iron, 1);
    mine.stock = {};
    mine.timer = 0;
    assert.match(
      game
        .buildingStatus(mine)
        .lines.map((line) => line.t)
        .join(' '),
      /provisions/i,
    );
    hooks.bTick(mine, 1);
    assert.equal(mine.blockedReason, 'inputs');
    assert.deepEqual(mine.metrics.consumed, { [expected]: 1 });
  }
});

test('a mine records an eligible meal arrival even when another meal is more plentiful', () => {
  const { game, hooks, hq, building } = setup();
  hq.stock = { fish: 1 };
  const mine = building('mine_iron');
  mine.stock = { bread: 9 };
  mine.timer = 1000;
  game.spawnCarrier(hq);
  hooks.ensureJobs();
  assert.deepEqual(
    game.jobs.filter((j) => j.to === mine.id).map((j) => j.good),
    ['fish'],
  );
  for (let tick = 0; tick < 30 * 60 && !mine.metrics.inputDelivered.fish; tick++) game.step(1 / 60);
  assert.equal(mine.stock.fish, 1);
  assert.equal(mine.metrics.inputDelivered.fish, 1);
  assert.equal(mine.stock.bread, 9);
  assert.deepEqual(mine.metrics.consumed, {});
});

test('saved fetch cargo must match the destination recipe', () => {
  const { DEFAULT_MODULES, fakeStorage } = require('./helpers/game.cjs');
  for (const [type, accepted] of [
    ['armory', ['iron_bars', 'coal']],
    ['toolsmith', ['planks', 'iron_bars']],
  ]) {
    const { game, internals } = createGame({
      seed: 7,
      headless: true,
      modules: [...DEFAULT_MODULES, 'persistence'],
      storage: fakeStorage().localStorage,
    });
    game.initializeColony();
    const hq = game.buildings[0];
    const producer = game.newBuilding(type, hq.x + 3, hq.y);
    producer.done = true;
    game.tiles[game.idx(producer.x, producer.y)].t = game.GRASS;
    game.buildings.push(producer);
    const base = internals.persistence.snapshotGame();
    for (const good of ['iron', 'iron_bars', 'coal', 'planks', 'stone', 'grain']) {
      const data = structuredClone(base);
      data.b[0].stock[good] = 1;
      data.b[0].reservedStock[good] = 1;
      data.j = [{ kind: 'fetch', good, to: producer.id, sourceId: hq.id, status: 'pending' }];
      const raw = JSON.stringify(data);
      if (accepted.includes(good)) {
        const prepared = internals.persistence.prepareLoad(raw);
        assert.equal(prepared.jobs[0].good, good);
        assert.equal(prepared.buildings[0].reservedStock[good], 1);
      } else {
        const buildings = game.buildings;
        assert.throws(() => game.importSave(raw), /Invalid fetch destination/);
        assert.equal(game.buildings, buildings, 'rejected cargo cannot replace live state');
      }
    }
  }
});
