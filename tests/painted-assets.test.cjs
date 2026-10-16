'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const painted = require('../src/rendering/painted-assets.ts');
const { createGame, installGlobals, fakeElement, fakeWindow } = require('./helpers/game.cjs');

const types = [
  'hq',
  'warehouse',
  'lumberjack',
  'forester',
  'quarry',
  'fisherman',
  'farm',
  'windmill',
  'bakery',
  'pigfarm',
  'butcher',
  'well',
  'brewery',
  'smelter',
  'workshop',
  'mine_coal',
  'mine_iron',
  'mine_gold',
  'sawmill',
  'toolsmith',
  'armory',
  'guard',
];
function manifest() {
  const region = { sheet: 'sprites', x: 0, y: 0, w: 64, h: 64 };
  return {
    version: 1,
    sheets: { sprites: 'sprites.png', meadow: 'meadow.png' },
    buildings: Object.fromEntries(types.map((type) => [type, { ...region }])),
    site: { ...region },
    trees: Array.from({ length: 3 }, () => ({ ...region })),
    rocks: Array.from({ length: 2 }, () => ({ ...region })),
    terrain: { sheet: 'meadow', worldSize: 384 },
  };
}
function harness(pack = manifest()) {
  const requests = [];
  const warnings = [];
  class Canvas {
    width = 1;
    height = 1;
    getContext() {
      return {
        drawImage() {},
        getImageData: () => {
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          data[((this.height >> 1) * this.width + (this.width >> 1)) * 4 + 3] = 255;
          return { data };
        },
      };
    }
  }
  class Image {
    naturalWidth = 256;
    naturalHeight = 256;
    set src(url) {
      if (url) {
        requests.push(url);
        queueMicrotask(() => this.onload());
      }
    }
  }
  const document = {
    baseURI: 'http://localhost/deployed/tests/game.html',
    querySelectorAll: () => [{ src: 'http://localhost/deployed/game.test.js?v=abc' }],
    getElementById: () => null,
    createElement: (name) => (name === 'canvas' ? new Canvas() : fakeElement()),
    body: Object.assign(fakeElement('body'), { append: (element) => warnings.push(element) }),
  };
  const { window } = fakeWindow({ setTimeout });
  installGlobals({
    document,
    window,
    Image,
    fetch: async (url) => {
      requests.push(url.href);
      return { ok: true, json: async () => pack };
    },
    console: Object.assign(Object.create(console), { warn() {} }),
  });
  const sprite = () => ({
    img: Object.assign(new Canvas(), { width: 102, height: 132 }),
    w: 34,
    h: 44,
    ox: -5,
    oy: -20,
  });
  const game = {
    ART: {
      bld: Object.fromEntries(types.map((type) => [type, sprite()])),
      bld2: { forester: sprite() },
      site: sprite(),
      tree: Array.from({ length: 4 }, () =>
        Array.from({ length: 3 }, () =>
          Array.from({ length: 2 }, () => Object.assign(new Canvas(), { width: 108, height: 126 })),
        ),
      ),
      rock: [
        Object.assign(new Canvas(), { width: 96, height: 72 }),
        Object.assign(new Canvas(), { width: 96, height: 72 }),
      ],
      grass: Array.from({ length: 4 }, () =>
        Object.assign(new Canvas(), { width: 72, height: 72 }),
      ),
    },
    staticDirty: false,
  };
  return { ...painted, game, requests, warnings };
}

test('painted manifests reject missing building art and invalid pixel crops', () => {
  const api = harness();
  const missing = manifest();
  delete missing.buildings.mine_gold;
  assert.throws(() => api.validatePaintedManifest(missing), /mine_gold/);
  for (const type of [
    'windmill',
    'bakery',
    'pigfarm',
    'butcher',
    'well',
    'brewery',
    'smelter',
    'workshop',
  ]) {
    const incomplete = manifest();
    delete incomplete.buildings[type];
    assert.throws(() => api.validatePaintedManifest(incomplete), new RegExp(type));
  }
  const outside = manifest();
  outside.buildings.hq.x = 0.9;
  assert.throws(() => api.validatePaintedManifest(outside), /hq/);
});

test('uniform painted fitting keeps proportions and scales trees around their root', () => {
  const { fitPaintedSprite } = harness();
  const mature = fitPaintedSprite(40, 60, 108, 126, 117, 1);
  const sapling = fitPaintedSprite(40, 60, 108, 126, 117, 0.34);
  assert.equal(mature.y + mature.h, 117);
  assert.equal(sapling.y + sapling.h, 117);
  assert.equal(mature.w / mature.h, 40 / 60);
  assert.equal(sapling.w / mature.w, 0.34);
  assert.equal(mature.x + mature.w / 2, 54);
  assert.equal(sapling.x + sapling.w / 2, 54);
});

