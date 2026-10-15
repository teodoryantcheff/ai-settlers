'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audioHarness, feedbackProducer, feedbackFrame } = require('./helpers/audio.cjs');
test('real production events map the complete work catalog and subscribe once', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
  await audio.initAudio();
  const calls = [];
  for (const method of ['chop', 'saw', 'clang', 'forge'])
    audio.SND[method] = (x, y) => calls.push([method, x, y]);
  for (const type of [
    'lumberjack',
    'sawmill',
    'quarry',
    'toolsmith',
    'smelter',
    'workshop',
    'windmill',
    'armory',
    'mine_coal',
    'mine_iron',
    'mine_gold',
  ])
    audio.gameEvents.emit('goodsProduced', { building: { type, x: 2, y: 3 } });
  assert.deepEqual(
    calls.map(([method]) => method),
    ['chop', 'saw', 'clang', 'forge', 'forge', 'saw', 'saw', 'forge', 'clang', 'clang', 'clang'],
  );
  assert.ok(calls.every(([, x, y]) => x === 2 && y === 3));
  audio.gameEvents.emit('goodsDelivered', { building: { type: 'lumberjack', x: 2, y: 3 } });
  audio.gameEvents.emit('goodsProduced', {});
  audio.gameEvents.emit('goodsProduced', { building: { type: 'farm', x: 2, y: 3 } });
  assert.equal(calls.length, 11, 'unrelated and empty events must stay silent');
});

test('industrial Tone cues cap overlap, space bursts, and release expired reservations', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  let accepted = 0;
  for (let i = 0; i < 10; i++) {
    audio.AC.currentTime = i * 0.071;
    const before = notes.length;
    audio.SND.forge(i, 0);
    if (notes.length > before) accepted++;
    assert.ok(audio.industrialVoices.length <= 6);
  }
  assert.equal(accepted, 6, 'a burst may start at most six overlapping work sounds');
  audio.AC.currentTime = 3;
  const before = notes.length;
  audio.SND.forge(0, 0);
  assert.ok(notes.length > before, 'expired voices allow a new production cue');
  assert.equal(audio.industrialVoices.length, 1);
  const sameMoment = notes.length;
  audio.SND.saw(1, 0);
  audio.SND.forge(0, 0);
  audio.SND.forge(100, 100);
  assert.equal(notes.length, sameMoment, 'burst, same-building and distant work must stay quiet');
});

test('the world cue palette uses immediate Tone instruments and releases every finite resource', async () => {
  const { audio, notes, toneNodes, flushReleases } = audioHarness();
  await audio.initAudio();
  for (const name of [
    'place',
    'done',
    'demolish',
    'man',
    'gone',
    'road',
    'coin',
    'hammer',
    'chop',
    'saw',
    'clang',
    'forge',
    'fanfare',
  ]) {
    audio.AC.currentTime += 5;
    const before = notes.length;
    const resources = toneNodes.length;
    audio.SND[name](2, 3);
    const played = notes.slice(before);
    assert.ok(played.length > 0, `${name} must use Tone instruments`);
    assert.equal(Math.min(...played.map((note) => note.time)), audio.AC.currentTime, name);
    assert.ok(
      played.every((note) => note.time < audio.AC.currentTime + 2),
      name,
    );
    flushReleases();
    assert.ok(
      toneNodes.slice(resources).every((node) => node.disposed),
      name,
    );
  }
});

test('the first gold milestone plays its coin cue once through the event bus', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  await audio.initAudio();
  const coins = [];
  const coin = audio.SND.coin;
  audio.SND.coin = (x, y) => {
    coins.push({ x, y });
    coin(x, y);
  };
  const before = notes.length;
  audio.gameEvents.emit('firstGold', { building: { type: 'hq', x: 2, y: 3 } });
  assert.deepEqual(coins, [{ x: 2, y: 3 }]);
  assert.ok(notes.length > before, 'the first delivery must create the milestone sound');
  audio.gameEvents.emit('firstGold', {});
  assert.equal(coins.length, 1, 'an event without a storage location must not create a cue');
});

