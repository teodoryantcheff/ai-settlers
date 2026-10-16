import { createGame } from './helpers/game.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEconomicFeedback,
  ECONOMIC_BLOCKAGE_DELAY_MS,
  ECONOMIC_GLOBAL_COOLDOWN_MS,
  ECONOMIC_BUILDING_COOLDOWN_MS,
} from '../src/ui/economic-feedback.ts';

function producer(overrides = {}) {
  return {
    id: 1,
    type: 'sawmill',
    x: 12,
    y: 8,
    done: true,
    disabled: false,
    exhausted: false,
    produced: 0,
    stock: { logs: 0 },
    blockedReason: '',
    ...overrides,
  };
}

function harness(buildings = [producer()], speed = 1) {
  const source = {
    buildings,
    state: { time: 0, paused: false, won: false, speed },
    BSPEC: {
      sawmill: { name: 'Sawmill', prod: 'craft', out: 'planks', in: { logs: 1 } },
      lumberjack: { name: 'Woodcutter', prod: 'gather', out: 'logs' },
      quarry: { name: 'Quarry', prod: 'rock', out: 'stone' },
      farm: { name: 'Farm', prod: 'farm', out: 'food' },
      mine_coal: { name: 'Coal mine', prod: 'mine', out: 'coal', in: { food: 1 } },
      forester: { name: 'Forester', prod: 'plant' },
      hq: { name: 'Headquarters', prod: 'none', store: true },
    },
    GOODS: Object.fromEntries(
      ['logs', 'planks', 'stone', 'food', 'coal'].map((good) => [good, { name: good }]),
    ),
    SR() {
      throw new Error('presentation must not consume simulation RNG');
    },
  };
  const observer = createEconomicFeedback(source);
  let now = 0;
  const notices = [];
  const poll = (ms = 250, options) => {
    now += ms;
    if (!source.state.paused) source.state.time += (ms / 1000) * source.state.speed;
    const notice = observer.update(now, options);
    if (notice) notices.push(notice);
    return notice;
  };
  const advance = (ms, options) => {
    let last = null;
    while (ms > 0) {
      const dt = Math.min(ms, 250);
      last = poll(dt, options);
      ms -= dt;
    }
    return last;
  };
  assert.equal(observer.update(now), null, 'first observation is a quiet baseline');
  return { source, observer, poll, advance, notices, now: () => now };
}

test('brief blockage is quiet; the same sustained reason produces one accurate notice', () => {
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(3000);
  b.blockedReason = '';
  h.advance(3000);
  assert.deepEqual(h.notices, [], 'clearing a brief wait is not a recovery');
  b.blockedReason = 'inputs';
  h.poll();
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS - 250);
  assert.deepEqual(h.notices, []);
  const notice = h.poll();
  assert.equal(notice.kind, 'blocked');
  assert.equal(notice.reason, 'inputs');
  assert.match(notice.message, /Sawmill \(12, 8\): blocked — needs logs/);
  h.advance(60_000);
  assert.equal(h.notices.length, 1, 'an unchanged stall is not a repeating alarm');
});

test('starts require first actual output, not construction, input deliveries or a ready timer', () => {
  const b = producer({ done: false, timer: 0 });
  const h = harness([b, producer({ id: 2, type: 'forester', produced: 9 })]);
  b.done = true;
  b.stock.logs = 3;
  h.advance(10_000);
  assert.deepEqual(h.notices, []);
  b.produced = 1;
  const start = h.poll();
  assert.equal(start.kind, 'started');
  assert.match(start.message, /first planks produced/);
  for (let i = 0; i < 50; i++) {
    b.produced++;
    h.poll();
  }
  assert.equal(h.notices.length, 1, 'later cycles do not restart the chain');
});

test('economic feedback continues after victory and a modal cannot mature a blockage', () => {
  const b = producer({ blockedReason: 'inputs' });
  const h = harness([b]);
  h.source.state.won = true;
  h.advance(30_000, { active: false });
  assert.deepEqual(h.notices, []);
  h.poll();
  b.blockedReason = '';
  b.produced = 1;
  assert.equal(h.poll().kind, 'started');
});

test('a cleared reason alone is not recovery; actual output after a warned stall is', () => {
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  assert.equal(h.notices[0].kind, 'blocked');
  b.stock.logs = 1;
  b.blockedReason = '';
  h.advance(ECONOMIC_BUILDING_COOLDOWN_MS);
  assert.equal(h.notices.length, 1, 'ready to work does not prove that output resumed');
  b.produced++;
  const recovered = h.poll();
  assert.equal(recovered.kind, 'recovered');
  assert.match(recovered.message, /production resumed/);
  b.produced++;
  h.advance(30_000);
  assert.equal(h.notices.length, 2);
});

