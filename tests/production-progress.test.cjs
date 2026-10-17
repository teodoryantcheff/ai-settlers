const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, DEFAULT_MODULES, pinClock } = require('./helpers/game.cjs');
pinClock(0);
function colony(type = 'lumberjack') {
  const { game, internals } = createGame({ seed: 2024, modules: DEFAULT_MODULES });
  game.initializeColony();
  const b = game.newBuilding(type, 51, 48);
  Object.assign(b, { done: true, constructionProgress: 1, timer: 3, stock: {} });
  game.buildings.push(b);
  game.tiles[game.idx(52, 48)].tree = 4;
  return { game, b, hooks: internals.economy };
}
test('producer evidence revalidates output batch space and preserves the real cycle until collection', () => {
  const { game: g, b, hooks } = colony();
  b.stock.logs = 7;
  const rng = g.SR.getState();
  const before = g.exportSave();
  const oldStatus = g.buildingStatus(b);
  const p = g.productionProgress(b);
  assert.equal(p.reason, 'output');
  assert.match(p.explanation, /2.*logs.*7.*8/i);
  assert.equal(p.remaining, 3);
  assert.equal(p.duration, 7);
  assert.equal(p.remainingWork, 3);
  assert.equal(b.timer, 3);
  assert.equal(g.SR.getState(), rng);
  assert.equal(g.exportSave(), before, 'evidence projection does not mutate colony state');
  assert.deepEqual(g.buildingStatus(b), oldStatus, 'advisor status policy stays unchanged');
  hooks.bTick(b, 0.25);
  assert.equal(b.timer, 3);
  b.stock.logs = 6;
  assert.equal(g.productionProgress(b).reason, '', 'no stale output blockage after collection');
  hooks.bTick(b, 1);
  assert.equal(g.productionProgress(b).remaining, 2);
  b.disabled = true;
  hooks.bTick(b, 1);
  assert.equal(g.productionProgress(b).reason, 'paused');
  assert.equal(b.timer, 2);
  b.disabled = false;
  hooks.bTick(b, 2);
  assert.equal(b.stock.logs, 8);
  assert.equal(b.timer, 7);
  assert.equal(g.productionProgress(b).remainingWork, 7);
});

test('countdown uses actual upgraded mine work speed and preserves recipe, water and retry constraints', () => {
  const { game: g, b, hooks } = colony('mine_gold');
  b.stock = { bread: 1, meat: 1, fish: 1 };
  b.timer = 8;
  g.state.upgrades.production = 2;
  const deposit = g.tiles[g.idx(52, 48)];
  Object.assign(deposit, { t: g.MTN, deposit: { kind: g.BSPEC.mine_gold.resKind, amt: 4 } });
  const p = g.productionProgress(b);
  assert.equal(p.variety, 0.1);
  assert.equal(p.duration, (16 * 0.81) / 1.1);
  assert.equal(p.remaining, (8 * 0.81) / 1.1);
  hooks.bTick(b, p.remaining - 0.01);
  assert.equal(b.stock.gold || 0, 0);
  hooks.bTick(b, 0.02);
  assert.equal(b.stock.gold, 1);
  assert.equal(b.stock.bread, 0, 'existing meal ordering remains intact');
  assert.equal(deposit.deposit.amt, 3);
  b.stock = {};
  assert.equal(g.productionProgress(b).reason, 'inputs');
  assert.equal(g.buildingWorking(b), false);
  const bakery = g.newBuilding('bakery', 54, 48);
  Object.assign(bakery, { done: true, timer: 2, stock: { flour: 2 } });
  g.buildings.push(bakery);
  assert.equal(g.productionProgress(bakery).reason, 'water');
  assert.equal(g.buildingWorking(bakery), false);
  const armory = g.newBuilding('armory', 55, 48);
  Object.assign(armory, { done: true, stock: { iron_bars: 1, coal: 1 } });
  assert.equal(g.productionProgress(armory).reason, '');
  assert.equal(g.buildingWorking(armory), true, 'recipes count their real ingredients');
  armory.stock = { iron: 1, coal: 1 };
  assert.equal(g.productionProgress(armory).reason, 'inputs');
  assert.equal(g.buildingWorking(armory), false);
  const quarry = g.newBuilding('quarry', 90, 90);
  Object.assign(quarry, { done: true, stock: {}, timer: 4, blockedReason: 'resources' });
  assert.equal(
    g.productionProgress(quarry).suspended,
    false,
    'resource retry is not a frozen timer',
  );
  assert.equal(g.productionProgress(quarry).remainingWork, 4);
});

test('producer countdowns use the building table base time for every production mode', () => {
  for (const [type, seconds] of [
    ['lumberjack', 7],
    ['forester', 7],
    ['quarry', 8],
    ['fisherman', 9],
    ['farm', 15],
  ]) {
    const { game, b, hooks } = colony(type);
    assert.equal(game.BSPEC[type].time, seconds, type + ' publishes its base cycle');
    game.BSPEC[type].time = 19;
    assert.equal(game.productionProgress(b).duration, 19, type + ' reports the table cycle');
    game.tiles[game.idx(52, 48)].rock = { amt: 10 };
    game.tiles[game.idx(51, 49)].t = game.WATER;
    b.timer = 1;
    hooks.bTick(b, 1);
    assert.equal(b.timer, 19, type + ' schedules its next cycle from the table');
  }
});

test('the working query and status block the whole next output batch without changing state', () => {
  const { game, b, hooks } = colony();
  b.stock.logs = 7;
  const before = game.exportSave();
  const rng = game.SR.getState();
  assert.equal(game.buildingWorking(b), false, 'seven logs leave no room for a two-log batch');
  assert.ok(game.buildingStatus(b).lines.some((line) => /Output full/.test(line.t)));
  assert.equal(game.exportSave(), before);
  assert.equal(game.SR.getState(), rng);
  hooks.bTick(b, 1);
  assert.equal(b.timer, 3);
  b.stock.logs = 6;
  hooks.bTick(b, 0);
  assert.equal(game.buildingWorking(b), true, 'collection releases the whole batch');
});
