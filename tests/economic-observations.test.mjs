import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';
import { plainSave } from './helpers/saves.mjs';

function colony() {
  const { game } = createGame({
    storage: { getItem: () => null, setItem() {} },
    seed: 2024,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
  });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  const hq = game.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.constructionProgress = 1;
  hq.stock = { logs: 100, planks: 48, stone: 48, tools: 16 };
  const mill = game.newBuilding('sawmill', 50, 48);
  mill.done = true;
  mill.constructionProgress = 1;
  mill.timer = 0;
  mill.stock.logs = 4;
  game.buildings.push(hq, mill);
  game.recomputeTerritory();
  game.spawnT = game.serfT = 1e6;
  return { game, hq, mill };
}

test('colony lifetime measurements retain demolished production and reads do not change continuation', () => {
  const { game, mill } = colony();
  game.step(0.25);
  assert.equal(game.economicWindow('lifetime').totals.produced.planks, 1);
  assert.equal(
    game.economicWindow('lifetime').rates.produced.planks,
    240,
    'one good over a quarter simulation second is 240 per minute',
  );
  assert.equal(game.economicWindow('lifetime').totals.consumed.logs, 2);
  game.demolish(mill);
  assert.equal(game.economicWindow('lifetime').totals.produced.planks, 1);
  const before = game.exportSave();
  for (let i = 0; i < 100; i++) {
    game.economicWindow(30);
    game.economicHistory(600);
    game.resourceAccounting('planks');
  }
  assert.equal(game.exportSave(), before);
});

test('stock categories reconcile without counting reservations or queued jobs twice', () => {
  const { game, hq, mill } = colony();
  hq.stock.logs = 10;
  hq.reservedStock.logs = 3;
  mill.stock.logs = 4;
  game.jobs.push({ kind: 'transfer', good: 'logs', sourceId: hq.id, to: hq.id, status: 'pending' });
  game.spawnCarrier(hq);
  game.units[0].carry = 'logs';
  const stock = game.resourceAccounting('logs');
  assert.deepEqual(
    [
      stock.stored,
      stock.reserved,
      stock.available,
      stock.inTransit,
      stock.producerInputs,
      stock.physicalGoods,
      stock.reclaimable,
    ],
    [10, 3, 7, 1, 4, 15, 1],
  );
  const site = game.newBuilding('toolsmith', 50, 50);
  site.got.planks = 1;
  game.buildings.push(site);
  assert.equal(game.resourceAccounting('planks').physicalGoods, 49);
  assert.equal(game.resourceAccounting('planks').constructionMaterials, 1);
  stock.contributors[0].stored = 900;
  assert.equal(game.resourceAccounting('logs').stored, 10);
});

test('colony windows survive exact save continuation', () => {
  const { game, mill } = colony();
  for (let i = 0; i < 2600; i++) {
    mill.stock.logs = 4;
    mill.stock.planks = 0;
    game.step(0.25);
  }
  assert.equal(game.economicWindow(600).elapsed, 600);
  const checkpoint = game.exportSave();
  for (let i = 0; i < 40; i++) game.step(0.25);
  const expected = game.exportSave();
  game.importSave(checkpoint);
  for (let i = 0; i < 40; i++) game.step(0.25);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(expected));
});

test('malformed or unbounded colony observations cannot replace a valid colony', () => {
  const { game } = colony();
  game.step(0.25);
  const valid = game.exportSave();
  const corruptions = [
    (obs) => {
      obs.started = 1;
    },
    (obs) => {
      obs.totals.produced.foreign = 1;
    },
    (obs) => {
      obs.totals.consumed.logs = -1;
    },
    (obs) => {
      obs.recent = Array.from({ length: 302 }, () => obs.recent[0]);
    },
    (obs) => {
      obs.recent[0].totals.produced.planks = 100;
    },
    (obs) => {
      obs.recent[0].time = 0.5;
    },
    (obs) => {
      obs.recent.push(structuredClone(obs.recent[0]));
    },
  ];
  for (const corrupt of corruptions) {
    const bad = plainSave(valid);
    corrupt(bad.observations);
    assert.throws(() => game.importSave(JSON.stringify(bad)), /observation|resource/i);
    assert.equal(game.exportSave(), valid);
  }
  const extra = JSON.parse(valid);
  extra.observations.polluted = true;
  extra.observations.totals.polluted = { gold: 1 };
  game.importSave(JSON.stringify(extra));
  const clean = JSON.parse(game.exportSave()).observations;
  assert.equal(clean.polluted, undefined);
  assert.equal(clean.totals.polluted, undefined);
});

