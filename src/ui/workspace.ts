import { requireElement } from './dom.ts';
import type { GameRuntime } from '../runtime.ts';
import type { BuildingType, TilePoint } from '../types.ts';
import {
  createReportWindows,
  type ReportName,
  type ReportWindowsDependencies,
} from './report-windows.ts';
import { observePresentation } from './domain-feedback.ts';

export type WorkspaceName = 'map' | 'economy' | 'logistics' | 'colony' | 'attention' | 'activity';
export interface RemovedContributor extends TilePoint {
  id: number;
  type: BuildingType;
}
export interface LayerOptions {
  blocking?: boolean;
  dismissible?: boolean;
}

/** Presentation navigation owns no simulation quantities or random draws. */
/** The runtime members the workspace reads, including those its report windows need. */
export type WorkspaceDependencies = ReportWindowsDependencies &
  Pick<
    GameRuntime,
    | 'TS'
    | 'byId'
    | 'cam'
    | 'cancelMapGestures'
    | 'clampCam'
    | 'gameEvents'
    | 'gameplayHUD'
    | 'keys'
    | 'persistPreferences'
    | 'presentationPrefs'
    | 'renderingAvailable'
    | 'selInfo'
    | 'selected'
    | 'setMode'
    | 'state'
    | 'updateAttentionView'
    | 'updateEconomyView'
    | 'updateInfo'
    | 'updateLogisticsView'
    | 'vh'
    | 'view'
    | 'vw'
    | 'z'
    | 'zoomAnim'
  >;

