import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  DEFAULT_MODULES,
  fakeDom,
  fakeElement,
  fakeWindow,
  installGlobals,
  pinClock,
} from './helpers/game.cjs';

pinClock(0);

const SECTIONS = [
  '[data-inspector-live]',
  '[data-production-stats]',
  '[data-inspector-reference]',
  '[data-demolition-quote]',
];

// Browsers serialize self-closing SVG children as explicit end tags, so markup
// read back from a section never equals the markup written to it.
const serialize = (html) => html.replace(/<(path|circle|ellipse|rect)([^>]*?)\/>/g, '<$1$2></$1>');

function section(writes, selector) {
  let html = '';
  return {
    ...fakeElement(),
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      writes[selector] = (writes[selector] || 0) + 1;
      html = serialize(value);
    },
  };
}

function inspector() {
  const writes = {};
  const listeners = {};
  let sections = {};
  let html = '';
  const body = {
    ...fakeElement('infobody'),
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      writes.body = (writes.body || 0) + 1;
      html = serialize(value);
      sections = Object.fromEntries(
        SECTIONS.filter((selector) => value.includes(selector.slice(1, -1))).map((selector) => [
          selector,
          section(writes, selector),
        ]),
      );
    },
    querySelector: (selector) => sections[selector] || null,
    addEventListener: (name, callback) => {
      listeners[name] = callback;
    },
  };
  const dom = fakeDom();
  dom.nodes.set('infobody', body);
  const { window } = fakeWindow();
  installGlobals({ document: dom.document, window });
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'hud'],
    stubs: {
      view: fakeElement('view'),
      mini: fakeElement('mini'),
      SND: { demolish() {} },
    },
  });
  game.initializeColony();
  const mill = game.newBuilding('sawmill', 51, 48);
  Object.assign(mill, { done: true, constructionProgress: 1, stock: { logs: 1 } });
  game.buildings.push(mill);
  game.selected = mill;
  const counts = () => ({ ...writes });
  const reset = () => {
    for (const key of Object.keys(writes)) delete writes[key];
  };
  return { game, mill, counts, reset, listeners };
}

test('repeated interface updates leave an unchanged inspector untouched', () => {
  const { game, counts, reset } = inspector();
  game.updateInfo();
  assert.equal(counts().body, 1, 'the first selection renders the whole inspector');
  reset();
  for (let tick = 0; tick < 5; tick++) game.updateInfo();
  assert.deepEqual(counts(), {}, 'no section is rewritten while its content is unchanged');
});

test('a changed section is rewritten on the next tick and only then', () => {
  const { game, mill, counts, reset } = inspector();
  game.updateInfo();
  reset();
  mill.stock.logs = 2;
  game.updateInfo();
  // Local stock appears in the live evidence and as demolition salvage.
  assert.deepEqual(counts(), { '[data-inspector-live]': 1, '[data-demolition-quote]': 1 });
  reset();
  game.updateInfo();
  game.updateInfo();
  assert.deepEqual(counts(), {});
});

test('changing the selection renders fresh content', () => {
  const { game, counts, reset } = inspector();
  game.updateInfo();
  reset();
  game.selected = game.anyStorage();
  game.updateInfo();
  assert.equal(counts().body, 1);
});

test('inspector priority and reserve edits go through simulation operations', () => {
  const { game, listeners } = inspector();
  const events = [];
  game.gameEvents.on('productionControlChanged', (event) => events.push(event.building));
  const site = game.newBuilding('farm', 54, 48);
  game.buildings.push(site);
  game.selected = site;
  game.updateInfo();
  const control = (selector, value, dataset = {}) => ({
    target: { matches: (candidate) => candidate === selector, value, dataset },
  });
  listeners.change(control('[data-priority]', '2'));
  listeners.change(control('[data-priority]', '7'));
  assert.equal(site.priority, 2, 'out-of-range levels are rejected by the operation');
  const hq = game.anyStorage();
  game.selected = hq;
  listeners.change(control('[data-target]', '900', { target: 'planks' }));
  assert.equal(hq.targets.planks, 500);
  assert.deepEqual(events, [site, hq]);
});
