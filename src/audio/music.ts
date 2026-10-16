import type { GameRuntime } from '../runtime.ts';
import { bellOptions } from './bell-options.ts';
import { ingredientShortages } from '../gameplay/production-rules.ts';
import type { AudioGraph, AudioRuntime, Disposable } from './audio-runtime.ts';
import type {
  AudioInternals,
  MusicTheme,
  MusicChord,
  MusicColonyState,
  MusicArrangement,
} from './audio-types.ts';
export function createMusic(game: GameRuntime, runtime: AudioRuntime, internals?: AudioInternals) {
  let graph: AudioGraph | null = null;
  const voices = new Set<Disposable>();
  // ---------- MUSIC ----------
  // Three 48-bar themes form a roughly four-and-a-half minute pastoral suite.
  // Every theme has an introduction, two melodic phrases, an eight-bar stretch of
  // just the landscape, and a quiet return. The arrangement changes only at
  // eight-bar boundaries; a transient delivery shortage cannot chop up a melody.
  const TEMPO = 96,
    EI = 60 / TEMPO / 2,
    BAR = EI * 6,
    MUSIC_THEME_BARS = 48,
    MUSIC_PHRASE_BARS = 8;
  const PROG = [
    { r: 38, pad: [50, 53, 57] },
    { r: 46, pad: [46, 50, 53] },
    { r: 41, pad: [45, 53, 57] },
    { r: 48, pad: [48, 52, 55] },
    { r: 38, pad: [50, 53, 57] },
    { r: 46, pad: [46, 50, 53] },
    { r: 43, pad: [43, 46, 50] },
    { r: 45, pad: [45, 52, 57] },
    { r: 41, pad: [53, 57, 60] },
    { r: 48, pad: [52, 55, 60] },
    { r: 38, pad: [50, 53, 57] },
    { r: 46, pad: [46, 50, 53] },
    { r: 41, pad: [53, 57, 60] },
    { r: 48, pad: [52, 55, 60] },
    { r: 43, pad: [43, 46, 50] },
    { r: 45, pad: [45, 52, 57] },
  ];
  const MOTIFS = [
    [0, -1, 1, 2, -1, 3],
    [3, 2, 1, 0, -1, -1],
    [0, -1, 2, -1, 1, 3],
    [-1, 4, 3, 2, -1, 1],
    [2, 3, -1, 1, 0, -1],
    [0, 3, -1, 2, 1, -1],
  ];
  const SCALE = [62, 64, 65, 67, 69, 72, 74, 77, 79];
  const MUSIC_THEMES = [
    {
      name: 'Meadow',
      harmony: PROG,
      melody: [62, 65, 69, 67, 65, 64, 62, -1, 65, 69, 74, 72, 69, 67, 65, -1],
      brightness: 1600,
      lute: 1,
    },
    {
      name: 'River',
      harmony: [
        { r: 43, pad: [50, 53, 58] },
        { r: 38, pad: [50, 53, 57] },
        { r: 46, pad: [46, 53, 58] },
        { r: 41, pad: [48, 53, 57] },
        { r: 43, pad: [50, 53, 58] },
        { r: 48, pad: [48, 52, 55] },
        { r: 46, pad: [46, 50, 53] },
        { r: 45, pad: [45, 52, 57] },
        { r: 38, pad: [50, 53, 57] },
        { r: 41, pad: [48, 53, 57] },
        { r: 43, pad: [50, 53, 58] },
        { r: 46, pad: [50, 53, 58] },
        { r: 38, pad: [50, 53, 57] },
        { r: 48, pad: [48, 52, 55] },
        { r: 45, pad: [45, 52, 57] },
        { r: 38, pad: [50, 53, 57] },
      ],
      melody: [67, -1, 69, 65, 64, -1, 62, -1, 65, 67, 69, -1, 67, 64, 62, -1],
      brightness: 1350,
      lute: 0.78,
    },
    {
      name: 'Hillside',
      harmony: [
        { r: 41, pad: [53, 57, 60] },
        { r: 48, pad: [52, 55, 60] },
        { r: 46, pad: [50, 53, 58] },
        { r: 41, pad: [48, 53, 57] },
        { r: 38, pad: [50, 53, 57] },
        { r: 43, pad: [50, 53, 58] },
        { r: 48, pad: [48, 52, 55] },
        { r: 41, pad: [53, 57, 60] },
        { r: 46, pad: [50, 53, 58] },
        { r: 41, pad: [53, 57, 60] },
        { r: 48, pad: [52, 55, 60] },
        { r: 38, pad: [50, 53, 57] },
        { r: 43, pad: [50, 53, 58] },
        { r: 46, pad: [50, 53, 58] },
        { r: 45, pad: [45, 52, 57] },
        { r: 38, pad: [50, 53, 57] },
      ],
      melody: [69, 72, 74, 72, 69, 67, 65, -1, 72, 74, 77, 74, 72, 69, 65, -1],
      brightness: 1850,
      lute: 0.92,
    },
  ];
  function themeAt(bar: number): MusicTheme {
    return MUSIC_THEMES[Math.floor(bar / MUSIC_THEME_BARS) % MUSIC_THEMES.length];
  }
  function chordAt(bar: number): MusicChord {
    const theme = themeAt(bar);
    return theme.harmony[bar % theme.harmony.length];
  }
  function starvingCount() {
    let n = 0;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || !sp.in || b.exhausted || b.disabled) continue;
      if (ingredientShortages(b, sp).length) n++;
    }
    return n;
  }
  function musicColony(): MusicColonyState {
    let active = 0,
      inputCount = 0;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        sp = game.BSPEC[b.type];
      // A reported quarry exhaustion stays silent until successful production clears it.
      if (
        !b.done ||
        sp.store ||
        sp.prod === 'none' ||
        b.exhausted ||
        b.rocksExhaustedNoticeSent ||
        b.disabled
      )
        continue;
      if (sp.in) {
        inputCount++;
        // Consumed inputs still count while the current production cycle runs.
        if (ingredientShortages(b, sp).length && b.timer <= 1.5) continue;
      }
      if (b.blockedReason) continue;
      active++;
    }
    return {
      active: active,
      hungry: inputCount ? starvingCount() / inputCount : 0,
      night: game.nightAmt(),
      gold: Math.min(1, Math.max(0, game.state.gold / game.GOAL)),
    };
  }
  const musicArrangement: MusicArrangement = {
    bass: 0,
    flute: 0,
    drums: 0,
    hungry: 0,
    night: 0,
    gold: 0,
    active: 0,
    phrase: 0,
  };
  function updateMusicArrangement(bar: number) {
    const colony = musicColony(),
      a = musicArrangement,
      blend = 0.45;
    const target = {
      bass: Math.min(1, colony.active / 6),
      flute: Math.max(0, Math.min(1, (colony.active - 2) / 5)),
      drums: Math.max(0, Math.min(1, (colony.active - 6) / 6)),
      hungry: colony.hungry,
      night: colony.night,
      gold: colony.gold,
    };
    for (const key in target)
      a[key as keyof typeof target] +=
        (target[key as keyof typeof target] - a[key as keyof typeof target]) * blend;
    a.active = colony.active;
    a.phrase = bar;
  }
  function scheduleBar(bar: number, t0: number) {
    if (bar % MUSIC_PHRASE_BARS === 0) updateMusicArrangement(bar);
    const local = bar % MUSIC_THEME_BARS,
      theme = themeAt(bar),
      ch = chordAt(bar),
      a = musicArrangement;
    // Full musical silence leaves birds, water, rain and wind room to breathe.
    if (local >= 32 && local < 40) return;
    const returnPhrase = local >= 40,
      texture = returnPhrase ? 0.55 : local < 8 ? 0.75 : 1;
    const rnd = game.mulberry32(bar * 97 + ((game.seed % 1000) | 0)),
      phraseBar = local % 8;
    if (bar % 2 === 0) padChord(t0, ch.pad, BAR * 2 * 0.98, texture);
    if (bar % 2 === 0 && a.gold > 0.45)
      droneNote(t0, ch.r - 12, BAR * 2 * 0.98, (texture * (a.gold - 0.45)) / 0.55);
    if (a.bass > 0.12) {
      bassNote(t0, ch.r, 0.09 * a.bass * texture);
      if (!returnPhrase && rnd() < 0.4) bassNote(t0 + EI * 3, ch.r, 0.055 * a.bass);
    }
    const mot = MOTIFS[(rnd() * MOTIFS.length) | 0],
      tones = ch.pad;
    for (let s = 0; s < 6; s++) {
      const d = mot[s];
      if (d < 0 || (returnPhrase && s !== 0 && s !== 3)) continue;
      let m = tones[d % tones.length] + 12 * (d >= tones.length ? 1 : 0);
      if (rnd() < 0.08) m += 12;
      pluck(
        t0 + s * EI + (s === 5 ? EI * 0.06 : 0),
        m,
        (0.052 + rnd() * 0.025) * texture * theme.lute,
        ((s % 3) - 1) * 0.3,
        theme.brightness + ((s * 7 + bar) % 5) * 100,
      );
      if (local >= 16 && local < 24 && rnd() < 0.14)
        pluck(
          t0 + s * EI + EI * 0.5,
          SCALE[(rnd() * SCALE.length) | 0],
          0.02,
          s % 2 ? 0.4 : -0.4,
          1300,
        );
    }
    // The two melodic phrases answer one another and end with an entire rest bar.
    if (local >= 8 && local < 32 && a.flute > 0.08 && phraseBar !== 7) {
      const melodyIndex = (phraseBar * 2 + (local >= 24 ? 2 : 0)) % theme.melody.length;
      const fluteLevel = 0.043 * a.flute * (1 - a.hungry * 0.55) * texture;
      let note = theme.melody[melodyIndex];
      if (note > 0) fluteNote(t0, note, EI * 2.2, fluteLevel, -0.22);
      note = theme.melody[(melodyIndex + 1) % theme.melody.length];
      if (note > 0 && phraseBar % 2 === 0)
        fluteNote(t0 + EI * 3, note, EI * 2.1, fluteLevel * 0.8, 0.22);
    }
    const percussion = a.drums * (1 - a.night * 0.95);
    if (!returnPhrase && local >= 16 && percussion > 0.08) {
      thumpMusic(t0, 0.08 * percussion);
      thumpMusic(t0 + EI * 3, 0.05 * percussion);
      tickT(t0 + EI * 2, 0.016 * percussion);
      tickT(t0 + EI * 5, 0.014 * percussion);
    }
    if (phraseBar === 7 && local < 32) {
      bellTone(t0, mtof(ch.pad[0] + 12), 0.02, 2.4, 0);
      // Alternate phrase turns use a short dulcimer response rather than a flourish
      // every few seconds. Its timbre remains a highlight throughout a long game.
      if (local % 16 === 15) {
        dulcimer(t0, ch.pad[0] + 12, 0.04, -0.25);
        dulcimer(t0 + EI, ch.pad[1] + 12, 0.035, 0.1);
        dulcimer(t0 + EI * 2, ch.pad[2] + 12, 0.04, 0.25);
      }
    }
    if (a.gold > 0.25 && local < 32 && bar % 8 === 4 && rnd() < a.gold)
      bellTone(t0, mtof(SCALE[(rnd() * SCALE.length) | 0] + 12), 0.011, 1.6, (rnd() - 0.5) * 0.5);
  }
  // Tone owns each finite voice's oscillators, envelopes and filters. Ownership
  // wrappers also let a hidden page cancel notes already scheduled within a bar.
  function ownVoice<T extends Disposable>(node: T, resources: Disposable[]): T {
    let disposed = false;
    const owner = runtime.own({
      dispose() {
        if (disposed) return;
        disposed = true;
        voices.delete(owner);
        node.dispose();
      },
    });
    voices.add(owner);
    resources.push(owner);
    return node;
  }
  interface ScoreInstrument extends Disposable {
    connect(
      destination: AudioGraph['channels']['music'] | InstanceType<AudioGraph['tone']['Panner']>,
    ): unknown;
    triggerAttackRelease(
      frequency: number,
      duration: number,
      time: number,
      velocity: number,
    ): unknown;
  }
  function note(
    t0: number,
    frequency: number,
    duration: number,
    velocity: number,
    pan: number,
    release: number,
    create: (owner: AudioGraph) => ScoreInstrument,
  ) {
    if (!graph) return;
    const resources: Disposable[] = [];
    const panner = ownVoice(new graph.tone.Panner({ context: graph.context, pan }), resources);
    panner.connect(graph.channels.music);
    const instrument = ownVoice(create(graph), resources);
    instrument.connect(panner);
    instrument.triggerAttackRelease(frequency, duration, t0, velocity);
    runtime.releaseAt(t0 + duration + release + 0.1, resources);
  }
  function mtof(midi: number) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function pluck(t0: number, midi: number, velocity: number, pan: number, brightness: number) {
    note(
      t0,
      mtof(midi),
      0.5,
      velocity,
      pan,
      0.08,
      ({ tone, context }) =>
        new tone.MonoSynth({
          context,
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.004, decay: 0.42, sustain: 0, release: 0.08 },
          filter: { type: 'lowpass', Q: 1.1 },
          filterEnvelope: {
            attack: 0.001,
            decay: 0.5,
            sustain: 0,
            release: 0.08,
            baseFrequency: 500,
            octaves: Math.log2(brightness / 500),
          },
        }),
    );
  }
  function fluteNote(t0: number, midi: number, duration: number, velocity: number, pan: number) {
    const frequency = mtof(midi);
    note(
      t0,
      frequency,
      duration,
      velocity,
      pan,
      0.15,
      ({ tone, context }) =>
        new tone.FMSynth({
          context,
          oscillator: { type: 'sine' },
          modulation: { type: 'sine' },
          harmonicity: 5.2 / frequency,
          // Tone attenuates its FM carrier/modulator by 10 dB internally.
          volume: 10,
          modulationIndex: 0.006 / (velocity * Math.pow(10, -0.5)),
          envelope: { attack: 0.09, decay: 0.01, sustain: 1, release: 0.15 },
          modulationEnvelope: { attack: 0.35, decay: 0.01, sustain: 1, release: 0.15 },
        }),
    );
  }
  function padChord(t0: number, midis: number[], duration: number, level = 1) {
    for (const midi of midis)
      note(
        t0,
        mtof(midi),
        duration - 0.7,
        0.021 * level,
        0,
        1.3,
        ({ tone, context }) =>
          new tone.Synth({
            context,
            oscillator: { type: 'custom', partials: [1, 0.22] },
            envelope: { attack: 1.1, decay: 0.01, sustain: 1, release: 1.3 },
          }),
      );
  }
  function bassNote(t0: number, midi: number, velocity: number) {
    note(
      t0,
      mtof(midi),
      1.1,
      velocity,
      0,
      0.1,
      ({ tone, context }) =>
        new tone.Synth({
          context,
          oscillator: { type: 'custom', partials: [1, 0.22] },
          envelope: { attack: 0.02, decay: 1.1, sustain: 0, release: 0.1 },
        }),
    );
  }
  function dulcimer(t0: number, midi: number, velocity: number, pan: number) {
    note(
      t0,
      mtof(midi),
      0.55,
      velocity,
      pan,
      0.05,
      ({ tone, context }) =>
        new tone.MonoSynth({
          context,
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.05 },
          filter: { type: 'lowpass', Q: 0.9 },
          filterEnvelope: {
            attack: 0.001,
            decay: 0.55,
            sustain: 0,
            release: 0.05,
            baseFrequency: 800,
            octaves: Math.log2(3400 / 800),
          },
        }),
    );
  }
  function droneNote(t0: number, midi: number, duration: number, level = 1) {
    note(
      t0,
      mtof(midi),
      duration * 0.7,
      0.024 * level,
      0,
      duration * 0.3,
      ({ tone, context }) =>
        new tone.Synth({
          context,
          oscillator: { type: 'fatsine', count: 2, spread: 5 },
          envelope: { attack: duration * 0.35, decay: 0.01, sustain: 1, release: duration * 0.3 },
        }),
    );
  }
  function bellTone(
    t0: number,
    frequency: number,
    velocity: number,
    duration: number,
    pan: number,
  ) {
    note(
      t0,
      frequency,
      duration,
      velocity,
      pan,
      0.1,
      ({ tone, context }) =>
        new tone.FMSynth({
          context,
          ...bellOptions(velocity, duration, 0.1, 0.1),
        }),
    );
  }
  function thumpMusic(t0: number, velocity: number) {
    note(
      t0,
      52,
      0.13,
      velocity,
      0,
      0.07,
      ({ tone, context }) =>
        new tone.MembraneSynth({
          context,
          pitchDecay: 0.1,
          // Tone's parameter is a frequency multiplier despite its name.
          octaves: 95 / 52,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.07 },
        }),
    );
  }
  function tickT(t0: number, velocity: number) {
    if (!graph) return;
    const resources: Disposable[] = [];
    const filter = ownVoice(
      new graph.tone.Filter({ context: graph.context, type: 'highpass', frequency: 6200, Q: 1 }),
      resources,
    );
    filter.connect(graph.channels.music);
    const noise = ownVoice(
      new graph.tone.NoiseSynth({
        context: graph.context,
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
      }),
      resources,
    );
    noise.connect(filter);
    noise.triggerAttackRelease(0.03, t0, velocity);
    runtime.releaseAt(t0 + 0.1, resources);
  }
  let musicBar = 0;
  let musicSchedule: number | null = null;
  let scheduleGeneration = 0;

  function suspend() {
    scheduleGeneration++;
    if (graph) {
      const transport = graph.context.transport;
      if (musicSchedule !== null) transport.clear(musicSchedule);
      transport.stop(runtime.immediate());
    }
    musicSchedule = null;
    for (const voice of [...voices]) voice.dispose();
    musicBar = Math.ceil(musicBar / MUSIC_PHRASE_BARS) * MUSIC_PHRASE_BARS;
  }
  function resume() {
    if (!graph || !runtime.canPlay('music') || musicSchedule !== null) return;
    const owner = graph;
    const generation = ++scheduleGeneration;
    const transport = owner.context.transport;
    transport.bpm.value = TEMPO;
    transport.timeSignature = 3;
    musicSchedule = transport.scheduleRepeat(
      (time) =>
        runtime.guard(() => {
          if (graph !== owner || generation !== scheduleGeneration || !runtime.canPlay('music'))
            return;
          // An interrupted browser clock may deliver old callbacks. Drop the old
          // schedule entirely; the replacement begins at one fresh phrase boundary.
          if (time < runtime.immediate()) {
            suspend();
            resume();
            return;
          }
          scheduleBar(musicBar, time);
          musicBar++;
        }),
      BAR,
      0,
    );
    transport.start(runtime.immediate() + Math.max(0.25, owner.context.lookAhead + 0.05), 0);
  }
  if (internals) {
    Object.assign(internals, {
      themeAt,
      scheduleBar,
      musicColony,
      starvingCount,
      musicArrangement,
    });
    Object.defineProperties(internals, {
      BAR: { get: () => BAR, enumerable: true },
      musicBar: {
        get: () => musicBar,
        set: (v: number) => {
          musicBar = v;
        },
        enumerable: true,
      },
      musicSchedule: { get: () => musicSchedule, enumerable: true },
    });
  }
  return {
    start(nextGraph: AudioGraph) {
      graph = nextGraph;
    },
    suspend,
    resume,
    dispose() {
      suspend();
      graph = null;
    },
  };
}
