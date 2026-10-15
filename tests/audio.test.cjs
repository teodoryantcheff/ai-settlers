'use strict';
const { createEventBus } = require('../src/core/state.ts');
const { createGame, fakeElement, installGlobals } = require('./helpers/game.cjs');

const test = require('node:test');
const assert = require('node:assert/strict');

class MockAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  record(kind, value, time) {
    assert.ok(Number.isFinite(value), 'automation value must be finite');
    assert.ok(Number.isFinite(time), 'automation time must be finite');
    this.value = value;
    this.events.push({ kind, value, time });
  }

  setValueAtTime(value, time) {
    this.record('set', value, time);
  }
  linearRampToValueAtTime(value, time) {
    this.record('linear', value, time);
  }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0, 'exponential ramps require a positive target');
    this.record('exponential', value, time);
  }
  setTargetAtTime(value, time, constant) {
    assert.ok(constant > 0);
    this.record('target', value, time);
  }
  cancelScheduledValues(time) {
    this.events = this.events.filter((event) => event.time < time);
  }
  cancelAndHoldAtTime(time) {
    this.cancelScheduledValues(time);
  }
}

class MockAudioNode {
  constructor(type, nodes) {
    this.type = type;
    this.gain = new MockAudioParam(1);
    this.frequency = new MockAudioParam(440);
    this.pan = new MockAudioParam();
    this.Q = new MockAudioParam();
    this.playbackRate = new MockAudioParam(1);
    this.listeners = [];
    this.connections = [];
    nodes.push(this);
  }

  connect(node) {
    this.connections.push(node);
  }
  disconnect() {
    this.connections = [];
  }
  start(time = 0) {
    this.started = time;
  }
  stop(time) {
    this.stopped = time;
  }
  addEventListener(event, callback) {
    assert.equal(event, 'ended');
    this.listeners.push(callback);
  }
  finish() {
    if (this.onended) this.onended();
    for (const callback of this.listeners) callback();
  }
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    dispatch(name) {
      for (const listener of listeners.get(name) || []) listener();
    },
  };
}

