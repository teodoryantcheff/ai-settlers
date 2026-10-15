'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audioHarness, workers, feedbackProducer, feedbackFrame } = require('./helpers/audio.cjs');
test('the full score has three longer themes and reserves each quiet phrase for ambience', async () => {
  const { audio, nodes, notes } = audioHarness();
  await audio.initAudio();
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
      assert.ok(notes.length > 0, 'the score plays through Tone instruments');
    }
  }
  assert.equal(names.size, 3);
  assert.equal(quietBars, 24);
  assert.equal(audio.BAR * 48, 90, 'each theme lasts 90 seconds');
});

test('musical layers follow working completed producers and change smoothly at phrase boundaries', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
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

test('phrase arrangements smooth shortages, night and gold without changing within a phrase', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
  audio.buildings = workers(14);
  audio.scheduleBar(0, 1);
  audio.buildings.push({ type: 'sawmill', done: true, stock: { logs: 0, tools: 0 }, timer: 0 });
  audio.nightAmt = () => 1;
  audio.state.gold = 160;
  audio.scheduleBar(1, 3);
  assert.equal(audio.musicArrangement.night, 0);
  assert.equal(audio.musicArrangement.hungry, 0);
  audio.scheduleBar(8, 16);
  assert.equal(audio.musicArrangement.hungry, 0.45);
  assert.equal(audio.musicArrangement.night, 0.45);
  assert.equal(audio.musicArrangement.gold, 0.36000000000000004);
  assert.equal(audio.musicArrangement.active, 14);
});

test('a missing recipe input counts as starvation even when another input is available', async () => {
  const { audio } = audioHarness();
  audio.buildings = [{ type: 'sawmill', done: true, stock: { logs: 2, tools: 0 }, timer: 0 }];
  assert.equal(audio.starvingCount(), 1);
  assert.equal(audio.musicColony().active, 0);
  audio.buildings[0].stock.tools = 1;
  assert.equal(audio.starvingCount(), 0);
  assert.equal(audio.musicColony().active, 1);
});

test('the score uses Tone scheduling and forwards its audio timestamp without musical polling', async () => {
  const { audio, notes, intervals } = audioHarness();
  await audio.initAudio();
  audio.buildings = workers(14);
  const transport = audio.audioGraph.context.transport;
  assert.equal(transport.events.size, 1, 'one Tone schedule owns the score');
  assert.equal(intervals.size, 0, 'music has no custom polling interval');
  const event = [...transport.events.values()][0];
  assert.equal(event.interval, 1.875, 'six eighth notes at 96 BPM');
  audio.AC.currentTime = 10;
  event.callback(10.25);
  assert.equal(audio.musicBar, 1);
  assert.ok(notes.length > 0);
  assert.equal(Math.min(...notes.map(({ time }) => time)), 10.25);
  assert.ok(notes.every(({ time }) => time >= 10.25 && time < 12.125));
});

test('hidden pages cancel future score voices and resume once at the next phrase', async () => {
  const { audio, document, notes, toneNodes } = audioHarness();
  await audio.initAudio();
  audio.buildings = workers(14);
  const transport = audio.audioGraph.context.transport;
  const stale = [...transport.events.values()][0].callback;
  audio.AC.currentTime = 10;
  stale(10.25);
  const musical = toneNodes.filter(
    ({ options }) => options.oscillator || options.pan !== undefined,
  );
  assert.equal(audio.musicBar, 1);
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  assert.equal(transport.events.size, 0);
  assert.ok(
    musical.every(({ disposed }) => disposed),
    'future notes and their panners are cancelled',
  );
  const before = notes.length;
  stale(100);
  assert.equal(notes.length, before);
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  await audio.initAudio();
  await audio.initAudio();
  assert.equal(transport.events.size, 1);
  assert.equal(audio.musicBar, 8);
  [...transport.events.values()][0].callback(11);
  assert.equal(audio.musicBar, 9);
  assert.equal(audio.musicArrangement.phrase, 8);
});

test('an overdue Tone callback drops the old schedule before starting one fresh phrase', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  audio.buildings = workers(14);
  audio.musicBar = 9;
  const transport = audio.audioGraph.context.transport;
  const stale = [...transport.events.values()][0].callback;
  audio.AC.currentTime = 1000;
  stale(1);
  assert.equal(notes.length, 0, 'overdue music is never played at past timestamps');
  assert.equal(audio.musicBar, 16);
  assert.equal(transport.events.size, 1);
  const current = [...transport.events.values()][0].callback;
  assert.notEqual(current, stale);
  stale(1000.3);
  assert.equal(notes.length, 0, 'a cleared callback cannot resurrect old notes');
  current(1000.25);
  assert.equal(audio.musicBar, 17);
  assert.ok(notes.length > 0);
  assert.ok(notes.every(({ time }) => time >= 1000.25 && time < 1002.125));
});

