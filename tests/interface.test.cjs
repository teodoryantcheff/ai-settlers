'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  fakeDom,
  fakeElement,
  fakeWindow,
  installGlobals,
} = require('./helpers/game.cjs');

function fpsCounter() {
  const display = element('fps');
  display.textContent = '— FPS';
  const document = {
    getElementById: () => display,
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const { window } = fakeWindow();
  installGlobals({ document, window });
  const { game: context } = createGame({
    modules: ['hud'],
    stubs: {
      view: element('view'),
      mini: element('mini'),
      gameEvents: { on: () => {} },
    },
  });
  return { context, display, document };
}

test('FPS averages real frame intervals and refreshes only after half a second', () => {
  const { context, display } = fpsCounter();
  context.updateFps(0);
  for (let frame = 1; frame < 30; frame++) context.updateFps((frame * 1000) / 60);
  assert.equal(display.textContent, '— FPS');
  context.updateFps(500);
  assert.equal(display.textContent, '60 FPS');
  context.updateFps(750);
  assert.equal(display.textContent, '60 FPS');
  context.updateFps(1000);
  assert.equal(display.textContent, '4 FPS');
  // Long intervals are not capped like simulation dt.
  context.updateFps(3000);
  assert.equal(display.textContent, '1 FPS');
});

test('FPS resets across hidden tabs and rendering interruptions', () => {
  const { context, display, document } = fpsCounter();
  context.updateFps(0);
  context.updateFps(500);
  assert.equal(display.textContent, '2 FPS');
  document.visibilityState = 'hidden';
  context.updateFps(1000);
  assert.equal(display.textContent, '— FPS');
  document.visibilityState = 'visible';
  context.updateFps(60000);
  context.updateFps(60500);
  assert.equal(display.textContent, '2 FPS');
  context.resetFps();
  assert.equal(display.textContent, '— FPS');
  context.updateFps(90000);
  context.updateFps(90500);
  assert.equal(display.textContent, '2 FPS');
});

function element(tag = 'div') {
  let classes = new Set();
  const attributes = new Map();
  const node = {
    ...fakeElement(tag),
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    textContent: '',
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(key, value) {
      attributes.set(key, String(value));
    },
    getAttribute(key) {
      return attributes.get(key);
    },
    addEventListener() {},
    focus() {
      this.focused = true;
    },
    getContext() {
      return new Proxy({}, { get: () => () => {} });
    },
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        const active = force === undefined ? !classes.has(name) : force;
        if (active) classes.add(name);
        else classes.delete(name);
        return active;
      },
    },
  };
  Object.defineProperty(node, 'className', {
    get: () => [...classes].join(' '),
    set: (value) => {
      classes = new Set(value.split(/\s+/).filter(Boolean));
    },
  });
  Object.defineProperty(node, 'innerHTML', {
    set: () => {
      node.children = [];
    },
  });
  return node;
}

function interfaceControls() {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, element(id.endsWith('b') || id === 'advtoggle' ? 'button' : 'div'));
    return nodes.get(id);
  };
  node('palette').className = 'compact';
  node('paletteitems').className = 'hidden';
  node('adv').className = 'compact';
  for (const id of ['help', 'start', 'win', 'mix', 'savedata', 'economy'])
    node(id).className = 'hidden';
  const document = {
    ...fakeDom().document,
    visibilityState: 'visible',
    getElementById: node,
    createElement: element,
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === '#workspace-nav [data-workspace]') return [];
      if (selector === '.floating:not(.hidden)')
        return ['mix', 'savedata', 'economy']
          .map(node)
          .filter((panel) => !panel.classList.contains('hidden'));
      if (selector === '.floating') return ['mix', 'savedata', 'economy'].map(node);
      if (selector === '.pb') return node('paletteitems').children.filter((item) => item.dataset.b);
      assert.equal(selector, '[data-close]');
      return [];
    },
  };
  const win = fakeWindow();
  installGlobals({ document, window: win.window });
  const { game: context } = createGame({
    modules: ['state', 'workspace', 'hud'],
    stubs: {
      view: element('view'),
      mini: element('mini'),
      gameEvents: { on: () => {} },
      keys: {},
      ART: { road: Array(16).fill({}) },
      drawSpriteIcon() {},
      initAudio() {},
      SND: { tick() {}, ui() {} },
    },
  });
  context.buildPalette();
  const escape = (repeat = false) => {
    const event = {
      key: 'Escape',
      repeat,
      target: { matches: () => false, closest: () => null },
      stopImmediatePropagation() {},
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    win.fire('keydown', event);
    return event;
  };
  return { context, node, escape };
}

