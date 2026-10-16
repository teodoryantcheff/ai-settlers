'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSave } = require('../src/core/state.ts');
const {
  createGame,
  fakeDom,
  fakeElement,
  fakeWindow,
  installGlobals,
  pinClock,
  DEFAULT_MODULES,
} = require('./helpers/game.cjs');

// Wall-clock reads inside the simulation stay deterministic.
pinClock(0);

function autoplay(seed) {
  const noop = () => {};
  const dom = fakeDom();
  const { window } = fakeWindow();
  installGlobals({ document: dom.document, window });
  const { game: e } = createGame({
    seed,
    modules: [...DEFAULT_MODULES, 'progression', 'persistence', 'hud'],
    stubs: {
      view: fakeElement('view'),
      mini: fakeElement('mini'),
      cam: { x: 0, y: 0 },
      vw: 1280,
      vh: 720,
      z: 1,
      mouse: { x: 0, y: 0 },
      ht: { x: 0, y: 0 },
      clampCam: noop,
      validateSave,
      rebuildHighlights: noop,
      refreshGhost: noop,
      drawTile: noop,
      sctx: {},
      updateInfo: noop,
      borderDirty: false,
      started: true,
      FX: { ring: noop, coin: noop, pop: noop },
      SND: {
        road: noop,
        ui: noop,
        fail: noop,
        place: noop,
        done: noop,
        demolish: noop,
        gone: noop,
        man: noop,
      },
    },
  });
  e.genMap();
  const hq = e.newBuilding('hq', e.W >> 1, e.H >> 1);
  hq.done = true;
  hq.constructionProgress = 1;
  hq.stock = {
    planks: 48,
    stone: 48,
    food: 20,
    tools: 16,
    weapons: 6,
    logs: 0,
    coal: 0,
    iron: 0,
    gold: 0,
  };
  e.buildings.push(hq);
  e.recomputeTerritory();
  for (let i = 0; i < 8; i++) e.spawnCarrier(hq);
  e.state.auto = true;
  e.state.paused = false;
  return e;
}

function snapshot(e) {
  const mix = {};
  for (const b of e.buildings) mix[b.type] = (mix[b.type] || 0) + 1;
  const stocks = Object.fromEntries(Object.keys(e.GOODS).map((g) => [g, e.totalGood(g)]));
  const stalled = e.buildings
    .filter((b) => !b.done)
    .map((b) => ({ type: b.type, got: b.got, needs: b.needs }));
  const wanted = e.mineDeficits(),
    corridor = e.buildCorridor(wanted);
  const guardDetails = e.state.won
    ? []
    : e.buildings
        .filter((b) => b.type === 'guard')
        .map((b) => ({
          id: b.id,
          x: b.x,
          y: b.y,
          done: b.done,
          manned: b.manned,
          constructionProgress: b.constructionProgress,
          corridorIndex: corridor ? e.pathPos(corridor, b.x, b.y) : -1,
          redundant: e.guardCoverRedundant(b, wanted),
        }));
  const goldFaces = e.state.won
    ? []
    : e.tiles
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.deposit && t.deposit.kind === 'gold' && t.deposit.amt > 0)
        .sort((a, b) => b.t.deposit.amt - a.t.deposit.amt)
        .slice(0, 3)
        .map(({ t, i }) => ({
          x: i % e.W,
          y: Math.floor(i / e.W),
          amount: t.deposit.amt,
          faces: e.DX.map((dx, d) => {
            const x = (i % e.W) + dx,
              y = Math.floor(i / e.W) + e.DY[d];
            return {
              x,
              y,
              terrain: e.inB(x, y) ? e.tiles[e.idx(x, y)].t : -1,
              reason: e.canPlace('mine_gold', x, y)[1],
            };
          }),
        }));
  return {
    time: Math.round(e.state.time),
    gold: e.state.gold,
    upgrades: e.state.upgrades,
    spentGold: e.state.spentGold,
    contracts: e.state.contracts,
    mix,
    stocks,
    sites: stalled,
    guardDetails,
    nextOutpost: corridor ? e.spotOnCorridor(corridor, wanted) : null,
    corridorLength: corridor?.length,
    corridorEnd: corridor?.length
      ? { x: corridor.at(-1) % e.W, y: Math.floor(corridor.at(-1) / e.W) }
      : null,
    goldFaces,
    units: e.units.length,
    jobs: e.jobs.length,
    recommendations: e
      .advTargets()
      .filter((r) => r.def > 0)
      .map((r) => [r.bt, r.def]),
  };
}

