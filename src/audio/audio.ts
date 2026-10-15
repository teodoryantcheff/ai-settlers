import { observePresentation } from '../ui/domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type { BuildingType } from '../types.ts';
import { ingredientShortages } from '../gameplay/production-rules.ts';

export function createAudio(game: GameRuntime, internals?: AudioInternals): AudioSubsystem {
  // ==================== AUDIO ENGINE ====================
  // Procedural music + designed SFX + living ambience. All WebAudio, zero assets.

  var AC: AudioContext = null,
    muted = false,
    musicOn = true,
    musVol = 0.42,
    sfxVol = 0.9,
    ambVol = 0.5;
  var gMaster: GainNode = null,
    gSfx: GainNode = null,
    gMusic: GainNode = null,
    gAmb: GainNode = null,
    noiseB: AudioBuffer = null,
    rainG: GainNode = null;
  var audioVisibilityBound = false,
    audioWorkBound = false;

  function audioCanPlay() {
    return !!AC && AC.state === 'running' && !muted && document.visibilityState !== 'hidden';
  }
  function sfxCanPlay() {
    return audioCanPlay() && sfxVol > 0;
  }
  function audioVolume(v: number) {
    return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  function holdAudioGain(gain: AudioParam) {
    if (!AC || !gain) return;
    var t = AC.currentTime;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(t);
    else {
      var current = gain.value;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(current, t);
    }
    return t;
  }
  function setAudioGain(gain: AudioParam, target: number, fade: number) {
    if (!AC || !gain) return;
    var t = holdAudioGain(gain);
    gain.setTargetAtTime(target, t, fade);
  }
  function resumeAudio() {
    if (!AC || document.visibilityState === 'hidden' || AC.state === 'closed') return;
    // Queue the desired state even while suspend() is still pending. AudioContext
    // state changes asynchronously, so a rapid tab return can still report running.
    var resumed = AC.resume();
    if (resumed && resumed.catch) resumed.catch(function () {}); // a later user gesture can retry
  }
  function audioVisibility() {
    if (!AC || AC.state === 'closed') return;
    if (document.visibilityState === 'hidden') {
      var suspended = AC.suspend();
      if (suspended && suspended.catch) suspended.catch(function () {});
    } else resumeAudio();
  }
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
  function bindWorkAudio() {
    if (audioWorkBound || typeof game.gameEvents === 'undefined' || !game.gameEvents.on) return;
    observePresentation(game, 'goodsProduced', function (event) {
      var b = event.building;
      if (!b) return;
      var method = (
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
      if (method) SND[method](b.x, b.y);
    });
    observePresentation(game, 'firstGold', function (event) {
      var b = event.building;
      if (b) SND.coin(b.x, b.y);
    });
    audioWorkBound = true;
  }

  function initAudio() {
    if (AC) {
      resumeAudio();
      bindWorkAudio();
      return;
    }
    try {
      AC = new (
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      )();
    } catch (e) {
      AC = null;
      return;
    }
    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    gMaster = AC.createGain();
    gMaster.gain.value = muted ? 0 : 0.9;
    gSfx = AC.createGain();
    gSfx.gain.value = sfxVol;
    gMusic = AC.createGain();
    gMusic.gain.value = musicOn ? musVol : 0;
    gAmb = AC.createGain();
    gAmb.gain.value = ambVol;
    gSfx.connect(gMaster);
    gMusic.connect(gMaster);
    gAmb.connect(gMaster);
    gMaster.connect(comp);
    comp.connect(AC.destination);
    noiseB = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    var d = noiseB.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startAmbience();
    startMusic();
    bindWorkAudio();
    if (!audioVisibilityBound) {
      document.addEventListener('visibilitychange', audioVisibility);
      window.addEventListener('pageshow', resumeAudio);
      window.addEventListener('pagehide', function () {
        if (AC && AC.state !== 'closed') {
          var p = AC.suspend();
          if (p && p.catch) p.catch(function () {});
        }
      });
      audioVisibilityBound = true;
    }
    resumeAudio();
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
  function panOf(wx: number) {
    if (!AC) return 0;
    var cx = game.cam.x + game.vw / 2 / game.z,
      half = game.vw / 2 / game.z;
    var p = (wx * game.TS - cx) / half;
    return Math.max(-0.75, Math.min(0.75, p * 0.55));
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

  // ---------- designed SFX ----------
  // Limit work sounds by building and globally. Fast simulation and large
  // settlements should produce a readable soundscape, without allocating dozens
  // of simultaneous noise/oscillator graphs for every industrial cycle.
  var industrialVoices: IndustrialVoice[] = [],
    industrialLast: Record<string, number> = Object.create(null),
    industrialNext = 0;
  var INDUSTRIAL_MAX_VOICES = 6,
    INDUSTRIAL_SPACING = 0.07;
  function industrialAudio(
    kind: 'hammer' | 'chop' | 'saw' | 'clang' | 'forge',
    wx: number,
    wy: number,
    dur: number,
  ) {
    if (!sfxCanPlay()) return false;
    var t = AC.currentTime;
    if (typeof wx === 'number' && typeof wy === 'number') {
      var margin = game.TS * 5;
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
    for (var old in industrialLast) if (t - industrialLast[old] > 4) delete industrialLast[old];
    var key = kind + ':' + wx + ':' + wy;
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
  var SND: AudioSubsystem['SND'] = {
    ui: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playOsc(gSfx, t, 'triangle', 720, 540, 0.05, 0.055);
    },
    tick: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playOsc(gSfx, t, 'sine', 950, 880, 0.025, 0.018);
    },
    uiOpen: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playOsc(gSfx, t, 'triangle', 520, 760, 0.09, 0.05);
    },
    fail: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playOsc(gSfx, t, 'square', 120, 74, 0.2, 0.07);
      playOsc(gSfx, t + 0.005, 'square', 89, 60, 0.18, 0.05);
      playNoise(gSfx, t, 0.12, 'lowpass', 500, 180, 0.05, 0.8);
    },
    place: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      thump(t, 0, 150, 0.22);
      thump(t + 0.11, 0, 120, 0.18);
      playNoise(gSfx, t + 0.02, 0.08, 'bandpass', 2600, 1400, 0.05, 1.4);
    },
    done: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      pluck(t, 74, 0.12, 0, 2200, gSfx);
      pluck(t + 0.1, 77, 0.12, 0, 2200, gSfx);
      pluck(t + 0.2, 81, 0.13, 0, 2400, gSfx);
      bellTone(gSfx, t + 0.3, 1760, 0.05, 1.2, 0);
    },
    demolish: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playNoise(gSfx, t, 0.5, 'lowpass', 420, 90, 0.16, 0.5);
      thump(t + 0.05, 0, 110, 0.2);
      playNoise(gSfx, t + 0.18, 0.3, 'lowpass', 300, 90, 0.1, 0.5);
      playNoise(gSfx, t, 0.06, 'highpass', 2500, 0, 0.06, 1);
    },
    man: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      var o = AC.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.linearRampToValueAtTime(228, t + 0.3);
      var o2 = AC.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.setValueAtTime(330, t);
      o2.frequency.linearRampToValueAtTime(336, t + 0.3);
      var flt = AC.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 1200;
      var gn = AC.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.06, t + 0.08);
      gn.gain.setValueAtTime(0.06, t + 0.26);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(flt);
      o2.connect(flt);
      flt.connect(gn);
      gn.connect(gSfx);
      o.start(t);
      o.stop(t + 0.6);
      o2.start(t);
      o2.stop(t + 0.6);
      disposeAudio([o, o2], [flt, gn]);
    },
    gone: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playOsc(gSfx, t, 'sine', 110, 44, 0.5, 0.09);
      playNoise(gSfx, t, 0.4, 'lowpass', 260, 80, 0.07, 0.6);
    },
    road: function (n) {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      var k = Math.min(6, n || 1);
      for (var i = 0; i < k; i++) {
        var f = 300 + i * 60;
        playNoise(gSfx, t + i * 0.055, 0.04, 'bandpass', f + 900, 0, 0.05, 2);
        thump(t + i * 0.055, 0, 190, 0.08);
      }
    },
    coin: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime,
        p = panOf(wx);
      bellTone(gSfx, t, 1318, 0.075, 0.7, p);
      bellTone(gSfx, t + 0.07, 1760, 0.06, 0.8, p);
      playNoise(gSfx, t, 0.05, 'highpass', 6000, 0, 0.028, 1);
    },
    chainStart: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime,
        pn = busPan(gSfx, panOf(wx));
      playOsc(pn, t, 'triangle', 523, 523, 0.12, 0.045);
      var tail = playOsc(pn, t + 0.1, 'triangle', 784, 784, 0.2, 0.04);
      tail.addEventListener('ended', function () {
        if (pn !== gSfx) pn.disconnect();
      });
    },
    chainBlocked: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime,
        pn = busPan(gSfx, panOf(wx));
      // A soft falling pair, not the harsh placement-failure alarm.
      playOsc(pn, t, 'triangle', 233, 233, 0.16, 0.04);
      var tail = playOsc(pn, t + 0.13, 'triangle', 196, 196, 0.22, 0.035);
      tail.addEventListener('ended', function () {
        if (pn !== gSfx) pn.disconnect();
      });
    },
    chainRecovered: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime,
        p = panOf(wx);
      bellTone(gSfx, t, 659, 0.035, 0.45, p);
      bellTone(gSfx, t + 0.12, 880, 0.025, 0.55, p);
    },
    hammer: function (wx, wy) {
      if (!industrialAudio('hammer', wx, wy, 0.22)) return;
      var t = AC.currentTime,
        p = panOf(wx);
      playNoise(gSfx, t, 0.035, 'bandpass', 3000, 1200, 0.045, 2);
      thump(t, p, 210, 0.09);
    },
    chop: function (wx, wy) {
      if (!industrialAudio('chop', wx, wy, 0.25)) return;
      var t = AC.currentTime,
        p = panOf(wx);
      playNoise(gSfx, t, 0.07, 'bandpass', 1300, 500, 0.07, 1.5);
      thump(t, p, 240, 0.1);
    },
    saw: function (wx, wy) {
      if (!industrialAudio('saw', wx, wy, 0.5)) return;
      var t = AC.currentTime,
        p = panOf(wx);
      var pn = busPan(gSfx, p);
      playNoise(pn, t, 0.3, 'bandpass', 1500, 650, 0.07, 1.4);
      playOsc(pn, t, 'sawtooth', 115, 88, 0.28, 0.028);
      var tail = playNoise(pn, t + 0.31, 0.12, 'bandpass', 1100, 500, 0.045, 1.4);
      tail.addEventListener('ended', function () {
        if (pn !== gSfx) pn.disconnect();
      });
    },
    clang: function (wx, wy) {
      if (!industrialAudio('clang', wx, wy, 0.3)) return;
      var t = AC.currentTime,
        p = panOf(wx);
      bellTone(gSfx, t, 728, 0.09, 0.14, p);
      bellTone(gSfx, t, 1097, 0.045, 0.1, p);
      thump(t, p, 320, 0.09);
      playNoise(gSfx, t, 0.025, 'highpass', 4200, 0, 0.04, 1);
    },
    forge: function (wx, wy) {
      if (!industrialAudio('forge', wx, wy, 0.75)) return;
      var t = AC.currentTime,
        p = panOf(wx);
      var pn = busPan(gSfx, p);
      var src = AC.createBufferSource();
      src.buffer = noiseB;
      src.loop = true;
      var flt = AC.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(700, t);
      flt.frequency.linearRampToValueAtTime(1600, t + 0.22);
      flt.frequency.linearRampToValueAtTime(300, t + 0.5);
      var gn = AC.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.055, t + 0.18);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      src.connect(flt);
      flt.connect(gn);
      gn.connect(pn);
      src.start(t);
      src.stop(t + 0.55);
      disposeAudio([src], [flt, gn, ownPanner(pn, gSfx)]);
      bellTone(gSfx, t + 0.3, 1568, 0.05, 0.4, p);
      bellTone(gSfx, t + 0.3, 2352, 0.022, 0.28, p);
    },
    thunder: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      playNoise(gSfx, t, 1.6, 'lowpass', 170, 55, 0.2, 0.4);
      playNoise(gSfx, t + 0.12, 1.1, 'lowpass', 120, 45, 0.13, 0.4);
      playOsc(gSfx, t, 'sine', 54, 38, 1.2, 0.1);
    },
    fanfare: function () {
      if (!sfxCanPlay()) return;
      var t = AC.currentTime;
      if (gMusic) {
        // duck the loop under the fanfare, then ease back
        var gg = gMusic.gain;
        holdAudioGain(gg);
        var duck = musicOn ? musVol * 0.25 : 0;
        gg.linearRampToValueAtTime(duck, t + 0.18);
        gg.setValueAtTime(duck, t + 2.1);
        gg.linearRampToValueAtTime(musicOn ? musVol : 0, t + 3.4);
      }
      var seq = [
        [62, 0],
        [66, 0.16],
        [69, 0.32],
        [74, 0.5],
        [69, 0.85],
        [74, 1.05],
      ];
      for (var i = 0; i < seq.length; i++) {
        var m = seq[i][0],
          tt = t + seq[i][1];
        var flt = AC.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = 2400;
        var gn = AC.createGain();
        gn.gain.setValueAtTime(0.0001, tt);
        gn.gain.linearRampToValueAtTime(0.085, tt + 0.03);
        gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.6);
        var o = AC.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        var o2 = AC.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.value = mtof(m) * 1.005;
        o.connect(flt);
        o2.connect(flt);
        flt.connect(gn);
        gn.connect(gSfx);
        o.start(tt);
        o.stop(tt + 0.7);
        o2.start(tt);
        o2.stop(tt + 0.7);
        disposeAudio([o, o2], [flt, gn]);
      }
      bellTone(gSfx, t + 1.3, 1174, 0.09, 2.2, 0);
      bellTone(gSfx, t + 1.42, 1760, 0.07, 2.4, 0);
    },
  };

  // ---------- AMBIENCE ----------
  var birdT = 0,
    waterG: GainNode = null,
    ambT = 0;
  function startAmbience() {
    // wind bed
    var src = AC.createBufferSource();
    src.buffer = noiseB;
    src.loop = true;
    var flt = AC.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 320;
    flt.Q.value = 0.4;
    var gn = AC.createGain();
    gn.gain.value = 0.014;
    var lfo = AC.createOscillator();
    lfo.frequency.value = 0.07;
    var lg = AC.createGain();
    lg.gain.value = 0.009;
    lfo.connect(lg);
    lg.connect(gn.gain);
    src.connect(flt);
    flt.connect(gn);
    gn.connect(gAmb);
    src.start();
    lfo.start();
    // water lap (gain follows how much water is on screen)
    var ws = AC.createBufferSource();
    ws.buffer = noiseB;
    ws.loop = true;
    ws.playbackRate.value = 0.7;
    var wf = AC.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 640;
    wf.Q.value = 1.6;
    waterG = AC.createGain();
    waterG.gain.value = 0;
    ws.connect(wf);
    wf.connect(waterG);
    waterG.connect(gAmb);
    ws.start();
    var wlfo = AC.createOscillator();
    wlfo.frequency.value = 0.24;
    var wlg = AC.createGain();
    wlg.gain.value = 14;
    wlfo.connect(wlg);
    wlg.connect(wf.frequency);
    wlfo.start();
    // rain bed (gain follows the weather system's rainAmt(), see 40_render)
    var rs = AC.createBufferSource();
    rs.buffer = noiseB;
    rs.loop = true;
    rs.playbackRate.value = 1.3;
    var rf = AC.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 2400;
    rf.Q.value = 0.35;
    rainG = AC.createGain();
    rainG.gain.value = 0;
    rs.connect(rf);
    rf.connect(rainG);
    rainG.connect(gAmb);
    rs.start();
    birdT = 3 + Math.random() * 6;
  }
  function cricketChirp() {
    if (!audioCanPlay() || ambVol <= 0) return;
    var t = AC.currentTime,
      pan = Math.random() * 1.4 - 0.7;
    var n = 3 + ((Math.random() * 4) | 0),
      f = 4200 + Math.random() * 500;
    var pn = busPan(gAmb, pan);
    var sources = [],
      nodes = [ownPanner(pn, gAmb)];
    for (var i = 0; i < n; i++) {
      var tt = t + i * 0.11;
      var o = AC.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      var gn = AC.createGain();
      gn.gain.setValueAtTime(0.0001, tt);
      gn.gain.linearRampToValueAtTime(0.009, tt + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
      o.connect(gn);
      gn.connect(pn);
      o.start(tt);
      o.stop(tt + 0.07);
      sources.push(o);
      nodes.push(gn);
    }
    disposeAudio(sources, nodes);
  }
  function owlHoot() {
    if (!audioCanPlay() || ambVol <= 0) return;
    var t = AC.currentTime,
      pan = Math.random() * 1.2 - 0.6,
      f = 340 + Math.random() * 30;
    var pn = busPan(gAmb, pan);
    var sources = [],
      nodes = [ownPanner(pn, gAmb)];
    for (var i = 0; i < 2; i++) {
      var tt = t + i * 0.62,
        o = AC.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, tt);
      o.frequency.linearRampToValueAtTime(f * 0.88, tt + 0.32);
      var gn = AC.createGain();
      gn.gain.setValueAtTime(0.0001, tt);
      gn.gain.linearRampToValueAtTime(0.02, tt + 0.09);
      gn.gain.setValueAtTime(0.02, tt + 0.22);
      gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.38);
      o.connect(gn);
      gn.connect(pn);
      o.start(tt);
      o.stop(tt + 0.42);
      sources.push(o);
      nodes.push(gn);
    }
    disposeAudio(sources, nodes);
  }
  function birdChirp() {
    if (!audioCanPlay() || ambVol <= 0) return;
    var t = AC.currentTime,
      pan = Math.random() * 1.6 - 0.8;
    var n = 2 + ((Math.random() * 4) | 0);
    for (var i = 0; i < n; i++) {
      var f0 = 2100 + Math.random() * 1600,
        f1 = f0 * (0.7 + Math.random() * 0.6);
      var o = AC.createOscillator();
      o.type = 'sine';
      var tt = t + i * (0.09 + Math.random() * 0.07);
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f1, tt + 0.05);
      var gn = AC.createGain();
      gn.gain.setValueAtTime(0.0001, tt);
      gn.gain.linearRampToValueAtTime(0.016, tt + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.06);
      var pn = busPan(gAmb, pan);
      o.connect(gn);
      gn.connect(pn);
      o.start(tt);
      o.stop(tt + 0.09);
      disposeAudio([o], [gn, ownPanner(pn, gAmb)]);
    }
  }
  function ambTick(dt: number) {
    if (!AC || AC.state !== 'running' || document.visibilityState === 'hidden') return;
    ambT -= dt;
    if (birdT > 0) birdT -= dt;
    else {
      if (!muted) {
        var nA = game.nightAmt(),
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
    var n = 0,
      samples = 0;
    var x0 = Math.max(0, Math.floor(game.cam.x / game.TS)),
      x1 = Math.min(game.W - 1, Math.ceil((game.cam.x + game.vw / game.z) / game.TS));
    var y0 = Math.max(0, Math.floor(game.cam.y / game.TS)),
      y1 = Math.min(game.H - 1, Math.ceil((game.cam.y + game.vh / game.z) / game.TS));
    for (var y = y0; y <= y1; y += 3)
      for (var x = x0; x <= x1; x += 3) {
        samples++;
        if (game.tiles[game.idx(x, y)].t === game.WATER) n++;
      }
    var frac = samples ? n / samples : 0;
    var target = Math.min(0.05, frac * 0.09);
    waterG.gain.setTargetAtTime(target, AC.currentTime, 0.8);
    if (rainG) rainG.gain.setTargetAtTime(game.rainAmt() * 0.05, AC.currentTime, 0.9);
  }

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
    if (bar % 2 === 0) padChord(t0, ch.pad, BAR * 2 * 0.98, texture);
    if (bar % 2 === 0 && a.gold > 0.45)
      droneNote(t0, ch.r - 12, BAR * 2 * 0.98, (texture * (a.gold - 0.45)) / 0.55);
    if (a.bass > 0.12) {
      bassNote(t0, ch.r, 0.09 * a.bass * texture);
      if (!returnPhrase && rnd() < 0.4) bassNote(t0 + EI * 3, ch.r, 0.055 * a.bass);
    }
    var mot = MOTIFS[(rnd() * MOTIFS.length) | 0],
      tones = ch.pad;
    for (var s = 0; s < 6; s++) {
      var d = mot[s];
      if (d < 0 || (returnPhrase && s !== 0 && s !== 3)) continue;
      var m = tones[d % tones.length] + 12 * (d >= tones.length ? 1 : 0);
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
      var melodyIndex = (phraseBar * 2 + (local >= 24 ? 2 : 0)) % theme.melody.length;
      var fluteLevel = 0.043 * a.flute * (1 - a.hungry * 0.55) * texture;
      var note = theme.melody[melodyIndex];
      if (note > 0) fluteNote(t0, note, EI * 2.2, fluteLevel, -0.22);
      note = theme.melody[(melodyIndex + 1) % theme.melody.length];
      if (note > 0 && phraseBar % 2 === 0)
        fluteNote(t0 + EI * 3, note, EI * 2.1, fluteLevel * 0.8, 0.22);
    }
    var percussion = a.drums * (1 - a.night * 0.95);
    if (!returnPhrase && local >= 16 && percussion > 0.08) {
      thumpMusic(t0, 0.08 * percussion);
      thumpMusic(t0 + EI * 3, 0.05 * percussion);
      tickT(t0 + EI * 2, 0.016 * percussion);
      tickT(t0 + EI * 5, 0.014 * percussion);
    }
    if (phraseBar === 7 && local < 32) {
      bellTone(gMusic, t0, mtof(ch.pad[0] + 12), 0.02, 2.4, 0);
      // Alternate phrase turns use a short dulcimer response rather than a flourish
      // every few seconds. Its timbre remains a highlight throughout a long game.
      if (local % 16 === 15) {
        dulcimer(t0, ch.pad[0] + 12, 0.04, -0.25);
        dulcimer(t0 + EI, ch.pad[1] + 12, 0.035, 0.1);
        dulcimer(t0 + EI * 2, ch.pad[2] + 12, 0.04, 0.25);
      }
    }
    if (a.gold > 0.25 && local < 32 && bar % 8 === 4 && rnd() < a.gold)
      bellTone(
        gMusic,
        t0,
        mtof(SCALE[(rnd() * SCALE.length) | 0] + 12),
        0.011,
        1.6,
        (rnd() - 0.5) * 0.5,
      );
  }
  function thumpMusic(t0: number, vel: number) {
    var o = AC.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t0);
    o.frequency.exponentialRampToValueAtTime(52, t0 + 0.1);
    var gn = AC.createGain();
    gn.gain.setValueAtTime(vel, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(gn);
    gn.connect(gMusic);
    o.start(t0);
    o.stop(t0 + 0.2);
    disposeAudio([o], [gn]);
  }
  function tickT(t0: number, vel: number) {
    playNoise(gMusic, t0, 0.03, 'highpass', 6200, 0, vel, 1);
  }
  var musicNext = 0,
    musicBar = 0,
    musicTimer: ReturnType<typeof setInterval> = null;
  function startMusic() {
    if (musicTimer !== null) clearInterval(musicTimer);
    musicNext = AC.currentTime + 0.25;
    musicBar = 0;
    musicTimer = setInterval(function () {
      if (!audioCanPlay() || !musicOn || musVol <= 0) return;
      // background-tab timer throttling can leave musicNext far in the past; skip ahead
      // instead of catching up — scheduling a pile of bars at past timestamps makes WebAudio
      // start them all instantly (an audible blast after switching tabs)
      if (musicNext < AC.currentTime) {
        musicNext = AC.currentTime + 0.15;
        musicBar = Math.ceil(musicBar / MUSIC_PHRASE_BARS) * MUSIC_PHRASE_BARS;
      }
      while (musicNext < AC.currentTime + 0.4) {
        scheduleBar(musicBar, musicNext);
        musicNext += BAR;
        musicBar++;
      }
    }, 90);
  }
  function setMusicVol(on: boolean) {
    musicOn = !!on;
    if (musicOn) resumeAudio();
    if (gMusic) setAudioGain(gMusic.gain, musicOn ? musVol : 0, 0.3);
  }
  function setMusVol(v: number) {
    // MIX panel slider (0..1); independent of the musicOn toggle
    musVol = audioVolume(v);
    if (gMusic && AC && musicOn) setAudioGain(gMusic.gain, musVol, 0.1);
  }
  function setSfxVol(v: number) {
    sfxVol = audioVolume(v);
    if (gSfx && AC) setAudioGain(gSfx.gain, sfxVol, 0.1);
    if (sfxVol === 0) {
      industrialVoices = [];
      industrialLast = Object.create(null);
    }
  }
  function setAmbVol(v: number) {
    ambVol = audioVolume(v);
    if (gAmb && AC) setAudioGain(gAmb.gain, ambVol, 0.25);
  }
  function setMuted(m: boolean) {
    muted = !!m;
    if (!muted) resumeAudio();
    if (muted) {
      industrialVoices = [];
      industrialLast = Object.create(null);
    }
    if (gMaster) setAudioGain(gMaster.gain, muted ? 0 : 0.9, 0.15);
  }

  // Test-only view of closure internals; never merged into the runtime.
  if (internals) {
    Object.assign(internals, {
      themeAt,
      scheduleBar,
      musicColony,
      starvingCount,
      birdChirp,
      cricketChirp,
      owlHoot,
      audioCanPlay,
      musicArrangement,
    });
    Object.defineProperties(internals, {
      BAR: {
        get: () => BAR,
        enumerable: true,
      },
      gAmb: {
        get: () => gAmb,
        enumerable: true,
      },
      gMusic: {
        get: () => gMusic,
        enumerable: true,
      },
      gSfx: {
        get: () => gSfx,
        enumerable: true,
      },
      industrialVoices: {
        get: () => industrialVoices,
        enumerable: true,
      },
      musicNext: {
        get: () => musicNext,
        set: (value: number) => {
          musicNext = value;
        },
        enumerable: true,
      },
      musicBar: {
        get: () => musicBar,
        set: (value: number) => {
          musicBar = value;
        },
        enumerable: true,
      },
      musicTimer: {
        get: () => musicTimer,
        enumerable: true,
      },
    });
  }

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  bindWorkAudio();
  return {
    get AC() {
      return AC;
    },
    get muted() {
      return muted;
    },
    get musicOn() {
      return musicOn;
    },
    get musVol() {
      return musVol;
    },
    set musVol(value: typeof musVol) {
      musVol = value;
    },
    get sfxVol() {
      return sfxVol;
    },
    set sfxVol(value: typeof sfxVol) {
      sfxVol = value;
    },
    get ambVol() {
      return ambVol;
    },
    set ambVol(value: typeof ambVol) {
      ambVol = value;
    },
    initAudio,
    get SND() {
      return SND;
    },
    ambTick,
    setMusicVol,
    setMusVol,
    setSfxVol,
    setAmbVol,
    setMuted,
  };
}

