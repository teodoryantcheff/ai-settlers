'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  fakeElement,
  fakeWindow,
  installGlobals,
  pinClock,
  DEFAULT_MODULES,
} = require('./helpers/game.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

function renderer() {
  const calls = [];
  const noop = () => {};
  const context = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop: noop });
        return (...args) => calls.push({ method: key, args });
      },
    },
  );
  const canvas = (width = 1, height = 1) => ({
    width,
    height,
    getContext: () => context,
    style: {},
  });
  // HUD and renderer look elements up by id; every element doubles as a canvas
  // whose 2d context is the same recording double.
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) {
      const node = fakeElement(id);
      node.width = 1;
      node.height = 1;
      node.getContext = () => context;
      nodes.set(id, node);
    }
    return nodes.get(id);
  };
  const document = {
    visibilityState: 'visible',
    activeElement: null,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    getElementById: element,
    createElement: () => fakeElement(),
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const { window } = fakeWindow({ matchMedia: () => ({ matches: false }) });
  installGlobals({ document, window });
  const { game: e } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'landscape', 'village', 'renderer', 'hud'],
    presentation: { available: true, invalidate: noop, begin: noop, layer: noop, end: noop },
    stubs: {
      Acan: canvas,
      rr: noop,
      rgba: (color, alpha) => color + ':' + alpha,
      ART: {
        grass: ['g0', 'g1', 'g2', 'g3'],
      },
      presentationPrefs: {
        reducedMotion: false,
        weather: true,
        clarity: false,
        quality: 1,
        overlay: 'none',
      },
      refreshGhost: noop,
      rebuildHighlights: noop,
      gameEvents: { on: noop, emit: noop, off: noop },
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
    },
  });
  e.tiles = Array.from({ length: e.W * e.H }, () => ({
    t: e.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  e.owned.fill(1);
  const hq = e.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.constructionProgress = 1;
  e.buildings.push(hq);
  e.state.paused = true;
  e.state.upgrades = { haul: 0, production: 0 };
  e.mode = { type: 'build', bt: 'sawmill' };
  e.ghost = { x: 52, y: 48, ok: true, in: true };
  e.calls = calls;
  e.context = context;
  return e;
}

test('walkers follow the last segment after turning, including zero direction components', () => {
  const e = renderer();
  const dirs = {};
  for (const dir of ['n', 's', 'e', 'w'])
    dirs[dir] = { idle: dir + '-idle', walk: Array.from({ length: 4 }, (_, i) => dir + i) };
  e.ART.unitDirections = { carrier: dirs };
  e.ART.shadowSoft = 'shadow';
  e.state.paused = false;
  e.unitPoses[7] = { x: 49, y: 48, distance: 0, dir: 's' };
  e.drawUnit(
    e.context,
    {
      id: 7,
      kind: 'carrier',
      x: 51,
      y: 51,
      faceDX: 1,
      faceDY: 0,
      walkDistance: 1,
      path: [e.idx(52, 51)],
      pi: 0,
    },
    100,
  );
  assert.equal(e.unitPoses[7].dir, 'e');
  assert.equal(e.calls.filter((call) => call.method === 'drawImage')[1].args[0], 'e0');
  e.unitPoses[8] = { x: 48, y: 49, distance: 0, dir: 'e' };
  e.drawUnit(
    e.context,
    {
      id: 8,
      kind: 'carrier',
      x: 51,
      y: 51,
      faceDX: 0,
      faceDY: -1,
      walkDistance: 1,
      path: [e.idx(51, 50)],
      pi: 0,
    },
    100,
  );
  assert.equal(e.unitPoses[8].dir, 'n');
});

test('diagonal walkers use all eight headings and recognizable cargo without changing a unit', () => {
  const e = renderer();
  const headings = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  e.ART.unitDirections = {
    carrier: Object.fromEntries(
      headings.map((dir) => [
        dir,
        {
          idle: dir + '-idle',
          walk: Array.from({ length: 8 }, (_, i) => dir + i),
        },
      ]),
    ),
  };
  e.ART.cargo = { logs: 'timber-bundle' };
  e.ART.shadowSoft = 'shadow';
  e.state.paused = false;
  const vectors = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  for (let i = 0; i < vectors.length; i++) {
    const u = {
      id: 20 + i,
      kind: 'carrier',
      x: 51,
      y: 51,
      faceDX: vectors[i][0],
      faceDY: vectors[i][1],
      walkDistance: 1,
      carry: 'logs',
      path: [e.idx(52, 52)],
      pi: 0,
    };
    const before = JSON.stringify(u);
    e.calls.length = 0;
    e.drawUnit(e.context, u, 100);
    assert.equal(e.unitPoses[u.id].dir, headings[i]);
    const sprites = e.calls.filter((c) => c.method === 'drawImage').map((c) => c.args[0]);
    assert.deepEqual(sprites, ['shadow', headings[i] + '4', 'timber-bundle']);
    assert.equal(JSON.stringify(u), before);
  }
});

test('pause and Reduced Motion keep eight-direction settlers in their resting pose with cargo visible', () => {
  const e = renderer();
  e.ART.unitDirections = {
    carrier: { nw: { idle: 'nw-idle', walk: Array.from({ length: 8 }, (_, i) => 'nw' + i) } },
  };
  e.ART.cargo = { food: 'grain-sack' };
  e.ART.shadowSoft = 'shadow';
  const u = {
    id: 40,
    kind: 'carrier',
    x: 51,
    y: 51,
    faceDX: -1,
    faceDY: -1,
    walkDistance: 1.5,
    carry: 'food',
    path: [e.idx(50, 50)],
    pi: 0,
  };
  for (const paused of [true, false]) {
    e.state.paused = paused;
    e.presentationPrefs.reducedMotion = !paused;
    e.calls.length = 0;
    e.drawUnit(e.context, u, 100);
    assert.deepEqual(
      e.calls.filter((c) => c.method === 'drawImage').map((c) => c.args[0]),
      ['shadow', 'nw-idle', 'grain-sack'],
    );
    assert.equal(e.calls.find((c) => c.method === 'translate').args[1], u.y * e.TS - 1);
  }
});

test('placement estimates refresh for paused haul upgrades and terrain edits', () => {
  const e = renderer();
  const initial = e.getPlacementPreview();
  e.state.upgrades.haul = 1;
  const upgraded = e.getPlacementPreview();
  assert.ok(upgraded.haulSeconds < initial.haulSeconds);
  for (let x = 49; x <= 52; x++) {
    const i = e.idx(x, 48);
    e.tiles[i].road = true;
    e.drawTile(e.context, i);
  }
  const paved = e.getPlacementPreview();
  assert.ok(paved.haulSeconds < upgraded.haulSeconds);
  assert.equal(e.state.time, 0);
});

test('placement estimates use a newly completed nearer warehouse without adding a building', () => {
  const e = renderer();
  const store = e.newBuilding('warehouse', 51, 48);
  e.buildings.push(store);
  const initial = e.getPlacementPreview();
  store.done = true;
  const completed = e.getPlacementPreview();
  assert.equal(completed.storage.id, store.id);
  assert.ok(completed.haulSeconds < initial.haulSeconds);
});

test('a paused resource preview drops trees cleared for another construction site', () => {
  const e = renderer();
  e.mode.bt = 'lumberjack';
  const tree = e.idx(54, 48);
  e.tiles[tree].tree = 4;
  assert.equal(e.getPlacementPreview().resources.includes(tree), true);
  e.tiles[tree].tree = 0;
  e.drawTile(e.context, tree);
  assert.equal(e.getPlacementPreview().resources.includes(tree), false);
});

test('road estimates update immediately when tiles are paved within the same frame bucket', () => {
  const e = renderer();
  e.mode = { type: 'road' };
  e.anchor = { x: 50, y: 50 };
  e.ht = { x: 54, y: 50 };
  e.hoverIn = true;
  const before = e.getRoadPreview();
  assert.equal(before.count, 5);
  assert.equal(e.getRoadPreview(), before, 'unchanged frames reuse the cached preview');
  for (const i of [e.idx(50, 50), ...before.path]) {
    e.tiles[i].road = true;
    e.drawTile(e.context, i);
  }
  const after = e.getRoadPreview();
  assert.equal(after.count, 0);
  assert.ok(after.beforeSeconds < before.beforeSeconds);
});

test('road previews display rejection labels without a route or travel estimates', () => {
  const e = renderer();
  e.mode = { type: 'road' };
  e.anchor = { x: 48, y: 48 }; // Headquarters blocks the start.
  e.ht = { x: 54, y: 50 };
  e.hoverIn = true;
  const blocked = e.getRoadPreview();
  assert.match(blocked.summary, /start on clear ground inside your territory/);
  const endpoint = e.idx(e.ht.x, e.ht.y);
  e.tiles[endpoint].t = e.WATER;
  e.drawTile(e.context, endpoint);
  const unreachable = e.getRoadPreview();
  assert.equal(unreachable.summary, 'No route here');
  for (const preview of [blocked, unreachable]) {
    assert.equal(preview.path, null);
    assert.equal(preview.count, 0);
    assert.deepEqual(preview.paved, {});
    assert.equal(preview.beforeSeconds, 0);
    assert.equal(preview.afterSeconds, 0);
  }
});

test('Reduced Motion keeps minimap attention markers steady', () => {
  const e = renderer();
  e.presentationPrefs.reducedMotion = true;
  e.bStatus = () => ({ bad: true });
  e.miniDirty = false;
  e.NOW = 300;
  e.drawMini();
  const first = e.calls.filter((call) => call.method === 'arc').at(-1).args;
  e.NOW = 1500;
  e.drawMini();
  const second = e.calls.filter((call) => call.method === 'arc').at(-1).args;
  assert.deepEqual(second, first);
  e.presentationPrefs.reducedMotion = false;
  e.NOW = 2600;
  e.drawMini();
  const animated = e.calls.filter((call) => call.method === 'arc').at(-1).args;
  assert.notDeepEqual(animated, second);
});

test('meadow particles are bounded, reproducible, and independent of simulation randomness', (t) => {
  const realRandom = Math.random;
  t.after(() => {
    Math.random = realRandom;
  });
  const e = renderer();
  e.vw = 6000;
  e.vh = 6000;
  e.z = 0.55;
  e.state.paused = false;
  Math.random = () => {
    throw new Error('particle RNG');
  };
  e.calls.length = 0;
  e.meadowParticles(e.context, 2300);
  const particles = e.calls.filter((call) => call.method === 'arc');
  assert.ok(particles.length > 0);
  assert.ok(particles.length <= 56);
  assert.ok(e.atmosphereCount >= particles.length && e.atmosphereCount <= 59);
  e.calls.length = 0;
  e.meadowParticles(e.context, 2300);
  assert.deepEqual(
    e.calls.filter((call) => call.method === 'arc'),
    particles,
  );
  e.presentationPrefs.quality = 0.75;
  e.calls.length = 0;
  e.meadowParticles(e.context, 2300);
  assert.ok(e.calls.filter((call) => call.method === 'arc').length <= 20);
});

test('Reduced Motion disables cosmetic particles and weather removes airborne meadow particles', () => {
  const e = renderer();
  e.vw = 1280;
  e.vh = 800;
  e.presentationPrefs.reducedMotion = true;
  e.calls.length = 0;
  e.meadowParticles(e.context, 2300);
  e.drawSmoke(e.context, 20, 30, 2300, 7);
  e.FX.dust(10, 10);
  assert.equal(e.calls.length, 0);
  assert.equal(e.FXL.length, 0);
  assert.equal(e.atmosphereCount, 0);
  e.presentationPrefs.reducedMotion = false;
  e._rain = 0.8;
  e.meadowParticles(e.context, 2300);
  assert.equal(e.calls.length, 0);
});

test('burst effects stay capped at low quality and offscreen effects still expire', () => {
  const e = renderer();
  e.vw = 1280;
  e.vh = 800;
  e.presentationPrefs.quality = 0.75;
  for (let i = 0; i < 300; i++) e.FX.dust(80, 80);
  assert.equal(e.FXL.length, 48);
  e.calls.length = 0;
  e.fxDraw(e.context, 100);
  assert.equal(e.calls.length, 0);
  e.fxDraw(e.context, 800);
  assert.equal(e.FXL.length, 0);
});

test('settler dust is tied to new footsteps and does not repeat when the same pose is redrawn', () => {
  const e = renderer();
  e.ART.unitDirections = {
    carrier: { e: { idle: 'idle', walk: ['walk0', 'walk1', 'walk2', 'walk3'] } },
  };
  e.ART.shadowSoft = 'shadow';
  e.state.paused = false;
  const u = {
    id: 70,
    kind: 'carrier',
    x: 51,
    y: 51,
    faceDX: 1,
    faceDY: 0,
    walkDistance: 1,
    path: [e.idx(52, 51)],
    pi: 0,
  };
  e.drawUnit(e.context, u, 100);
  assert.equal(e.FXL.length, 0);
  u.x += 0.1;
  u.walkDistance = 1.6;
  e.drawUnit(e.context, u, 200);
  assert.equal(e.FXL.length, 1);
  assert.equal(e.FXL[0].k, 'stepDust');
  e.drawUnit(e.context, u, 210);
  assert.equal(e.FXL.length, 1);
  e.presentationPrefs.reducedMotion = true;
  u.x += 0.1;
  u.walkDistance = 2.2;
  e.drawUnit(e.context, u, 300);
  assert.equal(e.FXL.length, 1);
});

test('building contours are cached per artwork and view without changing sprite anchors', () => {
  const e = renderer();
  const image = { img: {}, w: 48, h: 56, ox: -12, oy: -32 };
  const original = { ...image };
  const standard = e.buildingContour(image);
  assert.equal(standard.width, 108);
  assert.equal(standard.height, 124);
  const calls = e.calls.length;
  assert.equal(e.buildingContour(image), standard);
  assert.equal(e.calls.length, calls);
  e.presentationPrefs.clarity = true;
  const clear = e.buildingContour(image);
  assert.notEqual(clear, standard);
  assert.equal(e.buildingContour(image), clear);
  e.presentationPrefs.clarity = false;
  assert.equal(e.buildingContour(image), standard);
  assert.deepEqual(image, original);
});

test('clarity leaves tree roots and sizes unchanged and suppresses competing particles', () => {
  const e = renderer();
  e.ART.tree = Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => ['tree', 'tree2']));
  e.drawTree(e.context, 48, 49, { tree: 4 }, 1000);
  const standard = e.calls.find((call) => call.method === 'drawImage').args;
  const rng = e.SR.getState();
  e.presentationPrefs.clarity = true;
  e.calls.length = 0;
  e.drawTree(e.context, 48, 49, { tree: 4 }, 1000);
  assert.deepEqual(e.calls.find((call) => call.method === 'drawImage').args, standard);
  e.calls.length = 0;
  e.drawSmoke(e.context, 10, 20, 1000, 7);
  e.meadowParticles(e.context, 1000);
  assert.equal(e.calls.length, 0);
  assert.equal(e.atmosphereCount, 0);
  assert.equal(e.SR.getState(), rng);
});

