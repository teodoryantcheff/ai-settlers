import type { GameRuntime } from '../runtime.ts';
import type {
  AudioChannel,
  AudioGraph,
  AudioRuntime,
  Disposable,
  ToneApi,
} from './audio-runtime.ts';
import type { AudioInternals, SoundCatalog } from './audio-types.ts';
import { createInterfaceSounds } from './interface-sounds.ts';
import { createWorldEffects } from './world-effects.ts';
import { createAmbience } from './ambience.ts';
import { createMusic } from './music.ts';
export type {
  AudioInternals,
  MusicChord,
  MusicTheme,
  MusicColonyState,
  MusicArrangement,
  IndustrialVoice,
} from './audio-types.ts';

// Tone 15.1.22's top-level entrypoint eagerly constructs deprecated global
// context exports. Load its pinned class entrypoint so construction failures
// stay inside a retryable attempt rather than poisoning the module cache.
async function loadTone(): Promise<ToneApi> {
  const [classes, global] = await Promise.all([
    import('tone/build/esm/classes.js'),
    import('tone/build/esm/core/Global.js'),
  ]);
  return { ...classes, setContext: global.setContext };
}

export function createAudio(game: GameRuntime, internals?: AudioInternals): AudioSubsystem {
  const load = internals?.loadTone ?? loadTone;
  if (internals) delete internals.loadTone;
  let graph: AudioGraph = null;
  let context: AudioGraph['context'] = null;
  let nativeContext: AudioContext = null;
  let phase: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';
  let muted = false,
    musicOn = true,
    musVol = 0.42,
    sfxVol = 0.9,
    ambVol = 0.5;
  let startup: Promise<void> = null,
    transition: Promise<void> = null;
  let cleanup: Promise<void> = Promise.resolve();
  let pageAway = false,
    playbackVersion = 0,
    failureNotified = false;
  const owned = new Set<Disposable>();
  const releases = new Set<number>();
  const visible = () =>
    !pageAway && (typeof document === 'undefined' || document.visibilityState !== 'hidden');

  function canPlay(channel?: AudioChannel) {
    return (
      phase === 'ready' &&
      !!graph &&
      context.state === 'running' &&
      visible() &&
      !muted &&
      (channel === 'effects'
        ? sfxVol > 0
        : channel === 'music'
          ? musicOn && musVol > 0
          : channel === 'ambience'
            ? ambVol > 0
            : true)
    );
  }
  function release(resources: Disposable[]) {
    for (const resource of resources) {
      if (!owned.delete(resource)) continue;
      try {
        resource.dispose();
      } catch {
        /* Cleanup must not interrupt gameplay. */
      }
    }
  }
  const runtime: AudioRuntime = {
    get graph() {
      return graph;
    },
    canPlay,
    immediate: () => context?.immediate() ?? 0,
    guard(effect) {
      try {
        effect();
      } catch (error) {
        fail(error);
      }
    },
    own(resource) {
      owned.add(resource);
      return resource;
    },
    releaseAt(time, resources) {
      const owner = context;
      const id = owner.setTimeout(
        () => {
          releases.delete(id);
          release(resources);
        },
        Math.max(0, time - owner.immediate()) + 0.05,
      );
      releases.add(id);
    },
    duckMusic(t) {
      const gain = graph.channels.music.gain;
      gain.cancelAndHoldAtTime(t);
      const level = musicOn ? musVol : 0;
      gain.linearRampToValueAtTime(level * 0.25, t + 0.18);
      gain.setValueAtTime(level * 0.25, t + 2.1);
      gain.linearRampToValueAtTime(level, t + 3.4);
    },
  };
  const world = createWorldEffects(game, runtime, internals);
  const ambience = createAmbience(game, runtime, internals);
  const music = createMusic(game, runtime, internals);
  const catalog = { ...createInterfaceSounds(runtime), ...world.sounds, thunder: ambience.thunder };
  const SND: SoundCatalog = { ...catalog };
  for (const name of Object.keys(SND) as (keyof SoundCatalog)[]) {
    const sound = SND[name];
    Object.defineProperty(SND, name, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: (...args: number[]) => {
        if (canPlay('effects'))
          runtime.guard(() => (sound as (...values: number[]) => void)(...args));
      },
    });
  }

  function disposeGraph() {
    const old = context;
    const native = nativeContext;
    nativeContext = null;
    graph = null;
    context = null;
    transition = null;
    for (const category of [music, ambience, world]) {
      try {
        category.dispose();
      } catch {
        /* Dispose the remaining graph too. */
      }
    }
    if (old)
      for (const id of releases) {
        try {
          old.clearTimeout(id);
        } catch {}
      }
    releases.clear();
    release([...owned].reverse());
    cleanup = (async () => {
      try {
        await old?.close();
      } catch {
        /* A broken context still needs disposal. */
      }
      // Native ownership starts before Tone's constructor, which can throw after
      // allocating browser resources but before returning a wrapper to dispose.
      try {
        if (native && native.state !== 'closed') await native.close();
      } catch {}
      try {
        old?.dispose();
      } catch {}
    })();
  }
  function fail(_error: unknown) {
    if (phase === 'failed') return;
    phase = 'failed';
    disposeGraph();
    if (!failureNotified) {
      failureNotified = true;
      try {
        game.msg?.('Audio unavailable. Use the music or mute controls to retry.');
      } catch {}
    }
  }
  function gain(channel: AudioChannel | 'master', target: number, fade: number) {
    if (!graph) return;
    const value = graph.channels[channel].gain,
      t = context.immediate();
    value.cancelAndHoldAtTime(t);
    value.setTargetAtTime(target, t, fade);
  }
  function applyMusic() {
    gain('music', musicOn ? musVol : 0, 0.1);
  }
  function playback() {
    if (!visible()) runtime.guard(() => music.suspend());
    if (!graph || phase !== 'ready') return Promise.resolve();
    if (transition) return transition;
    const owner = context;
    let appliedVersion = -1;
    let pending: Promise<void>;
    pending = (async () => {
      while (graph && context === owner && phase === 'ready') {
        const version = playbackVersion;
        if (visible()) {
          if (owner.state === 'closed') throw new Error('Audio context closed');
          if (owner.state !== 'running') await owner.resume();
          if (context === owner && phase === 'ready' && version === playbackVersion && visible())
            music.resume();
        } else {
          music.suspend();
          if (owner.state !== 'suspended') await (owner.rawContext as AudioContext).suspend();
        }
        appliedVersion = version;
        await Promise.resolve();
        if (version === playbackVersion) break;
      }
    })()
      .catch((error) => {
        if (context === owner) fail(error);
      })
      .finally(() => {
        if (transition !== pending) return;
        transition = null;
        if (context === owner && phase === 'ready' && appliedVersion !== playbackVersion)
          return playback();
      });
    transition = pending;
    return pending;
  }
  function initAudio(): Promise<void> {
    if (startup) return startup;
    if (phase === 'ready') {
      if (context.state !== 'closed') return playback();
      fail(new Error('Audio context closed'));
    }
    phase = 'starting';
    startup = (async () => {
      await cleanup;
      const tone = await load();
      const BrowserAudioContext =
        typeof window === 'undefined'
          ? null
          : window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!BrowserAudioContext) throw new Error('Browser audio is unavailable');
      nativeContext = new BrowserAudioContext({ latencyHint: 'interactive' });
      context = new tone.Context({ context: nativeContext });
      tone.setContext(context);
      if (visible()) {
        await context.resume();
        if (context.state !== 'running') throw new Error('Audio could not start');
      }
      const compressor = runtime.own(
        new tone.Compressor({
          context,
          threshold: -20,
          knee: 18,
          ratio: 5,
          attack: 0.004,
          release: 0.24,
        }),
      );
      compressor.connect(context.destination);
      const master = runtime.own(new tone.Gain({ context, gain: muted ? 0 : 0.9 }));
      master.connect(compressor);
      const effects = runtime.own(new tone.Gain({ context, gain: sfxVol }));
      effects.connect(master);
      const score = runtime.own(new tone.Gain({ context, gain: musicOn ? musVol : 0 }));
      score.connect(master);
      const bed = runtime.own(new tone.Gain({ context, gain: ambVol }));
      bed.connect(master);
      graph = { tone, context, channels: { master, effects, music: score, ambience: bed } };
      world.start(graph);
      ambience.start(graph);
      music.start(graph);
      phase = 'ready';
      failureNotified = false;
      await playback();
    })()
      .catch(fail)
      .finally(() => {
        startup = null;
      });
    return startup;
  }
  function visibility() {
    playbackVersion++;
    void playback();
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', () => {
      pageAway = false;
      visibility();
    });
    window.addEventListener('pagehide', () => {
      pageAway = true;
      visibility();
    });
  }
  function audioVolume(value: number) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }
  function retryOrResume() {
    if (phase === 'idle' || phase === 'failed') void initAudio();
    else if (phase === 'ready') void playback();
  }
  function setMusicVol(on: boolean) {
    musicOn = !!on;
    playbackVersion++;
    runtime.guard(applyMusic);
    if (musicOn) retryOrResume();
    else runtime.guard(() => music.suspend());
  }
  function setMusVol(value: number) {
    musVol = audioVolume(value);
    playbackVersion++;
    runtime.guard(applyMusic);
    if (musVol <= 0) runtime.guard(() => music.suspend());
    else if (phase === 'ready') void playback();
  }
  function setSfxVol(value: number) {
    sfxVol = audioVolume(value);
    runtime.guard(() => gain('effects', sfxVol, 0.1));
    if (sfxVol === 0) world.resetWork();
    if (phase === 'failed') void initAudio();
  }
  function setAmbVol(value: number) {
    ambVol = audioVolume(value);
    runtime.guard(() => gain('ambience', ambVol, 0.25));
    if (phase === 'failed') void initAudio();
  }
  function setMuted(value: boolean) {
    muted = !!value;
    playbackVersion++;
    runtime.guard(() => {
      gain('master', muted ? 0 : 0.9, 0.15);
      applyMusic();
    });
    if (muted) {
      world.resetWork();
      runtime.guard(() => music.suspend());
    } else retryOrResume();
  }
  if (internals) {
    Object.assign(internals, { audioCanPlay: canPlay });
    Object.defineProperties(internals, {
      audioPhase: { get: () => phase, enumerable: true },
      audioGraph: { get: () => graph, enumerable: true },
      gAmb: { get: () => graph?.channels.ambience.input, enumerable: true },
      gMusic: { get: () => graph?.channels.music.input, enumerable: true },
      gSfx: { get: () => graph?.channels.effects.input, enumerable: true },
    });
  }
  return {
    get AC() {
      return (context?.rawContext as AudioContext) ?? null;
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
    set musVol(value: number) {
      musVol = audioVolume(value);
      playbackVersion++;
    },
    get sfxVol() {
      return sfxVol;
    },
    set sfxVol(value: number) {
      sfxVol = audioVolume(value);
    },
    get ambVol() {
      return ambVol;
    },
    set ambVol(value: number) {
      ambVol = audioVolume(value);
    },
    initAudio,
    SND,
    ambTick(dt: number) {
      if (phase === 'ready') runtime.guard(() => ambience.tick(dt));
    },
    setMusicVol,
    setMusVol,
    setSfxVol,
    setAmbVol,
    setMuted,
  };
}

export interface AudioSubsystem {
  readonly AC: AudioContext;
  readonly muted: boolean;
  readonly musicOn: boolean;
  musVol: number;
  sfxVol: number;
  ambVol: number;
  initAudio: () => Promise<void>;
  readonly SND: SoundCatalog;
  ambTick: (dt: number) => void;
  setMusicVol: (on: boolean) => void;
  setMusVol: (v: number) => void;
  setSfxVol: (v: number) => void;
  setAmbVol: (v: number) => void;
  setMuted: (m: boolean) => void;
}
