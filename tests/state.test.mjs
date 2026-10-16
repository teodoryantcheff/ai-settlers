import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../src/core/state.ts';
import {
  createGame,
  fakeDom,
  fakeElement,
  fakeStorage,
  fakeWindow,
  installGlobals,
  pinClock,
  DEFAULT_MODULES,
} from './helpers/game.cjs';

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

function colony(seed = 2024) {
  const noop = () => {};
  const dom = fakeDom();
  const { window } = fakeWindow();
  const { storage, localStorage } = fakeStorage();
  installGlobals({ document: dom.document, window, localStorage });
  const { game: e } = createGame({
    seed,
    modules: [...DEFAULT_MODULES, 'progression', 'persistence', 'hud'],
    stubs: {
      view: fakeElement('view'),
      mini: fakeElement('mini'),
      cam: { x: 0, y: 0 },
      vw: 1280,
      vh: 720,
      z: 1,
      mouse: { x: 0, y: 0 },
      ht: { x: 0, y: 0 },
      clampCam: noop,
      SND: {
        road: noop,
        ui: noop,
        fail: noop,
        place: noop,
        done: noop,
        demolish: noop,
        gone: noop,
        man: noop,
      },
      FXL: [],
      FX: { ring: noop, coin: noop, pop: noop },
      drawTile: noop,
      sctx: {},
      borderDirty: false,
      refreshGhost: noop,
      rebuildHighlights: noop,
      updateInfo: noop,
      commitRoad: noop,
      setMode: noop,
      centerHQ: noop,
      simAccumulator: 0,
      started: false,
      lastGoodsHTML: null,
      lastInfoHTML: null,
      lastSpeedBtn: null,
      _seen: {},
      _warmup: false,
      _prevWon: false,
      macroCan: null,
      _placementCache: null,
      _roadCache: null,
      unitPoses: {},
      workPulses: {},
    },
  });
  // Match the release bootstrap: a headquarters and eight carriers.
  e.genMap();
  const hq = e.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.prog = 1;
  hq.stock = { planks: 48, stone: 48, food: 20, tools: 16, weapons: 6 };
  e.buildings.push(hq);
  e.recomputeTerritory();
  for (let i = 0; i < 8; i++) e.spawnCarrier(hq);
  e.storage = storage;
  return e;
}

const snapshot = (e) => JSON.parse(JSON.stringify(e.snapshotGame()));

test('imported unknown production block reasons normalize to no reason', () => {
  const e = colony();
  for (const version of [1, 2]) {
    for (const reason of [
      undefined,
      'none',
      'input',
      'resouces',
      'constructor',
      '__proto__',
      7,
      null,
      {},
    ]) {
      const imported = snapshot(e);
      imported.v = version;
      imported.b[0].blockedReason = reason;
      e.importSave(JSON.stringify(imported));
      assert.equal(e.buildings[0].blockedReason, '', JSON.stringify(reason));
      assert.equal(JSON.parse(e.exportSave()).b[0].blockedReason, '', JSON.stringify(reason));
    }
  }
});

test('every production block reason round-trips through exported files and checkpoints', () => {
  const e = colony();
  const mill = e.newBuilding('sawmill', 51, 48);
  mill.done = true;
  mill.prog = 1;
  e.buildings.push(mill);
  e.step(1 / 60);
  for (const reason of [
    '',
    'paused',
    'exhausted',
    'output',
    'demand',
    'reserve',
    'water',
    'inputs',
    'resources',
  ]) {
    e.buildings[1].blockedReason = reason;
    const exported = e.exportSave();
    e.importSave(exported);
    assert.equal(e.buildings[1].blockedReason, reason);
    assert.deepEqual(JSON.parse(e.exportSave()), JSON.parse(exported));
    const saved = e.saveCheckpoint('Production reason');
    e.buildings[1].blockedReason = '';
    e.loadCheckpoint(saved.id);
    assert.equal(e.buildings[1].blockedReason, reason);
    assert.deepEqual(JSON.parse(e.exportSave()), JSON.parse(exported));
  }
});

