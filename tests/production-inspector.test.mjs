import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fakeDom, fakeElement, fakeWindow, installGlobals } from './helpers/game.cjs';

function inspectorHarness() {
  const noop = () => {};
  const listeners = {};
  const stats = { innerHTML: '' };
  const nodes = new Map();
  let focused = false;
  const body = {
    innerHTML: '',
    contains: () => focused,
    addEventListener: (name, callback) => {
      listeners[name] = callback;
    },
    querySelector: (selector) => (selector === '[data-production-stats]' ? stats : null),
  };
  nodes.set('infobody', body);
  const calls = [];
  const metrics = { elapsed: 240 };
  const dom = fakeDom();
  dom.nodes.set('infobody', body);
  dom.document.activeElement = { matches: () => true };
  const { window } = fakeWindow();
  installGlobals({ document: dom.document, window });
  const { game: context } = createGame({
    modules: ['hud'],
    stubs: {
      view: fakeElement('view'),
      mini: fakeElement('mini'),
      gameEvents: { on: () => {} },
      selected: { type: 'sawmill', done: true, stock: {}, metrics },
      selInfo: null,
      BSPEC: {
        sawmill: { name: 'Sawmill', prod: 'craft', in: { logs: 2 }, out: 'planks', time: 8 },
      },
      GOODS: { logs: { name: 'Logs' }, planks: { name: 'Planks' } },
      state: { upgrades: {} },
      bStatus: () => ({ lines: [] }),
      productionWindow: (m, window) => {
        calls.push({ m, window });
        return {
          elapsed: window === 'lifetime' ? 240 : 29,
          inputBlocked: 0,
          produced: { planks: window === 'lifetime' ? 24 : 3 },
          consumed: { logs: window === 'lifetime' ? 48 : 6 },
          inputDelivered: { logs: 2 },
          outputDelivered: { planks: 1 },
          deliveryElapsed: 20,
          sampleInterval: window === 'lifetime' ? 0 : 2,
        };
      },
    },
  });
  return {
    context,
    body,
    stats,
    calls,
    metrics,
    listeners,
    focus: () => {
      focused = true;
    },
  };
}

test('inspector offers all windows and reports actual recent coverage', () => {
  const e = inspectorHarness();
  e.context.updateInfo();
  assert.match(e.body.innerHTML, /data-rate-window/);
  assert.match(e.body.innerHTML, /Last 30 seconds/);
  assert.match(e.body.innerHTML, /Last 2 minutes/);
  assert.match(e.body.innerHTML, /Lifetime/);
  assert.match(e.body.innerHTML, /Observed 29\.0s of simulation time · 2s samples/);
  assert.match(e.body.innerHTML, /data-delivered-rate>3\.0</);
  assert.equal(e.calls[0].window, 30);
});

test('rate selection refreshes immediately without replacing the focused control', () => {
  const e = inspectorHarness();
  e.context.updateInfo();
  const original = e.body.innerHTML;
  e.focus();
  e.listeners.change({
    target: { matches: (selector) => selector === '[data-rate-window]', value: 'lifetime' },
  });
  assert.equal(e.calls.at(-1).m, e.metrics);
  assert.equal(e.calls.at(-1).window, 'lifetime');
  assert.match(e.stats.innerHTML, /data-produced-rate>6\.0</);
  assert.match(
    e.stats.innerHTML,
    /Observed 240\.0s of simulation time<br>Deliveries: 20\.0s observed/,
  );
  assert.equal(e.body.innerHTML, original, 'the focused select is not destroyed');
  e.listeners.change({
    target: { matches: (selector) => selector === '[data-rate-window]', value: '120' },
  });
  assert.equal(e.calls.at(-1).window, 120);
});

test('zero coverage is unavailable, not a misleading zero measured rate', () => {
  const e = inspectorHarness();
  e.context.productionWindow = () => ({
    elapsed: 0,
    inputBlocked: 0,
    produced: {},
    consumed: {},
    inputDelivered: {},
    outputDelivered: {},
    deliveryElapsed: 0,
    sampleInterval: 2,
  });
  e.context.updateInfo();
  assert.match(e.body.innerHTML, /data-produced-rate>—</);
  assert.match(e.body.innerHTML, /Logs: Delivered in — per minute/);
  assert.match(e.body.innerHTML, /data-delivered-rate>—</);
  assert.match(e.body.innerHTML, /Observed 0\.0s/);
});

test('rates stay live while the rate-window control retains keyboard focus', () => {
  const e = inspectorHarness();
  e.context.updateInfo();
  const original = e.body.innerHTML;
  e.focus();
  e.context.productionWindow = () => ({
    elapsed: 30,
    inputBlocked: 30,
    produced: {},
    consumed: {},
    inputDelivered: {},
    outputDelivered: {},
    deliveryElapsed: 30,
    sampleInterval: 2,
  });
  e.context.updateInfo();
  assert.match(e.stats.innerHTML, /data-produced-rate>0\.0</);
  assert.match(e.stats.innerHTML, /aria-valuenow="100"/);
  assert.equal(e.body.innerHTML, original, 'updates must not destroy the focused select');
});

test('mine inspector reports actual edible cargo instead of hiding it behind legacy food', () => {
  const e = inspectorHarness();
  e.context.selected.type = 'mine_gold';
  e.context.BSPEC.mine_gold = {
    name: 'Gold Mine',
    prod: 'mine',
    in: { food: 1 },
    out: 'gold',
    time: 16,
  };
  e.context.GOODS = { bread: { name: 'Bread' }, meat: { name: 'Meat' }, gold: { name: 'Gold' } };
  e.context.productionWindow = () => ({
    elapsed: 30,
    inputBlocked: 0,
    produced: { gold: 1 },
    consumed: { bread: 1, meat: 1 },
    inputDelivered: { bread: 2, meat: 1 },
    outputDelivered: { gold: 1 },
    deliveryElapsed: 30,
    sampleInterval: 2,
  });
  e.context.updateInfo();
  assert.match(e.body.innerHTML, /1 fish, bread, meat or provisions/);
  assert.match(e.body.innerHTML, /Bread: Consumed 2\.0 per minute/);
  assert.match(e.body.innerHTML, /Bread: Delivered in 4\.0 per minute/);
  assert.match(e.body.innerHTML, /Meat: Consumed 2\.0 per minute/);
  assert.match(e.body.innerHTML, /Meat: Delivered in 2\.0 per minute/);
});

test('mine inspector preserves observed historical goods outside its current eligible meals', () => {
  const e = inspectorHarness();
  e.context.selected.type = 'mine_gold';
  e.context.BSPEC.mine_gold = { name: 'Gold Mine', prod: 'mine', in: { food: 1 }, out: 'gold' };
  e.context.GOODS = { grain: { name: 'Grain' }, gold: { name: 'Gold' } };
  e.context.productionWindow = () => ({
    elapsed: 30,
    inputBlocked: 0,
    produced: {},
    consumed: { grain: 1 },
    inputDelivered: { grain: 2 },
    outputDelivered: {},
    deliveryElapsed: 30,
    sampleInterval: 2,
  });
  e.context.updateInfo();
  assert.match(e.body.innerHTML, /Grain: Consumed 2\.0 per minute/);
  assert.match(e.body.innerHTML, /Grain: Delivered in 4\.0 per minute/);
});
