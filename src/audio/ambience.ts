import type { GameRuntime } from '../runtime.ts';
import type { AudioGraph, AudioRuntime } from './audio-runtime.ts';
import type { AudioInternals } from './audio-types.ts';
import { getLegacyBridge, type LegacyBridge } from './legacy-bridge.ts';
export function createAmbience(
  game: GameRuntime,
  runtime: AudioRuntime,
  internals?: AudioInternals,
) {
  let bridge: LegacyBridge = null;
  const audioCanPlay = () => runtime.canPlay();
  const sfxCanPlay = () => runtime.canPlay('effects');
  // ---------- AMBIENCE ----------
  var rainG: GainNode = null,
    birdT = 0,
    waterG: GainNode = null,
    ambT = 0;
  function startAmbience() {
    // wind bed
    var src = bridge.AC.createBufferSource();
    src.buffer = bridge.noiseB;
    src.loop = true;
    var flt = bridge.AC.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 320;
    flt.Q.value = 0.4;
    var gn = bridge.AC.createGain();
    gn.gain.value = 0.014;
    var lfo = bridge.AC.createOscillator();
    lfo.frequency.value = 0.07;
    var lg = bridge.AC.createGain();
    lg.gain.value = 0.009;
    lfo.connect(lg);
    lg.connect(gn.gain);
    src.connect(flt);
    flt.connect(gn);
    gn.connect(bridge.gAmb);
    src.start();
    lfo.start();
    // water lap (gain follows how much water is on screen)
    var ws = bridge.AC.createBufferSource();
    ws.buffer = bridge.noiseB;
    ws.loop = true;
    ws.playbackRate.value = 0.7;
    var wf = bridge.AC.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 640;
    wf.Q.value = 1.6;
    waterG = bridge.AC.createGain();
    waterG.gain.value = 0;
    ws.connect(wf);
    wf.connect(waterG);
    waterG.connect(bridge.gAmb);
    ws.start();
    var wlfo = bridge.AC.createOscillator();
    wlfo.frequency.value = 0.24;
    var wlg = bridge.AC.createGain();
    wlg.gain.value = 14;
    wlfo.connect(wlg);
    wlg.connect(wf.frequency);
    wlfo.start();
    // rain bed (gain follows the weather system's rainAmt(), see 40_render)
    var rs = bridge.AC.createBufferSource();
    rs.buffer = bridge.noiseB;
    rs.loop = true;
    rs.playbackRate.value = 1.3;
    var rf = bridge.AC.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 2400;
    rf.Q.value = 0.35;
    rainG = bridge.AC.createGain();
    rainG.gain.value = 0;
    rs.connect(rf);
    rf.connect(rainG);
    rainG.connect(bridge.gAmb);
    rs.start();
    birdT = 3 + Math.random() * 6;
  }
  function cricketChirp() {
    if (!audioCanPlay() || !runtime.canPlay('ambience')) return;
    var t = bridge.AC.currentTime,
      pan = Math.random() * 1.4 - 0.7;
    var n = 3 + ((Math.random() * 4) | 0),
      f = 4200 + Math.random() * 500;
    var pn = bridge.busPan(bridge.gAmb, pan);
    var sources = [],
      nodes = [bridge.ownPanner(pn, bridge.gAmb)];
    for (var i = 0; i < n; i++) {
      var tt = t + i * 0.11;
      var o = bridge.AC.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      var gn = bridge.AC.createGain();
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
    bridge.disposeAudio(sources, nodes);
  }
  function owlHoot() {
    if (!audioCanPlay() || !runtime.canPlay('ambience')) return;
    var t = bridge.AC.currentTime,
      pan = Math.random() * 1.2 - 0.6,
      f = 340 + Math.random() * 30;
    var pn = bridge.busPan(bridge.gAmb, pan);
    var sources = [],
      nodes = [bridge.ownPanner(pn, bridge.gAmb)];
    for (var i = 0; i < 2; i++) {
      var tt = t + i * 0.62,
        o = bridge.AC.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, tt);
      o.frequency.linearRampToValueAtTime(f * 0.88, tt + 0.32);
      var gn = bridge.AC.createGain();
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
    bridge.disposeAudio(sources, nodes);
  }
  function birdChirp() {
    if (!audioCanPlay() || !runtime.canPlay('ambience')) return;
    var t = bridge.AC.currentTime,
      pan = Math.random() * 1.6 - 0.8;
    var n = 2 + ((Math.random() * 4) | 0);
    for (var i = 0; i < n; i++) {
      var f0 = 2100 + Math.random() * 1600,
        f1 = f0 * (0.7 + Math.random() * 0.6);
      var o = bridge.AC.createOscillator();
      o.type = 'sine';
      var tt = t + i * (0.09 + Math.random() * 0.07);
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f1, tt + 0.05);
      var gn = bridge.AC.createGain();
      gn.gain.setValueAtTime(0.0001, tt);
      gn.gain.linearRampToValueAtTime(0.016, tt + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.06);
      var pn = bridge.busPan(bridge.gAmb, pan);
      o.connect(gn);
      gn.connect(pn);
      o.start(tt);
      o.stop(tt + 0.09);
      bridge.disposeAudio([o], [gn, bridge.ownPanner(pn, bridge.gAmb)]);
    }
  }
  function ambTick(dt: number) {
    if (!bridge || bridge.AC.state !== 'running' || document.visibilityState === 'hidden') return;
    ambT -= dt;
    if (birdT > 0) birdT -= dt;
    else {
      if (runtime.canPlay('ambience')) {
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
    waterG.gain.setTargetAtTime(target, bridge.AC.currentTime, 0.8);
    if (rainG) rainG.gain.setTargetAtTime(game.rainAmt() * 0.05, bridge.AC.currentTime, 0.9);
  }

  function thunder() {
    if (!sfxCanPlay()) return;
    var t = bridge.AC.currentTime;
    bridge.playNoise(bridge.gSfx, t, 1.6, 'lowpass', 170, 55, 0.2, 0.4);
    bridge.playNoise(bridge.gSfx, t + 0.12, 1.1, 'lowpass', 120, 45, 0.13, 0.4);
    bridge.playOsc(bridge.gSfx, t, 'sine', 54, 38, 1.2, 0.1);
  }

  if (internals) Object.assign(internals, { birdChirp, cricketChirp, owlHoot });
  return {
    tick: ambTick,
    thunder,
    start(graph: AudioGraph) {
      bridge = getLegacyBridge(graph);
      startAmbience();
    },
    dispose() {
      bridge = null;
      rainG = waterG = null;
      birdT = ambT = 0;
    },
  };
}
