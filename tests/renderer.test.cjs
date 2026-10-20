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
  fakeStorage,
  recordingScene,
} = require('./helpers/game.cjs');
const { requireCanvas2D } = require('../src/rendering/canvas-context.ts');
const { paintUtilityArtwork } = require('../src/ui/utility-art.ts');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

function renderer(options = {}) {
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
    getContext: () => (options.contextFor ? options.contextFor('cache', context) : context),
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
      node.getContext = () => (options.contextFor ? options.contextFor(id, context) : context);
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
    modules: [
      ...DEFAULT_MODULES,
      'landscape',
      'village',
      'renderer',
      'hud',
      ...(options.modules ?? []),
    ],
    storage: options.storage,
    presentation: options.presentation ?? {
      available: true,
      invalidate: noop,
      begin: noop,
      layer: noop,
      end: noop,
    },
    stubs: {
      Acan: canvas,
      rgba: (color, alpha) => color + ':' + alpha,
      ART: {
        paintedTerrain: { image: { width: 384, height: 384 }, worldSize: 384 },
        paintedMountains: { dry: [], snowy: [], foothill: { width: 120, height: 60 } },
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
  // Native painters record into the same call log as the offscreen canvases.
  e.scene = recordingScene(calls);
  return e;
}

test('missing cached-art contexts report a graphics failure before drawing', () => {
  const { localStorage, storage } = fakeStorage();
  const e = renderer({ modules: ['workspace', 'recovery'], storage: localStorage });
  e.saveCheckpoint('Before graphics failure');
  const saved = [...storage];
  const before = JSON.parse(e.exportSave());
  const buildings = e.buildings;
  const units = e.units;
  e.state.paused = false;
  const failures = [];
  e.gameEvents.on('rendererFailed', (event) => failures.push(event.reason));
  e.Acan = () => ({ getContext: () => null });
  const rng = e.SR.getState();
  const time = e.state.time;
  assert.throws(
    () => e.buildingContour({ img: {}, w: 48, h: 56, ox: -12, oy: -32 }),
    /Canvas 2D context is unavailable/,
  );
  assert.deepEqual(failures, ['Canvas 2D context is unavailable']);
  assert.equal(e.renderingAvailable, false);
  assert.equal(e.SR.getState(), rng);
  assert.equal(e.state.time, time);
  assert.equal(e.state.paused, true);
  assert.equal(e.buildings, buildings);
  assert.equal(e.units, units);
  const after = JSON.parse(e.exportSave());
  for (const key of ['b', 'u', 'j', 't', 'rng', 'observations', 'identity'])
    assert.deepEqual(after[key], before[key]);
  assert.deepEqual([...storage], saved);
  assert.equal(e.blockingLayerOpen(), true);
  assert.match(
    document.getElementById('recovery-reason').textContent,
    /Canvas 2D context is unavailable/,
  );
});

test('an unavailable minimap context stops renderer assembly through its failure boundary', () => {
  const failures = [];
  assert.throws(
    () =>
      renderer({
        contextFor: (name, context) => (name === 'mini' ? null : context),
        presentation: { reportFailure: (reason) => failures.push(reason) },
      }),
    /Canvas 2D context is unavailable/,
  );
  assert.deepEqual(failures, ['Canvas 2D context is unavailable']);
});

test('a throwing context acquisition retains its cause and opens graphics recovery', () => {
  const e = renderer({ modules: ['workspace', 'recovery'] });
  const cause = new Error('Canvas allocation rejected');
  e.Acan = () => ({
    getContext() {
      throw cause;
    },
  });
  assert.throws(
    () => e.buildingContour({ img: {}, w: 48, h: 56, ox: -12, oy: -32 }),
    (error) => error.cause === cause && /Canvas 2D context is unavailable/.test(error.message),
  );
  assert.equal(e.renderingAvailable, false);
  assert.equal(e.blockingLayerOpen(), true);
});

test('successful context acquisition preserves the context and requested options', () => {
  const e = renderer();
  const requests = [];
  const settings = { willReadFrequently: true };
  const canvas = {
    getContext(...args) {
      requests.push(args);
      return e.context;
    },
  };
  assert.equal(requireCanvas2D(canvas, e.reportGraphicsFailure, settings), e.context);
  assert.deepEqual(requests, [['2d', settings]]);
  assert.equal(e.renderingAvailable, true);
});

test('utility artwork cannot silently skip an unavailable context', () => {
  const e = renderer({ modules: ['workspace', 'recovery'] });
  document.querySelectorAll = () => [{ dataset: { sessionArt: 'hq' }, getContext: () => null }];
  assert.throws(() => paintUtilityArtwork(e), /Canvas 2D context is unavailable/);
  assert.equal(e.renderingAvailable, false);
  assert.equal(e.blockingLayerOpen(), true);
});

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
    e.scene,
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
  assert.equal(e.calls.filter((call) => call.method === 'image')[1].args[0], 'e0');
  e.unitPoses[8] = { x: 48, y: 49, distance: 0, dir: 'e' };
  e.drawUnit(
    e.scene,
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
    e.drawUnit(e.scene, u, 100);
    assert.equal(e.unitPoses[u.id].dir, headings[i]);
    const sprites = e.calls.filter((c) => c.method === 'image').map((c) => c.args[0]);
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
    e.drawUnit(e.scene, u, 100);
    assert.deepEqual(
      e.calls.filter((c) => c.method === 'image').map((c) => c.args[0]),
      ['shadow', 'nw-idle', 'grain-sack'],
    );
    const sprite = e.calls.filter((c) => c.method === 'image')[1];
    assert.equal(sprite.args[2] + 18, u.y * e.TS - 1, 'the resting pose keeps the ground line');
  }
});

