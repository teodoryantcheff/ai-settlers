'use strict';
// Shared economy fixtures: a seeded autoplay colony, invariant checks and a
// diagnostic snapshot used by the fast economy tests and the soak suite.
const assert = require('node:assert/strict');
const { validateSave } = require('../../src/core/state.ts');
const {
  createGame,
  fakeDom,
  fakeElement,
  fakeWindow,
  installGlobals,
  DEFAULT_MODULES,
} = require('./game.cjs');

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
  const stocks = Object.fromEntries(Object.keys(e.GOODS).map((g) => [g, e.storedStock(g)]));
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
    e.storedStock('gold') + carriedBankedGold,
    e.state.gold,
    'treasury includes previously banked gold moving between warehouses',
  );
  assert.doesNotThrow(
    () => e.validateSave(e.snapshotGame(), e.W, e.H, e.BSPEC, e.GOODS),
    'live economy remains saveable',
  );
}

module.exports = { autoplay, checkEconomy, snapshot };
