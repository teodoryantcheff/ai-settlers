'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeStorage } = require('./helpers/game.cjs');

function colony(fog = true, seed = 42) {
  const { game } = createGame({ seed, headless: true, storage: fakeStorage().localStorage });
  game.resetColony(seed, 'Explorers', fog);
  return game;
}

function completeFoundations(g) {
  for (const [type, x, y] of [
    ['lumberjack', 43, 48],
    ['sawmill', 46, 45],
    ['forester', 43, 46],
    ['quarry', 53, 45],
    ['fisherman', 48, 52],
  ]) {
    const b = g.newBuilding(type, x, y);
    Object.assign(b, { done: true, constructionProgress: 1 });
    g.buildings.push(b);
  }
  g.recomputeTerritory();
}

test('headquarters reveals a permanent circle independently of territory', () => {
  const g = colony();
  assert.equal(g.state.explorationFog, true);
  assert.equal(g.isRevealed(g.idx(60, 48)), true);
  assert.equal(g.isRevealed(g.idx(60, 49)), false);
  assert.equal(g.isRevealed(g.idx(61, 48)), false);
  const b = g.newBuilding('guard', 59, 48);
  g.buildings.push(b);
  g.recomputeTerritory();
  assert.equal(g.isRevealed(g.idx(64, 48)), false);
  b.done = true;
  g.recomputeTerritory();
  assert.equal(g.isRevealed(g.idx(64, 48)), true);
  assert.equal(g.isRevealed(g.idx(68, 48)), false);
  b.manned = true;
  g.recomputeTerritory();
  assert.equal(g.isRevealed(g.idx(68, 48)), true);
  b.manned = false;
  g.buildings.pop();
  g.recomputeTerritory();
  assert.equal(g.isRevealed(g.idx(68, 48)), true);
  assert.equal(g.owned[g.idx(68, 48)], 0);
});

test('hidden terrain cannot change placement evidence or reveal supporting resources', () => {
  const g = colony();
  const hidden = g.idx(61, 48);
  const before = g.previewPlacement('quarry', { x: 61, y: 48 });
  Object.assign(g.tiles[hidden], {
    t: g.MTN,
    rock: { amt: 200 },
    deposit: { kind: 'gold', amt: 99, amt0: 99 },
  });
  g.emitGameEvent('tileChanged', { index: hidden });
  const after = g.previewPlacement('quarry', { x: 61, y: 48 });
  assert.deepEqual(after.checks, before.checks);
  assert.equal(after.checks.reason.code, 'unexplored');
  assert.deepEqual(after.resources, []);
  assert.equal(after.path, null);
  assert.equal(after.summary, 'Unexplored land');
  assert.deepEqual(g.canPlace('quarry', 61, 48), [false, { code: 'unexplored' }]);
});

test('historical discoveries persist through files, checkpoints and autosaves; invalid imports are atomic', () => {
  for (const fog of [true, false]) {
    const g = colony(fog);
    // A real completed outpost reveals land that outlives its source.
    const b = g.newBuilding('guard', 57, 48);
    Object.assign(b, { done: true, constructionProgress: 1, manned: true });
    g.buildings.push(b);
    g.recomputeTerritory();
    g.demolish(b);
    const known = Array.from(g.revealed);
    const exported = g.exportSave();
    const checkpoint = g.saveCheckpoint('Discoveries');
    g.saveAutosave();
    for (const load of [
      () => g.importSave(exported),
      () => g.loadCheckpoint(checkpoint.id),
      () => g.loadCheckpoint('autosave'),
    ]) {
      load();
      assert.deepEqual(Array.from(g.revealed), known);
      assert.equal(g.state.explorationFog, fog);
    }
    const before = g.exportSave();
    for (const mutate of [
      (d) => delete d.revealed,
      (d) => d.revealed.pop(),
      (d) => (d.revealed[0] = 2),
      (d) => (d.revealed[g.idx(48, 48)] = 0),
      (d) => delete d.st.explorationFog,
      (d) => (d.st.explorationFog = 'true'),
    ]) {
      const bad = JSON.parse(before);
      mutate(bad);
      assert.throws(() => g.importSave(JSON.stringify(bad)));
      assert.equal(g.exportSave(), before);
    }
  }
});

