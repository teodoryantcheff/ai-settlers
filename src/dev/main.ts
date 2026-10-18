import type { RendererInternals } from '../rendering/renderer.ts';
import type { PixiRendererInternals } from '../rendering/pixi-renderer.ts';
import { bootGame, reportBootError } from '../bootstrap.ts';
import type { DevInternals } from '../app.ts';
import type { PersistenceInternals } from '../core/persistence.ts';
import type { HudInternals } from '../ui/hud.ts';
import { paintedRegions, scanPaintedCrop } from '../rendering/painted-crop.ts';
import { runScenarios } from './scenarios.ts';
import { createTestReset } from './test-reset.ts';
import { mountUIPrototype } from './ui-prototype.ts';
import { preparePrototypeMap } from './ui-prototype-map.ts';
import { mountGraphicsPrototype } from './graphics-prototype.ts';
import { mountGraphicsPrototype as mountFirstGraphicsPrototype } from './graphics-prototype-round-one.ts';

if (new URLSearchParams(location.search).has('uiPrototype')) {
  mountUIPrototype();
} else {
  // Filled by the persistence and HUD factories; development builds only.
  const internals = {
    persistence: {} as PersistenceInternals,
    hud: {} as HudInternals,
    pixi: {} as PixiRendererInternals,
    renderer: {} as RendererInternals,
  } satisfies DevInternals;
  bootGame(internals)
    .then(async (game) => {
      if (new URLSearchParams(location.search).has('graphicsPrototype')) {
        const mount =
          new URLSearchParams(location.search).get('round') === '1'
            ? mountFirstGraphicsPrototype
            : mountGraphicsPrototype;
        await mount(game, internals);
      } else if (new URLSearchParams(location.search).has('uiPrototypeMap'))
        preparePrototypeMap(game);
      else runScenarios(game);
      (window as unknown as Record<string, unknown>)['productionArtPreview'] = {
        game,
        internals,
        canvas: document.getElementById('pixi-view'),
        // The offline crop rule, so browser tests can re-check the manifest.
        paintedRegions,
        scanPaintedCrop,
        // Shared browser-test pages return to their booted state between tests.
        resetForTest: createTestReset(game, internals),
      };
    })
    .catch(reportBootError);
}
