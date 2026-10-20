'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, pinClock } = require('./helpers/game.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

/** A paused, all-grass owned colony with headquarters at 48,48. */
function colony() {
  const { game } = createGame({ seed: 2024, headless: true });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  game.owned.fill(1);
  const hq = game.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.constructionProgress = 1;
  game.buildings.push(hq);
  game.state.paused = true;
  game.state.upgrades = { haul: 0, production: 0 };
  return game;
}

const site = { x: 52, y: 48 };
const edit = (game, i, change) => {
  Object.assign(game.tiles[i], change);
  game.emitGameEvent('tileChanged', { index: i });
};

test('placement estimates refresh for paused haul upgrades and terrain edits', () => {
  const game = colony();
  const initial = game.previewPlacement('sawmill', site);
  game.state.upgrades.haul = 1;
  const upgraded = game.previewPlacement('sawmill', site);
  assert.ok(upgraded.haulSeconds < initial.haulSeconds);
  for (let x = 49; x <= 52; x++) edit(game, game.idx(x, 48), { road: true });
  const paved = game.previewPlacement('sawmill', site);
  assert.ok(paved.haulSeconds < upgraded.haulSeconds);
  assert.equal(game.state.time, 0);
});

test('placement estimates use a newly completed nearer warehouse without adding a building', () => {
  const game = colony();
  const store = game.newBuilding('warehouse', 51, 48);
  game.buildings.push(store);
  const initial = game.previewPlacement('sawmill', site);
  store.done = true;
  const completed = game.previewPlacement('sawmill', site);
  assert.equal(completed.storage.id, store.id);
  assert.ok(completed.haulSeconds < initial.haulSeconds);
});

test('a paused resource preview drops trees cleared for another construction site', () => {
  const game = colony();
  const tree = game.idx(54, 48);
  game.tiles[tree].tree = 4;
  assert.equal(game.previewPlacement('lumberjack', site).resources.includes(tree), true);
  edit(game, tree, { tree: 0 });
  assert.equal(game.previewPlacement('lumberjack', site).resources.includes(tree), false);
});

test('a paused placement preview refreshes affordability immediately while unchanged frames reuse it', () => {
  const game = colony();
  game.anyStorage().stock = { planks: 3, stone: 1, tools: 1 };
  const before = game.previewPlacement('sawmill', site);
  assert.equal(before.canBuild, true);
  assert.equal(game.previewPlacement('sawmill', site), before);
  game.anyStorage().stock.planks = 2;
  const after = game.previewPlacement('sawmill', site);
  assert.equal(after.checks.ok, true, 'the terrain remains suitable');
  assert.equal(after.canBuild, false, 'spending becomes unavailable without aging simulation time');
  assert.equal(after.spending.materials.find((row) => row.good === 'planks').available, 2);
});

test('road estimates update immediately when tiles are paved', () => {
  const game = colony();
  const anchor = { x: 50, y: 50 },
    end = { x: 54, y: 50 };
  const before = game.previewRoad(anchor, end);
  assert.equal(before.count, 5);
  assert.equal(game.previewRoad(anchor, end), before, 'unchanged frames reuse the cached preview');
  for (const i of [game.idx(50, 50), ...before.path]) edit(game, i, { road: true });
  const after = game.previewRoad(anchor, end);
  assert.equal(after.count, 0);
  assert.ok(after.beforeSeconds < before.beforeSeconds);
});

test('road previews display rejection labels without a route or travel estimates', () => {
  const game = colony();
  const end = { x: 54, y: 50 };
  const blocked = game.previewRoad({ x: 48, y: 48 }, end); // Headquarters blocks the start.
  assert.match(blocked.summary, /start on clear ground inside your territory/);
  edit(game, game.idx(end.x, end.y), { t: game.WATER });
  const unreachable = game.previewRoad({ x: 48, y: 48 }, end);
  assert.equal(unreachable.summary, 'No route here');
  for (const preview of [blocked, unreachable]) {
    assert.equal(preview.path, null);
    assert.equal(preview.count, 0);
    assert.deepEqual(preview.paved, {});
    assert.equal(preview.beforeSeconds, 0);
    assert.equal(preview.afterSeconds, 0);
  }
});

test('previews are read-only: no RNG draws, saves or simulation time change', () => {
  const game = colony();
  game.tiles[game.idx(54, 48)].tree = 4;
  const save = game.exportSave(),
    rng = game.SR.getState();
  for (const type of ['lumberjack', 'forester', 'quarry', 'fisherman', 'mine_coal', 'bakery'])
    game.previewPlacement(type, site);
  game.previewRoad({ x: 50, y: 50 }, { x: 56, y: 52 });
  assert.equal(game.exportSave(), save);
  assert.equal(game.SR.getState(), rng);
});
