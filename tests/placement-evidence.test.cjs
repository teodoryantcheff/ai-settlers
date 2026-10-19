const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, DEFAULT_MODULES, pinClock } = require('./helpers/game.cjs');
pinClock(0);

function colony() {
  const { game } = createGame({
    seed: 2024,
    modules: DEFAULT_MODULES,
    stubs: { SND: { place() {} } },
  });
  game.initializeColony();
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  game.owned.fill(1);
  return game;
}

test('placement evidence separates simultaneous terrain, ownership and resource failures without changing the colony', () => {
  const g = colony();
  g.tiles[g.idx(51, 48)].t = g.WATER;
  g.owned[g.idx(51, 48)] = 0;
  const before = JSON.stringify({
    tiles: g.tiles,
    buildings: g.buildings,
    jobs: g.jobs,
    rng: g.SR.getState(),
    state: g.state,
  });
  const evidence = g.placementChecks('quarry', 51, 48);
  assert.deepEqual(evidence.terrain, { ok: false, reason: { code: 'water' } });
  assert.deepEqual(evidence.ownership, { ok: false, reason: { code: 'territory' } });
  assert.deepEqual(evidence.resources, { ok: false, reason: { code: 'no-rocks' } });
  assert.deepEqual(evidence.reason, { code: 'water' });
  assert.deepEqual(g.canPlace('quarry', 51, 48), [false, { code: 'water' }]);
  assert.equal(
    JSON.stringify({
      tiles: g.tiles,
      buildings: g.buildings,
      jobs: g.jobs,
      rng: g.SR.getState(),
      state: g.state,
    }),
    before,
  );
});

test('construction affordability names reachable free stock and optional transfer promises without releasing protected jobs', () => {
  const g = colony();
  const hq = g.anyStorage();
  hq.stock = { planks: 5, stone: 3, tools: 1 };
  hq.reservedStock = { planks: 4 };
  const warehouse = g.newBuilding('warehouse', 60, 48);
  warehouse.done = true;
  warehouse.constructionProgress = 1;
  g.buildings.push(warehouse);
  const site = g.newBuilding('warehouse', 57, 52);
  g.buildings.push(site);
  g.jobs = [
    { kind: 'transfer', good: 'planks', sourceId: hq.id, to: warehouse.id, status: 'pending' },
    { kind: 'transfer', good: 'planks', sourceId: hq.id, to: warehouse.id, status: 'assigned' },
    { kind: 'fetch', good: 'planks', sourceId: hq.id, to: site.id, status: 'pending' },
    { kind: 'fetch', good: 'planks', sourceId: hq.id, to: site.id, status: 'pending' },
  ];
  g.units[0].job = g.jobs[1];
  g.units[0].phase = 'p';
  const evidence = g.buildingAffordability('farm', { x: 51, y: 48 });
  assert.equal(evidence.affordable, true);
  assert.deepEqual(
    evidence.materials.find((row) => row.good === 'planks'),
    { good: 'planks', required: 3, free: 1, available: 3, optionalTransfers: 2, reclaim: 2 },
  );
  assert.equal(g.jobs.length, 4);
  assert.equal(hq.reservedStock.planks, 4);
  assert.equal(g.placeBuilding('farm', 51, 48), true);
  assert.equal(g.jobs.length, 2);
  assert.ok(g.jobs.every((job) => job.kind === 'fetch'));
  assert.equal(hq.reservedStock.planks, 2);
});

test('remote stored goods cannot make an isolated construction site affordable', () => {
  const g = colony();
  const hq = g.anyStorage();
  hq.stock = { planks: 2, stone: 2, tools: 1 };
  for (let y = 0; y < g.H; y++) g.tiles[g.idx(55, y)].t = g.WATER;
  const remote = g.newBuilding('warehouse', 60, 48);
  remote.done = true;
  remote.stock = { planks: 99 };
  g.buildings.push(remote);
  assert.equal(g.spendableStock('planks'), 101);
  const evidence = g.buildingAffordability('farm', { x: 51, y: 48 });
  assert.equal(evidence.affordable, false);
  assert.equal(evidence.materials.find((row) => row.good === 'planks').available, 2);
});