test('the map previews only the active tool at the hovered site', () => {
  const e = renderer();
  assert.equal(e.placementPreview(), e.previewPlacement('sawmill', e.ghost));
  e.ghost.in = false;
  assert.equal(e.placementPreview(), null);
  e.mode = { type: 'road' };
  e.anchor = { x: 50, y: 50 };
  e.ht = { x: 54, y: 50 };
  e.hoverIn = false;
  assert.equal(e.roadPreview(), null, 'no road preview while the pointer is off the map');
  e.hoverIn = true;
  assert.equal(e.roadPreview(), e.previewRoad(e.anchor, e.ht));
  assert.equal(e.guardPreview(), null, 'only the guard tool previews a border');
  e.mode = { type: 'build', bt: 'guard' };
  e.ghost = { x: 56, y: 48, ok: true, reason: null, in: true };
  const guard = e.guardPreview();
  assert.ok(guard);
  assert.deepEqual([guard.x, guard.y], [56, 48]);
  assert.equal(e.guardPreview(), guard, 'an unchanged world reuses the border');
  e.recomputeTerritory();
  assert.notEqual(e.guardPreview(), guard, 'a territory change recomputes the border');
  e.ghost.ok = false;
  assert.equal(e.guardPreview(), null, 'an invalid site previews no border');
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
  e.meadowParticles(e.scene, 2300);
  const particles = e.calls.filter((call) => call.method === 'circle');
  assert.ok(particles.length > 0);
  assert.ok(particles.length <= 56);
  assert.ok(e.atmosphereCount >= particles.length && e.atmosphereCount <= 59);
  e.calls.length = 0;
  e.meadowParticles(e.scene, 2300);
  assert.deepEqual(
    e.calls.filter((call) => call.method === 'circle'),
    particles,
  );
  e.presentationPrefs.quality = 0.75;
  e.calls.length = 0;
  e.meadowParticles(e.scene, 2300);
  assert.ok(e.calls.filter((call) => call.method === 'circle').length <= 20);
});

