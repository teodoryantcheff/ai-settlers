import { createEngine } from './simulation/engine.ts';
import { assemblePresentation } from './application/assembly.ts';
import type { RendererPresentation } from './rendering/renderer.ts';
import type { GameRuntime } from './runtime.ts';

/** Assemble before starting: no module starts a frame loop when imported. */
export function createGame(presentation: RendererPresentation): GameRuntime {
  const search = location.search;
  const seedMatch = search.match(/[?&]seed=(\d+)/);
  const seed = seedMatch ? +seedMatch[1] | 0 : (Math.random() * 1e9) | 0;
  const game = createEngine({
    seed,
    search: search + (/[?&]seed=/.test(search) ? '' : '&seed=' + seed),
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
  }) as GameRuntime;
  assemblePresentation(game, { presentation });
  return game;
}