test('version-two save continues RNG, timers, cargo and production exactly', () => {
  const e = colony();
  const lumber = e.newBuilding('lumberjack', 51, 48);
  lumber.done = true;
  lumber.prog = 1;
  e.buildings.push(lumber);
  const mill = e.newBuilding('sawmill', 46, 50);
  mill.done = true;
  mill.prog = 1;
  e.buildings.push(mill);
  e.state.paused = false;
  for (let tick = 0; tick < 1073; tick++) e.step(1 / 60);
  const checkpoint = JSON.stringify(e.snapshotGame());
  for (let tick = 0; tick < 2400; tick++) e.step(1 / 60);
  const expected = snapshot(e);
  e.commitLoad(e.prepareLoad(checkpoint));
  for (let tick = 0; tick < 2400; tick++) e.step(1 / 60);
  assert.deepEqual(snapshot(e), expected);
});

test('malformed load leaves both active colony and saved slot untouched', () => {
  const e = colony();
  e.saveGame(true);
  const before = snapshot(e),
    saved = e.storage.get('settlers.save');
  const broken = structuredClone(before);
  broken.t[0].pop();
  assert.throws(() => e.prepareLoad(JSON.stringify(broken)), /dimensions/);
  assert.deepEqual(snapshot(e), before);
  assert.equal(e.storage.get('settlers.save'), saved);
  const hostile = structuredClone(before);
  hostile.b[0].stock = { bogus: 100 };
  assert.throws(() => e.prepareLoad(JSON.stringify(hostile)), /quantity/);
  const brokenJob = structuredClone(before);
  brokenJob.j.push({ kind: 'transfer', good: 'food', from: 999, to: 1, state: 'p' });
  assert.throws(() => e.prepareLoad(JSON.stringify(brokenJob)), /source/);
  e.buildings.push(e.newBuilding('sawmill', 46, 50));
  const idleJob = snapshot(e);
  idleJob.j.push({
    kind: 'fetch',
    good: 'planks',
    s: idleJob.b[0].id,
    to: idleJob.b[1].id,
    state: 't',
  });
  idleJob.b[0].res.planks = 1;
  idleJob.u[0].ji = 0;
  assert.throws(() => e.prepareLoad(JSON.stringify(idleJob)), /idle carrier/);
  const wrongCargo = structuredClone(idleJob);
  wrongCargo.u[0].phase = 'd';
  wrongCargo.u[0].path = [];
  wrongCargo.u[0].carry = 'stone';
  wrongCargo.b[0].res.planks = 0;
  assert.throws(() => e.prepareLoad(JSON.stringify(wrongCargo)), /cargo/);
});

test('autoplay save continuation preserves construction decisions and milestones', () => {
  const e = colony();
  e.state.auto = true;
  for (let tick = 0; tick < 7200; tick++) e.step(1 / 60);
  const checkpoint = JSON.stringify(e.snapshotGame());
  for (let tick = 0; tick < 4800; tick++) e.step(1 / 60);
  const expected = snapshot(e);
  e.commitLoad(e.prepareLoad(checkpoint));
  for (let tick = 0; tick < 4800; tick++) e.step(1 / 60);
  assert.deepEqual(snapshot(e), expected);
});

test('the pantry milestone distinguishes initial stock from prepared food production', () => {
  const e = colony();
  const bakery = e.newBuilding('bakery', 51, 48);
  bakery.done = true;
  bakery.prog = 1;
  e.buildings.push(bakery);
  e.step(1 / 60);
  assert.equal(e.state.milestones.includes(3), false);
  bakery.metrics.produced.bread = 3;
  e.step(1 / 60);
  assert.equal(e.state.milestones.includes(3), true);
  e.buildings[0].stock.bread = 20;
  e.claimContract(1);
  assert.equal(e.buildings[0].stock.bread, 8);
  assert.equal(e.state.contracts.includes(1), true);
});

test('cancelled soldiers are excluded from a saved population', () => {
  const e = colony();
  e.units.push({ id: e.nextId++, kind: 'soldier', dead: true, phase: 'idle', job: null });
  assert.equal(e.snapshotGame().u.length, 8);
  assert.doesNotThrow(() => e.prepareLoad(JSON.stringify(e.snapshotGame())));
});

