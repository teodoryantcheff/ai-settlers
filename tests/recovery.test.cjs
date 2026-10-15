const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  DEFAULT_MODULES,
  fakeDom,
  fakeWindow,
  fakeStorage,
  installGlobals,
  pinClock,
} = require('./helpers/game.cjs');
pinClock(0);
test('graphics recovery pauses the actual colony and preserves its live graph and storage', () => {
  const dom = fakeDom();
  const { window } = fakeWindow();
  installGlobals({ document: dom.document, window });
  const { storage, localStorage } = fakeStorage();
  const { game: g } = createGame({
    storage: localStorage,
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace', 'recovery'],
    stubs: { keys: {}, SND: { ui() {} } },
  });
  g.initializeColony();
  g.saveCheckpoint('Before graphics failure');
  g.saveAutosave();
  const checkpoints = [...storage];
  const buildings = g.buildings,
    units = g.units,
    rng = g.SR.getState(),
    time = g.state.time;
  g.state.paused = false;
  g.emitGameEvent('rendererFailed', { reason: 'WebGL context lost' });
  assert.equal(g.state.paused, true);
  assert.equal(g.buildings, buildings);
  assert.equal(g.units, units);
  assert.equal(g.SR.getState(), rng);
  assert.equal(g.state.time, time);
  assert.deepEqual([...storage], checkpoints);
  assert.equal(
    dom.node('recovery-reason').textContent,
    'WebGL context lost. Native WebGL rendering is required.',
  );
  assert.equal(g.blockingLayerOpen(), true);
  assert.equal(dom.node('renderer-status').classList.contains('hidden'), false);
});

test('reload review is a nested dismissible layer above nondismissible graphics recovery', () => {
  const dom = fakeDom();
  const win = fakeWindow();
  installGlobals({ document: dom.document, window: win.window });
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace', 'recovery'],
    stubs: { keys: {} },
  });
  game.emitGameEvent('rendererFailed', { reason: 'WebGL context lost' });
  dom.node('recovery-reload').onclick();
  assert.equal(dom.node('recovery-reload-confirmation').hidden, false);
  const escape = () =>
    win.fire('keydown', {
      key: 'Escape',
      preventDefault() {},
      stopImmediatePropagation() {},
    });
  escape();
  assert.equal(dom.node('recovery-reload-confirmation').classList.contains('hidden'), true);
  assert.equal(game.blockingLayerOpen(), true);
  escape();
  assert.equal(dom.node('renderer-status').classList.contains('hidden'), false);
  assert.equal(game.blockingLayerOpen(), true);
});
