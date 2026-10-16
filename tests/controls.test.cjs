'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, fakeDom, fakeWindow, installGlobals } = require('./helpers/game.cjs');

function classList(initial = []) {
  const classes = new Set(initial);
  return {
    contains: (name) => classes.has(name),
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    toggle(name, force) {
      const add = force === undefined ? !classes.has(name) : force;
      if (add) classes.add(name);
      else classes.delete(name);
      return add;
    },
  };
}

function target(tag = 'body', { editable = false, ancestor } = {}) {
  return {
    isContentEditable: editable,
    matches: (selectors) => selectors.split(',').some((selector) => selector.trim() === tag),
    closest: (selectors) =>
      selectors.split(',').some((selector) => [tag, ancestor].includes(selector.trim()))
        ? {}
        : null,
  };
}

// Element double whose registered listeners can be replayed by the harness.
function captureElement(id) {
  const listeners = new Map();
  return {
    id,
    classList: classList(
      ['start', 'help', 'win', 'mix', 'savedata', 'economy'].includes(id) ? ['hidden'] : [],
    ),
    style: { opacity: 1 },
    dataset: {},
    open: false,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatch(type, event) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
}

function controls() {
  const dom = fakeDom();
  const win = fakeWindow();
  const calls = { auto: 0, advisor: 0, flagged: 0, center: 0, save: 0, ui: 0, zoom: [] };
  const node = (id) => dom.node(id);
  for (const id of ['start', 'help', 'win', 'mix', 'savedata', 'economy'])
    node(id).classList.add('hidden');
  node('paletteitems').classList.add('hidden');
  // Count advisor toggles through the button appearance they always update.
  let countAdvisor = false;
  let advClassName = '';
  const advb = {
    classList: classList([]),
    style: {},
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    focus() {},
  };
  Object.defineProperty(advb, 'className', {
    get: () => advClassName,
    set: (value) => {
      if (countAdvisor) calls.advisor++;
      advClassName = value;
    },
    enumerable: true,
    configurable: true,
  });
  dom.nodes.set('advb', advb);
  const floating = ['mix', 'savedata', 'economy'].map(node);
  dom.document.querySelectorAll = (selector) => {
    if (selector === '.floating:not(.hidden)')
      return floating.filter((panel) => !panel.classList.contains('hidden'));
    if (selector === '.floating') return floating;
    if (selector === '.pb' || selector === '#workspace-nav [data-workspace]') return [];
    assert.equal(selector, '[data-close]');
    return [];
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem(key, value) {
      if (key === 'settlers.prefs') calls.save++;
      storage.set(key, value);
    },
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
  installGlobals({ document: dom.document, window: win.window, localStorage });
  const { game } = createGame({
    modules: ['workspace', 'hud'],
    stubs: {
      view: captureElement('view'),
      mini: captureElement('mini'),
      gameEvents: { on: () => {} },
      state: { paused: false, speed: 1, auto: false },
      keys: { l: false, r: false, u: false, d: false },
      cam: { x: 500, y: 500 },
      z: 1,
      zi: 0,
      TS: 32,
      vw: 1280,
      vh: 720,
      muted: false,
      musicOn: true,
      mouse: { x: 0, y: 0 },
      ht: { x: 0, y: 0 },
      buildings: [{ type: 'hq', x: 8, y: 8 }],
      setMuted(value) {
        game.muted = value;
      },
      setMusicVol(value) {
        game.musicOn = value;
      },
      SND: {
        ui() {
          calls.ui++;
        },
      },
      msg(text) {
        if (/AUTO-PLAY|Auto-play off/.test(text)) calls.auto++;
        else if (/attention/.test(text)) calls.flagged++;
      },
      zoomAt(level) {
        calls.zoom.push(level);
      },
      clampCam() {},
      bStatus: () => ({ bad: false, lines: [] }),
      miniClick() {},
      screenToWorld: () => ({ x: 0, y: 0 }),
      inB: () => true,
      initAudio() {},
    },
  });
  // Observe camera jumps; action cancellation is checked through its resulting state.
  let zoomAnim = null;
  Object.defineProperty(game, 'zoomAnim', {
    get: () => zoomAnim,
    set: (value) => {
      calls.center++;
      zoomAnim = value;
    },
    enumerable: true,
    configurable: true,
  });
  // Count advisor toggles only after composition, once startup writes are done.
  countAdvisor = true;
  // Begin each scenario mid-drag, as the old context state did.
  game.view.dispatch('mousedown', {
    button: 2,
    clientX: 12,
    clientY: 34,
    preventDefault() {},
  });
  game.mini.dispatch('mousedown', { preventDefault() {} });
  function emit(name, key, options = {}) {
    const event = Object.assign(
      {
        key,
        target: target(),
        repeat: false,
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        stopImmediatePropagation() {},
        preventDefault() {
          this.defaultPrevented = true;
        },
      },
      options,
    );
    win.fire(name, event);
    return event;
  }
  return { game, calls, node, emit };
}

test('browser modifier shortcuts and consumed key events cannot change the colony or camera', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
    const { game, calls, node, emit } = controls();
    for (const key of ['p', 'f', 's', 'w', 'm', 'v', 'g', 'h', '8', '+'])
      emit('keydown', key, { [modifier]: true });
    game.keyPan(0.1);
    assert.equal(game.state.auto, false, modifier);
    assert.equal(game.state.speed, 1, modifier);
    assert.equal(game.state.paused, false, modifier);
    assert.equal(game.muted, false, modifier);
    assert.equal(game.cam.x, 500, modifier);
    assert.equal(game.cam.y, 500, modifier);
    assert.equal(node('help').classList.contains('hidden'), true, modifier);
    assert.equal(
      calls.auto + calls.advisor + calls.flagged + calls.center + calls.save,
      0,
      modifier,
    );
    assert.equal(calls.zoom.length, 0, modifier);
  }
});