function checkEconomy(e) {
  const reservationCounts = new Map();
  const owners = new Map(e.units.filter((u) => u.job).map((u) => [u.job, u]));
  for (const j of e.jobs) {
    if (j.status === 'assigned') assert.ok(owners.has(j), 'every active job has a settler');
    if ((j.kind === 'fetch' || j.kind === 'transfer') && !owners.get(j)?.carry) {
      const key = `${j.sourceId}/${j.good}`;
      reservationCounts.set(key, (reservationCounts.get(key) || 0) + 1);
    }
  }
  for (const b of e.buildings) {
    for (const [good, stock] of Object.entries(b.stock))
      assert.ok(Number.isInteger(stock) && stock >= 0, `nonnegative ${b.type}/${good}`);
    for (const [good, delivered] of Object.entries(b.got))
      assert.ok(Number.isInteger(delivered) && delivered >= 0, `nonnegative construction ${good}`);
    if (e.BSPEC[b.type].store) {
      for (const good of Object.keys(e.GOODS)) {
        const reserved = b.reservedStock[good] || 0;
        assert.equal(
          reserved,
          reservationCounts.get(`${b.id}/${good}`) || 0,
          `reservation ${b.id}/${good}`,
        );
        assert.ok(reserved <= (b.stock[good] || 0), `reserved goods exist ${b.id}/${good}`);
      }
    }
  }
  for (const u of e.units)
    if (u.job) assert.ok(e.jobs.includes(u.job), 'settlers have no orphaned jobs');
  for (const tile of e.tiles)
    if (tile.deposit) assert.ok(tile.deposit.amt >= 0, 'deposits cannot go negative');
  const carriedBankedGold = e.units.filter((u) => u.carry === 'gold' && u.carryTransfer).length;
  assert.equal(
    e.totalGood('gold') + carriedBankedGold,
    e.state.gold,
    'treasury includes previously banked gold moving between warehouses',
  );
  assert.doesNotThrow(
    () => e.validateSave(e.snapshotGame(), e.W, e.H, e.BSPEC, e.GOODS),
    'live economy remains saveable',
  );
}

function investmentChoices(e) {
  // Model a player requesting the goods for outstanding orders through the
  // normal warehouse controls, so optional food orders get production capacity.
  const targets = {};
  for (let i = 0; i < e.contracts.length; i++) {
    if (e.state.contracts.includes(i)) continue;
    for (const [good, amount] of Object.entries(e.contracts[i].cost))
      targets[good] = Math.max(targets[good] || 0, amount);
  }
  e.anyStorage().targets = targets;
  for (let contract = 0; contract < e.contracts.length; contract++) {
    if (Object.entries(e.contracts[contract].cost).every(([g, n]) => e.availGood(g) >= n))
      e.claimContract(contract);
  }
  for (const kind of ['haul', 'production'])
    if (e.availGood('gold') >= 15 * ((e.state.upgrades[kind] || 0) + 1)) e.buyUpgrade(kind);
}

function registerEconomyTest(seed, invest = false) {
  test(
    `autoplay reaches 200 banked gold${invest ? ' after all contracts and upgrades' : ''} (seed ${seed})`,
    { timeout: 120000 },
    async (t) => {
      const e = autoplay(seed);
      // Use the same fixed timestep and milestone updates as the browser runtime.
      const limit = Number(process.env.ECONOMY_SECONDS) || 7200,
        checkpoint = 60;
      let nextCheck = checkpoint;
      for (let i = 0; i < limit * 60 && !e.state.won; i++) {
        e.step(1 / 60);
        if (e.state.time >= nextCheck) {
          if (invest) investmentChoices(e);
          try {
            checkEconomy(e);
          } catch (error) {
            error.message += '\n' + JSON.stringify(snapshot(e));
            throw error;
          }
          nextCheck += checkpoint;
          await new Promise(setImmediate);
          if (t.signal.aborted) return;
        }
      }
      checkEconomy(e);
      console.log(`Economy seed ${seed}: ${JSON.stringify(snapshot(e))}`);
      assert.equal(e.state.won, true, JSON.stringify(snapshot(e)));
      assert.ok(e.state.gold >= e.GOAL);
      if (invest) {
        assert.equal(e.state.upgrades.haul, 3);
        assert.equal(e.state.upgrades.production, 3);
        assert.equal(e.state.spentGold, 180);
        assert.deepEqual([...e.state.contracts].sort(), [0, 1, 2, 3, 4, 5]);
      }
    },
  );
}

