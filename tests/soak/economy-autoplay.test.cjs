'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pinClock } = require('../helpers/game.cjs');
const { autoplay, checkEconomy, snapshot } = require('../helpers/economy.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

// Full autoplay playthroughs: each simulates up to two game hours at the
// browser's fixed timestep. Run with `npm run test:soak`, not `npm test`.

function investmentChoices(e) {
  // Model a player requesting the goods for outstanding orders through the
  // normal warehouse controls, so optional food orders get production capacity.
  const targets = {};
  for (let i = 0; i < e.contracts.length; i++) {
    if (e.state.contracts.includes(i)) continue;
    for (const [good, amount] of Object.entries(e.contracts[i].cost))
      targets[good] = Math.max(targets[good] || 0, amount);
  }
  e.anyStorage().targets = targets;
  for (let contract = 0; contract < e.contracts.length; contract++) {
    if (Object.entries(e.contracts[contract].cost).every(([g, n]) => e.availGood(g) >= n))
      e.claimContract(contract);
  }
  for (const kind of ['haul', 'production'])
    if (e.availGood('gold') >= 15 * ((e.state.upgrades[kind] || 0) + 1)) e.buyUpgrade(kind);
}

function registerEconomyTest(seed, invest = false) {
  test(
    `autoplay reaches 200 banked gold${invest ? ' after all contracts and upgrades' : ''} (seed ${seed})`,
    { timeout: 300000 },
    async (t) => {
      const e = autoplay(seed);
      // Use the same fixed timestep and milestone updates as the browser runtime.
      const limit = Number(process.env.ECONOMY_SECONDS) || 7200,
        checkpoint = 60;
      let nextCheck = checkpoint;
      for (let i = 0; i < limit * 60 && !e.state.won; i++) {
        e.step(1 / 60);
        if (e.state.time >= nextCheck) {
          if (invest) investmentChoices(e);
          try {
            checkEconomy(e);
          } catch (error) {
            error.message += '\n' + JSON.stringify(snapshot(e));
            throw error;
          }
          nextCheck += checkpoint;
          await new Promise(setImmediate);
          if (t.signal.aborted) return;
        }
      }
      checkEconomy(e);
      console.log(`Economy seed ${seed}: ${JSON.stringify(snapshot(e))}`);
      assert.equal(e.state.won, true, JSON.stringify(snapshot(e)));
      assert.ok(e.state.gold >= e.GOAL);
      if (invest) {
        assert.equal(e.state.upgrades.haul, 3);
        assert.equal(e.state.upgrades.production, 3);
        assert.equal(e.state.spentGold, 180);
        assert.deepEqual([...e.state.contracts].sort(), [0, 1, 2, 3, 4, 5]);
      }
    },
  );
}

for (const seed of (process.env.ECONOMY_SEEDS?.split(',').map(Number) || [2024, 123, 42]).filter(
  (s) => !process.env.ECONOMY_SEED || s === Number(process.env.ECONOMY_SEED),
)) {
  registerEconomyTest(seed, process.env.ECONOMY_PROFILE === 'invest');
}
if (!process.env.ECONOMY_SEED && !process.env.ECONOMY_SEEDS && !process.env.ECONOMY_PROFILE)
  registerEconomyTest(27, true);
