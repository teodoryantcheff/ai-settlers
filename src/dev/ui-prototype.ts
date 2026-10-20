import { requireElement } from '../ui/dom.ts';
import { prototypeStyles } from './ui-prototype.styles.ts';
import { resourceIcon } from '../ui/resource-icons.ts';
import type { Good } from '../types.ts';
import type { GameRuntime } from '../runtime.ts';

// Three throwaway whole-interface variants on tests/game.html?uiPrototype&variant=A|B|C.
// Question: map-led workspace, operations console, or economy-led ledger?
// All economic figures and session controls below are in-memory illustrative fixtures.
type Variant = 'A' | 'B' | 'C';
type View = 'workspace' | 'economy' | 'logistics' | 'welcome' | 'reference' | 'about';
interface Resource {
  id: Good;
  name: string;
  stored: number;
  reserved: number;
  transit: number;
  local: number;
  produced: number;
  consumed: number;
  delta: number;
  group: string;
}
const resources: Resource[] = [
  {
    id: 'logs',
    name: 'Logs',
    stored: 64,
    reserved: 8,
    transit: 4,
    local: 6,
    produced: 18,
    consumed: 12,
    delta: 4,
    group: 'Materials',
  },
  {
    id: 'planks',
    name: 'Planks',
    stored: 38,
    reserved: 12,
    transit: 2,
    local: 4,
    produced: 6,
    consumed: 2,
    delta: 2,
    group: 'Materials',
  },
  {
    id: 'stone',
    name: 'Stone',
    stored: 42,
    reserved: 6,
    transit: 2,
    local: 2,
    produced: 5,
    consumed: 1,
    delta: 3,
    group: 'Materials',
  },
  {
    id: 'grain',
    name: 'Grain',
    stored: 24,
    reserved: 6,
    transit: 3,
    local: 8,
    produced: 8,
    consumed: 7,
    delta: 0.5,
    group: 'Food',
  },
  {
    id: 'flour',
    name: 'Flour',
    stored: 3,
    reserved: 3,
    transit: 2,
    local: 1,
    produced: 3,
    consumed: 4,
    delta: -1,
    group: 'Food',
  },
  {
    id: 'bread',
    name: 'Bread',
    stored: 6,
    reserved: 4,
    transit: 3,
    local: 4,
    produced: 4,
    consumed: 5.5,
    delta: -1.5,
    group: 'Food',
  },
  {
    id: 'fish',
    name: 'Fish',
    stored: 12,
    reserved: 2,
    transit: 1,
    local: 2,
    produced: 6,
    consumed: 4,
    delta: 1,
    group: 'Food',
  },
  {
    id: 'pigs',
    name: 'Pigs',
    stored: 8,
    reserved: 2,
    transit: 1,
    local: 2,
    produced: 3,
    consumed: 2.5,
    delta: 0.5,
    group: 'Food',
  },
  {
    id: 'meat',
    name: 'Meat',
    stored: 10,
    reserved: 2,
    transit: 1,
    local: 2,
    produced: 2.5,
    consumed: 2,
    delta: 0.5,
    group: 'Food',
  },
  {
    id: 'beer',
    name: 'Beer',
    stored: 9,
    reserved: 0,
    transit: 1,
    local: 2,
    produced: 3,
    consumed: 0,
    delta: 2,
    group: 'Food',
  },
  {
    id: 'coal',
    name: 'Coal',
    stored: 18,
    reserved: 5,
    transit: 2,
    local: 4,
    produced: 9,
    consumed: 7.5,
    delta: 1,
    group: 'Industry',
  },
  {
    id: 'iron',
    name: 'Iron ore',
    stored: 14,
    reserved: 3,
    transit: 2,
    local: 3,
    produced: 8,
    consumed: 7.5,
    delta: 0.5,
    group: 'Industry',
  },
  {
    id: 'iron_bars',
    name: 'Iron bars',
    stored: 8,
    reserved: 2,
    transit: 1,
    local: 2,
    produced: 7.5,
    consumed: 6,
    delta: 1,
    group: 'Industry',
  },
  {
    id: 'tools',
    name: 'Tools',
    stored: 16,
    reserved: 3,
    transit: 1,
    local: 2,
    produced: 3,
    consumed: 0,
    delta: 1.5,
    group: 'Industry',
  },
  {
    id: 'weapons',
    name: 'Weapons',
    stored: 6,
    reserved: 1,
    transit: 0,
    local: 1,
    produced: 2,
    consumed: 0,
    delta: 1,
    group: 'Industry',
  },
  {
    id: 'gold',
    name: 'Gold',
    stored: 84,
    reserved: 0,
    transit: 2,
    local: 3,
    produced: 3.5,
    consumed: 0,
    delta: 3.5,
    group: 'Industry',
  },
  {
    id: 'food',
    name: 'Provisions',
    stored: 4,
    reserved: 0,
    transit: 0,
    local: 1,
    produced: 0,
    consumed: 0,
    delta: 0,
    group: 'Food',
  },
];
const variantNames: Record<Variant, string> = { A: 'Fieldwork', B: 'Observatory', C: 'The Ledger' };
const icons: Record<string, string> = {
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
  chart: '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/>',
  routes:
    '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M5 8v7a3 3 0 0 0 3 3h9M7 6h9a3 3 0 0 1 0 6h-5"/>',
  book: '<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 6v15"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  save: '<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  layers: '<path d="m2 8 10-5 10 5-10 5zm0 5 10 5 10-5M2 18l10 5 10-5"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
  leaf: '<path d="M20 3C9 2 3 7 4 14c1 8 14 8 16-11ZM4 21 15 9"/>',
};
const icon = (name: string) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.chart}</svg>`;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
const signed = (value: number) =>
  (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(1);
const btn = (label: string, action: string, value = '', cls = '', glyph = '') =>
  `<button type="button" aria-label="${escape(label.replace(/<[^>]*>/g, '').trim())}" class="${cls}" data-action="${action}" data-value="${escape(value)}">${glyph ? icon(glyph) : ''}${label}</button>`;
const spark = (negative = false, key = 0) =>
  `<svg class="spark ${negative ? 'negative' : ''}" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true"><path d="${negative ? 'M0 3 10 6 20 5 30 12 40 10 50 17 60 14 70 20 80 19 90 24 100 22 120 28' : key % 2 ? 'M0 26 10 25 20 21 30 24 40 17 50 18 60 12 70 14 80 7 90 9 100 5 120 3' : 'M0 20 10 17 20 20 30 13 40 16 50 12 60 13 70 8 80 11 90 5 100 7 120 3'}"/></svg>`;

