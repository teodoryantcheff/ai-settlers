import { html as markup, trusted } from './markup.ts';
import type { GameRuntime } from '../runtime.ts';

/** Pointer-safe evidence snapshots; rules and live evidence stay with their existing views. */
export function createPlacementFeedback(game: GameRuntime): PlacementFeedback {
  const panel = document.getElementById('placement-feedback');
  let reading = false;
  let html = '';
  let location = '';
  let owner = '';
  const tool = () =>
    game.mode ? game.mode.type + (game.mode.type === 'build' ? ':' + game.mode.bt : '') : '';
  function clear() {
    if (!panel) return;
    if ((reading || panel.contains(document.activeElement)) && html && owner && owner === tool()) {
      const note = panel.querySelector<HTMLElement>('.placement-snapshot');
      if (note) note.hidden = false;
      return;
    }
    panel.hidden = true;
    html = '';
    location = '';
    owner = '';
  }
  panel?.addEventListener('pointerenter', () => {
    reading = true;
    clear();
  });
  panel?.addEventListener('pointerleave', () => {
    reading = false;
    clear();
  });
  panel?.addEventListener('focusin', clear);
  panel?.addEventListener('focusout', () => queueMicrotask(clear));
  for (const type of ['pointerdown', 'mousedown', 'click'])
    panel?.addEventListener(type, (event) => event.stopPropagation());
  return {
    clear,
    show(next, at) {
      if (!panel) return;
      if (reading && html && owner === tool()) {
        clear();
        return;
      }
      if (next !== html || at !== location || owner !== tool()) {
        html = next;
        location = at;
        owner = tool();
        panel.innerHTML = markup`<p class="placement-snapshot" hidden>Snapshot from last map position ${at} · observed at ${game.state.time.toFixed(1)}s. Move back to the map to refresh.</p>${trusted(next)}`;
      }
      panel.hidden = false;
      const note = panel.querySelector<HTMLElement>('.placement-snapshot');
      if (note) note.hidden = true;
    },
  };
}
export interface PlacementFeedback {
  show: (html: string, location: string) => void;
  clear: () => void;
}
