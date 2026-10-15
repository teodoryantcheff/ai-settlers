import type { GameRuntime } from '../runtime.ts';
import { ingredientShortages } from '../gameplay/production-rules.ts';
import type { AudioGraph, AudioRuntime } from './audio-runtime.ts';
import type {
  AudioInternals,
  MusicTheme,
  MusicChord,
  MusicColonyState,
  MusicArrangement,
} from './audio-types.ts';
import { getLegacyBridge, type LegacyBridge } from './legacy-bridge.ts';
export function createMusic(game: GameRuntime, runtime: AudioRuntime, internals?: AudioInternals) {
  let bridge: LegacyBridge = null;
  // ---------- MUSIC ----------
  // Three 48-bar themes form a roughly four-and-a-half minute pastoral suite.
  // Every theme has an introduction, two melodic phrases, an eight-bar stretch of
  // just the landscape, and a quiet return. The arrangement changes only at
  // eight-bar boundaries; a transient delivery shortage cannot chop up a melody.
  var TEMPO = 96,
    EI = 60 / TEMPO / 2,
    BAR = EI * 6,
    MUSIC_THEME_BARS = 48,
    MUSIC_PHRASE_BARS = 8;
  var PROG = [
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
  var MOTIFS = [
    [0, -1, 1, 2, -1, 3],
    [3, 2, 1, 0, -1, -1],
    [0, -1, 2, -1, 1, 3],
    [-1, 4, 3, 2, -1, 1],
    [2, 3, -1, 1, 0, -1],
    [0, 3, -1, 2, 1, -1],
  ];
  var SCALE = [62, 64, 65, 67, 69, 72, 74, 77, 79];
  var MUSIC_THEMES = [
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
    var theme = themeAt(bar);
    return theme.harmony[bar % theme.harmony.length];
  }
  function starvingCount() {
    var n = 0;
    for (var i = 0; i < game.buildings.length; i++) {
      var b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || !sp.in || b.exhausted || b.disabled) continue;
      if (ingredientShortages(b, sp).length) n++;
    }
    return n;
  }
  function musicColony(): MusicColonyState {
    var active = 0,
      inputCount = 0;
    for (var i = 0; i < game.buildings.length; i++) {
      var b = game.buildings[i],
        sp = game.BSPEC[b.type];
      if (!b.done || sp.store || sp.prod === 'none' || b.exhausted || b.norock || b.disabled)
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
  var musicArrangement: MusicArrangement = {
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
    var colony = musicColony(),
      a = musicArrangement,
      blend = 0.45;
    var target = {
      bass: Math.min(1, colony.active / 6),
      flute: Math.max(0, Math.min(1, (colony.active - 2) / 5)),
      drums: Math.max(0, Math.min(1, (colony.active - 6) / 6)),
      hungry: colony.hungry,
      night: colony.night,
      gold: colony.gold,
    };
    for (var key in target)
      a[key as keyof typeof target] +=
        (target[key as keyof typeof target] - a[key as keyof typeof target]) * blend;
    a.active = colony.active;
    a.phrase = bar;
  }
  function scheduleBar(bar: number, t0: number) {
    if (bar % MUSIC_PHRASE_BARS === 0) updateMusicArrangement(bar);
    var local = bar % MUSIC_THEME_BARS,
      theme = themeAt(bar),
      ch = chordAt(bar),
      a = musicArrangement;
    // Full musical silence leaves birds, water, rain and wind room to breathe.
    if (local >= 32 && local < 40) return;
    var returnPhrase = local >= 40,
      texture = returnPhrase ? 0.55 : local < 8 ? 0.75 : 1;
    var rnd = game.mulberry32(bar * 97 + ((game.seed % 1000) | 0)),
      phraseBar = local % 8;
    if (bar % 2 === 0) bridge.padChord(t0, ch.pad, BAR * 2 * 0.98, texture);
    if (bar % 2 === 0 && a.gold > 0.45)
      bridge.droneNote(t0, ch.r - 12, BAR * 2 * 0.98, (texture * (a.gold - 0.45)) / 0.55);
    if (a.bass > 0.12) {
      bridge.bassNote(t0, ch.r, 0.09 * a.bass * texture);
      if (!returnPhrase && rnd() < 0.4) bridge.bassNote(t0 + EI * 3, ch.r, 0.055 * a.bass);
    }
    var mot = MOTIFS[(rnd() * MOTIFS.length) | 0],
      tones = ch.pad;
    for (var s = 0; s < 6; s++) {
      var d = mot[s];
      if (d < 0 || (returnPhrase && s !== 0 && s !== 3)) continue;
      var m = tones[d % tones.length] + 12 * (d >= tones.length ? 1 : 0);
      if (rnd() < 0.08) m += 12;
      bridge.pluck(
        t0 + s * EI + (s === 5 ? EI * 0.06 : 0),
        m,
        (0.052 + rnd() * 0.025) * texture * theme.lute,
        ((s % 3) - 1) * 0.3,
        theme.brightness + ((s * 7 + bar) % 5) * 100,
      );
      if (local >= 16 && local < 24 && rnd() < 0.14)
        bridge.pluck(
          t0 + s * EI + EI * 0.5,
          SCALE[(rnd() * SCALE.length) | 0],
          0.02,
          s % 2 ? 0.4 : -0.4,
          1300,
        );
    }
    // The two melodic phrases answer one another and end with an entire rest bar.
    if (local >= 8 && local < 32 && a.flute > 0.08 && phraseBar !== 7) {
      var melodyIndex = (phraseBar * 2 + (local >= 24 ? 2 : 0)) % theme.melody.length;
      var fluteLevel = 0.043 * a.flute * (1 - a.hungry * 0.55) * texture;
      var note = theme.melody[melodyIndex];
      if (note > 0) bridge.fluteNote(t0, note, EI * 2.2, fluteLevel, -0.22);
      note = theme.melody[(melodyIndex + 1) % theme.melody.length];
      if (note > 0 && phraseBar % 2 === 0)
        bridge.fluteNote(t0 + EI * 3, note, EI * 2.1, fluteLevel * 0.8, 0.22);
    }
    var percussion = a.drums * (1 - a.night * 0.95);
    if (!returnPhrase && local >= 16 && percussion > 0.08) {
      thumpMusic(t0, 0.08 * percussion);
      thumpMusic(t0 + EI * 3, 0.05 * percussion);
      tickT(t0 + EI * 2, 0.016 * percussion);
      tickT(t0 + EI * 5, 0.014 * percussion);
    }
    if (phraseBar === 7 && local < 32) {
      bridge.bellTone(bridge.gMusic, t0, bridge.mtof(ch.pad[0] + 12), 0.02, 2.4, 0);
      // Alternate phrase turns use a short bridge.dulcimer response rather than a flourish
      // every few seconds. Its timbre remains a highlight throughout a long game.
      if (local % 16 === 15) {
        bridge.dulcimer(t0, ch.pad[0] + 12, 0.04, -0.25);
        bridge.dulcimer(t0 + EI, ch.pad[1] + 12, 0.035, 0.1);
        bridge.dulcimer(t0 + EI * 2, ch.pad[2] + 12, 0.04, 0.25);
      }
    }
    if (a.gold > 0.25 && local < 32 && bar % 8 === 4 && rnd() < a.gold)
      bridge.bellTone(
        bridge.gMusic,
        t0,
        bridge.mtof(SCALE[(rnd() * SCALE.length) | 0] + 12),
        0.011,
        1.6,
        (rnd() - 0.5) * 0.5,
      );
  }
  function thumpMusic(t0: number, vel: number) {
    var o = bridge.AC.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t0);
    o.frequency.exponentialRampToValueAtTime(52, t0 + 0.1);
    var gn = bridge.AC.createGain();
    gn.gain.setValueAtTime(vel, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(gn);
    gn.connect(bridge.gMusic);
    o.start(t0);
    o.stop(t0 + 0.2);
    bridge.disposeAudio([o], [gn]);
  }
  function tickT(t0: number, vel: number) {
    bridge.playNoise(bridge.gMusic, t0, 0.03, 'highpass', 6200, 0, vel, 1);
  }
  var musicNext = 0,
    musicBar = 0,
    musicTimer: ReturnType<typeof setInterval> = null;

  function suspend() {
    if (musicTimer !== null) clearInterval(musicTimer);
    musicTimer = null;
    musicBar = Math.ceil(musicBar / MUSIC_PHRASE_BARS) * MUSIC_PHRASE_BARS;
  }
  function resume() {
    if (!runtime.canPlay('music') || musicTimer !== null) return;
    musicNext = runtime.immediate() + 0.25;
    musicTimer = setInterval(
      () =>
        runtime.guard(() => {
          if (!runtime.canPlay('music')) return;
          if (musicNext < runtime.immediate()) {
            musicNext = runtime.immediate() + 0.15;
            musicBar = Math.ceil(musicBar / MUSIC_PHRASE_BARS) * MUSIC_PHRASE_BARS;
          }
          while (musicNext < runtime.immediate() + 0.4) {
            scheduleBar(musicBar, musicNext);
            musicNext += BAR;
            musicBar++;
          }
        }),
      90,
    );
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
      musicNext: {
        get: () => musicNext,
        set: (v: number) => {
          musicNext = v;
        },
        enumerable: true,
      },
      musicBar: {
        get: () => musicBar,
        set: (v: number) => {
          musicBar = v;
        },
        enumerable: true,
      },
      musicTimer: { get: () => musicTimer, enumerable: true },
    });
  }
  return {
    start(graph: AudioGraph) {
      bridge = getLegacyBridge(graph);
    },
    suspend,
    resume,
    dispose() {
      suspend();
      bridge = null;
    },
  };
}
