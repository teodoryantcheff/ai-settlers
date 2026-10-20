'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeWindow, installGlobals, pinClock } = require('./helpers/game.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

const mountain = { width: 120, height: 120 };

function landscape() {
  const calls = [];
  const noop = () => {};
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return (...args) => {
            calls.push({ key, args });
            return { addColorStop() {} };
          };
        return (...args) => calls.push({ key, args });
      },
    },
  );
  const canvas = () => ({ getContext: () => ctx });
  const document = { getElementById: () => canvas() };
  const { window } = fakeWindow();
  installGlobals({ document, window });
  const { game: e } = createGame({
    seed: 2024,
    modules: ['world', 'state', 'map', 'landscape', 'renderer'],
    presentation: { available: true, invalidate: noop, begin: noop, layer: noop, end: noop },
    stubs: {
      Acan: canvas,
      ART: {
        paintedTerrain: { image: { width: 384, height: 384 }, worldSize: 384 },
        paintedMountains: {
          dry: [mountain, mountain, mountain],
          snowy: [mountain, mountain],
          foothill: mountain,
        },
      },
      rgba: (color, alpha) => color + ':' + alpha,
      buildingAt: () => null,
    },
  });
  e.tiles = Array.from({ length: e.W * e.H }, () => ({
    t: e.GRASS,
    tree: 0,
    rock: null,
    road: false,
    deposit: null,
  }));
  e.calls = calls;
  e.ctx = ctx;
  return e;
}

test('cosmetic landscape painting is deterministic and leaves simulation RNG untouched', () => {
  const e = landscape();
  let rolls = 0;
  e.SR = () => {
    rolls++;
    return 0.5;
  };
  const i = e.idx(12, 14);
  e.tiles[i].t = e.MTN;
  e.tiles[i].deposit = { kind: 'gold', amt: 180, amt0: 240 };
  e.paintTileFull(e.ctx, i);
  const first = JSON.stringify(e.calls);
  e.calls.length = 0;
  e.paintTileFull(e.ctx, i);
  assert.equal(JSON.stringify(e.calls), first);
  assert.equal(rolls, 0);
  assert.equal(e.tiles[i].deposit.amt, 180);
});

test('roads join adjacent roads and building entrances without wrapping map edges', () => {
  const e = landscape();
  const centre = e.idx(4, 4);
  e.tiles[centre].road = true;
  e.tiles[e.idx(4, 3)].road = true;
  e.tiles[e.idx(5, 4)].road = true;
  e.buildingAt = (x, y) => (x === 4 && y === 5 ? { type: 'warehouse' } : null);
  assert.equal(e.landscapeRoadMask(4, 4), 7);
  e.tiles[e.idx(e.W - 1, 3)].road = true;
  e.tiles[e.idx(0, 3)].road = true;
  assert.equal(e.landscapeRoadMask(0, 4), 1);
  const shapes = [];
  for (const mask of [1, 2, 4, 8, 15]) {
    e.calls.length = 0;
    e.traceLandscapeRoad(e.ctx, mask);
    shapes.push(e.calls.filter((c) => c.key === 'lineTo').map((c) => c.args));
  }
  assert.deepEqual(shapes, [
    [[12, -1]],
    [[25, 12]],
    [[12, 25]],
    [[-1, 12]],
    [
      [12, -1],
      [25, 12],
      [12, 25],
      [-1, 12],
    ],
  ]);
});

test('dirty terrain redraws clip all painting and resample the surrounding macro wash', () => {
  const e = landscape();
  e.macroCan = 'wash';
  e.drawTile(e.ctx, e.idx(7, 9));
  const wash = e.calls.find((c) => c.key === 'drawImage' && c.args[0] === 'wash');
  assert.deepEqual(wash.args.slice(1, 5), [6, 8, 3, 3]);
  assert.equal(e.calls.filter((c) => c.key === 'clip').length, 2);
  assert.equal(
    e.calls.filter((c) => c.key === 'save').length,
    e.calls.filter((c) => c.key === 'restore').length,
  );
  assert.equal(e.terrainRevision, 1);
  assert.equal(e.miniDirty, true);
});

test('ore is embedded seams with visual depletion and no permanent progress meter', () => {
  const e = landscape();
  e.paintOreSeams(e.ctx, { kind: 'gold', amt: 240, amt0: 240 }, 38, 2);
  const full = e.calls.filter((c) => c.key === 'ellipse').length;
  assert.equal(
    e.calls.some((c) => c.key === 'fillRect'),
    false,
  );
  e.calls.length = 0;
  e.paintOreSeams(e.ctx, { kind: 'gold', amt: 40, amt0: 240 }, 38, 2);
  assert.equal(full, 2);
  assert.equal(e.calls.filter((c) => c.key === 'ellipse').length, 1);
});

