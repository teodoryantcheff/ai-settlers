const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  DEFAULT_MODULES,
  fakeStorage,
  fakeDom,
  fakeWindow,
  installGlobals,
} = require('./helpers/game.cjs');

test('explicit startup initializes one colony and schedules a single frame loop', (t) => {
  const dom = fakeDom();
  const win = fakeWindow();
  const frames = [];
  let colonies = 0;
  let resizes = 0;
  dom.node('boot').remove = () => {};
  t.after(
    installGlobals({
      document: dom.document,
      window: win.window,
      ResizeObserver: class {
        observe() {}
      },
      requestAnimationFrame: (frame) => frames.push(frame),
    }),
  );
  const { game } = createGame({
    modules: ['loop'],
    stubs: {
      initializeColony() {
        colonies++;
        return { x: 48, y: 48 };
      },
      resize() {
        resizes++;
      },
      initSky() {},
      cam: { x: 0, y: 0 },
      TS: 32,
      vw: 1280,
      vh: 900,
      z: 1,
      clampCam() {},
      ART: {},
      loadPrefs() {},
      buildPalette() {},
      updateHint() {},
    },
  });
  assert.equal(colonies, 0);
  assert.equal(frames.length, 0);
  game.init();
  assert.equal(colonies, 1);
  assert.equal(frames.length, 1);
  const resizeCount = resizes;
  game.init();
  assert.equal(colonies, 1, 'repeated startup must retain the live colony');
  assert.equal(frames.length, 1, 'repeated startup cannot double simulation speed');
  assert.equal(resizes, resizeCount);
  assert.equal(win.listeners.get('resize').length, 1);
});

test('shared presentation keeps session, inspector and Reference on loaded and reset colonies', (t) => {
  const dom = fakeDom();
  dom.document.baseURI = 'http://localhost/';
  t.after(installGlobals({ document: dom.document, window: fakeWindow().window }));
  const { localStorage, storage } = fakeStorage();
  const { game } = createGame({
    seed: 2024,
    storage: localStorage,
    modules: [...DEFAULT_MODULES, 'workspace', 'reference', 'recovery', 'session'],
    stubs: {
      started: true,
      beginSession() {},
      keys: {},
      SND: { ui() {} },
      initAudio() {},
      hudTick() {},
      drawMini() {},
      draw() {},
    },
  });
  assert.equal(game.buildings.length, 0);
  game.initializeColony();
  game.beginSession();
  const armory = game.newBuilding('armory', 51, 48);
  Object.assign(armory, { done: true, legacyIndustry: true });
  game.buildings.push(armory);
  game.inspectContributor(armory.id);
  const beforeLoad = game.buildings;
  const saved = game.exportSave();
  game.importSave(saved);
  assert.notEqual(game.buildings, beforeLoad);
  assert.equal(game.selected, null, 'load clears an inspector pointing at replaced entities');
  assert.equal(game.inspectContributor(armory.id), true);
  assert.equal(game.selected, game.byId(armory.id));
  assert.notEqual(game.selected, armory);
  dom.node('welcome-reference').onclick();
  assert.equal(game.blockingLayerOpen(), true);
  assert.match(dom.node('reference-results').innerHTML, /1 retained legacy armories/);
  game.closeAllLayers();
  assert.equal(game.newColony('New valley', 42), true);
  assert.equal(game.colonyName, 'New valley');
  assert.equal(game.selected, null);
  assert.equal(game.buildings.length, 1);
  game.openWelcome();
  assert.match(dom.node('welcome-continuation').textContent, /New valley.*Seed 42/);
  game.openReference();
  assert.match(dom.node('reference-results').innerHTML, /0 retained legacy armories/);
  const checkpoints = [...storage];
  const live = game.exportSave();
  game.emitGameEvent('rendererFailed', { reason: 'WebGL context lost' });
  assert.equal(game.state.paused, true);
  assert.equal(dom.node('renderer-status').classList.contains('hidden'), false);
  const failed = JSON.parse(game.exportSave());
  const expected = JSON.parse(live);
  for (const key of ['b', 'u', 'j', 't', 'rng', 'observations', 'identity'])
    assert.deepEqual(failed[key], expected[key], 'graphics failure preserves exported ' + key);
  assert.equal(failed.st.time, expected.st.time);
  assert.equal(failed.st.paused, true);
  assert.deepEqual([...storage], checkpoints);
});

test('supported headless audio with browser doubles retains typed hooks and injected collaborators', (t) => {
  const dom = fakeDom();
  t.after(installGlobals({ document: dom.document, window: fakeWindow().window }));
  const messages = [];
  const { game, internals } = createGame({
    seed: 2024,
    headless: true,
    modules: [...DEFAULT_MODULES, 'audio'],
    stubs: { msg: (message) => messages.push(message) },
  });
  game.initializeColony();
  game.updateEconomicFeedback(0);
  assert.equal(game.AC, null, 'graph creation and feedback do not unlock WebAudio');
  assert.equal(typeof game.initAudio, 'function');
  assert.equal(typeof internals.audio.musicColony, 'function');
  assert.equal(game.musicColony, internals.audio.musicColony);
  assert.deepEqual(messages, []);
});

test('shared feedback delivers one message and one effect through retained collaborator overrides', (t) => {
  const dom = fakeDom();
  t.after(installGlobals({ document: dom.document, window: fakeWindow().window }));
  const messages = [];
  let sounds = 0;
  const msg = (message) => messages.push(message);
  const SND = { place: () => sounds++ };
  const { game } = createGame({ seed: 2024, stubs: { msg, SND } });
  game.initializeColony();
  assert.equal(game.msg, msg);
  assert.equal(game.SND, SND);
  const building = game.newBuilding('farm', 51, 48);
  game.emitGameEvent('buildingPlaced', { building });
  assert.deepEqual(messages, ['✓ Construction started: Grain Farm']);
  assert.equal(sounds, 1);
});
