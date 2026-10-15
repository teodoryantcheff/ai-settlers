const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, DEFAULT_MODULES } = require('./helpers/game.cjs');

// Real navigation on a one-tile-wide land corridor makes the route unambiguous.
function colony() {
  const { game } = createGame({
    seed: 2024,
    headless: true,
    modules: [...DEFAULT_MODULES, 'persistence'],
  });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.WATER,
    tree: 0,
    rock: null,
    res: null,
    road: false,
  }));
  for (let x = 50; x <= 58; x++) game.tiles[game.idx(x, 50)].t = game.GRASS;
  game.owned.fill(1);
  return game;
}

function observe(game) {
  const events = [];
  for (const name of ['tileChanged', 'roadRejected', 'milestoneReached', 'roadBuilt'])
    game.gameEvents.on(name, (payload) => {
      events.push({ name, ...payload, roadsBuilt: game.state.roadsBuilt });
    });
  return events;
}

function snapshot(game) {
  return structuredClone({ save: game.snapshotGame(), owned: game.owned });
}

test('road planning is a repeatable query with no simulation, RNG or event effects', () => {
  const game = colony();
  const events = observe(game);
  const before = snapshot(game);
  const a = { x: 50, y: 50 };
  const b = { x: 54, y: 50 };
  const plan = game.planRoad(a, b);
  assert.equal(plan.ok, true);
  assert.equal(plan.count, 5);
  assert.deepEqual(
    plan.path,
    [51, 52, 53, 54].map((x) => game.idx(x, 50)),
  );
  for (let read = 0; read < 10; read++) assert.deepEqual(game.planRoad(a, b), plan);
  assert.deepEqual(snapshot(game), before);
  assert.deepEqual(events, []);
});

test('each blocked starting tile rejects both planning and construction without mutations', () => {
  for (const blocker of ['building', 'tree', 'rock', 'unowned']) {
    const game = colony();
    const start = game.idx(50, 50);
    if (blocker === 'building') game.buildings.push(game.newBuilding('farm', 50, 50));
    if (blocker === 'tree') game.tiles[start].tree = 4;
    if (blocker === 'rock') game.tiles[start].rock = { amt: 5 };
    if (blocker === 'unowned') game.owned[start] = 0;
    const events = observe(game);
    const before = snapshot(game);
    const a = { x: 50, y: 50 };
    const b = { x: 54, y: 50 };
    assert.deepEqual(game.planRoad(a, b), { ok: false, reason: 'blocked-start' }, blocker);
    assert.deepEqual(events, []);
    assert.equal(game.commitRoad(a, b), false, blocker);
    assert.deepEqual(snapshot(game), before, blocker);
    assert.deepEqual(events, [{ name: 'roadRejected', reason: 'blocked-start', roadsBuilt: 0 }]);
  }
});

test('an unreachable route takes precedence over a blocked start', () => {
  const game = colony();
  game.tiles[game.idx(50, 50)].tree = 4;
  game.tiles[game.idx(52, 50)].t = game.WATER;
  const events = observe(game);
  const before = snapshot(game);
  const a = { x: 50, y: 50 };
  const b = { x: 54, y: 50 };
  assert.deepEqual(game.planRoad(a, b), { ok: false, reason: 'no-route' });
  assert.deepEqual(events, []);
  assert.equal(game.commitRoad(a, b), false);
  assert.deepEqual(events, [{ name: 'roadRejected', reason: 'no-route', roadsBuilt: 0 }]);
  assert.deepEqual(snapshot(game), before);
});

test('mixed routes preserve skipped tiles, existing-road notifications and milestone order', () => {
  const game = colony();
  const idx = (x) => game.idx(x, 50);
  game.tiles[idx(51)].road = true;
  game.tiles[idx(52)].tree = 4;
  game.tiles[idx(53)].rock = { amt: 5 };
  game.buildings.push(game.newBuilding('farm', 54, 50));
  game.owned[idx(55)] = 0;
  game.tiles[idx(57)].road = true;
  game.tiles[idx(58)].tree = 4; // An occupied destination remains a valid endpoint.
  game.state.roadsBuilt = 3;
  const events = observe(game);
  const before = structuredClone(game.tiles);
  const a = { x: 50, y: 50 };
  const b = { x: 58, y: 50 };
  const plan = game.planRoad(a, b);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.path, [51, 52, 53, 54, 55, 56, 57, 58].map(idx));
  assert.deepEqual(plan.paved, { [idx(50)]: true, [idx(56)]: true });
  assert.equal(plan.count, 2);
  assert.equal(game.commitRoad(a, b), true);
  assert.deepEqual(
    game.tiles.flatMap((tile, i) => (!before[i].road && tile.road ? [i] : [])),
    [idx(50), idx(56)],
  );
  for (const x of [52, 53, 54, 55, 58]) assert.deepEqual(game.tiles[idx(x)], before[idx(x)]);
  assert.deepEqual(events, [
    ...[50, 50, 56, 57, 56].map((x) => ({
      name: 'tileChanged',
      index: idx(x),
      roadsBuilt: 3,
    })),
    {
      name: 'milestoneReached',
      index: 2,
      title: 'Connect your settlement',
      roadsBuilt: 5,
    },
    { name: 'roadBuilt', count: plan.count, roadsBuilt: 5 },
  ]);
});

test('same-tile roads succeed and already-paved roads still notify without checking milestones', () => {
  const game = colony();
  const point = { x: 50, y: 50 };
  const events = observe(game);
  assert.deepEqual(game.planRoad(point, point), {
    ok: true,
    path: [],
    paved: { [game.idx(50, 50)]: true },
    count: 1,
  });
  assert.equal(game.commitRoad(point, point), true);
  assert.equal(game.state.roadsBuilt, 1);
  assert.deepEqual(game.planRoad(point, point), { ok: true, path: [], paved: {}, count: 0 });
  events.length = 0;
  game.state.roadsBuilt = 5;
  assert.equal(game.commitRoad(point, point), true);
  assert.deepEqual(events, [
    { name: 'tileChanged', index: game.idx(50, 50), roadsBuilt: 5 },
    { name: 'roadBuilt', count: 0, roadsBuilt: 5 },
  ]);
  assert.deepEqual(game.state.milestones, []);
});

test('construction replans after world changes instead of applying an old preview', () => {
  const game = colony();
  const a = { x: 50, y: 50 };
  const b = { x: 54, y: 50 };
  const preview = game.planRoad(a, b);
  assert.equal(preview.count, 5);
  game.tiles[game.idx(52, 50)].tree = 4;
  assert.equal(game.commitRoad(a, b), true);
  assert.equal(game.state.roadsBuilt, 4);
  assert.equal(game.tiles[game.idx(52, 50)].road, false);
  game.buildings.push(game.newBuilding('farm', 50, 50));
  assert.equal(game.commitRoad(a, b), false);
  assert.equal(game.state.roadsBuilt, 4);
  assert.equal(preview.count, 5, 'a retained plan is a prediction of its original world');
});

test('road queries observe replaced live tile and building arrays', () => {
  const game = colony();
  const a = { x: 50, y: 50 };
  const b = { x: 54, y: 50 };
  assert.equal(game.planRoad(a, b).count, 5);
  const old = game.tiles;
  game.tiles = game.tiles.map((tile) => ({ ...tile, road: tile.t === game.GRASS }));
  assert.equal(game.planRoad(a, b).count, 0);
  assert.equal(old[game.idx(50, 50)].road, false);
  game.buildings = [game.newBuilding('farm', 50, 50)];
  assert.deepEqual(game.planRoad(a, b), { ok: false, reason: 'blocked-start' });
});
