import type * as ToneClasses from 'tone/build/esm/classes.js';
import type { setContext } from 'tone/build/esm/core/Global.js';

export type ToneApi = typeof ToneClasses & { setContext: typeof setContext };
export interface Disposable {
  dispose(): unknown;
}
export type AudioChannel = 'effects' | 'music' | 'ambience';
export interface AudioGraph {
  tone: ToneApi;
  context: ToneClasses.Context;
  channels: Record<AudioChannel | 'master', ToneClasses.Gain>;
}
/** Shared playback lifecycle; categories retain their own musical/cue policy. */
export interface AudioRuntime {
  readonly graph: AudioGraph;
  canPlay(channel?: AudioChannel): boolean;
  immediate(): number;
  guard(effect: () => void): void;
  own<T extends Disposable>(resource: T): T;
  releaseAt(time: number, resources: Disposable[]): void;
  duckMusic(time: number): void;
}
