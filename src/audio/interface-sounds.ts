import type { AudioRuntime } from './audio-runtime.ts';
import type { SoundCatalog } from './audio-types.ts';

export function createInterfaceSounds(
  runtime: AudioRuntime,
): Pick<SoundCatalog, 'ui' | 'tick' | 'uiOpen' | 'fail'> {
  function sweep(
    t: number,
    type: 'sine' | 'triangle' | 'square',
    from: number,
    to: number,
    duration: number,
    velocity: number,
  ) {
    const { tone, context, channels } = runtime.graph;
    const synth = runtime.own(
      new tone.Synth({
        context,
        oscillator: { type },
        envelope: { attack: 0.008, decay: duration, sustain: 0, release: 0.025 },
      }),
    );
    synth.connect(channels.effects);
    synth.triggerAttackRelease(from, duration, t, velocity);
    synth.frequency.exponentialRampToValueAtTime(to, t + duration);
    runtime.releaseAt(t + duration + 0.1, [synth]);
  }
  return {
    ui() {
      const t = runtime.immediate();
      sweep(t, 'triangle', 720, 540, 0.05, 0.055);
    },
    tick() {
      const t = runtime.immediate();
      sweep(t, 'sine', 950, 880, 0.025, 0.018);
    },
    uiOpen() {
      const t = runtime.immediate();
      sweep(t, 'triangle', 520, 760, 0.09, 0.05);
    },
    fail() {
      const t = runtime.immediate();
      sweep(t, 'square', 120, 74, 0.2, 0.07);
      sweep(t + 0.005, 'square', 89, 60, 0.18, 0.05);
      const { tone, context, channels } = runtime.graph;
      const noise = runtime.own(
        new tone.NoiseSynth({
          context,
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
        }),
      );
      const filter = runtime.own(
        new tone.Filter({ context, type: 'lowpass', frequency: 500, Q: 0.8 }),
      );
      noise.connect(filter);
      filter.connect(channels.effects);
      filter.frequency.exponentialRampToValueAtTime(180, t + 0.12);
      noise.triggerAttackRelease(0.12, t, 0.05);
      runtime.releaseAt(t + 0.25, [noise, filter]);
    },
  };
}
