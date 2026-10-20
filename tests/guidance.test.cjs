'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./helpers/game.cjs');
function colony() {
  const { game } = createGame({ seed: 42, headless: true });
  game.initializeColony();
  return game;
}
test('advisor completes inland bread and metal prerequisites', () => {
  const g = colony();
  for (const type of ['lumberjack', 'sawmill', 'quarry', 'farm', 'mine_iron', 'mine_coal']) {
    const b = g.newBuilding(type, 48, 50);
    g.buildings.push(b);
    b.done = true;
  }
  const rows = g.advTargets();
  assert.ok(rows.some((r) => r.bt === 'workshop' && r.def === 1));
  assert.ok(rows.some((r) => r.bt === 'smelter' && r.def === 1));
  assert.ok(!rows.some((r) => r.bt === 'toolsmith'));
  const mill = g.newBuilding('windmill', 51, 50);
  g.buildings.push(mill);
  mill.done = true;
  const breadRows = g.advTargets();
  for (const type of ['well', 'bakery'])
    assert.ok(breadRows.some((r) => r.bt === type && r.def > 0));
});
test('optional beer contract spends reserved-aware stock once and grants its reward', () => {
  const g = colony();
  const hq = g.anyStorage();
  const index = g.contracts.findIndex((c) => c.cost.beer);
  hq.stock.beer = 10;
  hq.reservedStock.beer = 1;
  g.claimContract(index);
  assert.ok(!g.state.contracts.includes(index));
  hq.reservedStock.beer = 0;
  const before = g.state.gold;
  g.claimContract(index);
  assert.equal(hq.stock.beer, 0);
  assert.equal(g.state.gold, before + 12);
  g.claimContract(index);
  assert.equal(g.state.gold, before + 12);
});
test('autoplay sites bakery within local well service', () => {
  const g = colony();
  const well = g.newBuilding('well', 48, 50);
  g.buildings.push(well);
  well.done = true;
  const spot = g.findSpot('bakery');
  assert.ok(spot);
  assert.ok(Math.hypot(spot[0] - well.x, spot[1] - well.y) <= 6);
  well.disabled = true;
  assert.equal(g.findSpot('bakery'), null);
});
test('inland autoplay produces bread through the complete grain chain', () => {
  const g = colony();
  for (const tile of g.tiles) if (tile.t === g.WATER) tile.t = g.GRASS;
  g.recomputeTerritory();
  g.state.auto = true;
  for (let i = 0; i < 600 * 60 && g.producedTotal('bread') < 3; i++) g.step(1 / 60);
  assert.ok(
    g.producedTotal('bread') >= 3,
    JSON.stringify(g.buildings.map((b) => [b.type, b.done, b.blockedReason])),
  );
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  assert.ok(g.state.milestones.includes(3));
  assert.ok(g.buildings.some((b) => b.type === 'workshop' && b.done));
});

test('advisor requests another well when the existing service footprint is full', () => {
  const g = colony();
  for (const type of ['lumberjack', 'sawmill', 'quarry', 'farm', 'windmill', 'well']) {
    const b = g.newBuilding(type, 48, 50);
    b.done = true;
    g.buildings.push(b);
  }
  const well = g.buildings.at(-1);
  for (let y = well.y - 6; y <= well.y + 6; y++)
    for (let x = well.x - 6; x <= well.x + 6; x++)
      if (Math.hypot(x - well.x, y - well.y) <= 6) {
        const occupied = g.newBuilding('farm', x, y);
        occupied.done = true;
        g.buildings.push(occupied);
      }
  assert.equal(g.findSpot('bakery'), null);
  assert.ok(g.advTargets().some((r) => r.bt === 'well' && r.def > 0));
  const spot = g.findSpot('well');
  assert.ok(spot, 'another owned service area remains available');
  assert.ok(g.connectedLand(spot[0], spot[1], well.x, well.y));
});

test('requested bread reserves add baking and grain capacity', () => {
  const g = colony();
  for (const type of ['lumberjack', 'sawmill', 'quarry', 'farm', 'windmill', 'well', 'bakery']) {
    const b = g.newBuilding(type, 48, 50);
    b.done = true;
    g.buildings.push(b);
  }
  g.anyStorage().targets.bread = 24;
  const rows = g.advTargets();
  assert.ok(rows.some((r) => r.bt === 'bakery' && r.target >= 3 && r.def >= 2));
  assert.ok(rows.some((r) => r.bt === 'farm' && r.target >= 4));
});

test('outpost siting preserves spacing around a narrow live gold mining face', () => {
  const g = colony();
  const deposit = g.idx(48, 48);
  g.tiles[deposit] = {
    t: g.MTN,
    tree: 0,
    rock: null,
    deposit: { kind: 'gold', amt: 240, amt0: 240 },
    road: false,
  };
  for (const [x, y] of [
    [47, 48],
    [48, 47],
    [48, 49],
    [47, 47],
    [47, 49],
  ])
    g.tiles[g.idx(x, y)].t = g.MTN;
  g.tiles[g.idx(49, 48)].t = g.GRASS;
  g.tiles[g.idx(50, 48)].t = g.GRASS;
  assert.equal(g.isFaceTile(49, 48, ['gold']), true);
  assert.equal(g.isFaceTile(50, 48, ['gold']), true, 'guard would block the face through spacing');
  assert.equal(g.isFaceTile(51, 48, ['gold']), false);
  g.tiles[deposit].deposit.amt = 0;
  assert.equal(g.isFaceTile(50, 48, ['gold']), false, 'exhausted ore need not reserve space');
});
