import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';
function colony() {
  const { game } = createGame({
    seed: 2024,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy'],
  });
  game.initializeColony();
  return game;
}
test('explicit spending explains optional transfer reclaim without releasing construction reservations', () => {
  const game = colony();
  const hq = game.anyStorage();
  hq.stock.planks = 12;
  const warehouse = game.newBuilding('warehouse', 54, 48);
  warehouse.done = true;
  warehouse.targets.planks = 12;
  game.buildings.push(warehouse);
  game.recomputeTerritory();
  game.ensureJobs(warehouse);
  const before = game.exportSave();
  const report = game.actionAvailability({ planks: 12 });
  assert.equal(report.affordable, true);
  assert.deepEqual(report.materials, [
    {
      good: 'planks',
      required: 12,
      available: 10,
      spendable: 12,
      reserved: 2,
      reclaim: 2,
      missing: 0,
    },
  ]);
  assert.equal(
    game.exportSave(),
    before,
    'reading does not cancel optional promises or change RNG',
  );
  game.claimContract(0);
  assert.equal(hq.stock.planks, 0);
  assert.equal(game.state.gold, 5);
  assert.equal(
    game.jobs.some((job) => job.kind === 'transfer' && job.good === 'planks'),
    false,
  );
  const protectedGame = colony();
  protectedGame.anyStorage().stock.planks = 12;
  protectedGame.placeBuilding('farm', 51, 48);
  protectedGame.ensureJobs(protectedGame.buildings.at(-1));
  const protectedBefore = protectedGame.exportSave();
  assert.equal(protectedGame.actionAvailability({ planks: 12 }).affordable, false);
  protectedGame.claimContract(0);
  assert.equal(protectedGame.exportSave(), protectedBefore);
});
test('contract costs and upgrade spending leave exact quantities and unmet conditions', () => {
  const game = colony();
  game.claimContract(0);
  game.claimContract(2);
  assert.equal(game.state.gold, 17);
  const report = game.actionAvailability({ gold: 15 });
  assert.equal(report.affordable, true);
  game.buyUpgrade('haul');
  assert.equal(game.state.gold, 2);
  assert.equal(game.state.spentGold, 15);
  assert.equal(game.state.upgrades.haul, 1);
  assert.equal(game.actionAvailability({ gold: 30 }).materials[0].missing, 28);
});
