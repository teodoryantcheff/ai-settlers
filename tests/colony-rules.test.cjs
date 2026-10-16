'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./helpers/game.cjs');
const { hasWellCoverage } = require('../src/gameplay/colony-rules.ts');

function colony() {
  const { game, internals } = createGame({ seed: 42, headless: true });
  game.initializeColony();
  return { game, findSpot: internals.autoplay.findSpot };
}

function place(game, type, x, y, done = true) {
  const b = game.newBuilding(type, x, y);
  Object.assign(b, { done, prog: done ? 1 : 0 });
  game.buildings.push(b);
  return b;
}

test('planned coverage counts wells under construction; active service needs a finished well', () => {
  const { game } = colony();
  const bakery = { x: 48, y: 52 };
  const well = place(game, 'well', 48, 48, false);
  const rng = game.SR.getState();
  assert.equal(hasWellCoverage(game, bakery, 'planned'), true);
  assert.equal(hasWellCoverage(game, bakery, 'active'), false);
  well.done = true;
  assert.equal(hasWellCoverage(game, bakery, 'active'), true);
  well.disabled = true;
  assert.equal(hasWellCoverage(game, bakery, 'planned'), false, 'paused wells plan nothing');
  assert.equal(hasWellCoverage(game, bakery, 'active'), false, 'paused wells serve nothing');
  assert.equal(game.SR.getState(), rng, 'the rule consumes no RNG');
});

test('coverage uses the building table radius and connected land', () => {
  const { game } = colony();
  place(game, 'well', 48, 48);
  const site = { x: 48, y: 48 + game.BSPEC.well.rad };
  assert.equal(hasWellCoverage(game, site, 'active'), true, 'the radius is inclusive');
  assert.equal(hasWellCoverage(game, { x: 48, y: site.y + 1 }, 'active'), false);
  game.connectedLand = () => false;
  assert.equal(hasWellCoverage(game, site, 'active'), false, 'water needs connected land');
});

test('the building table radius drives production, the advisor and autoplay', () => {
  const { game, findSpot } = colony();
  const well = place(game, 'well', 48, 48, false);
  const bakery = place(game, 'bakery', 48, 53);
  const wellTarget = () => game.advTargets().find((row) => row.bt === 'well').target;
  // Six tiles: the planned well covers the bakery, so no second well is wanted.
  const covered = wellTarget();
  well.done = true;
  assert.equal(game.hasLocalWater(bakery), true);
  well.done = false;

  game.BSPEC.well.rad = 3;
  assert.equal(wellTarget(), covered + 1, 'the advisor asks for a well beside the bakery');
  const wellSpot = findSpot('well');
  assert.ok(wellSpot);
  assert.ok(Math.hypot(wellSpot[0] - bakery.x, wellSpot[1] - bakery.y) <= 3);
  well.done = true;
  assert.equal(game.hasLocalWater(bakery), false, 'production loses its water service');
  assert.match(game.advTargets().find((row) => row.bt === 'well').why, /within 3 tiles/);
  assert.ok(game.buildingStatus(bakery).lines.some((line) => /within 3 tiles/.test(line.t)));
  const bakerySpot = findSpot('bakery');
  assert.ok(bakerySpot);
  assert.ok(Math.hypot(bakerySpot[0] - well.x, bakerySpot[1] - well.y) <= 3);
});
