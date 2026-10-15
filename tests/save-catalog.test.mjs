import test from 'node:test';
import assert from 'node:assert/strict';
function worldWithoutAttention(text) {
  const data = JSON.parse(text);
  delete data.attention;
  return data;
}
import { createGame } from './helpers/game.cjs';

function colony() {
  const values = new Map();
  let blocked = false;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (blocked) throw new Error('Storage quota exhausted');
      values.set(key, value);
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
