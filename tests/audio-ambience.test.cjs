'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audioHarness } = require('./helpers/audio.cjs');
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

test('one ambient graph supplies wind, water and rain with reusable Tone sources', async () => {
  const { audio, toneNodes } = audioHarness();
  await audio.initAudio();
  const noise = toneNodes.filter((node) => node.input.type === 'tone-noise-source');
  assert.equal(noise.length, 3, 'wind, water and rain use Tone continuous sources');
  const baseline = toneNodes.length;
  audio.rainAmt = () => 0.8;
  audio.tiles.forEach((tile) => {
    tile.t = audio.WATER;
  });
  for (let index = 0; index < 10; index++) audio.ambTick(0.1);
  await audio.initAudio();
  assert.equal(toneNodes.length, baseline, 'environment updates reuse the original graph');
});

test('wildlife uses finite Tone voices with independent ambience positioning', async () => {
  const { audio, toneNodes, notes, flushReleases } = audioHarness();
  await audio.initAudio();
  audio.setMusicVol(false);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    for (const [cue, count, frequency, spacing] of [
      ['birdChirp', 2, 2100, 0.09],
      ['cricketChirp', 3, 4200, 0.11],
      ['owlHoot', 2, 340, 0.62],
    ]) {
      const beforeNodes = toneNodes.length;
      const beforeNotes = notes.length;
      audio[cue]();
      const played = notes.slice(beforeNotes);
      assert.equal(played.length, count, cue);
      assert.equal(played[0].frequency, frequency, cue);
      assert.equal(played[1].time - played[0].time, spacing, cue);
      assert.ok(played.every((note) => note.time >= audio.AC.currentTime));
      const voices = toneNodes.slice(beforeNodes);
      const pan = voices.find((node) => node.type === 'tone-panner');
      assert.ok(pan.input.connections.includes(audio.gAmb), cue + ' routes to ambience');
      flushReleases();
      assert.ok(
        voices.every((node) => node.disposed),
        cue + ' releases every finite resource',
      );
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('thunder remains an immediate effects cue when ambience is silent and releases its rumbles', async () => {
  const { audio, toneNodes, notes, flushReleases } = audioHarness();
  await audio.initAudio();
  audio.setAmbVol(0);
  audio.AC.currentTime = 20;
  const before = toneNodes.length;
  audio.SND.thunder();
  const played = notes.slice(-3);
  assert.equal(played.length, 3);
  assert.deepEqual(
    played.map((note) => note.time),
    [20, 20.12, 20],
  );
  assert.equal(played.filter((note) => note.type === 'noise').length, 2);
  assert.equal(played.find((note) => note.type === 'sine').frequency, 54);
  const resources = toneNodes.slice(before);
  assert.ok(resources.some((node) => node.input.connections.includes(audio.gSfx)));
  flushReleases();
  assert.ok(resources.every((node) => node.disposed));
  audio.setSfxVol(0);
  const disabled = toneNodes.length;
  audio.SND.thunder();
  assert.equal(toneNodes.length, disabled);
});

test('water follows camera coverage and weather gains cancel obsolete automation', async () => {
  const { audio, toneNodes } = audioHarness();
  await audio.initAudio();
  const gainAfterFilter = (frequency) => {
    const filter = toneNodes.find(
      (node) => node.type === 'tone-filter' && node.options.frequency === frequency,
    );
    return toneNodes.find((node) => node.input === filter.input.connections[0]);
  };
  const water = gainAfterFilter(640);
  const rain = gainAfterFilter(2400);
  audio.vw = audio.vh = 96;
  audio.tiles[0].t = audio.WATER;
  audio.rainAmt = () => 0.8;
  water.gain.setValueAtTime(0.9, 999);
  rain.gain.setValueAtTime(0.9, 999);
  audio.ambTick(0);
  assert.equal(water.gain.value, 0.0225);
  assert.ok(Math.abs(rain.gain.value - 0.04) < 1e-10);
  assert.ok(water.gain.events.every((event) => event.time < 999));
  assert.ok(rain.gain.events.every((event) => event.time < 999));
  audio.cam.x = 96;
  for (let index = 0; index < 16; index++) audio.ambTick(0.1);
  assert.equal(water.gain.value, 0, 'camera movement leaves the water behind');
  audio.tiles = audio.tiles.map(() => ({ t: audio.WATER }));
  for (let index = 0; index < 16; index++) audio.ambTick(0.1);
  assert.equal(water.gain.value, 0.05, 'replaced live tiles control the current water mix');
  audio.cam.x = 20000;
  for (let index = 0; index < 16; index++) audio.ambTick(0.1);
  assert.equal(water.gain.value, 0, 'an empty viewport sample remains silent');
});

test('wildlife keeps its cadence through simulation pause and respects night, twilight and rain', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    for (const [night, rain, count, frequency] of [
      [0, 0, 4, 2900],
      [0.5, 0, 5, 4450],
      [0.46, 0, 0, null],
      [0, 0.36, 0, null],
    ]) {
      const { audio, notes } = audioHarness();
      await audio.initAudio();
      audio.nightAmt = () => night;
      audio.rainAmt = () => rain;
      audio.state.paused = true;
      audio.state.speed = 20;
      const state = JSON.stringify([audio.state, audio.seed, audio.tiles, audio.buildings]);
      for (let frame = 0; frame < 60; frame++) audio.ambTick(0.1);
      assert.equal(notes.length, 0, 'the initial wildlife delay is retained');
      for (let frame = 0; frame < 3; frame++) audio.ambTick(0.1);
      assert.equal(notes.length, count, `night=${night}, rain=${rain}`);
      if (count) assert.equal(notes[0].frequency, frequency);
      const first = notes.length;
      for (let frame = 0; frame < 80; frame++) audio.ambTick(0.1);
      assert.equal(notes.length, first, 'the next chorus waits at least eight seconds');
      for (let frame = 0; frame < 20; frame++) audio.ambTick(0.1);
      assert.equal(notes.length, count * 2, 'subsequent wildlife retains the existing cadence');
      assert.equal(JSON.stringify([audio.state, audio.seed, audio.tiles, audio.buildings]), state);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('startup and hidden time skip wildlife without replay or duplicate ambient beds', async () => {
  let resolveTone;
  const harness = audioHarness({
    loadTone: (tone) =>
      new Promise((resolve) => {
        resolveTone = () => resolve(tone);
      }),
  });
  const { audio, toneNodes, notes, document, flushTransitions } = harness;
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    audio.birdChirp();
    audio.SND.thunder();
    const pending = audio.initAudio();
    for (let turn = 0; turn < 5 && !resolveTone; turn++) await Promise.resolve();
    audio.birdChirp();
    audio.cricketChirp();
    audio.owlHoot();
    audio.SND.thunder();
    audio.ambTick(60);
    assert.equal(toneNodes.length, 0);
    resolveTone();
    await pending;
    const baseline = toneNodes.length;
    assert.equal(notes.length, 0, 'startup does not replay missed cues');
    document.visibilityState = 'hidden';
    document.dispatch('visibilitychange');
    await flushTransitions();
    for (let frame = 0; frame < 600; frame++) audio.ambTick(0.1);
    audio.birdChirp();
    audio.SND.thunder();
    assert.equal(toneNodes.length, baseline);
    document.visibilityState = 'visible';
    document.dispatch('visibilitychange');
    await flushTransitions();
    await audio.initAudio();
    audio.ambTick(0.1);
    assert.equal(notes.length, 0, 'returning to the page does not catch up wildlife');
    assert.equal(toneNodes.length, baseline, 'resume reuses the same continuous sources');
    audio.setMuted(true);
    audio.birdChirp();
    audio.cricketChirp();
    audio.owlHoot();
    audio.SND.thunder();
    assert.equal(toneNodes.length, baseline, 'master mute allocates no one-shot resources');
    audio.setMuted(false);
    audio.rainAmt = () => 0.8;
    for (let frame = 0; frame < 600; frame++) audio.ambTick(0.1);
    assert.equal(toneNodes.length, baseline, 'continuous sources do not accumulate over time');
  } finally {
    Math.random = originalRandom;
  }
});

test('partial ambient startup disposes every owned source and retry installs one graph', async () => {
  let fail = true;
  const { audio, toneNodes, contexts, notes } = audioHarness({
    loadTone(tone) {
      const Noise = tone.Noise;
      return Promise.resolve({
        ...tone,
        Noise: class extends Noise {
          start(time) {
            super.start(time);
            if (fail && this.options.playbackRate === 1.3) throw new Error('rain source failed');
            return this;
          }
        },
      });
    },
  });
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'failed');
  assert.ok(
    toneNodes.every((node) => node.disposed),
    'partial sources and their filters are released',
  );
  assert.equal(contexts[0].state, 'closed');
  const failed = toneNodes.length;
  audio.birdChirp();
  audio.SND.thunder();
  assert.equal(toneNodes.length, failed);
  fail = false;
  await audio.initAudio();
  assert.equal(audio.audioPhase, 'ready');
  assert.equal(
    toneNodes.filter((node) => node.type === 'tone-noise-source' && !node.disposed).length,
    3,
  );
  assert.equal(toneNodes.filter((node) => node.type === 'tone-lfo' && !node.disposed).length, 2);
  assert.equal(notes.length, 0);
  await audio.initAudio();
  assert.equal(
    contexts.length,
    2,
    'explicit startup on the ready graph does not duplicate sources',
  );
  assert.equal(audio.msgs.filter((message) => message.t.includes('Audio unavailable')).length, 1);
});
