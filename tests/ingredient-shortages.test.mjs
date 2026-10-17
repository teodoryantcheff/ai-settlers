import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, DEFAULT_MODULES } from './helpers/game.cjs';
import { createEconomicFeedback } from '../src/ui/economic-feedback.ts';
import { ingredientShortages, ingredientsConsumedNext } from '../src/gameplay/production-rules.ts';

function colony(type, stock, audio = false) {
  const { game, internals } = createGame({
    seed: 2024,
    headless: true,
    modules: audio ? [...DEFAULT_MODULES, 'audio'] : DEFAULT_MODULES,
    stubs: audio ? { nightAmt: () => 0 } : {},
  });
  game.tiles = Array.from({ length: game.W * game.H }, () => ({
    t: game.GRASS,
    tree: 0,
    rock: null,
    deposit: null,
    road: false,
  }));
  game.state.paused = false;
  const b = game.newBuilding(type, 12, 8);
  Object.assign(b, { done: true, stock, timer: 100 });
  game.buildings.push(b);
  if (type.startsWith('mine_')) {
    const tile = game.tiles[game.idx(13, 8)];
    tile.t = game.MTN;
    tile.deposit = { kind: game.BSPEC[type].resKind, amt: 100 };
  }
  return { game, hooks: internals.economy, audioHooks: internals.audio, b };
}

function observe(game) {
  const observer = createEconomicFeedback(game);
  const notices = [];
  let now = 0;
  observer.update(now);
  return {
    notices,
    advance(ms, step = () => game.step(0.25, true)) {
      for (let elapsed = 0; elapsed < ms; elapsed += 250) {
        step();
        now += 250;
        const notice = observer.update(now);
        if (notice) notices.push(notice);
      }
    },
  };
}

test('armory readiness, status and persistent notice report each missing ingredient', () => {
  for (const [missing, name] of [
    ['iron_bars', 'iron bars'],
    ['coal', 'coal'],
    [null, null],
  ]) {
    const stock = { iron_bars: 1, coal: 1 };
    if (missing) delete stock[missing];
    const { game, b, hooks } = colony('armory', stock);
    hooks.bTick(b, 0.25);
    assert.equal(b.blockedReason, missing ? 'inputs' : '');
    const status = game.buildingStatus(b);
    assert.equal(status.bad, !!missing);
    if (missing)
      assert.match(status.lines.map((line) => line.t).join('\n'), new RegExp('no ' + name));
    const feedback = observe(game);
    feedback.advance(12_000);
    if (missing) {
      assert.equal(feedback.notices.length, 1);
      assert.match(feedback.notices[0].message, new RegExp('blocked — needs ' + name + '$'));
    } else {
      assert.deepEqual(feedback.notices, []);
      b.timer = 0;
      hooks.bTick(b, 0.25);
      assert.equal(b.produced, 1);
      assert.equal(b.stock.iron_bars, 0);
      assert.equal(b.stock.coal, 0);
    }
  }
});

test('each edible good satisfies readiness, status and feedback; empty mines need provisions', () => {
  for (const meal of ['bread', 'meat', 'fish', 'food', null]) {
    const { game, b, hooks } = colony('mine_iron', meal ? { [meal]: 1 } : {});
    hooks.bTick(b, 0.25);
    assert.equal(b.blockedReason, meal ? '' : 'inputs');
    assert.equal(game.buildingStatus(b).bad, !meal);
    const feedback = observe(game);
    // Carrier deliveries may leave yesterday's input diagnosis until next tick.
    b.blockedReason = 'inputs';
    feedback.advance(12_000, () => {
      game.state.time += 0.25;
    });
    if (meal) {
      assert.deepEqual(feedback.notices, []);
      b.timer = 0;
      hooks.bTick(b, 0.25);
      assert.equal(b.produced, 1);
      assert.equal(b.metrics.consumed[meal], 1);
    } else {
      assert.equal(feedback.notices.length, 1);
      assert.match(feedback.notices[0].message, /needs provisions$/);
    }
  }
});

test('carrier arrivals at the blockage threshold invalidate stale input reasons in the same step', () => {
  const deliveries = [
    ['armory', { coal: 1 }, 'iron_bars'],
    ['armory', { iron_bars: 1 }, 'coal'],
    ...['bread', 'meat', 'fish', 'food'].map((good) => ['mine_iron', {}, good]),
    ['sawmill', { logs: 1 }, 'logs'],
  ];
  for (const [type, stock, good] of deliveries) {
    const { game, b } = colony(type, stock);
    game.step(0.25, true);
    const feedback = observe(game);
    feedback.advance(11_750);
    assert.deepEqual(feedback.notices, []);
    const job = { kind: 'fetch', good, to: b.id, status: 'assigned', sourceId: 0 };
    game.jobs.push(job);
    game.units.push({
      id: game.nextId++,
      kind: 'carrier',
      x: b.x + 0.5,
      y: b.y + 0.5,
      path: [],
      pi: 0,
      phase: 'd',
      job,
      carry: good,
      carryTransfer: true,
      dropB: b.id,
      dropIsSite: true,
      dead: false,
      lx: 0,
      ly: 0,
    });
    feedback.advance(250);
    assert.equal(b.blockedReason, 'inputs', 'building ticks before carrier arrival');
    assert.equal(b.stock[good], type === 'sawmill' ? 2 : 1);
    assert.equal(b.metrics.inputDelivered[good], 1);
    assert.equal(game.units[0].carry, null);
    assert.equal(game.buildingStatus(b).bad, false);
    assert.deepEqual(feedback.notices, [], type + ': delivery relieved the blockage before alert');
  }
});

test('recipe shortage queries preserve quantities, most-plentiful meals and stable ties without mutation', () => {
  const { game, b } = colony('mine_iron', { bread: 2, meat: 3, fish: 3, food: 3 });
  const original = structuredClone({ b, state: game.state });
  const rng = game.SR.getState();
  assert.deepEqual(ingredientsConsumedNext(b, game.BSPEC[b.type]), { meat: 1 });
  assert.deepEqual(ingredientShortages(b, game.BSPEC[b.type]), []);
  b.stock.bread = 3;
  assert.deepEqual(ingredientsConsumedNext(b, game.BSPEC[b.type]), { bread: 1 });
  b.stock.bread = 2;
  assert.deepEqual({ b, state: game.state }, original);
  assert.equal(game.SR.getState(), rng);
  const spec = { prod: 'craft', in: { logs: 2, coal: 1 } };
  assert.deepEqual(ingredientShortages({ type: 'sawmill', stock: { logs: 1 } }, spec), [
    { good: 'logs', have: 1, need: 2 },
    { good: 'coal', have: 0, need: 1 },
  ]);
});

test('musical starvation and activity use the same live recipes and alternate meals', () => {
  for (const [type, stock] of [
    ['armory', { iron_bars: 1, coal: 1 }],
    ['mine_iron', { bread: 1 }],
  ]) {
    const { b, audioHooks } = colony(type, stock, true);
    b.timer = 0;
    assert.equal(audioHooks.starvingCount(), 0);
    assert.equal(audioHooks.musicColony().active, 1);
    b.stock = {};
    assert.equal(audioHooks.starvingCount(), 1);
    assert.equal(audioHooks.musicColony().active, 0);
  }
});
