'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./helpers/game.cjs');
const { projectTerritory } = require('../src/gameplay/colony-rules.ts');

function place(game, type, x, y, manned = false, done = true) {
  const building = game.newBuilding(type, x, y);
  Object.assign(building, { manned, done, constructionProgress: done ? 1 : 0 });
  game.buildings.push(building);
  return building;
}

test('hypothetical guard claims can be added, removed or unmanned without changing the colony', () => {
  const { game } = createGame({ seed: 42, headless: true });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  const guard = place(game, 'guard', 20, 20, true);
  place(game, 'well', 60, 60);
  place(game, 'guard', 70, 70, true, false);
  game.recomputeTerritory();
  const before = {
    buildings: JSON.stringify(game.buildings),
    owned: game.owned.slice(),
    rng: game.SR.getState(),
  };
  const buildings = game.buildings.map((building) =>
    building === guard ? { ...building, manned: false } : building,
  );
  const projection = projectTerritory(game, [
    ...buildings,
    { type: 'guard', x: 40, y: 40, done: true, manned: true },
  ]);
  assert.equal(projection[game.idx(23, 20)], 1, 'an unmanned guard claims three steps');
  assert.equal(projection[game.idx(24, 20)], 0, 'unmanned claims stop after three steps');
  assert.equal(
    projection[game.idx(47, 40)],
    1,
    'a hypothetical manned guard claims its full radius',
  );
  assert.equal(projection[game.idx(48, 40)], 0, 'the manned radius is inclusive');
  assert.equal(projection[game.idx(60, 60)], 0, 'wells provide service without claiming land');
  assert.equal(projection[game.idx(70, 70)], 0, 'unfinished guards claim no land');
  const removed = projectTerritory(
    game,
    game.buildings.filter((building) => building !== guard),
  );
  assert.equal(removed[game.idx(20, 20)], 0, 'removing the only completed guard removes its claim');
  assert.deepEqual(
    {
      buildings: JSON.stringify(game.buildings),
      owned: game.owned.slice(),
      rng: game.SR.getState(),
    },
    before,
  );
});

test('the guard preview matches completed manned placement around water and ridges', () => {
  const { game } = createGame({ seed: 42, headless: true });
  game.initializeColony();
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  place(game, 'guard', 58, 48, true);
  for (let y = 45; y <= 51; y++) game.tiles[game.idx(65, y)].t = y % 2 ? game.WATER : game.MTN;
  game.recomputeTerritory();
  const before = game.owned.slice();
  const rng = game.SR.getState();
  const claim = game.guardPostClaim(63, 48);
  const preview = claim.owned;
  const newlyClaimed = claim.fill;
  assert.ok(newlyClaimed.length > 0);
  assert.equal(preview[game.idx(63, 55)], 1, 'the full radius reaches open ground');
  assert.equal(preview[game.idx(66, 48)], 0, 'nearby land beyond the barrier needs a longer route');
  assert.deepEqual(game.owned, before, 'preview leaves the live border alone');
  assert.equal(game.SR.getState(), rng, 'preview consumes no simulation RNG');
  assert.equal(game.placeBuilding('guard', 63, 48), true);
  const guard = game.buildings.at(-1);
  Object.assign(guard, { done: true, constructionProgress: 1, manned: true });
  game.recomputeTerritory();
  assert.deepEqual(game.owned, preview);
  assert.deepEqual(
    newlyClaimed,
    Array.from(game.owned.keys()).filter((i) => game.owned[i] && !before[i]),
  );
});
