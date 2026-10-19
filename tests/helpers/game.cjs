// Real-module harness: production registries own factories and construction order.
// Tests supply collaborator doubles and typed closure hooks without rewriting source.
const { attachSubsystem } = require('../../src/runtime.ts');
const { DOMAIN_SUBSYSTEMS } = require('../../src/simulation/assembly.ts');
const {
  PRESENTATION_SUBSYSTEMS,
  connectPresentation,
} = require('../../src/application/assembly.ts');

const SUBSYSTEMS = [...DOMAIN_SUBSYSTEMS, ...PRESENTATION_SUBSYSTEMS];
const MODULES = Object.fromEntries(SUBSYSTEMS.map(({ name, create }) => [name, create]));

const DEFAULT_MODULES = DOMAIN_SUBSYSTEMS.map(({ name }) => name);

/**
 * Compose subsystems into one runtime. Stubs are installed before composition —
 * factory constructors read collaborators such as input surfaces as they are
 * created — and keep their value where a subsystem would provide the same key.
 * The returned `game` carries the public runtime surface plus, merged after
 * composition, the test-only internals of every requested module (collisions
 * throw). `internals` exposes the same hooks grouped per module.
 */
function createGame(options = {}) {
  const requested = options.modules ?? DEFAULT_MODULES;
  for (const name of requested)
    if (!Object.hasOwn(MODULES, name)) throw new Error(`Unknown test module: ${name}`);
  const names = new Set(requested);
  names.add('events');
  if (names.has('economy'))
    for (const name of [
      'observations',
      'ledger',
      'transport',
      'attention',
      'progression',
      'advisor',
      'roads',
      'autoplay',
      'startup',
      'persistence',
      'interaction',
      'messages',
    ])
      names.add(name);
  if (names.has('state') || names.has('hud') || names.has('renderer')) names.add('interaction');
  if (names.has('hud')) for (const name of ['advisor', 'roads', 'progressionView']) names.add(name);
  const order = SUBSYSTEMS.map(({ name }) => name);
  // Domain requests select these browser adapters for ordinary tests. Headless
  // tests omit only those automatic additions; an explicit request is a setup error.
  if (options.headless)
    for (const name of ['interaction', 'messages']) {
      if (requested.includes(name))
        throw new Error(`Test module ${name} cannot be requested in headless mode`);
      names.delete(name);
    }
  const modules = order.filter((name) => names.has(name));
  for (const name of names)
    if (!modules.includes(name)) throw new Error(`Test module ${name} is missing from assembly`);
  const stubs = options.stubs ?? {};
  const game = {};
  const internals = {};
  const factoryOptions = {
    ...options,
    presentation: options.presentation ?? recordingPresentation(),
    storage: names.has('persistence')
      ? (options.storage ?? globalThis.localStorage)
      : options.storage,
  };
  for (const [key, value] of Object.entries(stubs)) defineStub(game, key, value);
  for (const name of modules) {
    const factory = MODULES[name];
    if (!factory) throw new Error(`Unknown test module: ${name}`);
    const hooks = { ...(options.internals?.[name] ?? {}) };
    const subsystem = factory(game, factoryOptions, hooks);
    for (const key of Object.keys(subsystem)) if (key in stubs) delete game[key];
    attachSubsystem(game, subsystem);
    for (const key of Object.keys(subsystem)) if (key in stubs) defineStub(game, key, stubs[key]);
    for (const key of Object.keys(hooks)) {
      if (key in game) throw new Error(`Duplicate test hook: ${key}`);
    }
    Object.defineProperties(game, Object.getOwnPropertyDescriptors(hooks));
    if (Object.keys(hooks).length) internals[name] = hooks;
  }
  connectPresentation(game, names);
  return { game, internals };
}

