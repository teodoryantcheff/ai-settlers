import type { GameRuntime } from '../runtime.ts';
import { observePresentation } from './domain-feedback.ts';
import { saveName } from '../core/save-catalog.ts';
import type { SaveMetadata } from '../types.ts';

/** One session boundary: layers suspend time; replacing a colony is deliberate. */
export function createSessionView(game: GameRuntime): SessionSubsystem {
  const status = document.getElementById('welcome-status');
  const continueButton = document.getElementById('continueb') as HTMLButtonElement;
  const form = document.getElementById('new-colony-form');
  const nameInput = document.getElementById('new-colony-name') as HTMLInputElement;
  const seedInput = document.getElementById('new-colony-seed') as HTMLInputElement;
  let liveColony = game.started;
  let saved: SaveMetadata[] = [];
  let pendingNew: (() => void) | null = null;
  function report(message: string, failed = false) {
    status.textContent = message;
    status.setAttribute('role', failed ? 'alert' : 'status');
  }
  function attempt(action: () => void) {
    try {
      action();
    } catch (error) {
      report(error instanceof Error ? error.message : 'The colony could not be opened', true);
    }
  }
  function refreshWelcome() {
    if (!liveColony) {
      try {
        saved = game.listSaves();
      } catch (error) {
        saved = [];
        report(
          'Saved colonies unavailable: ' +
            (error instanceof Error ? error.message : 'Storage could not be read') +
            '. Load can import a colony file.',
          true,
        );
      }
    }
    continueButton.disabled = !liveColony && saved.length === 0;
    const text = document.getElementById('welcome-continuation');
    text.textContent = liveColony
      ? game.colonyName +
        ' · Seed ' +
        game.seed +
        ' · ' +
        game.state.time.toFixed(1) +
        ' simulation seconds · ' +
        game.state.gold +
        ' gold. Continue keeps this live colony.'
      : saved.length
        ? saved[0].colonyName +
          ' · ' +
          saved[0].name +
          ' · Seed ' +
          saved[0].seed +
          '. Continue opens the latest validated checkpoint.'
        : 'No checkpoint yet. Start a colony, or use Load to import one.';
    if (continueButton.disabled) form.classList.remove('hidden');
    else form.classList.add('hidden');
  }
  function openWelcome() {
    refreshWelcome();
    game.openLayer('start', { blocking: true, dismissible: false });
  }
  function returnHome() {
    pendingNew = null;
    liveColony = true;
    game.setMode(null);
    game.closeAllLayers();
    closeUtility();
    openWelcome();
  }
  function continueColony() {
    attempt(() => {
      if (!liveColony) {
        const latest = game.listSaves()[0];
        if (!latest) {
          report('No saved colony is available. Start a new colony or import a file.', true);
          return;
        }
        game.loadCheckpoint(latest.id);
        liveColony = true;
      }
      game.beginSession();
      game.closeAllLayers();
    });
  }
  function openNewColony() {
    form.classList.remove('hidden');
    seedInput.value = String(game.seed);
    nameInput.focus();
  }
  function newColony(name = '', seed?: number): boolean {
    const colonyName = saveName(name);
    const chosenSeed = seed === undefined ? Math.floor(Math.random() * 2147483648) : seed;
    if (!Number.isInteger(chosenSeed) || chosenSeed < 0 || chosenSeed > 2147483647)
      throw new Error('World seed must be an integer from 0 to 2147483647');
    const start = () => {
      const speed = game.state.speed;
      game.resetColony(chosenSeed, colonyName);
      game.state.speed = speed;
      game.state.paused = false;
      game.beginSession();
      liveColony = true;
      game.initAudio();
      game.closeAllLayers();
      game.hudTick();
      game.drawMini();
      game.draw();
    };
    if (liveColony && game.hasUnsavedProgress()) {
      pendingNew = start;
      document.getElementById('session-confirm-text').textContent =
        'Start ' +
        colonyName +
        ' with seed ' +
        chosenSeed +
        '? Current unsaved progress will be replaced. Save a checkpoint or export first if you want to retain it.';
      game.openLayer('session-confirm', { blocking: true });
      return false;
    }
    start();
    return true;
  }
  function startNewColonyFromForm() {
    attempt(() =>
      newColony(
        nameInput.value,
        seedInput.value.trim() === '' ? undefined : Number(seedInput.value),
      ),
    );
  }
  function settingsStatus() {
    const element = document.getElementById('settings-status');
    element.textContent = game.preferencesHealth.message;
    element.setAttribute('role', game.preferencesHealth.status === 'failed' ? 'alert' : 'status');
  }
  function closeUtility() {
    const utility = document.getElementById('utility') as HTMLDetailsElement;
    if (utility) utility.open = false;
  }
  function openSettings() {
    (document.getElementById('speedpref') as HTMLSelectElement).value = String(game.state.speed);
    (document.getElementById('advisorpref') as HTMLInputElement).checked = game.advisorVisible;
    (document.getElementById('mutepref') as HTMLInputElement).checked = game.muted;
    (document.getElementById('musicpref') as HTMLInputElement).checked = game.musicOn;
    for (const [id, value] of [
      ['musvol', game.musVol],
      ['sfxvol', game.sfxVol],
      ['ambvol', game.ambVol],
    ] as const) {
      (document.getElementById(id) as HTMLInputElement).value = String(Math.round(value * 100));
      document.getElementById(id + 'v').textContent = Math.round(value * 100) + '%';
    }
    settingsStatus();
    game.openLayer('mix', { blocking: true });
    closeUtility();
  }
  function openReference(article?: string) {
    game.renderReference(article);
    game.openLayer('help', { blocking: true });
    closeUtility();
  }
  function openAbout() {
    game.renderAbout();
    game.openLayer('about', { blocking: true });
    closeUtility();
  }
  document.getElementById('continueb').onclick = continueColony;
  document.getElementById('new-colonyb').onclick = openNewColony;
  document.getElementById('load-colonyb').onclick = () => game.openSaveManager();
  document.getElementById('welcome-settings').onclick = openSettings;
  document.getElementById('welcome-reference').onclick = () => openReference();
  document.getElementById('welcome-about').onclick = openAbout;
  document.getElementById('close-about').onclick = () => game.closeLayer('about');
  document.getElementById('homeb').onclick = returnHome;
  document.getElementById('confirm-new-colony').onclick = () => {
    const action = pendingNew;
    pendingNew = null;
    game.closeLayer('session-confirm');
    if (action) attempt(action);
  };
  document.getElementById('cancel-new-colony').onclick = () => {
    pendingNew = null;
    game.closeLayer('session-confirm');
  };
  document.getElementById('protect-current-colony').onclick = () => game.openSaveManager();
  (document.getElementById('speedpref') as HTMLSelectElement).onchange = (event) => {
    const value = Number((event.target as HTMLSelectElement).value);
    if ([1, 2, 4, 8].includes(value)) {
      game.state.speed = value as 1 | 2 | 4 | 8;
      game.persistPreferences();
    }
  };
  (document.getElementById('advisorpref') as HTMLInputElement).onchange = (event) =>
    game.setAdvisorVisible((event.target as HTMLInputElement).checked);
  (document.getElementById('mutepref') as HTMLInputElement).onchange = (event) => {
    game.setMuted((event.target as HTMLInputElement).checked);
    document.getElementById('mute').style.opacity = game.muted ? '0.4' : '1';
    game.persistPreferences();
  };
  (document.getElementById('musicpref') as HTMLInputElement).onchange = (event) => {
    game.initAudio();
    game.setMusicVol((event.target as HTMLInputElement).checked);
    document.getElementById('musicb').classList.toggle('off', !game.musicOn);
    game.persistPreferences();
  };
  observePresentation(game, 'worldLoaded', () => {
    liveColony = true;
    pendingNew = null;
  });
  observePresentation(game, 'preferencesResult', settingsStatus);
  seedInput.value = String(game.seed);
  refreshWelcome();
  if (!document.getElementById('start').classList.contains('hidden'))
    (continueButton.disabled ? document.getElementById('new-colonyb') : continueButton).focus();
  return {
    openWelcome,
    returnHome,
    continueColony,
    openNewColony,
    newColony,
    startNewColonyFromForm,
    openSettings,
    openReference,
    openAbout,
  };
}
export interface SessionSubsystem {
  openWelcome: () => void;
  returnHome: () => void;
  continueColony: () => void;
  openNewColony: () => void;
  newColony: (name?: string, seed?: number) => boolean;
  startNewColonyFromForm: () => void;
  openSettings: () => void;
  openReference: (article?: string) => void;
  openAbout: () => void;
}