test('clarity uses distinct working, waiting, paused and construction symbols', () => {
  const e = renderer();
  e.vw = 1440;
  e.vh = 900;
  e.cam = { x: 40 * e.TS, y: 40 * e.TS };
  e.presentationPrefs.clarity = true;
  e.context.measureText = (text) => ({ width: text.length * 5 });
  for (const [offset, reason, done] of [
    [0, '', true],
    [2, 'inputs', true],
    [4, 'paused', true],
    [6, '', false],
  ]) {
    const b = e.newBuilding('sawmill', 48 + offset, 48);
    b.done = done;
    b.stock.logs = 4;
    b.blockedReason = reason;
    e.buildings.push(b);
  }
  e.clarityBuildings(e.context);
  const tags = e.calls.filter((call) => call.method === 'fillText').map((call) => call.args[0]);
  assert.deepEqual(tags, ['HQ ·', 'SAW ▶', 'SAW !', 'SAW Ⅱ', 'SAW +']);
});

test('a producer blocked by colony reserves is drawn idle before its next simulation tick', () => {
  const e = renderer();
  e.vw = 1440;
  e.vh = 900;
  e.cam = { x: 40 * e.TS, y: 40 * e.TS };
  e.presentationPrefs.clarity = true;
  e.context.measureText = (text) => ({ width: text.length * 5 });
  const mill = e.newBuilding('windmill', 50, 48);
  Object.assign(mill, { done: true, timer: 4, stock: { grain: 2 }, blockedReason: '' });
  e.buildings.push(mill);
  e.anyStorage().stock.flour = 12;
  const before = e.exportSave();
  const rng = e.SR.getState();
  assert.equal(e.productionProgress(mill).reason, 'demand');
  e.clarityBuildings(e.context);
  assert.deepEqual(
    e.calls.filter((call) => call.method === 'fillText').map((call) => call.args[0]),
    ['HQ ·', 'FLOUR ·'],
  );
  assert.equal(e.exportSave(), before, 'drawing idle cannot advance the colony');
  assert.equal(e.SR.getState(), rng);
});

