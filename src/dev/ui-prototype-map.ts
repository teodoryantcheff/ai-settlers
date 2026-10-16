import type { GameRuntime } from '../runtime.ts';
import type { BuildingType, Good } from '../types.ts';

/** Throwaway, paused display colony. Only the development entry point imports this. */
export function preparePrototypeMap(game: GameRuntime) {
  const style = document.createElement('style');
  style.textContent = `#bar { display:none!important } body > :not(#main):not(script):not(style) { display:none!important }
    #main { top:0!important } #main > :not(#pixi-view) { visibility:hidden!important }
    #pixi-view { visibility:visible!important }`;
  document.head.append(style);
  game.closeLayer('start');
  game.state.paused = true;
  game.presentationPrefs.reducedMotion = true;
  game.presentationPrefs.weather = false;
  game.setMuted(true);
  game.hoverIn = false;
  const layout: [BuildingType, number, number][] = [
    ['warehouse', 44, 49],
    ['farm', 40, 44],
    ['farm', 39, 49],
    ['windmill', 45, 43],
    ['bakery', 51, 44],
    ['well', 50, 48],
    ['bakery', 54, 49],
    ['lumberjack', 41, 37],
    ['forester', 46, 36],
    ['sawmill', 49, 39],
    ['pigfarm', 39, 54],
    ['butcher', 44, 56],
    ['brewery', 52, 53],
    ['workshop', 55, 40],
    ['smelter', 59, 45],
    ['toolsmith', 58, 52],
    ['guard', 61, 39],
  ];
  for (let y = 34; y < 61; y++) {
    for (let x = 35; x < 64; x++) {
      const clear = layout.some(([, bx, by]) => Math.hypot(bx - x, by - y) < 2.6);
      const road =
        (y === 46 && x >= 38 && x <= 60) ||
        (x === 47 && y >= 37 && y <= 57) ||
        (y === 51 && x >= 39 && x <= 58) ||
        (x === 55 && y >= 40 && y <= 53);
      if (!clear && !road) continue;
      const index = game.idx(x, y);
      Object.assign(game.tiles[index], { t: game.GRASS, tree: 0, rock: null, deposit: null, road });
      game.emitGameEvent('tileChanged', { index });
    }
  }
  for (const [type, x, y] of layout) {
    const building = game.newBuilding(type, x, y);
    Object.assign(building, { done: true, constructionProgress: 1 });
    const spec = game.BSPEC[type];
    if (spec.out) building.stock[spec.out] = 3;
    game.buildings.push(building);
  }
  game.units.forEach((unit, index) => {
    unit.x = 43.2 + index * 1.7;
    unit.y = 46.45;
    unit.carry = ['planks', 'grain', 'flour', 'bread'][index % 4] as Good;
  });
  game.recomputeTerritory();
  game.staticDirty = true;
  game.resize();
  game.zi = 5;
  game.z = 1.7;
  game.cam.x = 49.5 * game.TS - game.vw / game.z / 2;
  game.cam.y = 46.5 * game.TS - game.vh / game.z / 2;
  game.clampCam();
  // The embedded map is a display fixture, not an alternate way to change a save.
  window.addEventListener('keydown', (event) => event.stopImmediatePropagation(), true);
}
