import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fakeStorage, pinClock } from './helpers/game.cjs';

pinClock(0);

/** A cleared colony with every job kind: construction, delivery, transfer and garrison. */
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

test('every job kind and carrier stage round-trips exactly through files and checkpoints', () => {
  for (const stage of ['pending', 'assigned', 'carrying']) {
    const { game } = colony();
    if (stage !== 'pending') game.assign(0.5);
    if (stage === 'carrying') for (let tick = 0; tick < 30; tick++) game.step(1 / 60, true);
    const exported = game.exportSave();
    const data = JSON.parse(exported);
    assert.deepEqual([...new Set(data.j.map((job) => job.kind))].sort(), [
      'deliver',
      'fetch',
      'soldier',
      'transfer',
    ]);
    if (stage === 'assigned') assert.ok(data.u.some((unit) => unit.phase === 'p'));
    if (stage === 'carrying') assert.ok(data.u.some((unit) => unit.carry));
    for (const job of data.j)
      if (job.kind === 'soldier')
        assert.deepEqual(Object.keys(job).sort(), ['kind', 'status', 'to']);
      else assert.equal(Object.hasOwn(job, 'to'), job.kind !== 'deliver');
    assert.ok(
      data.b.some((b) => Object.keys(b.reservedStock).length),
      'promised goods are saved',
    );
    game.importSave(exported);
    assert.equal(game.exportSave(), exported);
    for (const unit of game.units) if (unit.job) assert.ok(game.jobs.includes(unit.job));
    const checkpoint = game.saveCheckpoint('Round trip');
    game.step(0.25, true);
    game.loadCheckpoint(checkpoint.id);
    assert.equal(game.exportSave(), exported);
  }
});

test('an exported colony continues the same seeded simulation after import', () => {
  const { localStorage } = fakeStorage();
  const { game } = createGame({ seed: 2024, headless: true, storage: localStorage });
  game.initializeColony();
  game.state.auto = true;
  game.state.paused = false;
  for (let tick = 0; tick < 120 * 60; tick++) game.step(1 / 60);
  const saved = game.exportSave();
  for (let tick = 0; tick < 60 * 60; tick++) game.step(1 / 60);
  const expected = game.exportSave();
  game.importSave(saved);
  for (let tick = 0; tick < 60 * 60; tick++) game.step(1 / 60);
  assert.equal(game.exportSave(), expected);
});

test('saved quarry notice history suppresses repeats and resets only after successful production', () => {
  const { localStorage } = fakeStorage();
  const { game } = createGame({ seed: 2024, headless: true, storage: localStorage });
  game.initializeColony();
  game.tiles = game.tiles.map(() => ({
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
  game.importSave(game.exportSave());
  game.step(4.25);
  assert.deepEqual(notices, [quarry.id], 'loading does not repeat the exhaustion notice');
  game.tiles[game.idx(52, 48)].rock = { amt: 1 };
  game.step(4.25);
  assert.equal(game.byId(quarry.id).rocksExhaustedNoticeSent, false);
  assert.equal(game.byId(quarry.id).stock.stone, 1);
  game.step(20);
  assert.deepEqual(notices, [quarry.id, quarry.id], 'a later exhaustion can be reported again');
});

test('older, incomplete or invalid saves are rejected before any colony or storage change', () => {
  const { game, storage } = colony();
  game.assign(0.5);
  for (let tick = 0; tick < 30; tick++) game.step(1 / 60, true);
  game.saveCheckpoint('Keep this colony');
  const before = game.exportSave();
  const arrays = [game.tiles, game.buildings, game.jobs, game.units];
  const stored = [...storage];
  const fetch = (data) => data.j.find((job) => job.kind === 'fetch');
  const changes = [
    // Older formats are not migrated.
    [(data) => (data.v = 1), /Unsupported save version/],
    [(data) => (data.v = 3), /Unsupported save version/],
    [(data) => (data.economy = 1), /Unsupported save version/],
    [
      (data) => {
        data.b[0].res = data.b[0].reservedStock;
        delete data.b[0].reservedStock;
      },
      /Invalid/,
    ],
    [
      (data) => {
        const job = fetch(data);
        Object.assign(job, { s: job.sourceId, state: 't' });
        delete job.sourceId;
        delete job.status;
      },
      /Invalid|Missing/,
    ],
    [(data) => (data.b[0].legacyIndustry = true), /legacy industry/],
    // Historical cargo must match current recipes and outputs.
    [
      (data) => {
        const producer = data.b.find((b) => b.type === 'lumberjack');
        data.j.push({ kind: 'deliver', good: 'food', sourceId: producer.id, status: 'pending' });
      },
      /Invalid delivery source/,
    ],
    [
      (data) => {
        const producer = data.b.find((b) => b.type === 'lumberjack');
        Object.assign(fetch(data), { good: 'iron', to: producer.id });
      },
      /Invalid fetch destination/,
    ],
    // Invalid values in the current format.
    [(data) => (data.b[0].constructionProgress = -1), /Invalid/],
    [(data) => (data.b[0].reservedStock = { planks: -1 }), /Invalid/],
    [(data) => (data.b[0].reservedStock = { foreign: 1 }), /Invalid/],
    [(data) => (data.b[0].blockedReason = '__proto__'), /Invalid/],
    [(data) => (fetch(data).sourceId = 999), /Missing/],
    [(data) => (fetch(data).status = 'pickup'), /Invalid/],
    [(data) => (data.st.upgrades.haul = 9), /Invalid/],
  ];
  // Every field the writer emits is required.
  const sample = JSON.parse(before);
  for (const key of Object.keys(sample))
    changes.push([(data) => delete data[key], /Unsupported|Invalid|Missing|Wrong/]);
  for (const [section, pick] of [
    ['b', (data) => data.b[0]],
    ['b.metrics', (data) => data.b[0].metrics],
    ['u', (data) => data.u.find((unit) => unit.carry)],
    ['j', fetch],
    ['st', (data) => data.st],
    ['p', (data) => data.p],
  ])
    for (const key of Object.keys(pick(sample)))
      changes.push([(data) => delete pick(data)[key], /Invalid|Missing/, `${section}.${key}`]);
  for (const [change, error, label] of changes) {
    const data = JSON.parse(before);
    change(data);
    const imported = JSON.stringify(data);
    assert.throws(() => game.inspectSave(imported), error, label);
    assert.throws(() => game.importSave(imported), error, label);
    assert.equal(game.exportSave(), before);
    assert.deepEqual([...storage], stored);
    for (const [i, key] of ['tiles', 'buildings', 'jobs', 'units'].entries())
      assert.equal(game[key], arrays[i], key);
  }
});
