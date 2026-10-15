'use strict';
const { createEventBus } = require('../../src/core/state.ts');
const { createGame, fakeElement, installGlobals } = require('./game.cjs');

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

function audioHarness({
  savedPrefs,
  initialState = 'running',
  deferTransitions = false,
  loadTone,
} = {}) {
  const nodes = [];
  const toneNodes = [];
  const notes = [];
  const contexts = [];
  const timeouts = new Map();
  let nextTimeout = 1;
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
      this.resumeCalls = this.suspendCalls = 0;
      this.destination = {};
      contexts.push(this);
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
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
      this.suspendCalls++;
      if (deferTransitions)
        return new Promise((resolve) =>
          transitions.push({ context: this, state: 'suspended', resolve }),
        );
      this.state = 'suspended';
      return Promise.resolve();
    }
    resume() {
      this.resumeCalls++;
      if (deferTransitions)
        return new Promise((resolve) =>
          transitions.push({ context: this, state: 'running', resolve }),
        );
      this.state = 'running';
      return Promise.resolve();
    }
  }

  class ToneTransport {
    constructor() {
      this.bpm = new MockAudioParam(120);
      this.timeSignature = 4;
      this.seconds = 0;
      this.state = 'stopped';
      this.events = new Map();
      this.nextEvent = 1;
    }
    scheduleRepeat(callback, interval, startTime = 0) {
      const id = this.nextEvent++;
      this.events.set(id, { callback, interval, startTime });
      return id;
    }
    clear(id) {
      this.events.delete(id);
      return this;
    }
    start(time = 0, offset = 0) {
      this.started = time;
      this.seconds = offset;
      this.state = 'started';
      return this;
    }
    stop(time = 0) {
      this.stopped = time;
      this.seconds = 0;
      this.state = 'stopped';
      return this;
    }
  }
  class ToneContext {
    constructor(options = {}) {
      this.rawContext = options.context ?? new MockAudioContext();
      this.destination = this.rawContext.destination;
      this.transport = new ToneTransport();
      this.lookAhead = 0.1;
    }
    get currentTime() {
      return this.rawContext.currentTime;
    }
    get sampleRate() {
      return this.rawContext.sampleRate;
    }
    get state() {
      return this.rawContext.state;
    }
    immediate() {
      return this.currentTime;
    }
    now() {
      return this.currentTime + 0.1;
    }
    resume() {
      return this.rawContext.resume();
    }
    close() {
      return this.rawContext.close();
    }
    dispose() {
      this.disposed = true;
    }
    setTimeout(callback) {
      const id = nextTimeout++;
      timeouts.set(id, callback);
      return id;
    }
    clearTimeout(id) {
      timeouts.delete(id);
    }
  }
  for (const name of [
    'createBuffer',
    'createBufferSource',
    'createGain',
    'createOscillator',
    'createStereoPanner',
    'createBiquadFilter',
  ])
    ToneContext.prototype[name] = function (...args) {
      return this.rawContext[name](...args);
    };
  class ToneNode {
    constructor(options, type = 'gain') {
      this.options = options;
      this.type = this.name = type;
      this.input =
        type === 'compressor'
          ? options.context.rawContext.createDynamicsCompressor()
          : new MockAudioNode(type, nodes);
      this.gain = this.input.gain;
      this.frequency = this.input.frequency;
      this.pan = this.input.pan;
      this.Q = this.input.Q;
      this.volume = new MockAudioParam(options.volume ?? 0);
      this.playbackRate = options.playbackRate ?? 1;
      this.gain.value = options.gain ?? 1;
      this.frequency.value = options.frequency ?? 440;
      this.Q.value = options.Q ?? 0;
      toneNodes.push(this);
    }
    connect(destination) {
      this.input.connect(destination.input ?? destination);
      return this;
    }
    start(time = 0) {
      this.started = time;
      this.input.start(time);
      return this;
    }
    stop(time = 0) {
      this.stopped = time;
      this.input.stop(time);
      return this;
    }
    dispose() {
      this.disposed = true;
      this.input.disconnect();
      return this;
    }
  }
  class ToneGain extends ToneNode {}
  class ToneCompressor extends ToneNode {
    constructor(options) {
      super(options, 'compressor');
    }
  }
  class ToneSynth extends ToneNode {
    constructor(options, instrument = 'Synth') {
      super(options, 'tone-synth');
      this.instrument = instrument;
    }
    triggerAttackRelease(frequency, duration, time, velocity) {
      notes.push({
        frequency,
        duration,
        time,
        velocity,
        type: this.options.oscillator?.type ?? 'sine',
        instrument: this.instrument,
        node: this,
      });
      this.input.started = time;
      this.input.stopped = time + duration + 0.1;
    }
  }
  class ToneNoiseSynth extends ToneNode {
    constructor(options) {
      super(options, 'tone-noise');
    }
    triggerAttackRelease(duration, time, velocity) {
      notes.push({ duration, time, velocity, type: 'noise', instrument: 'NoiseSynth', node: this });
      this.input.started = time;
      this.input.stopped = time + duration + 0.1;
    }
  }
  class ToneFilter extends ToneNode {
    constructor(options) {
      super(options, 'tone-filter');
    }
  }
  class TonePanner extends ToneNode {
    constructor(options) {
      super(options, 'tone-panner');
      this.pan.value = options.pan ?? 0;
    }
  }
  class ToneMonoSynth extends ToneSynth {
    constructor(options) {
      super(options, 'MonoSynth');
    }
  }
  class ToneFMSynth extends ToneSynth {
    constructor(options) {
      super(options, 'FMSynth');
    }
  }
  class ToneMembraneSynth extends ToneSynth {
    constructor(options) {
      super(options, 'MembraneSynth');
    }
  }
  class ToneNoise extends ToneNode {
    constructor(options) {
      super(options, 'tone-noise-source');
    }
  }
  class ToneLFO extends ToneNode {
    constructor(options) {
      super(options, 'tone-lfo');
      this.min = options.min;
      this.max = options.max;
    }
  }
  const tone = {
    Context: ToneContext,
    setContext() {},
    Gain: ToneGain,
    Compressor: ToneCompressor,
    Synth: ToneSynth,
    NoiseSynth: ToneNoiseSynth,
    Filter: ToneFilter,
    Panner: TonePanner,
    MonoSynth: ToneMonoSynth,
    FMSynth: ToneFMSynth,
    MembraneSynth: ToneMembraneSynth,
    Noise: ToneNoise,
    LFO: ToneLFO,
  };
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
    modules: ['economicNotices', 'audio', 'hud'],
    internals: { audio: { loadTone: () => (loadTone ? loadTone(tone) : Promise.resolve(tone)) } },
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
  async function flushTransitions() {
    for (let pass = 0; pass < 20; pass++) {
      await Promise.resolve();
      while (transitions.length) {
        const transition = transitions.shift();
        transition.context.state = transition.state;
        transition.resolve();
      }
    }
  }
  function flushReleases() {
    for (const callback of [...timeouts.values()]) callback();
    timeouts.clear();
  }
  return {
    audio,
    nodes,
    toneNodes,
    notes,
    contexts,
    timeouts,
    tone,
    intervals,
    storage,
    document,
    window,
    flushTransitions,
    flushReleases,
  };
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

module.exports = {
  audioHarness,
  workers,
  connectedNodes,
  finishSources,
  feedbackProducer,
  feedbackFrame,
};