for (const seed of (process.env.ECONOMY_SEEDS?.split(',').map(Number) || [2024, 123, 42]).filter(
  (s) => !process.env.ECONOMY_SEED || s === Number(process.env.ECONOMY_SEED),
)) {
  registerEconomyTest(seed, process.env.ECONOMY_PROFILE === 'invest');
}
if (!process.env.ECONOMY_SEED && !process.env.ECONOMY_SEEDS && !process.env.ECONOMY_PROFILE)
  registerEconomyTest(27, true);

test('gold warehouse transfers preserve the treasury and remain saveable in transit', () => {
  const e = autoplay(42);
  e.state.auto = false;
  const hq = e.storages()[0],
    warehouse = e.newBuilding('warehouse', hq.x + 5, hq.y);
  warehouse.done = true;
  warehouse.constructionProgress = 1;
  warehouse.targets.gold = 10;
  e.buildings.push(warehouse);
  e.recomputeTerritory();
  hq.stock.gold = 20;
  e.state.gold = 20;
  let checkedCargo = false;
  for (let i = 0; i < 30 * 60; i++) {
    e.step(1 / 60);
    if (i % 30 === 0) {
      checkEconomy(e);
      if (e.units.some((u) => u.carry === 'gold' && u.carryTransfer)) checkedCargo = true;
    }
  }
  assert.ok(checkedCargo, 'validate a checkpoint while previously banked gold is carried');
  assert.equal(warehouse.stock.gold, 10);
  assert.equal(e.state.gold, 20);
  assert.equal(e.state.goldDelivered, 0);
});

test('a manually built timber, food and mining chain delivers gold without autoplay', () => {
  const e = autoplay(777);
  e.state.auto = false;
  const chain = [
    'lumberjack',
    'sawmill',
    'forester',
    'quarry',
    'farm',
    'windmill',
    'well',
    'bakery',
    'workshop',
    'warehouse',
  ];
  let next = 0,
    nextAction = 0;
  // Model deliberate player choices: complete the basic chain, then extend one
  // manned outpost at a time toward a deposit. No advisor/autoplay actions run.
  for (let tick = 0; tick < 900 * 60 && !e.state.goldDelivered; tick++) {
    e.step(1 / 60);
    if (e.state.time < nextAction) continue;
    nextAction = e.state.time + 2;
    if (next < chain.length) {
      const type = chain[next];
      if (e.afford(type)) {
        const spot = e.findSpot(type, null);
        if (spot && e.placeBuilding(type, ...spot)) next++;
      }
      continue;
    }
    const mines = e.buildings.filter((b) => b.type === 'mine_gold' && !b.exhausted).length;
    if (mines < 2 && e.afford('mine_gold')) {
      const spot = e.findSpot('mine_gold', null);
      if (spot && e.placeBuilding('mine_gold', ...spot)) continue;
    }
    if (
      mines < 2 &&
      e.buildings.every((b) => b.type !== 'guard' || b.manned) &&
      e.afford('guard')
    ) {
      const spot = e.spotOnCorridor(e.buildCorridor(['gold']), ['gold']);
      if (spot) e.placeBuilding('guard', ...spot);
    }
  }
  checkEconomy(e);
  assert.equal(e.state.auto, false);
  assert.ok(e.producedTotal('bread') > 0, 'the manual chain produces prepared food');
  assert.ok(e.state.goldDelivered > 0, JSON.stringify(snapshot(e)));
  assert.ok(e.state.gold > 0);
  assert.ok(e.buildings.some((b) => b.type === 'guard' && b.manned));
});
