import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fakeStorage, pinClock } from './helpers/game.cjs';

pinClock(0);

function colony(seed = 2024) {
  const { localStorage, storage } = fakeStorage();
  const { game } = createGame({ seed, headless: true, storage: localStorage });
  game.initializeColony();
  return { game, storage };
}

test('new exports use glossary field names and round-trip through files and checkpoints', () => {
  const { game } = colony();
  const exported = game.exportSave();
  const hq = JSON.parse(exported).b[0];
  assert.deepEqual(hq.reservedStock, {});
  assert.equal(hq.constructionProgress, 1);
  assert.equal(hq.manned, false);
  assert.equal(hq.foodBlockedNoticeSent, false);
  assert.equal(hq.rocksExhaustedNoticeSent, false);
  for (const key of ['res', 'prog', 'man', 'nofood', 'norock'])
    assert.equal(Object.hasOwn(hq, key), false, key);
  assert.ok(game.tiles.every((tile) => Object.hasOwn(tile, 'deposit')));
  assert.ok(game.tiles.some((tile) => tile.deposit?.kind === 'gold'));
  game.importSave(exported);
  assert.equal(game.exportSave(), exported);
  const checkpoint = game.saveCheckpoint('Glossary fields');
  game.step(0.25);
  game.loadCheckpoint(checkpoint.id);
  assert.equal(game.exportSave(), exported);
});

test('legacy building fields preserve reservations, construction, garrisons and sent notices', () => {
  for (const version of [1, 2]) {
    const { game } = colony();
    const site = game.newBuilding('sawmill', 51, 48);
    site.constructionProgress = 0.4;
    game.buildings.push(site);
    const guard = game.newBuilding('guard', 50, 48);
    Object.assign(guard, { done: true, constructionProgress: 1, manned: true });
    game.buildings.push(guard);
    const quarry = game.newBuilding('quarry', 49, 50);
    Object.assign(quarry, {
      done: true,
      constructionProgress: 1,
      rocksExhaustedNoticeSent: true,
      blockedReason: 'resources',
    });
    game.buildings.push(quarry);
    const mine = game.newBuilding('mine_gold', 50, 50);
    Object.assign(mine, { done: true, constructionProgress: 1, foodBlockedNoticeSent: true });
    game.buildings.push(mine);
    game.ensureJobs();
    game.step(0.5, true);
    const expected = JSON.parse(game.exportSave());
    assert.ok(expected.b[0].reservedStock.planks > 0, 'include promised construction goods');
    game.importSave(historicalSave(JSON.stringify(expected), version));
    const actual = JSON.parse(game.exportSave());
    if (version === 1) expected.rng = actual.rng;
    assert.deepEqual(actual, expected);
    const checkpoint = game.saveCheckpoint('Migrated notices and promises');
    game.loadCheckpoint(checkpoint.id);
    assert.deepEqual(JSON.parse(game.exportSave()), expected);
    assert.ok(game.tiles.some((tile) => tile.deposit?.kind === 'gold'));
  }
});

function historicalSave(exported, version = 2) {
  const data = JSON.parse(exported);
  data.v = version;
  if (version === 1) delete data.rng;
  for (const b of data.b) {
    b.res = b.reservedStock;
    b.prog = b.constructionProgress;
    b.man = b.manned;
    b.nofood = b.foodBlockedNoticeSent;
    b.norock = b.rocksExhaustedNoticeSent;
    for (const key of [
      'reservedStock',
      'constructionProgress',
      'manned',
      'foodBlockedNoticeSent',
      'rocksExhaustedNoticeSent',
    ])
      delete b[key];
  }
  return JSON.stringify(data);
}

test('legacy exported files continue seeded construction, cargo, production and RNG exactly', () => {
  const { game } = colony();
  game.state.auto = true;
  game.state.paused = false;
  for (let tick = 0; tick < 120 * 60; tick++) game.step(1 / 60);
  const legacy = historicalSave(game.exportSave());
  for (let tick = 0; tick < 60 * 60; tick++) game.step(1 / 60);
  const expected = game.exportSave();
  game.importSave(legacy);
  for (let tick = 0; tick < 60 * 60; tick++) game.step(1 / 60);
  assert.equal(game.exportSave(), expected);
});

