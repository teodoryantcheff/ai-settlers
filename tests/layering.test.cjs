const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMessages } = require('../src/ui/messages.ts');
const { createInteraction } = require('../src/ui/interaction.ts');
const { attachSubsystem } = require('../src/core/attach.ts');
const { bindDomainFeedback, observePresentation } = require('../src/ui/domain-feedback.ts');
const { installGlobals } = require('./helpers/game.cjs');
const { BASELINES, baselineHash, engine, run, snapshot } = require('./helpers/baselines.cjs');
// The routine suite hashes one autoplay baseline; the full seed and manual
// matrix lives in tests/soak/baseline-hashes.test.cjs.
const ROUTINE_BASELINE = BASELINES.find(([seed, auto]) => seed === 2024 && auto === true);
test(`headless engine preserves baseline seed ${ROUTINE_BASELINE[0]}, autoplay ${ROUTINE_BASELINE[1]}`, () => {
  const restore = installGlobals({
    performance: undefined,
    location: undefined,
    localStorage: undefined,
    document: undefined,
    window: undefined,
  });
  try {
    const plain = run(ROUTINE_BASELINE[0], ROUTINE_BASELINE[1]);
    assert.equal(Object.hasOwn(plain, 'economy'), false);
    assert.equal(baselineHash(plain), ROUTINE_BASELINE[2]);
    assert.deepEqual(run(ROUTINE_BASELINE[0], ROUTINE_BASELINE[1], true), plain);
  } finally {
    restore();
  }
});
test('headless contracts, upgrades, roads and loads preserve live arrays and atomic storage', () => {
  const g = engine();
  assert.ok(!('SND' in g) && !('FX' in g) && !('mode' in g) && !('msg' in g));
  g.claimContract(0);
  assert.deepEqual(g.state.contracts, [0]);
  const hq = g.anyStorage();
  hq.stock.gold = 50;
  g.state.gold = 50;
  g.buyUpgrade('haul');
  assert.equal(g.state.upgrades.haul, 1);
  assert.equal(g.state.gold, 35);
  const raw = g.exportSave();
  const old = g.buildings;
  let loads = 0;
  g.gameEvents.on('worldLoaded', () => {
    loads++;
    assert.notEqual(g.buildings, old);
    assert.equal(g.byId(hq.id), g.buildings[0]);
    assert.ok(g.owned[g.idx(48, 48)]);
  });
  g.importSave(raw);
  assert.equal(loads, 1);
  assert.equal(g.anyStorage(), g.buildings[0]);
  assert.deepEqual(JSON.parse(g.exportSave()), JSON.parse(raw));
  const current = g.buildings;
  assert.throws(() => g.importSave('{}'));
  assert.equal(g.buildings, current);
  assert.deepEqual(JSON.parse(g.exportSave()), JSON.parse(raw));
  const copy = engine();
  copy.importSave(raw);
  for (let i = 0; i < 1200; i++) {
    g.step(1 / 60);
    copy.step(1 / 60);
  }
  assert.deepEqual(snapshot(g), snapshot(copy));
});
test('feedback has one owner, survives audio failure, clears relevant selection, and disposes', () => {
  const g = engine();
  attachSubsystem(g, createInteraction(g));
  attachSubsystem(g, createMessages(g));
  const calls = [];
  g.SND = Object.fromEntries(
    ['place', 'done', 'demolish', 'gone', 'man', 'road', 'fail', 'ui'].map((k) => [
      k,
      () => calls.push(k),
    ]),
  );
  g.FX = {
    ring: () => calls.push('ring'),
    coin: () => calls.push('coin'),
    pop: () => calls.push('pop'),
  };
  g.updateInfo = () => calls.push('inspector');
  assert.equal(Object.getOwnPropertyDescriptor(g, 'msgs').set, undefined);
  let dispose = bindDomainFeedback(g);
  g.canPlace('farm', 0, 0);
  assert.equal(g.msgs.length, 0);
  g.placeBuilding('farm', 0, 0);
  assert.deepEqual(calls, ['ring', 'fail']);
  calls.length = 0;
  assert.ok(g.placeBuilding('farm', 51, 48));
  const farm = g.buildings.at(-1);
  assert.equal(calls.filter((c) => c === 'place').length, 1);
  g.selected = g.anyStorage();
  g.demolish(farm);
  assert.equal(g.selected, g.anyStorage());
  g.placeBuilding('farm', 51, 48);
  g.selected = g.buildings.at(-1);
  g.demolish(g.selected);
  assert.equal(g.selected, null);
  assert.equal(calls.filter((c) => c === 'inspector').length, 1);
  dispose();
  dispose = bindDomainFeedback(g);
  const count = calls.filter((c) => c === 'place').length;
  g.placeBuilding('farm', 51, 48);
  assert.equal(calls.filter((c) => c === 'place').length, count + 1);
  const errors = [];
  const restore = installGlobals({ console: { ...console, error: (...e) => errors.push(e) } });
  try {
    g.SND.demolish = () => {
      throw new Error('device gone');
    };
    g.demolish(g.buildings.at(-1));
    assert.ok(!g.buildings.some((b) => b.type === 'farm'));
    assert.ok(g.msgs.some((m) => m.t === 'Grain Farm torn down'));
    assert.equal(errors.length, 1);
  } finally {
    restore();
    dispose();
    g.disposeMessages();
  }
});
test('presentation failures cannot abort committed loads, but domain listeners still propagate', () => {
  const g = engine();
  g.saveCheckpoint('Observer baseline');
  const raw = g.exportSave();
  let failures = 0;
  const dispose = observePresentation(
    g,
    'worldLoaded',
    () => {
      throw new Error('view failed');
    },
    () => {
      failures++;
    },
  );
  assert.equal(g.loadGame(), true);
  g.importSave(raw);
  assert.equal(failures, 2);
  dispose();
  g.importSave(raw);
  assert.equal(failures, 2);
  g.gameEvents.on('territoryChanged', () => {
    throw new Error('domain fault');
  });
  assert.throws(() => g.recomputeTerritory(), /domain fault/);
});
test('domain sources do not import browser aggregates or globals', () => {
  for (const dir of ['simulation', 'gameplay', 'core'])
    for (const file of fs.readdirSync(path.join(__dirname, '../src', dir))) {
      const source = fs.readFileSync(path.join(__dirname, '../src', dir, file), 'utf8');
      assert.doesNotMatch(source, /from ['"][^'"]*(?:runtime|ui\/|audio\/|rendering\/)/);
      assert.doesNotMatch(source, /\b(?:performance|document|location|localStorage)\./);
    }
});

test('frame driver preserves cadence, ordering, tool suspension, pause/hidden/load and failures', () => {
  const { createLoop } = require('../src/application/loop.ts');
  const { createEvents } = require('../src/core/events.ts');
  const calls = [];
  let modal = false;
  let visibility;
  const doc = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => {
      if (name === 'visibilitychange') visibility = fn;
    },
  };
  const restore = installGlobals({
    document: doc,
    requestAnimationFrame: () => calls.push('schedule'),
  });
  try {
    const g = {
      ...createEvents(),
      state: { paused: false, speed: 8, won: false },
      started: false,
      mode: { type: 'road' },
      NOW: 42,
      modalOpen: () => modal,
      keyPan: () => calls.push('camera'),
      refreshHover: () => calls.push('hover'),
      step: (dt, suspended) => {
        assert.equal(dt, 1 / 60);
        assert.equal(suspended, !!g.mode);
        calls.push('step');
      },
      updateEconomicFeedback: () => calls.push('feedback'),
      ambTick: () => calls.push('ambience'),
      draw: () => calls.push('draw'),
      tooltipTick: (now) => {
        assert.equal(now, 42);
        calls.push('tooltip');
      },
      drawMini: () => calls.push('minimap'),
      hudTick: () => calls.push('hud'),
      updateFps: () => calls.push('fps'),
      resetFps: () => calls.push('resetfps'),
    };
    const hooks = {};
    createLoop(g, hooks);
    hooks.frame(100);
    calls.length = 0;
    hooks.frame(10000);
    assert.equal(calls.filter((c) => c === 'step').length, 48, '0.1s delta cap at 8x');
    assert.deepEqual(calls.slice(-8), [
      'feedback',
      'ambience',
      'draw',
      'tooltip',
      'minimap',
      'hud',
      'fps',
      'schedule',
    ]);
    g.mode = null;
    g.state.paused = true;
    calls.length = 0;
    hooks.frame(10010);
    assert.ok(!calls.includes('step'));
    assert.ok(calls.includes('fps'));
    assert.equal(hooks.simAccumulator, 0);
    g.state.paused = false;
    modal = true;
    hooks.frame(10020);
    assert.equal(hooks.simAccumulator, 0);
    modal = false;
    doc.visibilityState = 'hidden';
    hooks.frame(10030);
    assert.equal(hooks.simAccumulator, 0);
    doc.visibilityState = 'visible';
    visibility();
    calls.length = 0;
    hooks.frame(99999);
    assert.ok(!calls.includes('step'));
    hooks.frame(100002);
    assert.ok(hooks.simAccumulator > 0);
    g.emitGameEvent('worldLoaded', {});
    assert.equal(hooks.simAccumulator, 0);
    g.renderingAvailable = false;
    calls.length = 0;
    hooks.frame(100100);
    assert.deepEqual(calls, ['resetfps', 'hud', 'schedule']);
    assert.equal(g.state.paused, true);
  } finally {
    restore();
  }
});

test('only new banked gold emits a coin event; transfer and demolition salvage do not', () => {
  const { createGame } = require('./helpers/game.cjs');
  const { game: g } = createGame({ seed: 2024, headless: true });
  g.initializeColony();
  const hq = g.anyStorage();
  const gold = g.newBuilding('mine_gold', 51, 48);
  gold.done = true;
  g.buildings.push(gold);
  const events = [];
  g.gameEvents.on('goldBanked', (e) => events.push(e));
  const u = g.units[0];
  function deposit(transfer) {
    u.job = {
      kind: transfer ? 'transfer' : 'deliver',
      good: 'gold',
      status: 'assigned',
      sourceId: transfer ? hq.id : gold.id,
      to: hq.id,
    };
    g.jobs.push(u.job);
    u.phase = 'd';
    u.carry = 'gold';
    u.carryTransfer = transfer;
    u.dropB = hq.id;
    u.dropIsSite = false;
    u.path = [];
    u.pi = 0;
    g.stepUnit(u, 1 / 60);
  }
  deposit(false);
  assert.equal(events.length, 1);
  assert.equal(g.state.gold, 1);
  deposit(true);
  assert.equal(events.length, 1);
  assert.equal(g.state.gold, 1);
  gold.stock.gold = 2;
  g.demolish(gold);
  assert.equal(events.length, 1);
  assert.equal(g.state.gold, 3);
});

function transferSequence() {
  const g = engine(123);
  const hq = g.anyStorage();
  hq.stock.gold = 30;
  g.state.gold = 30;
  g.claimContract(0);
  g.buyUpgrade('haul');
  assert.ok(g.placeBuilding('warehouse', 51, 48));
  assert.ok(g.placeBuilding('sawmill', 48, 51));
  let transferred = false;
  for (let i = 0; i < 7200; i++) {
    const store = g.buildings.find((b) => b.type === 'warehouse');
    if (store && store.done) store.targets = { food: 10, gold: 5 };
    if (i === 3600) g.demolish(g.buildings.find((b) => b.type === 'sawmill'));
    g.step(1 / 60);
    if (g.jobs.some((j) => j.kind === 'transfer')) transferred = true;
  }
  assert.ok(transferred);
  assert.ok(!g.buildings.some((b) => b.type === 'sawmill'));
  assert.deepEqual(g.state.contracts, [0]);
  assert.equal(g.state.upgrades.haul, 1);
  const store = g.buildings.find((b) => b.type === 'warehouse');
  assert.ok(store.done && store.stock.food >= 10 && store.stock.gold >= 5);
  return snapshot(g);
}

test('transfer, spending and demolition preserve the expanded-economy seed 123 snapshot', () => {
  const plain = transferSequence();
  assert.equal(Object.hasOwn(plain, 'economy'), false);
  assert.deepEqual(transferSequence(), plain);
  assert.equal(
    baselineHash(plain),
    '52728cf2c2aa265e18967c7f733f7f01351f6e0c1450a6af3eb07eee6685b426',
  );
});
