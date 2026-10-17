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
  const mountain = { sheet: 'mountains', x: 0, y: 0, w: 64, h: 64 };
  return {
    version: 1,
    sheets: { sprites: 'sprites.png', meadow: 'meadow.png', mountains: 'mountains.png' },
    buildings: Object.fromEntries(types.map((type) => [type, { ...region }])),
    site: { ...region },
    trees: Array.from({ length: 3 }, () => ({ ...region })),
    rocks: Array.from({ length: 2 }, () => ({ ...region })),
    terrain: { sheet: 'meadow', worldSize: 384 },
    mountains: {
      dry: Array.from({ length: 3 }, () => ({ ...mountain })),
      snowy: Array.from({ length: 2 }, () => ({ ...mountain })),
      foothill: { ...mountain },
    },
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
  const failures = [];
  const game = {
    SS: 3,
    ART: { road: 'road', cargo: {} },
    staticDirty: false,
    reportGraphicsFailure: (reason) => failures.push(reason),
  };
  return { ...painted, game, requests, warnings, failures };
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

test('complete artwork installation fits every sprite into its fixed anchor box', async () => {
  const api = harness();
  await api.loadPaintedAssets(api.game);
  assert.deepEqual(Object.keys(api.game.ART.bld).sort(), [...types].sort());
  // The box bottom stays on the entrance row of the 24px tile.
  const hq = api.game.ART.bld.hq;
  assert.deepEqual(
    { w: hq.w, h: hq.h, ox: hq.ox, oy: hq.oy, width: hq.img.width, height: hq.img.height },
    { w: 48, h: 56, ox: -12, oy: -32, width: 144, height: 168 },
  );
  for (const type of types) {
    const sprite = api.game.ART.bld[type];
    assert.equal(sprite.oy + sprite.h, 24, type);
    assert.equal(sprite.ox * 2 + sprite.w, 24, type);
  }
  assert.deepEqual([api.game.ART.site.w, api.game.ART.site.h, api.game.ART.site.oy], [34, 38, -14]);
  assert.equal(api.game.ART.tree.length, 4);
  for (const stage of api.game.ART.tree) {
    assert.equal(stage.length, 3);
    for (const species of stage) {
      assert.equal(species.length, 2);
      for (const frame of species) assert.deepEqual([frame.width, frame.height], [108, 126]);
    }
  }
  for (const rock of api.game.ART.rock) assert.deepEqual([rock.width, rock.height], [96, 72]);
  assert.equal(api.game.ART.paintedMountains.dry.length, 3);
  assert.equal(api.game.ART.paintedMountains.snowy.length, 2);
  assert.ok(api.game.ART.paintedMountains.foothill);
  assert.equal(api.game.ART.paintedTerrain.worldSize, 384);
  assert.equal(api.game.ART.paintedStatus.state, 'loaded');
  assert.equal(api.game.staticDirty, true);
  assert.equal(api.requests[0], 'http://localhost/deployed/assets/art/manifest.json');
  assert.ok(api.requests.includes('http://localhost/deployed/assets/art/sprites.png'));
  assert.ok(api.requests.includes('http://localhost/deployed/assets/art/mountains.png'));
});

test('an incomplete pack rejects boot without installing any artwork', async () => {
  const invalid = manifest();
  delete invalid.buildings.armory;
  const api = harness(invalid);
  const before = { ...api.game.ART };
  await assert.rejects(
    () => api.loadPaintedAssets(api.game),
    /Painted artwork could not load: Invalid painted artwork region: armory/,
  );
  assert.deepEqual(
    Object.keys(api.game.ART).sort(),
    [...Object.keys(before), 'paintedStatus'].sort(),
  );
  assert.equal(api.game.ART.paintedStatus.state, 'failed');
  assert.equal(api.game.staticDirty, false);
  assert.equal(api.warnings.length, 0);
  assert.deepEqual(api.failures, [], 'a bad pack is a boot error, not a GPU failure');
});

test('unavailable artwork contexts propagate to boot without partially installing the pack', async () => {
  const api = harness();
  const { game } = createGame({
    modules: ['world'],
    stubs: { ART: api.game.ART, SS: 3, reportGraphicsFailure: api.game.reportGraphicsFailure },
  });
  const before = { ...game.ART };
  const createElement = document.createElement;
  document.createElement = (name) => {
    const node = createElement(name);
    if (name === 'canvas') node.getContext = () => null;
    return node;
  };
  await assert.rejects(() => api.loadPaintedAssets(game), /Canvas 2D context is unavailable/);
  for (const key of Object.keys(before)) assert.equal(game.ART[key], before[key], key);
  assert.equal(game.ART.bld, undefined);
  assert.deepEqual(api.failures, ['Canvas 2D context is unavailable']);
});

test('painted mountains require complete valid dry, snowy, and foothill crops', () => {
  const api = harness();
  assert.doesNotThrow(() => api.validatePaintedManifest(manifest()));
  const absent = manifest();
  delete absent.mountains;
  assert.throws(() => api.validatePaintedManifest(absent), /three dry and two snowy/);
  const missingDry = manifest();
  missingDry.mountains.dry.pop();
  assert.throws(() => api.validatePaintedManifest(missingDry), /three dry and two snowy/);
  const missingSnow = manifest();
  missingSnow.mountains.snowy.pop();
  assert.throws(() => api.validatePaintedManifest(missingSnow), /three dry and two snowy/);
  const fractional = manifest();
  fractional.mountains.dry[1].x = 0.5;
  assert.throws(() => api.validatePaintedManifest(fractional), /dry mountain 1/);
  const unknownSheet = manifest();
  unknownSheet.mountains.snowy[0].sheet = 'missing';
  assert.throws(() => api.validatePaintedManifest(unknownSheet), /snowy mountain 0/);
  const missingFoothill = manifest();
  delete missingFoothill.mountains.foothill;
  assert.throws(() => api.validatePaintedManifest(missingFoothill), /mountain foothill/);
});

test('an out-of-sheet mountain crop leaves the atlas untouched', async () => {
  const invalid = manifest();
  invalid.mountains.foothill.x = 250;
  const api = harness(invalid);
  const before = { ...api.game.ART };
  await assert.rejects(() => api.loadPaintedAssets(api.game), /Artwork crop exceeds its sheet/);
  for (const [key, value] of Object.entries(before)) assert.equal(api.game.ART[key], value);
  assert.equal(api.game.ART.paintedMountains, undefined);
  assert.equal(api.game.ART.paintedTerrain, undefined);
  assert.equal(api.game.ART.paintedStatus.state, 'failed');
  assert.equal(api.game.staticDirty, false);
});
