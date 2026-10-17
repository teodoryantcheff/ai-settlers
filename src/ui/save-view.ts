import { requireElement } from './dom.ts';
import type { GameRuntime } from '../runtime.ts';
import { observePresentation } from './domain-feedback.ts';
import type { SaveMetadata } from '../types.ts';

/** Save workflows keep confirmation, metadata and recovery together; no simulation mutations. */
export function createSaveView(game: GameRuntime): SaveViewSubsystem {
  const panel = requireElement('savedata');
  const list = requireElement('save-list');
  const status = requireElement('save-status');
  const health = requireElement('save-health');
  const recovery = requireElement('save-recovery');
  const colonyName = requireElement('colony-name') as HTMLInputElement;
  const checkpointName = requireElement('checkpoint-name') as HTMLInputElement;
  const renameName = requireElement('rename-checkpoint') as HTMLInputElement;
  const code = requireElement('savecode') as HTMLTextAreaElement;
  let pending: (() => void) | null = null;

  function showStatus(message: string, failed = false) {
    status.textContent = message;
    status.setAttribute('role', failed ? 'alert' : 'status');
    // Import and checkpoint actions can be below the fold in the save manager.
    if (failed)
      panel.scrollTop +=
        status.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        panel.clientHeight / 2;
  }
  function refreshHealth() {
    if (recovery) {
      const wasHidden = recovery.classList.contains('hidden');
      recovery.classList.toggle('hidden', game.saveHealth.ok);
      recovery.textContent = !game.saveHealth.ok
        ? 'Save failed · Export'
        : game.saveHealth.savedAt === null
          ? 'Saves'
          : 'Saves ✓';
      recovery.setAttribute(
        'aria-label',
        game.saveHealth.message + '. Open saves to export current progress.',
      );
      recovery.title = game.saveHealth.message;
      if (wasHidden !== game.saveHealth.ok && game.vw > 0) game.resize?.();
    }
    health.textContent =
      game.saveHealth.message +
      (game.saveHealth.ok
        ? ''
        : ' — Previous valid checkpoints are preserved. Export a file to protect current progress.');
    health.setAttribute('role', game.saveHealth.ok ? 'status' : 'alert');
  }
  function attempt(action: () => void, message?: string) {
    try {
      action();
      if (message) showStatus(message);
      refreshSaveManager();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Save operation failed', true);
      refreshHealth();
    }
  }
  function cancelConfirmation() {
    pending = null;
    game.closeLayer('save-confirm');
  }
  function confirm(message: string, action: () => void, rename = false) {
    pending = action;
    requireElement('save-confirm-text').textContent = message;
    requireElement('rename-label').classList.toggle('hidden', !rename);
    renameName.classList.toggle('hidden', !rename);
    game.openLayer('save-confirm', { blocking: true });
    (rename ? renameName : requireElement('confirm-save-action')).focus();
  }
  function button(label: string, action: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.onclick = () => action();
    return node;
  }
  function download(raw: string, name: string) {
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'colony') + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus('Colony file exported.');
  }
  function entryView(entry: SaveMetadata) {
    const row = document.createElement('article');
    row.className = 'save-entry';
    row.dataset.saveId = entry.id;
    const title = document.createElement('strong');
    title.textContent = entry.name;
    const metadata = document.createElement('p');
    metadata.textContent =
      entry.colonyName +
      ' · Seed ' +
      entry.seed +
      ' · ' +
      entry.simulationAge.toFixed(1) +
      ' simulation seconds · ' +
      entry.gold +
      ' gold · ' +
      entry.buildingCount +
      (entry.buildingCount === 1 ? ' building' : ' buildings');
    const date = document.createElement('p');
    date.textContent =
      entry.savedAt === null
        ? 'Original save time unavailable; original browser slot preserved.'
        : 'Saved ' + new Date(entry.savedAt).toLocaleString();
    const actions = document.createElement('div');
    actions.className = 'save-actions';
    actions.append(
      button('Load', () => {
        const load = () => {
          game.loadCheckpoint(entry.id);
          closeSaveManager();
        };
        if (game.hasUnsavedProgress())
          confirm(
            'Load ' +
              entry.name +
              '? Current unsaved progress will be replaced. Save a checkpoint or export first if you want to retain it.',
            load,
          );
        else attempt(load);
      }),
    );
    if (entry.kind !== 'autosave') {
      actions.append(
        button('Rename', () => {
          renameName.value = entry.name;
          confirm(
            'Rename ' + entry.name,
            () => game.renameCheckpoint(entry.id, renameName.value),
            true,
          );
        }),
      );
      if (entry.kind === 'manual')
        actions.append(
          button('Overwrite', () =>
            confirm(
              'Overwrite ' +
                entry.name +
                ' with the current colony? This replaces that checkpoint.',
              () => game.saveCheckpoint(entry.name, entry.id),
            ),
          ),
        );
    }
    actions.append(
      button('Export file', () =>
        attempt(() => download(game.exportCheckpoint(entry.id), entry.name)),
      ),
    );
    actions.append(
      button('Delete', () =>
        confirm(
          'Delete ' + entry.name + '? This removes the checkpoint from your save catalog.',
          () => game.deleteCheckpoint(entry.id),
        ),
      ),
    );
    row.append(title, metadata, date, actions);
    return row;
  }
  function refreshSaveManager() {
    const focused = document.activeElement as HTMLElement;
    const focusedEntry = focused?.closest<HTMLElement>('.save-entry');
    const focusedId = focusedEntry?.dataset.saveId;
    const focusedAction = focused?.textContent;
    refreshHealth();
    if (document.activeElement !== colonyName) colonyName.value = game.colonyName;
    try {
      const entries = game.listSaves();
      list.replaceChildren(...entries.map(entryView));
      if (focusedId) {
        const row = list.querySelector<HTMLElement>('[data-save-id="' + focusedId + '"]');
        const action =
          row &&
          [...row.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === focusedAction,
          );
        if (!row) list.scrollTop = 0;
        (action || checkpointName).focus();
      }
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent =
          'No checkpoints yet. Name and save a checkpoint, or import a colony file.';
        list.append(empty);
      }
    } catch (error) {
      list.textContent =
        'Checkpoints unavailable: ' +
        (error instanceof Error ? error.message : 'Storage could not be read');
    }
  }
  function openSaveManager() {
    pending = null;
    game.closeLayer('save-confirm');
    refreshSaveManager();
    game.openLayer('savedata', { blocking: true });
    const utility = requireElement('utility') as HTMLDetailsElement;
    if (utility) utility.open = false;
  }
  function closeSaveManager() {
    cancelConfirmation();
    game.closeLayer('savedata');
  }
  function prepareImport(raw: string) {
    const entry = game.inspectSave(raw);
    confirm(
      'Import ' +
        entry.colonyName +
        ' (seed ' +
        entry.seed +
        ', ' +
        entry.simulationAge.toFixed(1) +
        ' simulation seconds)? It will be saved as a new checkpoint and replace the current colony. Unsaved progress can be protected by a checkpoint or file export first.',
      () => {
        game.importSave(raw);
        closeSaveManager();
      },
    );
  }
  colonyName.onchange = () =>
    attempt(
      () => game.setColonyName(colonyName.value),
      'Colony name updated; save a checkpoint to retain it.',
    );
  requireElement('create-checkpoint').onclick = () =>
    attempt(() => game.saveCheckpoint(checkpointName.value || 'Checkpoint'), 'Checkpoint saved.');
  requireElement('export-file').onclick = () =>
    attempt(() => download(game.exportSave(), game.colonyName + '-' + game.seed));
  requireElement('confirm-save-action').onclick = () => {
    const action = pending;
    if (!action) return;
    cancelConfirmation();
    attempt(action, 'Operation completed.');
  };
  requireElement('cancel-save-action').onclick = cancelConfirmation;
  requireElement('close-saves').onclick = closeSaveManager;
  requireElement('import-file').onchange = async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 32_000_000) throw new Error('Colony file is too large');
      prepareImport(await file.text());
    } catch (error) {
      showStatus(
        'Import failed: ' + (error instanceof Error ? error.message : 'File could not be read'),
        true,
      );
    } finally {
      input.value = '';
    }
  };
  requireElement('copycode').onclick = () =>
    attempt(() => {
      code.value = btoa(unescape(encodeURIComponent(game.exportSave())));
      code.focus();
      code.select();
      if (navigator.clipboard?.writeText)
        void navigator.clipboard.writeText(code.value).then(
          () => showStatus('Save code copied.'),
          () => showStatus('Save code shown — copy it manually.'),
        );
      else showStatus('Save code shown — copy it manually.');
    });
  requireElement('pastecode').onclick = () =>
    attempt(() => {
      const raw = code.value.trim();
      if (!raw) throw new Error('Paste a colony JSON or save code first');
      prepareImport(
        raw.startsWith('{') ? raw : decodeURIComponent(escape(atob(raw.replace(/\s+/g, '')))),
      );
    });
  if (recovery) recovery.onclick = openSaveManager;
  observePresentation(game, 'saveHealthChanged', refreshHealth);
  refreshHealth();
  return { openSaveManager, closeSaveManager, refreshSaveManager };
}
export interface SaveViewSubsystem {
  openSaveManager: () => void;
  closeSaveManager: () => void;
  refreshSaveManager: () => void;
}
