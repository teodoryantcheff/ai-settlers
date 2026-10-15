'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audioHarness } = require('./helpers/audio.cjs');

test('bright interface cues are quieter while rejection cues keep their low body', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  audio.AC.currentTime = 5;
  for (const [name, previousLevel] of [
    ['ui', 0.055],
    ['tick', 0.018],
    ['uiOpen', 0.05],
  ]) {
    const before = notes.length;
    audio.SND[name]();
    const played = notes.slice(before);
    assert.equal(played.length, 1, name);
    const reduction = 20 * Math.log10(played[0].velocity / previousLevel);
    assert.ok(reduction <= -4 && reduction >= -5, `${name}: ${reduction} dB`);
    assert.equal(played[0].time, 5, 'softening does not delay feedback');
  }
  const before = notes.length;
  audio.SND.fail();
  assert.deepEqual(
    notes.slice(before).map(({ velocity }) => velocity),
    [0.07, 0.05, 0.05],
  );
});

test('world and score bells share a softer level, attack and velocity-independent brightness', async () => {
  const { audio, notes } = audioHarness();
  await audio.initAudio();
  const bells = [];
  for (const name of ['done', 'coin', 'clang', 'forge', 'chainRecovered', 'fanfare']) {
    audio.AC.currentTime += 5;
    const before = notes.length;
    audio.SND[name](2, 3);
    const played = notes.slice(before).filter((note) => note.node.options.harmonicity === 2.51);
    assert.ok(played.length > 0, name);
    bells.push(...played);
  }
  const before = notes.length;
  audio.scheduleBar(7, 100);
  const scoreBells = notes.slice(before).filter((note) => note.node.options.harmonicity === 2.51);
  assert.equal(scoreBells.length, 1, 'the first phrase keeps its bell accent');
  assert.equal(scoreBells[0].time, 100, 'the score accent retains its scheduled timestamp');
  bells.push(...scoreBells);
  assert.ok(new Set(bells.map(({ velocity }) => velocity)).size >= 3);
  for (const { node, velocity } of bells) {
    const options = node.options;
    // Pinned Tone FM voices apply a -10 dB carrier/modulator attenuation.
    assert.equal(options.volume - 10, -5, 'bell output is reduced by five decibels');
    assert.ok(options.envelope.attack >= 0.004, 'the bell attack is softened');
    assert.ok(options.modulationEnvelope.attack >= 0.004, 'overtones enter softly too');
    const brightness = options.modulationIndex * velocity * Math.pow(10, -0.5);
    assert.ok(brightness >= 0.13 && brightness <= 0.15, `normalized bell brightness ${brightness}`);
  }
});