test('fog starts with reachable, usable timber, stone and food across seeds', () => {
  const { workTiles } = require('../src/gameplay/work-area.ts');
  for (const seed of [0, 1, 27, 42, 123, 777, 2024]) {
    const g = colony(true, seed);
    for (const type of ['lumberjack', 'quarry', 'fisherman']) {
      let usable = false;
      for (let y = 38; y <= 58 && !usable; y++)
        for (let x = 38; x <= 58 && !usable; x++)
          if (
            g.canPlace(type, x, y)[0] &&
            workTiles(g, type, { x, y }).some(g.isRevealed) &&
            g.findPath(48, 48, x, y, g.isRevealed)
          )
            usable = true;
      assert.ok(usable, `${type} has a reachable known opportunity for seed ${seed}`);
    }
    const repeated = colony(true, seed);
    assert.deepEqual(g.tiles, repeated.tiles);
    assert.deepEqual(g.revealed, repeated.revealed);
  }
  assert.ok(colony(false).revealed.every((v) => v === 1));
});

test('completing a producer reveals supporting resources without revealing during construction or movement', () => {
  const g = colony();
  const hidden = g.idx(61, 48);
  Object.assign(g.tiles[hidden], { t: g.GRASS, tree: 4, rock: null, deposit: null });
  assert.ok(!g.previewPlacement('lumberjack', { x: 56, y: 48 }).resources.includes(hidden));
  assert.ok(g.placeBuilding('lumberjack', 56, 48));
  const known = Array.from(g.revealed);
  g.units[0].x = 70;
  g.units[0].y = 48;
  g.step(1 / 60);
  assert.deepEqual(Array.from(g.revealed), known);
  const b = g.buildings.find((b) => b.type === 'lumberjack');
  for (let i = 0; i < 180 * 60 && !b.done; i++) g.step(1 / 60);
  assert.ok(b.done);
  assert.ok(g.isRevealed(hidden));
  assert.ok(g.previewPlacement('lumberjack', b).resources.includes(hidden));
});

test('hidden terrain and deposits cannot change expansion advice or autoplay choices', () => {
  const a = colony(),
    b = colony();
  completeFoundations(a);
  completeFoundations(b);
  assert.ok(a.mineDeficits().includes('gold'), 'the planner is actually seeking a deposit');
  for (let i = 0; i < b.tiles.length; i++)
    if (!b.isRevealed(i))
      Object.assign(b.tiles[i], {
        t: b.MTN,
        tree: 0,
        rock: null,
        deposit: { kind: 'gold', amt: 400, amt0: 400 },
      });
  assert.deepEqual(a.advTargets(), b.advTargets());
  for (let i = 0; i < 5; i++) {
    a.autoTick(2);
    b.autoTick(2);
    assert.deepEqual(a.buildings, b.buildings);
    assert.equal(a.SR.getState(), b.SR.getState());
  }
});

test('unknown stone cannot authorize a quarry; completion makes newly discovered stone usable', () => {
  const g = colony();
  for (const tile of g.tiles) tile.rock = null;
  const hidden = g.idx(61, 48);
  Object.assign(g.tiles[hidden], { t: g.GRASS, rock: { amt: 100 }, tree: 0 });
  const site = { x: 57, y: 48 };
  assert.deepEqual(g.canPlace('quarry', site.x, site.y), [false, { code: 'no-rocks' }]);
  assert.ok(!g.previewPlacement('quarry', site).resources.includes(hidden));
  assert.equal(g.placeBuilding('quarry', site.x, site.y), false);
  assert.ok(g.placeBuilding('warehouse', 54, 51));
  const warehouse = g.buildings.find((b) => b.type === 'warehouse');
  for (let tick = 0; tick < 180 * 60 && !warehouse.done; tick++) g.step(1 / 60);
  assert.ok(warehouse.done);
  assert.ok(g.isRevealed(hidden));
  assert.ok(g.previewPlacement('quarry', site).resources.includes(hidden));
  assert.ok(g.placeBuilding('quarry', site.x, site.y));
});