test('collapsed building tray exposes every existing tool when opened and can close without changing mode', () => {
  const { context, node } = interfaceControls();
  const buttons = node('paletteitems').children.filter((item) => item.dataset.b);
  assert.deepEqual(
    buttons.map((button) => button.dataset.b),
    Array.from(context.ORDER),
  );
  assert.ok(
    buttons.every((button) => button.tagName === 'BUTTON' && button.getAttribute('aria-label')),
  );
  assert.ok(node('paletteitems').classList.contains('hidden'));
  node('paletteb').onclick();
  assert.equal(node('paletteb').getAttribute('aria-expanded'), 'true');
  assert.equal(node('paletteitems').classList.contains('hidden'), false);
  node('paletteb').onclick();
  assert.equal(node('paletteb').getAttribute('aria-expanded'), 'false');
  assert.equal(context.mode, null);
});

test('selecting a building or road closes the tray, retains the chosen tool, and returns keyboard focus', () => {
  const { context, node } = interfaceControls();
  for (const type of ['lumberjack', 'road', 'demolish']) {
    node('paletteb').onclick();
    const button = node('paletteitems').children.find((item) => item.dataset.b === type);
    button.onclick();
    assert.equal(context.mode.type, type === 'lumberjack' ? 'build' : type);
    assert.equal(context.mode.bt, type === 'lumberjack' ? type : null);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(node('paletteitems').classList.contains('hidden'), true);
    assert.equal(node('paletteb').focused, true);
    assert.match(node('palettestatus').textContent, /selected$/);
  }
  context.cancelMode();
  assert.equal(node('palettestatus').textContent, 'Choose a building');
  assert.ok(
    node('paletteitems')
      .children.filter((item) => item.dataset.b)
      .every((button) => button.getAttribute('aria-pressed') === 'false'),
  );
});

test('advisor disclosure reveals guidance without changing whether the advisor is enabled', () => {
  const { context, node } = interfaceControls();
  context.toggleAdvisorDetails();
  assert.equal(node('adv').classList.contains('compact'), false);
  assert.equal(node('advtoggle').getAttribute('aria-expanded'), 'true');
  context.toggleAdvisorDetails();
  assert.equal(node('adv').classList.contains('compact'), true);
  assert.equal(node('advtoggle').getAttribute('aria-expanded'), 'false');
  assert.equal(node('adv').classList.contains('hidden'), false);
});

test('Escape closes floating panels then the build tray before cancelling a selected map tool', () => {
  const { context, node, escape } = interfaceControls();
  context.setMode('build', 'lumberjack');
  node('paletteb').onclick();
  context.openLayer('mix');
  escape();
  assert.equal(node('mix').classList.contains('hidden'), true);
  assert.equal(node('paletteitems').classList.contains('hidden'), false);
  assert.equal(context.mode.bt, 'lumberjack');
  assert.equal(escape().defaultPrevented, true);
  assert.equal(node('paletteitems').classList.contains('hidden'), true);
  assert.equal(node('paletteb').getAttribute('aria-expanded'), 'false');
  assert.equal(node('paletteb').focused, true);
  assert.equal(context.mode.bt, 'lumberjack');
  escape(true);
  assert.equal(
    context.mode.bt,
    'lumberjack',
    'holding Escape after tray dismissal must not cancel the tool',
  );
  escape();
  assert.equal(context.mode, null);
});
