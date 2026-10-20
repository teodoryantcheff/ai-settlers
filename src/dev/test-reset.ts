import type { PersistenceInternals } from '../core/persistence.ts';
import type { HudInternals } from '../ui/hud.ts';
import type { GameRuntime } from '../runtime.ts';
import { PAGE_ELEMENT_IDS } from '../ui/dom.ts';

/** What a shared browser-test page must return to between tests. */
export interface TestFingerprint {
  time: number;
  paused: boolean;
  speed: number;
  buildings: number;
  units: number;
  jobs: number;
  colony: boolean;
  unsaved: boolean;
  saveHealth: boolean;
  workspace: string;
  openPanels: number;
  changedChrome: number;
  selected: number | null;
  mode: string | null;
  messages: number;
  camera: { x: number; y: number; z: number };
  view: { width: number; height: number };
  prefs: string;
  audio: string;
  storage: string;
}

interface Baseline {
  save: string;
  export: string;
  storage: [string, string][];
  camera: { x: number; y: number; zi: number };
  prefs: GameRuntime['presentationPrefs'];
  muted: boolean;
  musicOn: boolean;
  volumes: { musVol: number; sfxVol: number; ambVol: number };
  advisorVisible: boolean;
  details: Map<HTMLDetailsElement, boolean>;
  messages: GameRuntime['msgs'];
  chrome: Map<HTMLElement, ChromeState>;
  controls: Map<FormControl, { value: string; checked: boolean }>;
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
interface ChromeState {
  className: string;
  hidden: HTMLElement['hidden'];
  expanded: string | null;
}

function chromeState(element: HTMLElement): ChromeState {
  return {
    className: element.className,
    hidden: element.hidden,
    expanded: element.getAttribute('aria-expanded'),
  };
}

function storageEntries(): [string, string][] {
  const entries: [string, string][] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) entries.push([key, localStorage.getItem(key) ?? '']);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Development-bundle reset for browser tests sharing one booted page. The first call
 * snapshots the page as booted; later calls restore the colony through the real
 * load path (without writing the save catalog), then the camera, preferences,
 * storage and UI the load does not own. Each call returns the fingerprint that
 * the shared Playwright fixture compares with the first one.
 */
export function createTestReset(
  game: GameRuntime,
  { persistence, hud }: { persistence: PersistenceInternals; hud: HudInternals },
) {
  let baseline: Baseline | null = null;
  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
  };

  function capture(): Baseline {
    return {
      save: JSON.stringify(persistence.snapshotGame()),
      export: game.exportSave(),
      storage: storageEntries(),
      camera: { x: game.cam.x, y: game.cam.y, zi: game.zi },
      prefs: structuredClone(game.presentationPrefs),
      muted: game.muted,
      musicOn: game.musicOn,
      volumes: { musVol: game.musVol, sfxVol: game.sfxVol, ambVol: game.ambVol },
      advisorVisible: game.advisorVisible,
      details: new Map([...document.querySelectorAll('details')].map((d) => [d, d.open])),
      messages: structuredClone(game.msgs),
      // The static page: palette and panel state, and every filter or setting control.
      chrome: new Map(
        PAGE_ELEMENT_IDS.flatMap((id) => {
          const element = document.getElementById(id);
          return element ? [[element, chromeState(element)] as const] : [];
        }),
      ),
      controls: new Map(
        [...document.querySelectorAll<FormControl>('input, select, textarea')].map((control) => [
          control,
          { value: control.value, checked: control instanceof HTMLInputElement && control.checked },
        ]),
      ),
    };
  }

  function restore(base: Baseline) {
    // Tests inject storage faults and clocks by patching browser objects.
    Object.assign(Storage.prototype, nativeStorage);
    if (Object.hasOwn(performance, 'now')) delete (performance as { now?: unknown }).now;
    persistence.commitLoad(persistence.prepareLoad(base.save));
    // An injected storage fault leaves save health failed until a save succeeds;
    // storage is restored below, which also discards this autosave.
    if (!game.saveHealth.ok) game.saveAutosave();
    persistence.forgetBaseline();
    // The load announces itself; keep the booted messages instead.
    game.msgs.splice(0, game.msgs.length, ...structuredClone(base.messages));
    for (const [details, open] of base.details) details.open = open;
    for (const [element, state] of base.chrome) {
      element.className = state.className;
      element.hidden = state.hidden;
      if (state.expanded === null) element.removeAttribute('aria-expanded');
      else element.setAttribute('aria-expanded', state.expanded);
    }
    for (const [control, state] of base.controls) {
      control.value = state.value;
      if (control instanceof HTMLInputElement) control.checked = state.checked;
    }
    Object.assign(game.presentationPrefs, structuredClone(base.prefs));
    if (game.muted !== base.muted) game.setMuted(base.muted);
    if (game.musicOn !== base.musicOn) game.setMusicVol(base.musicOn);
    Object.assign(game, base.volumes);
    if (game.advisorVisible !== base.advisorVisible) game.setAdvisorVisible(base.advisorVisible);
    // Preference setters write storage, so storage is restored after them.
    localStorage.clear();
    for (const [key, value] of base.storage) localStorage.setItem(key, value);
    game.loadPrefs();
    game.releaseKeys();
    game.resize();
    game.zi = base.camera.zi;
    game.z = game.zooms[base.camera.zi];
    game.cam.x = base.camera.x;
    game.cam.y = base.camera.y;
    game.clampCam();
    // The frame loop restarts its clock the way it does when a tab returns.
    document.dispatchEvent(new Event('visibilitychange'));
    (document.activeElement as HTMLElement | null)?.blur();
    // Show the restored colony, then leave the test's first hudTick() unthrottled.
    hud.resetHudThrottle();
    game.hudTick();
    hud.resetHudThrottle();
  }

  function fingerprint(base: Baseline): TestFingerprint {
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      time: game.state.time,
      paused: game.state.paused,
      speed: game.state.speed,
      buildings: game.buildings.length,
      units: game.units.length,
      jobs: game.jobs.length,
      // Compared as validated saves: validation normalizes the raw snapshot.
      colony: game.exportSave() === base.export,
      unsaved: game.hasUnsavedProgress(),
      saveHealth: game.saveHealth.ok,
      workspace: game.workspace,
      openPanels:
        document.querySelectorAll('[aria-modal="true"]').length +
        [...base.details].filter(([details, open]) => details.open !== open).length,
      changedChrome: [...base.chrome].filter(
        ([element, state]) => JSON.stringify(chromeState(element)) !== JSON.stringify(state),
      ).length,
      selected: game.selected?.id ?? null,
      mode: game.mode ? JSON.stringify(game.mode) : null,
      messages: game.msgs.length,
      camera: { x: round(game.cam.x), y: round(game.cam.y), z: game.z },
      view: { width: innerWidth, height: innerHeight },
      prefs: JSON.stringify(game.presentationPrefs),
      audio: JSON.stringify([game.muted, game.musicOn, game.musVol, game.sfxVol, game.ambVol]),
      storage: JSON.stringify(storageEntries()),
    };
  }

  return function resetForTest(): TestFingerprint {
    if (!baseline) baseline = capture();
    else restore(baseline);
    return fingerprint(baseline);
  };
}