test('legacy saves migrate defaults without losing the colony', () => {
  const e = colony();
  const legacy = snapshot(e);
  legacy.v = 1;
  delete legacy.rng;
  delete legacy.st.upgrades;
  delete legacy.st.contracts;
  delete legacy.p.treeGrowthT;
  const prepared = e.prepareLoad(JSON.stringify(legacy));
  e.commitLoad(prepared);
  assert.equal(e.buildings.length, 1);
  assert.equal(e.units.length, 8);
  assert.deepEqual({ ...e.state.upgrades }, { haul: 0, production: 0 });
  assert.equal(e.treeGrowthT, 0);
});

test('advisor distinguishes missing supply from transport delays and historical waits', () => {
  const e = colony();
  const lumber = e.newBuilding('lumberjack', 51, 48);
  lumber.done = true;
  e.buildings.push(lumber);
  const mill = e.newBuilding('sawmill', 46, 50);
  mill.done = true;
  e.buildings.push(mill);
  mill.metrics.elapsed = 120;
  mill.metrics.inputBlocked = 90;
  e.state.milestones = [0, 1];
  assert.equal(
    e.advisorDecision().action.bt,
    'forester',
    'restore timber before recommending roads',
  );
  const forester = e.newBuilding('forester', 53, 49);
  forester.done = true;
  e.buildings.push(forester);
  assert.equal(e.advisorDecision().shortage, true);
  assert.equal(e.advisorDecision().missing, 'logs');
  e.buildings[0].stock.logs = 4;
  assert.equal(e.advisorDecision().shortage, false, 'available stock can justify haul advice');
  e.buildings[2].stock.logs = 2;
  assert.equal(
    e.advisorDecision().bottleneck,
    undefined,
    'a recovered mill is not a current bottleneck',
  );
  e.buildings[2].stock.logs = 0;
  e.buildings[2].blockedReason = 'output';
  assert.equal(
    e.advisorDecision().bottleneck,
    undefined,
    'a full output store needs no input warning',
  );
  e.buildings[2].blockedReason = 'reserve';
  assert.equal(e.advisorDecision().bottleneck, undefined, 'a met reserve needs no input warning');
  e.buildings[2].blockedReason = '';
  e.buildings[2].disabled = true;
  assert.equal(e.advisorDecision().bottleneck, undefined, 'manual pauses need no delivery warning');
});

test('imported extra state keys cannot alter prototypes and messages remain text', () => {
  const e = colony();
  const data = snapshot(e);
  data.st = JSON.parse(
    JSON.stringify(data.st).replace(/}$/, ',"__proto__":{"foreign":true},"unknown":123}'),
  );
  data.st.upgrades.extra = 9;
  e.commitLoad(e.prepareLoad(JSON.stringify(data)));
  assert.equal(e.state.foreign, undefined);
  assert.equal(e.state.unknown, undefined);
  assert.equal(e.state.upgrades.extra, undefined);
  assert.equal(e.escapeMarkup('<img src="x">&'), '&lt;img src=&quot;x&quot;&gt;&amp;');
});

test('requested reserves guide missing tool and weapon supply chains', () => {
  const e = colony();
  for (const type of [
    'lumberjack',
    'sawmill',
    'forester',
    'quarry',
    'farm',
    'windmill',
    'well',
    'bakery',
  ]) {
    const b = e.newBuilding(type, 51 + e.buildings.length, 48);
    b.done = true;
    e.buildings.push(b);
  }
  e.buildings[0].targets = { tools: 30, weapons: 20 };
  e.state.milestones = [0, 1, 2, 3, 4, 5];
  const targets = e
    .advTargets()
    .filter((r) => r.def > 0)
    .map((r) => r.bt);
  assert.equal(targets.includes('workshop'), true);
  assert.equal(targets.includes('toolsmith'), false);
  assert.equal(targets.includes('mine_iron'), true);
  assert.equal(targets.includes('mine_coal'), true);
  for (const type of ['mine_iron', 'mine_coal', 'smelter']) {
    const b = e.newBuilding(type, 48, 51);
    b.done = true;
    e.buildings.push(b);
  }
  assert.ok(e.advTargets().some((r) => r.bt === 'toolsmith' && r.def > 0));
});