test('old browser slots and existing named checkpoints migrate through the shared save boundary', () => {
  for (const version of [1, 2]) {
    for (const source of ['slot', 'catalog']) {
      const { game, storage } = colony();
      const checkpoint = game.saveCheckpoint('Before rename');
      const original = game.exportSave();
      const legacy = historicalSave(original, version);
      if (source === 'slot') {
        storage.delete('settlers.saves.v1');
        storage.set('settlers.save', legacy);
      } else {
        const catalog = JSON.parse(storage.get('settlers.saves.v1'));
        catalog.entries[0].data = JSON.parse(legacy);
        storage.set('settlers.saves.v1', JSON.stringify(catalog));
      }
      game.step(0.25);
      if (source === 'slot') assert.equal(game.loadGame(), true);
      else game.loadCheckpoint(checkpoint.id);
      const expected = JSON.parse(original);
      // Version one predates RNG persistence and restarts from its seeded fallback.
      if (version === 1) expected.rng = 1540485501;
      assert.deepEqual(JSON.parse(game.exportSave()), expected);
      game.saveCheckpoint('After migration');
      const rewritten = JSON.parse(storage.get('settlers.saves.v1'));
      for (const entry of rewritten.entries) {
        assert.deepEqual(entry.data.b[0].reservedStock, {});
        assert.equal(entry.data.b[0].constructionProgress, 1);
        assert.equal(Object.hasOwn(entry.data.b[0], 'res'), false);
      }
      if (source === 'slot') assert.equal(storage.get('settlers.save'), legacy);
    }
  }
});

test('canonical fields take precedence over aliases, including zero and false values', () => {
  const { game } = colony();
  const site = game.newBuilding('sawmill', 51, 48);
  game.buildings.push(site);
  const expected = game.exportSave();
  const mixed = JSON.parse(expected);
  for (const b of mixed.b) {
    Object.assign(b, { res: { foreign: 100 }, prog: 1.5, man: true, nofood: true, norock: true });
  }
  game.importSave(JSON.stringify(mixed));
  assert.equal(game.exportSave(), expected);
});

test('invalid migrated or canonical fields cannot change the live colony or stored checkpoints', () => {
  const { game, storage } = colony();
  game.saveCheckpoint('Keep this world');
  const before = game.exportSave();
  const saved = [...storage.entries()];
  const buildings = game.buildings;
  const tiles = game.tiles;
  const invalid = [
    { prog: -1 },
    { prog: '0.5' },
    { res: { foreign: 1 } },
    { res: { planks: -1 } },
    { res: { planks: 1 } },
    { constructionProgress: null },
    { reservedStock: null },
  ];
  for (const fields of invalid) {
    const imported = JSON.parse(historicalSave(before));
    Object.assign(imported.b[0], fields);
    assert.throws(() => game.importSave(JSON.stringify(imported)), /Invalid/);
    assert.equal(game.exportSave(), before);
    assert.deepEqual([...storage.entries()], saved);
    assert.equal(game.buildings, buildings);
    assert.equal(game.tiles, tiles);
  }
});

test('saved quarry notice history suppresses repeats and resets only after successful production', () => {
  const { game } = colony();
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  const quarry = game.newBuilding('quarry', 51, 48);
  Object.assign(quarry, { done: true, constructionProgress: 1, timer: 0 });
  game.buildings.push(quarry);
  const notices = [];
  game.gameEvents.on('rocksExhausted', ({ building }) => notices.push(building.id));
  game.step(0.25);
  assert.deepEqual(notices, [quarry.id]);
  game.importSave(historicalSave(game.exportSave()));
  game.step(4.25);
  assert.deepEqual(notices, [quarry.id], 'loading does not repeat the exhaustion notice');
  game.tiles[game.idx(52, 48)].rock = { amt: 1 };
  game.step(4.25);
  assert.equal(game.byId(quarry.id).rocksExhaustedNoticeSent, false);
  assert.equal(game.byId(quarry.id).stock.stone, 1);
  game.step(20);
  assert.deepEqual(notices, [quarry.id, quarry.id], 'a later exhaustion can be reported again');
});