test('economic cues keep their distinct contours at the immediate audio timestamp', async () => {
  const { audio, notes, toneNodes, flushReleases } = audioHarness();
  await audio.initAudio();
  audio.AC.currentTime = 5;
  const expected = {
    chainStart: [
      [523, 5],
      [784, 5.1],
    ],
    chainBlocked: [
      [233, 5],
      [196, 5.13],
    ],
    chainRecovered: [
      [659, 5],
      [880, 5.12],
    ],
  };
  for (const [name, contour] of Object.entries(expected)) {
    const before = notes.length;
    const resources = toneNodes.length;
    audio.SND[name](2, 3);
    assert.deepEqual(
      notes.slice(before).map(({ frequency, time }) => [frequency, time]),
      contour,
      name,
    );
    flushReleases();
    assert.ok(
      toneNodes.slice(resources).every((node) => node.disposed),
      name,
    );
  }
});

test('work cues retain the 70 ms global spacing and cooldown by kind and location', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  function at(time, method, x, y) {
    audio.AC.currentTime = time;
    const before = notes.length;
    audio.SND[method](x, y);
    return notes.length > before;
  }
  assert.equal(at(0, 'forge', 2, 3), true);
  assert.equal(at(0.069, 'hammer', 3, 3), false);
  assert.equal(at(0.07, 'hammer', 3, 3), true);
  assert.equal(at(0.14, 'forge', 2, 3), false, 'the same forge keeps its 750 ms cooldown');
  assert.equal(
    at(0.21, 'clang', 2, 3),
    true,
    'different work at the same place has its own cooldown',
  );
  assert.equal(at(0.74, 'forge', 2, 3), false);
  assert.equal(at(0.75, 'forge', 2, 3), true);
  assert.equal(at(0.821, 'forge', 3, 3), true, 'another building has its own cooldown');
});

test('work audio keeps the five-tile offscreen margin when the camera and zoom change', async () => {
  const { audio, notes, toneNodes } = audioHarness();
  await audio.initAudio();
  audio.cam = { x: 320, y: 160 };
  audio.z = 2;
  for (const [x, y, audible] of [
    [5, 0, true],
    [27.5, 19.375, true],
    [4.999, 5, false],
    [27.501, 5, false],
    [10, -0.001, false],
    [10, 19.376, false],
  ]) {
    audio.AC.currentTime += 1;
    const before = notes.length;
    const resources = toneNodes.length;
    audio.SND.hammer(x, y);
    assert.equal(notes.length > before, audible, `work at ${x},${y}`);
    if (!audible) assert.equal(toneNodes.length, resources, 'distant work allocates no resources');
  }
});

test('concurrent spatial cues retain separate panners for every instrument layer', async () => {
  const { audio, notes, toneNodes } = audioHarness();
  await audio.initAudio();
  audio.AC.currentTime = 5;
  const before = notes.length;
  const resources = toneNodes.length;
  audio.SND.coin(0, 3);
  audio.SND.chainStart(25, 3);
  const panners = toneNodes.slice(resources).filter((node) => node.type === 'tone-panner');
  assert.deepEqual(
    panners.map((node) => node.pan.value),
    [-0.55, 0.55],
  );
  for (const note of notes.slice(before)) {
    let node = note.node;
    const route = [];
    while (node && !route.includes(node)) {
      route.push(node);
      node = toneNodes.find((candidate) => candidate.input === node.input.connections[0]);
    }
    assert.equal(route.filter((entry) => panners.includes(entry)).length, 1, note.instrument);
    assert.ok(
      route.includes(audio.audioGraph.channels.effects),
      'every layer reaches the effects channel',
    );
  }
  audio.cam.x = 400;
  audio.z = 2;
  audio.SND.chainRecovered(18.75, 3);
  assert.equal(toneNodes.filter((node) => node.type === 'tone-panner').at(-1).pan.value, 0);
  audio.SND.coin(100, 3);
  assert.equal(toneNodes.filter((node) => node.type === 'tone-panner').at(-1).pan.value, 0.75);
  assert.deepEqual(
    panners.map((node) => node.pan.value),
    [-0.55, 0.55],
    'camera changes never move an earlier cue',
  );
});