test('score time ignores simulation pause and speed and reads replacement colony arrays', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
  const event = [...audio.audioGraph.context.transport.events.values()][0];
  audio.buildings = workers(14);
  audio.state.paused = true;
  audio.state.speed = 20;
  audio.musicBar = 8;
  event.callback(10);
  assert.equal(audio.musicBar, 9);
  assert.equal(audio.musicArrangement.active, 14);
  audio.buildings = workers(1);
  audio.state = { gold: 0, speed: 1, time: 0, paused: false, won: false };
  audio.seed = 50;
  assert.equal(audio.musicBar, 9, 'colony replacement does not reset the session score');
  audio.musicBar = 16;
  event.callback(12);
  assert.equal(audio.musicArrangement.active, 1, 'the next phrase reads current live arrays');
  assert.equal(audio.musicBar, 17);
});

test('playback failure releases finite music voices and retry retains the score cursor', async () => {
  const { audio, tone, notes, toneNodes, contexts } = audioHarness();
  await audio.initAudio();
  audio.buildings = workers(14);
  const oldTransport = audio.audioGraph.context.transport;
  const oldCallback = [...oldTransport.events.values()][0].callback;
  audio.musicBar = 9;
  const MonoSynth = tone.MonoSynth;
  tone.MonoSynth = class extends MonoSynth {
    connect() {
      throw new Error('score voice failed');
    }
  };
  oldCallback(10);
  assert.equal(audio.audioPhase, 'failed');
  assert.equal(oldTransport.events.size, 0);
  assert.ok(
    toneNodes.every(({ disposed }) => disposed),
    'partly constructed music voices are owned',
  );
  assert.equal(audio.musicBar, 16);
  assert.equal(audio.msgs.length, 1);
  const before = notes.length;
  tone.MonoSynth = MonoSynth;
  await audio.initAudio();
  await audio.initAudio();
  assert.equal(contexts.length, 2);
  assert.equal(audio.musicBar, 16);
  const transport = audio.audioGraph.context.transport;
  assert.equal(transport.events.size, 1);
  oldCallback(20);
  assert.equal(notes.length, before, 'retry does not replay the stale schedule');
  [...transport.events.values()][0].callback(20);
  assert.equal(audio.musicBar, 17);
});

test('music controls cancel finite voices and resume one score without overdue automation', async () => {
  const { audio, notes, toneNodes } = audioHarness();
  await audio.initAudio();
  const transport = audio.audioGraph.context.transport;
  [...transport.events.values()][0].callback(1);
  const voices = toneNodes.filter(({ options }) => options.oscillator || options.pan !== undefined);
  audio.setMusVol(0);
  assert.equal(transport.events.size, 0);
  assert.ok(voices.every(({ disposed }) => disposed));
  audio.setMusVol(0.4);
  await audio.initAudio();
  assert.equal(transport.events.size, 1);
  audio.setMusicVol(false);
  assert.equal(transport.events.size, 0);
  audio.setMusicVol(true);
  audio.setMuted(true);
  assert.equal(transport.events.size, 0);
  const before = notes.length;
  audio.setMuted(false);
  await audio.initAudio();
  assert.equal(transport.events.size, 1);
  assert.equal(notes.length, before, 'controls never replay queued notes');
});

test('score percussion retains the original 95 Hz down to 52 Hz contour', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  audio.buildings = workers(14);
  for (let bar = 0; bar < 24; bar++) audio.scheduleBar(bar, 100 + bar * audio.BAR);
  const drums = notes.filter(({ instrument }) => instrument === 'MembraneSynth');
  assert.ok(drums.length > 0);
  for (const { frequency, node } of drums) {
    assert.equal(frequency, 52);
    // Tone 15.1.22's MembraneSynth multiplies the base frequency by octaves.
    assert.equal(frequency * node.options.octaves, 95);
  }
});

test('finite score voices release and seeded score variation never consumes gameplay RNG', async () => {
  const { audio, notes, toneNodes, flushReleases } = audioHarness();
  await audio.initAudio();
  const before = toneNodes.length;
  audio.buildings = workers(14);
  audio.state.gold = 160;
  audio.rng = () => {
    throw new Error('score consumed gameplay RNG');
  };
  const stateBefore = JSON.stringify(audio.state);
  for (let bar = 0; bar < 32; bar++) audio.scheduleBar(bar, 100 + bar * audio.BAR);
  assert.ok(notes.some(({ instrument }) => instrument === 'MonoSynth'));
  assert.ok(notes.some(({ instrument }) => instrument === 'FMSynth'));
  assert.ok(notes.some(({ instrument }) => instrument === 'MembraneSynth'));
  assert.ok(notes.some(({ instrument }) => instrument === 'NoiseSynth'));
  assert.equal(JSON.stringify(audio.state), stateBefore);
  const signature = notes.slice().map(({ frequency, duration, time, velocity, instrument }) => ({
    frequency,
    duration,
    time,
    velocity,
    instrument,
  }));
  notes.length = 0;
  // The same known bar always has the same cosmetic pattern, independent of
  // all earlier scheduling and without advancing colony simulation.
  audio.scheduleBar(31, 100 + 31 * audio.BAR);
  const first = notes.map(({ frequency, time, velocity }) => ({ frequency, time, velocity }));
  notes.length = 0;
  audio.scheduleBar(31, 100 + 31 * audio.BAR);
  assert.deepEqual(
    notes.map(({ frequency, time, velocity }) => ({ frequency, time, velocity })),
    first,
  );
  assert.ok(signature.length > 100);
  flushReleases();
  assert.ok(toneNodes.slice(before).every(({ disposed }) => disposed));
});