test('Reduced Motion disables cosmetic particles and weather removes airborne meadow particles', () => {
  const e = renderer();
  e.vw = 1280;
  e.vh = 800;
  e.presentationPrefs.reducedMotion = true;
  e.calls.length = 0;
  e.meadowParticles(e.scene, 2300);
  e.drawSmoke(e.scene, 20, 30, 2300, 7);
  e.FX.dust(10, 10);
  assert.equal(e.calls.length, 0);
  assert.equal(e.FXL.length, 0);
  assert.equal(e.atmosphereCount, 0);
  e.presentationPrefs.reducedMotion = false;
  e._rain = 0.8;
  e.meadowParticles(e.scene, 2300);
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
  e.fxDraw(e.scene, 100);
  assert.equal(e.calls.length, 0);
  e.fxDraw(e.scene, 800);
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
  e.drawUnit(e.scene, u, 100);
  assert.equal(e.FXL.length, 0);
  u.x += 0.1;
  u.walkDistance = 1.6;
  e.drawUnit(e.scene, u, 200);
  assert.equal(e.FXL.length, 1);
  assert.equal(e.FXL[0].k, 'stepDust');
  e.drawUnit(e.scene, u, 210);
  assert.equal(e.FXL.length, 1);
  e.presentationPrefs.reducedMotion = true;
  u.x += 0.1;
  u.walkDistance = 2.2;
  e.drawUnit(e.scene, u, 300);
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
  e.drawTree(e.scene, 48, 49, { tree: 4 }, 1000);
  const standard = e.calls.find((call) => call.method === 'image').args;
  const rng = e.SR.getState();
  e.presentationPrefs.clarity = true;
  e.calls.length = 0;
  e.drawTree(e.scene, 48, 49, { tree: 4 }, 1000);
  assert.deepEqual(e.calls.find((call) => call.method === 'image').args, standard);
  e.calls.length = 0;
  e.drawSmoke(e.scene, 10, 20, 1000, 7);
  e.meadowParticles(e.scene, 1000);
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
  e.clarityBuildings(e.scene);
  const tags = e.calls.filter((call) => call.method === 'text').map((call) => call.args[0]);
  assert.deepEqual(tags, ['HQ ·', 'SAW ▶', 'SAW !', 'SAW Ⅱ', 'SAW +']);
});

test('a producer blocked by colony reserves is drawn idle before its next simulation tick', () => {
  const e = renderer();
  e.vw = 1440;
  e.vh = 900;
  e.cam = { x: 40 * e.TS, y: 40 * e.TS };
  e.presentationPrefs.clarity = true;
  const mill = e.newBuilding('windmill', 50, 48);
  Object.assign(mill, { done: true, timer: 4, stock: { grain: 2 }, blockedReason: '' });
  e.buildings.push(mill);
  e.anyStorage().stock.flour = 12;
  const before = e.exportSave();
  const rng = e.SR.getState();
  assert.equal(e.productionProgress(mill).reason, 'demand');
  e.clarityBuildings(e.scene);
  assert.deepEqual(
    e.calls.filter((call) => call.method === 'text').map((call) => call.args[0]),
    ['HQ ·', 'FLOUR ·'],
  );
  assert.equal(e.exportSave(), before, 'drawing idle cannot advance the colony');
  assert.equal(e.SR.getState(), rng);
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
  e.glowsDraw(e.scene);
  const lit = new Set(
    e.calls
      // The square window aura is centred over its building's tile.
      .filter((call) => call.method === 'image' && call.args[0] === 'glow')
      .filter((call) => call.args[3] === call.args[4])
      .map((call) => Math.floor((call.args[1] + call.args[3] / 2) / e.TS)),
  );
  assert.deepEqual(
    [...lit].sort((a, b) => a - b),
    [placed.sawmill.x, placed.warehouse.x],
  );
  assert.equal(e.SR.getState(), rng, 'cosmetic glow consumes no simulation RNG');
});

