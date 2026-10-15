import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './helpers/game.cjs';

function colony() {
  const { game } = createGame({ seed: 2024, headless: true });
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
  hq.stock = { logs: 100, planks: 48, stone: 48, tools: 16 };
  const mill = game.newBuilding('sawmill', 50, 48);
  mill.done = true;
  mill.prog = 1;
  mill.timer = 0;
  game.buildings.push(hq, mill);
  game.recomputeTerritory();
  game.state.paused = false;
  game.spawnT = 1e6;
  game.serfT = 1e6;
  return { game, hq, mill };
}

function run(game, seconds, prepare = () => {}) {
  for (let tick = 0; tick < seconds * 4; tick++) {
    prepare();
    game.step(0.25);
  }
}

function supplied(mill) {
  // An external controlled source/sink isolates production without inventing
  // delivery events. Only actual craft cycles may increment produced/consumed.
  mill.stock.logs = 4;
  mill.stock.planks = 0;
}

test('recent windows use actual covered simulation seconds and retain lifetime totals', () => {
  const { game, mill } = colony();
  assert.equal(game.productionWindow(mill.metrics, 30).elapsed, 0);
  run(game, 10, () => supplied(mill));
  const early = game.productionWindow(mill.metrics, 30);
  assert.equal(early.elapsed, 10, 'do not dilute new buildings with thirty fictional seconds');
  assert.deepEqual(early.produced, mill.metrics.produced);
  run(game, 120.5, () => supplied(mill));
  const short = game.productionWindow(mill.metrics, 30);
  const long = game.productionWindow(mill.metrics, 120);
  const lifetime = game.productionWindow(mill.metrics, 'lifetime');
  assert.equal(short.elapsed, 28.5, 'boundary coverage is honest about two-second samples');
  assert.equal(long.elapsed, 118.5);
  assert.equal(lifetime.elapsed, 130.5);
  assert.ok(short.produced.planks < long.produced.planks);
  assert.ok(long.produced.planks < lifetime.produced.planks);
  assert.equal(short.consumed.logs, short.produced.planks * 2);
  assert.deepEqual(lifetime.produced, mill.metrics.produced);
  assert.equal(lifetime.sampleInterval, 0);
  assert.equal(short.sampleInterval, 2);
});

test('a shortage and its fix change recent rates without erasing lifetime production', () => {
  const { game, mill } = colony();
  run(game, 180, () => supplied(mill));
  const before = mill.metrics.produced.planks;
  mill.stock.logs = 0;
  mill.stock.planks = 0;
  run(game, 45);
  const shortage = game.productionWindow(mill.metrics, 30);
  assert.equal(shortage.produced.planks, 0);
  assert.equal(shortage.inputBlocked, shortage.elapsed);
  assert.equal(mill.metrics.produced.planks, before);
  assert.ok(game.productionWindow(mill.metrics, 120).produced.planks > 0);
  run(game, 30, () => supplied(mill));
  const recovered = game.productionWindow(mill.metrics, 30);
  assert.ok(recovered.produced.planks > 0);
  assert.equal(recovered.inputBlocked, 0);
  assert.equal(mill.metrics.inputBlocked, 45);
  assert.ok(mill.metrics.produced.planks > before);
  assert.ok(game.productionWindow(mill.metrics, 120).inputBlocked > 0);
});

test('history stays bounded and readings, global pause and display speed do not age it', () => {
  const a = colony();
  const b = colony();
  a.game.state.speed = 1;
  b.game.state.speed = 8;
  run(a.game, 600, () => supplied(a.mill));
  run(b.game, 600, () => supplied(b.mill));
  assert.deepEqual(
    a.mill.metrics,
    b.mill.metrics,
    'equal simulation steps ignore wall-clock speed',
  );
  assert.ok(a.mill.metrics.recent.length <= 301);
  assert.equal(a.mill.metrics.recent[0].elapsed, 0);
  const metrics = structuredClone(a.mill.metrics);
  const rng = a.game.SR.getState();
  const time = a.game.state.time;
  a.game.state.paused = true;
  for (let frame = 0; frame < 200; frame++) {
    // The frame loop never calls positive-dt step while paused. Reading each
    // inspector window and a zero-time step must likewise remain pure.
    a.game.step(0);
    for (const window of [30, 120, 'lifetime']) a.game.productionWindow(a.mill.metrics, window);
  }
  assert.deepEqual(a.mill.metrics, metrics);
  assert.equal(a.game.state.time, time);
  assert.equal(a.game.SR.getState(), rng);
  a.mill.disabled = true;
  run(a.game, 35);
  assert.equal(a.game.productionWindow(a.mill.metrics, 30).produced.planks, 0);
  assert.equal(
    a.mill.metrics.elapsed,
    635,
    'building pauses count as observed idle simulation time',
  );
});