test('disabled, starting and hidden world effects allocate no voices or work reservations', async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const { audio, notes, toneNodes, document } = audioHarness({
    loadTone: (tone) => waiting.then(() => tone),
  });
  const playAll = () => {
    for (const name of [
      'place',
      'done',
      'demolish',
      'man',
      'gone',
      'road',
      'coin',
      'chainStart',
      'chainBlocked',
      'chainRecovered',
      'hammer',
      'chop',
      'saw',
      'clang',
      'forge',
      'fanfare',
    ])
      audio.SND[name](2, 3);
  };
  playAll();
  const started = audio.initAudio();
  playAll();
  assert.equal(toneNodes.length, 0);
  assert.equal(audio.industrialVoices.length, 0);
  release();
  await started;
  const baseline = toneNodes.length;
  for (const mode of ['muted', 'zero', 'hidden']) {
    audio.setMuted(mode === 'muted');
    audio.setSfxVol(mode === 'zero' ? 0 : 0.9);
    document.visibilityState = mode === 'hidden' ? 'hidden' : 'visible';
    playAll();
    assert.equal(toneNodes.length, baseline, mode);
    assert.equal(notes.length, 0, mode);
    assert.equal(audio.industrialVoices.length, 0, mode);
  }
});

test('a failed economic Tone voice preserves its notice, cleans up and retries without duplicated events', async () => {
  const { audio, tone, notes, toneNodes } = audioHarness();
  await audio.initAudio();
  const producer = feedbackProducer();
  audio.buildings.push(producer);
  feedbackFrame(audio, 0);
  producer.produced = 1;
  const Synth = tone.Synth;
  tone.Synth = class extends Synth {
    triggerAttackRelease() {
      throw new Error('device lost');
    }
  };
  let notice;
  assert.doesNotThrow(() => {
    notice = feedbackFrame(audio, 250);
  });
  assert.equal(notice.kind, 'started');
  assert.match(audio.msgs[0].t, /first planks produced/);
  assert.equal(audio.audioPhase, 'failed');
  assert.ok(
    toneNodes.every((node) => node.disposed),
    'partial cue resources and the failed graph are disposed',
  );
  tone.Synth = Synth;
  await audio.initAudio();
  const before = notes.length;
  audio.gameEvents.emit('firstGold', { building: { type: 'hq', x: 2, y: 3 } });
  assert.deepEqual(
    notes
      .slice(before)
      .filter((note) => note.instrument === 'FMSynth')
      .map((note) => note.frequency),
    [1318, 1760],
  );
  feedbackFrame(audio, 500);
  assert.equal(audio.msgs.filter((message) => /first planks produced/.test(message.t)).length, 1);
});

test('road and victory cues preserve their step limits, note sequence and cosmetic-only state', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  const original = JSON.stringify({ state: audio.state, buildings: audio.buildings });
  audio.SR = () => {
    throw new Error('audio consumed gameplay RNG');
  };
  audio.AC.currentTime = 5;
  let before = notes.length;
  audio.SND.road(100);
  const steps = notes.slice(before).filter((note) => note.instrument === 'MembraneSynth');
  assert.deepEqual(
    steps.map((note) => Math.round((note.time - 5) * 1000)),
    [0, 55, 110, 165, 220, 275],
  );
  before = notes.length;
  audio.SND.fanfare();
  const melody = notes.slice(before).filter((note) => note.instrument === 'MonoSynth');
  assert.deepEqual(
    melody.map((note) => Math.round(69 + 12 * Math.log2(note.frequency / 440))),
    [62, 66, 69, 74, 69, 74],
  );
  assert.deepEqual(
    melody.map((note) => Math.round((note.time - 5) * 1000)),
    [0, 160, 320, 500, 850, 1050],
  );
  for (const name of [
    'place',
    'done',
    'demolish',
    'man',
    'gone',
    'coin',
    'chainStart',
    'chainBlocked',
    'chainRecovered',
    'hammer',
    'chop',
    'saw',
    'clang',
    'forge',
  ]) {
    audio.AC.currentTime += 1;
    audio.SND[name](2, 3);
  }
  assert.equal(audio.audioPhase, 'ready', 'no cue calls the simulation RNG');
  assert.equal(JSON.stringify({ state: audio.state, buildings: audio.buildings }), original);
});