test('discovery covers map edges, impassable terrain and offset working geometry', () => {
  const g = colony();
  Object.assign(g.tiles[g.idx(1, 1)], { t: g.GRASS });
  Object.assign(g.tiles[g.idx(0, 0)], { t: g.WATER });
  Object.assign(g.tiles[g.idx(2, 0)], { t: g.MTN });
  const well = g.newBuilding('well', 1, 1);
  Object.assign(well, { done: true, constructionProgress: 1 });
  const lumber = g.newBuilding('lumberjack', 70, 70);
  Object.assign(lumber, { done: true, constructionProgress: 1 });
  const forester = g.newBuilding('forester', 76, 70);
  Object.assign(forester, { done: true, constructionProgress: 1 });
  g.buildings.push(well, lumber, forester);
  g.recomputeTerritory();
  assert.ok(g.isRevealed(g.idx(0, 0)), 'discovery crosses water at the map corner');
  assert.ok(g.isRevealed(g.idx(2, 0)), 'discovery crosses mountain');
  assert.ok(g.isRevealed(g.idx(65, 70)), 'offset nursery is revealed');
  assert.ok(g.isRevealed(g.idx(63, 70)), 'nursery has its expansion margin');
});

test('fog preserves exact seeded continuation through import', () => {
  const a = colony(),
    b = colony();
  a.state.auto = true;
  for (let tick = 0; tick < 60 * 60; tick++) a.step(1 / 60);
  b.importSave(a.exportSave());
  for (let tick = 0; tick < 60 * 60; tick++) {
    a.step(1 / 60);
    b.step(1 / 60);
  }
  assert.equal(a.exportSave(), b.exportSave());
});

test('a known deposit corridor chooses a known approach instead of stopping at its first hidden neighbor', () => {
  const g = colony();
  Object.assign(g.tiles[g.idx(60, 48)], {
    t: g.MTN,
    tree: 0,
    rock: null,
    deposit: { kind: 'gold', amt: 100, amt0: 100 },
  });
  Object.assign(g.tiles[g.idx(61, 48)], { t: g.GRASS, tree: 0, rock: null, deposit: null });
  assert.equal(g.isRevealed(g.idx(61, 48)), false);
  const corridor = g.buildCorridor(['gold']);
  assert.ok(corridor, 'the revealed western approach remains available');
  assert.ok(corridor.every(g.isRevealed));
  assert.equal(corridor.at(-1), g.idx(59, 48));
});

test('unaffordable exploration keeps the known economy running and retries after supplies recover', () => {
  const g = colony();
  completeFoundations(g);
  const hq = g.anyStorage();
  hq.stock.weapons = 0;
  g.state.auto = true;
  const initialLogs = g.observationData.totals.produced.logs || 0;
  for (let tick = 0; tick < 30 * 60; tick++) g.step(1 / 60);
  assert.equal(g.buildings.filter((b) => b.type === 'guard').length, 0);
  assert.ok(
    (g.observationData.totals.produced.logs || 0) > initialLogs,
    'timber production continues',
  );
  const advice = g.advTargets().find((r) => r.bt === 'guard');
  assert.ok(advice.why.includes('Waiting for 1 weapons'));
  hq.stock.weapons = 6;
  g.autoT = 0;
  g.autoTick(2);
  assert.ok(
    g.buildings.some((b) => b.type === 'guard'),
    'expansion retries when affordable',
  );
});

test('imports reject construction sites and roads placed on unexplored land', () => {
  const g = colony();
  assert.ok(g.placeBuilding('well', 51, 48));
  const before = g.exportSave();
  const unknown = g.tiles.findIndex((tile, i) => !g.isRevealed(i) && tile.t === g.GRASS);
  for (const mutate of [
    (d) => {
      const site = d.b.find((b) => b.type === 'well');
      site.x = unknown % g.W;
      site.y = Math.floor(unknown / g.W);
    },
    (d) => {
      d.t[3][unknown] = 1;
    },
  ]) {
    const bad = JSON.parse(before);
    mutate(bad);
    assert.throws(() => g.importSave(JSON.stringify(bad)), /unexplored/i);
    assert.equal(g.exportSave(), before);
  }
});
