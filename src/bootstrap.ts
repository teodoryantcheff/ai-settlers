import { MissingElementError, PAGE_ELEMENT_IDS, requireElement } from './ui/dom.ts';
import { paintUtilityArtwork } from './ui/utility-art.ts';
import { createGame, type DevInternals } from './app.ts';
import { loadPaintedAssets } from './rendering/painted-assets.ts';
import { createPixiRenderer } from './rendering/pixi-renderer.ts';
import type { GameRuntime } from './runtime.ts';

async function stage(number: number, message: string) {
  const boot = requireElement('boot');
  boot.dataset.stage = String(number);
  requireElement('boot-stage').textContent = message;
  for (const item of boot.querySelectorAll<HTMLElement>('[data-boot-stage]')) {
    item.classList.toggle('complete', Number(item.dataset.bootStage) < number);
    if (Number(item.dataset.bootStage) === number) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  // Yield a task so the stage is paintable before synchronous artwork/terrain work.
  await new Promise((resolve) => setTimeout(resolve, 0));
}
/**
 * Install artwork atomically before the first world paint, then start native WebGL play.
 * Only the development bundle passes `internals`; the release boots without.
 */
export async function bootGame(internals?: DevInternals): Promise<GameRuntime> {
  for (const id of PAGE_ELEMENT_IDS) requireElement(id);
  await stage(1, 'Checking WebGL graphics…');
  let presenter: Awaited<ReturnType<typeof createPixiRenderer>>;
  try {
    presenter = await createPixiRenderer(internals?.pixi);
  } catch (error) {
    document.documentElement.dataset.renderer = 'unavailable';
    (window as unknown as Record<string, unknown>)['productionRendererStats'] = {
      backend: 'unavailable',
      error: 'WebGL unavailable',
    };
    throw new Error(
      'WebGL is required to play. Enable hardware acceleration or use a WebGL-capable browser.',
      { cause: error },
    );
  }
  let game: GameRuntime | undefined;
  try {
    await stage(2, 'Preparing colony systems and settler artwork…');
    game = createGame(presenter.presentation, internals);
    await stage(3, 'Loading and validating painted artwork…');
    await loadPaintedAssets(game);
    paintUtilityArtwork(game);
    presenter.attach(game);
    document.documentElement.dataset.renderer = 'pixi';
    await stage(4, 'Initializing the colony, terrain and interface…');
    game.init();
    return game;
  } catch (error) {
    presenter.destroy();
    if (game?.buildings.length && !(error instanceof MissingElementError)) {
      document.querySelector('#boot')?.remove();
      document.documentElement.dataset.renderer = 'unavailable';
      game.emitGameEvent('rendererFailed', {
        reason:
          error instanceof Error
            ? error.message
            : 'Colony presentation could not finish initializing',
      });
    }
    throw error;
  }
}
export function reportBootError(error: unknown) {
  console.error(error);
  // A failed initial world paint can already have opened live-colony export recovery.
  if (
    !(error instanceof MissingElementError) &&
    document.querySelector('#renderer-status:not(.hidden)')
  )
    return;
  const message =
    error instanceof Error ? error.message : 'The village could not start. Reload to try again.';
  try {
    const boot = requireElement('boot');
    boot.setAttribute('role', 'alert');
    boot.dataset.stage = 'failed';
    requireElement('boot-stage').textContent = message;
    requireElement('boot-progress').hidden = true;
    const controls = requireElement('boot-error-controls');
    controls.hidden = false;
    const explanation = controls.querySelector('p');
    if (!explanation) throw new Error('Missing boot error explanation');
    explanation.textContent =
      document.documentElement.dataset.renderer === 'unavailable'
        ? 'Enable hardware acceleration or use a WebGL-capable browser, then reload. Existing browser checkpoints are retained.'
        : 'The colony could not finish initializing. Reload to retry. Existing browser checkpoints are retained; no incomplete colony replaces them.';
    requireElement('boot-reload').onclick = () => location.reload();
  } catch {
    // Error reporting must work even when the loading screen itself is incomplete.
    const alert =
      document.querySelector<HTMLElement>('#boot-failure') || document.createElement('section');
    alert.id = 'boot-failure';
    alert.setAttribute('role', 'alert');
    Object.assign(alert.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      padding: '3rem',
      background: '#211f16',
      color: '#fff2d3',
      font: '20px/1.5 system-ui',
    });
    alert.textContent = message + '. Existing browser checkpoints are retained. Reload to retry.';
    const reload = document.createElement('button');
    reload.textContent = 'Reload page';
    reload.style.display = 'block';
    reload.style.marginTop = '1rem';
    reload.onclick = () => location.reload();
    alert.appendChild(reload);
    document.body.appendChild(alert);
  }
}
