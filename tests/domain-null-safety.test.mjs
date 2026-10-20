import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fakeStorage } from './helpers/game.cjs';

function colony() {
  const { localStorage, storage } = fakeStorage();
  const { game } = createGame({ seed: 2024, headless: true, storage: localStorage });
  game.initializeColony();
  game.saveCheckpoint('Before invalid import');
  return { game, storage };
}

function rejectsWithoutAdoption(game, storage, data, expected) {
  const before = game.exportSave();
  const arrays = [game.tiles, game.buildings, game.jobs, game.units];
  const checkpoints = [...storage];
  assert.throws(() => game.inspectSave(JSON.stringify(data)), expected);
  assert.throws(() => game.importSave(JSON.stringify(data)), expected);
  assert.equal(game.exportSave(), before);
  assert.deepEqual([...storage], checkpoints);
  for (const [index, name] of ['tiles', 'buildings', 'jobs', 'units'].entries())
    assert.equal(game[name], arrays[index], name);
}

test('nullable job references are rejected before file inspection or world and catalog adoption', () => {
  const { game, storage } = colony();
  const site = game.newBuilding('sawmill', 51, 48);
  game.buildings.push(site);
  game.ensureJobs();
  const data = JSON.parse(game.exportSave());
  const job = data.j.find((candidate) => candidate.kind === 'fetch');
  assert.ok(job);
  job.sourceId = null;
  rejectsWithoutAdoption(game, storage, data, /Invalid job reference/);
});

test('null delivery flags cannot enter the live carrier state', () => {
  const { game, storage } = colony();
  const data = JSON.parse(game.exportSave());
  data.u[0].dropIsSite = null;
  rejectsWithoutAdoption(game, storage, data, /Invalid delivery destination/);
});

test('false delivery destinations cannot masquerade as an absent building', () => {
  const { game, storage } = colony();
  const data = JSON.parse(game.exportSave());
  data.u[0].dropB = false;
  rejectsWithoutAdoption(game, storage, data, /Missing drop destination/);
});

test('missing routes, completed lessons and absent outposts have explicit empty results', () => {
  const { game } = colony();
  assert.equal(game.findPath(-1, -1, 48, 48), null);
  assert.deepEqual(game.findPath(48, 48, 48, 48), []);
  assert.equal(game.pendingOutpost(), undefined);
  game.state.milestones = [0, 1, 2, 3, 4, 5];
  assert.equal(game.currentLesson(), null);
  assert.doesNotThrow(() => game.advisorDecision());
  game.tiles = game.tiles.map((tile) => ({ ...tile, t: game.WATER }));
  game.state.auto = true;
  assert.doesNotThrow(() => game.autoTick(2));
});
