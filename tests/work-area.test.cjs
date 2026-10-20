'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./helpers/game.cjs');
const { workArea, workTiles, replantRadius } = require('../src/gameplay/work-area.ts');
const { ROAD_COST, carrierSpeed, walkSeconds } = require('../src/simulation/travel.ts');

function colony() {
  const { game, internals } = createGame({ seed: 42, headless: true });
  game.initializeColony();
  return { game, bTick: internals.economy.bTick, stepUnit: internals.economy.stepUnit };
}

function place(game, type, x, y) {
  const b = game.newBuilding(type, x, y);
  Object.assign(b, { done: true, constructionProgress: 1, manned: true, timer: 0 });
  game.buildings.push(b);
  return b;
}

function clearArea(game, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      Object.assign(game.tiles[game.idx(x, y)], {
        t: game.GRASS,
        tree: 0,
        rock: null,
        road: false,
        deposit: null,
      });
}

/** The tiles a producer's next attempt changed. */
function worked(game, bTick, b) {
  const before = game.tiles.map((tile) => JSON.stringify(tile));
  bTick(b, 0.01);
  return game.tiles.flatMap((tile, i) => (JSON.stringify(tile) === before[i] ? [] : [i]));
}

test('a mine works only the mountain deposits its build preview highlights', () => {
  const { game, bTick } = colony();
  const x = 60,
    y = 60;
  clearArea(game, x, y, 2);
  const coal = (dx, dy, t, kind = 'coal') =>
    Object.assign(game.tiles[game.idx(x + dx, y + dy)], { t, deposit: { kind, amt: 5 } });
  coal(0, 0, game.MTN); // under the building
  coal(1, 0, game.GRASS); // not mountain
  coal(-1, 0, game.MTN, 'iron'); // another deposit kind
  coal(1, 1, game.MTN);
  const reach = workTiles(game, 'mine_coal', { x, y });
  assert.deepEqual(reach, [game.idx(x + 1, y + 1)]);
  const mine = place(game, 'mine_coal', x, y);
  mine.stock.bread = 1;
  assert.deepEqual(worked(game, bTick, mine), reach);
  assert.equal(game.tiles[reach[0]].deposit.amt, 4);
});

test('lumberjacks and quarries take the first tile of their highlighted reach', () => {
  const { game, bTick } = colony();
  for (const [type, x, setup] of [
    ['lumberjack', 60, (tile) => (tile.tree = 3)],
    ['quarry', 75, (tile) => (tile.rock = { amt: 1 })],
  ]) {
    const y = 60,
      r = game.BSPEC[type].rad;
    clearArea(game, x, y, r + 1);
    for (const [dx, dy] of [
      [r, r], // outside the disc
      [2, -3],
      [-1, 2],
    ])
      setup(game.tiles[game.idx(x + dx, y + dy)]);
    const reach = workTiles(game, type, { x, y });
    assert.deepEqual(reach, [game.idx(x + 2, y - 3), game.idx(x - 1, y + 2)], type);
    assert.deepEqual(worked(game, bTick, place(game, type, x, y)), [reach[0]], type);
  }
});

test('a fisherman fishes only with water in its highlighted reach', () => {
  const { game, bTick } = colony();
  const x = 60,
    y = 60;
  clearArea(game, x, y, 3);
  game.tiles[game.idx(x + 3, y)].t = game.WATER;
  assert.deepEqual(workTiles(game, 'fisherman', { x, y }), []);
  const fisher = place(game, 'fisherman', x, y);
  bTick(fisher, 0.01);
  assert.equal(fisher.blockedReason, 'resources');
  game.tiles[game.idx(x + 2, y - 2)].t = game.WATER;
  assert.deepEqual(workTiles(game, 'fisherman', { x, y }), [game.idx(x + 2, y - 2)]);
  fisher.timer = 0;
  bTick(fisher, 0.01);
  assert.notEqual(fisher.blockedReason, 'resources');
});

test('a forester plants inside the highlighted chop zone of its nearest lumberjack', () => {
  const { game, bTick } = colony();
  const lumberjack = place(game, 'lumberjack', 52, 52);
  const area = workArea(game, 'forester', { x: 55, y: 52 });
  assert.deepEqual(
    { x: area.x, y: area.y, r: area.r },
    { x: lumberjack.x, y: lumberjack.y, r: replantRadius },
  );
  const forester = place(game, 'forester', 55, 52);
  const reach = new Set(workTiles(game, 'forester', forester));
  const rng = game.SR.getState(),
    highlighted = reach.size;
  for (let attempt = 0; attempt < 40; attempt++) {
    forester.timer = 0;
    for (const i of worked(game, bTick, forester)) {
      assert.ok(reach.has(i), 'planted tile ' + i + ' was highlighted');
      reach.delete(i);
    }
  }
  assert.ok(reach.size < highlighted, 'the forester planted');
  assert.notEqual(game.SR.getState(), rng, 'planting still draws from the simulation RNG');
});

test('walk estimates match a carrier walking the route, upgraded and on planned pavement', () => {
  const { game, stepUnit } = colony();
  const from = { x: 50, y: 50 },
    to = { x: 58, y: 53 };
  clearArea(game, 54, 52, 5);
  const path = game.findPath(from.x, from.y, to.x, to.y);
  const walk = (haul) => {
    game.state.upgrades.haul = haul;
    const u = { x: from.x + 0.5, y: from.y + 0.5, path: path.slice(), pi: 0, kind: 'serf' };
    let t = 0;
    while (u.path && u.pi < u.path.length) {
      stepUnit(u, 0.001);
      t += 0.001;
    }
    return t;
  };
  const paved = Object.fromEntries(path.slice(0, 5).map((i) => [i, true]));
  for (const haul of [0, 2]) {
    const estimate = walkSeconds(game, path, from.x, from.y, haul, paved);
    for (const i of Object.keys(paved)) game.tiles[i].road = true;
    assert.ok(Math.abs(walkSeconds(game, path, from.x, from.y, haul) - estimate) < 1e-9);
    assert.ok(Math.abs(walk(haul) - estimate) < 0.01, 'haul ' + haul);
    for (const i of Object.keys(paved)) game.tiles[i].road = false;
  }
  assert.equal(game.moveCost(path[0]), 1);
  game.tiles[path[0]].road = true;
  assert.equal(game.moveCost(path[0]), ROAD_COST);
  assert.equal(game.speedOn({ x: 0, y: 0 }, path[0]), carrierSpeed(ROAD_COST, 2));
});