test('movement keys pan while held and stop on keyup or window blur', () => {
  const { game, emit } = controls();
  emit('keydown', 'W');
  emit('keydown', 'W', { repeat: true });
  game.keyPan(0.1);
  assert.equal(game.cam.y, 430);
  emit('keyup', 'W', { target: target('input'), ctrlKey: true });
  game.keyPan(0.1);
  assert.equal(game.cam.y, 430, 'keyup from an input must still release a held movement key');
  emit('keydown', 'ArrowRight');
  game.keyPan(0.1);
  assert.equal(game.cam.x, 570);
  emit('blur');
  game.keyPan(0.1);
  assert.equal(game.cam.x, 570, 'losing focus must release all movement keys');
  assert.equal(game.pan, null);
  assert.equal(game.miniDown, false);
});

test('typing in editable controls does not start autoplay, change speed, mute, or pan', () => {
  for (const focused of [
    target('input'),
    target('textarea'),
    target('select'),
    target('div', { editable: true }),
  ]) {
    const { game, calls, emit } = controls();
    for (const key of ['p', 'w', 's', 'm', '8', ' ']) emit('keydown', key, { target: focused });
    game.keyPan(0.1);
    assert.equal(game.state.auto, false);
    assert.equal(game.state.speed, 1);
    assert.equal(game.state.paused, false);
    assert.equal(game.muted, false);
    assert.equal(game.cam.y, 500);
    assert.equal(calls.auto + calls.save, 0);
  }
});

test('Space preserves native button activation and pauses the game once outside controls', () => {
  const { game, emit } = controls();
  for (const focused of [
    target('button'),
    target('summary'),
    target('a'),
    target('span', { ancestor: 'button' }),
  ]) {
    const event = emit('keydown', ' ', { target: focused });
    assert.equal(game.state.paused, false);
    assert.equal(
      event.defaultPrevented,
      false,
      'the focused control must keep its native Space behavior',
    );
  }
  assert.equal(emit('keydown', ' ').defaultPrevented, true);
  assert.equal(game.state.paused, true);
  emit('keydown', ' ', { repeat: true });
  assert.equal(game.state.paused, true, 'holding Space must not repeatedly toggle pause');
  emit('keydown', ' ');
  assert.equal(game.state.paused, false);
});

test('ordinary gameplay shortcuts remain available and ignore repeated toggles', () => {
  const { game, calls, emit } = controls();
  emit('keydown', 'p');
  emit('keydown', 'p', { repeat: true });
  assert.equal(game.state.auto, true);
  assert.equal(calls.auto, 1);
  game.state.paused = true;
  emit('keydown', '8');
  assert.equal(game.state.speed, 8);
  assert.equal(game.state.paused, false);
  emit('keydown', 'f');
  emit('keydown', 'Home');
  emit('keydown', '+');
  assert.equal(calls.flagged, 1);
  assert.equal(calls.center, 1);
  assert.deepEqual(calls.zoom, [1]);
});

test('Escape dismisses one utility at a time before cancelling a map action', () => {
  const { game, node, emit } = controls();
  game.setMode('road');
  game.openLayer('mix');
  game.openLayer('savedata');
  game.openLayer('help');
  assert.equal(emit('keydown', 'Escape').defaultPrevented, true);
  assert.equal(node('help').classList.contains('hidden'), true);
  assert.equal(node('savedata').classList.contains('hidden'), false);
  assert.equal(game.mode.type, 'road');
  emit('keydown', 'Escape', { target: target('textarea') });
  assert.equal(node('savedata').classList.contains('hidden'), true);
  assert.equal(node('mix').classList.contains('hidden'), false);
  emit('keydown', 'Escape');
  assert.equal(node('mix').classList.contains('hidden'), true);
  assert.equal(game.mode.type, 'road');
  emit('keydown', 'Escape', { target: target('textarea') });
  assert.equal(game.mode.type, 'road', 'native fields keep Escape outside utility dialogs');
  emit('keydown', 'Escape');
  assert.equal(game.mode, null);
  emit('keydown', 'Escape', { repeat: true });
  game.setMode('road');
  emit('keydown', 'Escape', { repeat: true });
  assert.equal(game.mode.type, 'road', 'holding Escape must not cancel a new action');
});

test('mute appearance and saved preferences follow each toggle, including the keyboard shortcut', () => {
  const { game, calls, node, emit } = controls();
  game.toggleMute();
  assert.equal(game.muted, true);
  assert.equal(node('mute').style.opacity, '0.4');
  assert.equal(calls.save, 1);
  emit('keydown', 'm');
  assert.equal(game.muted, false);
  assert.equal(node('mute').style.opacity, '1');
  assert.equal(calls.save, 2);
  emit('keydown', 'm', { repeat: true });
  assert.equal(game.muted, false);
  assert.equal(calls.save, 2);
  game.toggleMusic();
  assert.equal(game.musicOn, false);
  assert.equal(node('musicb').classList.contains('off'), true);
  game.toggleMusic();
  assert.equal(game.musicOn, true);
  assert.equal(node('musicb').classList.contains('off'), false);
});