test('territory caches upload only changed bounds and skip unchanged projections', () => {
  const uploads = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate: (canvas, rect) => uploads.push({ canvas, rect }),
      begin() {},
      layer() {},
      end() {},
    },
  });
  e.drawBorders();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].rect, undefined, 'first paint refreshes everything');
  uploads.length = 0;
  const before = e.SR.getState();
  e.owned[e.idx(50, 50)] = 0;
  e.emitGameEvent('territoryChanged', {});
  e.drawBorders();
  assert.deepEqual(
    uploads.map(({ rect }) => rect),
    [
      {
        x: 48 * e.TS,
        y: 48 * e.TS,
        width: 8 * e.TS,
        height: 8 * e.TS,
      },
    ],
  );
  uploads.length = 0;
  e.emitGameEvent('territoryChanged', {});
  e.drawBorders();
  assert.equal(uploads.length, 0, 'unchanged projection does not upload');
  assert.equal(e.borderDirty, false);
  assert.equal(e.SR.getState(), before);
  e.emitGameEvent('worldLoaded', { reason: 'load' });
  e.drawBorders();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].rect, undefined, 'loads repaint everything');
});

test('minimap deduplicates changed cells and loads discard pending patches', () => {
  const e = renderer();
  e.drawBorders();
  e.drawMiniStatic();
  e.staticDirty = false;
  e.calls.length = 0;
  const i = e.idx(50, 50);
  e.emitGameEvent('tileChanged', { index: i });
  e.emitGameEvent('tileChanged', { index: i });
  e.calls.length = 0;
  e.drawMiniStatic();
  const fills = e.calls.filter((call) => call.method === 'fillRect');
  assert.equal(fills.length, 3, 'one cell gets base, ownership and vignette');
  assert.ok(fills.every((call) => JSON.stringify(call.args) === JSON.stringify([100, 100, 2, 2])));
  e.calls.length = 0;
  e.drawMiniStatic();
  assert.equal(e.calls.length, 0, 'unchanged cells are reused');
  e.owned[i] = 0;
  e.emitGameEvent('territoryChanged', {});
  e.drawMiniStatic();
  assert.equal(e.calls.filter((call) => call.method === 'fillRect').length, 2);
  e.emitGameEvent('worldLoaded', { reason: 'load' });
  e.calls.length = 0;
  e.drawMiniStatic();
  assert.ok(e.calls.some((call) => call.method === 'fillRect' && call.args[2] === 192));
});

test('shadow caches retain unchanged frames and patch felled, planted and grown trees locally', () => {
  const uploads = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate: (canvas, rect) => uploads.push({ canvas, rect }),
      begin() {},
      layer() {},
      end() {},
    },
  });
  const art = { img: { width: 0 }, w: 48, h: 56, ox: -12, oy: -32 };
  e.bldImg = () => art;
  e.ART.tree = Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => ['tree', 'tree']));
  e.ART.shadowSoft = 'root';
  const i = e.idx(50, 50);
  e.tiles[i].tree = 4;
  const rng = e.SR.getState(),
    time = e.state.time;
  const cache = e.shadowCache;
  cache.refresh();
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((u) => u.rect === undefined));
  const paints = cache.paints;
  uploads.length = 0;
  cache.refresh();
  e.emitGameEvent('tileChanged', { index: i });
  cache.refresh();
  assert.equal(cache.paints, paints);
  assert.equal(uploads.length, 0, 'unchanged tree notifications do no shadow work');
  for (const tree of [0, 1, 2, 4]) {
    e.tiles[i].tree = tree;
    e.emitGameEvent('tileChanged', { index: i });
    e.emitGameEvent('tileChanged', { index: i });
    cache.refresh();
    assert.ok(uploads.length > 0);
    assert.ok(
      uploads.every((u) => u.rect && u.rect.width <= 8 * e.TS && u.rect.height <= 8 * e.TS),
    );
    assert.ok(uploads.every((u) => u.rect.x <= 50 * e.TS && u.rect.x + u.rect.width > 50 * e.TS));
    uploads.length = 0;
  }
  assert.equal(e.SR.getState(), rng);
  assert.equal(e.state.time, time);
  e.emitGameEvent('worldLoaded', { reason: 'load' });
  cache.refresh();
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((u) => u.rect === undefined));
});