test('first output following an announced stall resolves it rather than playing two successes', () => {
  const b = producer({ blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  b.blockedReason = '';
  b.produced = 1;
  h.poll();
  h.advance(ECONOMIC_BUILDING_COOLDOWN_MS);
  assert.deepEqual(
    h.notices.map((notice) => notice.kind),
    ['blocked', 'recovered'],
  );
});

test('intentional, demand and reserve pauses are quiet and cancel recovery obligations', () => {
  for (const reason of ['paused', 'demand', 'reserve']) {
    const b = producer({ produced: 4, blockedReason: reason });
    const h = harness([b]);
    h.advance(30_000);
    b.blockedReason = '';
    b.produced++;
    h.advance(30_000);
    assert.deepEqual(h.notices, [], reason);
  }
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  b.disabled = true; // disabled takes precedence over a stale actionable code
  h.advance(30_000);
  b.disabled = false;
  b.blockedReason = '';
  b.produced++;
  h.advance(30_000);
  assert.deepEqual(
    h.notices.map((notice) => notice.kind),
    ['blocked'],
  );
});

test('production between samples breaks continuity even if 8x ends each frame waiting for inputs', () => {
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b], 8);
  for (let i = 0; i < 80; i++) {
    b.produced++;
    h.advance(1000);
  }
  assert.deepEqual(h.notices, []);
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  assert.equal(h.notices.at(-1).kind, 'blocked', 'only continuous lack of output is a stall');
});

test('a frame ending demand-limited still reports proven output, never a demand blockage', () => {
  const b = producer({ type: 'farm' });
  const h = harness([b], 8);
  b.produced = 1;
  b.blockedReason = 'demand';
  assert.equal(h.poll().kind, 'started');
  h.advance(30_000);
  assert.equal(h.notices.length, 1);

  const recovering = producer({ produced: 4, blockedReason: 'inputs' });
  const recovery = harness([recovering], 8);
  recovery.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  recovering.produced++;
  recovering.blockedReason = 'reserve';
  recovery.advance(ECONOMIC_BUILDING_COOLDOWN_MS);
  assert.deepEqual(
    recovery.notices.map((notice) => notice.kind),
    ['blocked', 'recovered'],
  );
});

test('accelerated play coalesces matching transitions and uses real-time global/building cooldowns', () => {
  const buildings = Array.from({ length: 24 }, (_, i) => producer({ id: i + 1, x: i }));
  const farm = producer({ id: 25, type: 'farm' });
  const h = harness([...buildings, farm], 8);
  for (const b of buildings) b.produced = 1;
  farm.produced = 1;
  const start = h.poll();
  assert.equal(start.kind, 'started');
  assert.equal(start.count, 24);
  assert.equal(start.buildings.length, 3, 'grouped examples remain bounded');
  assert.match(start.message, /\+ 21 more/);
  h.advance(ECONOMIC_GLOBAL_COOLDOWN_MS - 250);
  assert.equal(h.notices.length, 1, 'eight simulated seconds are not eight real seconds');
  h.poll();
  assert.equal(h.notices.length, 2);
  assert.equal(h.notices[1].buildings[0].type, 'farm');
  for (const b of buildings) b.blockedReason = 'inputs';
  h.poll();
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  assert.equal(h.notices.length, 3);
  const blocked = h.notices[2];
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.count, 24);
  assert.ok(blocked.at - start.at >= ECONOMIC_BUILDING_COOLDOWN_MS);
  for (const b of buildings) {
    b.produced++;
    b.blockedReason = '';
  }
  h.poll();
  h.advance(ECONOMIC_BUILDING_COOLDOWN_MS - 500);
  assert.equal(h.notices.length, 3);
  h.poll();
  assert.equal(h.notices.length, 4);
  assert.equal(h.notices[3].kind, 'recovered');
  assert.equal(h.notices[3].count, 24);
});

test('state/array replacement establishes a clean load baseline, discarding queued starts/recovery', () => {
  for (const replacement of ['state', 'buildings']) {
    const b = producer({ blockedReason: 'inputs', produced: 4 });
    const h = harness([b]);
    h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
    b.produced++;
    b.blockedReason = '';
    h.poll(); // recovery is waiting for the per-building cooldown
    if (replacement === 'state') h.source.state = { ...h.source.state, time: 100 };
    else h.source.buildings = [...h.source.buildings];
    h.poll();
    b.produced++;
    h.advance(30_000);
    assert.deepEqual(
      h.notices.map((notice) => notice.kind),
      ['blocked'],
      replacement,
    );
  }
  const b = producer();
  const h = harness([b]);
  b.produced++;
  h.poll(250, { canNotify: false });
  h.source.buildings = [producer({ produced: 40 })];
  h.poll();
  h.source.buildings[0].produced++;
  h.advance(30_000);
  assert.deepEqual(h.notices, [], 'loaded lifetime production is not a new chain');
});

test('demolition and entity replacement remove pending notices, even with a reused ID', () => {
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  b.produced++;
  b.blockedReason = '';
  h.poll();
  h.source.buildings.splice(0, 1);
  h.poll();
  h.advance(30_000);
  assert.deepEqual(
    h.notices.map((notice) => notice.kind),
    ['blocked'],
  );
  const replacement = producer({ id: b.id });
  h.source.buildings.push(replacement);
  h.poll();
  replacement.produced++;
  assert.equal(
    h.poll().kind,
    'started',
    'a distinct new entity does not inherit recovery/cooldown',
  );
});

