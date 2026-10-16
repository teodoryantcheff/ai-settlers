import { requireElement } from './dom.ts';
import type { GameRuntime } from '../runtime.ts';
import { observePresentation } from './domain-feedback.ts';

/** A failed presenter never replaces the live graph or writes a checkpoint. */
export function createRecoveryView(game: GameRuntime): RecoveryViewSubsystem {
  const status = requireElement('recovery-export-status');
  function showGraphicsRecovery(reason: string) {
    game.state.paused = true;
    requireElement('recovery-reason').textContent =
      reason + '. Native WebGL rendering is required.';
    game.closeLayer('recovery-reload-confirmation');
    game.openLayer('renderer-status', { blocking: true, dismissible: false });
    // Alert semantics remain available even though the shared layer manages focus.
    requireElement('renderer-status').setAttribute('role', 'alert');
  }
  requireElement('recovery-export').onclick = () => {
    try {
      const raw = game.exportSave();
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download =
        (game.colonyName + '-' + game.seed).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent =
        'Live colony JSON exported. Keep this file, then import it after reloading. Browser checkpoints were not changed.';
    } catch (error) {
      status.textContent =
        'Export failed: ' +
        (error instanceof Error ? error.message : String(error)) +
        '. Keep this page open to retain the live colony.';
      status.setAttribute('role', 'alert');
    }
  };
  requireElement('recovery-reload').onclick = () => {
    game.openLayer('recovery-reload-confirmation', { blocking: true });
    requireElement('recovery-cancel-reload').focus({ preventScroll: true });
  };
  requireElement('recovery-cancel-reload').onclick = () => {
    game.closeLayer('recovery-reload-confirmation');
  };
  requireElement('recovery-confirm-reload').onclick = () => location.reload();
  observePresentation(game, 'rendererFailed', (event) => showGraphicsRecovery(event.reason));
  return { showGraphicsRecovery };
}
export interface RecoveryViewSubsystem {
  showGraphicsRecovery: (reason: string) => void;
}
