import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';
function colony(storage = { getItem: () => null, setItem() {} }) {
  const { game } = createGame({
    seed: 2024,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
    storage,
  });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  const hq = game.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.constructionProgress = 1;
  hq.stock = { planks: 48, stone: 48, tools: 16, weapons: 6 };
  const producer = game.newBuilding('sawmill', 54, 48);
  producer.done = true;
  producer.constructionProgress = 1;
  game.buildings.push(hq, producer);
  game.recomputeTerritory();
  game.spawnT = game.serfT = 1e6;
  return { game, hq, producer };
}
function advance(game, seconds) {
  for (let i = 0; i < seconds * 10; i++) game.step(0.1);
}
test('persistent shortages distinguish missing supply from actual delivery stages, and resolve honestly', () => {
  const { game, hq, producer } = colony();
  advance(game, 5);
  assert.equal(game.activeAttention().length, 0, 'ordinary brief wait');
  advance(game, 10);
  let issue = game.activeAttention()[0];
  assert.equal(issue.reason, 'inputs');
  assert.match(issue.evidence.join(' '), /No reachable available/);
  assert.equal(game.activityHistory().events.filter((e) => e.kind === 'issue-opened').length, 1);
  hq.stock.logs = 3;
  game.ensureJobs();
  issue = game.activeAttention()[0];
  assert.match(issue.evidence.join(' '), /queued/);
  game.spawnCarrier(hq);
  game.startJob(game.units[0], game.jobs[0]);
  assert.match(game.activeAttention()[0].evidence.join(' '), /assigned/);
  for (let i = 0; i < 50 && !game.units[0].carry; i++) game.step(0.1);
  assert.match(game.activeAttention()[0].evidence.join(' '), /carrying/);
  advance(game, 15);
  assert.equal(game.activeAttention().length, 0);
  assert.ok(game.activityHistory().events.some((e) => e.kind === 'issue-resolved'));
  assert.ok(game.activityHistory().events.some((e) => e.kind === 'production-started'));
});
test('deliberate pauses and satisfied demand suppress issues even while the colony is paused', () => {
  const { game, producer } = colony();
  advance(game, 15);
  assert.equal(game.activeAttention().length, 1);
  game.state.paused = true;
  producer.disabled = true;
  assert.equal(game.activeAttention().length, 0);
  game.emitGameEvent('productionControlChanged', { building: producer });
  assert.match(game.activityHistory().events.at(-1).message, /intentionally paused/);
  producer.disabled = false;
  producer.blockedReason = 'demand';
  game.emitGameEvent('productionControlChanged', { building: producer });
  assert.equal(game.activeAttention().length, 0);
});
test('journal and issue baselines continue through saves and reads do not alter simulation', () => {
  const { game } = colony();
  advance(game, 15);
  const saved = game.exportSave();
  const readBefore = game.exportSave();
  for (let i = 0; i < 10; i++) {
    game.activeAttention();
    game.activityHistory();
  }
  assert.equal(game.exportSave(), readBefore);
  advance(game, 10);
  const expected = game.exportSave();
  game.importSave(saved);
  advance(game, 10);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(expected));
});
test('significant history is bounded at 200 and preserves former locations after demolition', () => {
  const { game, producer } = colony();
  advance(game, 15);
  game.demolish(producer);
  assert.equal(game.activeAttention().length, 0);
  const resolution = game
    .activityHistory()
    .events.find((e) => e.kind === 'issue-resolved' && e.entity.id === producer.id);
  assert.match(resolution.message, /issue closed.*building was demolished/i);
  assert.doesNotMatch(resolution.message, /production recover|production resum/i);
  assert.notEqual(
    resolution.message,
    game.activityHistory().events.find((e) => e.kind === 'building-demolished').message,
  );
  for (let i = 0; i < 220; i++) game.emitGameEvent('roadBuilt', { count: 1 });
  assert.equal(game.activityHistory().events.length, 200);
  const saved = game.exportSave();
  game.importSave(saved);
  assert.equal(game.activityHistory().events.length, 200);
});
test('invalid activity is rejected atomically and post-write recovery is honestly unsaved', () => {
  let stored = null,
    failing = false;
  const { game } = colony({
    getItem: () => stored,
    setItem: (_k, v) => {
      if (failing) throw Error('quota');
      stored = v;
    },
  });
  advance(game, 15);
  game.saveCheckpoint('valid');
  const valid = game.exportSave(),
    prior = stored;
  for (const corrupt of [
    (d) => (d.attention.events[0].time = d.st.time + 1),
    (d) => (d.attention.events[0].entity.x = -1),
    (d) => (d.attention.events[0].kind = 'invented'),
    (d) => (d.attention.events[0].entity.id = d.nextId),
    (d) => (d.attention.conditions[0].since = -1),
    (d) => (d.attention.events = Array(201).fill(d.attention.events[0])),
  ]) {
    const bad = JSON.parse(valid);
    corrupt(bad);
    assert.throws(() => game.importSave(JSON.stringify(bad)), /attention|activity/i);
    assert.equal(game.exportSave(), valid);
    assert.equal(stored, prior);
  }
  failing = true;
  assert.equal(game.saveAutosave(), false);
  assert.ok(game.activityHistory().events.some((e) => e.kind === 'storage-failed'));
  const priorEvents = game.activityHistory().events.length;
  failing = false;
  game.saveCheckpoint('recovered');
  assert.equal(game.activityHistory().events.length, priorEvents + 1);
  assert.equal(game.hasUnsavedProgress(), true, 'recovery was appended after the saved snapshot');
  game.saveCheckpoint('all history');
  assert.equal(game.hasUnsavedProgress(), false);
});

