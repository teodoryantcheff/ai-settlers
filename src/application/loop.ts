import { requireElement } from '../ui/dom.ts';
import type { GameRuntime } from '../runtime.ts';
import { observePresentation } from '../ui/domain-feedback.ts';
export function createLoop(game: GameRuntime, internals?: LoopInternals): LoopSubsystem {
  let last = 0,
    simAccumulator = 0,
    autoSaveT = 300;
  let initialized = false;
  const FIXED_STEP = 1 / 60;
  observePresentation(game, 'worldLoaded', () => {
    simAccumulator = 0;
  });
  function frame(ts: number) {
    if (game.renderingAvailable === false) {
      game.state.paused = true;
      last = ts;
      simAccumulator = 0;
      game.resetFps();
      game.hudTick();
      requestAnimationFrame(frame);
      return;
    }
    const dt = last ? Math.max(0, Math.min(0.1, (ts - last) / 1000)) : 0;
    last = ts;
    if (!game.modalOpen() && (!game.workspace || game.workspace === 'map')) game.keyPan(dt);
    game.refreshHover();
    if (!game.state.paused && !game.modalOpen() && document.visibilityState !== 'hidden') {
      simAccumulator += dt * game.state.speed;
      let steps = 0;
      while (simAccumulator + 1e-9 >= FIXED_STEP && steps < 60) {
        game.step(FIXED_STEP, !!game.mode);
        simAccumulator -= FIXED_STEP;
        steps++;
        if (game.state.won && game.modalOpen()) break;
      }
    } else simAccumulator = 0;
    // Presentation observes completed simulation steps, even when audio is muted
    // or not yet unlocked. Paused/modal frames keep its baseline current.
    game.updateEconomicFeedback(ts, !game.modalOpen());
    game.ambTick(dt);
    if (game.started && !game.TESTMODE && !game.modalOpen() && !game.state.paused) {
      autoSaveT -= dt;
      if (autoSaveT <= 0) {
        autoSaveT = 300;
        if (game.saveGame(true)) game.msg('Autosaved');
      }
    }
    // The map remains visible behind presentation overlays, including analysis.
    game.draw();
    game.tooltipTick(game.NOW);
    game.drawMini();
    game.hudTick();
    game.updateFps(ts);
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', function () {
    last = 0;
    simAccumulator = 0;
    game.resetFps();
  });
  function init() {
    if (initialized) return;
    initialized = true;
    const hq = game.initializeColony();
    game.resize();
    game.initSky();
    game.cam.x = hq.x * game.TS - game.vw / game.z / 2;
    game.cam.y = hq.y * game.TS - game.vh / game.z / 2;
    game.clampCam();
    window.addEventListener('resize', game.resize);
    const sizing = new ResizeObserver(game.resize);
    sizing.observe(requireElement('bar'));
    sizing.observe(requireElement('main'));
    const grain = requireElement('grain');
    if (game.ART.grainURL) grain.style.backgroundImage = 'url(' + game.ART.grainURL + ')';
    game.loadPrefs();
    game.resize();
    game.buildPalette();
    game.updateHint();
    requireElement('boot').remove();
    requestAnimationFrame(frame);
  }

  if (internals) {
    Object.assign(internals, { frame });
    Object.defineProperty(internals, 'simAccumulator', {
      get: () => simAccumulator,
      enumerable: true,
    });
  }
  return { init };
}
export interface LoopSubsystem {
  init: () => void;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface LoopInternals {
  frame: (ts: number) => void;
  readonly simAccumulator: number;
}
