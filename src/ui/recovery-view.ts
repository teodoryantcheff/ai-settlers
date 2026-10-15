import type { GameRuntime } from '../runtime.ts';
import { observePresentation } from './domain-feedback.ts';

/** A failed presenter never replaces the live graph or writes a checkpoint. */
export function createRecoveryView(game: GameRuntime): RecoveryViewSubsystem {
  const status = document.getElementById('recovery-export-status');
  function showGraphicsRecovery(reason: string) {
    game.state.paused = true;
    document.getElementById('recovery-reason').textContent =
      reason + '. Native WebGL rendering is required.';
    game.closeLayer('recovery-reload-confirmation');
    game.openLayer('renderer-status', { blocking: true, dismissible: false });
    // Alert semantics remain available even though the shared layer manages focus.
    document.getElementById('renderer-status').setAttribute('role', 'alert');
  }
  document.getElementById('recovery-export').onclick = () => {
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
  document.getElementById('recovery-reload').onclick = () => {
    game.openLayer('recovery-reload-confirmation', { blocking: true });
    document.getElementById('recovery-cancel-reload').focus({ preventScroll: true });
  };
  document.getElementById('recovery-cancel-reload').onclick = () => {
    game.closeLayer('recovery-reload-confirmation');
  };
  document.getElementById('recovery-confirm-reload').onclick = () => location.reload();
  observePresentation(game, 'rendererFailed', (event) => showGraphicsRecovery(event.reason));
  return { showGraphicsRecovery };
}
export interface RecoveryViewSubsystem {
  showGraphicsRecovery: (reason: string) => void;
}
