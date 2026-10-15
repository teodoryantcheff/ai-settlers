import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';

function colony() {
  const { game } = createGame({
    seed: 2024,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy', 'persistence'],
    storage: { getItem: () => null, setItem() {} },
  });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    res: null,
    road: false,
  }));
  const hq = game.newBuilding('hq', 48, 48);
  hq.done = true;
  hq.prog = 1;
  hq.stock = { logs: 0, planks: 48, stone: 48, tools: 16, weapons: 6 };
  const consumer = game.newBuilding('workshop', 54, 48);
  consumer.done = true;
  consumer.prog = 1;
  game.buildings.push(hq, consumer);
  game.recomputeTerritory();
  game.spawnT = game.serfT = 1e6;
  return { game, hq, consumer };
}

test('recovered fetch arrivals have independent coverage and exclude pickup and direct salvage', () => {
  const { game, hq, consumer } = colony();
  game.ensureJobs();
  const job = game.jobs.find((job) => job.to === consumer.id);
  assert.ok(job, 'real ingredient delivery request');
  assert.equal(game.cargoWindow('lifetime').available, false);
  game.spawnCarrier(hq);
  for (let tick = 0; tick < 100 && !game.units[0].carry; tick++) game.step(0.1);
  const good = game.units[0].carry;
  assert.ok(good);
  assert.deepEqual(game.cargoWindow('lifetime').totals, {}, 'pickup is not a completed arrival');
  const totals = structuredClone(game.cargoWindow('lifetime').totals);
  consumer.stock.gold = 3;
  game.demolish(consumer);
  assert.deepEqual(
    game.cargoWindow('lifetime').totals,
    totals,
    'direct salvage is not a carrier arrival',
  );
  for (let tick = 0; tick < 200 && game.units[0].carry; tick++) game.step(0.1);
  assert.equal(game.cargoWindow('lifetime').totals[good], 1);
  assert.deepEqual(
    game.economicWindow('lifetime').totals.inputArrived,
    {},
    'returned fetch cargo is not producer input',
  );
  assert.deepEqual(
    game.economicWindow('lifetime').totals.outputStored,
    {},
    'returned fetch cargo is not producer output',
  );
});

test('cargo coverage migrates independently and survives deterministic save continuation', () => {
  const { game, hq } = colony();
  game.spawnCarrier(hq);
  game.step(0.1);
  const checkpoint = game.exportSave();
  for (let tick = 0; tick < 100; tick++) game.step(0.1);
  const expected = game.exportSave();
  game.importSave(checkpoint);
  for (let tick = 0; tick < 100; tick++) game.step(0.1);
  assert.deepEqual(JSON.parse(game.exportSave()), JSON.parse(expected));
  const old = JSON.parse(expected);
  delete old.observations.cargo;
  game.importSave(JSON.stringify(old));
  assert.equal(game.cargoWindow('lifetime').available, false);
  assert.ok(game.economicWindow('lifetime').available, 'earlier economic coverage is preserved');
  assert.equal(game.cargoWindow('lifetime').from, old.st.time);
  game.step(0.1);
  assert.ok(game.cargoWindow('lifetime').elapsed > 0);
  const before = game.exportSave();
  for (let i = 0; i < 20; i++) game.cargoWindow(600);
  assert.equal(game.exportSave(), before);
});

test('invalid arrival histories cannot replace live or stored data', () => {
  const { game } = colony();
  game.step(0.1);
  const valid = game.exportSave();
  for (const corrupt of [
    (cargo) => (cargo.started = 10),
    (cargo) => (cargo.totals.foreign = 1),
    (cargo) => (cargo.totals.planks = -1),
    (cargo) => (cargo.recent[0].time = 1),
    (cargo) => (cargo.recent[0].totals.planks = 2),
    (cargo) => (cargo.recent = Array.from({ length: 302 }, () => cargo.recent[0])),
    (cargo) => delete cargo.totals,
  ]) {
    const bad = JSON.parse(valid);
    corrupt(bad.observations.cargo);
    assert.throws(() => game.importSave(JSON.stringify(bad)), /cargo|resource/i);
    assert.equal(game.exportSave(), valid);
  }
});

test('queued jobs, assigned pickup, physical cargo and recovered cargo remain distinct', () => {
  const { game, hq, consumer } = colony();
  game.ensureJobs();
  const queued = game.currentTransport();
  assert.ok(queued.rows.every((row) => row.stage === 'queued'));
  assert.ok(queued.rows.length > 0);
  assert.equal(queued.carriers.length, 0);
  game.spawnCarrier(hq);
  const job = game.jobs.find((job) => job.to === consumer.id);
  game.units[0].x = 50.5;
  game.startJob(game.units[0], job);
  let snapshot = game.currentTransport();
  assert.equal(snapshot.rows.filter((row) => row.stage === 'assigned').length, 1);
  assert.equal(snapshot.rows.filter((row) => row.stage === 'carrying').length, 0);
  assert.ok(snapshot.rows.find((row) => row.stage === 'assigned').route.points.length > 0);
  for (let tick = 0; tick < 100 && !game.units[0].carry; tick++) game.step(0.1);
  snapshot = game.currentTransport();
  const carried = snapshot.rows.find((row) => row.stage === 'carrying');
  assert.equal(carried.good, game.units[0].carry);
  assert.equal(carried.carrierId, game.units[0].id);
  game.demolish(consumer);
  snapshot = game.currentTransport();
  assert.equal(snapshot.rows.filter((row) => row.stage === 'carrying').length, 1);
  assert.equal(snapshot.rows.find((row) => row.stage === 'carrying').kind, 'recovered');
  const before = game.exportSave();
  snapshot.rows.find((row) => row.stage === 'carrying').position.x = 900;
  for (let i = 0; i < 20; i++) game.currentTransport();
  assert.equal(game.exportSave(), before);
});

test('assignment records without a live carrier have unavailable evidence, not queued status', () => {
  const { game, hq } = colony();
  game.ensureJobs();
  game.spawnCarrier(hq);
  game.startJob(game.units[0], game.jobs[0]);
  game.units = [];
  const before = JSON.stringify(game.snapshotGame());
  const report = game.currentTransport();
  assert.equal(report.rows[0].stage, 'unknown');
  assert.equal(report.rows[0].carrierId, null);
  assert.equal(report.rows[0].route, null);
  assert.equal(report.rows.filter((row) => row.stage === 'queued').length, game.jobs.length - 1);
  assert.equal(game.jobs[0].state, 't', 'report leaves the assignment record unchanged');
  assert.equal(JSON.stringify(game.snapshotGame()), before);
});
