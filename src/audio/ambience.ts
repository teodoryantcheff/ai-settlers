import type { GameRuntime } from '../runtime.ts';
import type { AudioGraph, AudioRuntime, Disposable } from './audio-runtime.ts';
import type { AudioInternals } from './audio-types.ts';
import type { Panner } from 'tone/build/esm/component/channel/Panner.js';
import type { EnvelopeOptions } from 'tone/build/esm/component/envelope/Envelope.js';
export function createAmbience(
  game: GameRuntime,
  runtime: AudioRuntime,
  internals?: AudioInternals,
) {
  let active: AudioGraph = null;
  // ---------- AMBIENCE ----------
  let rainG: AudioGraph['channels']['ambience'] = null,
    birdT = 0,
    waterG: AudioGraph['channels']['ambience'] = null,
    ambT = 0;
  function startAmbience(graph: AudioGraph) {
    const { tone, context, channels } = graph;
    const t = runtime.immediate();
    const wind = runtime.own(new tone.Noise({ context, type: 'white' }));
    const windFilter = runtime.own(
      new tone.Filter({ context, type: 'lowpass', frequency: 320, Q: 0.4 }),
    );
    const windGain = runtime.own(new tone.Gain({ context, gain: 0.014 }));
    const windLfo = runtime.own(new tone.LFO({ context, frequency: 0.07, min: 0.005, max: 0.023 }));
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(channels.ambience);
    windLfo.connect(windGain.gain);
    wind.start(t);
    windLfo.start(t);

    // Camera coverage controls the water lap; the slow filter motion is cosmetic.
    const water = runtime.own(new tone.Noise({ context, type: 'white', playbackRate: 0.7 }));
    const waterFilter = runtime.own(
      new tone.Filter({ context, type: 'bandpass', frequency: 640, Q: 1.6 }),
    );
    waterG = runtime.own(new tone.Gain({ context, gain: 0 }));
    const waterLfo = runtime.own(new tone.LFO({ context, frequency: 0.24, min: 626, max: 654 }));
    water.connect(waterFilter);
    waterFilter.connect(waterG);
    waterG.connect(channels.ambience);
    waterLfo.connect(waterFilter.frequency);
    water.start(t);
    waterLfo.start(t);

    const rain = runtime.own(new tone.Noise({ context, type: 'white', playbackRate: 1.3 }));
    const rainFilter = runtime.own(
      new tone.Filter({ context, type: 'bandpass', frequency: 2400, Q: 0.35 }),
    );
    rainG = runtime.own(new tone.Gain({ context, gain: 0 }));
    rain.connect(rainFilter);
    rainFilter.connect(rainG);
    rainG.connect(channels.ambience);
    rain.start(t);
    birdT = 3 + Math.random() * 6;
    ambT = 0;
  }
  function sine(
    destination: Panner | AudioGraph['channels']['effects'],
    time: number,
    from: number,
    to: number,
    duration: number,
    level: number,
    envelope: Partial<EnvelopeOptions>,
  ) {
    const { tone, context } = runtime.graph;
    const voice = runtime.own(new tone.Synth({ context, oscillator: { type: 'sine' }, envelope }));
    voice.connect(destination);
    voice.triggerAttackRelease(from, duration, time, level);
    if (from !== to) voice.frequency.exponentialRampToValueAtTime(to, time + duration);
    return voice;
  }
  function wildlifePan(pan: number) {
    const { tone, context, channels } = runtime.graph;
    const panner = runtime.own(new tone.Panner({ context, pan }));
    panner.connect(channels.ambience);
    return panner;
  }
  function cricketChirp() {
    if (!runtime.canPlay('ambience')) return;
    const t = runtime.immediate();
    const pan = wildlifePan(Math.random() * 1.4 - 0.7);
    const count = 3 + ((Math.random() * 4) | 0);
    const frequency = 4200 + Math.random() * 500;
    const resources: Disposable[] = [pan];
    for (let i = 0; i < count; i++) {
      resources.push(
        sine(pan, t + i * 0.11, frequency, frequency, 0.05, 0.009, {
          attack: 0.008,
          decay: 0.042,
          sustain: 0,
          release: 0.02,
        }),
      );
    }
    runtime.releaseAt(t + (count - 1) * 0.11 + 0.09, resources);
  }
  function owlHoot() {
    if (!runtime.canPlay('ambience')) return;
    const t = runtime.immediate();
    const pan = wildlifePan(Math.random() * 1.2 - 0.6);
    const frequency = 340 + Math.random() * 30;
    const resources: Disposable[] = [pan];
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.62;
      const voice = sine(pan, tt, frequency, frequency, 0.22, 0.02, {
        attack: 0.09,
        decay: 0.13,
        sustain: 1,
        release: 0.16,
      });
      voice.frequency.linearRampToValueAtTime(frequency * 0.88, tt + 0.32);
      resources.push(voice);
    }
    runtime.releaseAt(t + 1.05, resources);
  }
  function birdChirp() {
    if (!runtime.canPlay('ambience')) return;
    const t = runtime.immediate();
    const pan = wildlifePan(Math.random() * 1.6 - 0.8);
    const count = 2 + ((Math.random() * 4) | 0);
    const resources: Disposable[] = [pan];
    let end = t;
    for (let i = 0; i < count; i++) {
      const from = 2100 + Math.random() * 1600;
      const to = from * (0.7 + Math.random() * 0.6);
      const tt = t + i * (0.09 + Math.random() * 0.07);
      const voice = sine(pan, tt, from, from, 0.06, 0.016, {
        attack: 0.012,
        decay: 0.048,
        sustain: 0,
        release: 0.03,
      });
      voice.frequency.exponentialRampToValueAtTime(to, tt + 0.05);
      resources.push(voice);
      end = Math.max(end, tt + 0.1);
    }
    runtime.releaseAt(end, resources);
  }
  function ambTick(dt: number) {
    if (
      !active ||
      active.context.state !== 'running' ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    )
      return;
    ambT -= dt;
    if (birdT > 0) birdT -= dt;
    else {
      if (runtime.canPlay('ambience')) {
        const nA = game.nightAmt(),
          rA = game.rainAmt();
        if (rA > 0.35) {
        } // storms quiet the songbirds
        else if (nA >= 0.5) {
          cricketChirp();
          if (Math.random() < 0.06) owlHoot();
        } // night chorus
        else if (nA <= 0.45) birdChirp();
      }
      birdT = 5 + Math.random() * 9;
    }
    if (ambT > 0) return;
    ambT = 1.5;
    if (!waterG) return;
    let n = 0,
      samples = 0;
    const x0 = Math.max(0, Math.floor(game.cam.x / game.TS)),
      x1 = Math.min(game.W - 1, Math.ceil((game.cam.x + game.vw / game.z) / game.TS));
    const y0 = Math.max(0, Math.floor(game.cam.y / game.TS)),
      y1 = Math.min(game.H - 1, Math.ceil((game.cam.y + game.vh / game.z) / game.TS));
    for (let y = y0; y <= y1; y += 3)
      for (let x = x0; x <= x1; x += 3) {
        samples++;
        if (game.tiles[game.idx(x, y)].t === game.WATER) n++;
      }
    const frac = samples ? n / samples : 0;
    const target = Math.min(0.05, frac * 0.09);
    const t = runtime.immediate();
    waterG.gain.cancelAndHoldAtTime(t);
    waterG.gain.setTargetAtTime(target, t, 0.8);
    if (rainG) {
      rainG.gain.cancelAndHoldAtTime(t);
      rainG.gain.setTargetAtTime(game.rainAmt() * 0.05, t, 0.9);
    }
  }

  function rumble(time: number, duration: number, from: number, to: number, level: number) {
    const { tone, context, channels } = runtime.graph;
    const noise = runtime.own(
      new tone.NoiseSynth({
        context,
        noise: { type: 'white' },
        envelope: { attack: 0, decay: duration, sustain: 0, release: 0.025 },
      }),
    );
    const filter = runtime.own(
      new tone.Filter({ context, type: 'lowpass', frequency: from, Q: 0.4 }),
    );
    noise.connect(filter);
    filter.connect(channels.effects);
    noise.triggerAttackRelease(duration, time, level);
    filter.frequency.exponentialRampToValueAtTime(to, time + duration);
    runtime.releaseAt(time + duration + 0.1, [noise, filter]);
  }
  function thunder() {
    if (!runtime.canPlay('effects')) return;
    const t = runtime.immediate();
    rumble(t, 1.6, 170, 55, 0.2);
    rumble(t + 0.12, 1.1, 120, 45, 0.13);
    const voice = sine(runtime.graph.channels.effects, t, 54, 38, 1.2, 0.1, {
      attack: 0.008,
      decay: 1.192,
      sustain: 0,
      release: 0.05,
    });
    runtime.releaseAt(t + 1.3, [voice]);
  }

  if (internals) Object.assign(internals, { birdChirp, cricketChirp, owlHoot });
  return {
    tick: ambTick,
    thunder,
    start(graph: AudioGraph) {
      if (active === graph) return;
      active = graph;
      startAmbience(graph);
    },
    dispose() {
      active = null;
      rainG = waterG = null;
      birdT = ambT = 0;
    },
  };
}