test('large crags share cached world geometry across tiles and rebuild for imported maps', () => {
  const e = landscape();
  for (let y = 20; y <= 25; y++) for (let x = 20; x <= 25; x++) e.tiles[e.idx(x, y)].t = e.MTN;
  e.prepareLandscapeCrags();
  const cache = e.landscapeCragMap;
  const first = cache.perTile[e.idx(22, 22)][0];
  const entries = cache.perTile.filter((items) => items && items.includes(first));
  assert.ok(entries.length >= 9);
  assert.ok(first.radius * 2 > 2 * e.TS);
  e.prepareLandscapeCrags();
  assert.equal(e.landscapeCragMap, cache);
  e.tiles = e.tiles.map((tile) => ({ ...tile }));
  e.prepareLandscapeCrags();
  assert.notEqual(e.landscapeCragMap, cache);
  assert.deepEqual(e.landscapeCragMap.perTile[e.idx(22, 22)][0], first);
  const imported = e.landscapeCragMap;
  e.seed = 17;
  e.prepareLandscapeCrags();
  assert.notEqual(e.landscapeCragMap, imported);
  assert.notEqual(e.landscapeCragMap.perTile[e.idx(22, 22)][0].hash, first.hash);
});

test('snow is limited to tall peaks while overlapping mountain faces retain world depth order', () => {
  const e = landscape();
  for (let y = 8; y < 72; y++) for (let x = 8; x < 72; x++) e.tiles[e.idx(x, y)].t = e.MTN;
  // A sparse foothill crag must stay below the snow line.
  e.tiles[e.idx(80, 80)].t = e.MTN;
  e.prepareLandscapeCrags();
  const features = [...new Set(e.landscapeCragMap.perTile.flat().filter(Boolean))];
  const snowy = features.filter((feature) => feature.snow);
  assert.ok(snowy.length > 0, 'a broad mountain range includes a few snowy summits');
  assert.ok(features.some((feature) => feature.height >= 67 && !feature.snow));
  assert.ok(features.some((feature) => feature.height < 67));
  assert.ok(snowy.every((feature) => feature.height >= 55 && feature.density >= 7));
  const dense = features.filter((feature) => feature.density >= 7);
  assert.ok(snowy.length <= Math.ceil(dense.length * 0.15));
  assert.ok(
    Math.min(...snowy.map((feature) => feature.height)) >=
      Math.max(...dense.filter((feature) => !feature.snow).map((feature) => feature.height)),
  );
  assert.ok(e.landscapeCragMap.perTile[e.idx(80, 80)].every((feature) => !feature.snow));
  for (const overlapping of e.landscapeCragMap.perTile.filter(Boolean)) {
    for (let i = 1; i < overlapping.length; i++) {
      assert.ok(overlapping[i - 1].artFoot[1] <= overlapping[i].artFoot[1]);
    }
  }
});

test('sparse mountains cache every tile down to the painted foothill base', () => {
  const e = landscape();
  for (let y = 8; y < 88; y += 8) for (let x = 8; x < 88; x += 8) e.tiles[e.idx(x, y)].t = e.MTN;
  e.prepareLandscapeCrags();
  const features = [...new Set(e.landscapeCragMap.perTile.flat().filter(Boolean))];
  for (const feature of features) {
    const baseTile = e.idx(
      Math.floor(feature.artFoot[0] / e.TS),
      Math.floor((feature.artFoot[1] + 4) / e.TS),
    );
    assert.ok(e.landscapeCragMap.perTile[baseTile]?.includes(feature));
  }
});

test('painted sparse foothills project continuously across nearby water tiles', () => {
  const e = landscape();
  const foothill = { width: 120, height: 60 };
  const peak = { width: 120, height: 120 };
  e.ART.paintedMountains = { dry: [peak, peak, peak], snowy: [peak, peak], foothill };
  e.tiles[e.idx(40, 40)].t = e.MTN;
  e.tiles[e.idx(40, 39)].t = e.WATER;
  e.prepareLandscapeCrags();
  e.paintLandscapeTile(e.ctx, 40, 40, e.tiles[e.idx(40, 40)], 0);
  const landDraw = e.calls.find((call) => call.key === 'drawImage' && call.args[0] === foothill);
  assert.ok(landDraw, 'an isolated mountain uses the low grassy foothill sprite');
  assert.equal(landDraw.args[3] / landDraw.args[4], foothill.width / foothill.height);
  e.calls.length = 0;
  e.paintLandscapeTile(e.ctx, 40, 39, e.tiles[e.idx(40, 39)], 0);
  const waterDraw = e.calls.find((call) => call.key === 'drawImage' && call.args[0] === foothill);
  assert.ok(waterDraw, 'the same transparent relief projects onto water without a shoreline cut');
  assert.equal(waterDraw.args[1], landDraw.args[1]);
  assert.equal(waterDraw.args[2] - e.TS, landDraw.args[2]);
  assert.equal(waterDraw.args[3], landDraw.args[3]);
  assert.equal(waterDraw.args[4], landDraw.args[4]);
});

test('water banks repaint deterministically without consuming gameplay RNG or changing terrain', () => {
  const e = landscape();
  for (let y = 12; y <= 16; y++) for (let x = 12; x <= 16; x++) e.tiles[e.idx(x, y)].t = e.WATER;
  e.SR = () => {
    throw new Error('water painting consumed gameplay RNG');
  };
  const before = JSON.stringify(e.tiles);
  e.paintTileFull(e.ctx, e.idx(12, 12));
  const first = JSON.stringify(e.calls);
  e.calls.length = 0;
  e.paintTileFull(e.ctx, e.idx(12, 12));
  assert.equal(JSON.stringify(e.calls), first);
  assert.equal(JSON.stringify(e.tiles), before);
  assert.ok(
    !e.calls.some((c) => c.key === 'drawImage'),
    'water is painted from world-space washes, never stamped tile textures',
  );
});