test('output limits, exhausted deposits and changed constraints remain truthful and deduplicated', () => {
  const { game, producer } = colony();
  producer.stock = { logs: 4, planks: 8 };
  advance(game, 15);
  assert.equal(game.activeAttention()[0].reason, 'output');
  assert.match(game.activeAttention()[0].evidence.join(' '), /local output limit of 8/);
  advance(game, 20);
  assert.equal(
    game.activityHistory().events.filter((event) => event.kind === 'issue-opened').length,
    1,
  );
  producer.exhausted = true;
  advance(game, 1);
  assert.equal(game.activeAttention().length, 0, 'new constraint has its own observation interval');
  advance(game, 13);
  assert.equal(game.activeAttention()[0].reason, 'exhausted');
  assert.equal(
    game.activityHistory().events.filter((event) => event.kind === 'issue-resolved').length,
    1,
  );
});
test('all simultaneous semantic transitions survive presentation cooldowns; passive snapshots are detached', () => {
  const { game, producer } = colony();
  for (let i = 0; i < 14; i++) {
    const b = game.newBuilding('sawmill', 20 + i * 2, 20);
    b.done = true;
    b.constructionProgress = 1;
    game.buildings.push(b);
  }
  advance(game, 15);
  assert.equal(game.activeAttention().length, 15);
  assert.equal(
    game.activityHistory().events.filter((event) => event.kind === 'issue-opened').length,
    15,
  );
  const before = game.exportSave(),
    issues = game.activeAttention(),
    history = game.activityHistory();
  issues[0].entity.x = 999;
  issues[0].evidence.push('invented');
  history.events[0].message = 'invented';
  assert.equal(game.exportSave(), before);
  for (const b of game.buildings) if (b.type === 'sawmill') b.disabled = true;
  game.emitGameEvent('productionControlChanged', { building: producer });
  assert.equal(
    game.activityHistory().events.filter((event) => event.kind === 'issue-resolved').length,
    15,
  );
});
test('pending issue coverage resumes exactly, and startup storage/graphics failures record once', () => {
  const { game } = colony();
  advance(game, 5);
  const saved = game.exportSave();
  advance(game, 10);
  const expected = game.exportSave();
  game.importSave(saved);
  advance(game, 10);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(expected));
  const failed = colony({
    getItem() {
      throw Error('storage disabled');
    },
    setItem() {},
  }).game;
  assert.equal(failed.saveHealth.ok, false);
  assert.equal(failed.activityHistory().events[0].kind, 'storage-failed');
  failed.emitGameEvent('rendererFailed', { reason: 'device unavailable' });
  failed.emitGameEvent('rendererFailed', { reason: 'device unavailable' });
  assert.equal(
    failed.activityHistory().events.filter((event) => event.kind === 'renderer-failed').length,
    1,
  );
});
test('local well support is not missing transported food, and no-op roads do not consume history', () => {
  const { game, producer } = colony();
  producer.type = 'brewery';
  producer.stock.grain = 4;
  advance(game, 15);
  assert.equal(game.activeAttention()[0].reason, 'water');
  assert.match(game.activeAttention()[0].evidence.join(' '), /local support, not a transported/);
  const events = game.activityHistory().events.length;
  game.emitGameEvent('roadBuilt', { count: 0 });
  assert.equal(game.activityHistory().events.length, events);
  const well = game.newBuilding('well', 56, 48);
  well.done = true;
  well.constructionProgress = 1;
  game.buildings.push(well);
  assert.equal(game.activeAttention().length, 0, 'same-frame water support clears stale reason');
  advance(game, 1);
  assert.ok(game.activityHistory().events.some((event) => event.kind === 'issue-resolved'));
});
test('inspector and attention report the same available stock and transfer holdings for a starved producer', () => {
  const { game, hq, producer } = colony();
  const warehouse = game.newBuilding('warehouse', 60, 48);
  Object.assign(warehouse, { done: true, constructionProgress: 1 });
  game.buildings.push(warehouse);
  advance(game, 15);
  assert.equal(game.activeAttention()[0].reason, 'inputs');
  hq.stock.logs = 3;
  for (let i = 0; i < 3; i++) {
    game.jobs.push({
      kind: 'transfer',
      good: 'logs',
      sourceId: hq.id,
      to: warehouse.id,
      status: 'pending',
    });
    game.reserveStock(hq, 'logs');
  }
  const evidence = () => game.activeAttention()[0].evidence.join(' ');
  const inspector = () =>
    game
      .buildingStatus(producer)
      .lines.map((line) => line.t)
      .join(' ');
  assert.match(
    evidence(),
    /No reachable available stored logs\. 3 more reachable units are held for warehouse transfers/i,
  );
  assert.match(inspector(), /no free connected supply \(3 more held for warehouse transfers\)/);

  hq.stock.logs = 5;
  assert.match(
    evidence(),
    /^.*2 reachable available stored units.*3 more reachable units are held/,
  );
  assert.match(inspector(), /2 free in connected storage \(3 more held for warehouse transfers\)/);
});
