const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, DEFAULT_MODULES } = require('./helpers/game.cjs');

// Two storehouses on separate land with a producer beside the first; column 30 is water.
function colony() {
  const { game } = createGame({ seed: 2024, headless: true, modules: DEFAULT_MODULES });
  game.tiles = Array.from({ length: game.W * game.H }, (_, i) => ({
    t: i % game.W === 30 ? game.WATER : game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  const hq = game.newBuilding('hq', 20, 20);
  Object.assign(hq, { done: true, constructionProgress: 1, stock: { planks: 10, gold: 4 } });
  const island = game.newBuilding('warehouse', 40, 20);
  Object.assign(island, { done: true, constructionProgress: 1, stock: { planks: 5 } });
  const sawmill = game.newBuilding('sawmill', 24, 20);
  Object.assign(sawmill, { done: true, constructionProgress: 1 });
  game.buildings.push(hq, island, sawmill);
  game.state.gold = 4;
  return { game, hq, island, sawmill };
}

test('available stock is stored stock less reservations, limited to storage connected to the asker', () => {
  const { game, hq, sawmill } = colony();
  game.reserveStock(hq, 'planks');
  game.reserveStock(hq, 'planks');
  assert.equal(hq.stock.planks, 10, 'reserved stock remains stored stock');
  assert.equal(game.availableStock('planks'), 13);
  assert.equal(game.availableStock('planks', sawmill), 8);
});

test('stock held for uncollected warehouse transfers is reclaimable, so spendable but not available', () => {
  const { game, hq, island, sawmill } = colony();
  const transfers = [0, 1, 2].map(() => {
    const job = {
      kind: 'transfer',
      good: 'planks',
      sourceId: hq.id,
      to: island.id,
      status: 'pending',
    };
    game.jobs.push(job);
    game.reserveStock(hq, 'planks');
    return job;
  });
  game.reserveStock(hq, 'planks'); // a construction fetch is never reclaimable
  assert.equal(game.availableStock('planks', sawmill), 6);
  assert.equal(game.reclaimableStock('planks', sawmill), 3);
  assert.equal(game.spendableStock('planks', sawmill), 9);
  assert.equal(game.spendableStock('planks'), 14);

  game.spawnCarrier(hq);
  const carrier = game.units.at(-1);
  carrier.job = transfers[0];
  game.collectReserved(hq, 'planks');
  carrier.carry = 'planks';
  assert.equal(hq.stock.planks, 9, 'collected goods leave stored stock');
  assert.equal(game.availableStock('planks', sawmill), 6);
  assert.equal(
    game.reclaimableStock('planks', sawmill),
    2,
    'collected cargo is no longer reclaimable',
  );
});

test('the treasury counts gold entering storage from producers or outside, never gold moved between storehouses', () => {
  const { game, hq, island } = colony();
  const flows = () => game.observationData.totals;
  game.storeGoods(hq, 'gold', 2, 'producer', 'salvage');
  assert.equal(hq.stock.gold, 6);
  assert.equal(game.state.gold, 6);
  assert.equal(game.state.goldDelivered, 2, 'producer gold is delivered gold');
  assert.equal(flows().salvage.gold, 2);

  game.storeGoods(island, 'gold', 1, 'storage');
  assert.equal(island.stock.gold, 1);
  assert.equal(game.state.gold, 6, 'transfers and returned cargo were already banked');

  game.storeGoods(hq, 'gold', 3, 'external', 'contractReward');
  assert.equal(game.state.gold, 9);
  assert.equal(game.state.goldDelivered, 2, 'rewards are not delivered gold');
  assert.equal(flows().contractReward.gold, 3);

  game.storeGoods(hq, 'planks', 4, 'producer');
  assert.equal(hq.stock.planks, 14);
  assert.equal(game.state.gold, 9);
});

test('withdrawing spends available stock across storehouses, leaves reservations intact and debits the treasury', () => {
  const { game, hq, island } = colony();
  game.reserveStock(hq, 'planks');
  game.reserveStock(hq, 'planks');
  game.withdrawStock({ planks: 9, gold: 3 }, 'contractSpent');
  assert.equal(hq.stock.planks, 2, 'the reserved planks stay for their collection');
  assert.equal(hq.reservedStock.planks, 2);
  assert.equal(island.stock.planks, 4);
  assert.equal(hq.stock.gold, 1);
  assert.equal(game.state.gold, 1);
  assert.equal(game.state.spentGold, 3);
  assert.equal(game.observationData.totals.contractSpent.planks, 9);
  assert.equal(game.observationData.totals.contractSpent.gold, 3);
});
