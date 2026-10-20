import { requireElement } from './dom.ts';
import type { GameRuntime } from '../runtime.ts';
import type { WorkspaceName } from './workspace.ts';

export type ReportName = Exclude<WorkspaceName, 'map'>;
interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface ReportWindow {
  shell: HTMLElement;
  host: HTMLElement;
  geometry: Geometry | null;
  endPointer: () => void;
  focusAttribute: string;
  focus: { element: HTMLElement; id: string; key: string | null } | null;
  scrollTop: number;
  scrollLeft: number;
}

/** Session-only report presentation; report views retain their mounted evidence and controls. */
/** The runtime members report windows read. */
export type ReportWindowsDependencies = Pick<
  GameRuntime,
  'ghost' | 'hoverIn' | 'mouseSeen' | 'ttStr'
>;

export function createReportWindows(game: ReportWindowsDependencies, close: () => void) {
  const reports = new Map<ReportName, ReportWindow>();
  function bounds() {
    const nav = requireElement('workspace-nav');
    const expanded = !nav.hidden;
    const left = expanded ? nav.getBoundingClientRect().right + 12 : 12;
    const top = (requireElement('bar').getBoundingClientRect().bottom || 0) + (expanded ? 12 : 58);
    const reserve =
      window.innerWidth >= 900
        ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-width')) ||
          316
        : 0;
    const mapControls = requireElement('map-controls');
    const controlsTop = !mapControls.hidden ? mapControls.getBoundingClientRect().top : 0;
    return {
      left,
      top,
      right: Math.max(left + 240, window.innerWidth - reserve - 24),
      bottom:
        controlsTop > top
          ? Math.min(window.innerHeight - 12, controlsTop - 12)
          : window.innerHeight - 12,
    };
  }
  function initialGeometry(): Geometry {
    const area = bounds();
    return {
      x: area.left,
      y: area.top,
      width: Math.min(860, area.right - area.left),
      height: Math.min(650, area.bottom - area.top),
    };
  }
  function apply(report: ReportWindow) {
    const area = bounds(),
      box = report.geometry;
    if (!box) return;
    const maxWidth = area.right - area.left,
      maxHeight = Math.max(160, area.bottom - area.top);
    box.width = Math.max(Math.min(520, maxWidth), Math.min(box.width, maxWidth));
    box.height = Math.max(Math.min(260, maxHeight), Math.min(box.height, maxHeight));
    box.x = Math.max(area.left, Math.min(box.x, area.right - box.width));
    box.y = Math.max(area.top, Math.min(box.y, area.bottom - box.height));
    Object.assign(report.shell.style, {
      left: box.x + 'px',
      top: box.y + 'px',
      width: box.width + 'px',
      height: box.height + 'px',
    });
  }
  function constrain() {
    for (const report of reports.values()) if (report.geometry) apply(report);
  }
  function register(name: ReportName, title: string, focusAttribute = 'data-report-key') {
    if (reports.has(name)) return;
    const host = requireElement('workspace-' + name);
    const shell = document.createElement('section');
    shell.className = 'report-window';
    shell.dataset.reportWindow = name;
    shell.setAttribute('role', 'region');
    shell.setAttribute('aria-label', title + ' window');
    shell.hidden = true;
    shell.addEventListener('pointerenter', () => {
      game.hoverIn = game.mouseSeen = false;
      game.ghost = null;
      game.ttStr = null;
      requireElement('tt').style.display = 'none';
    });
    const bar = document.createElement('header');
    bar.className = 'report-titlebar';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const move = document.createElement('button');
    move.type = 'button';
    move.textContent = 'Move';
    move.setAttribute('aria-label', 'Move ' + title + ' window');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Close ' + title + ' window');
    dismiss.addEventListener('click', close);
    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'report-resize';
    resize.textContent = 'Resize ↘';
    resize.setAttribute('aria-label', 'Resize ' + title + ' window');
    const instructions = document.createElement('p');
    instructions.id = 'report-' + name + '-help';
    instructions.className = 'report-window-help';
    instructions.textContent =
      'Drag the heading to move, or drag Resize to resize. Focus Move or Resize and use arrow keys; hold Shift for larger steps. Escape closes the report.';
    move.setAttribute('aria-describedby', instructions.id);
    resize.setAttribute('aria-describedby', instructions.id);
    move.title = 'Arrow keys move this window; Shift uses larger steps.';
    resize.title = 'Drag or use arrow keys to resize; Shift uses larger steps.';
    bar.append(heading, move, dismiss);
    host.before(shell);
    shell.append(bar, host, resize, instructions);
    let pointer: {
      handle: HTMLElement;
      id: number;
      x: number;
      y: number;
      box: Geometry;
      resize: boolean;
    } | null = null;
    function endPointer() {
      if (pointer?.handle.hasPointerCapture(pointer.id))
        pointer.handle.releasePointerCapture(pointer.id);
      pointer = null;
    }
    const report: ReportWindow = {
      shell,
      host,
      geometry: null,
      endPointer,
      focusAttribute,
      focus: null,
      scrollTop: 0,
      scrollLeft: 0,
    };
    shell.addEventListener('focusin', (event) => {
      const element = event.target as HTMLElement;
      if (host.contains(element))
        report.focus = { element, id: element.id, key: element.getAttribute(focusAttribute) };
    });
    function bindPointer(handle: HTMLElement, resizing: boolean) {
      handle.addEventListener('pointerdown', (event) => {
        if (
          event.button !== 0 ||
          ((event.target as HTMLElement).closest('button') &&
            event.target !== move &&
            event.target !== resize)
        )
          return;
        if (resizing) resize.focus({ preventScroll: true });
        else if (event.target === move) move.focus({ preventScroll: true });
        if (!report.geometry) return;
        pointer = {
          handle,
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          box: { ...report.geometry },
          resize: resizing,
        };
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      handle.addEventListener('pointermove', (event) => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.x,
          dy = event.clientY - pointer.y,
          old = pointer.box;
        report.geometry = pointer.resize
          ? { ...old, width: old.width + dx, height: old.height + dy }
          : { ...old, x: old.x + dx, y: old.y + dy };
        apply(report);
      });
      handle.addEventListener('pointerup', endPointer);
      handle.addEventListener('pointercancel', endPointer);
    }
    bindPointer(bar, false);
    bindPointer(resize, true);
    function keyboard(event: KeyboardEvent, resizing: boolean) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const amount = event.shiftKey ? 48 : 16;
      const horizontal =
        event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0;
      const vertical = event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0;
      if (!report.geometry) return;
      if (resizing) {
        report.geometry.width += horizontal;
        report.geometry.height += vertical;
      } else {
        report.geometry.x += horizontal;
        report.geometry.y += vertical;
      }
      apply(report);
    }
    move.addEventListener('keydown', (event) => keyboard(event, false));
    resize.addEventListener('keydown', (event) => keyboard(event, true));
    reports.set(name, report);
  }
  function show(name: WorkspaceName) {
    const report = reports.get(name as ReportName);
    if (!report) return;
    report.geometry ||= initialGeometry();
    apply(report);
    report.shell.hidden = report.host.hidden = false;
    const remembered = report.focus;
    let target: HTMLElement | null | undefined = remembered?.element;
    if (!target?.isConnected || !report.host.contains(target)) {
      target = remembered?.id
        ? [...report.host.querySelectorAll<HTMLElement>('[id]')].find(
            (element) => element.id === remembered.id,
          )
        : null;
      if (!target && remembered?.key)
        target = [
          ...report.host.querySelectorAll<HTMLElement>('[' + report.focusAttribute + ']'),
        ].find((element) => element.getAttribute(report.focusAttribute) === remembered.key);
    }
    if (!target || !report.host.contains(target) || target.matches(':disabled'))
      target = report.shell.querySelector<HTMLElement>('.report-titlebar button');
    target?.focus({ preventScroll: true });
    report.host.scrollTop = report.scrollTop;
    report.host.scrollLeft = report.scrollLeft;
  }
  function hide(name: WorkspaceName) {
    const report = reports.get(name as ReportName);
    if (!report) return;
    if (!report.shell.hidden) {
      report.scrollTop = report.host.scrollTop;
      report.scrollLeft = report.host.scrollLeft;
    }
    report.endPointer();
    report.shell.hidden = true;
  }
  window.addEventListener('resize', constrain);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(constrain).observe(requireElement('bar'));
  }
  function resetContext() {
    for (const report of reports.values()) {
      report.focus = null;
      report.scrollTop = report.scrollLeft = 0;
    }
  }
  return { register, show, hide, constrain, resetContext };
}
