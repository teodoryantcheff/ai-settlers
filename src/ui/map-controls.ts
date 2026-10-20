import { requireElement } from './dom.ts';
import { requireCanvas2D } from '../rendering/canvas-context.ts';
import type { GameRuntime } from '../runtime.ts';
import type { PresentationPreferences } from '../types.ts';

type MapOverlay = PresentationPreferences['overlay'];
const overlays: MapOverlay[] = ['none', 'routes', 'workload', 'reach', 'stalls'];

/** Shared map choice and persistent navigation controls; no world state or rendering decisions. */
export function createMapControls(game: GameRuntime, stopMinimapDrag: () => void) {
  const buttons = [
    ...requireElement('map-modes').querySelectorAll<HTMLButtonElement>('[data-map-overlay]'),
  ];
  const toggle = requireElement('minimap-toggle');
  const mini = requireElement('mini');
  const painted = new WeakSet<HTMLCanvasElement>();
  function update() {
    for (const button of buttons) {
      const selected = button.dataset.mapOverlay === game.presentationPrefs.overlay;
      if (button.getAttribute('aria-pressed') !== String(selected))
        button.setAttribute('aria-pressed', String(selected));
    }
    const visible = game.presentationPrefs.minimapVisible !== false;
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', visible ? 'Collapse minimap' : 'Expand minimap');
    const label = visible ? 'Minimap ▾' : 'Minimap ▸';
    if (toggle.textContent !== label) toggle.textContent = label;
    mini.hidden = !visible;
  }
  function setMapOverlay(overlay: MapOverlay) {
    if (!overlays.includes(overlay)) return;
    game.presentationPrefs.overlay = overlay;
    update();
    game.persistPreferences();
  }
  function paint() {
    for (const button of buttons) {
      const canvas = button.querySelector<HTMLCanvasElement>('canvas');
      if (!canvas || painted.has(canvas)) continue;
      const context = requireCanvas2D(canvas, game.reportGraphicsFailure);
      const mode = button.dataset.mapOverlay;
      if (mode === 'routes') context.drawImage(game.ART.road, 8, 4, 48, 40);
      else
        game.drawSpriteIcon(
          context,
          mode === 'none'
            ? 'hq'
            : mode === 'workload'
              ? 'warehouse'
              : mode === 'reach'
                ? 'lumberjack'
                : 'sawmill',
          32,
          24,
          48,
        );
      if (mode === 'stalls') {
        context.fillStyle = '#9c3827';
        context.fillRect(44, 13, 5, 20);
        context.fillRect(53, 13, 5, 20);
      }
      painted.add(canvas);
    }
  }
  for (const button of buttons)
    button.addEventListener('click', () => setMapOverlay(button.dataset.mapOverlay as MapOverlay));
  toggle.addEventListener('click', () => {
    stopMinimapDrag();
    game.presentationPrefs.minimapVisible = game.presentationPrefs.minimapVisible === false;
    update();
    game.persistPreferences();
  });
  return { update, paint, setMapOverlay };
}