test('shadow caches reconcile completion, removal and replacement of the live building array', () => {
  const uploads = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate: (canvas, rect) => uploads.push(rect),
      begin() {},
      layer() {},
      end() {},
    },
  });
  const art = { img: { width: 0 }, w: 48, h: 56, ox: -12, oy: -32 };
  e.bldImg = () => art;
  e.shadowCache.refresh();
  const site = e.newBuilding('sawmill', 50, 50);
  e.buildings.push(site);
  uploads.length = 0;
  e.shadowCache.refresh();
  assert.equal(uploads.length, 0, 'construction has no projected finished-building shadow');
  site.done = true;
  e.shadowCache.refresh();
  assert.ok(uploads.length > 0 && uploads.every((rect) => rect && rect.width <= 8 * e.TS));
  uploads.length = 0;
  e.buildings = e.buildings.filter((b) => b.id !== site.id);
  e.shadowCache.refresh();
  assert.ok(uploads.length > 0 && uploads.every((rect) => rect && rect.width <= 8 * e.TS));
});

test('an unavailable shadow context reports through the graphics failure boundary', () => {
  let caches = 0;
  const failures = [];
  assert.throws(
    () =>
      renderer({
        contextFor: (name, context) => (name === 'cache' && ++caches === 3 ? null : context),
        presentation: { reportFailure: (reason) => failures.push(reason) },
      }),
    /Canvas 2D context is unavailable/,
  );
  assert.deepEqual(failures, ['Canvas 2D context is unavailable']);
});

function pausedScene(paintForeground = false) {
  const viewportFills = [],
    tints = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate() {},
      begin() {},
      end() {},
      screenTint: (tint) => tints.push([...tint]),
      layer(name, paint) {
        if (
          !paintForeground ||
          !['foreground-effects', 'above-atmosphere', 'overlay'].includes(name)
        )
          return;
        const scene = recordingScene();
        paint(scene);
        for (const { method, args } of scene.calls)
          if (method === 'rect' && args[2] >= e.vw && args[3] >= e.vh) viewportFills.push(args);
      },
    },
  });
  e.staticDirty = false;
  e.borderDirty = false;
  e.buildings = [];
  e.mode = null;
  e.ghost = null;
  e.presentationPrefs.weather = false;
  e.vw = 800;
  e.vh = 600;
  e.cam = { x: 40 * e.TS, y: 40 * e.TS };
  e.SND.thunder = () => {};
  return { e, tints, viewportFills };
}

test('paused feedback starts on the current wall clock and still completes', (t) => {
  const clock = pinClock(1000);
  t.after(() => clock.restore());
  const { e } = pausedScene(true);
  e.draw();
  clock.set(3000);
  e.draw();
  e.FX.ring(48, 48, '#ffd23f', 16);
  e.draw();
  assert.equal(e.FXL.length, 1, 'new feedback survives its first paused frame');
  clock.tick(700);
  e.draw();
  assert.equal(e.FXL.length, 0, 'brief feedback finishes while paused');
});

test('paused camera movement still refreshes the minimap viewport', (t) => {
  const clock = pinClock(1000);
  t.after(() => clock.restore());
  const { e } = pausedScene();
  e.draw();
  e.drawMini();
  e.calls.length = 0;
  clock.tick(1000);
  e.cam.x += e.TS;
  e.draw();
  e.drawMini();
  assert.ok(
    e.calls.some((call) => call.method === 'strokeRect'),
    'viewport redraw is not frozen with decorative time',
  );
});

test('lightning during pause expires on wall time', (t) => {
  const clock = pinClock(1000);
  t.after(() => clock.restore());
  const random = Math.random;
  t.after(() => {
    Math.random = random;
  });
  const { e, tints, viewportFills } = pausedScene(true);
  const close = (actual, expected, message) =>
    assert.ok(
      actual.length === 4 && actual.every((v, i) => Math.abs(v - expected[i]) < 1e-4),
      `${message}: ${actual}`,
    );
  e.draw();
  e.presentationPrefs.weather = true;
  e._rain = 1;
  Math.random = () => 0;
  clock.tick(1000);
  tints.length = 0;
  e.draw();
  // A white 0.26 flash over the 0.16 rain veil, premultiplied.
  close(tints.at(-1), [0.27718, 0.284144, 0.289716, 0.3784], 'the thunderstorm produces a flash');
  Math.random = () => 0.5;
  clock.tick(500);
  e.draw();
  close(tints.at(-1), [0.023216, 0.032627, 0.040157, 0.16], 'only the rain veil remains');
  assert.deepEqual(
    viewportFills,
    [],
    'veils are applied by the atmosphere pass, not viewport fills',
  );
});