/** One entry in a theme's harmonic progression; r is the bass MIDI note. */
export interface MusicChord {
  r: number;
  pad: number[];
}
/** A named 48-bar theme in the pastoral suite. */
export interface MusicTheme {
  name: string;
  harmony: MusicChord[];
  melody: number[];
  brightness: number;
  lute: number;
}
/** Colony state read at phrase boundaries that steers the arrangement. */
export interface MusicColonyState {
  active: number;
  hungry: number;
  night: number;
  gold: number;
}
/** Smoothed per-layer levels and the bar of the last arrangement change. */
export interface MusicArrangement {
  bass: number;
  flute: number;
  drums: number;
  hungry: number;
  night: number;
  gold: number;
  active: number;
  phrase: number;
}
/** A scheduled industrial voice that keeps its slot until its sound ends. */
export interface IndustrialVoice {
  until: number;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface AudioInternals {
  themeAt: (bar: number) => MusicTheme;
  scheduleBar: (bar: number, t0: number) => void;
  musicColony: () => MusicColonyState;
  starvingCount: () => number;
  birdChirp: () => void;
  cricketChirp: () => void;
  owlHoot: () => void;
  audioCanPlay: () => boolean;
  musicArrangement: MusicArrangement;
  readonly BAR: number;
  readonly gAmb: GainNode;
  readonly gMusic: GainNode;
  readonly gSfx: GainNode;
  readonly industrialVoices: IndustrialVoice[];
  musicNext: number;
  musicBar: number;
  readonly musicTimer: ReturnType<typeof setInterval>;
}

export interface AudioSubsystem {
  readonly AC: AudioContext;
  readonly muted: boolean;
  readonly musicOn: boolean;
  musVol: number;
  sfxVol: number;
  ambVol: number;
  initAudio: () => void;
  readonly SND: {
    ui: () => void;
    tick: () => void;
    uiOpen: () => void;
    fail: () => void;
    place: () => void;
    done: () => void;
    demolish: () => void;
    man: () => void;
    gone: () => void;
    road: (n: number) => void;
    coin: (wx: number, wy: number) => void;
    chainStart: (wx: number, wy: number) => void;
    chainBlocked: (wx: number, wy: number) => void;
    chainRecovered: (wx: number, wy: number) => void;
    hammer: (wx: number, wy: number) => void;
    chop: (wx: number, wy: number) => void;
    saw: (wx: number, wy: number) => void;
    clang: (wx: number, wy: number) => void;
    forge: (wx: number, wy: number) => void;
    thunder: () => void;
    fanfare: () => void;
  };
  ambTick: (dt: number) => void;
  setMusicVol: (on: boolean) => void;
  setMusVol: (v: number) => void;
  setSfxVol: (v: number) => void;
  setAmbVol: (v: number) => void;
  setMuted: (m: boolean) => void;
}
