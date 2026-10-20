import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';
function colony(seed) {
  const { game } = createGame({
    seed,
    headless: true,
    storage: { getItem: () => null, setItem() {} },
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
  });
  game.initializeColony();
  return game;
}
test('new colony resets the real graph to a reproducible fresh world with live bindings', () => {
  const game = colony(2024),
    expected = colony(42);
  const other = colony(7),
    otherBefore = other.exportSave();
  const state = game.state,
    oldBuildings = game.buildings,
    oldTiles = game.tiles,
    oldUnits = game.units,
    oldRng = game.SR;
  game.placeBuilding('farm', 51, 48);
  for (let i = 0; i < 60; i++) game.step(0.25);
  game.state.auto = true;
  game.autoT = 1;
  game.setColonyName('Old colony');
  game.resetColony(42);
  assert.equal(game.state, state);
  assert.notEqual(game.buildings, oldBuildings);
  assert.notEqual(game.tiles, oldTiles);
  assert.notEqual(game.units, oldUnits);
  assert.notEqual(game.SR, oldRng);
  assert.equal(game.byId(game.anyStorage().id), game.buildings[0]);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(expected.exportSave()));
  for (let i = 0; i < 120; i++) {
    game.step(1 / 60);
    expected.step(1 / 60);
  }
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(expected.exportSave()));
  assert.equal(other.exportSave(), otherBefore, 'reset and stepping cannot alter another graph');
  const before = game.exportSave();
  assert.throws(() => game.resetColony(NaN), /seed/i);
  assert.equal(game.exportSave(), before);
});

test('new colony identity is validated before replacing live state and visible at committed event', () => {
  const game = colony(2024);
  let nameAtReplacement, reasonAtReplacement;
  game.gameEvents.on('worldLoaded', ({ reason }) => {
    nameAtReplacement = game.colonyName;
    reasonAtReplacement = reason;
  });
  game.resetColony(42, 'Oakbridge');
  assert.equal(nameAtReplacement, 'Oakbridge');
  assert.equal(reasonAtReplacement, 'new');
  const before = game.exportSave();
  assert.throws(() => game.resetColony(123, 'x'.repeat(81)), /name/i);
  assert.equal(game.exportSave(), before);
});
