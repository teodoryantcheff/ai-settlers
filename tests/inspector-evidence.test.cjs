const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, DEFAULT_MODULES, pinClock } = require('./helpers/game.cjs');
pinClock(0);
function colony() {
  const { game } = createGame({
    seed: 2024,
    modules: DEFAULT_MODULES,
    stubs: { SND: { demolish() {} } },
  });
  game.initializeColony();
  return game;
}

test('demolition quotes match per-good rounded-down refunds and separate local-stock salvage', () => {
  const g = colony();
  const hq = g.anyStorage();
  const farm = g.newBuilding('farm', 51, 48);
  Object.assign(farm, { done: true, constructionProgress: 1, stock: { grain: 4, gold: 2 } });
  g.buildings.push(farm);
  const before = { ...hq.stock };
  const rng = g.SR.getState();
  const quote = g.demolitionQuote(farm);
  assert.equal(quote.allowed, true);
  assert.deepEqual(quote.refund, { planks: 1, stone: 1 });
  assert.deepEqual(quote.salvage, { grain: 4, gold: 2 });
  assert.equal(quote.receiver.id, hq.id);
  assert.deepEqual(hq.stock, before);
  assert.equal(g.SR.getState(), rng);
  g.demolish(farm);
  assert.equal(hq.stock.planks, before.planks + 1);
  assert.equal(hq.stock.stone, before.stone + 1);
  assert.equal(hq.stock.tools, before.tools);
  assert.equal(hq.stock.grain, (before.grain || 0) + 4);
  assert.equal(hq.stock.gold, (before.gold || 0) + 2);
  const site = g.newBuilding('farm', 54, 48);
  site.got = { planks: 1, stone: 2, tools: 1 };
  g.buildings.push(site);
  assert.deepEqual(
    g.demolitionQuote(site).refund,
    { stone: 1 },
    'unfinished refunds use delivered quantities, not planned cost',
  );
});

test('protected buildings expose reasons and outpost projection matches actual territory and garrison return', () => {
  const g = colony();
  const hq = g.anyStorage();
  assert.equal(g.demolitionQuote(hq).allowed, false);
  assert.match(g.demolitionQuote(hq).reason, /headquarters/);
  assert.deepEqual(g.demolitionQuote(hq).salvage, {});
  const warehouse = g.newBuilding('warehouse', 52, 48);
  g.buildings.push(warehouse);
  assert.match(g.demolitionQuote(warehouse).reason, /completed storehouse/);
  const guard = g.newBuilding('guard', 58, 48);
  Object.assign(guard, { done: true, constructionProgress: 1, manned: true });
  g.buildings.push(guard);
  g.recomputeTerritory();
  const owned = g.owned.slice();
  const q = g.demolitionQuote(guard);
  assert.equal(q.returnedSoldiers, 1);
  assert.deepEqual(q.equipment, { weapons: 1 });
  assert.ok(q.territoryLost > 0);
  assert.deepEqual(g.owned, owned);
  const soldiers = g.soldierPool,
    weapons = hq.stock.weapons || 0;
  g.demolish(guard);
  assert.equal(g.soldierPool, soldiers + 1);
  assert.equal(hq.stock.weapons, weapons + 1);
  assert.equal(Array.from(owned).filter((v, i) => v && !g.owned[i]).length, q.territoryLost);
});

test('input evidence distinguishes queued, assigned and carrying work, including alternative mine meals', () => {
  const g = colony();
  const mill = g.newBuilding('sawmill', 51, 48);
  Object.assign(mill, { done: true, constructionProgress: 1 });
  g.buildings.push(mill);
  const jobs = [0, 1, 2].map((i) => ({
    id: 100 + i,
    kind: 'fetch',
    good: 'logs',
    to: mill.id,
    sourceId: g.anyStorage().id,
    status: i ? 'assigned' : 'pending',
  }));
  g.jobs.push(...jobs);
  g.units.push(
    { id: 900, job: jobs[1], carry: null, dead: false },
    { id: 901, job: jobs[2], carry: 'logs', dropB: mill.id, dead: false },
  );
  assert.deepEqual(g.incomingDeliveryStages('logs', mill.id), {
    queued: 1,
    assigned: 1,
    carrying: 1,
  });
  assert.match(
    g
      .bStatus(mill)
      .lines.map((l) => l.t)
      .join(' '),
    /1 queued.*1 assigned.*1 carrying/,
  );
  assert.doesNotMatch(
    g
      .bStatus(mill)
      .lines.map((l) => l.t)
      .join(' '),
    /on the way/,
  );
  const mine = g.newBuilding('mine_coal', 54, 48);
  Object.assign(mine, { done: true, constructionProgress: 1 });
  g.buildings.push(mine);
  g.jobs.push({
    id: 103,
    kind: 'fetch',
    good: 'fish',
    to: mine.id,
    sourceId: g.anyStorage().id,
    status: 'pending',
  });
  const status = g
    .bStatus(mine)
    .lines.map((l) => l.t)
    .join(' ');
  assert.match(status, /1 queued/);
  assert.doesNotMatch(status, /STARVED/);
});

