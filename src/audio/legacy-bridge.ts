import type { AudioGraph } from './audio-runtime.ts';

// Transitional raw synthesis for categories awaiting migration. Every source is
// connected to the Tone-owned channels on the same context; there is no fallback.
const bridges = new WeakMap<AudioGraph, LegacyBridge>();
export function getLegacyBridge(graph: AudioGraph): LegacyBridge {
  const existing = bridges.get(graph);
  if (existing) return existing;
  const bridge = createLegacyBridge(graph);
  bridges.set(graph, bridge);
  return bridge;
}
function createLegacyBridge(graph: AudioGraph) {
  const AC = graph.context as unknown as AudioContext;
  const gSfx = graph.channels.effects.input as GainNode;
  const gMusic = graph.channels.music.input as GainNode;
  const gAmb = graph.channels.ambience.input as GainNode;
  const noiseB = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  const data = noiseB.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  // A source ending must release its filter, gain and panner too. Shared synth
  // graphs are disconnected only after the last oscillator finishes its release.
  function disposeAudio(sources: AudioScheduledSourceNode[], nodes: (AudioNode | null)[]) {
    var left = sources.length;
    sources.forEach(function (source) {
      source.onended = function () {
        source.disconnect();
        if (--left === 0)
          nodes.forEach(function (node) {
            if (node) node.disconnect();
          });
      };
    });
  }
  function ownPanner(panner: AudioNode, bus: AudioNode): AudioNode | null {
    return panner === bus ? null : panner;
  }
  // ---------- shared synth helpers ----------
  function mtof(m: number) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }
  function busPan(dest: AudioNode, p: number) {
    if (AC.createStereoPanner) {
      var pn = AC.createStereoPanner();
      if (pn.pan) pn.pan.value = Math.max(-1, Math.min(1, p || 0));
      pn.connect(dest);
      return pn;
    }
    return dest;
  }
  function adsr(gn: GainNode, t0: number, a: number, peak: number, dec: number, end?: number) {
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + a);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0001, end || 0.0001), t0 + a + dec);
  }
  function playNoise(
    dest: AudioNode,
    t0: number,
    dur: number,
    filterType: BiquadFilterType,
    f0: number,
    f1: number,
    gainv: number,
    q?: number,
  ) {
    var src = AC.createBufferSource();
    src.buffer = noiseB;
    src.loop = true;
    src.playbackRate.value = 1;
    var flt = AC.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(f0, t0);
    if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    flt.Q.value = q || 0.8;
    var gn = AC.createGain();
    gn.gain.setValueAtTime(gainv, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(gn);
    gn.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    disposeAudio([src], [flt, gn]);
    return src;
  }
  function playOsc(
    dest: AudioNode,
    t0: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gainv: number,
    curve?: number,
  ) {
    var o = AC.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur * (curve || 1));
    var gn = AC.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(gainv, t0 + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn);
    gn.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    disposeAudio([o], [gn]);
    return o;
  }
  function bellTone(
    dest: AudioNode,
    t0: number,
    f: number,
    gainv: number,
    dur: number,
    pan?: number,
  ) {
    var pn = busPan(dest, pan);
    var o1 = AC.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    var o2 = AC.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.51;
    var gn = AC.createGain(),
      gn2 = AC.createGain();
    gn.gain.setValueAtTime(gainv, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    gn2.gain.setValueAtTime(gainv * 0.28, t0);
    gn2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.4);
    o1.connect(gn);
    gn.connect(pn);
    o2.connect(gn2);
    gn2.connect(pn);
    o1.start(t0);
    o1.stop(t0 + dur + 0.1);
    o2.start(t0);
    o2.stop(t0 + dur * 0.5 + 0.1);
    disposeAudio([o1, o2], [gn, gn2, ownPanner(pn, dest)]);
  }
  function pluck(
    t0: number,
    midi: number,
    vel: number,
    pan: number,
    bright: number,
    dest?: AudioNode,
  ) {
    dest = dest || gMusic;
    var f = mtof(midi),
      pn = busPan(dest, pan),
      dur = 0.5;
    var flt = AC.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(bright || 1900, t0);
    flt.frequency.exponentialRampToValueAtTime(500, t0 + dur);
    flt.Q.value = 1.1;
    var gn = AC.createGain();
    adsr(gn, t0, 0.004, vel, 0.42);
    var o1 = AC.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = f;
    var o2 = AC.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = f * 1.004;
    var g2 = AC.createGain();
    g2.gain.value = 0.18;
    o1.connect(flt);
    o2.connect(g2);
    g2.connect(flt);
    flt.connect(gn);
    gn.connect(pn);
    o1.start(t0);
    o1.stop(t0 + dur + 0.05);
    o2.start(t0);
    o2.stop(t0 + dur + 0.05);
    playNoise(pn, t0, 0.02, 'highpass', 3000, 0, vel * 0.5, 0.5);
    disposeAudio([o1, o2], [g2, flt, gn, ownPanner(pn, dest)]);
  }
  function fluteNote(t0: number, midi: number, dur: number, vel: number, pan: number) {
    var f = mtof(midi),
      pn = busPan(gMusic, pan);
    var o = AC.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    var vib = AC.createOscillator();
    vib.frequency.value = 5.2;
    var vg = AC.createGain();
    vg.gain.setValueAtTime(0, t0);
    vg.gain.linearRampToValueAtTime(f * 0.006, t0 + 0.35);
    vib.connect(vg);
    vg.connect(o.frequency);
    var gn = AC.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(vel, t0 + 0.09);
    gn.gain.setValueAtTime(vel, t0 + Math.max(0.1, dur - 0.18));
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.15);
    o.connect(gn);
    gn.connect(pn);
    o.start(t0);
    o.stop(t0 + dur + 0.25);
    vib.start(t0);
    vib.stop(t0 + dur + 0.25);
    playNoise(pn, t0, 0.09, 'bandpass', f * 3, 0, vel * 0.16, 1.2);
    disposeAudio([o, vib], [vg, gn, ownPanner(pn, gMusic)]);
  }
  function padChord(t0: number, midis: number[], dur: number, level?: number) {
    var peak = 0.021 * (level === undefined ? 1 : level);
    for (var i = 0; i < midis.length; i++) {
      var f = mtof(midis[i]);
      var o = AC.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + (i - 1) * 0.0009);
      var o2 = AC.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = f * 2;
      var g2 = AC.createGain();
      g2.gain.value = 0.22;
      var gn = AC.createGain();
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.linearRampToValueAtTime(peak, t0 + 1.1);
      gn.gain.setValueAtTime(peak, t0 + dur - 0.7);
      gn.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.6);
      o.connect(gn);
      o2.connect(g2);
      g2.connect(gn);
      gn.connect(gMusic);
      o.start(t0);
      o.stop(t0 + dur + 0.8);
      o2.start(t0);
      o2.stop(t0 + dur + 0.8);
      disposeAudio([o, o2], [g2, gn]);
    }
  }
  function bassNote(t0: number, midi: number, vel: number) {
    var f = mtof(midi);
    var o = AC.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    var gn = AC.createGain();
    adsr(gn, t0, 0.02, vel, 1.1);
    o.connect(gn);
    gn.connect(gMusic);
    o.start(t0);
    o.stop(t0 + 1.3);
    var o2 = AC.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    var g2 = AC.createGain();
    adsr(g2, t0, 0.02, vel * 0.22, 0.5);
    o2.connect(g2);
    g2.connect(gMusic);
    o2.start(t0);
    o2.stop(t0 + 0.7);
    disposeAudio([o, o2], [gn, g2]);
  }
  function thump(t0: number, pan: number, pitch: number, vel: number) {
    var pn = busPan(gSfx, pan);
    var o = AC.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(pitch || 160, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(35, (pitch || 160) * 0.35), t0 + 0.11);
    var gn = AC.createGain();
    gn.gain.setValueAtTime(vel || 0.25, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    o.connect(gn);
    gn.connect(pn);
    o.start(t0);
    o.stop(t0 + 0.2);
    playNoise(pn, t0, 0.045, 'lowpass', 900, 300, (vel || 0.25) * 0.7, 0.6);
    disposeAudio([o], [gn, ownPanner(pn, gSfx)]);
  }
  function dulcimer(t0: number, midi: number, vel: number, pan: number) {
    // hammered dulcimer: fast double-strike attack, warm decay
    var f = mtof(midi),
      pn = busPan(gMusic, pan),
      dur = 0.55;
    var flt = AC.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(3400, t0);
    flt.frequency.exponentialRampToValueAtTime(800, t0 + dur);
    flt.Q.value = 0.9;
    var gn = AC.createGain();
    adsr(gn, t0, 0.002, vel, 0.5);
    var o1 = AC.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = f;
    var o2 = AC.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2.004;
    var g2 = AC.createGain();
    g2.gain.value = 0.35;
    o1.connect(flt);
    o2.connect(g2);
    g2.connect(flt);
    flt.connect(gn);
    gn.connect(pn);
    o1.start(t0);
    o1.stop(t0 + dur + 0.05);
    o2.start(t0);
    o2.stop(t0 + dur + 0.05);
    playNoise(pn, t0, 0.02, 'highpass', 3600, 0, vel * 0.4, 0.5);
    disposeAudio([o1, o2], [g2, flt, gn, ownPanner(pn, gMusic)]);
  }
  function droneNote(t0: number, midi: number, dur: number, level?: number) {
    // low swelled drone for the endgame (gold >= 50%)
    var f = mtof(midi);
    var peak = 0.024 * (level === undefined ? 1 : level);
    var o = AC.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    var o2 = AC.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 1.003;
    var g2 = AC.createGain();
    g2.gain.value = 0.35;
    var gn = AC.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + dur * 0.35);
    gn.gain.setValueAtTime(peak, t0 + dur * 0.7);
    gn.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn);
    o2.connect(g2);
    g2.connect(gn);
    gn.connect(gMusic);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
    o2.start(t0);
    o2.stop(t0 + dur + 0.1);
    disposeAudio([o, o2], [g2, gn]);
  }

  return {
    AC,
    gSfx,
    gMusic,
    gAmb,
    noiseB,
    mtof,
    busPan,
    adsr,
    playNoise,
    playOsc,
    bellTone,
    pluck,
    fluteNote,
    padChord,
    bassNote,
    thump,
    dulcimer,
    droneNote,
    disposeAudio,
    ownPanner,
  };
}
export type LegacyBridge = ReturnType<typeof createLegacyBridge>;
