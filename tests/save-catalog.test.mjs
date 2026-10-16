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

test('failed overwrite, deletion, migration and import preserve the old catalog and live world', () => {
  const { game, values, setBlocked } = colony();
  game.setColonyName('Northbank');
  const legacy = game.exportSave();
  values.set('settlers.save', legacy);
  assert.equal(game.listSaves()[0].kind, 'legacy');
  setBlocked(true);
  assert.throws(() => game.saveCheckpoint('First migrated checkpoint'), /quota/i);
  assert.equal(values.get('settlers.save'), legacy);
  assert.equal(values.has('settlers.saves.v1'), false);
  setBlocked(false);
  const saved = game.saveCheckpoint('Original');
  const catalog = values.get('settlers.saves.v1');
  game.step(0.25);
  const live = game.exportSave();
  setBlocked(true);
  assert.throws(() => game.saveCheckpoint('Replacement', saved.id), /quota/i);
  assert.throws(() => game.deleteCheckpoint(saved.id), /quota/i);
  assert.throws(() => game.importSave(legacy), /quota/i);
  assert.equal(values.get('settlers.saves.v1'), catalog);
  assert.equal(values.get('settlers.save'), legacy);
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
  const original = values.get('settlers.saves.v1');
  const live = game.exportSave();
  const invalid = [
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
    values.set('settlers.saves.v1', JSON.stringify(bad));
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
  values.set('settlers.saves.v1', original);
  assert.equal(game.listSaves()[0].buildingCount, 1);
});

test('autosave neither reads nor rewrites named checkpoints and still continues', () => {
  const { game, values, accesses } = colony();
  for (let i = 0; i < 10; i++) game.saveCheckpoint('Checkpoint ' + i);
  const catalog = values.get('settlers.saves.v1');
  game.step(0.25);
  accesses.length = 0;
  assert.equal(game.saveGame(true), true);
  assert.deepEqual(
    accesses.filter((access) => access.key === 'settlers.saves.v1'),
    [],
  );
  assert.equal(values.get('settlers.saves.v1'), catalog);
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

test('a catalog autosave from before the split continues, then migrates on the next autosave', () => {
  const { game: old, values } = colony();
  old.setColonyName('Oldtown');
  old.saveCheckpoint('First');
  old.saveCheckpoint('Second');
  old.step(0.25);
  const catalog = JSON.parse(values.get('settlers.saves.v1'));
  catalog.entries.push({
    id: 'autosave',
    name: 'Autosave',
    kind: 'autosave',
    savedAt: Date.now() + 1000,
    data: JSON.parse(old.exportSave()),
  });
  values.set('settlers.saves.v1', JSON.stringify(catalog));

  const { game, setBlocked } = colony(values);
  assert.deepEqual(
    game
      .listSaves()
      .map((entry) => entry.kind)
      .sort(),
    ['autosave', 'manual', 'manual'],
  );
  assert.equal(game.loadGame(), true);
  assert.equal(game.state.time, 0.25);
  assert.equal(game.colonyName, 'Oldtown');

  game.step(0.25);
  setBlocked(true);
  assert.equal(game.saveGame(true), false);
  assert.equal(game.saveHealth.ok, false);
  assert.equal(game.listSaves().find((entry) => entry.kind === 'autosave').simulationAge, 0.25);

  setBlocked(false);
  assert.equal(game.saveGame(true), true);
  assert.equal(game.saveHealth.ok, true);
  const migrated = JSON.parse(values.get('settlers.saves.v1'));
  assert.deepEqual(
    migrated.entries.map((entry) => entry.name),
    ['First', 'Second'],
  );
  assert.deepEqual(migrated.entries, catalog.entries.slice(0, 2));
  const saves = game.listSaves();
  assert.equal(saves.length, 3);
  assert.equal(saves[0].kind, 'autosave');
  assert.equal(saves[0].simulationAge, 0.5);

  // A tab still on the old bundle may write a newer autosave into the catalog.
  const stale = JSON.parse(values.get('settlers.saves.v1'));
  stale.entries.push({ ...catalog.entries.at(-1), savedAt: Date.now() + 60_000 });
  values.set('settlers.saves.v1', JSON.stringify(stale));
  assert.equal(game.listSaves()[0].simulationAge, 0.25);
  values.set('settlers.saves.v1', JSON.stringify(migrated));

  const { game: reopened } = colony(values);
  assert.equal(reopened.loadGame(), true);
  assert.equal(reopened.state.time, 0.5);
  assert.equal(reopened.hasUnsavedProgress(), false);
});

test('a damaged autosave is reported without hiding checkpoints and stays deletable', () => {
  const { game, values } = colony();
  game.saveCheckpoint('Kept');
  game.saveGame(true);
  values.set('settlers.autosave.v1', '{"v":1,"savedAt":1,"data":{}}');
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
  assert.equal(values.has('settlers.autosave.v1'), false);
  assert.equal(game.saveHealth.ok, true);
  assert.equal(game.saveGame(true), true);
  game.deleteCheckpoint('autosave');
  assert.deepEqual(
    game.listSaves().map((entry) => entry.kind),
    ['manual'],
  );
  assert.throws(() => game.deleteCheckpoint('autosave'), /no longer exists/);
});