test('unmanned outpost evidence distinguishes waiting dispatch from a walking soldier', () => {
  const g = colony();
  const b = g.newBuilding('guard', 57, 48);
  Object.assign(b, { done: true, constructionProgress: 1 });
  g.buildings.push(b);
  const job = { kind: 'soldier', to: b.id, status: 'pending' };
  g.jobs.push(job);
  assert.match(
    g
      .buildingStatus(b)
      .lines.map((l) => l.t)
      .join(' '),
    /1 queued.*0 walking/,
  );
  g.units.push({ id: 911, job, kind: 'soldier', phase: 'd', dead: false });
  job.status = 'assigned';
  assert.match(
    g
      .buildingStatus(b)
      .lines.map((l) => l.t)
      .join(' '),
    /0 queued.*1 walking/,
  );
});

test('missing live carriers leave assignment evidence unavailable instead of inventing a queued delivery', () => {
  const g = colony();
  const b = g.newBuilding('sawmill', 51, 48);
  Object.assign(b, { done: true, constructionProgress: 1 });
  const other = g.newBuilding('sawmill', 54, 48);
  Object.assign(other, { done: true, constructionProgress: 1 });
  g.buildings.push(b, other);
  // A pending delivery elsewhere must still read as queued.
  g.jobs.push({
    kind: 'fetch',
    good: 'logs',
    to: other.id,
    sourceId: g.anyStorage().id,
    status: 'pending',
  });
  g.jobs.push({
    kind: 'fetch',
    good: 'logs',
    to: b.id,
    sourceId: g.anyStorage().id,
    status: 'assigned',
  });
  // The transport report is read-only: it leaves the assignment record and
  // the rest of the colony unchanged.
  const before = JSON.stringify(g.snapshotGame());
  const { rows } = g.currentTransport();
  const unknown = rows.find((row) => row.stage === 'unknown');
  assert.ok(unknown, 'assignment without a live carrier is unavailable, not queued');
  assert.equal(rows.filter((row) => row.stage === 'unknown').length, 1);
  assert.equal(
    rows.filter((row) => row.stage === 'queued').length,
    1,
    'pending jobs stay queued beside the unavailable assignment',
  );
  assert.equal(unknown.carrierId, null);
  assert.equal(unknown.route, null);
  assert.equal(g.jobs.at(-1).status, 'assigned', 'report leaves the assignment record unchanged');
  assert.equal(JSON.stringify(g.snapshotGame()), before);
  assert.deepEqual(g.incomingDeliveryStages('logs', b.id), {
    queued: 0,
    assigned: 0,
    carrying: 0,
    unknown: 1,
  });
  assert.match(
    g
      .buildingStatus(b)
      .lines.map((l) => l.t)
      .join(' '),
    /1 assignment.*unavailable/,
  );
  assert.deepEqual(g.demolitionQuote(b).cancelledDeliveries, {
    queued: 0,
    assigned: 0,
    carrying: 0,
    unknown: 1,
  });
});

test('all delivery evidence projections agree on live cargo and missing assignment records', () => {
  const g = colony();
  const b = g.newBuilding('sawmill', 51, 48);
  Object.assign(b, { done: true, constructionProgress: 1 });
  g.buildings.push(b);
  for (const [index, stage] of ['queued', 'assigned', 'carrying', 'unknown'].entries()) {
    const job = {
      kind: 'fetch',
      good: 'logs',
      to: b.id,
      sourceId: g.anyStorage().id,
      status: index ? 'assigned' : 'pending',
    };
    g.jobs.push(job);
    if (stage === 'assigned' || stage === 'carrying')
      g.units.push({
        id: 980 + index,
        kind: 'carrier',
        job,
        carry: stage === 'carrying' ? 'logs' : null,
        dropB: b.id,
        dead: false,
      });
    assert.equal(g.currentTransport().rows.at(-1).stage, stage);
  }
  const expected = { queued: 1, assigned: 1, carrying: 1, unknown: 1 };
  assert.deepEqual(g.incomingDeliveryStages('logs', b.id), expected);
  assert.deepEqual(g.demolitionQuote(b).cancelledDeliveries, expected);
});
