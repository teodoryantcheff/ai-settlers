import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fakeStorage, pinClock } from './helpers/game.cjs';

pinClock(0);

function colony() {
  const { localStorage, storage } = fakeStorage();
  const { game } = createGame({ seed: 2024, headless: true, storage: localStorage });
  game.initializeColony();
  game.tiles = game.tiles.map(() => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  for (const [type, x, y, done, stock] of [
    ['sawmill', 51, 48, false, {}],
    ['lumberjack', 48, 51, true, { logs: 2 }],
    ['warehouse', 45, 48, true, {}],
    ['guard', 48, 45, true, {}],
  ]) {
    const building = game.newBuilding(type, x, y);
    Object.assign(building, { done, stock, constructionProgress: done ? 1 : 0 });
    if (type === 'warehouse') building.targets.stone = 2;
    game.buildings.push(building);
  }
  game.soldierPool = 1;
  game.ensureJobs();
  game.gameEvents.emit('productionControlChanged', {});
  return { game, storage };
}

test('each job kind exports its required fields and round-trips without legacy aliases', () => {
  const { game } = colony();
  const exported = game.exportSave();
  const data = JSON.parse(exported);
  assert.deepEqual([...new Set(data.j.map((job) => job.kind))].sort(), [
    'deliver',
    'fetch',
    'soldier',
    'transfer',
  ]);
  for (const job of data.j) {
    assert.equal(job.status, 'pending');
    assert.equal(Object.hasOwn(job, 'state'), false);
    assert.equal(Object.hasOwn(job, 's'), false);
    assert.equal(Object.hasOwn(job, 'from'), false);
    if (job.kind === 'soldier') {
      assert.deepEqual(Object.keys(job).sort(), ['kind', 'status', 'to']);
    } else {
      assert.ok(job.sourceId > 0);
      assert.equal(typeof job.good, 'string');
      assert.equal(Object.hasOwn(job, 'to'), job.kind !== 'deliver');
    }
  }
  game.importSave(exported);
  assert.equal(game.exportSave(), exported);
});

function historicalSave(exported, version = 2) {
  const data = JSON.parse(exported);
  data.v = version;
  if (version === 1) delete data.rng;
  data.j = data.j.map((job) => ({
    kind: job.kind,
    good: job.good || null,
    to: job.to || 0,
    s: job.kind === 'fetch' || job.kind === 'transfer' ? job.sourceId : 0,
    from: job.kind === 'deliver' || job.kind === 'transfer' ? job.sourceId : 0,
    state: job.status === 'pending' ? 'p' : 't',
  }));
  return JSON.stringify(data);
}

test('legacy job kinds and carrier phases migrate from v1 and v2 without losing assignments or cargo', () => {
  for (const version of [1, 2]) {
    for (const stage of ['pending', 'assigned', 'carrying']) {
      const { game } = colony();
      if (stage !== 'pending') game.assign(0.5);
      if (stage === 'carrying') for (let tick = 0; tick < 30; tick++) game.step(1 / 60, true);
      if (stage === 'assigned') {
        assert.ok(game.jobs.some((job) => job.status === 'assigned'));
        assert.ok(game.units.some((unit) => unit.kind === 'soldier' && unit.job));
        assert.ok(game.units.some((unit) => unit.phase === 'p'));
      }
      if (stage === 'carrying') assert.ok(game.units.some((unit) => unit.carry));
      const expected = JSON.parse(game.exportSave());
      game.importSave(historicalSave(JSON.stringify(expected), version));
      if (version === 1) expected.rng = 1540485501;
      assert.deepEqual(JSON.parse(game.exportSave()), expected);
      for (const unit of game.units) if (unit.job) assert.ok(game.jobs.includes(unit.job));
      const checkpoint = game.saveCheckpoint('Migrated jobs');
      game.loadCheckpoint(checkpoint.id);
      assert.deepEqual(JSON.parse(game.exportSave()), expected);
    }
  }
});

test('legacy browser slots and named checkpoints migrate jobs at the shared save boundary', () => {
  for (const version of [1, 2]) {
    for (const source of ['slot', 'catalog']) {
      const { game, storage } = colony();
      game.assign(0.5);
      const checkpoint = game.saveCheckpoint('Before job rename');
      const expected = JSON.parse(game.exportSave());
      const legacy = historicalSave(JSON.stringify(expected), version);
      if (source === 'slot') {
        storage.delete('settlers.saves.v1');
        storage.set('settlers.save', legacy);
      } else {
        const catalog = JSON.parse(storage.get('settlers.saves.v1'));
        catalog.entries[0].data = JSON.parse(legacy);
        storage.set('settlers.saves.v1', JSON.stringify(catalog));
      }
      game.step(0.25, true);
      if (source === 'slot') assert.equal(game.loadGame(), true);
      else game.loadCheckpoint(checkpoint.id);
      if (version === 1) expected.rng = 1540485501;
      assert.deepEqual(JSON.parse(game.exportSave()), expected);
      game.saveCheckpoint('After job rename');
      for (const entry of JSON.parse(storage.get('settlers.saves.v1')).entries)
        for (const job of entry.data.j) {
          assert.ok(['pending', 'assigned'].includes(job.status));
          assert.equal(Object.hasOwn(job, 's'), false);
          assert.equal(Object.hasOwn(job, 'from'), false);
          assert.equal(Object.hasOwn(job, 'state'), false);
        }
      if (source === 'slot') assert.equal(storage.get('settlers.save'), legacy);
    }
  }
});

test('legacy exported jobs continue the same seeded simulation after migration', () => {
  const { game } = colony();
  game.assign(0.5);
  for (let tick = 0; tick < 30; tick++) game.step(1 / 60, true);
  const legacy = historicalSave(game.exportSave());
  for (let tick = 0; tick < 60 * 60; tick++) game.step(1 / 60, true);
  const expected = game.exportSave();
  game.importSave(legacy);
  for (let tick = 0; tick < 60 * 60; tick++) game.step(1 / 60, true);
  assert.equal(game.exportSave(), expected);
});

test('canonical job fields take precedence over legacy aliases', () => {
  const { game } = colony();
  const expected = game.exportSave();
  const mixed = JSON.parse(expected);
  for (const job of mixed.j) Object.assign(job, { s: 999, from: 998, state: 't' });
  game.importSave(JSON.stringify(mixed));
  assert.equal(game.exportSave(), expected);
});

test('missing kind requirements and invalid canonical or migrated jobs reject before adoption', () => {
  const { game, storage } = colony();
  game.saveCheckpoint('Keep this colony');
  const before = game.exportSave();
  const arrays = [game.tiles, game.buildings, game.jobs, game.units];
  const stored = [...storage];
  const changes = [];
  for (const kind of ['fetch', 'deliver', 'transfer', 'soldier']) {
    const required =
      kind === 'soldier'
        ? ['to']
        : kind === 'deliver'
          ? ['good', 'sourceId']
          : ['good', 'sourceId', 'to'];
    for (const key of [...required, 'status'])
      changes.push((data) => {
        delete data.j.find((job) => job.kind === kind)[key];
      });
  }
  for (const field of [
    { sourceId: null },
    { sourceId: 0 },
    { sourceId: '1' },
    { status: 'p' },
    { status: 'pickup' },
    { status: null },
  ])
    changes.push((data) =>
      Object.assign(
        data.j.find((job) => job.kind === 'fetch'),
        field,
      ),
    );
  for (const field of [{ s: null }, { s: 999 }, { state: 'pickup' }])
    changes.push((data) => {
      Object.assign(data, JSON.parse(historicalSave(JSON.stringify(data))));
      Object.assign(
        data.j.find((job) => job.kind === 'fetch'),
        field,
      );
    });
  changes.push((data) => {
    Object.assign(data, JSON.parse(historicalSave(JSON.stringify(data))));
    data.j.find((job) => job.kind === 'transfer').s = 999;
  });
  for (const change of changes) {
    const data = JSON.parse(before);
    change(data);
    const imported = JSON.stringify(data);
    assert.throws(() => game.inspectSave(imported), /Invalid|Missing/);
    assert.throws(() => game.importSave(imported), /Invalid|Missing/);
    assert.equal(game.exportSave(), before);
    assert.deepEqual([...storage], stored);
    for (const [i, key] of ['tiles', 'buildings', 'jobs', 'units'].entries())
      assert.equal(game[key], arrays[i], key);
  }
});
