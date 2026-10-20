'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installGlobals } = require('../helpers/game.cjs');
const { BASELINES, baselineHash, run } = require('../helpers/baselines.cjs');

// Full autoplay and manual determinism-baseline matrix: each run is a
// five-minute playthrough at the fixed timestep. Run with `npm run test:soak`,
// not `npm test`; the routine suite keeps one autoplay spot-check in
// tests/layering.test.cjs.

for (const [seed, auto, hash] of BASELINES)
  test(`headless engine preserves baseline seed ${seed}, autoplay ${auto}`, () => {
    const restore = installGlobals({
      performance: undefined,
      location: undefined,
      localStorage: undefined,
      document: undefined,
      window: undefined,
    });
    try {
      const plain = run(seed, auto);
      assert.equal(Object.hasOwn(plain, 'economy'), false);
      assert.equal(baselineHash(plain), hash);
      // The independent observed run must match too: event subscriptions
      // cannot change simulation state.
      assert.deepEqual(run(seed, auto, true), plain);
    } finally {
      restore();
    }
  });
