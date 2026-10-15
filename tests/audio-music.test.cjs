'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  audioHarness,
  workers,
  connectedNodes,
  finishSources,
  feedbackProducer,
  feedbackFrame,
} = require('./helpers/audio.cjs');
test('the full score has three longer themes and reserves each quiet phrase for ambience', async () => {
  const { audio, nodes } = audioHarness();
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

test('a missing recipe input counts as starvation even when another input is available', async () => {
  const { audio } = audioHarness();
  audio.buildings = [{ type: 'sawmill', done: true, stock: { logs: 2, tools: 0 }, timer: 0 }];
  assert.equal(audio.starvingCount(), 1);
  assert.equal(audio.musicColony().active, 0);
  audio.buildings[0].stock.tools = 1;
  assert.equal(audio.starvingCount(), 0);
  assert.equal(audio.musicColony().active, 1);
});

test('an overdue music scheduler resumes at a phrase without playing a catch-up burst', async () => {
  const { audio, nodes, intervals } = audioHarness();
  await audio.initAudio();
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