test('advisor waits for an existing outpost to finish expanding the border', () => {
  const e = colony();
  e.tiles = Array.from({ length: e.W * e.H }, () => ({
    t: e.GRASS,
    tree: 0,
    rock: null,
    res: null,
    road: false,
  }));
  for (const type of [
    'lumberjack',
    'sawmill',
    'quarry',
    'farm',
    'forester',
    'workshop',
    'windmill',
    'well',
    'bakery',
    'brewery',
    'farm',
    'farm',
  ]) {
    const b = e.newBuilding(type, 45 + e.buildings.length, 45);
    b.done = true;
    e.buildings.push(b);
  }
  e.tiles[e.idx(62, 48)] = {
    t: e.MTN,
    tree: 0,
    rock: null,
    res: { kind: 'gold', amt: 240, amt0: 240 },
    road: false,
  };
  e.recomputeTerritory();
  e.state.milestones = [0, 1, 2, 3];
  e.placeBuilding('guard', 56, 48);
  const guard = e.buildings.at(-1);
  assert.equal(guard.type, 'guard');
  assert.equal(e.advisorDecision().waiting.id, guard.id);
  assert.equal(e.advTargets().find((r) => r.bt === 'guard').def, 0);
  guard.done = true;
  assert.equal(e.advisorDecision().waiting.id, guard.id, 'wait for the garrison too');
  guard.man = true;
  e.recomputeTerritory();
  e.gameTick();
  assert.equal(e.advisorDecision().waiting, undefined);
  assert.equal(e.advisorDecision().action.bt, 'mine_gold');
});

test('imported job, settler, and building extras cannot introduce inherited game fields', () => {
  const e = colony();
  e.buildings.push(e.newBuilding('sawmill', 46, 50));
  const data = snapshot(e);
  data.j.push({ kind: 'fetch', good: 'planks', s: data.b[0].id, to: data.b[1].id, state: 'p' });
  data.b[0].res.planks = 1;
  for (const entity of [data.j[0], data.u[0], data.b[0]]) {
    Object.defineProperty(entity, '__proto__', {
      value: { foreign: true, d: 999 },
      enumerable: true,
    });
    entity.unknown = 123;
  }
  const prepared = e.prepareLoad(JSON.stringify(data));
  for (const entity of [prepared.jobs[0], prepared.units[0], prepared.buildings[0]]) {
    assert.equal(entity.foreign, undefined);
    assert.equal(entity.d, undefined);
    assert.equal(entity.unknown, undefined);
    assert.equal(Object.hasOwn(entity, '__proto__'), false);
  }
  e.commitLoad(prepared);
  assert.doesNotThrow(() => e.prepareLoad(JSON.stringify(e.snapshotGame())));
});

test('contracts cannot be redeemed twice and upgrades spend actual unreserved gold', () => {
  const e = colony();
  e.buildings[0].stock.gold = 100;
  e.state.gold = 100;
  e.claimContract(0);
  assert.equal(e.state.gold, 105);
  assert.equal(e.buildings[0].stock.planks, 36);
  assert.equal(e.buildings[0].stock.tools, 20);
  e.claimContract(0);
  assert.equal(e.state.gold, 105);
  e.buyUpgrade('haul');
  e.buyUpgrade('haul');
  e.buyUpgrade('haul');
  e.buyUpgrade('haul');
  assert.equal(e.state.upgrades.haul, 3);
  assert.equal(e.state.spentGold, 90);
  assert.equal(e.state.gold, 15);
  assert.equal(e.buildings[0].stock.gold, 15);
  e.buildings[0].res.gold = 15;
  e.buyUpgrade('production');
  assert.equal(e.state.upgrades.production, 0);
});

