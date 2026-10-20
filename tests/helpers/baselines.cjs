'use strict';
// Shared autoplay determinism baselines: the routine suite keeps one hash
// check, the soak suite runs the full seed matrix. Both compose the real
// engine graph through createEngine.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createEngine } = require('../../src/simulation/engine.ts');
const { createPersistence } = require('../../src/core/persistence.ts');
const { fakeStorage } = require('./game.cjs');

function engine(seed = 2024) {
  const storage = fakeStorage().localStorage;
  const g = createEngine({ seed, storage });
  g.initializeColony();
  return g;
}

function snapshot(g) {
  const hooks = {};
  createPersistence(g, hooks);
  return JSON.parse(JSON.stringify(hooks.snapshotGame()));
}

function run(seed, auto, record = false) {
  const g = engine(seed);
  const events = [];
  if (record)
    for (const name of [
      'tileChanged',
      'territoryChanged',
      'buildingPlaced',
      'buildingCompleted',
      'buildingDemolished',
      'roadBuilt',
      'goodsProduced',
      'goodsDelivered',
      'outpostManned',
      'milestoneReached',
    ])
      g.gameEvents.on(name, (e) => events.push(e));
  g.state.auto = auto;
  if (!auto) {
    g.placeBuilding('lumberjack', 51, 48);
    g.placeBuilding('sawmill', 48, 51);
    g.commitRoad({ x: 49, y: 48 }, { x: 50, y: 51 });
  }
  for (let i = 0; i < 18000; i++) {
    if (i === 9000 && !auto) g.demolish(g.buildings.find((b) => b.type === 'lumberjack'));
    g.step(1 / 60, i >= 3000 && i < 4200);
  }
  if (record) assert.ok(events.length > 0);
  return snapshot(g);
}

function historicalEconomySnapshot(value) {
  const copy = structuredClone(value);
  // Keep the original byte hashes: only field names changed, not simulation.
  const historicalFields = {
    reservedStock: 'res',
    constructionProgress: 'prog',
    manned: 'man',
    foodBlockedNoticeSent: 'nofood',
    rocksExhaustedNoticeSent: 'norock',
  };
  copy.b = copy.b.map((building) =>
    Object.fromEntries(
      Object.entries(building).map(([key, value]) => [historicalFields[key] || key, value]),
    ),
  );
  copy.j = copy.j.map((job) => ({
    kind: job.kind,
    good: job.good || null,
    to: job.to || 0,
    s: job.kind === 'fetch' || job.kind === 'transfer' ? job.sourceId : 0,
    from: job.kind === 'deliver' || job.kind === 'transfer' ? job.sourceId : 0,
    state: job.status === 'pending' ? 'p' : 't',
  }));
  delete copy.identity;
  delete copy.observations;
  delete copy.attention;
  for (const unit of copy.u) {
    delete unit.carryProducer;
    delete unit.carryWarehouseTransfer;
  }
  for (const building of copy.b) {
    const metrics = building.metrics;
    metrics.recent = metrics.recent
      .filter((sample) => sample.elapsed >= metrics.elapsed - 120 - 1e-9)
      .slice(-61);
  }
  return copy;
}

function baselineHash(snapshotValue) {
  return createHash('sha256')
    .update(JSON.stringify(historicalEconomySnapshot(snapshotValue)))
    .digest('hex');
}

// SHA-256 of complete expanded-economy snapshots from the real subsystem graph
// and the seed/command sequence above. Removing snapshot metadata was checked
// against the original hashes before updating these. The independent observed
// run must match too: event subscriptions cannot change simulation state.
const BASELINES = [
  [2024, false, 'b68e577e95a7667312133a008a0187e3bef839089862daac58d942ff7324ca0d'],
  [42, true, '02381e7bd0747d1295dee75daaab9eee7847381ef1030221e6cf59643af08311'],
  [2024, true, '216c80e961a8de5b4cdc2db7aaf9967ee6c35651df66f4070ae223267f6cd345'],
];

module.exports = {
  BASELINES,
  baselineHash,
  engine,
  historicalEconomySnapshot,
  run,
  snapshot,
};
