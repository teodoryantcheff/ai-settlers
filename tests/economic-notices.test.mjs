import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, pinClock } from './helpers/game.cjs';

function colony(t) {
  const clock = pinClock();
  t.after(() => clock.restore());
  const { game } = createGame({
    seed: 2024,
    modules: ['world', 'state', 'messages', 'economicNotices'],
  });
  game.state.paused = false;
  const mill = {
    id: 1,
    type: 'sawmill',
    x: 12,
    y: 8,
    done: true,
    produced: 0,
    stock: { logs: 4 },
    blockedReason: '',
  };
  game.buildings.push(mill);
  function observe(now) {
    clock.set(now);
    game.state.time = now / 1000;
    return game.updateEconomicFeedback(now);
  }
  observe(0);
  return { game, mill, observe };
}

test('economic notices deliver text and evidence without constructing audio', (t) => {
  const { game, mill, observe } = colony(t);
  assert.equal(game.SND, undefined);
  mill.produced = 1;
  const notice = observe(250);
  assert.equal(notice.kind, 'started');
  assert.equal(game.msgs.length, 1);
  assert.equal(game.msgs[0].t, '▶ Sawmill (12, 8): first planks produced');
  assert.deepEqual(game.msgs[0].context, {
    workspace: 'activity',
    entity: { id: 1, type: 'sawmill', x: 12, y: 8, name: 'Sawmill' },
  });
  observe(500);
  assert.equal(game.msgs.length, 1);
});

test('world replacement resets notices against live state before the next production step', (t) => {
  const clock = pinClock();
  t.after(() => clock.restore());
  const { game, internals } = createGame({
    seed: 2024,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'economicNotices'],
  });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    res: null,
    road: false,
  }));
  const hq = game.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.prog = 1;
  hq.stock = { logs: 100, planks: 48, stone: 48, tools: 16 };
  const mill = game.newBuilding('sawmill', 50, 48);
  mill.done = true;
  mill.prog = 1;
  mill.timer = 0;
  mill.stock.logs = 4;
  game.buildings.push(hq, mill);
  game.recomputeTerritory();
  game.spawnT = game.serfT = 1e6;
  game.state.paused = false;
  const checkpoint = game.exportSave();
  game.updateEconomicFeedback(0);
  game.step(0.25);
  clock.set(250);
  assert.equal(game.updateEconomicFeedback(250).kind, 'started');
  for (let attempt = 0; attempt < 2; attempt++) {
    const oldBuildings = game.buildings;
    internals.persistence.commitLoad(internals.persistence.prepareLoad(checkpoint));
    assert.notEqual(game.buildings, oldBuildings);
    assert.equal(game.msgs.length, 0, 'world replacement clears obsolete notice contexts');
    const before = game.exportSave();
    game.updateEconomicFeedback(clock.now());
    assert.equal(game.exportSave(), before, 'baselining does not change the saved colony');
    // A load has already established its quiet baseline; production during the
    // first following step remains a real transition, even before another frame.
    internals.persistence.commitLoad(internals.persistence.prepareLoad(checkpoint));
    game.step(0.25);
    clock.tick(250);
    const notice = game.updateEconomicFeedback(clock.now());
    assert.equal(notice?.kind, 'started');
    assert.equal(game.msgs.length, 1, 'repeated load does not reinstall or duplicate delivery');
  }
  const oldBuildings = game.buildings;
  game.resetColony(42, 'Fresh colony');
  game.state.paused = false;
  oldBuildings[1].produced++;
  game.step(0.25);
  clock.tick(250);
  assert.equal(game.updateEconomicFeedback(clock.now()), null);
  assert.equal(game.msgs.length, 0, 'old-colony production cannot emit into a fresh colony');
  const freshMill = game.newBuilding('sawmill', 50, 48);
  freshMill.done = true;
  freshMill.prog = 1;
  freshMill.timer = 0;
  freshMill.stock.logs = 4;
  game.buildings.push(freshMill);
  game.updateEconomicFeedback(clock.now());
  game.step(0.25);
  clock.tick(250);
  assert.equal(game.updateEconomicFeedback(clock.now())?.kind, 'started');
  assert.equal(game.msgs.length, 1);
});