test('contracts reclaim uncollected stock transfers without spending reserved construction goods', () => {
  const e = colony();
  e.buildings[0].stock.planks = 12;
  const warehouse = e.newBuilding('warehouse', 54, 48);
  warehouse.done = true;
  warehouse.targets.planks = 12;
  e.buildings.push(warehouse);
  e.recomputeTerritory();
  for (let q = 0; q < 6; q++) e.ensureJobs();
  assert.equal(e.buildings[0].res.planks, 12);
  e.claimContract(0);
  assert.equal(e.state.contracts.includes(0), true);
  assert.equal(e.buildings[0].stock.planks, 0);
  assert.equal(e.buildings[0].res.planks, 0);
  assert.equal(e.state.gold, 5);
  assert.doesNotThrow(() => e.prepareLoad(JSON.stringify(e.snapshotGame())));
});

test('event bus subscriptions can be removed independently', () => {
  const bus = createEventBus();
  let calls = 0;
  const off = bus.on('produced', (v) => (calls += v));
  bus.emit('produced', 2);
  off();
  bus.emit('produced', 3);
  assert.equal(calls, 2);
});

test('old version-one and version-two saves begin honest recent and delivery coverage', () => {
  for (const version of [1, 2]) {
    const e = colony();
    const mill = e.newBuilding('sawmill', 46, 50);
    mill.done = true;
    mill.prog = 1;
    e.buildings.push(mill);
    mill.metrics.elapsed = 240;
    mill.metrics.active = 240;
    mill.metrics.produced.planks = 24;
    mill.metrics.consumed.logs = 48;
    mill.metrics.delivered.logs = 99;
    e.state.time = 240;
    const legacy = snapshot(e);
    legacy.v = version;
    if (version === 1) delete legacy.rng;
    for (const b of legacy.b)
      for (const key of ['recent', 'deliveryStarted', 'inputDelivered', 'outputDelivered'])
        delete b.metrics[key];
    e.commitLoad(e.prepareLoad(JSON.stringify(legacy)));
    const metrics = e.buildings[1].metrics;
    assert.equal(metrics.elapsed, 240);
    assert.equal(metrics.produced.planks, 24);
    assert.equal(metrics.consumed.logs, 48);
    assert.equal(metrics.delivered.logs, 99);
    assert.equal(metrics.deliveryStarted, 240);
    assert.deepEqual({ ...metrics.inputDelivered }, {});
    assert.equal(metrics.recent.length, 1);
    assert.equal(metrics.recent[0].elapsed, 240);
    assert.equal(e.productionWindow(e.buildings[1].metrics, 30).elapsed, 0);
    assert.equal(e.productionWindow(e.buildings[1].metrics, 120).elapsed, 0);
    assert.equal(e.productionWindow(e.buildings[1].metrics, 'lifetime').deliveryElapsed, 0);
    for (let tick = 0; tick < 20 * 60; tick++) {
      e.buildings[1].stock.logs = 4;
      e.buildings[1].stock.planks = 0;
      e.step(1 / 60);
    }
    assert.ok(e.productionWindow(e.buildings[1].metrics, 30).elapsed > 19.9);
    assert.ok(e.productionWindow(e.buildings[1].metrics, 30).produced.planks > 0);
    assert.ok(metrics.produced.planks > 24);
    assert.ok(
      Math.abs(e.productionWindow(e.buildings[1].metrics, 'lifetime').deliveryElapsed - 20) < 1e-8,
    );
  }
});

test('invalid or unbounded persisted production history is rejected before load', () => {
  const e = colony();
  const checkpoint = snapshot(e);
  const corruptions = [
    (m) => {
      m.recent = Array.from({ length: 302 }, () => m.recent[0]);
    },
    (m) => {
      m.recent[0].elapsed = -1;
    },
    (m) => {
      m.recent[0].elapsed = 1;
    },
    (m) => {
      m.recent[0].produced = { planks: 1 };
    },
    (m) => {
      m.recent[0].inputDelivered = { foreign: 1 };
    },
    (m) => {
      m.deliveryStarted = 1;
    },
    (m) => {
      m.recent.push(structuredClone(m.recent[0]));
    },
    (m) => {
      m.elapsed = 601;
    },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(checkpoint);
    corrupt(broken.b[0].metrics);
    assert.throws(() => e.prepareLoad(JSON.stringify(broken)), /production|quantity/);
    assert.deepEqual(snapshot(e), checkpoint);
  }
});
