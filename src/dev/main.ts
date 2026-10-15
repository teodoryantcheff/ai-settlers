import { bootGame, reportBootError } from '../bootstrap.ts';
import { runScenarios } from './scenarios.ts';
import { mountUIPrototype } from './ui-prototype.ts';
import { preparePrototypeMap } from './ui-prototype-map.ts';

if (new URLSearchParams(location.search).has('uiPrototype')) {
  mountUIPrototype();
} else {
  bootGame()
    .then((game) => {
      if (new URLSearchParams(location.search).has('uiPrototypeMap')) preparePrototypeMap(game);
      else runScenarios(game);
      (window as unknown as Record<string, unknown>)['productionArtPreview'] = {
        game,
        canvas: document.getElementById('pixi-view'),
      };
    })
    .catch(reportBootError);
}