test('the backdrop and map shadows fill only viewport area the map leaves uncovered', (t) => {
  const clock = pinClock(1000);
  t.after(() => clock.restore());
  // Rectangles collect into a path until a fill gives them their style.
  const fills = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate() {},
      begin() {},
      end() {},
      layer(name, paint) {
        if (name !== 'backdrop') return;
        const scene = recordingScene();
        paint(scene);
        let pending = [];
        for (const { method, args } of scene.calls) {
          if (method === 'rect') pending.push(args);
          else if (method === 'fill') {
            for (const rect of pending) fills.push({ style: args[0], rect });
            pending = [];
          }
        }
      },
    },
  });
  e.staticDirty = false;
  e.borderDirty = false;
  e.vw = 800;
  e.vh = 600;
  e.cam = { x: 40 * e.TS, y: 40 * e.TS };
  e.draw();
  assert.deepEqual(fills, [], 'a covering map needs no backdrop');
  const mapW = e.W * e.TS,
    mapH = e.H * e.TS;
  e.cam = { x: mapW - 700, y: 40 * e.TS };
  e.draw();
  const isGradient = (style) => Array.isArray(style?.colorStops);
  const gradient = fills.filter((f) => isGradient(f.style));
  assert.deepEqual(
    gradient.map((f) => f.rect),
    [[700, 0, 100, 600]],
    'only the band east of the map (screen pixels)',
  );
  const shadows = fills.filter((f) => !isGradient(f.style));
  assert.ok(shadows.length > 0, 'the map still casts its drop shadow');
  for (const { rect } of shadows) {
    // Back to world pixels at zoom 1.
    const [x, y, w, h] = [rect[0] + e.cam.x, rect[1] + e.cam.y, rect[2], rect[3]];
    assert.ok(x >= mapW || y >= mapH, `shadow ${rect} stays outside the map`);
    assert.ok(x + w <= mapW + 4 && y + h <= mapH + 5);
  }
});

test('the layers above the atmosphere follow the screen veil', (t) => {
  const clock = pinClock(1000);
  t.after(() => clock.restore());
  const sequence = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate() {},
      begin() {},
      end() {},
      screenTint: () => sequence.push('veil'),
      layer: (name) => sequence.push(name),
    },
  });
  e.staticDirty = false;
  e.borderDirty = false;
  e.vw = 800;
  e.vh = 600;
  e.draw();
  assert.deepEqual(sequence.slice(-4), [
    'foreground-effects',
    'veil',
    'above-atmosphere',
    'overlay',
  ]);
});

