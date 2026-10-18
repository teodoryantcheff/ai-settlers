import test from 'node:test';
import assert from 'node:assert/strict';
function worldWithoutAttention(text) {
  const data = JSON.parse(text);
  delete data.attention;
  return data;
}
import { createGame } from './helpers/game.cjs';

function colony(values = new Map()) {
  const accesses = [];
  let blocked = false;
  const storage = {
    getItem(key) {
      accesses.push({ operation: 'get', key });
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      accesses.push({ operation: 'set', key });
      if (blocked) throw new Error('Storage quota exhausted');
      values.set(key, value);
    },
    removeItem(key) {
      accesses.push({ operation: 'remove', key });
      if (blocked) throw new Error('Storage quota exhausted');
      values.delete(key);
    },
  };
  const { game } = createGame({
    seed: 2024,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
    storage,
  });
  game.initializeColony();
  return {
    game,
    values,
    accesses,
    setBlocked(value) {
      blocked = value;
    },
  };
}

test('file export works without a storage write and quiet autosave failures remain visible', () => {
  const { game, values, setBlocked } = colony();
  game.saveGame();
  const saved = [...values.entries()];
  const events = [];
  game.gameEvents.on('storageResult', (event) => events.push(event));
  setBlocked(true);
  assert.equal(JSON.parse(game.exportSave()).seed, 2024);
  assert.equal(game.saveGame(true), false);
  assert.equal(events.at(-1).ok, false);
  assert.match(events.at(-1).message, /quota/i);
  assert.equal(game.saveHealth.ok, false);
  assert.deepEqual([...values.entries()], saved);
});

test('named checkpoints keep metadata and identity, autosave remains separate, and CRUD is explicit', () => {
  const { game } = colony();
  game.setColonyName('Riverbend');
  const first = game.saveCheckpoint('Before expansion');
  assert.equal(game.hasUnsavedProgress(), false);
  game.step(0.25);
  assert.equal(game.hasUnsavedProgress(), true);
  const second = game.saveCheckpoint('Frontier');
  assert.notEqual(first.id, second.id);
  assert.equal(second.colonyName, 'Riverbend');
  assert.equal(second.seed, 2024);
  assert.equal(second.simulationAge, 0.25);
  assert.equal(second.buildingCount, 1);
  assert.equal(second.gold, 0);
  assert.ok(second.savedAt > 0);
  assert.equal(game.saveGame(true), true);
  assert.deepEqual(
    game
      .listSaves()
      .map((entry) => entry.kind)
      .sort(),
    ['autosave', 'manual', 'manual'],
  );
  game.renameCheckpoint(first.id, 'Timber reserve');
  assert.equal(game.listSaves().find((entry) => entry.id === first.id).name, 'Timber reserve');
  game.setColonyName('Later colony');
  game.loadCheckpoint(first.id);
  assert.equal(game.colonyName, 'Riverbend');
  assert.equal(game.state.time, 0);
  assert.equal(game.hasUnsavedProgress(), false);
  game.saveCheckpoint('Overwritten', second.id);
  assert.equal(game.listSaves().find((entry) => entry.id === second.id).simulationAge, 0);
  game.deleteCheckpoint(first.id);
  assert.equal(
    game.listSaves().some((entry) => entry.id === first.id),
    false,
  );
});

test('failed creation, overwrite, deletion and import preserve the old catalog and live world', () => {
  const { game, values, setBlocked } = colony();
  game.setColonyName('Northbank');
  const exported = game.exportSave();
  setBlocked(true);
  assert.throws(() => game.saveCheckpoint('First checkpoint'), /quota/i);
  assert.equal(values.has('settlers.saves'), false);
  setBlocked(false);
  const saved = game.saveCheckpoint('Original');
  const catalog = values.get('settlers.saves');
  game.step(0.25);
  const live = game.exportSave();
  setBlocked(true);
  assert.throws(() => game.saveCheckpoint('Replacement', saved.id), /quota/i);
  assert.throws(() => game.deleteCheckpoint(saved.id), /quota/i);
  assert.throws(() => game.importSave(exported), /quota/i);
  assert.equal(values.get('settlers.saves'), catalog);
  assert.deepEqual(worldWithoutAttention(game.exportSave()), worldWithoutAttention(live));
  const events = game.activityHistory().events;
  assert.ok(events.some((event) => event.kind === 'storage-failed'));
  assert.ok(
    JSON.parse(live).attention.events.every((old) =>
      events.some((event) => event.id === old.id && event.message === old.message),
    ),
  );
  const hostile = JSON.parse(live);
  hostile.identity = { name: '<img onerror=alert(1)>', extra: true };
  setBlocked(false);
  game.importSave(JSON.stringify(hostile));
  assert.deepEqual(JSON.parse(game.exportSave()).identity, { name: '<img onerror=alert(1)>' });
});