export function mountUIPrototype() {
  const params = new URLSearchParams(location.search);
  let variant: Variant = ['A', 'B', 'C'].includes(params.get('variant') ?? '')
    ? (params.get('variant') as Variant)
    : 'A';
  const views: View[] = ['workspace', 'economy', 'logistics', 'welcome', 'reference', 'about'];
  let view: View = views.includes(params.get('screen') as View)
    ? (params.get('screen') as View)
    : 'workspace';
  let dialog = '';
  let selected = 'bread' as Good;
  let windowName = '2 min';
  let filter = '';
  let sortBy = 'group';
  let group = 'All resources';
  let paused = true;
  let speed = 1;
  let seconds = 2060;
  let density = 'compact';
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sound = 35;
  let quality = '1';
  let auto = false;
  let showState = false;
  let notice = '';
  let referenceTopic = 'Stock & reservations';
  let inspected = 'Bakery 02';
  let buildingPaused = false;
  let overlay = false;
  let noticeTimer: ReturnType<typeof setTimeout>;
  let mapReady = false;
  let focusBeforeDialog: string | null = null;
  const saves = [
    { name: 'Northbank', type: 'Autosave', time: '34:20', gold: 84 },
    { name: 'Before the northern expansion', type: 'Checkpoint', time: '28:00', gold: 62 },
  ];
  const style = document.createElement('style');
  style.textContent = prototypeStyles;
  document.head.append(style);
  document.body.classList.add('ui-study');
  document.title = 'Settlers · Interface study';
  const root = document.createElement('div');
  root.id = 'ui-study';
  const frame = document.createElement('iframe');
  frame.id = 'study-map';
  frame.title = 'Paused colony rendered by the production WebGL renderer';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.src = 'game.html?uiPrototypeMap&devshot&seed=2024';
  document.body.append(frame, root);

  const mapGame = (): GameRuntime | undefined =>
    (frame.contentWindow as unknown as { productionArtPreview?: { game: GameRuntime } })
      ?.productionArtPreview?.game;
  const clock = () =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const windowControls = () =>
    `<div class="segmented" aria-label="Observation window">${['30 sec', '2 min', 'Session'].map((label) => btn(label, 'window', label, windowName === label ? 'active' : '')).join('')}</div>`;
  const windowNote = () =>
    windowName === '2 min'
      ? '32:20–34:20 · 120 s covered'
      : windowName === '30 sec'
        ? '33:50–34:20 · 30 s covered'
        : '00:00–34:20 · 34 min 20 s covered';
  const rateMultiplier = () =>
    windowName === '30 sec' ? 0.8 : windowName === 'Session' ? 0.65 : 1;
  const rate = (value: number) => {
    if (windowName === '30 sec') return (Math.round(value * 0.4) * 2).toFixed(1);
    if (windowName === 'Session')
      return (Math.round(value * 0.65 * (2060 / 60)) / (2060 / 60)).toFixed(1);
    return value.toFixed(1);
  };
  function resource(id: Good): Resource {
    const found = resources.find((entry) => entry.id === id);
    if (!found) throw new Error('Missing prototype resource: ' + id);
    return found;
  }
  const current = () => resource(selected);

  function header() {
    return `<header class="study-header"><div class="brand"><span class="brandmark">${icon('leaf')}</span>SETTLERS<span class="seed">ECONOMY SIMULATION</span></div><div class="session-name"><b>${escape(saves[0].name)}</b><span class="seed mono">SEED 2024</span>${icon('chevron')}</div><div class="grow"></div><div class="time-controls"><div class="clock"><b class="mono" data-clock>${clock()}</b><small> sim time</small></div>${btn(paused ? 'Resume' : 'Pause', 'pause', '', paused ? '' : 'active', paused ? 'play' : 'pause')}${[1, 2, 4, 8].map((value) => btn(`${value}×`, 'speed', String(value), value === speed ? 'active' : '')).join('')}</div><span class="badge header-extra">ILLUSTRATIVE DATA</span>${btn('Session', 'dialog', 'saves', '', 'save')}</header>`;
  }
  const navItems: [View, string, string][] = [
    ['workspace', 'Colony', 'map'],
    ['economy', 'Economy', 'chart'],
    ['logistics', 'Logistics', 'routes'],
  ];
  function sidebar() {
    return `<nav class="sidebar" aria-label="Main navigation"><div class="eyebrow nav-label">Workspace</div>${navItems.map(([key, label, glyph]) => btn(`<span>${label}</span>${key === 'logistics' ? '<span class="nav-count">2</span>' : ''}`, 'nav', key, view === key ? 'active' : '', glyph)).join('')}<div class="nav-bottom"><div class="eyebrow nav-label">Explore</div>${btn('<span>Welcome</span>', 'nav', 'welcome', view === 'welcome' ? 'active' : '', 'home')}${btn('<span>Model reference</span>', 'nav', 'reference', view === 'reference' ? 'active' : '', 'book')}${btn('<span>About</span>', 'nav', 'about', view === 'about' ? 'active' : '', 'info')}${btn('<span>Settings</span>', 'dialog', 'settings', '', 'settings')}<div class="model-note"><span class="dot"></span>Deterministic simulation<br>Local session · no account</div></div></nav>`;
  }
  function horizontalNav(className: string) {
    return `<nav class="${className}" aria-label="Main navigation">${[...navItems, ['reference', 'Reference', 'book'], ['about', 'About', 'info']].map(([key, label]) => btn(label, 'nav', key, view === key ? 'active' : '')).join('')}<div class="grow"></div>${btn('Welcome', 'nav', 'welcome', view === 'welcome' ? 'active' : '')}${btn('Settings', 'dialog', 'settings', '', 'settings')}</nav>`;
  }
  function kpis() {
    return `<div class="kpi-strip"><div class="kpi"><div class="label">Treasury</div><div class="value">84<span>gold</span></div><p><span class="up">+3.5 / min</span> · objective 200</p></div><div class="kpi"><div class="label">Production sites</div><div class="value">18<span>/ 24 working</span></div><p>4 waiting for inputs · 2 demand met</p></div><div class="kpi"><div class="label">Carrier workload</div><div class="value">19<span>/ 24 busy</span></div><p>7 jobs queued · 5 carriers idle</p></div><div class="kpi"><div class="label">Requires attention</div><div class="value warning">02<span>supply constraints</span></div><p>Bread supply · northern deliveries</p></div></div>`;
  }
  function mapPanel(compact = false) {
    return `<div class="map-slot" data-map-slot><div class="map-notice" ${mapReady ? 'hidden' : ''}>Loading the production WebGL map…</div><div class="map-top"><div class="map-caption"><b>${compact ? 'Spatial context' : 'Northbank · colony view'}</b>${compact ? '' : '<span>Seed 2024</span>'}</div><div class="map-actions">${btn('', 'map-zoom', '-1', '', 'minus').replace('<button ', '<button aria-label="Zoom out" ')}${btn('', 'map-zoom', '1', '', 'plus').replace('<button ', '<button aria-label="Zoom in" ')}${btn('', 'map-center', '', '', 'target').replace('<button ', '<button aria-label="Center colony" ')}</div></div>${compact ? '' : `<button class="map-pin" data-map-pin="51,44" data-action="inspect" data-value="Bakery 02"><span class="dot amber"></span>Bakery 02 · input wait</button><button class="map-pin" data-map-pin="45,43" data-action="inspect" data-value="Windmill 01">Windmill 01 · 3.0 / min</button>`}<div class="map-bottom">${compact ? btn('Open colony view', 'nav', 'workspace', '', 'map') : btn(overlay ? 'Hide supply routes' : 'Supply routes', 'overlay', '', overlay ? 'active' : '', 'routes')}<span class="map-scale">4 tiles</span></div>${overlay ? '<svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none" viewBox="0 0 600 400" preserveAspectRatio="none"><path d="M150 255 230 255 230 170 390 170 390 250" stroke="#f9f4ce" stroke-width="3" stroke-dasharray="7 5" fill="none"/><text x="240" y="157" fill="#fff" stroke="#354936" stroke-width=".2" font-size="11">Illustrative supply route</text></svg>' : ''}</div>`;
  }
  function inspector() {
    const mill = inspected.includes('Windmill');
    const output = mill ? 'flour' : 'bread';
    const input = mill ? 'grain' : 'flour';
    const name = mill ? 'Windmill 01' : 'Bakery 02';
    return `<aside class="inspector"><div class="between"><span class="object-type">Production / ${mill ? 'Milling' : 'Baking'}</span>${btn('', 'map-focus', mill ? '45,43' : '51,44', 'quiet', 'target').replace('<button ', '<button aria-label="Locate selected building" ')}</div><h2>${name}</h2><span class="badge ${buildingPaused ? '' : 'warn'}"><span class="dot amber"></span>${buildingPaused ? 'Manually paused' : 'Waiting for ' + input}</span><p class="intro">${mill ? 'Grain is available in western storage. Two incoming deliveries are still queued.' : 'Demand exceeds current supply. This bakery spent 60% of the reporting window waiting for flour.'}</p><div class="metric-pair"><div><span class="label">Observed output</span><strong>${rate(mill ? 3 : 2.0)}<small> / min</small></strong></div><div><span class="label">Theoretical capacity</span><strong>${mill ? '6.0' : '5.0'}<small> / min</small></strong></div></div><div class="between" style="margin-top:16px"><span class="label">${mill ? '50' : '40'}% of base capacity</span><small>${windowName}</small></div><div class="meter"><i style="width:${mill ? 50 : 40}%"></i></div><div class="definition-list"><div><span>Input stock</span><b>${resourceIcon(input as Good)} ${mill ? 1 : 0} ${input}</b></div><div><span>On the way</span><b>${mill ? 2 : 1} ${input}</b></div><div><span>Output awaiting pickup</span><b>${mill ? 1 : 2} ${output}</b></div><div><span>Delivered to storage</span><b>${rate(mill ? 2.5 : 1.5)} / min</b></div></div><div class="diagnosis"><strong>${mill ? 'Delivery constraint' : 'Upstream supply constraint'}</strong><p>${mill ? '18 grain are available in storage. Grain deliveries compete with construction jobs in the north.' : 'The windmill produces 3.0 flour/min. Two bakeries have a combined base capacity of 10.0 bread/min.'}</p>${btn(mill ? 'Inspect transport jobs →' : 'Trace flour supply →', 'trace', mill ? 'logistics' : 'flour', 'text-link')}</div><h4>Production chain</h4><div class="chain-mini">${btn('Grain', 'resource', 'grain')}<span>→</span>${btn('Flour', 'resource', 'flour')}<span>→</span>${btn('Bread', 'resource', 'bread')}</div><small>${windowNote()}<br>Rates per simulation minute · fixture observations</small><div class="action-stack">${btn(buildingPaused ? 'Resume site' : 'Pause site', 'pause-building', '', '', buildingPaused ? 'play' : 'pause')}${btn('Details', 'resource', output, '', 'arrow')}</div></aside>`;
  }
  function resourceSummary() {
    return `<section class="bottom-economy"><div class="between"><h3>Resource position</h3>${btn('View all resources →', 'nav', 'economy', 'text-link')}</div><div class="mini-resource-grid">${[
      'planks',
      'grain',
      'bread',
      'gold',
    ]
      .map((id, index) => {
        const r = resource(id as Good);
        return `<div class="mini-resource"><div class="resource-name">${resourceIcon(r.id)}${btn(r.name, 'resource', r.id, 'text-link')}</div><div class="between"><div class="big">${r.stored - r.reserved}<small> available</small></div><small class="${r.delta < 0 ? 'down' : 'up'}">${signed(r.delta)}/m</small></div>${spark(r.delta < 0, index)}</div>`;
      })
      .join('')}</div></section>`;
  }
  function pageHeading(title: string, subtitle: string, build = false) {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="view-tools">${windowControls()}${build ? btn('Add building', 'dialog', 'build', 'primary', 'plus') : btn('Export data', 'export', '', '', 'export')}</div></div>`;
  }
  function VariantA() {
    return `${header()}<div class="shell">${sidebar()}<main class="main-content">${view === 'workspace' ? `${pageHeading('Colony overview', 'Observe the economy. Understand the constraints.', true)}${kpis()}<div class="workspace-grid"><section class="map-cell">${mapPanel()}</section>${inspector()}${resourceSummary()}</div>` : pageContent()}</main></div>`;
  }
  function VariantB() {
    return `${header()}<div class="console-shell">${horizontalNav('console-nav')}${
      view === 'workspace'
        ? `<div class="console-grid">${kpis()}<aside class="console-resources"><div class="between"><h4>Available stock</h4><small>Δ/min</small></div>${resources
            .slice(0, 16)
            .map((r) =>
              btn(
                `<span>${resourceIcon(r.id)}${r.name}</span><span class="mono">${r.stored - r.reserved}<small class="${r.delta < 0 ? 'down' : 'up'}">${signed(r.delta)}</small></span>`,
                'resource',
                r.id,
                'console-resource',
              ),
            )
            .join(
              '',
            )}</aside><section class="map-cell">${mapPanel()}</section>${inspector()}<section class="console-timeline"><div class="between"><h3>Operations log</h3>${btn('Add building', 'dialog', 'build', '', 'plus')}</div>${events()}</section></div>`
        : `<main class="main-content">${pageContent()}</main>`
    }</div>`;
  }
  function VariantC() {
    return `${header()}<div class="ledger-shell">${horizontalNav('ledger-nav')}${view === 'workspace' ? `<div class="ledger-grid"><main class="ledger-main"><div class="ledger-title"><div><div class="eyebrow">Northbank / Economic position</div><h1>A working economy.</h1><p>Resource balances and constraints, with the colony in context.</p></div>${windowControls()}</div><div class="ledger-stats"><div class="kpi"><span class="label">Available treasury</span><div class="value">84 <span>gold</span></div><p>+3.5 per simulation minute</p></div><div class="kpi"><span class="label">Production sites</span><div class="value">18 <span>/ 24 working</span></div><p>4 input waits · 2 demand met</p></div><div class="kpi"><span class="label">Attention</span><div class="value warning">02 <span>constraints</span></div><p>Bread · northern transport</p></div></div>${resourceTable(true)}</main><aside class="ledger-aside"><div class="ledger-map">${mapPanel(true)}</div><div class="pane"><div class="between"><h3>Supply constraint</h3><span class="badge warn">Bread</span></div><p class="muted" style="font-size:12px;margin:10px 0 15px">Bread production trails consumption by 1.5 units/min. The flour chain is waiting on grain deliveries.</p>${btn('Investigate the chain →', 'nav', 'logistics', 'text-link')}</div><div class="pane"><h4>Colony actions</h4><div class="row" style="margin-top:14px">${btn('Add building', 'dialog', 'build', '', 'plus')}${btn('Save session', 'dialog', 'saves', '', 'save')}</div><div class="divider"></div><h4>Recent activity</h4>${events(2)}</div></aside></div>` : `<main class="main-content">${pageContent()}</main>`}</div>`;
  }
  function rows(compact = false) {
    let list = resources.filter(
      (r) =>
        (group === 'All resources' || r.group === group) &&
        r.name.toLowerCase().includes(filter.toLowerCase()),
    );
    if (sortBy === 'available')
      list = list.sort((a, b) => a.stored - a.reserved - (b.stored - b.reserved));
    if (sortBy === 'delta') list = list.sort((a, b) => a.delta - b.delta);
    return (
      list
        .map(
          (r, index) =>
            `<tr data-action="resource" data-value="${r.id}" tabindex="0" aria-label="Inspect ${r.name}" class="${r.id === selected ? 'selected' : ''}"><td>${resourceIcon(r.id)}${r.name}</td><td>${r.stored}</td><td><b>${r.stored - r.reserved}</b></td>${compact ? '' : `<td>${r.reserved}</td><td>${r.transit}</td>`}<td>${rate(r.produced)}</td><td>${rate(r.consumed)}</td><td class="${r.delta < 0 ? 'down' : 'up'}">${signed(r.delta * rateMultiplier())}</td><td>${spark(r.delta < 0, index)}</td></tr>`,
        )
        .join('') || `<tr><td colspan="10" class="muted">No resources match this filter.</td></tr>`
    );
  }
  function resourceTable(compact = false) {
    return `<div class="table-panel"><div class="table-tools"><h3>Resource ledger</h3><div class="grow"></div><input id="resource-search" type="search" aria-label="Filter resources" placeholder="Filter resources…" value="${escape(filter)}"><select id="resource-group" aria-label="Resource group">${['All resources', 'Materials', 'Food', 'Industry'].map((item) => `<option ${group === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div style="overflow:auto"><table data-compact="${compact}"><thead><tr><th>Resource</th><th>Stored</th><th>${btn('Available ↓', 'sort', 'available')}</th>${compact ? '' : '<th>Reserved</th><th>In transit</th>'}<th>Produced/m</th><th>Consumed/m</th><th>${btn('Stock Δ/m ↓', 'sort', 'delta')}</th><th>Trend</th></tr></thead><tbody id="resource-rows">${rows(compact)}</tbody></table></div><div class="table-note">${windowNote()} · Rates per simulation minute. Available excludes committed stock. Click a resource to inspect its accounting.</div></div>`;
  }
  function chart(title = 'Bread supply and consumption') {
    return `<div class="chart-panel"><div class="between"><h3>${title}</h3><span class="badge">OBSERVED · ${windowName}</span></div><svg class="chart" viewBox="0 0 600 160" role="img" aria-label="Illustrative bread production trails consumption through the reporting window"><g class="gridline"><path d="M35 20H590M35 65H590M35 110H590"/></g><g><text x="8" y="24">8</text><text x="8" y="69">4</text><text x="8" y="114">0</text><text x="35" y="145">${windowName === 'Session' ? '00:00' : windowName === '30 sec' ? '33:50' : '32:20'}</text><text x="285" y="145">${windowName === 'Session' ? '17:10' : windowName === '30 sec' ? '34:05' : '33:20'}</text><text x="550" y="145">34:20</text></g><path d="M35 64 85 64 85 58 135 58 135 72 185 72 185 65 235 65 235 78 285 78 285 70 335 70 335 82 385 82 385 70 435 70 435 66 485 66 485 72 535 72 535 64 590 64" class="trend"/><path d="M35 51 85 51 85 45 135 45 135 48 185 48 185 40 235 40 235 42 285 42 285 38 335 38 335 43 385 43 385 39 435 39 435 45 485 45 485 42 535 42 535 44 590 44" class="trend second"/></svg><div class="legend"><span><i></i>Produced · ${rate(4.0)} bread/min</span><span><i class="amber"></i>Consumed · ${rate(5.5)} bread/min</span></div></div>`;
  }
  function events(count = 3) {
    return `<div class="event-list">${[
      ['34:08', 'Bakery 02 is waiting for flour', '1 delivery in transit · current input stock 0'],
      ['33:42', 'Warehouse transfer completed', '3 grain delivered to Northbank warehouse'],
      ['32:16', 'Carrier training reached level 1', 'Travel speed +12% · 15 gold invested'],
    ]
      .slice(0, count)
      .map(
        ([time, title, detail]) =>
          `<div class="event"><time class="mono">${time}</time><div>${title}<p>${detail}</p></div></div>`,
      )
      .join('')}</div>`;
  }
  function economyPage() {
    return `${pageHeading('Economic position', 'Exact quantities, observed flows and explicit reporting windows.')}<div class="content-scroll"><div class="analytics-grid">${chart()}<section class="chart-panel"><div class="between"><h3>Balance explained</h3><span class="badge warn">Bread</span></div><div class="definition-list"><div><span>Opening stored balance</span><b>9.0</b></div><div><span>Stock change over 2 min</span><b class="down">−3.0</b></div><div><span>Closing stored balance</span><b>6.0</b></div><div><span>Committed to deliveries</span><b>4.0</b></div><div><span>Available now</span><b>2.0</b></div></div><small>Illustrative stock ledger. Reservations are included in stored stock, not added to it.</small></section></div>${resourceTable()}</div>`;
  }
  function logisticsPage() {
    return `${pageHeading('Supply & logistics', 'Follow a constraint from the downstream symptom to the underlying evidence.')}<div class="content-scroll"><div class="between"><div><h2>The flour chain is delivery-constrained</h2><p class="muted" style="margin-top:7px">Grain is available. Its location and delivery queue limit milling throughput.</p></div><span class="badge warn">2 affected bakeries</span></div><div class="network">${[
      ['grain', 'Western storage', '18 grain available', false],
      ['grain', 'Grain deliveries', '2 jobs queued', true],
      ['flour', 'Windmill 01', '3.0 / 6.0 flour/min', true],
      ['bread', '2 bakeries', '4.0 / 10.0 bread/min', true],
    ]
      .map(
        ([good, title, value, warn], i) =>
          `${i ? '<div class="network-arrow">→</div>' : ''}<div class="network-node ${warn ? 'warn' : ''}">${resourceIcon(good as Good)}<strong>${title}</strong><small>${value}</small><div style="margin-top:13px">${btn('Inspect', 'resource', good as string, 'text-link')}</div></div>`,
      )
      .join(
        '',
      )}</div><div class="logistics-bottom"><div class="pane"><div class="between"><h3>Delivery queue</h3><small>Current state</small></div><div style="margin-top:16px;overflow:auto"><table><thead><tr><th>Cargo / destination</th><th>Phase</th><th>Priority</th></tr></thead><tbody><tr data-action="inspect" data-value="Windmill 01"><td>Grain → Windmill 01</td><td><span class="badge warn">Queued</span></td><td>Normal</td></tr><tr data-action="inspect" data-value="Windmill 01"><td>Grain → Windmill 01</td><td><span class="badge warn">Queued</span></td><td>Normal</td></tr><tr data-action="inspect" data-value="Bakery 02"><td>Flour → Bakery 02</td><td><span class="badge good">Carrying</span></td><td>Normal</td></tr><tr><td>Planks → New warehouse</td><td><span class="badge good">Carrying</span></td><td>High</td></tr></tbody></table></div></div><div class="pane"><h3>Evidence & possible interventions</h3><div class="diagnosis"><strong>Observed</strong><p>Four construction jobs have high priority. Five carriers are idle in a different service area. A colony-wide idle count does not establish local delivery capacity.</p></div><div class="definition-list"><div><span>Windmill input waiting</span><b>50% of observed time</b></div><div><span>Bakery input waiting</span><b>60% of observed time</b></div><div><span>Land connectivity</span><b class="up">Reachable</b></div></div>${btn('Locate windmill', 'inspect', 'Windmill 01', '', 'target')}<p class="muted" style="font-size:11px;margin-top:15px">Inspect local carrier assignments and construction priority before adding production capacity. This is a suggested intervention, not a forecast.</p></div></div></div>`;
  }
  function welcomePage() {
    return `<section class="welcome"><div class="welcome-copy"><div class="eyebrow">The Settlers / A browser tribute</div><h1>Understand the<br>economy you build.</h1><p class="lead">A spatial simulation of production and logistics. Connect supply chains, observe the movement of goods, and discover what limits growth.</p><div class="welcome-session"><div class="between"><div><small>YOUR CURRENT COLONY</small><h2 style="margin-top:5px">${escape(saves[0].name)}</h2></div><span class="badge good">Ready to resume</span></div><div class="resume-stats"><div><b>34:20</b><small>Simulation time</small></div><div><b>24</b><small>Production sites</small></div><div><b>84</b><small>Treasury gold</small></div></div>${btn('Resume colony', 'resume', '', 'primary', 'arrow')}<small style="display:block;margin-top:10px">Opens paused, ready for inspection.</small></div><div class="row">${btn('New colony', 'dialog', 'new', '', 'plus')}${btn('Saved colonies', 'dialog', 'saves', '', 'save')}${btn('Import', 'dialog', 'import', '', 'export')}</div><div class="welcome-links">${btn('Model reference', 'nav', 'reference', 'text-link')}${btn('About the project', 'nav', 'about', 'text-link')}${btn('Settings', 'dialog', 'settings', 'text-link')}</div></div><div class="welcome-visual">${mapPanel(true)}<div class="visual-note"><div class="eyebrow" style="color:#65776b">Production is only half the story</div><h2 style="margin-top:8px">Every delivery has a journey.</h2><p>Stocks, reservations, carrier capacity and geography determine how the colony works.</p></div></div></section>`;
  }
  const referenceTopics = [
    'Stock & reservations',
    'Production & capacity',
    'Transport & roads',
    'Reading measurements',
    'Controls & navigation',
  ];
  function referencePage() {
    const entries: Record<string, string> = {
      'Stock & reservations': `<p class="lead">A good can be stored, committed, carried or held at a production site. Those positions answer different questions.</p><h2>Stored and available</h2><p><b>Stored</b> counts goods physically held in completed warehouses and headquarters. Reservations are commitments against that stock, so reserved goods are already included in the stored number.</p><p><b>Available</b> describes goods an action may spend. Construction and production reservations remain committed; uncollected warehouse transfers may be reclaimed. Placement also requires storage connected to the proposed site.</p><div class="note">Do not add reserved stock to stored stock. That counts the same goods twice.</div><h2>Goods outside storage</h2><p><b>In transit</b> means a carrier has physically picked up the good. Producer input stock, output awaiting delivery, and materials delivered to construction sites occupy separate positions.</p><h3>Example: bread</h3><p>Six bread are stored, with four committed to deliveries. In this example no reservations are reclaimable, leaving two available to spend. Three additional bread are already in transit.</p>${btn('Inspect bread accounting →', 'resource', 'bread', 'text-link')}`,
      'Production & capacity': `<p class="lead">A recipe describes a transformation. Its base cycle sets potential output; ingredients, transport and demand determine actual operation.</p><h2>Observed versus theoretical</h2><p>A bakery consumes one flour and produces one bread per 12-second base cycle: five bread per simulation minute before upgrades. Observed output counts completed production in the selected window.</p><h2>Waiting is not one condition</h2><p>Missing ingredients, output congestion, exhausted natural resources, missing well service, demand being met, and a manual pause are distinct states. Each calls for a different response.</p><h2>Demand controls</h2><p>Several producers stop at a stored-stock threshold. Requested warehouse reserves can raise that threshold. Deliberate demand pauses should not be presented as broken production.</p>`,
      'Transport & roads': `<p class="lead">Carriers move physical goods between stores, producers and construction sites.</p><h2>From reservation to delivery</h2><p>A job reserves available cargo, a carrier reaches the source and picks it up, then carries it to the destination. A delivery is complete on arrival, not on pickup.</p><h2>Connectivity and speed</h2><p>Passable land establishes reachability. Roads reduce travel cost; a building does not need an unbroken paved road connection to receive deliveries. Trees and sand can make routes slower.</p><h2>Local capacity</h2><p>A colony-wide count of idle carriers does not prove that a particular source has transport available. Inspect assignments, endpoints and priorities.</p>`,
      'Reading measurements': `<p class="lead">Every rate needs a unit, a time basis and an observation window.</p><h2>Simulation time</h2><p>Rates use units per simulation minute. Running at 4× changes wall-clock pace, not the economic rate. A global pause does not age the observation window.</p><h2>Coverage</h2><p>A new building or an imported older save may not have a full reporting window. Show the interval actually observed. Missing history is unknown, not zero.</p><h2>Flows and balances</h2><p>Production minus recipe consumption is not the same as a change in warehouse stock. Construction, transfers, contracts, rewards and storage arrivals also matter.</p><div class="note">This interface study uses illustrative measurements. Longer history and colony-wide stock accounting are proposed capabilities.</div>`,
      'Controls & navigation': `<p class="lead">Keep spatial inspection and economic comparison close together.</p><h2>In this interface study</h2><p>Use the bottom switcher or left/right arrow keys to compare the three layouts. Select a resource to inspect its stock positions. Follow a supply constraint to Logistics, or locate a building on the map.</p><h2>Session controls</h2><p>Resume, pause, speed, settings and saves demonstrate interface states in memory. The embedded map remains a paused display colony. Reload resets the study.</p><h2>Keyboard</h2><p>Tab moves between controls, Enter activates them, and Escape closes a dialog. Arrow keys retain their native behavior inside input fields and selects.</p>`,
    };
    return `${pageHeading('Model reference', 'A concise guide to the rules behind the numbers.')}<div class="content-scroll"><div class="doc-layout"><nav class="doc-toc" aria-label="Reference topics"><h4 style="margin-bottom:10px">The economic model</h4>${referenceTopics.map((topic) => btn(topic, 'topic', topic, referenceTopic === topic ? 'active' : '')).join('')}</nav><article class="prose"><div class="eyebrow">Reference / ${referenceTopics.indexOf(referenceTopic) + 1} of 5</div><h1 style="margin-top:12px">${referenceTopic}</h1>${entries[referenceTopic]}</article></div></div>`;
  }
  function aboutPage() {
    return `${pageHeading('About the project', 'A peaceful economy, made observable.')}<div class="content-scroll"><div class="about-layout"><article class="prose"><div class="eyebrow">The Settlers / Browser tribute</div><h1 style="font-size:40px;margin-top:18px;letter-spacing:-1.3px">Small settlements.<br>Connected systems.</h1><p class="lead">A tribute to the production chains and visible logistics of the 1993 Blue Byte classic.</p><p>Build a colony in which raw materials become useful goods and every delivery crosses a real landscape. The interest is in the relationships: production capacity, resource availability, transport and expansion.</p><h2>What the model represents</h2><p>Deterministic production and logistics, finite mineral deposits, stock reservations and individual carriers. Roads influence travel time; storage and geography shape the movement of goods.</p><h2>A deliberate simplification</h2><p>There are no market prices, combat, starvation deaths or defeat. Weather and lighting are cosmetic. This is an exploratory settlement economy, not a calibrated model of a real economy.</p><h2>Artwork & provenance</h2><p>The painted world uses generated artwork. Original images, references and generation notes are preserved with the project. The interface makes those origins visible alongside the model's assumptions.</p>${btn('Explore the model →', 'nav', 'reference', 'text-link')}</article><aside class="about-aside"><div class="brandmark" style="width:55px;height:55px">${icon('leaf')}</div><h4>Simulation</h4><p>Seeded world generation<br>Deterministic fixed steps<br>Rule-based autoplay</p><h4>Your data</h4><p>Browser-local saves<br>Import and export<br>No account required</p><h4>Presentation</h4><p>Painted assets<br>WebGL rendering<br>Reduced Motion support</p><div class="divider"></div><span class="badge">INTERFACE STUDY</span><p style="margin-top:10px">A proposal for an elegant, precise view of the economy.</p></aside></div></div>`;
  }
  function pageContent() {
    if (view === 'economy') return economyPage();
    if (view === 'logistics') return logisticsPage();
    if (view === 'welcome') return welcomePage();
    if (view === 'reference') return referencePage();
    return aboutPage();
  }
  function resourceDialog() {
    const r = current();
    return `<p class="muted">Where ${r.name.toLowerCase()} is held, what is committed, and how it is moving.</p><div class="ledger-breakdown"><div><small>Physically stored</small><strong>${r.stored}</strong><small>Warehouses + HQ</small></div><div><small>Available to spend</small><strong>${r.stored - r.reserved}</strong><small>After commitments</small></div><div><small>Reserved</small><strong>${r.reserved}</strong><small>Included in stored</small></div><div><small>In transit</small><strong>${r.transit}</strong><small>Picked up by carriers</small></div><div><small>At production sites</small><strong>${r.local}</strong><small>Inputs + waiting output</small></div><div><small>Stored stock change</small><strong class="${r.delta < 0 ? 'down' : 'up'}">${signed(r.delta)}</strong><small>Per simulation minute</small></div></div><div class="definition-list"><div><span>Observed production</span><b>${rate(r.produced)} ${r.name.toLowerCase()}/min</b></div><div><span>Recipe consumption</span><b>${rate(r.consumed)} ${r.name.toLowerCase()}/min</b></div><div><span>Observation window</span><b>${windowName}</b></div></div><div class="note muted" style="font-size:11px;padding:13px;background:var(--soft)">This fixture has no reclaimable transfer reservations. Available = stored − committed stock here. Reservations overlap stored stock; they are not additional inventory.</div>${r.id === 'bread' || r.id === 'flour' ? `<div class="diagnosis"><strong>Supply constraint</strong><p>The grain → flour → bread chain is below its base capacity. Inspect transport and upstream production before increasing capacity.</p>${btn('Trace supply chain →', 'trace', 'logistics', 'text-link')}</div>` : ''}<small>${windowNote()} · Illustrative quantities</small>`;
  }
  function dialogContents() {
    if (dialog === 'resource') return resourceDialog();
    if (dialog === 'settings')
      return `<div class="eyebrow">Workspace</div><div class="setting-row"><div>Information density<small>Row height and spacing in analytical tables.</small></div><select id="density-setting"><option value="compact" ${density === 'compact' ? 'selected' : ''}>Compact</option><option value="comfortable" ${density === 'comfortable' ? 'selected' : ''}>Comfortable</option></select></div><div class="setting-row"><div>Reduced motion<small>Keep transitions and map atmosphere still.</small></div><input id="motion-setting" type="checkbox" aria-label="Reduced motion" ${reducedMotion ? 'checked' : ''}></div><div class="setting-row"><div>Rendering quality<small>Full or economical resolution.</small></div><select id="quality-setting"><option value="1" ${quality === '1' ? 'selected' : ''}>Full · 1×</option><option value="0.75" ${quality === '0.75' ? 'selected' : ''}>Economical · 0.75×</option></select></div><div class="setting-row"><div>Sound level<small>Preview value; audio stays muted in this study.</small></div><input id="sound-setting" type="range" min="0" max="100" value="${sound}" aria-label="Sound level"></div><div class="setting-row"><div>Autoplay<small>Rule-based colony management. Preview state only.</small></div><input id="auto-setting" type="checkbox" aria-label="Autoplay" ${auto ? 'checked' : ''}></div><p class="muted" style="margin-top:20px;font-size:11px">Preferences stay in memory for this study. Existing game preferences are untouched.</p>`;
    if (dialog === 'saves')
      return `<p class="muted" style="margin-bottom:19px">Named checkpoints and a separate autosave for each colony.</p>${saves.map((save, index) => `<div class="save-card"><div class="between"><div><h3>${escape(save.name)}</h3><p>${save.time} simulation time · ${save.gold} gold · seed 2024</p></div><span class="badge ${index === 0 ? 'good' : ''}">${save.type}</span></div><div class="row" style="margin-top:13px">${btn('Open paused', 'load-save', String(index), '', 'play')}${btn('Export', 'export-save', String(index), 'quiet', 'export')}</div></div>`).join('')}<div class="row" style="margin-top:19px"><input id="checkpoint-name" placeholder="Name a new checkpoint…" aria-label="Checkpoint name" style="flex:1">${btn('Save checkpoint', 'save-checkpoint', '', 'primary')}</div><small style="display:block;margin-top:13px">Sample saves only. These entries are never written to browser storage.</small>`;
    if (dialog === 'build')
      return `<p class="muted">Compare base output and construction requirements before placement.</p><div class="build-grid">${[
        ['Lumberjack', 'logs', '17.1 logs/min', '2 planks · 1 tool'],
        ['Windmill', 'flour', '6.0 flour/min', '3 planks · 2 stone · 1 tool'],
        ['Bakery', 'bread', '5.0 bread/min', '3 planks · 2 stone · 1 tool'],
        ['Warehouse', 'planks', '+8 carrier capacity', '4 planks · 3 stone'],
        ['Grain farm', 'grain', '4.0 grain/min', '3 planks · 2 stone · 1 tool'],
        ['Well', 'stone', 'Service radius: 6 tiles', '1 plank · 2 stone'],
      ]
        .map(([name, good, capacity, cost]) =>
          btn(
            `${resourceIcon(good as Good)}<strong>${name}</strong><span class="capacity">${capacity}</span><small>${cost}</small>`,
            'choose-building',
            name,
            'build-card',
          ),
        )
        .join(
          '',
        )}</div><p class="muted" style="font-size:11px;margin-top:17px">Base capacities before upgrades. Bakery also needs flour and nearby well service.</p>`;
    if (dialog === 'new')
      return `<p class="muted">Give the colony a name and choose a reproducible starting map.</p><label class="field">Colony name<input id="colony-name" value="Eastmere" maxlength="60"></label><label class="field">Map seed<input id="colony-seed" type="number" value="2024" min="1" max="2147483647"></label><div class="diagnosis"><strong>Starting conditions</strong><p>Headquarters, 8 carriers and an initial material reserve. The economy follows the existing settlement rules.</p></div><small>This demonstrates the setup flow. The study keeps its illustrative colony and quantitative fixture.</small>`;
    return `<p class="muted">Import a saved colony without replacing your current checkpoint.</p><label class="field">Save code<textarea id="import-code" rows="6" placeholder="Paste a colony save code…"></textarea></label><small>Import is a flow preview here. No supplied code is executed or written to storage.</small>`;
  }
  function dialogMarkup() {
    const titles: Record<string, string> = {
      settings: 'Settings',
      saves: 'Saved colonies',
      build: 'Add a building',
      resource: current().name + ' · stock & flow',
      new: 'New colony',
      import: 'Import colony',
    };
    return `<div class="dialog-scrim" data-scrim><section class="study-dialog" role="dialog" aria-modal="true" aria-labelledby="study-dialog-title"><header class="dialog-header"><div><div class="eyebrow">Northbank / ${dialog === 'resource' ? 'Resource accounting' : 'Workspace'}</div><h2 id="study-dialog-title" style="margin-top:5px">${titles[dialog]}</h2></div>${btn('', 'close', '', 'quiet', 'close').replace('<button ', '<button aria-label="Close dialog" ')}</header><div class="dialog-body">${dialogContents()}</div><footer class="dialog-footer">${btn(dialog === 'settings' ? 'Done' : 'Close', 'close')}${dialog === 'new' ? btn('Create preview colony', 'new-colony', '', 'primary', 'arrow') : dialog === 'import' ? btn('Preview import', 'import', '', 'primary', 'export') : ''}</footer></section></div>`;
  }
  function stateSnapshot() {
    return {
      variant: `${variant} · ${variantNames[variant]}`,
      screen: view,
      dialog: dialog || null,
      resource: selected,
      selectedBuilding: inspected,
      reportingWindow: windowName,
      filter,
      group,
      sortBy,
      paused,
      speed,
      demoTime: clock(),
      buildingPaused,
      overlay,
      preferences: { density, reducedMotion, sound, quality, auto },
      savedColonyNames: saves.map((save) => save.name),
      dataSource: 'Illustrative fixture; not measurements from the embedded map',
      map: 'Production PixiJS WebGL, paused display colony',
      persistence: 'None; all UI state resets on reload',
    };
  }
  function switcher() {
    return `<div class="prototype-switcher" aria-label="Prototype variants">${btn('←', 'variant-step', '-1').replace('<button ', '<button aria-label="Previous variant" ')}<div class="switcher-label"><small>Throwaway UI study</small><strong>${variant} / ${variantNames[variant]}</strong></div>${btn('→', 'variant-step', '1').replace('<button ', '<button aria-label="Next variant" ')}${(['A', 'B', 'C'] as Variant[]).map((key) => btn(key, 'variant', key, 'v-choice ' + (variant === key ? 'active' : ''))).join('')}${btn('State', 'state', '', 'state-toggle')}</div>${showState ? `<aside class="prototype-state"><b>Visible prototype state</b><pre id="state-json">${escape(JSON.stringify(stateSnapshot(), null, 2))}</pre></aside>` : ''}`;
  }
  function updateURL() {
    const url = new URL(location.href);
    url.searchParams.set('variant', variant);
    url.searchParams.set('screen', view);
    history.replaceState(null, '', url);
  }
  function render() {
    root.dataset.variant = variant;
    document.body.style.background =
      variant === 'B' ? '#151c20' : variant === 'C' ? '#f4f3ee' : '#f5f6f3';
    root.dataset.density = density;
    root.innerHTML =
      (variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()) +
      `<footer class="status-footer"><span><span class="dot ${paused ? 'amber' : ''}"></span>${paused ? 'Paused' : 'Running'} · ${auto ? 'Autoplay' : 'Manual control'}<span class="header-extra"> · All rates use simulation time</span></span><span>Illustrative snapshot · ${windowNote()}</span></footer>` +
      (dialog ? dialogMarkup() : '') +
      (notice ? `<div class="notice-toast" role="status">${escape(notice)}</div>` : '') +
      switcher();
    updateURL();
    const slot = root.querySelector('[data-map-slot]');
    mapObserver.disconnect();
    if (slot) mapObserver.observe(slot);
    syncMap();
    requestAnimationFrame(syncMap);
  }
  function syncMap() {
    const slot = root.querySelector<HTMLElement>('[data-map-slot]');
    if (!slot || slot.getBoundingClientRect().width < 1) {
      frame.style.visibility = 'hidden';
      return;
    }
    const rect = slot.getBoundingClientRect();
    Object.assign(frame.style, {
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      visibility: 'visible',
    });
    const game = mapGame();
    if (!game) return;
    const scale = root.querySelector<HTMLElement>('.map-scale');
    if (scale) scale.style.width = game.TS * game.z * 4 + 'px';
    if (!mapReady) {
      mapReady = true;
      const loading = root.querySelector<HTMLElement>('.map-notice');
      if (loading) loading.hidden = true;
    }
    root.querySelectorAll<HTMLElement>('[data-map-pin]').forEach((pin) => {
      const [x, y] = (pin.dataset.mapPin ?? '').split(',').map(Number);
      pin.style.left = ((x + 0.5) * game.TS - game.cam.x) * game.z + 'px';
      pin.style.top = ((y - 0.9) * game.TS - game.cam.y) * game.z + 'px';
    });
  }
  const mapObserver = new ResizeObserver(syncMap);
  function toast(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    render();
    noticeTimer = setTimeout(() => {
      notice = '';
      render();
    }, 4500);
  }
  function openDialog(name: string) {
    const focused = document.activeElement as HTMLElement;
    focusBeforeDialog = focused?.dataset.action || null;
    dialog = name;
    render();
    root.querySelector<HTMLElement>('.study-dialog button')?.focus();
  }
  function changeVariant(key: Variant) {
    variant = key;
    render();
    console.info('UI prototype state', stateSnapshot());
  }
  function download(filename: string, contents: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function act(action: string, value: string) {
    if (action === 'nav') {
      view = value as View;
      dialog = '';
      render();
    } else if (action === 'variant') changeVariant(value as Variant);
    else if (action === 'variant-step') {
      const keys: Variant[] = ['A', 'B', 'C'];
      changeVariant(keys[(keys.indexOf(variant) + Number(value) + 3) % 3]);
    } else if (action === 'state') {
      showState = !showState;
      render();
    } else if (action === 'dialog') openDialog(value);
    else if (action === 'close') {
      dialog = '';
      render();
      if (focusBeforeDialog)
        root.querySelector<HTMLElement>(`[data-action="${focusBeforeDialog}"]`)?.focus();
    } else if (action === 'resource') {
      selected = value as Good;
      openDialog('resource');
    } else if (action === 'pause') {
      paused = !paused;
      render();
    } else if (action === 'speed') {
      speed = Number(value);
      render();
    } else if (action === 'window') {
      windowName = value;
      render();
    } else if (action === 'sort') {
      sortBy = value;
      render();
    } else if (action === 'resume' || action === 'load-save') {
      paused = true;
      view = 'workspace';
      dialog = '';
      if (action === 'load-save')
        toast(`Opened “${saves[Number(value)].name}” paused (sample session).`);
      else render();
    } else if (action === 'topic') {
      referenceTopic = value;
      render();
    } else if (action === 'trace') {
      if (value === 'flour') inspected = 'Windmill 01';
      view = 'logistics';
      dialog = '';
      render();
    } else if (action === 'inspect') {
      inspected = value;
      view = 'workspace';
      dialog = '';
      if (variant === 'C') {
        selected = value.includes('Windmill') ? 'flour' : 'bread';
        dialog = 'resource';
      }
      render();
    } else if (action === 'pause-building') {
      buildingPaused = !buildingPaused;
      render();
    } else if (action === 'overlay') {
      overlay = !overlay;
      render();
    } else if (action === 'map-zoom') {
      const game = mapGame();
      if (game) {
        game.zoomAt(Math.max(0, Math.min(6, game.zi + Number(value))));
        syncMap();
      }
    } else if (action === 'map-center' || action === 'map-focus') {
      const game = mapGame();
      if (game) {
        const [x, y] = value ? value.split(',').map(Number) : [49, 46];
        game.cam.x = (x + 0.5) * game.TS - game.vw / game.z / 2;
        game.cam.y = (y + 0.5) * game.TS - game.vh / game.z / 2;
        game.clampCam();
        syncMap();
      }
    } else if (action === 'save-checkpoint') {
      const name = requireElement('checkpoint-name', HTMLInputElement, root).value.trim();
      if (name) {
        saves.push({ name: name.slice(0, 60), type: 'Checkpoint', time: clock(), gold: 84 });
        toast('Checkpoint added to the in-memory preview.');
      }
    } else if (action === 'export') {
      const csv =
        'Illustrative UI prototype data; not a simulation export\nResource,Stored,Available,Reserved,In transit,Produced per sim min,Consumed per sim min,Stored change per sim min\n' +
        resources
          .map((r) =>
            [
              r.name,
              r.stored,
              r.stored - r.reserved,
              r.reserved,
              r.transit,
              rate(r.produced),
              rate(r.consumed),
              r.delta,
            ].join(','),
          )
          .join('\n');
      download('settlers-prototype-sample.csv', csv, 'text/csv');
      toast('Illustrative resource data exported.');
    } else if (action === 'export-save') {
      download(
        'settlers-prototype-checkpoint.json',
        JSON.stringify(
          {
            prototype: true,
            notImportableGameSave: true,
            checkpoint: saves[Number(value)],
            state: stateSnapshot(),
          },
          null,
          2,
        ),
        'application/json',
      );
      toast('Sample checkpoint exported; this is not a game save.');
    } else if (action === 'choose-building') {
      dialog = '';
      view = 'workspace';
      toast(
        `${value} selected. This study previews selection; placement and economy changes belong to implementation.`,
      );
    } else if (action === 'new-colony') {
      const name = requireElement('colony-name', HTMLInputElement, root).value.trim() || 'Eastmere';
      saves.unshift({ name: name.slice(0, 60), type: 'Preview', time: '00:00', gold: 0 });
      view = 'workspace';
      dialog = '';
      paused = true;
      toast(
        'Setup preview complete. The map and economic figures remain the shared comparison fixture.',
      );
    } else if (action === 'import') {
      const code = requireElement('import-code', HTMLTextAreaElement, root).value.trim();
      toast(
        code
          ? 'Import flow preview complete. No colony was replaced.'
          : 'Paste a save code to preview this step.',
      );
    }
  }
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('[data-action]');
    if (button?.dataset.action) act(button.dataset.action, button.dataset.value || '');
    else if (target.hasAttribute('data-scrim')) act('close', '');
  });
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === 'resource-search') {
      filter = input.value;
      const table = root.querySelector('table[data-compact]') as HTMLTableElement;
      requireElement('resource-rows', root).innerHTML = rows(table.dataset.compact === 'true');
    }
    if (input.id === 'sound-setting') sound = Number(input.value);
  });
  root.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === 'resource-group') group = input.value;
    if (input.id === 'density-setting') density = input.value;
    if (input.id === 'motion-setting') reducedMotion = input.checked;
    if (input.id === 'quality-setting') {
      quality = input.value;
      const game = mapGame();
      if (game) {
        game.presentationPrefs.quality = quality === '0.75' ? 0.75 : 1;
        game.resize();
      }
    }
    if (input.id === 'auto-setting') auto = input.checked;
    render();
  });
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && dialog) {
      event.preventDefault();
      act('close', '');
      return;
    }
    if (dialog && event.key === 'Tab') {
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          '.study-dialog button,.study-dialog input,.study-dialog select,.study-dialog textarea',
        ),
      );
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (target.closest('input,textarea,select,[contenteditable]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      act('variant-step', event.key === 'ArrowLeft' ? '-1' : '1');
    }
    if (event.key === 'Enter' && target.matches('tr[data-action]'))
      act(target.dataset.action ?? '', target.dataset.value ?? '');
  });
  window.addEventListener('resize', syncMap);
  // Presentation-only timer: the embedded colony never steps or saves.
  setInterval(() => {
    if (!paused && !dialog && document.visibilityState === 'visible') {
      seconds += speed;
      root.querySelectorAll('[data-clock]').forEach((element) => {
        element.textContent = clock();
      });
      const state = root.querySelector('#state-json');
      if (state) state.textContent = JSON.stringify(stateSnapshot(), null, 2);
    }
    syncMap();
    const unavailable = frame.contentDocument?.documentElement.dataset.renderer === 'unavailable';
    if (unavailable) {
      const loading = root.querySelector<HTMLElement>('.map-notice');
      if (loading) {
        loading.hidden = false;
        loading.setAttribute('role', 'alert');
        loading.textContent =
          'WebGL unavailable. Enable hardware acceleration and reload to view the colony.';
      }
    }
  }, 1000);
  render();
  console.info('UI prototype state', stateSnapshot());
}
