import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';
import { plainSave } from './helpers/saves.mjs';
import { packHistory, saveText, unpackHistory } from '../src/core/save-codec.ts';

const fail = (message) => {
  throw new Error(message);
};

function grownColony(minutes = 12) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const { game } = createGame({
    seed: 2024,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
    storage,
  });
  game.initializeColony();
  game.state.auto = true;
  for (let i = 0; i < minutes * 3600; i++) game.step(1 / 60, false);
  return { game, values };
}

test('packed histories rebuild the same samples, numbers, keys and key order', () => {
  const samples = [
    { elapsed: 0.1 + 0.2, inputBlocked: 0, produced: {}, consumed: {} },
    { elapsed: 587.9999999997939, inputBlocked: 0, produced: { logs: 1 }, consumed: {} },
    { elapsed: 590, inputBlocked: 1.5, produced: { logs: 2, planks: 1 }, consumed: { logs: 2 } },
  ];
  const packed = packHistory(samples);
  assert.ok(packed);
  assert.deepEqual(packed.columns.produced.logs, [null, 1, 2]);
  const restored = unpackHistory(JSON.parse(JSON.stringify(packed)), fail);
  assert.deepEqual(restored, samples);
  assert.equal(JSON.stringify(restored), JSON.stringify(samples));
});

test('histories that do not share one shape stay plain arrays', () => {
  assert.equal(packHistory([{ time: 1, totals: {} }, { time: 2 }]), null);
  assert.equal(packHistory([{ time: 1 }, { time: 'later' }]), null);
  assert.equal(packHistory([]), null);
  const mixed = [{ time: 1, totals: {} }, { time: 2 }];
  const text = saveText({ observations: { recent: mixed } });
  assert.deepEqual(JSON.parse(text).observations.recent, mixed);
});

test('malformed packed histories are rejected before validation', () => {
  const packed = (columns, count) => ({ columns, count });
  for (const bad of [
    packed({ time: [1, 2] }, 3),
    packed({ time: [1, 'x'] }, 2),
    packed({ time: [1, 2] }, 302),
    packed({ time: [1, 2] }, 0),
    packed({ totals: 'x' }, 1),
  ])
    assert.throws(() => unpackHistory(bad, fail), /Invalid packed history/);
});

test('a grown colony saves in a fraction of the space and continues exactly', () => {
  const { game } = grownColony();
  const packed = game.exportSave();
  const plain = JSON.stringify(plainSave(packed));
  assert.match(packed, /"columns"/);
  assert.ok(packed.length < plain.length * 0.5, `${packed.length} vs ${plain.length} characters`);
  // Loading the compact text and exporting again reproduces it exactly.
  game.importSave(packed);
  assert.equal(game.exportSave(), packed);
});

test('older plain-array saves still load and continue identically', () => {
  const { game } = grownColony(6);
  const packed = game.exportSave();
  const plain = JSON.stringify(plainSave(packed));
  game.importSave(plain);
  assert.equal(game.exportSave(), packed);
});
