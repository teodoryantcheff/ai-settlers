'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../src/simulation/assembly.ts');
const { installGlobals } = require('./helpers/game.cjs');

function step(game, ticks) {
  for (let tick = 0; tick < ticks; tick++) game.step(1 / 60);
}

test('shared colony assembly remains headless and delivers actual producer output', (t) => {
  t.after(
    installGlobals({
      document: undefined,
      window: undefined,
      localStorage: undefined,
      location: undefined,
      requestAnimationFrame: () => assert.fail('assembly must not start a frame loop'),
    }),
  );
  const game = createEngine({ seed: 2024 });
  assert.equal(game.buildings.length, 0, 'creation does not initialize a colony');
  game.initializeColony();
  assert.equal(game.buildings.length, 1);
  assert.equal(game.units.length, 8);
  assert.equal(game.state.time, 0);
  const arrivals = [];
  game.gameEvents.on('goodsDelivered', (event) => arrivals.push(event));
  const logger = game.newBuilding('lumberjack', 51, 48);
  logger.done = true;
  logger.constructionProgress = 1;
  game.buildings.push(logger);
  game.tiles[game.idx(52, 48)].tree = 4;
  step(game, 1800);
  assert.ok(logger.metrics.produced.logs > 0, 'lumberjack produces logs');
  assert.ok(logger.metrics.outputDelivered.logs > 0, 'carriers deliver logs to storage');
  assert.ok(game.anyStorage().stock.logs > 0);
  assert.ok(arrivals.length > 0, 'the shared synchronous bus receives domain events');
  assert.equal('snapshotGame' in game, false, 'production runtime carries no test hooks');
  assert.equal('SND' in game, false);
});

test('production saves continue exactly through the harness graph with live replacement state', () => {
  const { createGame, fakeStorage } = require('./helpers/game.cjs');
  const production = createEngine({ seed: 2024 });
  production.initializeColony();
  production.state.auto = true;
  step(production, 1073);
  const raw = production.exportSave();
  const { game, internals } = createGame({
    seed: 42,
    headless: true,
    storage: fakeStorage().localStorage,
  });
  game.initializeColony();
  const before = { buildings: game.buildings, units: game.units, jobs: game.jobs, rng: game.SR };
  internals.persistence.commitLoad(internals.persistence.prepareLoad(raw));
  assert.notEqual(game.buildings, before.buildings);
  assert.notEqual(game.units, before.units);
  assert.notEqual(game.jobs, before.jobs);
  assert.notEqual(game.SR, before.rng);
  assert.equal(game.anyStorage(), game.buildings[0]);
  step(production, 2400);
  step(game, 2400);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(production.exportSave()));
  assert.ok(game.buildings.length > 1, 'loaded autoplay continues colony construction');
  assert.ok(Object.keys(internals.economy).length > 0, 'harness retains its typed closure hooks');
});

test('new-colony reset replaces shared live bindings and keeps another colony independent', () => {
  const { createGame, fakeStorage } = require('./helpers/game.cjs');
  const { game } = createGame({ seed: 42, headless: true });
  game.initializeColony();
  game.state.auto = true;
  step(game, 600);
  const other = createEngine({ seed: 7, storage: fakeStorage().localStorage });
  other.initializeColony();
  const otherBefore = other.exportSave();
  const previous = {
    buildings: game.buildings,
    tiles: game.tiles,
    units: game.units,
    rng: game.SR,
  };
  let resets = 0;
  game.gameEvents.on('worldLoaded', ({ reason }) => {
    assert.equal(reason, 'new');
    assert.equal(game.anyStorage(), game.buildings[0]);
    assert.ok(game.owned[game.idx(48, 48)]);
    resets++;
  });
  const hq = game.resetColony(2024, 'New valley');
  assert.equal(resets, 1);
  assert.equal(game.buildings.length, 1);
  assert.equal(game.units.length, 8);
  assert.equal(game.state.time, 0);
  assert.equal(game.anyStorage(), hq);
  assert.notEqual(game.buildings, previous.buildings);
  assert.notEqual(game.tiles, previous.tiles);
  assert.notEqual(game.units, previous.units);
  assert.notEqual(game.SR, previous.rng);
  const fresh = createEngine({ seed: 2024 });
  fresh.initializeColony();
  fresh.setColonyName('New valley');
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(fresh.exportSave()));
  step(game, 1200);
  step(fresh, 1200);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(fresh.exportSave()));
  assert.equal(other.exportSave(), otherBefore, 'reset and stepping cannot alter another graph');
});
