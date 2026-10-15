import { paintUtilityArtwork } from './ui/utility-art.ts';
import { createGame } from './app.ts';
import { loadPaintedAssets } from './rendering/painted-assets.ts';
import { createPixiRenderer } from './rendering/pixi-renderer.ts';
import type { GameRuntime } from './runtime.ts';

async function stage(number: number, message: string) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.dataset.stage = String(number);
  document.getElementById('boot-stage').textContent = message;
  for (const item of boot.querySelectorAll<HTMLElement>('[data-boot-stage]')) {
    item.classList.toggle('complete', Number(item.dataset.bootStage) < number);
    if (Number(item.dataset.bootStage) === number) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  // Yield a task so the stage is paintable before synchronous artwork/terrain work.
  await new Promise((resolve) => setTimeout(resolve, 0));
}
/** Install artwork atomically before the first world paint, then start native WebGL play. */
export async function bootGame(): Promise<GameRuntime> {
  await stage(1, 'Checking WebGL graphics…');
  let presenter: Awaited<ReturnType<typeof createPixiRenderer>>;
  try {
    presenter = await createPixiRenderer();
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
  let game: GameRuntime;
  try {
    await stage(2, 'Preparing colony systems and standard artwork…');
    game = createGame(presenter.presentation);
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
    if (game?.buildings.length) {
      document.getElementById('boot')?.remove();
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
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.setAttribute('role', 'alert');
  boot.dataset.stage = 'failed';
  document.getElementById('boot-stage').textContent =
    error instanceof Error ? error.message : 'The village could not start. Reload to try again.';
  document.getElementById('boot-progress').hidden = true;
  document.getElementById('boot-error-controls').hidden = false;
  document.getElementById('boot-error-controls').querySelector('p').textContent =
    document.documentElement.dataset.renderer === 'unavailable'
      ? 'Enable hardware acceleration or use a WebGL-capable browser, then reload. Existing browser checkpoints are retained.'
      : 'The colony could not finish initializing. Reload to retry. Existing browser checkpoints are retained; no incomplete colony replaces them.';
  document.getElementById('boot-reload').onclick = () => location.reload();
}
