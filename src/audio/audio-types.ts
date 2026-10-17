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
  loadTone?: () => Promise<import('./audio-runtime.ts').ToneApi>;
  readonly audioPhase: 'idle' | 'starting' | 'ready' | 'failed';
  readonly audioGraph: import('./audio-runtime.ts').AudioGraph | null;

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
  readonly gAmb: GainNode | undefined;
  readonly gMusic: GainNode | undefined;
  readonly gSfx: GainNode | undefined;
  readonly industrialVoices: IndustrialVoice[];
  musicBar: number;
}

export interface SoundCatalog {
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
}