function audioHarness({ savedPrefs, initialState = 'running', deferTransitions = false } = {}) {
  const nodes = [];
  const intervals = new Map();
  const storage = new Map();
  const elements = new Map();
  const transitions = [];
  let nextInterval = 1;
  if (savedPrefs) storage.set('settlers.prefs', JSON.stringify(savedPrefs));

  class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 100;
      this.state = initialState;
      this.destination = {};
    }
    createDynamicsCompressor() {
      const node = new MockAudioNode('compressor', nodes);
      for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release'])
        node[key] = new MockAudioParam();
      return node;
    }
    createGain() {
      return new MockAudioNode('gain', nodes);
    }
    createOscillator() {
      return new MockAudioNode('oscillator', nodes);
    }
    createBufferSource() {
      return new MockAudioNode('buffer', nodes);
    }
    createBiquadFilter() {
      return new MockAudioNode('filter', nodes);
    }
    createStereoPanner() {
      return new MockAudioNode('panner', nodes);
    }
    createBuffer(channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    }
    suspend() {
      if (deferTransitions)
        return new Promise((resolve) =>
          transitions.push({ context: this, state: 'suspended', resolve }),
        );
      this.state = 'suspended';
      return Promise.resolve();
    }
    resume() {
      if (deferTransitions)
        return new Promise((resolve) =>
          transitions.push({ context: this, state: 'running', resolve }),
        );
      this.state = 'running';
      return Promise.resolve();
    }
  }

  const document = Object.assign(eventTarget(), {
    visibilityState: 'visible',
    activeElement: null,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    },
    createElement: () => fakeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const window = Object.assign(eventTarget(), {
    AudioContext: MockAudioContext,
    matchMedia: () => ({ matches: false }),
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 900,
  });
  installGlobals({
    document,
    window,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setInterval(callback) {
      const id = nextInterval++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  const { game: audio } = createGame({
    modules: ['audio', 'hud'],
    stubs: {
      view: fakeElement('view'),
      mini: fakeElement('mini'),
      gameEvents: createEventBus(),
      cam: { x: 0, y: 0 },
      vw: 800,
      vh: 600,
      z: 1,
      TS: 32,
      W: 24,
      H: 24,
      WATER: 1,
      idx: (x, y) => y * 24 + x,
      tiles: Array.from({ length: 576 }, () => ({ t: 0 })),
      buildings: [],
      BSPEC: {
        lumberjack: { name: 'Woodcutter', prod: 'gather', out: 'logs' },
        sawmill: { name: 'Sawmill', prod: 'craft', out: 'planks', in: { logs: 1, tools: 1 } },
        hq: { name: 'Headquarters', prod: 'none', store: true },
      },
      GOODS: { logs: { name: 'Logs' }, planks: { name: 'Planks' }, tools: { name: 'Tools' } },
      state: { gold: 0, speed: 1, time: 0, paused: false, won: false },
      msgs: [],
      feedbackNow: 0,
      msg: (text) => {
        audio.msgs.push({ t: text, at: audio.feedbackNow });
        if (audio.msgs.length > 8) audio.msgs.shift();
      },
      GOAL: 200,
      seed: 2024,
      presentationPrefs: { reducedMotion: false, weather: true, quality: 1, overlay: 'none' },
      nightAmt: () => 0,
      rainAmt: () => 0,
      mulberry32(seed) {
        return () => {
          seed |= 0;
          seed = (seed + 0x6d2b79f5) | 0;
          let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
      },
    },
  });
  function flushTransitions() {
    while (transitions.length) {
      const transition = transitions.shift();
      transition.context.state = transition.state;
      transition.resolve();
    }
  }
  return { audio, nodes, intervals, storage, document, window, flushTransitions };
}

function workers(count) {
  return Array.from({ length: count }, () => ({ type: 'lumberjack', done: true, timer: 7 }));
}

function connectedNodes(nodes) {
  return nodes.filter((node) => node.connections.length > 0);
}

function finishSources(nodes) {
  const finite = nodes.filter((node) => node.stopped !== undefined);
  finite.sort((a, b) => a.stopped - b.stopped).forEach((node) => node.finish());
  return finite;
}

test('the full score has three longer themes and reserves each quiet phrase for ambience', () => {
  const { audio, nodes } = audioHarness();
  audio.initAudio();
  audio.buildings = workers(14);
  const names = new Set();
  let quietBars = 0;
  for (let bar = 0; bar < 144; bar++) {
    names.add(audio.themeAt(bar).name);
    const before = nodes.length;
    audio.scheduleBar(bar, 100 + bar * audio.BAR);
    if (bar % 48 >= 32 && bar % 48 < 40) {
      assert.equal(nodes.length, before, `quiet bar ${bar} must allocate no musical voices`);
      quietBars++;
    } else {
      assert.ok(nodes.length > before, `musical bar ${bar} must schedule notes`);
    }
  }
  assert.equal(names.size, 3);
  assert.equal(quietBars, 24);
  assert.equal(audio.BAR * 48, 90, 'each theme lasts 90 seconds');
});

test('musical layers follow working completed producers and change smoothly at phrase boundaries', () => {
  const { audio } = audioHarness();
  audio.initAudio();
  audio.buildings = [
    ...workers(1),
    { type: 'lumberjack', done: false },
    { type: 'hq', done: true },
    { type: 'lumberjack', done: true, disabled: true },
    { type: 'lumberjack', done: true, blockedReason: 'output' },
    { type: 'lumberjack', done: true, exhausted: true },
  ];
  assert.equal(audio.musicColony().active, 1);
  audio.scheduleBar(0, 1);
  const flute = audio.musicArrangement.flute;
  audio.buildings.push(...workers(12));
  audio.scheduleBar(1, 3);
  assert.equal(audio.musicArrangement.flute, flute, 'a change mid-phrase must wait');
  audio.scheduleBar(8, 15);
  assert.ok(audio.musicArrangement.flute > flute);
  assert.ok(audio.musicArrangement.flute < 1, 'a new layer approaches full volume gradually');
});

test('a missing recipe input counts as starvation even when another input is available', () => {
  const { audio } = audioHarness();
  audio.buildings = [{ type: 'sawmill', done: true, stock: { logs: 2, tools: 0 }, timer: 0 }];
  assert.equal(audio.starvingCount(), 1);
  assert.equal(audio.musicColony().active, 0);
  audio.buildings[0].stock.tools = 1;
  assert.equal(audio.starvingCount(), 0);
  assert.equal(audio.musicColony().active, 1);
});

test('real production events trigger audio and repeated audio initialization subscribes once', () => {
  const { audio } = audioHarness();
  audio.initAudio();
  audio.initAudio();
  const calls = [];
  audio.SND.chop = (x, y) => calls.push({ x, y });
  audio.gameEvents.emit('goodsProduced', { building: { type: 'lumberjack', x: 2, y: 3 } });
  assert.deepEqual(calls, [{ x: 2, y: 3 }]);
  audio.gameEvents.emit('goodsDelivered', { building: { type: 'lumberjack', x: 2, y: 3 } });
  audio.gameEvents.emit('goodsProduced', {});
  assert.equal(calls.length, 1, 'unrelated and empty events must not play work sounds');
});

test('saved ambience volume is restored before initialization and remains independent of music and effects', () => {
  const { audio, storage } = audioHarness({
    savedPrefs: { ambVol: 0.33, musVol: 0.2, sfxVol: 0.8 },
  });
  audio.loadPrefs();
  assert.equal(audio.ambVol, 0.33);
  audio.initAudio();
  assert.equal(audio.gAmb.gain.value, 0.33);
  audio.setAmbVol(0.64);
  assert.equal(audio.gAmb.gain.value, 0.64);
  assert.equal(audio.gMusic.gain.value, 0.2);
  assert.equal(audio.gSfx.gain.value, 0.8);
  audio.savePrefs();
  const saved = JSON.parse(storage.get('settlers.prefs'));
  assert.equal(saved.ambVol, 0.64);
  const restored = audioHarness({ savedPrefs: saved }).audio;
  restored.loadPrefs();
  restored.initAudio();
  assert.equal(restored.gAmb.gain.value, 0.64);
});

test('silent saved ambience suppresses wildlife voices and invalid saved values use the default', () => {
  const { audio, nodes } = audioHarness({ savedPrefs: { ambVol: 0 } });
  audio.loadPrefs();
  audio.initAudio();
  const before = nodes.length;
  audio.birdChirp();
  audio.cricketChirp();
  audio.owlHoot();
  assert.equal(nodes.length, before);
  assert.equal(audio.gAmb.gain.value, 0);
  for (const ambVol of [-1, 2, '0.4', null]) {
    const restored = audioHarness({ savedPrefs: { ambVol } }).audio;
    restored.loadPrefs();
    assert.equal(restored.ambVol, 0.5);
  }
});

test('industrial work audio caps overlap, throttles bursts, and releases expired reservations', () => {
  const { audio, nodes } = audioHarness();
  audio.initAudio();
  let accepted = 0;
  for (let i = 0; i < 10; i++) {
    audio.AC.currentTime = i * 0.071;
    const before = nodes.length;
    audio.SND.forge(i, 0);
    if (nodes.length > before) accepted++;
    assert.ok(audio.industrialVoices.length <= 6);
  }
  assert.equal(accepted, 6, 'a burst may start at most six overlapping work sounds');
  audio.AC.currentTime = 3;
  const before = nodes.length;
  audio.SND.forge(0, 0);
  assert.ok(nodes.length > before, 'expired voices allow a new production cue');
  assert.equal(audio.industrialVoices.length, 1);
  const sameMoment = nodes.length;
  audio.SND.saw(1, 0);
  audio.SND.forge(0, 0);
  audio.SND.forge(100, 100);
  assert.equal(nodes.length, sameMoment, 'burst, same-building and distant work must stay quiet');
});

test('all finite synth voices disconnect their filters, gains and panners after playing', () => {
  const { audio, nodes } = audioHarness();
  audio.initAudio();
  const persistent = new Set(connectedNodes(nodes));
  audio.buildings = workers(14);
  audio.state.gold = 160;
  for (let bar = 0; bar < 144; bar++) audio.scheduleBar(bar, 100 + bar * audio.BAR);
  for (const name of Object.keys(audio.SND)) {
    audio.AC.currentTime += 2;
    audio.SND[name](2, 2);
  }
  audio.birdChirp();
  audio.cricketChirp();
  audio.owlHoot();
  const finite = finishSources(nodes);
  assert.ok(finite.length > 200, 'exercise a complete score and the sound palette');
  assert.ok(finite.every((node) => node.connections.length === 0));
  const remaining = connectedNodes(nodes);
  assert.equal(remaining.length, persistent.size);
  assert.ok(
    remaining.every((node) => persistent.has(node)),
    'only original buses and persistent ambience remain',
  );
});

test('hidden pages suspend audio, allocate no new cues, and resume on return', () => {
  const { audio, document, window, nodes } = audioHarness();
  audio.initAudio();
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  assert.equal(audio.AC.state, 'suspended');
  assert.equal(audio.audioCanPlay(), false);
  const before = nodes.length;
  audio.SND.ui();
  audio.gameEvents.emit('goodsProduced', { building: { type: 'lumberjack', x: 2, y: 2 } });
  assert.equal(nodes.length, before);
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  assert.equal(audio.AC.state, 'running');
  window.dispatch('pagehide');
  assert.equal(audio.AC.state, 'suspended');
  window.dispatch('pageshow');
  assert.equal(audio.AC.state, 'running');
});

test('fanfare keeps disabled music silent and volume changes cancel obsolete gain automation', () => {
  const { audio } = audioHarness();
  audio.initAudio();
  audio.setMusicVol(false);
  audio.SND.fanfare();
  const ramps = audio.gMusic.gain.events.filter((event) => event.kind === 'linear');
  assert.ok(ramps.length > 0);
  assert.ok(ramps.every((event) => event.value === 0));
  audio.setMusicVol(true);
  audio.SND.fanfare();
  audio.setMusVol(0.25);
  assert.equal(audio.gMusic.gain.value, 0.25);
  assert.ok(audio.gMusic.gain.events.every((event) => event.time <= audio.AC.currentTime));
});

test('an overdue music scheduler resumes at a phrase without playing a catch-up burst', () => {
  const { audio, nodes, intervals } = audioHarness();
  audio.initAudio();
  audio.buildings = workers(14);
  audio.AC.currentTime = 1000;
  audio.musicNext = 1;
  audio.musicBar = 9;
  const before = nodes.length;
  intervals.get(audio.musicTimer)();
  assert.equal(audio.musicBar, 17, 'resume with one bar at the next eight-bar phrase');
  const sources = nodes.slice(before).filter((node) => node.started !== undefined);
  assert.ok(sources.length > 0);
  assert.ok(sources.every((node) => node.started >= 1000));
  assert.ok(sources.every((node) => node.started < 1000 + audio.BAR));
});

test('zero effects volume suppresses all sound effects and does not duck the music', () => {
  const { audio, nodes } = audioHarness();
  audio.initAudio();
  audio.setSfxVol(0);
  const before = nodes.length;
  const musicAutomation = JSON.stringify(audio.gMusic.gain.events);
  for (const method of Object.keys(audio.SND)) audio.SND[method](2, 2);
  audio.gameEvents.emit('goodsProduced', { building: { type: 'lumberjack', x: 2, y: 2 } });
  assert.equal(nodes.length, before, 'muted effects must allocate no sound graphs');
  assert.equal(
    JSON.stringify(audio.gMusic.gain.events),
    musicAutomation,
    'an inaudible fanfare must leave music alone',
  );
});

test('a rapid hidden-visible transition resumes after an asynchronous pending suspension', () => {
  const { audio, document, flushTransitions } = audioHarness({ deferTransitions: true });
  audio.initAudio();
  flushTransitions();
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  assert.equal(audio.AC.state, 'running', 'browser context state changes after suspend resolves');
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  flushTransitions();
  assert.equal(
    audio.AC.state,
    'running',
    'the most recent visible state must win over a pending suspend',
  );
});

test('initializing audio from a gesture resumes a context that starts suspended', () => {
  const { audio } = audioHarness({ initialState: 'suspended' });
  audio.initAudio();
  assert.equal(audio.AC.state, 'running');
});

test('unmuting and enabling music retry playback after a browser interruption', () => {
  const { audio } = audioHarness();
  audio.initAudio();
  audio.setMuted(true);
  audio.AC.state = 'suspended';
  audio.setMuted(false);
  assert.equal(audio.AC.state, 'running', 'unmute is a new opportunity to unlock audio');
  audio.setMusicVol(false);
  audio.AC.state = 'suspended';
  audio.setMusicVol(true);
  assert.equal(audio.AC.state, 'running', 'enabling music is a new opportunity to unlock audio');
});

test('pagehide wins over a pending pageshow resume request', () => {
  const { audio, window, flushTransitions } = audioHarness({ deferTransitions: true });
  audio.initAudio();
  flushTransitions();
  audio.AC.state = 'suspended';
  window.dispatch('pageshow');
  assert.equal(
    audio.AC.state,
    'suspended',
    'resume is pending until the audio thread processes it',
  );
  window.dispatch('pagehide');
  flushTransitions();
  assert.equal(audio.AC.state, 'suspended', 'leaving the page must override a pending resume');
});

test('a victory cue preserves exact silence for a disabled or zero-volume music bus', () => {
  for (const mode of ['disabled', 'volume']) {
    const { audio } = audioHarness();
    audio.initAudio();
    if (mode === 'disabled') audio.setMusicVol(false);
    else audio.setMusVol(0);
    audio.SND.fanfare();
    assert.ok(
      audio.gMusic.gain.events.every((event) => event.value === 0),
      mode,
    );
  }
});

test('the first gold milestone plays its coin cue once through the event bus', () => {
  const { audio, nodes } = audioHarness();
  audio.initAudio();
  audio.initAudio();
  const coins = [];
  const coin = audio.SND.coin;
  audio.SND.coin = (x, y) => {
    coins.push({ x, y });
    coin(x, y);
  };
  const before = nodes.length;
  audio.gameEvents.emit('firstGold', { building: { type: 'hq', x: 2, y: 3 } });
  assert.deepEqual(coins, [{ x: 2, y: 3 }]);
  assert.ok(nodes.length > before, 'the first delivery must create the milestone sound');
  audio.gameEvents.emit('firstGold', {});
  assert.equal(coins.length, 1, 'an event without a storage location must not create a cue');
});

function feedbackProducer() {
  return {
    id: 1,
    type: 'sawmill',
    x: 2,
    y: 3,
    done: true,
    produced: 0,
    stock: { logs: 2, tools: 2 },
    blockedReason: '',
  };
}

function feedbackFrame(audio, now) {
  audio.feedbackNow = now;
  audio.state.time = now / 1000;
  return audio.updateEconomicFeedback(now);
}

test('economic notices remain visible before audio unlock, when muted, and at zero effects volume', () => {
  const messages = [];
  for (const mode of ['locked', 'muted', 'zero', 'audible']) {
    const { audio, nodes } = audioHarness();
    const b = feedbackProducer();
    audio.buildings.push(b);
    if (mode !== 'locked') audio.initAudio();
    if (mode === 'muted') audio.setMuted(true);
    if (mode === 'zero') audio.setSfxVol(0);
    feedbackFrame(audio, 0);
    const before = nodes.length;
    b.produced = 1;
    const notice = feedbackFrame(audio, 250);
    assert.equal(notice.kind, 'started', mode);
    assert.equal(audio.msgs.length, 1, mode);
    assert.equal(audio.msgs[0].t, notice.message);
    messages.push(notice.message);
    if (mode === 'audible') assert.ok(nodes.length > before);
    else assert.equal(nodes.length, before, mode + ' must allocate no cue voices');
    audio.initAudio();
    audio.setMuted(false);
    audio.setSfxVol(1);
    b.produced++;
    feedbackFrame(audio, 30_000);
    assert.equal(audio.msgs.length, 1, 'unlocking/unmuting never replays an old transition');
  }
  assert.ok(messages.every((message) => message === messages[0]));
});

test('muting preserves paired visual information for starts, sustained blockage and actual recovery', () => {
  const outputs = [];
  for (const muted of [false, true]) {
    const { audio, nodes } = audioHarness();
    audio.initAudio();
    audio.setMuted(muted);
    const b = feedbackProducer();
    audio.buildings.push(b);
    feedbackFrame(audio, 0);
    const before = nodes.length;
    for (let now = 250; now <= 41_000; now += 250) {
      if (now === 250) b.produced = 1;
      if (now === 500) {
        b.stock.logs = 0;
        b.blockedReason = 'inputs';
      }
      if (now === 21_000) {
        b.produced = 2;
        b.blockedReason = '';
      }
      feedbackFrame(audio, now);
    }
    outputs.push(audio.msgs.map((message) => message.t));
    assert.equal(audio.msgs.length, 3);
    assert.match(audio.msgs[0].t, /first planks produced/);
    assert.match(audio.msgs[1].t, /blocked — needs logs/);
    assert.match(audio.msgs[2].t, /production resumed/);
    if (muted) assert.equal(nodes.length, before, 'silent feedback allocates no audio voices');
    else assert.ok(nodes.length > before);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test('economic feedback waits for visible-feed space instead of evicting active alerts', () => {
  const { audio } = audioHarness();
  const b = feedbackProducer();
  audio.buildings.push(b);
  feedbackFrame(audio, 0);
  for (let i = 0; i < 8; i++) audio.msgs.push({ t: 'Alert ' + i, at: 0 });
  b.produced = 1;
  assert.equal(feedbackFrame(audio, 250), null);
  assert.equal(audio.msgs.length, 8);
  assert.equal(feedbackFrame(audio, 6750), null);
  assert.equal(feedbackFrame(audio, 7000).kind, 'started');
  assert.match(audio.msgs.at(-1).t, /first planks produced/);
  assert.equal(audio.msgs.length, 8, 'the shared message feed stays bounded');
});

test('a fresh error takes priority over an economic transition, without discarding the transition', () => {
  const { audio } = audioHarness();
  const b = feedbackProducer();
  audio.buildings.push(b);
  feedbackFrame(audio, 0);
  audio.msgs.push({ t: 'Save failed: storage unavailable', at: 0 });
  b.produced = 1;
  assert.equal(feedbackFrame(audio, 1000), null);
  assert.equal(feedbackFrame(audio, 3250), null);
  assert.equal(feedbackFrame(audio, 3500).kind, 'started');
  assert.equal(audio.msgs[0].t, 'Save failed: storage unavailable');
});

test('economic cues have distinct contours and release every finite voice', () => {
  const { audio, nodes } = audioHarness();
  audio.initAudio();
  const persistent = new Set(connectedNodes(nodes));
  const signatures = [];
  for (const name of ['chainStart', 'chainBlocked', 'chainRecovered']) {
    const before = nodes.length;
    audio.SND[name](2, 3);
    const voices = nodes
      .slice(before)
      .filter((node) => node.type === 'triangle' || node.type === 'sine');
    signatures.push(voices.map((node) => node.frequency.value).join(','));
    finishSources(nodes.slice(before));
    assert.ok(
      connectedNodes(nodes).every((node) => persistent.has(node)),
      name,
    );
  }
  assert.equal(new Set(signatures).size, 3);
});
