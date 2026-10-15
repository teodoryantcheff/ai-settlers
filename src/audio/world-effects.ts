import { observePresentation } from '../ui/domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type { BuildingType } from '../types.ts';
import type { AudioGraph, AudioRuntime } from './audio-runtime.ts';
import type { AudioInternals, IndustrialVoice, SoundCatalog } from './audio-types.ts';
import { getLegacyBridge, type LegacyBridge } from './legacy-bridge.ts';
type WorldSounds = Omit<SoundCatalog, 'ui' | 'tick' | 'uiOpen' | 'fail' | 'thunder'>;
export function createWorldEffects(
  game: GameRuntime,
  runtime: AudioRuntime,
  internals?: AudioInternals,
) {
  let bridge: LegacyBridge = null;
  let audioWorkBound = false;
  const sfxCanPlay = () => runtime.canPlay('effects');
  function panOf(wx: number) {
    if (!runtime.graph) return 0;
    var cx = game.cam.x + game.vw / 2 / game.z,
      half = game.vw / 2 / game.z;
    var p = (wx * game.TS - cx) / half;
    return Math.max(-0.75, Math.min(0.75, p * 0.55));
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
      if (method) game.SND[method](b.x, b.y);
    });
    observePresentation(game, 'firstGold', function (event) {
      var b = event.building;
      if (b) game.SND.coin(b.x, b.y);
    });
    audioWorkBound = true;
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
    var t = bridge.AC.currentTime;
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
  var sounds: WorldSounds = {
    place: function () {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      bridge.thump(t, 0, 150, 0.22);
      bridge.thump(t + 0.11, 0, 120, 0.18);
      bridge.playNoise(bridge.gSfx, t + 0.02, 0.08, 'bandpass', 2600, 1400, 0.05, 1.4);
    },
    done: function () {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      bridge.pluck(t, 74, 0.12, 0, 2200, bridge.gSfx);
      bridge.pluck(t + 0.1, 77, 0.12, 0, 2200, bridge.gSfx);
      bridge.pluck(t + 0.2, 81, 0.13, 0, 2400, bridge.gSfx);
      bridge.bellTone(bridge.gSfx, t + 0.3, 1760, 0.05, 1.2, 0);
    },
    demolish: function () {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      bridge.playNoise(bridge.gSfx, t, 0.5, 'lowpass', 420, 90, 0.16, 0.5);
      bridge.thump(t + 0.05, 0, 110, 0.2);
      bridge.playNoise(bridge.gSfx, t + 0.18, 0.3, 'lowpass', 300, 90, 0.1, 0.5);
      bridge.playNoise(bridge.gSfx, t, 0.06, 'highpass', 2500, 0, 0.06, 1);
    },
    man: function () {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      var o = bridge.AC.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.linearRampToValueAtTime(228, t + 0.3);
      var o2 = bridge.AC.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.setValueAtTime(330, t);
      o2.frequency.linearRampToValueAtTime(336, t + 0.3);
      var flt = bridge.AC.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 1200;
      var gn = bridge.AC.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.06, t + 0.08);
      gn.gain.setValueAtTime(0.06, t + 0.26);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(flt);
      o2.connect(flt);
      flt.connect(gn);
      gn.connect(bridge.gSfx);
      o.start(t);
      o.stop(t + 0.6);
      o2.start(t);
      o2.stop(t + 0.6);
      bridge.disposeAudio([o, o2], [flt, gn]);
    },
    gone: function () {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      bridge.playOsc(bridge.gSfx, t, 'sine', 110, 44, 0.5, 0.09);
      bridge.playNoise(bridge.gSfx, t, 0.4, 'lowpass', 260, 80, 0.07, 0.6);
    },
    road: function (n) {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      var k = Math.min(6, n || 1);
      for (var i = 0; i < k; i++) {
        var f = 300 + i * 60;
        bridge.playNoise(bridge.gSfx, t + i * 0.055, 0.04, 'bandpass', f + 900, 0, 0.05, 2);
        bridge.thump(t + i * 0.055, 0, 190, 0.08);
      }
    },
    coin: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      bridge.bellTone(bridge.gSfx, t, 1318, 0.075, 0.7, p);
      bridge.bellTone(bridge.gSfx, t + 0.07, 1760, 0.06, 0.8, p);
      bridge.playNoise(bridge.gSfx, t, 0.05, 'highpass', 6000, 0, 0.028, 1);
    },
    chainStart: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime,
        pn = bridge.busPan(bridge.gSfx, panOf(wx));
      bridge.playOsc(pn, t, 'triangle', 523, 523, 0.12, 0.045);
      var tail = bridge.playOsc(pn, t + 0.1, 'triangle', 784, 784, 0.2, 0.04);
      tail.addEventListener('ended', function () {
        if (pn !== bridge.gSfx) pn.disconnect();
      });
    },
    chainBlocked: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime,
        pn = bridge.busPan(bridge.gSfx, panOf(wx));
      // A soft falling pair, not the harsh placement-failure alarm.
      bridge.playOsc(pn, t, 'triangle', 233, 233, 0.16, 0.04);
      var tail = bridge.playOsc(pn, t + 0.13, 'triangle', 196, 196, 0.22, 0.035);
      tail.addEventListener('ended', function () {
        if (pn !== bridge.gSfx) pn.disconnect();
      });
    },
    chainRecovered: function (wx, _wy) {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      bridge.bellTone(bridge.gSfx, t, 659, 0.035, 0.45, p);
      bridge.bellTone(bridge.gSfx, t + 0.12, 880, 0.025, 0.55, p);
    },
    hammer: function (wx, wy) {
      if (!industrialAudio('hammer', wx, wy, 0.22)) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      bridge.playNoise(bridge.gSfx, t, 0.035, 'bandpass', 3000, 1200, 0.045, 2);
      bridge.thump(t, p, 210, 0.09);
    },
    chop: function (wx, wy) {
      if (!industrialAudio('chop', wx, wy, 0.25)) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      bridge.playNoise(bridge.gSfx, t, 0.07, 'bandpass', 1300, 500, 0.07, 1.5);
      bridge.thump(t, p, 240, 0.1);
    },
    saw: function (wx, wy) {
      if (!industrialAudio('saw', wx, wy, 0.5)) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      var pn = bridge.busPan(bridge.gSfx, p);
      bridge.playNoise(pn, t, 0.3, 'bandpass', 1500, 650, 0.07, 1.4);
      bridge.playOsc(pn, t, 'sawtooth', 115, 88, 0.28, 0.028);
      var tail = bridge.playNoise(pn, t + 0.31, 0.12, 'bandpass', 1100, 500, 0.045, 1.4);
      tail.addEventListener('ended', function () {
        if (pn !== bridge.gSfx) pn.disconnect();
      });
    },
    clang: function (wx, wy) {
      if (!industrialAudio('clang', wx, wy, 0.3)) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      bridge.bellTone(bridge.gSfx, t, 728, 0.09, 0.14, p);
      bridge.bellTone(bridge.gSfx, t, 1097, 0.045, 0.1, p);
      bridge.thump(t, p, 320, 0.09);
      bridge.playNoise(bridge.gSfx, t, 0.025, 'highpass', 4200, 0, 0.04, 1);
    },
    forge: function (wx, wy) {
      if (!industrialAudio('forge', wx, wy, 0.75)) return;
      var t = bridge.AC.currentTime,
        p = panOf(wx);
      var pn = bridge.busPan(bridge.gSfx, p);
      var src = bridge.AC.createBufferSource();
      src.buffer = bridge.noiseB;
      src.loop = true;
      var flt = bridge.AC.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(700, t);
      flt.frequency.linearRampToValueAtTime(1600, t + 0.22);
      flt.frequency.linearRampToValueAtTime(300, t + 0.5);
      var gn = bridge.AC.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.055, t + 0.18);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      src.connect(flt);
      flt.connect(gn);
      gn.connect(pn);
      src.start(t);
      src.stop(t + 0.55);
      bridge.disposeAudio([src], [flt, gn, bridge.ownPanner(pn, bridge.gSfx)]);
      bridge.bellTone(bridge.gSfx, t + 0.3, 1568, 0.05, 0.4, p);
      bridge.bellTone(bridge.gSfx, t + 0.3, 2352, 0.022, 0.28, p);
    },
    fanfare: function () {
      if (!sfxCanPlay()) return;
      var t = bridge.AC.currentTime;
      runtime.duckMusic(t);
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
        var flt = bridge.AC.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = 2400;
        var gn = bridge.AC.createGain();
        gn.gain.setValueAtTime(0.0001, tt);
        gn.gain.linearRampToValueAtTime(0.085, tt + 0.03);
        gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.6);
        var o = bridge.AC.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = bridge.mtof(m);
        var o2 = bridge.AC.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.value = bridge.mtof(m) * 1.005;
        o.connect(flt);
        o2.connect(flt);
        flt.connect(gn);
        gn.connect(bridge.gSfx);
        o.start(tt);
        o.stop(tt + 0.7);
        o2.start(tt);
        o2.stop(tt + 0.7);
        bridge.disposeAudio([o, o2], [flt, gn]);
      }
      bridge.bellTone(bridge.gSfx, t + 1.3, 1174, 0.09, 2.2, 0);
      bridge.bellTone(bridge.gSfx, t + 1.42, 1760, 0.07, 2.4, 0);
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
    start(graph: AudioGraph) {
      bridge = getLegacyBridge(graph);
      resetWork();
    },
    dispose() {
      resetWork();
      bridge = null;
    },
  };
}