test('complete artwork installation preserves anchors, growth identities, and deployment paths', async () => {
  const api = harness();
  const before = api.game.ART.bld.hq;
  const originalSite = api.game.ART.site.img;
  await api.loadPaintedAssets(api.game);
  assert.deepEqual(Object.keys(api.game.ART.bld).sort(), [...types].sort());
  assert.notEqual(api.game.ART.site.img, originalSite);
  const installed = api.game.ART.bld.hq;
  assert.notEqual(installed.img, before.img);
  for (const key of ['w', 'h', 'ox', 'oy']) assert.equal(installed[key], before[key]);
  assert.equal(api.game.ART.bld2.forester, api.game.ART.bld.forester);
  assert.equal(api.game.ART.tree.length, 4);
  for (const stage of api.game.ART.tree) {
    assert.equal(stage.length, 3);
    for (const species of stage) assert.equal(species.length, 2);
  }
  assert.equal(api.game.ART.paintedTerrain.worldSize, 384);
  assert.equal(api.game.ART.paintedStatus.state, 'loaded');
  assert.equal(api.game.staticDirty, true);
  assert.equal(api.requests[0], 'http://localhost/deployed/assets/art/manifest.json');
  assert.ok(api.requests.includes('http://localhost/deployed/assets/art/sprites.png'));
  assert.equal(api.warnings.length, 0);
});

test('incomplete artwork falls back atomically and visibly', async () => {
  const invalid = manifest();
  delete invalid.buildings.armory;
  const api = harness(invalid);
  const original = api.game.ART.bld;
  const originalTrees = api.game.ART.tree;
  await api.loadPaintedAssets(api.game);
  assert.equal(api.game.ART.bld, original);
  assert.equal(api.game.ART.tree, originalTrees);
  assert.equal(api.game.ART.paintedTerrain, undefined);
  assert.equal(api.game.ART.paintedStatus.state, 'fallback');
  assert.match(api.warnings[0].textContent, /Standard artwork is active/);
});

test('unavailable artwork contexts propagate to boot without partially installing the pack', async () => {
  const api = harness();
  const { game } = createGame({ modules: ['world'], stubs: { ART: api.game.ART } });
  const before = { ...game.ART };
  const createElement = document.createElement;
  document.createElement = (name) => {
    const node = createElement(name);
    if (name === 'canvas') node.getContext = () => null;
    return node;
  };
  await assert.rejects(() => api.loadPaintedAssets(game), /Canvas 2D context is unavailable/);
  for (const key of Object.keys(before)) assert.equal(game.ART[key], before[key], key);
  assert.equal(api.warnings.length, 0, 'an unavailable context cannot offer playable fallback art');
});

function mountainManifest() {
  const pack = manifest();
  pack.sheets.mountains = 'mountains.png';
  const region = { sheet: 'mountains', x: 0, y: 0, w: 64, h: 64 };
  pack.mountains = {
    dry: Array.from({ length: 3 }, () => ({ ...region })),
    snowy: Array.from({ length: 2 }, () => ({ ...region })),
    foothill: { ...region },
  };
  return pack;
}

test('optional painted mountains require complete valid dry, snowy, and foothill crops', () => {
  const api = harness();
  assert.doesNotThrow(() => api.validatePaintedManifest(manifest()));
  assert.doesNotThrow(() => api.validatePaintedManifest(mountainManifest()));
  const missingDry = mountainManifest();
  missingDry.mountains.dry.pop();
  assert.throws(() => api.validatePaintedManifest(missingDry), /three dry and two snowy/);
  const missingSnow = mountainManifest();
  missingSnow.mountains.snowy.pop();
  assert.throws(() => api.validatePaintedManifest(missingSnow), /three dry and two snowy/);
  const fractional = mountainManifest();
  fractional.mountains.dry[1].x = 0.5;
  assert.throws(() => api.validatePaintedManifest(fractional), /dry mountain 1/);
  const unknownSheet = mountainManifest();
  unknownSheet.mountains.snowy[0].sheet = 'missing';
  assert.throws(() => api.validatePaintedManifest(unknownSheet), /snowy mountain 0/);
  const missingFoothill = mountainManifest();
  delete missingFoothill.mountains.foothill;
  assert.throws(() => api.validatePaintedManifest(missingFoothill), /mountain foothill/);
});

test('painted mountain variants install together with the rest of the artwork pack', async () => {
  const api = harness(mountainManifest());
  await api.loadPaintedAssets(api.game);
  assert.equal(api.game.ART.paintedMountains.dry.length, 3);
  assert.equal(api.game.ART.paintedMountains.snowy.length, 2);
  assert.ok(api.game.ART.paintedMountains.foothill);
  assert.equal(api.game.ART.paintedStatus.state, 'loaded');
  assert.ok(api.requests.includes('http://localhost/deployed/assets/art/mountains.png'));
});

test('an out-of-sheet mountain crop preserves every installed artwork collection atomically', async () => {
  const invalid = mountainManifest();
  invalid.mountains.foothill.x = 250;
  const api = harness(invalid);
  const collections = Object.fromEntries(
    ['bld', 'bld2', 'site', 'tree', 'rock', 'grass'].map((key) => [key, api.game.ART[key]]),
  );
  const originalMountains = { previous: true };
  api.game.ART.paintedMountains = originalMountains;
  await api.loadPaintedAssets(api.game);
  for (const [key, value] of Object.entries(collections)) assert.equal(api.game.ART[key], value);
  assert.equal(api.game.ART.paintedMountains, originalMountains);
  assert.equal(api.game.ART.paintedTerrain, undefined);
  assert.equal(api.game.ART.paintedStatus.state, 'fallback');
  assert.equal(api.game.staticDirty, false);
  assert.match(api.warnings[0].textContent, /Standard artwork is active/);
});