function defineStub(game, key, value) {
  Object.defineProperty(game, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Install browser globals for the duration of a test. Returns a restore
 * function; call it in `t.after` or at the end of the test.
 */
function installGlobals(globals) {
  const saved = new Map();
  for (const [name, value] of Object.entries(globals)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

/**
 * Pin `performance.now` to a controllable clock so wall-clock behavior in the
 * simulation is deterministic. Returns advance controls and a restore function.
 */
function pinClock(initial = 0) {
  let time = initial;
  const original = performance.now;
  performance.now = () => time;
  return {
    now: () => time,
    set(next) {
      time = next;
    },
    tick(ms) {
      time += ms;
    },
    restore() {
      performance.now = original;
    },
  };
}

/** Minimal element double used by HUD and canvas code. */
function fakeElement(id = '') {
  const classes = new Set();
  const listeners = new Map();
  const node = {
    id,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const active = force === undefined ? !classes.has(name) : force;
        if (active) classes.add(name);
        else classes.delete(name);
        return active;
      },
    },
    style: {},
    dataset: {},
    children: [],
    innerHTML: '',
    textContent: '',
    value: '',
    open: false,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    get firstChild() {
      return node.children[0] || null;
    },
    insertBefore(child, before) {
      const index = node.children.indexOf(before);
      node.children.splice(index < 0 ? node.children.length : index, 0, child);
      child.parentNode = node;
      return child;
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((entry) => entry !== child);
      return child;
    },
    contains: () => false,
    scrollTop: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {},
    matches: () => false,
    closest: () => null,
  };
  Object.defineProperty(node, 'className', {
    get: () => [...classes].join(' '),
    set: (value) => {
      classes.clear();
      for (const name of value.split(/\s+/).filter(Boolean)) classes.add(name);
    },
  });
  return node;
}

/**
 * Document double backed by a node map. Tests read `nodes` to reach elements
 * the code under test looked up by id.
 */
function fakeDom() {
  const nodes = new Map();
  const document = {
    visibilityState: 'visible',
    activeElement: null,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, fakeElement(id));
      return nodes.get(id);
    },
    createElement: () => fakeElement(),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return { document, nodes, node: (id) => document.getElementById(id) };
}

/** Window double capturing registered listeners so tests can dispatch them. */
function fakeWindow(overrides = {}) {
  const listeners = new Map();
  const window = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 900,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    removeEventListener(type, callback) {
      const kept = (listeners.get(type) || []).filter((entry) => entry !== callback);
      listeners.set(type, kept);
    },
    ...overrides,
  };
  return {
    window,
    listeners,
    fire(type, event = {}) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
}

/** Presentation double capturing layer registrations for painter tests. */
function recordingPresentation() {
  const layers = [];
  return {
    available: true,
    layers,
    invalidate() {},
    release() {},
    begin() {},
    layer(name, paint) {
      layers.push({ name, paint });
    },
    end() {},
  };
}

/**
 * Scene layer double. Every Pixi Graphics call on `g` (chainable) and every
 * image, text, blit, shadow and clip lands in `calls` as `{ method, args }`;
 * images and text also keep their `alpha`/`style`.
 */
function recordingScene(calls = []) {
  const g = new Proxy(
    {},
    {
      get:
        (_, method) =>
        (...args) => {
          calls.push({ method, args });
          return g;
        },
    },
  );
  return {
    calls,
    g,
    texture: (source, frame) => ({ source, frame }),
    group(_key, paint) {
      paint(this);
    },
    retain(owner, paint) {
      calls.push({ method: 'retain', args: [owner, Boolean(paint)] });
      if (paint) paint(this);
    },
    image(source, x, y, width, height, alpha = 1, frame) {
      calls.push({ method: 'image', args: [source, x, y, width, height], alpha, frame });
    },
    blit(...args) {
      calls.push({ method: 'blit', args });
    },
    shadows(...args) {
      calls.push({ method: 'shadows', args });
    },
    text(value, x, y, style) {
      calls.push({ method: 'text', args: [value, x, y], style });
    },
    measureText: (value) => value.length * 5,
    clip(rect) {
      calls.push({ method: 'clip', args: [rect] });
    },
  };
}

/** Map-backed localStorage double. */
function fakeStorage() {
  const storage = new Map();
  return {
    storage,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    },
  };
}

module.exports = {
  createGame,
  installGlobals,
  pinClock,
  fakeElement,
  fakeDom,
  fakeWindow,
  fakeStorage,
  recordingPresentation,
  recordingScene,
  DEFAULT_MODULES,
};