test('real cargo arrivals separate producer throughput, construction spending and warehouse transfers', () => {
  const { game, hq, mill } = colony();
  const warehouse = game.newBuilding('warehouse', 54, 48);
  warehouse.done = true;
  warehouse.constructionProgress = 1;
  warehouse.targets.planks = 6;
  const site = game.newBuilding('toolsmith', 50, 50);
  site.disabled = true;
  game.buildings.push(warehouse, site);
  game.recomputeTerritory();
  for (let i = 0; i < 8; i++) game.spawnCarrier(hq);
  for (let i = 0; i < 160; i++) game.step(0.25);
  const totals = game.economicWindow('lifetime').totals;
  assert.ok(totals.inputArrived.logs > 0);
  assert.equal(totals.outputStored.planks, mill.metrics.outputDelivered.planks);
  assert.ok(totals.outputStored.planks > 0);
  assert.ok(totals.transferred.planks > 0);
  assert.equal(totals.constructionSpent.planks, 3);
  assert.equal(totals.constructionSpent.stone, 2);
  assert.deepEqual(warehouse.metrics.produced, {});
});

test('contracts, upgrades, per-good refunds and local salvage are distinct from production', () => {
  const { game, hq, mill } = colony();
  hq.stock.gold = 20;
  game.state.gold = 20;
  game.claimContract(0);
  game.buyUpgrade('haul');
  game.step(0.25);
  mill.stock.logs = 3;
  game.demolish(mill);
  const totals = game.economicWindow('lifetime').totals;
  assert.equal(totals.contractSpent.planks, 12);
  assert.equal(totals.upgradeSpent.gold, 15);
  assert.equal(totals.contractReward.gold, 5);
  assert.equal(totals.refund.planks, 1);
  assert.equal(totals.refund.stone, undefined);
  assert.equal(totals.salvage.logs, 3);
  assert.equal(totals.salvage.planks, 1);
  assert.equal(totals.produced.planks, 1);
  assert.deepEqual(totals.outputStored, {}, 'salvage is not a producer delivery');
  const site = game.newBuilding('toolsmith', 50, 50);
  site.got = { planks: 1, stone: 2 };
  game.buildings.push(site);
  game.demolish(site);
  assert.equal(
    game.economicWindow('lifetime').totals.refund.planks,
    1,
    'unfinished refund rounds down delivered materials',
  );
  assert.equal(game.economicWindow('lifetime').totals.refund.stone, 1);
});

test('producer cargo still records storage arrival when its building disappears in transit', () => {
  const { game, hq, mill } = colony();
  mill.x = 62;
  game.spawnCarrier(hq);
  game.step(0.25);
  mill.disabled = true;
  for (let tick = 0; tick < 200 && !game.units[0].carry; tick++) game.step(0.25);
  assert.equal(game.units[0].carry, 'planks');
  assert.deepEqual(game.economicWindow('lifetime').totals.outputStored, {});
  game.demolish(mill);
  const checkpoint = game.exportSave();
  game.importSave(checkpoint);
  for (
    let tick = 0;
    tick < 200 && !game.economicWindow('lifetime').totals.outputStored.planks;
    tick++
  )
    game.step(0.25);
  assert.equal(game.economicWindow('lifetime').totals.outputStored.planks, 1);
});

test('cancelled warehouse-transfer cargo remains a transfer when returned to storage', () => {
  const { game, hq, mill } = colony();
  game.demolish(mill);
  const warehouse = game.newBuilding('warehouse', 62, 48);
  warehouse.done = true;
  warehouse.constructionProgress = 1;
  warehouse.targets.planks = 1;
  game.buildings.push(warehouse);
  game.recomputeTerritory();
  game.spawnCarrier(hq);
  for (let tick = 0; tick < 200 && !game.units[0].carry; tick++) game.step(0.25);
  assert.equal(game.units[0].carry, 'planks');
  game.demolish(warehouse);
  game.importSave(game.exportSave());
  for (let tick = 0; tick < 200 && game.units[0].carry; tick++) game.step(0.25);
  assert.equal(game.economicWindow('lifetime').totals.transferred.planks, 1);
  assert.deepEqual(game.economicWindow('lifetime').totals.outputStored, {});
});