test('catalog validation derives metadata and rejects malformed entries before adoption', () => {
  const { game, values } = colony();
  const entry = game.saveCheckpoint('Valid');
  const original = values.get('settlers.saves');
  const live = game.exportSave();
  const invalid = [
    (data) => {
      data.v = 1;
    },
    (data) => {
      data.entries[0].data.v = 2;
    },
    (data) => {
      data.entries[0].name = 'x'.repeat(81);
    },
    (data) => {
      data.entries[0].savedAt = -1;
    },
    (data) => {
      data.entries[0].data.identity.name = 4;
    },
    (data) => {
      data.entries[0].data.t[0].pop();
    },
    (data) => {
      data.entries = Array.from({ length: 51 }, () => data.entries[0]);
    },
    (data) => {
      data.entries.push(data.entries[0]);
    },
  ];
  for (const corrupt of invalid) {
    const bad = JSON.parse(original);
    corrupt(bad);
    values.set('settlers.saves', JSON.stringify(bad));
    assert.throws(() => game.loadCheckpoint(entry.id));
    assert.deepEqual(worldWithoutAttention(game.exportSave()), worldWithoutAttention(live));
    const events = game.activityHistory().events;
    assert.ok(events.some((event) => event.kind === 'storage-failed'));
    assert.ok(
      JSON.parse(live).attention.events.every((old) =>
        events.some((event) => event.id === old.id && event.message === old.message),
      ),
    );
  }
  values.set('settlers.saves', original);
  assert.equal(game.listSaves()[0].buildingCount, 1);
});

test('autosave neither reads nor rewrites named checkpoints and still continues', () => {
  const { game, values, accesses } = colony();
  for (let i = 0; i < 10; i++) game.saveCheckpoint('Checkpoint ' + i);
  const catalog = values.get('settlers.saves');
  game.step(0.25);
  accesses.length = 0;
  assert.equal(game.saveGame(true), true);
  assert.deepEqual(
    accesses.filter((access) => access.key === 'settlers.saves'),
    [],
  );
  assert.equal(values.get('settlers.saves'), catalog);
  assert.equal(game.hasUnsavedProgress(), false);
  const saves = game.listSaves();
  assert.equal(saves.length, 11);
  assert.equal(saves[0].kind, 'autosave');
  assert.equal(saves[0].simulationAge, 0.25);
  game.step(0.25);
  assert.equal(game.loadGame(), true);
  assert.equal(game.state.time, 0.25);
  assert.equal(game.hasUnsavedProgress(), false);
  assert.equal(game.saveHealth.ok, true);
});

test('a damaged autosave is reported without hiding checkpoints and stays deletable', () => {
  const { game, values } = colony();
  game.saveCheckpoint('Kept');
  game.saveGame(true);
  values.set('settlers.autosave', '{"savedAt":1,"data":{}}');
  const failures = [];
  game.gameEvents.on('storageResult', (event) => failures.push(event));
  const saves = game.listSaves();
  assert.deepEqual(
    saves.map((entry) => entry.name),
    ['Kept'],
  );
  assert.equal(game.saveHealth.ok, false);
  game.listSaves();
  game.loadCheckpoint(saves[0].id);
  assert.equal(failures.filter((event) => !event.ok).length, 1);
  game.deleteCheckpoint('autosave');
  assert.equal(values.has('settlers.autosave'), false);
  assert.equal(game.saveHealth.ok, true);
  assert.equal(game.saveGame(true), true);
  game.deleteCheckpoint('autosave');
  assert.deepEqual(
    game.listSaves().map((entry) => entry.kind),
    ['manual'],
  );
  assert.throws(() => game.deleteCheckpoint('autosave'), /no longer exists/);
});

test('existing browser records stay unread and untouched while new saves survive a fresh boot', () => {
  const source = colony().game;
  const marked = { ...JSON.parse(source.exportSave()), v: 2, economy: 2 };
  const oldRecords = [
    [
      'settlers.saves.v1',
      JSON.stringify({
        v: 1,
        nextId: 2,
        entries: [{ id: 'save-1', name: 'Old colony', kind: 'manual', savedAt: 1, data: marked }],
      }),
    ],
    ['settlers.autosave.v1', JSON.stringify({ v: 1, savedAt: 2, data: marked })],
  ];
  const values = new Map(oldRecords);
  const { game, accesses } = colony(values);
  assert.deepEqual(game.listSaves(), []);
  assert.equal(game.saveHealth.ok, true);
  assert.equal(game.saveHealth.savedAt, null);
  game.setColonyName('Fresh colony');
  const checkpoint = game.saveCheckpoint('Keep');
  game.step(0.25);
  assert.equal(game.saveGame(true), true);
  const expected = game.exportSave();
  const snapshot = JSON.parse(expected);
  assert.equal(Object.hasOwn(snapshot, 'v'), false);
  assert.equal(Object.hasOwn(snapshot, 'economy'), false);
  assert.deepEqual(Object.keys(JSON.parse(values.get('settlers.saves'))), ['nextId', 'entries']);
  assert.deepEqual(Object.keys(JSON.parse(values.get('settlers.autosave'))), ['savedAt', 'data']);
  // Explicit timestamps keep Continue selection independent of wall-clock granularity.
  const catalog = JSON.parse(values.get('settlers.saves'));
  catalog.entries[0].savedAt = 1;
  values.set('settlers.saves', JSON.stringify(catalog));
  const autosave = JSON.parse(values.get('settlers.autosave'));
  autosave.savedAt = 2;
  values.set('settlers.autosave', JSON.stringify(autosave));
  const rebooted = colony(values);
  assert.equal(rebooted.game.listSaves().length, 2);
  assert.equal(rebooted.game.loadGame(), true);
  assert.equal(rebooted.game.exportSave(), expected);
  rebooted.game.loadCheckpoint(checkpoint.id);
  assert.equal(rebooted.game.state.time, 0);
  rebooted.game.deleteCheckpoint('autosave');
  rebooted.game.deleteCheckpoint(checkpoint.id);
  for (const [key, value] of oldRecords) {
    assert.equal(values.get(key), value);
    assert.equal(
      [...accesses, ...rebooted.accesses].some((access) => access.key === key),
      false,
    );
  }
});
