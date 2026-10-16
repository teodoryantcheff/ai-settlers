'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, pinClock } = require('./helpers/game.cjs');
pinClock(0);

function colony() {
  const { game, internals } = createGame({ seed: 2024, headless: true });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  game.owned.fill(1);
  function building(type, x, y, stock = {}) {
    const b = game.newBuilding(type, x, y);
    Object.assign(b, { done: true, constructionProgress: 1, stock: { ...stock } });
    game.buildings.push(b);
    return b;
  }
  return { game, hooks: internals.economy, building };
}

test('storage search preserves first-store ties and separates free stock, reserves and land access', () => {
  const { game, hooks, building } = colony();
  const first = building('hq', 8, 10, { logs: 2 });
  const second = building('warehouse', 12, 10, { logs: 2 });
  const island = building('warehouse', 10, 13, { logs: 5 });
  for (let x = 0; x < game.W; x++) game.tiles[game.idx(x, 12)].t = game.WATER;
  const ref = { x: 10, y: 10 };
  const rng = game.SR.getState();
  assert.equal(hooks.nearestStorage(ref), first, 'equal distance retains storage order');
  assert.equal(hooks.nearestStorage(ref, { exclude: first }), second);
  first.reservedStock.logs = 2;
  second.reservedStock.logs = 1;
  assert.equal(hooks.nearestStorage(ref, { available: 'logs' }), second);
  second.targets.logs = 1;
  assert.equal(hooks.nearestStorage(ref, { available: 'logs', retainTarget: true }), island);
  assert.equal(
    hooks.nearestStorage(ref, { available: 'logs', retainTarget: true, connected: true }),
    null,
    'a disconnected surplus cannot supply construction',
  );
  assert.equal(game.nearestStoragePos(island.x, island.y), island);
  assert.equal(game.SR.getState(), rng);
});

test('demolition applies its quote across disconnected salvage, equipment and dispatched soldiers', () => {
  const { game, building } = colony();
  const hq = building('hq', 8, 10, { planks: 10, stone: 10, weapons: 3 });
  const island = building('warehouse', 10, 13, { gold: 1 });
  const guard = building('guard', 10, 11, { tools: 3, gold: 2 });
  guard.manned = true;
  for (let x = 0; x < game.W; x++) game.tiles[game.idx(x, 12)].t = game.WATER;
  const queued = { kind: 'soldier', to: guard.id, status: 'pending' };
  const dispatched = { kind: 'soldier', to: guard.id, status: 'assigned' };
  game.jobs.push(queued, dispatched);
  game.units.push({ id: 900, kind: 'soldier', job: dispatched, carry: null, dead: false });
  const before = new Map(game.storages().map((store) => [store.id, { ...store.stock }]));
  const soldiers = game.soldierPool;
  const quote = game.demolitionQuote(guard);
  assert.equal(quote.allowed, true);
  assert.equal(quote.receiver.id, island.id, 'salvage may cross disconnected land');
  assert.equal(quote.equipmentReceiver.id, hq.id, 'equipment needs connected land');
  assert.equal(quote.returnedSoldiers, 3);
  game.demolish(guard);
  for (const store of game.storages())
    for (const good of Object.keys(game.GOODS)) {
      let expected = before.get(store.id)[good] || 0;
      if (store.id === quote.receiver.id)
        expected += (quote.refund[good] || 0) + (quote.salvage[good] || 0);
      if (store.id === quote.equipmentReceiver.id) expected += quote.equipment[good] || 0;
      assert.equal(store.stock[good] || 0, expected, store.id + '/' + good);
    }
  assert.equal(game.soldierPool, soldiers + quote.returnedSoldiers);
  assert.equal(game.jobs.length, 0);
  assert.equal(game.units[0].dead, true);
  assert.equal(game.state.gold, quote.salvage.gold);
  const buildings = game.buildings.slice();
  const stocks = game.buildings.map((b) => ({ ...b.stock }));
  assert.equal(game.demolitionQuote(guard).allowed, false);
  game.demolish(guard);
  assert.deepEqual(game.buildings, buildings, 'a rejected quote cannot remove another building');
  assert.deepEqual(
    game.buildings.map((b) => b.stock),
    stocks,
  );
  assert.equal(game.soldierPool, soldiers + quote.returnedSoldiers);
});

test('pickup fallback preserves its unrestricted first-store choice before route validation', () => {
  const { game, hooks, building } = colony();
  const source = building('hq', 1, 1);
  const first = building('warehouse', 5, 1, { grain: 2 });
  building('warehouse', 1, 5, { grain: 2 });
  const site = building('windmill', 1, 2);
  for (let y = 0; y < game.H; y++) game.tiles[game.idx(3, y)].t = game.WATER;
  const job = { kind: 'fetch', good: 'grain', sourceId: source.id, to: site.id, status: 'pending' };
  source.reservedStock.grain = 1;
  game.jobs.push(job);
  game.spawnCarrier(source);
  hooks.startJob(game.units[0], job);
  assert.equal(
    job.sourceId,
    first.id,
    'fallback chooses by distance and storage order before routing',
  );
  assert.equal(source.reservedStock.grain, 0);
  assert.equal(first.reservedStock.grain, 1);
  assert.equal(game.units[0].job, null, 'route validation still rejects the disconnected pickup');
  assert.equal(job.status, 'pending');
});

test('carrier recovery preserves partial pickup state and fully clears completed cargo', () => {
  const { game, hooks, building } = colony();
  const source = building('hq', 8, 10);
  const site = building('windmill', 9, 10);
  game.spawnCarrier(source);
  const unit = game.units[0];
  const job = {
    kind: 'fetch',
    good: 'grain',
    sourceId: source.id,
    to: site.id,
    status: 'assigned',
  };
  game.jobs.push(job);
  Object.assign(unit, {
    job,
    phase: 'p',
    pi: 7,
    dropB: site.id,
    dropIsSite: true,
    carryTransfer: true,
    carryWarehouseTransfer: true,
    carryProducer: 123,
  });
  const before = { ...unit };
  hooks.stepUnit(unit, 0.1);
  assert.deepEqual(unit, { ...before, job: null, phase: 'idle', moving: false });
  assert.equal(job.status, 'pending');
  Object.assign(unit, { phase: 'd', carry: 'grain', dropB: source.id, dropIsSite: false });
  hooks.stepUnit(unit, 0.1);
  assert.equal(source.stock.grain, 1);
  assert.deepEqual(
    [unit.job, unit.phase, unit.path, unit.carry, unit.dropB, unit.dropIsSite],
    [null, 'idle', null, null, null, false],
  );
  assert.deepEqual(
    [unit.carryTransfer, unit.carryWarehouseTransfer, unit.carryProducer, unit.pi],
    [false, false, null, 7],
  );
});
