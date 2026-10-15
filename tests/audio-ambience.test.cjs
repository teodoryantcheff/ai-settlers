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
test('saved ambience volume is restored before initialization and remains independent of music and effects', async () => {
  const { audio, storage } = audioHarness({
    savedPrefs: { ambVol: 0.33, musVol: 0.2, sfxVol: 0.8 },
  });
  audio.loadPrefs();
  assert.equal(audio.ambVol, 0.33);
  await audio.initAudio();
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
  await restored.initAudio();
  assert.equal(restored.gAmb.gain.value, 0.64);
});

test('silent saved ambience suppresses wildlife voices and invalid saved values use the default', async () => {
  const { audio, nodes } = audioHarness({ savedPrefs: { ambVol: 0 } });
  audio.loadPrefs();
  await audio.initAudio();
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
