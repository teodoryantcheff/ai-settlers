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
test('real production events trigger audio and repeated audio initialization subscribes once', async () => {
  const { audio } = audioHarness();
  await audio.initAudio();
  await audio.initAudio();
  const calls = [];
  audio.SND.chop = (x, y) => calls.push({ x, y });
  audio.gameEvents.emit('goodsProduced', { building: { type: 'lumberjack', x: 2, y: 3 } });
  assert.deepEqual(calls, [{ x: 2, y: 3 }]);
  audio.gameEvents.emit('goodsDelivered', { building: { type: 'lumberjack', x: 2, y: 3 } });
  audio.gameEvents.emit('goodsProduced', {});
  assert.equal(calls.length, 1, 'unrelated and empty events must not play work sounds');
});

test('industrial work audio caps overlap, throttles bursts, and releases expired reservations', async () => {
  const { audio, nodes } = audioHarness();
  await audio.initAudio();
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

test('all finite synth voices disconnect their filters, gains and panners after playing', async () => {
  const { audio, nodes, flushReleases } = audioHarness();
  await audio.initAudio();
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
  flushReleases();
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

test('the first gold milestone plays its coin cue once through the event bus', async () => {
  const { audio, nodes } = audioHarness();
  await audio.initAudio();
  await audio.initAudio();
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

test('economic cues have distinct contours and release every finite voice', async () => {
  const { audio, nodes, flushReleases } = audioHarness();
  await audio.initAudio();
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