test('input arrivals and completed output deliveries exclude starting stock and transfers', () => {
  const { game, hq, mill } = colony();
  const warehouse = game.newBuilding('warehouse', 54, 48);
  warehouse.done = true;
  warehouse.prog = 1;
  warehouse.targets.planks = 6;
  game.buildings.push(warehouse);
  game.recomputeTerritory();
  for (let carrier = 0; carrier < 8; carrier++) game.spawnCarrier(hq);
  const events = [];
  game.emitGameEvent = (name, payload) => events.push({ name, payload });
  run(game, 40);
  assert.ok(mill.metrics.inputDelivered.logs > 0);
  assert.ok(mill.metrics.outputDelivered.planks > 0);
  assert.equal(
    mill.metrics.outputDelivered.planks,
    events.filter(
      ({ name, payload }) =>
        name === 'goodsDelivered' && payload.good === 'planks' && !payload.transfer,
    ).length,
    'count only producer cargo reaching a storage destination',
  );
  assert.equal(
    mill.metrics.produced.planks,
    events.filter(({ name, payload }) => name === 'goodsProduced' && payload.building === mill)
      .length,
  );
  assert.ok(
    events.some(
      ({ name, payload }) =>
        name === 'goodsDelivered' && payload.transfer && payload.building === warehouse,
    ),
  );
  assert.deepEqual(hq.metrics.produced, {});
  assert.deepEqual(hq.metrics.outputDelivered, {});
  assert.deepEqual(warehouse.metrics.produced, {});
  assert.deepEqual(warehouse.metrics.inputDelivered, {});
});

test('construction materials are not retrospectively treated as producer inputs', () => {
  const { game, hq } = colony();
  game.buildings.splice(1, 1);
  const site = game.newBuilding('toolsmith', 50, 48);
  game.buildings.push(site);
  game.recomputeTerritory();
  for (let carrier = 0; carrier < 8; carrier++) game.spawnCarrier(hq);
  run(game, 8);
  assert.equal(site.done, false);
  assert.equal(site.got.planks, 3);
  assert.equal(site.got.stone, 2);
  assert.equal(site.metrics.delivered.planks, 3, 'legacy all-arrivals counter stays intact');
  assert.deepEqual(site.metrics.inputDelivered, {});
  assert.equal(site.metrics.elapsed, 0);
});

test('output delivery counts at arrival, not at reservation or pickup', () => {
  const { game, hq, mill } = colony();
  mill.x = 62;
  mill.stock.logs = 2;
  game.spawnCarrier(hq);
  game.step(0.25);
  mill.disabled = true;
  assert.equal(mill.metrics.produced.planks, 1);
  assert.deepEqual(mill.metrics.outputDelivered, {});
  for (let tick = 0; tick < 200 && !game.units[0].carry; tick++) game.step(0.25);
  assert.equal(game.units[0].carry, 'planks');
  assert.deepEqual(mill.metrics.outputDelivered, {}, 'cargo is still in transit');
  for (let tick = 0; tick < 200 && !mill.metrics.outputDelivered.planks; tick++) game.step(0.25);
  assert.equal(mill.metrics.outputDelivered.planks, 1);
  assert.equal(hq.stock.planks, 49);
});

test('ten-minute reports retain real covered production after the two-minute window', () => {
  const { game, mill } = colony();
  run(game, 650, () => supplied(mill));
  const recent = game.productionWindow(mill.metrics, 600);
  assert.equal(recent.elapsed, 600);
  assert.ok(recent.produced.planks > game.productionWindow(mill.metrics, 120).produced.planks);
  assert.ok(mill.metrics.recent.length <= 301);
});
