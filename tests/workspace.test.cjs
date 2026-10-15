const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  DEFAULT_MODULES,
  fakeDom,
  fakeWindow,
  installGlobals,
  pinClock,
} = require('./helpers/game.cjs');
pinClock(0);

test('analysis preserves selection and map context while canceling placement', () => {
  const dom = fakeDom();
  const win = fakeWindow();
  installGlobals({ document: dom.document, window: win.window });
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace'],
    stubs: { keys: {}, cam: { x: 800, y: 900 }, vw: 800, vh: 600, z: 1, clampCam() {} },
  });
  const building = game.newBuilding('farm', 50, 50);
  game.buildings.push(building);
  game.selectMapTarget(building, null);
  game.setMode('build', 'well');
  game.switchWorkspace('economy');
  assert.equal(game.selected, building);
  assert.equal(game.mode, null);
  assert.deepEqual(game.cam, { x: 800, y: 900 });
  game.switchWorkspace('logistics');
  game.inspectContributor(building.id);
  assert.equal(game.workspace, 'logistics');
  assert.deepEqual(game.cam, { x: 800, y: 900 });
  game.locateContributor(building.id);
  assert.equal(game.workspace, 'map');
  assert.equal(game.selected, building);
  assert.notDeepEqual(game.cam, { x: 800, y: 900 });
});

test('nested blocking layers preserve the original player pause state', () => {
  const dom = fakeDom();
  const win = fakeWindow();
  installGlobals({ document: dom.document, window: win.window });
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace'],
    stubs: { keys: {}, SND: { demolish() {} } },
  });
  game.state.paused = false;
  game.openLayer('mix');
  game.openLayer('help');
  assert.equal(game.blockingLayerOpen(), true);
  assert.equal(
    game.state.paused,
    false,
    'utility suspension does not overwrite the player setting',
  );
  game.closeLayer('help');
  assert.equal(game.blockingLayerOpen(), true);
  game.closeLayer('mix');
  assert.equal(game.blockingLayerOpen(), false);
  assert.equal(game.state.paused, false);
  game.openLayer('about', { blocking: false });
  assert.equal(game.blockingLayerOpen(), false, 'nonblocking explanations remain live');
  assert.equal(game.state.paused, false);
  game.closeLayer('about');
});

test('a directly hidden utility can be reopened and a removed contributor retains its former location', () => {
  const dom = fakeDom();
  const win = fakeWindow();
  installGlobals({ document: dom.document, window: win.window });
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace'],
    stubs: { keys: {}, SND: { demolish() {} } },
  });
  game.openLayer('mix');
  dom.node('mix').classList.add('hidden');
  assert.equal(game.blockingLayerOpen(), false);
  assert.equal(
    dom.node('layer-backdrop').hidden,
    true,
    'directly hidden development layers leave no pointer blocker',
  );
  game.openLayer('mix');
  assert.equal(game.blockingLayerOpen(), true);
  game.closeLayer('mix');
  game.initializeColony();
  const farm = game.newBuilding('farm', 51, 48);
  game.buildings.push(farm);
  game.selectMapTarget(farm, null);
  game.demolish(farm);
  assert.equal(game.selected, null);
  assert.deepEqual(game.removedContributor, { id: farm.id, type: 'farm', x: 51, y: 48 });
  game.selectMapTarget(game.anyStorage(), null);
  game.showRemovedContributor({ id: farm.id, type: 'farm', x: 51, y: 48 });
  assert.equal(game.selected, null, 'a historical contributor replaces unrelated live inspection');
  game.dismissInspector();
  assert.equal(game.removedContributor, null);
});

test('closing a nested utility skips a disabled invoker and focuses the visible parent', () => {
  const dom = fakeDom();
  const win = fakeWindow();
  installGlobals({ document: dom.document, window: win.window });
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace'],
    stubs: { keys: {} },
  });
  const invoker = dom.node('settings-help');
  invoker.isConnected = true;
  invoker.disabled = true;
  invoker.matches = (selector) => selector.includes(':disabled');
  let focused = '';
  invoker.focus = () => (focused = 'disabled invoker');
  dom.node('mix').focus = () => (focused = 'parent');
  game.openLayer('mix');
  dom.document.activeElement = invoker;
  game.openLayer('help');
  game.closeLayer('help');
  assert.equal(focused, 'parent');
});

test('every report opening clears placement, road anchors, stale previews and held map movement', () => {
  const dom = fakeDom(),
    win = fakeWindow();
  installGlobals({ document: dom.document, window: win.window });
  const { game: g } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'workspace'],
    stubs: { keys: {} },
  });
  g.switchWorkspace('economy');
  g.setMode('road');
  g.roadInput({ x: 50, y: 50 });
  g.ghost = { x: 51, y: 50, ok: true };
  g.hoverIn = true;
  g.mouseSeen = true;
  g.ttStr = 'old placement';
  g.keys.l = g.keys.r = g.keys.u = g.keys.d = true;
  g.switchWorkspace('logistics');
  assert.equal(g.mode, null);
  assert.equal(g.anchor, null);
  assert.equal(g.ghost, null);
  assert.equal(g.hoverIn, false);
  assert.equal(g.mouseSeen, false);
  assert.equal(g.ttStr, null);
  assert.deepEqual(g.keys, { l: false, r: false, u: false, d: false });
});