test('nature keeps prepared artwork until its tile, sway frame or presentation changes', () => {
  const calls = [];
  const scene = recordingScene(calls);
  const released = [];
  const e = renderer({
    presentation: {
      available: true,
      invalidate() {},
      begin() {},
      end() {},
      release: (owner) => released.push(owner),
      layer: (_name, paint) => paint(scene),
    },
  });
  e.buildings = [];
  e.units = [];
  e.cam.x = e.cam.y = 40 * e.TS;
  e.vw = 800;
  e.vh = 600;
  e.ART.tree = Array.from({ length: 4 }, (_, stage) =>
    Array.from({ length: 3 }, (_, species) => [`${stage}/${species}/0`, `${stage}/${species}/1`]),
  );
  const index = e.idx(50, 50);
  e.tiles[index].tree = 1;
  e.drawObjects(1000);
  const first = calls.find((c) => c.method === 'image');
  assert.ok(first);
  calls.length = 0;
  e.drawObjects(1000);
  assert.equal(
    calls.filter((c) => c.method === 'image').length,
    0,
    'unchanged nature emits no image commands',
  );
  for (const stage of [2, 3, 4]) {
    e.tiles[index].tree = stage;
    e.emitGameEvent('tileChanged', { index });
    calls.length = 0;
    e.drawObjects(1000);
    const image = calls.find((c) => c.method === 'image');
    assert.ok(image.args[0].startsWith(`${stage - 1}/`));
    assert.deepEqual(
      image.args.slice(1),
      first.args.slice(1),
      'growth preserves the root and footprint',
    );
  }
  calls.length = 0;
  e.drawObjects(3400);
  assert.equal(calls.filter((c) => c.method === 'image').length, 1, 'only the sway frame changes');
  e.presentationPrefs.clarity = true;
  calls.length = 0;
  e.drawObjects(3400);
  assert.equal(calls.find((c) => c.method === 'image').alpha, 0.62);
  const rng = e.SR.getState();
  e.tiles[index].tree = 0;
  e.emitGameEvent('tileChanged', { index });
  assert.equal(released.length, 1);
  e.drawObjects(3400);
  e.tiles[index].tree = 4;
  e.emitGameEvent('tileChanged', { index });
  e.drawObjects(3400);
  e.emitGameEvent('worldLoaded', { reason: 'load' });
  assert.equal(released.length, 2, 'world replacement releases native ownership');
  assert.equal(e.SR.getState(), rng);
});

test('cached static rows preserve full depth keys and stable ties against moving settlers', () => {
  const e = renderer();
  e.vw = 800;
  e.vh = 600;
  e.cam.x = e.cam.y = 40 * e.TS;
  const hq = e.buildings[0];
  hq.x = hq.y = 50;
  const extra = e.newBuilding('warehouse', 51, 50);
  e.buildings.push(extra);
  e.units = [];
  for (let i = 0; i < 4; i++) e.spawnCarrier(hq);
  const [before, tie, after, cross] = e.units;
  before.y = 50;
  tie.y = (1219 - 3) / 24;
  after.y = (1221 - 3) / 24;
  cross.y = 51;
  e.tiles[e.idx(50, 50)].tree = 4;
  e.tiles[e.idx(51, 50)].tree = 4;
  e.tiles[e.idx(49, 50)].rock = { amt: 10 };
  const labels = new Map([
    [hq, 'hq'],
    [extra, 'store'],
    [before, 'before'],
    [tie, 'tie'],
    [after, 'after'],
    [cross, 'cross'],
  ]);
  const order = () =>
    e.orderedObjects.map((q) => (q.o ? labels.get(q.o) : `${q.t === 1 ? 'tree' : 'rock'}:${q.x}`));
  const rng = e.SR.getState();
  e.drawObjects(1000);
  assert.deepEqual(order(), [
    'before',
    'tree:50',
    'tree:51',
    'tie',
    'rock:49',
    'after',
    'hq',
    'store',
    'cross',
  ]);
  cross.y = (1222 - 3) / 24;
  e.drawObjects(1000);
  assert.deepEqual(
    order(),
    ['before', 'tree:50', 'tree:51', 'tie', 'rock:49', 'after', 'hq', 'store', 'cross'],
    'settlers tied with buildings follow them',
  );
  cross.y = 49.5;
  e.drawObjects(1000);
  assert.deepEqual(order(), [
    'cross',
    'before',
    'tree:50',
    'tree:51',
    'tie',
    'rock:49',
    'after',
    'hq',
    'store',
  ]);
  e.tiles[e.idx(50, 50)].tree = 0;
  e.emitGameEvent('tileChanged', { index: e.idx(50, 50) });
  e.drawObjects(1000);
  assert.deepEqual(order(), [
    'cross',
    'before',
    'tree:51',
    'tie',
    'rock:49',
    'after',
    'hq',
    'store',
  ]);
  assert.equal(e.SR.getState(), rng);
});
