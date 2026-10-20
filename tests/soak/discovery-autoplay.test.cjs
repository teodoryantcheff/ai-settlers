'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeStorage } = require('../helpers/game.cjs');
const { validateSave } = require('../../src/core/state.ts');
const { checkEconomy, snapshot } = require('../helpers/economy.cjs');

for (const seed of (process.env.ECONOMY_SEEDS?.split(',').map(Number) || [42, 123, 2024]).filter(
  (seed) => !process.env.ECONOMY_SEED || seed === Number(process.env.ECONOMY_SEED),
)) {
  test(
    `exploration autoplay reaches gold with finite expansion supplies (seed ${seed})`,
    { timeout: 300000 },
    async () => {
      const { game: g } = createGame({
        seed,
        headless: true,
        stubs: { validateSave },
        storage: fakeStorage().localStorage,
      });
      g.resetColony(seed, 'Exploration', true);
      g.state.auto = true;
      const initial = g.revealed.reduce((sum, v) => sum + v, 0);
      let resumed = false;
      for (
        let tick = 0;
        tick < (Number(process.env.ECONOMY_SECONDS) || 7200) * 60 && !g.state.won;
        tick++
      ) {
        g.step(1 / 60);
        if (tick % 3600 === 0) {
          checkEconomy(g);
          if (!resumed && g.buildings.some((b) => b.type === 'guard' && b.manned)) {
            const saved = g.exportSave();
            g.importSave(saved);
            assert.equal(g.exportSave(), saved);
            resumed = true;
          }
          await new Promise(setImmediate);
        }
      }
      console.log(`Exploration seed ${seed}: ${JSON.stringify(snapshot(g))}`);
      assert.ok(resumed, 'saved and resumed during expansion');
      assert.ok(g.revealed.reduce((sum, v) => sum + v, 0) > initial);
      assert.equal(g.state.won, true, JSON.stringify(snapshot(g)));
    },
  );
}
