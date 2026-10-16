const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, pinClock } = require('./helpers/game.cjs');
pinClock(0);

function colony() {
  const { game: g } = createGame({
    seed: 2024,
    stubs: { SND: { fail() {} }, FX: { ring() {} } },
  });
  g.initializeColony();
  g.tiles = Array.from({ length: g.W * g.H }, () => ({
    t: g.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  g.owned.fill(1);
  return g;
}

test('unreachable-stock fallback retains its text and production advice', () => {
  const g = colony();
  const reason = { code: 'unreachable-stock' };
  assert.equal(g.placementText(reason), 'Not enough reachable stock');
  assert.equal(
    g.suggestFor(reason),
    'build more producers — or inspect a demolition quote for exact recoverable goods',
  );
});

function refusal(g, type, x, y, expected, text, advice = '') {
  const snapshot = () => JSON.stringify({ save: g.snapshotGame(), owned: g.owned });
  const before = snapshot();
  assert.deepEqual(g.canPlace(type, x, y), [false, expected]);
  assert.deepEqual(g.placementChecks(type, x, y).reason, expected);
  assert.equal(g.placementText(expected), text);
  assert.equal(g.suggestFor(expected), advice);
  let rejected;
  g.gameEvents.on('placementRejected', (event) => {
    rejected = event;
  });
  assert.equal(g.placeBuilding(type, x, y), false);
  assert.deepEqual(rejected, { type, x, y, reason: expected });
  assert.equal(g.msgs.at(-1).t, `✖ ${g.BSPEC[type].name}: ${text}${advice ? ' — ' + advice : ''}`);
  assert.equal(snapshot(), before, 'queries and refusals preserve simulation and RNG');
}

test('stock refusal names the first missing reachable good and keeps its advice', () => {
  for (const [good, required, available, text] of [
    ['planks', 3, 2, 'Not enough Planks'],
    ['stone', 2, 1, 'Not enough Stone'],
    ['tools', 1, 0, 'Not enough Tools'],
  ]) {
    const g = colony();
    g.anyStorage().stock[good] = available;
    const before = g.exportSave();
    assert.deepEqual(
      g.canPlace('farm', 51, 48),
      [true, null],
      'spatial permission excludes spending',
    );
    let rejected;
    g.gameEvents.on('placementRejected', (event) => {
      rejected = event;
    });
    assert.equal(g.placeBuilding('farm', 51, 48), false);
    const reason = { code: 'stock', good, required, available };
    assert.deepEqual(rejected, { type: 'farm', x: 51, y: 48, reason });
    assert.equal(g.placementText(reason), text);
    assert.equal(
      g.suggestFor(reason),
      'build more producers — or inspect a demolition quote for exact recoverable goods',
    );
    assert.equal(
      g.msgs.at(-1).t,
      `✖ ${text} — build more producers — or inspect a demolition quote for exact recoverable goods`,
    );
    assert.equal(g.exportSave(), before);
  }
});

test('out-of-bounds placement retains its refusal', () => {
  const g = colony();
  refusal(g, 'farm', -1, 48, { code: 'out-of-bounds' }, 'Out of bounds');
});

test('choose-map-tile code retains unchecked preview text and advice', () => {
  const g = colony();
  const checks = g.placementChecks('farm', -1, 48);
  for (const check of [checks.ownership, checks.resources]) {
    assert.equal(check.ok, null);
    assert.deepEqual(check.reason, { code: 'choose-map-tile' });
    assert.equal(g.placementText(check.reason), 'Choose a tile inside the map');
    assert.equal(g.suggestFor(check.reason), '');
  }
});

test('water refusal preserves its code, text and advice', () => {
  const g = colony();
  g.tiles[g.idx(51, 48)].t = g.WATER;
  refusal(g, 'farm', 51, 48, { code: 'water' }, 'Cannot build on water', '');
});

test('mountain refusal preserves its code, text and advice', () => {
  const g = colony();
  g.tiles[g.idx(51, 48)].t = g.MTN;
  refusal(g, 'farm', 51, 48, { code: 'mountain' }, 'Cannot build on mountains', '');
});

test('territory refusal preserves its code, text and advice', () => {
  const g = colony();
  g.owned[g.idx(51, 48)] = 0;
  refusal(
    g,
    'farm',
    51,
    48,
    { code: 'territory' },
    'Outside your territory',
    'build an Outpost toward that spot — it pushes your border out',
  );
});

test('shore-land refusal preserves its code, text and advice', () => {
  const g = colony();
  // The four valid terrains are either allowed or rejected earlier; retain the defensive copy.
  g.tiles[g.idx(51, 48)].t = 99;
  refusal(g, 'fisherman', 51, 48, { code: 'shore-land' }, 'Must stand on land by the shore', '');
});

test('no-water refusal preserves its code, text and advice', () => {
  const g = colony();

  refusal(
    g,
    'fisherman',
    51,
    48,
    { code: 'no-water' },
    'No water nearby',
    'place it on a shore inside your border (grass or sand both work)',
  );
});

test('meadow refusal preserves its code, text and advice', () => {
  const g = colony();
  g.tiles[g.idx(51, 48)].t = g.SAND;
  refusal(g, 'farm', 51, 48, { code: 'meadow' }, 'Must stand on meadow', '');
});

test('deposit refusal preserves its code, text and advice', () => {
  for (const [type, good, text] of [
    ['mine_coal', 'coal', 'Must border a mountain with coal deposit'],
    ['mine_iron', 'iron', 'Must border a mountain with iron ore deposit'],
    ['mine_gold', 'gold', 'Must border a mountain with gold deposit'],
  ]) {
    const g = colony();
    refusal(
      g,
      type,
      51,
      48,
      { code: 'deposit', good },
      text,
      'click mountains to scout them, then build against the wall with the colored dots',
    );
  }
});

test('no-rocks refusal preserves its code, text and advice', () => {
  const g = colony();

  refusal(
    g,
    'quarry',
    51,
    48,
    { code: 'no-rocks' },
    'No rocks nearby',
    'find a grey rock cluster — the map guarantees some near your start',
  );
});

test('blocked refusal preserves its code, text and advice', () => {
  const g = colony();

  refusal(g, 'farm', 48, 48, { code: 'blocked' }, 'Blocked', '');
});

test('spacing refusal preserves its code, text and advice', () => {
  const g = colony();

  refusal(
    g,
    'farm',
    49,
    49,
    { code: 'spacing', building: 'hq' },
    'Too close to Headquarters',
    'keep about 2 tiles of space between buildings',
  );
});

test('building names cannot redirect spacing advice to another refusal', () => {
  const g = colony();
  g.BSPEC.hq.name = 'Not enough deposit space';
  refusal(
    g,
    'farm',
    49,
    49,
    { code: 'spacing', building: 'hq' },
    'Too close to Not enough deposit space',
    'keep about 2 tiles of space between buildings',
  );
});

test('allowed placement has no refusal text or advice', () => {
  const g = colony();
  assert.deepEqual(g.canPlace('farm', 51, 48), [true, null]);
  assert.equal(g.placementText(null), '');
  assert.equal(g.suggestFor(null), '');
});