test('a paused placement preview refreshes affordability immediately while unchanged frames reuse it', () => {
  const e = renderer();
  e.anyStorage().stock = { planks: 3, stone: 1, tools: 1 };
  const before = e.getPlacementPreview();
  assert.equal(before.canBuild, true);
  assert.equal(e.getPlacementPreview(), before);
  e.anyStorage().stock.planks = 2;
  const after = e.getPlacementPreview();
  assert.equal(after.checks.ok, true, 'the terrain remains suitable');
  assert.equal(after.canBuild, false, 'spending becomes unavailable without aging simulation time');
  assert.equal(after.spending.materials.find((row) => row.good === 'planks').available, 2);
});

test('night glow lights domestic windows but leaves mines and open yards dark', () => {
  const e = renderer();
  e.vw = 1440;
  e.vh = 900;
  e.cam = { x: 40 * e.TS, y: 40 * e.TS };
  e.ART.glow = 'glow';
  e.buildings.length = 0;
  const placed = {};
  for (const [type, offset] of [
    ['mine_coal', 0],
    ['mine_iron', 2],
    ['mine_gold', 4],
    ['well', 6],
    ['pigfarm', 8],
    ['quarry', 10],
    ['sawmill', 12],
    ['warehouse', 14],
  ]) {
    const b = e.newBuilding(type, 44 + offset, 48);
    b.done = true;
    e.buildings.push(b);
    placed[type] = b;
  }
  const rng = e.SR.getState();
  e.calls.length = 0;
  e.glowsDraw(e.context);
  const lit = new Set(
    e.calls
      // The square window aura is centred over its building's tile.
      .filter((call) => call.method === 'drawImage' && call.args[0] === 'glow')
      .filter((call) => call.args[3] === call.args[4])
      .map((call) => Math.floor((call.args[1] + call.args[3] / 2) / e.TS)),
  );
  assert.deepEqual(
    [...lit].sort((a, b) => a - b),
    [placed.sawmill.x, placed.warehouse.x],
  );
  assert.equal(e.SR.getState(), rng, 'cosmetic glow consumes no simulation RNG');
});
