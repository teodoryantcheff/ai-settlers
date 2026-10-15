'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  fakeWindow,
  installGlobals,
  pinClock,
  DEFAULT_MODULES,
} = require('./helpers/game.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

function village() {
  const calls = [];
  const noop = () => {};
  let depth = 0;
  const context = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'save')
          return () => {
            depth++;
            calls.push({ method: 'save', args: [] });
          };
        if (key === 'restore')
          return () => {
            depth--;
            calls.push({ method: 'restore', args: [] });
          };
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop: noop });
        return (...args) => calls.push({ method: key, args });
      },
    },
  );
  const canvas = (width = 72, height = 72) => ({
    width,
    height,
    getContext: () => context,
    style: {},
  });
  const document = { getElementById: () => canvas() };
  const { window } = fakeWindow();
  installGlobals({ document, window });
  const { game: e } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'village', 'renderer'],
    presentation: { available: true, invalidate: noop, begin: noop, layer: noop, end: noop },
    stubs: {
      Acan: canvas,
      SS: 3,
      rr: noop,
      TESTMODE: false,
      presentationPrefs: { reducedMotion: false, weather: true, quality: 1, overlay: 'none' },
      bStatus: () => ({ bad: false }),
      foodSaturated: () => false,
      refreshGhost: noop,
      rebuildHighlights: noop,
      ART: { bld: {}, bld2: {}, anchors: {}, cargo: {}, blade: 'blade' },
    },
  });
  for (const type of Object.keys(e.BSPEC))
    e.ART.bld[type] = { img: canvas(108, 132), w: 36, h: 44, ox: -6, oy: -20 };
  for (const good of Object.keys(e.GOODS)) e.ART.cargo[good] = 'cargo:' + good;
  e.tiles = Array.from({ length: e.W * e.H }, () => ({
    t: e.GRASS,
    tree: 0,
    rock: null,
    res: null,
    road: false,
  }));
  e.context = context;
  e.calls = calls;
  e.depth = () => depth;
  return e;
}

test('displayed stockpiles follow physical stock rather than reservations or produced totals', () => {
  const e = village();
  const b = e.newBuilding('sawmill', 48, 48);
  b.done = true;
  b.produced = 200;
  b.stock = { logs: 2, planks: 8 };
  b.res = { planks: 8 };
  let plan = e.villageStockPlan(b);
  assert.deepEqual(
    Array.from(plan, (s) => [s.good, s.quantity]),
    [
      ['logs', 2],
      ['planks', 8],
    ],
  );
  b.stock.planks = 0;
  plan = e.villageStockPlan(b);
  assert.deepEqual(
    Array.from(plan, (s) => [s.good, s.quantity]),
    [['logs', 2]],
  );
  b.stock.logs = 0;
  assert.equal(e.villageStockPlan(b).length, 0);
});

test('construction piles show only delivered materials and warehouses have bounded displays', () => {
  const e = village();
  const b = e.newBuilding('armory', 48, 48);
  b.got = { planks: 1, tools: 1 };
  assert.deepEqual(
    Array.from(e.villageStockPlan(b), (s) => [s.good, s.quantity]),
    [
      ['planks', 1],
      ['tools', 1],
    ],
  );
  const hq = e.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.stock = Object.fromEntries(Object.keys(e.GOODS).map((good) => [good, 1000]));
  assert.equal(e.villageStockPlan(hq).length, 2);
  e.calls.length = 0;
  e.drawVillageStock(e.context, hq);
  assert.equal(e.calls.filter((c) => c.method === 'drawImage').length, 8);
});

test('construction uses whole foundation, frame, wall and roof stages with bounded cached canvases', () => {
  const e = village();
  const b = e.newBuilding('warehouse', 48, 48);
  const images = [];
  for (const progress of [0, 0.25, 0.55, 0.85]) {
    e.calls.length = 0;
    e.drawVillageConstruction(e.context, b, progress);
    const draws = e.calls.filter((c) => c.method === 'drawImage');
    assert.ok(
      draws.every((c) => c.args.length === 5),
      'stages never crop the finished sprite vertically',
    );
    images.push(draws[1].args[0]);
  }
  assert.equal(new Set(images).size, 4);
  assert.equal(images[3], e.ART.bld.warehouse.img);
  for (let progress = 0; progress < 0.74; progress += 0.001)
    e.drawVillageConstruction(e.context, b, progress);
  assert.equal(Object.keys(e.villageSites).length, 3);
});

test('work motion advances gently at 8x and freezes through pause and Reduced Motion', () => {
  const e = village();
  const b = e.newBuilding('quarry', 48, 48);
  e.state.paused = false;
  e.state.speed = 8;
  e.NOW = 100;
  assert.equal(e.villageWorkTime(b), 0);
  e.NOW = 116;
  e.state.time = 8;
  assert.equal(e.villageWorkTime(b), 16);
  e.NOW = 1116;
  assert.equal(e.villageWorkTime(b), 66);
  e.state.paused = true;
  e.NOW = 2116;
  assert.equal(e.villageWorkTime(b), 66);
  e.state.paused = false;
  e.NOW = 2132;
  assert.equal(e.villageWorkTime(b), 82);
  e.presentationPrefs.reducedMotion = true;
  e.NOW = 2148;
  assert.equal(e.villageWorkTime(b), 0);
  e.calls.length = 0;
  e.drawVillageWorkEffects(e.context, b, 'rock', 100);
  assert.equal(e.calls.length, 0);
});

