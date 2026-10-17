import { bootGame, reportBootError } from '../bootstrap.ts';
import type { PersistenceInternals } from '../core/persistence.ts';
import { paintedRegions, scanPaintedCrop } from '../rendering/painted-crop.ts';
import { runScenarios } from './scenarios.ts';
import { createTestReset } from './test-reset.ts';
import { mountUIPrototype } from './ui-prototype.ts';
import { preparePrototypeMap } from './ui-prototype-map.ts';

if (new URLSearchParams(location.search).has('uiPrototype')) {
  mountUIPrototype();
} else {
  // Filled by the persistence factory; development builds only.
  const persistence = {} as PersistenceInternals;
  bootGame(persistence)
    .then((game) => {
      if (new URLSearchParams(location.search).has('uiPrototypeMap')) preparePrototypeMap(game);
      else runScenarios(game);
      (window as unknown as Record<string, unknown>)['productionArtPreview'] = {
        game,
        canvas: document.getElementById('pixi-view'),
        // The offline crop rule, so browser tests can re-check the manifest.
        paintedRegions,
        scanPaintedCrop,
        // Shared browser-test pages return to their booted state between tests.
        resetForTest: createTestReset(game, persistence),
      };
    })
    .catch(reportBootError);
}
