import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSubsystem } from '../src/core/attach.ts';
import { createGame } from './helpers/game.cjs';

function simulation(seed) {
  return createGame({ seed, headless: true }).game;
}

test('real modules generate identical seeded worlds with independent state', () => {
  const a = simulation(2024);
  const b = simulation(2024);
  a.genMap();
  b.genMap();
  assert.deepEqual(a.tiles, b.tiles);
  assert.notEqual(a.tiles, b.tiles);
  a.state.gold = 17;
  assert.equal(b.state.gold, 0);
  a.buildings.push(a.newBuilding('hq', 48, 48));
  assert.equal(b.buildings.length, 0);
  assert.deepEqual(a.findPath(48, 48, 50, 48), b.findPath(48, 48, 50, 48));
});

test('module composition preserves replacement and mutation of live bindings', () => {
  const game = simulation(123);
  const buildings = [game.newBuilding('hq', 48, 48)];
  game.buildings = buildings;
  assert.equal(game.byId(buildings[0].id), buildings[0]);
  game.buildings = [];
  assert.equal(game.byId(buildings[0].id), null);
  const nextId = game.nextId;
  game.newBuilding('farm', 49, 48);
  assert.equal(game.nextId, nextId + 1);
});

test('duplicate subsystem bindings are rejected before changing the runtime', () => {
  const game = { value: 1 };
  assert.throws(() => attachSubsystem(game, { other: 2, value: 3 }), /Duplicate runtime binding/);
  assert.deepEqual(game, { value: 1 });
});

test('composed simulation delivers grain and emits victory without a DOM', () => {
  const game = simulation(2024);
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    res: null,
    road: false,
  }));
  const hq = game.newBuilding('hq', 48, 48);
  const farm = game.newBuilding('farm', 50, 48);
  for (const b of [hq, farm]) {
    b.done = true;
    b.prog = 1;
  }
  game.buildings.push(hq, farm);
  game.recomputeTerritory();
  game.spawnCarrier(hq);
  const deliveries = [];
  const victories = [];
  game.gameEvents.on('goodsDelivered', (e) => deliveries.push(e));
  game.gameEvents.on('victory', (e) => victories.push(e));
  for (let i = 0; i < 1200; i++) game.step(1 / 60);
  assert.ok((hq.stock.grain || 0) > 0);
  assert.ok(deliveries.some((e) => e.good === 'grain' && e.building === hq));
  game.state.gold = game.GOAL;
  game.step(1 / 60);
  game.step(1 / 60);
  assert.equal(victories.length, 1);
  assert.equal(victories[0].gold, game.GOAL);
});
