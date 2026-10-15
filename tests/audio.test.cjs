'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audioHarness, workers, feedbackProducer, feedbackFrame } = require('./helpers/audio.cjs');
test('the real graph and pinned Tone class entrypoint import without browser audio', async () => {
  const classes = await import('tone/build/esm/classes.js');
  assert.equal(typeof classes.Synth, 'function');
  const { createGame } = require('./helpers/game.cjs');
  const { game } = createGame({ modules: ['audio'] });
  assert.equal(game.AC, null);
  await assert.doesNotReject(() => game.initAudio());
  assert.equal(game.AC, null);
  assert.equal(game.audioPhase, 'failed');
  assert.equal(Object.hasOwn(game, 'loadTone'), false);
});

test('hidden pages suspend audio, allocate no new cues, and resume on return', async () => {
  const { audio, document, window, nodes } = audioHarness();
  await audio.initAudio();
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
  await audio.initAudio();
  assert.equal(audio.AC.state, 'running');
  window.dispatch('pagehide');
  assert.equal(audio.AC.state, 'suspended');
  window.dispatch('pageshow');
  await audio.initAudio();
  assert.equal(audio.AC.state, 'running');
});

test('fanfare keeps disabled music silent and volume changes cancel obsolete gain automation', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
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

test('zero effects volume suppresses all sound effects and does not duck the music', async () => {
  const { audio, nodes } = audioHarness();
  await audio.initAudio();
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

test('a rapid hidden-visible transition resumes after an asynchronous pending suspension', async () => {
  const { audio, document, flushTransitions } = audioHarness({ deferTransitions: true });
  const started = audio.initAudio();
  await flushTransitions();
  await started;
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  assert.equal(audio.AC.state, 'running', 'browser context state changes after suspend resolves');
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  await flushTransitions();
  assert.equal(
    audio.AC.state,
    'running',
    'the most recent visible state must win over a pending suspend',
  );
});

test('initializing audio from a gesture resumes a context that starts suspended', async () => {
  const { audio } = audioHarness({ initialState: 'suspended' });
  await audio.initAudio();
  assert.equal(audio.AC.state, 'running');
});

test('unmuting and enabling music retry playback after a browser interruption', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
  audio.setMuted(true);
  audio.AC.state = 'suspended';
  audio.setMuted(false);
  await audio.initAudio();
  assert.equal(audio.AC.state, 'running', 'unmute is a new opportunity to unlock audio');
  audio.setMusicVol(false);
  audio.AC.state = 'suspended';
  audio.setMusicVol(true);
  await audio.initAudio();
  assert.equal(audio.AC.state, 'running', 'enabling music is a new opportunity to unlock audio');
});

test('pagehide wins over a pending pageshow resume request', async () => {
  const { audio, window, flushTransitions } = audioHarness({ deferTransitions: true });
  const started = audio.initAudio();
  await flushTransitions();
  await started;
  audio.AC.state = 'suspended';
  window.dispatch('pageshow');
  assert.equal(
    audio.AC.state,
    'suspended',
    'resume is pending until the audio thread processes it',
  );
  window.dispatch('pagehide');
  await flushTransitions();
  assert.equal(audio.AC.state, 'suspended', 'leaving the page must override a pending resume');
});

test('a victory cue preserves exact silence for a disabled or zero-volume music bus', async () => {
  for (const mode of ['disabled', 'volume']) {
    const { audio } = audioHarness();
    await audio.initAudio();
    if (mode === 'disabled') audio.setMusicVol(false);
    else audio.setMusVol(0);
    audio.SND.fanfare();
    assert.ok(
      audio.gMusic.gain.events.every((event) => event.value === 0),
      mode,
    );
  }
});

test('economic notices remain visible before audio unlock, when muted, and at zero effects volume', async () => {
  const messages = [];
  for (const mode of ['locked', 'muted', 'zero', 'audible']) {
    const { audio, nodes } = audioHarness();
    const b = feedbackProducer();
    audio.buildings.push(b);
    if (mode !== 'locked') await audio.initAudio();
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
    await audio.initAudio();
    audio.setMuted(false);
    audio.setSfxVol(1);
    b.produced++;
    feedbackFrame(audio, 30_000);
    assert.equal(audio.msgs.length, 1, 'unlocking/unmuting never replays an old transition');
  }
  assert.ok(messages.every((message) => message === messages[0]));
});

test('muting preserves paired visual information for starts, sustained blockage and actual recovery', async () => {
  const outputs = [];
  for (const muted of [false, true]) {
    const { audio, nodes } = audioHarness();
    await audio.initAudio();
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

test('economic feedback waits for visible-feed space instead of evicting active alerts', async () => {
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

test('a fresh error takes priority over an economic transition, without discarding the transition', async () => {
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

test('Tone playback failure never interrupts economic notices or replays committed transitions', async (t) => {
  const { audio, tone } = audioHarness();
  await audio.initAudio();
  const b = feedbackProducer();
  audio.buildings.push(b);
  feedbackFrame(audio, 0);
  const failure = new Error('sound device unavailable');
  const device = t.mock.method(tone, 'Synth', function () {
    throw failure;
  });
  assert.doesNotThrow(() => audio.SND.ui());
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
    assert.doesNotThrow(() => feedbackFrame(audio, now));
  }
  const notices = audio.msgs.filter(({ t }) => !t.startsWith('Audio unavailable.'));
  assert.equal(notices.length, 3);
  assert.match(notices[0].t, /first planks produced/);
  assert.match(notices[1].t, /blocked — needs logs/);
  assert.match(notices[2].t, /production resumed/);
  assert.equal(audio.msgs.filter(({ t }) => t.startsWith('Audio unavailable.')).length, 1);
  assert.equal(audio.audioPhase, 'failed');
  device.mock.restore();
  await audio.initAudio();
  feedbackFrame(audio, 42_000);
  assert.equal(audio.msgs.length, 4, 'a recovered sound device cannot replay committed notices');
});

test('one gesture startup stays pending and skips interface cues until Tone is ready', async () => {
  let unlock;
  const gate = new Promise((resolve) => {
    unlock = resolve;
  });
  let loads = 0;
  const { audio, notes } = audioHarness({
    loadTone: async (tone) => {
      loads++;
      await gate;
      return tone;
    },
  });
  const first = audio.initAudio();
  const second = audio.initAudio();
  assert.equal(first, second, 'gestures share the in-flight attempt');
  assert.equal(audio.audioPhase, 'starting');
  audio.SND.ui();
  assert.equal(notes.length, 0, 'a pending cue is skipped');
  unlock();
  await first;
  assert.equal(loads, 1);
  assert.equal(audio.audioPhase, 'ready');
  assert.equal(notes.length, 0, 'startup never replays skipped cues');
  audio.AC.currentTime = 4;
  audio.SND.ui();
  assert.equal(notes.at(-1).time, 4, 'the immediate cue excludes musical lookahead');
});

test('a context closing during play reports once while independent notices continue, and controls retry', async () => {
  const { audio, toneNodes, contexts, notes } = audioHarness();
  const producer = feedbackProducer();
  audio.buildings.push(producer);
  feedbackFrame(audio, 0);
  await audio.initAudio();
  const closed = audio.AC;
  const oldNodes = [...toneNodes];
  await closed.close();
  closed.dispatch('statechange');
  assert.equal(
    audio.audioPhase,
    'failed',
    'the native lifecycle event detects loss without another gesture',
  );
  assert.equal(audio.AC, null);
  assert.equal(audio.msgs.filter(({ t }) => t.startsWith('Audio unavailable.')).length, 1);
  assert.ok(
    oldNodes.every((node) => node.disposed),
    'the failed playback graph releases its nodes',
  );
  producer.produced = 1;
  assert.equal(
    feedbackFrame(audio, 250),
    null,
    'the fresh failure notice retains its reading time',
  );
  const notice = feedbackFrame(audio, 1000);
  assert.equal(notice.kind, 'started');
  assert.equal(audio.msgs.at(-1).t, notice.message, 'economic observation continues without audio');
  const before = notes.length;
  audio.SND.ui();
  assert.equal(notes.length, before, 'effects during failure are skipped');
  audio.setMuted(false);
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'ready');
  assert.deepEqual(
    contexts.map(({ state }) => state),
    ['closed', 'running'],
  );
  assert.equal(audio.audioGraph.context.transport.events.size, 1);
  closed.dispatch('statechange');
  assert.equal(
    audio.audioPhase,
    'ready',
    'a late event from the disposed context cannot fail its replacement',
  );
  assert.equal(audio.msgs.filter(({ t }) => t.startsWith('Audio unavailable.')).length, 1);
  assert.equal(notes.length, before, 'retry never replays skipped cues');
  audio.SND.ui();
  assert.equal(notes.length, before + 1, 'the replacement plays new cues');
});

test('replacing a browser-closed context disposes the old Tone graph before rebuilding', async () => {
  const { audio, toneNodes, contexts, intervals } = audioHarness();
  await audio.initAudio();
  const oldNodes = [...toneNodes];
  audio.AC.state = 'closed';
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'ready');
  assert.equal(contexts.length, 2);
  assert.ok(
    oldNodes.every((node) => node.disposed),
    'the replaced graph releases every owned node',
  );
  assert.equal(
    audio.audioGraph.context.transport.events.size,
    1,
    'the replacement retains a single score schedule',
  );
});

test('the latest visibility state wins when a running-context reconciliation settles immediately', async () => {
  const { audio, document } = audioHarness();
  await audio.initAudio();
  document.dispatch('visibilitychange');
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  await audio.initAudio();
  assert.equal(audio.AC.state, 'suspended');
  assert.equal(audio.audioCanPlay(), false);
});

test('constructor failures report once and audio controls retry a clean startup', async () => {
  const { audio, window, notes, contexts, intervals } = audioHarness();
  const Constructor = window.AudioContext;
  window.AudioContext = class {
    constructor() {
      throw new Error('audio device denied');
    }
  };
  assert.equal(audio.msgs.length, 0, 'waiting for the first gesture is not an error');
  await audio.initAudio();
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'failed');
  assert.equal(audio.msgs.length, 1);
  assert.match(audio.msgs[0].t, /Audio unavailable.*retry/);
  audio.SND.ui();
  assert.equal(notes.length, 0);
  window.AudioContext = Constructor;
  audio.setMuted(false);
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'ready');
  assert.equal(contexts.length, 1);
  assert.equal(audio.audioGraph.context.transport.events.size, 1);
  assert.equal(notes.length, 0, 'retry does not replay missed effects');
  audio.SND.ui();
  assert.equal(notes.length, 1);
});

test('a partial mixer failure releases owned nodes before the next attempt', async () => {
  const { audio, tone, toneNodes, contexts, intervals } = audioHarness();
  const Gain = tone.Gain;
  let gains = 0;
  tone.Gain = class extends Gain {
    constructor(options) {
      if (++gains === 2) throw new Error('mixer allocation failed');
      super(options);
    }
  };
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'failed');
  assert.ok(toneNodes.length > 0);
  assert.ok(toneNodes.every((node) => node.disposed));
  assert.equal(contexts[0].state, 'closed');
  assert.equal(intervals.size, 0);
  tone.Gain = Gain;
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'ready');
  assert.equal(audio.audioGraph.context.transport.events.size, 1);
  assert.equal(contexts.length, 2);
});

test('interface cues release finite Tone resources and preserve immediate cue contours', async () => {
  const { audio, toneNodes, notes, timeouts, flushReleases } = audioHarness();
  await audio.initAudio();
  const persistent = toneNodes.length;
  audio.AC.currentTime = 12;
  audio.SND.ui();
  audio.SND.tick();
  audio.SND.uiOpen();
  audio.SND.fail();
  assert.deepEqual(
    notes.map(({ frequency }) => frequency),
    [720, 950, 520, 120, 89, undefined],
  );
  assert.deepEqual(
    notes.map(({ time }) => time),
    [12, 12, 12, 12, 12.005, 12],
  );
  assert.ok(toneNodes.length > persistent);
  flushReleases();
  assert.ok(toneNodes.slice(persistent).every((node) => node.disposed));
  assert.equal(timeouts.size, 0);
});

test('preferences and visibility before the first gesture never start audio', async () => {
  const { audio, document, window, contexts, toneNodes } = audioHarness({
    savedPrefs: { muted: true, music: false, musVol: 0.23, sfxVol: 0.41, ambVol: 0.67 },
  });
  audio.loadPrefs();
  document.dispatch('visibilitychange');
  window.dispatch('pageshow');
  await Promise.resolve();
  assert.equal(contexts.length, 0);
  assert.equal(toneNodes.length, 0);
  assert.equal(audio.msgs.length, 0);
  await audio.initAudio();
  assert.equal(audio.audioGraph.channels.master.gain.value, 0);
  assert.equal(audio.audioGraph.channels.music.gain.value, 0);
  assert.equal(audio.audioGraph.channels.effects.gain.value, 0.41);
  assert.equal(audio.audioGraph.channels.ambience.gain.value, 0.67);
  audio.setMuted(false);
  audio.setMusicVol(true);
  audio.setMusVol(0.3);
  audio.setAmbVol(0.4);
  await audio.initAudio();
  assert.equal(audio.AC.resumeCalls, 1, 'ready controls do not repeatedly resume the context');
});

test('a Tone context constructor that fails after native creation closes the native attempt', async () => {
  const { audio, tone, contexts, intervals } = audioHarness();
  const Context = tone.Context;
  tone.Context = class extends Context {
    constructor(options) {
      super(options);
      throw new Error('context subgraph initialization failed');
    }
  };
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'failed');
  assert.equal(audio.msgs.length, 1);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].state, 'closed', 'native ownership survives a throwing Tone wrapper');
  assert.equal(intervals.size, 0);
  tone.Context = Context;
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'ready');
  assert.deepEqual(
    contexts.map(({ state }) => state),
    ['closed', 'running'],
  );
});