test('paused/hidden/no-step samples do not announce transitions or count offline time as blockage', () => {
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(6000);
  h.source.state.paused = true;
  h.advance(60_000);
  h.source.state.paused = false;
  h.poll();
  assert.deepEqual(h.notices, []);
  h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
  assert.equal(h.notices.length, 1);
  h.source.state.paused = true;
  h.advance(60_000);
  h.source.state.paused = false;
  h.advance(30_000);
  assert.equal(h.notices.length, 1, 'pausing must not repeat an already-announced reason');

  const hidden = harness([producer({ produced: 4, blockedReason: 'inputs' })]);
  hidden.advance(60_000, { active: false });
  hidden.poll();
  assert.deepEqual(hidden.notices, []);
  hidden.poll(60_000);
  assert.deepEqual(hidden.notices, [], 'a long unobserved gap has no catch-up alert');

  const noStep = harness([producer({ produced: 4, blockedReason: 'inputs' })]);
  for (let now = 250; now < 30_000; now += 250)
    assert.equal(noStep.observer.update(now), null, 'no advancing simulation means no notices');
});

test('delivered stock resolves stale reason codes; unsupported reasons are not guessed', () => {
  const buildings = [
    producer({ produced: 4, blockedReason: 'inputs', stock: { logs: 2 } }),
    producer({ id: 2, produced: 4, blockedReason: 'output', stock: { planks: 3 } }),
    producer({ id: 3, produced: 4, blockedReason: 'unrecognized imported reason' }),
  ];
  const h = harness(buildings);
  h.advance(30_000);
  assert.deepEqual(h.notices, []);
});

test('input, output, resource and exhaustion reasons remain distinct without mutating simulation', () => {
  for (const [reason, overrides, text] of [
    ['inputs', {}, /needs logs/],
    ['output', { stock: { planks: 8 } }, /output store full/],
    ['resources', { type: 'lumberjack' }, /no mature trees/],
    ['resources', { type: 'quarry' }, /no rocks/],
    ['exhausted', { type: 'mine_coal', exhausted: true }, /deposit exhausted/],
  ]) {
    const b = producer({ produced: 4, blockedReason: reason, ...overrides });
    Object.freeze(b.stock);
    Object.freeze(b);
    const before = JSON.stringify(b);
    const h = harness(Object.freeze([b]));
    h.advance(ECONOMIC_BLOCKAGE_DELAY_MS);
    assert.equal(h.notices[0].reason, reason);
    assert.match(h.notices[0].message, text);
    assert.equal(JSON.stringify(b), before);
  }
});

test('withholding the visual channel retains valid transitions and drops obsolete blockage', () => {
  const b = producer({ produced: 4, blockedReason: 'inputs' });
  const h = harness([b]);
  h.advance(30_000, { canNotify: false });
  assert.deepEqual(h.notices, []);
  b.blockedReason = '';
  b.produced++;
  h.advance(30_000);
  assert.deepEqual(h.notices, [], 'never announce recovery from an unseen, obsolete warning');
  b.blockedReason = 'inputs';
  h.advance(30_000, { canNotify: false });
  assert.equal(h.poll().kind, 'blocked', 'a still-valid issue survives channel congestion');
});

test('real production counters drive feedback without changing economic results or seeded RNG', () => {
  function game() {
    const { game: runtime } = createGame({ seed: 2024, headless: true });
    runtime.tiles = Array.from({ length: runtime.W * runtime.H }, () => ({
      t: runtime.GRASS,
      tree: 0,
      rock: null,
      deposit: null,
      road: false,
    }));
    runtime.state.paused = false;
    runtime.state.speed = 8;
    const b = runtime.newBuilding('sawmill', 12, 8);
    b.done = true;
    b.timer = 0;
    b.stock.logs = runtime.BSPEC.sawmill.in.logs;
    runtime.buildings.push(b);
    return runtime;
  }
  const observed = game();
  const control = game();
  const observer = createEconomicFeedback(observed);
  observer.update(0);
  const notices = [];
  for (let now = 250; now <= 45_000; now += 250) {
    for (const runtime of [observed, control]) {
      if (now === 25_000) runtime.buildings[0].stock.logs = runtime.BSPEC.sawmill.in.logs;
      runtime.step(2);
    }
    const notice = observer.update(now);
    if (notice) notices.push(notice);
    assert.deepEqual(observed.buildings, control.buildings);
    assert.deepEqual(observed.state, control.state);
    assert.equal(observed.SR.getState(), control.SR.getState());
  }
  assert.equal(notices[0].kind, 'started');
  assert.equal(notices[1].kind, 'blocked');
  assert.equal(notices[1].reason, 'inputs');
  assert.equal(observed.buildings[0].produced, 2);
});