test('pausing or blocking a farm preserves the actual crop stage', () => {
  const e = village();
  const farm = e.newBuilding('farm', 48, 48);
  farm.done = true;
  farm.timer = 12;
  e.drawVillageDetails(e.context, farm);
  const growing = e.calls.filter((call) => call.method === 'drawImage').at(-1).args[0];
  farm.disabled = true;
  e.calls.length = 0;
  e.drawVillageDetails(e.context, farm);
  assert.equal(e.calls.filter((call) => call.method === 'drawImage').at(-1).args[0], growing);
  farm.disabled = false;
  farm.blockedReason = 'demand';
  e.calls.length = 0;
  e.drawVillageDetails(e.context, farm);
  assert.equal(e.calls.filter((call) => call.method === 'drawImage').at(-1).args[0], growing);
  farm.timer = 4;
  e.calls.length = 0;
  e.drawVillageDetails(e.context, farm);
  assert.notEqual(e.calls.filter((call) => call.method === 'drawImage').at(-1).args[0], growing);
});

test('test-scenario work poses depend on simulation time rather than screenshot delays', () => {
  const e = village();
  const b = e.newBuilding('sawmill', 48, 48);
  e.TESTMODE = true;
  e.state.paused = false;
  e.state.time = 12;
  e.NOW = 100;
  const pose = e.villageWorkTime(b);
  e.NOW = 8000;
  assert.equal(e.villageWorkTime(b), pose);
  e.state.paused = true;
  e.NOW = 15000;
  assert.equal(e.villageWorkTime(b), pose);
  e.state.paused = false;
  e.state.time = 12.5;
  assert.notEqual(e.villageWorkTime(b), pose);
  e.presentationPrefs.reducedMotion = true;
  assert.equal(e.villageWorkTime(b), 0);
});

test('building presentation preserves simulation data and balances canvas transforms for sites and every type', () => {
  const e = village();
  for (const type of Object.keys(e.BSPEC)) {
    const b = e.newBuilding(type, 48, 48);
    const before = JSON.stringify(b);
    e.drawBuilding(e.context, b);
    assert.equal(e.depth(), 0, type + ' site returns with its transform restored');
    assert.equal(JSON.stringify(b), before);
    b.done = true;
    b.got = Object.assign({}, b.needs);
    b.stock = { logs: 8, planks: 8, stone: 8, food: 8, iron: 8, coal: 8, tools: 8, weapons: 8 };
    const completed = JSON.stringify(b);
    e.drawBuilding(e.context, b);
    assert.equal(e.depth(), 0, type + ' finished returns with its transform restored');
    assert.equal(JSON.stringify(b), completed);
  }
  assert.equal(e.FXL.length, 0);
  assert.equal(e.state.time, 0);
});

test('painted construction frames use the installed site entrance anchor', () => {
  const e = village();
  const b = e.newBuilding('warehouse', 48, 48);
  const image = { painted: true };
  e.ART.paintedStatus = { state: 'loaded' };
  e.ART.site = { img: image, w: 34, h: 38, ox: -5, oy: -14 };
  e.drawVillageConstruction(e.context, b, 0.25);
  const draw = e.calls.find((call) => call.method === 'drawImage' && call.args[0] === image);
  assert.ok(draw);
  assert.deepEqual(draw.args, [image, 48 * 24 - 5, 48 * 24 - 14, 34, 38]);
  assert.equal(e.villageConstructionStage(0.55), 2);
});

test('workplace furnishings stay cached, keep the ground anchor and need no stock', () => {
  const e = village();
  const images = new Set();
  for (const type of Object.keys(e.BSPEC)) {
    const b = e.newBuilding(type, 48, 48);
    b.done = true;
    b.stock = {};
    const before = JSON.stringify(b);
    e.calls.length = 0;
    e.drawVillageDetails(e.context, b);
    const furnishing = e.calls.find((call) => call.method === 'drawImage');
    assert.ok(furnishing, type + ' has a furnished workplace even with empty inventory');
    assert.deepEqual(furnishing.args.slice(1), [48 * 24 - 6, 48 * 24 - 4, 36, 32]);
    images.add(furnishing.args[0]);
    e.calls.length = 0;
    e.drawVillageDetails(e.context, b);
    assert.equal(e.calls.find((call) => call.method === 'drawImage').args[0], furnishing.args[0]);
    assert.equal(JSON.stringify(b), before);
    assert.equal(e.calls.filter((call) => call.method === 'createLinearGradient').length, 0);
    assert.equal(e.calls.filter((call) => call.method === 'translate').length, 0);
  }
  assert.equal(images.size, Object.keys(e.BSPEC).length);
});
