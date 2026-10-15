const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeStorage, installGlobals } = require('./helpers/game.cjs');

function colony() {
  const { game } = createGame({
    seed: 2024,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
    storage: fakeStorage().localStorage,
    // Audio output is the system boundary; all colony commands use the real graph.
    stubs: { SND: { place() {}, road() {}, demolish() {} } },
  });
  game.initializeColony();
  return game;
}

test('tool changes discard transient action state but retain inspection until full cancellation', () => {
  const g = colony();
  const hq = g.anyStorage();
  g.selected = hq;
  g.selInfo = { x: 50, y: 50 };
  g.anchor = { x: 49, y: 48 };
  g.demoArm = hq;
  const before = g.exportSave();
  g.setMode('road');
  assert.equal(g.selected, hq);
  assert.equal(g.mode.type, 'road');
  assert.equal(g.selInfo, null);
  assert.equal(g.anchor, null);
  assert.equal(g.demoArm, null);
  g.cancelMode();
  assert.equal(g.mode, null);
  assert.equal(g.selected, null);
  assert.equal(g.exportSave(), before, 'pure interaction does not alter the colony or RNG');
});

test('road clicks retain failed Shift endpoints, chain successful roads and finish ordinary attempts', () => {
  const g = colony();
  g.setMode('road');
  const a = { x: 49, y: 48 };
  const b = { x: 50, y: 51 };
  const blocked = { x: 0, y: 0 };
  g.roadInput(a);
  a.x = 99;
  assert.deepEqual(g.anchor, { x: 49, y: 48 }, 'anchor copies the hover tile');
  g.roadInput(blocked, true);
  assert.deepEqual(g.anchor, { x: 49, y: 48 });
  g.roadInput(b, true);
  assert.deepEqual(g.anchor, b);
  assert.ok(g.tiles[g.idx(50, 51)].road);
  g.roadInput(blocked);
  assert.equal(g.anchor, null, 'ordinary failed attempts finish the road gesture');
  g.roadInput({ x: 50, y: 51 });
  g.roadInput({ x: 51, y: 51 });
  assert.equal(g.anchor, null);
  assert.ok(g.tiles[g.idx(51, 51)].road);
});

test('map and inspector razing share target confirmation, Shift bypass and domain rejection', () => {
  const g = colony();
  g.placeBuilding('farm', 51, 48);
  const farm = g.buildings.at(-1);
  const hq = g.anyStorage();
  g.selected = farm;
  assert.equal(g.demolitionInput(farm), 'armed');
  assert.equal(g.demoArm, farm);
  assert.ok(g.byId(farm.id));
  assert.equal(g.demolitionInput(null), 'missing');
  assert.equal(g.demoArm, null);
  g.demolitionInput(farm);
  g.demolitionInput(hq);
  assert.equal(g.demoArm, hq, 'changing targets rearms');
  g.demolitionInput(hq);
  assert.ok(g.byId(hq.id), 'confirmation does not bypass headquarters protection');
  assert.equal(g.demoArm, null);
  assert.equal(g.selected, farm);
  assert.ok(g.msgs.some((m) => m.t === 'The headquarters cannot be razed'));
  g.demolitionInput(farm, true);
  assert.equal(g.byId(farm.id), null);
  assert.equal(g.selected, null, 'a removed inspected building dismisses the inspector');
  assert.equal(g.selInfo, null);
  assert.equal(g.demoArm, null);
  g.placeBuilding('farm', 51, 48);
  g.selected = hq;
  const next = g.buildings.at(-1);
  g.demolitionInput(next);
  g.demolitionInput(next);
  assert.equal(g.byId(next.id), null);
  assert.equal(g.selected, hq, 'map demolition preserves inspection of another building');
});

test('map inspection, advisor focus, flagged navigation and Journey preserve their distinct tool rules', () => {
  const g = colony();
  const hq = g.anyStorage();
  const meadow = { x: 52, y: 52 };
  g.setMode('road');
  g.roadInput({ x: 49, y: 48 });
  g.selectMapTarget(null, meadow);
  assert.deepEqual(g.selInfo, meadow);
  g.inspectBuilding(hq, 'advisor');
  assert.equal(g.selected, hq);
  assert.deepEqual(g.selInfo, meadow, 'advisor focus keeps the previous tile detail');
  assert.equal(g.mode.type, 'road');
  assert.deepEqual(g.anchor, { x: 49, y: 48 });
  g.inspectBuilding(hq, 'flagged');
  assert.equal(g.selInfo, null);
  assert.equal(g.mode.type, 'road');
  g.demolitionInput(hq);
  g.dismissInspector();
  assert.equal(g.selected, null);
  assert.equal(g.demoArm, hq, 'inspector dismissal retains the armed map action');
  assert.equal(g.mode.type, 'road');
  g.inspectBuilding(hq, 'journey');
  assert.equal(g.selected, hq);
  assert.equal(g.mode, null);
  assert.equal(g.anchor, null);
  assert.equal(g.demoArm, null);
  g.setMode('build', 'farm');
  assert.equal(g.selected, hq, 'normal Journey tool changes retain inspection');
  g.activateTool('build', 'lumberjack');
  assert.equal(g.selected, null, 'palette/advisor building choice dismisses inspection');
  assert.equal(g.mode.bt, 'lumberjack');
  g.selectMapTarget(hq, meadow);
  assert.equal(g.selected, hq);
  assert.equal(g.selInfo, null);
});

test('only committed loads reset interaction and continue to use replacement world buildings', () => {
  const g = colony();
  const saved = g.exportSave();
  const hq = g.anyStorage();
  g.selected = hq;
  g.selInfo = { x: 52, y: 52 };
  g.setMode('road');
  g.roadInput({ x: 49, y: 48 });
  g.demolitionInput(hq);
  const oldBuildings = g.buildings;
  assert.throws(() => g.importSave('{"v":2}'));
  assert.equal(g.buildings, oldBuildings);
  assert.equal(g.mode.type, 'road');
  assert.equal(g.selected, hq);
  assert.deepEqual(g.anchor, { x: 49, y: 48 });
  assert.equal(g.demoArm, hq);
  for (let i = 0; i < 3; i++) {
    g.importSave(saved);
    assert.notEqual(g.buildings, oldBuildings);
    assert.equal(g.mode, null);
    assert.equal(g.selected, null);
    assert.equal(g.selInfo, null);
    assert.equal(g.anchor, null);
    assert.equal(g.demoArm, null);
    g.selectMapTarget(g.anyStorage(), { x: 48, y: 48 });
    assert.equal(g.selected, g.byId(hq.id), 'selection uses the live replacement array');
    g.setMode('demolish');
    g.demolitionInput(g.anyStorage());
  }
});

test('committed load clears stale selection even when the tool view cannot refresh', () => {
  const g = colony();
  const saved = g.exportSave();
  g.selected = g.anyStorage();
  g.setMode('road');
  g.roadInput({ x: 49, y: 48 });
  g.demolitionInput(g.anyStorage());
  // A failed presentation observer must not leave a reference to the old world.
  g.refreshToolView = () => {
    throw new Error('view unavailable');
  };
  const errors = [];
  const restore = installGlobals({
    console: { ...console, error: (error) => errors.push(error) },
  });
  try {
    g.importSave(saved);
    assert.equal(g.selected, null);
    assert.equal(g.mode, null);
    assert.equal(g.anchor, null);
    assert.equal(g.demoArm, null);
    assert.equal(errors.length, 1);
  } finally {
    restore();
  }
});