export function createWorkspace(game: WorkspaceDependencies): WorkspaceSubsystem {
  let workspace: WorkspaceName = 'map';
  const reportWindows = createReportWindows(game, () => {
    switchWorkspace('map');
    focusWorkspaceNavigation();
  });
  let removedContributor: RemovedContributor | null = null;
  const layers: Array<{
    id: string;
    blocking: boolean;
    dismissible: boolean;
    returnFocus: HTMLElement | null;
  }> = [];
  const names: WorkspaceName[] = ['map', 'economy', 'logistics', 'colony', 'attention', 'activity'];
  const simulationLines = new WeakMap<HTMLElement, HTMLParagraphElement>();
  const controls =
    'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]';

  function setAtlasExpanded(expanded: boolean, persist = true) {
    if (game.presentationPrefs) game.presentationPrefs.atlasExpanded = expanded;
    const nav = requireElement('workspace-nav');
    const toggle = requireElement('atlas-toggle');
    if (!expanded && nav.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    nav.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.title = expanded ? 'Collapse Colony Atlas' : 'Expand Colony Atlas';
    document.body.classList.toggle('atlas-expanded', expanded);
    reportWindows.constrain();
    if (persist) game.persistPreferences();
  }
  function focusWorkspaceNavigation() {
    const nav = requireElement('workspace-nav');
    const destination = !nav.hidden
      ? nav.querySelector<HTMLElement>('[data-workspace][aria-current="page"]')
      : requireElement('atlas-toggle');
    destination?.focus({ preventScroll: true });
  }
  requireElement('atlas-toggle').addEventListener('click', () => {
    setAtlasExpanded(requireElement('workspace-nav').hidden !== false);
  });
  setAtlasExpanded(false, false);

  function switchWorkspace(next: WorkspaceName) {
    if (!names.includes(next)) return;
    if (next !== 'map') {
      game.setMode(null);
      game.ghost = null;
      game.hoverIn = game.mouseSeen = false;
      game.ttStr = null;
      requireElement('tt').style.display = 'none';
      game.keys.l = game.keys.r = game.keys.u = game.keys.d = false;
      game.cancelMapGestures();
    }
    reportWindows.hide(workspace);
    workspace = next;
    document.body.dataset.workspace = next;
    document.querySelectorAll<HTMLElement>('#workspace-nav [data-workspace]').forEach((button) => {
      button.setAttribute('aria-current', button.dataset.workspace === next ? 'page' : 'false');
    });
    for (const name of names) {
      if (name === 'map') continue;
      requireElement('workspace-' + name).hidden = name !== next;
    }
    requireElement('economy').classList.toggle('hidden', next !== 'colony');
    game.updateInfo();
    game.gameplayHUD();
    game.updateEconomyView();
    game.updateLogisticsView();
    game.updateAttentionView();
    reportWindows.show(next);
  }

  function inspectContributor(id: number) {
    const building = game.byId(id);
    if (!building) return false;
    removedContributor = null;
    game.selected = building;
    game.selInfo = null;
    game.updateInfo();
    return true;
  }
  function unobscuredMapCenter() {
    const canvas = game.view?.getBoundingClientRect?.();
    if (!canvas?.width || !canvas.height) return { x: game.vw / 2, y: game.vh / 2 };
    function visibleRect(id: string) {
      const element = requireElement(id);
      if (element.hidden || element.classList.contains('hidden')) return null;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height ? rect : null;
    }
    const bar = visibleRect('bar'),
      atlas = visibleRect('workspace-nav'),
      inspector = visibleRect('inspectordock');
    const mini = visibleRect('minimap-panel') || visibleRect('mini');
    const palette = visibleRect('palette'),
      modes = visibleRect('map-modes');
    let left = Math.max(canvas.left + 16, atlas ? atlas.right + 16 : canvas.left + 16);
    const right = Math.min(canvas.right - 16, inspector ? inspector.left - 16 : canvas.right - 16);
    const top = Math.max(canvas.top + 16, bar ? bar.bottom + 16 : canvas.top + 16);
    const bottom = Math.min(
      canvas.bottom - 16,
      mini ? mini.top - 16 : canvas.bottom - 16,
      palette ? palette.top - 16 : canvas.bottom - 16,
      modes ? modes.top - 16 : canvas.bottom - 16,
    );
    const advisor = visibleRect('adv');
    if (
      advisor &&
      (top + bottom) / 2 >= advisor.top &&
      (top + bottom) / 2 <= advisor.bottom &&
      (left + right) / 2 <= advisor.right
    )
      left = Math.min(right - 64, Math.max(left, advisor.right + 16));
    return { x: (left + right) / 2 - canvas.left, y: (top + bottom) / 2 - canvas.top };
  }
  function locateContributor(target: number | TilePoint) {
    const location = typeof target === 'number' ? game.byId(target) : target;
    if (!location) return false;
    switchWorkspace('map');
    game.setMode(null);
    if (typeof target === 'number') inspectContributor(target);
    game.zoomAnim = null;
    const center = unobscuredMapCenter();
    game.cam.x = (location.x + 0.5) * game.TS - center.x / game.z;
    game.cam.y = (location.y + 0.5) * game.TS - center.y / game.z;
    game.clampCam();
    focusWorkspaceNavigation();
    return true;
  }
  function showRemovedContributor(former: RemovedContributor) {
    game.selected = null;
    game.selInfo = null;
    removedContributor = { ...former };
    game.updateInfo();
  }
  function clearRemovedContributor() {
    removedContributor = null;
  }

  function visibleLayers() {
    return layers.filter((layer) => {
      const element = requireElement(layer.id);
      return !element.hidden && !element.classList.contains('hidden');
    });
  }
  function layerElement(id: string) {
    return requireElement(id);
  }
  function focusable(element: HTMLElement) {
    return [...element.querySelectorAll<HTMLElement>(controls)].filter(
      (control) => !control.closest('[hidden],.hidden') && control.getClientRects().length > 0,
    );
  }
  function openLayer(id: string, options: LayerOptions = {}) {
    const element = layerElement(id);
    const previous = layers.find((layer) => layer.id === id);
    if (previous) {
      if (!element.hidden && !element.classList.contains('hidden')) return;
      closeLayer(id);
    }
    const blocking = options.blocking !== false;
    layers.push({
      id,
      blocking,
      dismissible: options.dismissible !== false,
      returnFocus: document.activeElement as HTMLElement,
    });
    element.classList.remove('hidden');
    element.hidden = false;
    element.setAttribute('role', blocking ? 'dialog' : 'region');
    if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
      const heading = element.querySelector<HTMLElement>('h1,h2,h3');
      if (heading) {
        if (!heading.id) heading.id = id + '-dialog-title';
        element.setAttribute('aria-labelledby', heading.id);
      }
    }
    if (blocking) element.setAttribute('aria-modal', 'true');
    element.tabIndex = -1;
    element.style.zIndex = String(30 + layers.length);
    game.keys.l = game.keys.r = game.keys.u = game.keys.d = false;
    (focusable(element)[0] || element).focus({ preventScroll: true });
    updateLayerBackdrop();
  }
  function closeLayer(id?: string) {
    const index =
      id === undefined ? layers.length - 1 : layers.findIndex((layer) => layer.id === id);
    if (index < 0) {
      if (id) layerElement(id).classList.add('hidden');
      return;
    }
    // Removing a parent also dismisses its temporary children.
    const closing = layers.splice(index);
    for (const layer of closing) {
      const element = layerElement(layer.id);
      element.classList.add('hidden');
      element.removeAttribute('aria-modal');
    }
    const top = visibleLayers().at(-1);
    const returnFocus = closing[0].returnFocus;
    if (
      returnFocus?.isConnected &&
      returnFocus !== document.body &&
      !returnFocus.closest('[hidden],.hidden,[inert]') &&
      !returnFocus.matches(':disabled,[aria-disabled="true"]')
    ) {
      const collapsedMenu = returnFocus.closest('details:not([open])');
      const destination = collapsedMenu?.querySelector<HTMLElement>('summary') || returnFocus;
      destination.focus({ preventScroll: true });
    } else if (top) (focusable(layerElement(top.id))[0] || layerElement(top.id)).focus();
    else focusWorkspaceNavigation();
    updateLayerBackdrop();
  }
  function closeAllLayers() {
    if (layers.length) closeLayer(layers[0].id);
  }
  function updateSimulationLine(element: HTMLElement, blocking: boolean, top: boolean) {
    const host = element.querySelector<HTMLElement>(':scope > .panel') || element;
    let line = simulationLines.get(host);
    if (!blocking) {
      if (line) line.hidden = true;
      return;
    }
    if (!line) {
      line = document.createElement('p');
      line.className = 'layer-simulation-state';
      line.setAttribute('role', 'status');
      line.setAttribute('aria-label', 'Simulation state');
      line.setAttribute('aria-atomic', 'true');
      simulationLines.set(host, line);
    }
    // A reference renderer may replace its content while the layer stays open.
    if (line.parentNode !== host) host.insertBefore(line, host.firstChild);
    line.hidden = false;
    line.setAttribute('aria-live', top ? 'polite' : 'off');
    const text =
      game.renderingAvailable === false
        ? 'Graphics unavailable · simulation paused · ' +
          game.state.speed +
          '× selected. Export to protect progress; reload to retry graphics.'
        : 'Simulation suspended · ' +
          game.state.speed +
          '× selected · Player setting: ' +
          (game.state.paused ? 'manually paused' : 'running');
    if (line.textContent !== text) line.textContent = text;
  }
  function updateLayerBackdrop() {
    const visible = visibleLayers();
    const active = visible.filter((layer) => layer.blocking);
    const topBlocking = active.at(-1);
    for (const layer of visible)
      updateSimulationLine(layerElement(layer.id), layer.blocking, layer === topBlocking);
    const backdrop = requireElement('layer-backdrop');
    backdrop.hidden = active.length === 0;
    const top = active.at(-1);
    if (top) {
      // Inline confirmations share their ancestor's stacking context. Keep the
      // backdrop below that root so the nested dialog remains reachable.
      const root =
        active.find((layer) => layerElement(layer.id).contains(layerElement(top.id))) || top;
      backdrop.style.zIndex = String(+(layerElement(root.id).style.zIndex || 31) - 1);
    }
    for (const layer of active) {
      const element = layerElement(layer.id);
      if (layer === active.at(-1)) element.setAttribute('aria-modal', 'true');
      else element.removeAttribute('aria-modal');
    }
    document.body.classList.toggle('utility-open', active.length > 0);
  }
  function blockingLayerOpen() {
    updateLayerBackdrop();
    return visibleLayers().some((layer) => layer.blocking);
  }

  document.querySelectorAll<HTMLElement>('#workspace-nav [data-workspace]').forEach((button) => {
    button.addEventListener('click', () =>
      switchWorkspace(button.dataset.workspace as WorkspaceName),
    );
  });
  requireElement('locate-selected').addEventListener('click', () => {
    if (game.selected) locateContributor(game.selected.id);
    else if (removedContributor) locateContributor(removedContributor);
  });
  window.addEventListener(
    'keydown',
    (event) => {
      const top = visibleLayers().at(-1);
      if (!top || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (top.dismissible) closeLayer(top.id);
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (event.key === 'Tab') {
        const blocking = visibleLayers()
          .filter((layer) => layer.blocking)
          .at(-1);
        if (!blocking) return;
        const element = layerElement(blocking.id);
        const choices = focusable(element);
        const first = choices[0] || element;
        const last = choices.at(-1) || element;
        if (
          event.shiftKey &&
          (document.activeElement === first || !element.contains(document.activeElement))
        ) {
          last.focus();
          event.preventDefault();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !element.contains(document.activeElement))
        ) {
          first.focus();
          event.preventDefault();
        }
      }
    },
    true,
  );
  observePresentation(game, 'worldLoaded', () => {
    closeAllLayers();
    clearRemovedContributor();
    switchWorkspace('map');
    reportWindows.resetContext();
  });
  document.body.dataset.workspace = 'map';
  if (document.querySelector('#start:not(.hidden)')) openLayer('start', { dismissible: false });
  return {
    get workspace() {
      return workspace;
    },
    get removedContributor() {
      return removedContributor;
    },
    setAtlasExpanded,
    focusWorkspaceNavigation,
    registerReportWindow: reportWindows.register,
    switchWorkspace,
    inspectContributor,
    locateContributor,
    showRemovedContributor,
    clearRemovedContributor,
    openLayer,
    closeLayer,
    closeAllLayers,
    blockingLayerOpen,
  };
}
export interface WorkspaceSubsystem {
  readonly workspace: WorkspaceName;
  readonly removedContributor: RemovedContributor | null;
  setAtlasExpanded: (expanded: boolean, persist?: boolean) => void;
  focusWorkspaceNavigation: () => void;
  registerReportWindow: (name: ReportName, title: string, focusAttribute?: string) => void;
  switchWorkspace: (next: WorkspaceName) => void;
  inspectContributor: (id: number) => boolean;
  locateContributor: (target: number | TilePoint) => boolean;
  showRemovedContributor: (former: RemovedContributor) => void;
  clearRemovedContributor: () => void;
  openLayer: (id: string, options?: LayerOptions) => void;
  closeLayer: (id?: string) => void;
  closeAllLayers: () => void;
  blockingLayerOpen: () => boolean;
}
