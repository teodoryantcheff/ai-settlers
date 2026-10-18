import type { RendererInternals } from './rendering/renderer.ts';
import { createEngine } from './simulation/engine.ts';
import { assemblePresentation } from './application/assembly.ts';
import type { RendererPresentation } from './rendering/scene.ts';
import type { GameRuntime } from './runtime.ts';
import type { PersistenceInternals } from './core/persistence.ts';
import type { PixiRendererInternals } from './rendering/pixi-renderer.ts';
import type { HudInternals } from './ui/hud.ts';

/** Test-only hooks the development bundle passes at boot; the release passes none. */
export interface DevInternals {
  persistence?: PersistenceInternals;
  hud?: HudInternals;
  pixi?: PixiRendererInternals;
  renderer?: RendererInternals;
}

/** Assemble before starting: no module starts a frame loop when imported. */
export function createGame(
  presentation: RendererPresentation,
  internals?: DevInternals,
): GameRuntime {
  const search = location.search;
  const seedMatch = search.match(/[?&]seed=(\d+)/);
  const seed = seedMatch ? +seedMatch[1] | 0 : (Math.random() * 1e9) | 0;
  const game = createEngine({
    seed,
    search: search + (/[?&]seed=/.test(search) ? '' : '&seed=' + seed),
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
    },
    persistenceInternals: internals?.persistence,
  }) as GameRuntime;
  assemblePresentation(game, {
    presentation,
    hudInternals: internals?.hud,
    rendererInternals: internals?.renderer,
  });
  return game;
}
