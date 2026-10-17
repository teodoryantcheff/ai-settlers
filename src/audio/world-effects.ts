import { observePresentation } from '../ui/domain-feedback.ts';
import { bellOptions } from './bell-options.ts';
import type { GameRuntime } from '../runtime.ts';
import type { BuildingType } from '../types.ts';
import type { AudioGraph, AudioRuntime, Disposable } from './audio-runtime.ts';
import type { AudioInternals, IndustrialVoice, SoundCatalog } from './audio-types.ts';
import type { Panner } from 'tone/build/esm/classes.js';
type WorldSounds = Omit<SoundCatalog, 'ui' | 'tick' | 'uiOpen' | 'fail' | 'thunder'>;
export function createWorldEffects(
  game: GameRuntime,
  runtime: AudioRuntime,
  internals?: AudioInternals,
) {
  let graph: AudioGraph | null = null;
  let audioWorkBound = false;
  const sfxCanPlay = () => runtime.canPlay('effects');
  function panOf(wx: number) {
    if (!graph) return 0;
    const cx = game.cam.x + game.vw / 2 / game.z,
      half = game.vw / 2 / game.z;
    const p = (wx * game.TS - cx) / half;
    return Math.max(-0.75, Math.min(0.75, p * 0.55));
  }
  interface Cue {
    graph: AudioGraph;
    time: number;
    output: Panner;
    resources: Disposable[];
    until: number;
  }
  function own<T extends Disposable>(cue: Cue, resource: T): T {
    runtime.own(resource);
    cue.resources.push(resource);
    return resource;
  }
  function play(pan: number, build: (cue: Cue) => void, at?: number) {
    if (!graph || !sfxCanPlay()) return;
    const owner = graph;
    runtime.guard(() => {
      const time = at ?? runtime.immediate();
      const output = runtime.own(new owner.tone.Panner({ context: owner.context, pan }));
      const cue: Cue = { graph: owner, time, output, resources: [output], until: time };
      output.connect(owner.channels.effects);
      build(cue);
      runtime.releaseAt(cue.until, cue.resources);
    });
  }
  function note(
    cue: Cue,
    time: number,
    frequency: number,
    duration: number,
    velocity: number,
    type: 'sine' | 'triangle' | 'sawtooth' = 'triangle',
    to = frequency,
    attack = 0.008,
    cutoff = 0,
  ) {
    const synth = own(
      cue,
      new cue.graph.tone.Synth({
        context: cue.graph.context,
        oscillator: { type },
        envelope: { attack, decay: Math.max(0.01, duration - attack), sustain: 0, release: 0.025 },
      }),
    );
    if (cutoff) {
      const filter = own(
        cue,
        new cue.graph.tone.Filter({
          context: cue.graph.context,
          type: 'lowpass',
          frequency: cutoff,
        }),
      );
      synth.connect(filter);
      filter.connect(cue.output);
    } else synth.connect(cue.output);
    synth.triggerAttackRelease(frequency, duration, time, velocity);
    if (to !== frequency) synth.frequency.exponentialRampToValueAtTime(to, time + duration);
    cue.until = Math.max(cue.until, time + duration + 0.1);
  }
  function noise(
    cue: Cue,
    time: number,
    duration: number,
    type: BiquadFilterType,
    frequency: number,
    to: number,
    velocity: number,
    Q = 0.8,
    attack = 0.001,
  ) {
    const synth = own(
      cue,
      new cue.graph.tone.NoiseSynth({
        context: cue.graph.context,
        noise: { type: 'white' },
        envelope: { attack, decay: Math.max(0.01, duration - attack), sustain: 0, release: 0.02 },
      }),
    );
    const filter = own(
      cue,
      new cue.graph.tone.Filter({
        context: cue.graph.context,
        type,
        frequency,
        Q,
      }),
    );
    synth.connect(filter);
    filter.connect(cue.output);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, time + duration);
    synth.triggerAttackRelease(duration, time, velocity);
    cue.until = Math.max(cue.until, time + duration + 0.1);
    return filter;
  }
  function thump(cue: Cue, time: number, pitch: number, velocity: number) {
    const synth = own(
      cue,
      new cue.graph.tone.MembraneSynth({
        context: cue.graph.context,
        oscillator: { type: 'sine' },
        pitchDecay: 0.11,
        octaves: 1 / 0.35,
        envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.03 },
      }),
    );
    synth.connect(cue.output);
    synth.triggerAttackRelease(pitch * 0.35, 0.14, time, velocity);
    noise(cue, time, 0.045, 'lowpass', 900, 300, velocity * 0.7, 0.6);
    cue.until = Math.max(cue.until, time + 0.2);
  }
  function melodic(cue: Cue, time: number, midi: number, velocity: number, brass = false) {
    const duration = brass ? 0.6 : 0.5;
    const synth = own(
      cue,
      new cue.graph.tone.MonoSynth({
        context: cue.graph.context,
        oscillator: brass ? { type: 'fatsawtooth', count: 2, spread: 8 } : { type: 'triangle' },
        envelope: { attack: brass ? 0.03 : 0.004, decay: duration, sustain: 0, release: 0.05 },
        filter: { type: 'lowpass', Q: 1 },
        filterEnvelope: {
          attack: 0.002,
          decay: duration,
          sustain: 0,
          release: 0.05,
          baseFrequency: 500,
          octaves: brass ? 2.3 : 2.14,
        },
      }),
    );
    synth.connect(cue.output);
    synth.triggerAttackRelease(440 * Math.pow(2, (midi - 69) / 12), duration, time, velocity);
    cue.until = Math.max(cue.until, time + duration + 0.1);
  }
  function bell(cue: Cue, time: number, frequency: number, duration: number, velocity: number) {
    const synth = own(
      cue,
      new cue.graph.tone.FMSynth({
        context: cue.graph.context,
        ...bellOptions(velocity, duration, 0.05, 0.02),
      }),
    );
    synth.connect(cue.output);
    synth.triggerAttackRelease(frequency, duration, time, velocity);
    cue.until = Math.max(cue.until, time + duration + 0.1);
  }
  function bindWorkAudio() {
    if (audioWorkBound) return;
    observePresentation(game, 'goodsProduced', function (event) {
      const b = event.building;
      const method = (
        {
          lumberjack: 'chop',
          sawmill: 'saw',
          quarry: 'clang',
          toolsmith: 'forge',
          smelter: 'forge',
          workshop: 'saw',
          windmill: 'saw',
          armory: 'forge',
          mine_coal: 'clang',
          mine_iron: 'clang',
          mine_gold: 'clang',
        } as Partial<Record<BuildingType, 'chop' | 'saw' | 'clang' | 'forge'>>
      )[b.type];
      if (method) game.SND[method](b.x, b.y);
    });
    observePresentation(game, 'firstGold', function (event) {
      const b = event.building;
      if (b) game.SND.coin(b.x, b.y);
    });
    audioWorkBound = true;
  }

  // ---------- designed SFX ----------
  // Limit work sounds by building and globally. Fast simulation and large
  // settlements should produce a readable soundscape, without allocating dozens
  // of simultaneous noise/oscillator graphs for every industrial cycle.
  let industrialVoices: IndustrialVoice[] = [],
    industrialLast: Record<string, number> = Object.create(null),
    industrialNext = 0;
  const INDUSTRIAL_MAX_VOICES = 6,
    INDUSTRIAL_SPACING = 0.07;
  function industrialAudio(
    kind: 'hammer' | 'chop' | 'saw' | 'clang' | 'forge',
    wx: number,
    wy: number,
    dur: number,
    t: number,
  ) {
    if (typeof wx === 'number' && typeof wy === 'number') {
      const margin = game.TS * 5;
      if (
        wx * game.TS < game.cam.x - margin ||
        wx * game.TS > game.cam.x + game.vw / game.z + margin ||
        wy * game.TS < game.cam.y - margin ||
        wy * game.TS > game.cam.y + game.vh / game.z + margin
      )
        return false;
    }
    industrialVoices = industrialVoices.filter(function (voice) {
      return voice.until > t;
    });
    for (const old in industrialLast) if (t - industrialLast[old] > 4) delete industrialLast[old];
    const key = kind + ':' + wx + ':' + wy;
    if (
      t < industrialNext ||
      industrialVoices.length >= INDUSTRIAL_MAX_VOICES ||
      (industrialLast[key] !== undefined && t - industrialLast[key] < Math.max(0.2, dur))
    )
      return false;
    industrialLast[key] = t;
    industrialNext = t + INDUSTRIAL_SPACING;
    industrialVoices.push({ until: t + dur });
    return true;
  }
  function work(
    kind: 'hammer' | 'chop' | 'saw' | 'clang' | 'forge',
    wx: number,
    wy: number,
    duration: number,
    build: (cue: Cue) => void,
  ) {
    if (!graph || !sfxCanPlay()) return;
    const time = runtime.immediate();
    if (industrialAudio(kind, wx, wy, duration, time)) play(panOf(wx), build, time);
  }
  const sounds: WorldSounds = {
    place() {
      play(0, (cue) => {
        thump(cue, cue.time, 150, 0.22);
        thump(cue, cue.time + 0.11, 120, 0.18);
        noise(cue, cue.time + 0.02, 0.08, 'bandpass', 2600, 1400, 0.05, 1.4);
      });
    },
    done() {
      play(0, (cue) => {
        melodic(cue, cue.time, 74, 0.12);
        melodic(cue, cue.time + 0.1, 77, 0.12);
        melodic(cue, cue.time + 0.2, 81, 0.13);
        bell(cue, cue.time + 0.3, 1760, 1.2, 0.05);
      });
    },
    demolish() {
      play(0, (cue) => {
        noise(cue, cue.time, 0.5, 'lowpass', 420, 90, 0.16, 0.5);
        thump(cue, cue.time + 0.05, 110, 0.2);
        noise(cue, cue.time + 0.18, 0.3, 'lowpass', 300, 90, 0.1, 0.5);
        noise(cue, cue.time, 0.06, 'highpass', 2500, 0, 0.06, 1);
      });
    },
    man() {
      play(0, (cue) => {
        note(cue, cue.time, 220, 0.5, 0.06, 'sawtooth', 228, 0.08, 1200);
        note(cue, cue.time, 330, 0.5, 0.06, 'sawtooth', 336, 0.08, 1200);
      });
    },
    gone() {
      play(0, (cue) => {
        note(cue, cue.time, 110, 0.5, 0.09, 'sine', 44);
        noise(cue, cue.time, 0.4, 'lowpass', 260, 80, 0.07, 0.6);
      });
    },
    road(n) {
      play(0, (cue) => {
        for (let i = 0; i < Math.min(6, n || 1); i++) {
          const time = cue.time + i * 0.055;
          noise(cue, time, 0.04, 'bandpass', 1200 + i * 60, 0, 0.05, 2);
          thump(cue, time, 190, 0.08);
        }
      });
    },
    coin(wx) {
      play(panOf(wx), (cue) => {
        bell(cue, cue.time, 1318, 0.7, 0.075);
        bell(cue, cue.time + 0.07, 1760, 0.8, 0.06);
        noise(cue, cue.time, 0.05, 'highpass', 6000, 0, 0.028, 1);
      });
    },
    chainStart(wx) {
      play(panOf(wx), (cue) => {
        note(cue, cue.time, 523, 0.12, 0.045);
        note(cue, cue.time + 0.1, 784, 0.2, 0.04);
      });
    },
    chainBlocked(wx) {
      play(panOf(wx), (cue) => {
        note(cue, cue.time, 233, 0.16, 0.04);
        note(cue, cue.time + 0.13, 196, 0.22, 0.035);
      });
    },
    chainRecovered(wx) {
      play(panOf(wx), (cue) => {
        bell(cue, cue.time, 659, 0.45, 0.035);
        bell(cue, cue.time + 0.12, 880, 0.55, 0.025);
      });
    },
    hammer(wx, wy) {
      work('hammer', wx, wy, 0.22, (cue) => {
        noise(cue, cue.time, 0.035, 'bandpass', 3000, 1200, 0.045, 2);
        thump(cue, cue.time, 210, 0.09);
      });
    },
    chop(wx, wy) {
      work('chop', wx, wy, 0.25, (cue) => {
        noise(cue, cue.time, 0.07, 'bandpass', 1300, 500, 0.07, 1.5);
        thump(cue, cue.time, 240, 0.1);
      });
    },
    saw(wx, wy) {
      work('saw', wx, wy, 0.5, (cue) => {
        noise(cue, cue.time, 0.3, 'bandpass', 1500, 650, 0.07, 1.4);
        note(cue, cue.time, 115, 0.28, 0.028, 'sawtooth', 88);
        noise(cue, cue.time + 0.31, 0.12, 'bandpass', 1100, 500, 0.045, 1.4);
      });
    },
    clang(wx, wy) {
      work('clang', wx, wy, 0.3, (cue) => {
        bell(cue, cue.time, 728, 0.14, 0.09);
        bell(cue, cue.time, 1097, 0.1, 0.045);
        thump(cue, cue.time, 320, 0.09);
        noise(cue, cue.time, 0.025, 'highpass', 4200, 0, 0.04, 1);
      });
    },
    forge(wx, wy) {
      work('forge', wx, wy, 0.75, (cue) => {
        const filter = noise(cue, cue.time, 0.5, 'lowpass', 700, 0, 0.055, 0.8, 0.18);
        filter.frequency.linearRampToValueAtTime(1600, cue.time + 0.22);
        filter.frequency.linearRampToValueAtTime(300, cue.time + 0.5);
        bell(cue, cue.time + 0.3, 1568, 0.4, 0.05);
        bell(cue, cue.time + 0.3, 2352, 0.28, 0.022);
      });
    },
    fanfare() {
      play(0, (cue) => {
        runtime.duckMusic(cue.time);
        const sequence = [
          [62, 0],
          [66, 0.16],
          [69, 0.32],
          [74, 0.5],
          [69, 0.85],
          [74, 1.05],
        ];
        for (const [midi, offset] of sequence) melodic(cue, cue.time + offset, midi, 0.085, true);
        bell(cue, cue.time + 1.3, 1174, 2.2, 0.09);
        bell(cue, cue.time + 1.42, 1760, 2.4, 0.07);
      });
    },
  };

  function resetWork() {
    industrialVoices = [];
    industrialLast = Object.create(null);
    industrialNext = 0;
  }
  if (internals)
    Object.defineProperty(internals, 'industrialVoices', {
      get: () => industrialVoices,
      enumerable: true,
    });
  bindWorkAudio();
  return {
    sounds,
    resetWork,
    start(value: AudioGraph) {
      graph = value;
      resetWork();
    },
    dispose() {
      resetWork();
      graph = null;
    },
  };
}
