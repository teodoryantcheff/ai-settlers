const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./helpers/game.cjs');

test('test setup rejects unknown module requests before constructing the graph', () => {
  for (const name of ['missingSubsystem', 'toString', '__proto__']) {
    assert.throws(() => createGame({ modules: ['world', name] }), {
      message: `Unknown test module: ${name}`,
    });
  }
});

test('headless setup rejects explicitly requested browser input and messages', () => {
  for (const name of ['interaction', 'messages']) {
    assert.throws(() => createGame({ modules: [name], headless: true }), {
      message: `Test module ${name} cannot be requested in headless mode`,
    });
  }
});
