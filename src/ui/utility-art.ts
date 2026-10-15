import type { GameRuntime } from '../runtime.ts';
import type { BuildingType } from '../types.ts';

/** Paint fixed utility illustrations once, from the atomically installed art atlas. */
export function paintUtilityArtwork(game: GameRuntime) {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-session-art]')) {
    const type = canvas.dataset.sessionArt as BuildingType;
    const context = canvas.getContext('2d');
    if (!context || !game.ART.bld[type]) continue;
    game.drawSpriteIcon(context, type, canvas.width / 2, canvas.height / 2, 64);
  }
}
