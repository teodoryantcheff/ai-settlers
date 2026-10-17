import { requireElement } from './dom.ts';
import { html as markup, trusted } from './markup.ts';
import { createLiveReportUpdater } from './live-report.ts';
import { revealReportHeading } from './report-navigation.ts';
import type { GameRuntime } from '../runtime.ts';
import type { EntityReference, AttentionIssue, ActivityEvent } from '../observations/attention.ts';
import type { Good } from '../types.ts';
import { observePresentation } from './domain-feedback.ts';

/** Two live reports over passive, durable observations; controls never rebuild on a tick. */
export function createAttentionView(game: GameRuntime): AttentionViewSubsystem {
  const host = requireElement('workspace-attention'),
    historyHost = requireElement('workspace-activity');
  let selected: AttentionIssue | null = null,
    inspected: EntityReference | null = null;
  let lastStamp = '';
  const refs = new Map<number, EntityReference>();

  const age = (time: number) =>
    Math.max(0, game.state.time - time).toFixed(0) + ' simulation seconds';
  const at = (time: number) =>
    Math.floor(time / 60) +
    ':' +
    Math.floor(time % 60)
      .toString()
      .padStart(2, '0');
  function label(ref: EntityReference) {
    return game.BSPEC[ref.type].name + ' #' + ref.id + ' · (' + ref.x + ', ' + ref.y + ')';
  }
  function referenceActions(ref: EntityReference, key: string) {
    refs.set(ref.id, ref);
    const live = game.byId(ref.id);
    return markup`<p class="attention-place">${label(ref)}${!live ? ' · removed; former location' : ''}</p><div class="attention-actions"><button data-attention-inspect="${ref.id}" data-attention-key="inspect-${key}">${live ? 'Inspect' : 'Explain removed building'}</button><button data-attention-locate="${ref.id}" data-attention-key="locate-${key}">${live ? 'Locate' : 'Locate former site'}</button></div>`;
  }
  const updateReport = createLiveReportUpdater({
    focusAttribute: 'data-attention-key',
    disclosureAttribute: 'data-attention-expand',
    disclosureDefault: 'markup',
    fallback: (element) =>
      element.querySelector<HTMLElement>('h2,h3') ||
      (historyHost.contains(element) ? historyHost : host).querySelector<HTMLElement>('h1'),
  });
  function replace(parent: HTMLElement, id: string, html: string) {
    updateReport(parent.querySelector<HTMLElement>('#' + id), html);
  }
  host.innerHTML = `<h1 id="attention-heading">Attention</h1><p class="attention-intro">Unresolved conditions, evidence and actions. The colony continues to run here.</p><div class="attention-toolbar"><label>Find issues<input id="attention-query" type="search" placeholder="Building, condition or resource" /></label><label>Severity<select id="attention-severity"><option value="all">All priorities</option><option value="urgent">Urgent failures</option><option value="bottleneck">Persistent bottlenecks</option></select></label><button data-attention-history>View activity history</button></div><p id="attention-status" class="attention-muted"></p><div id="attention-list"></div><section id="attention-detail" class="attention-card"></section><p class="attention-muted">Production waits become persistent after 12 simulation seconds. Deliberate pauses and satisfied demand/reserves are excluded. Paused, hidden and offline time never matures a wait. Visible notices and audio retain separate coalescing and cooldowns.</p>`;
  historyHost.innerHTML = `<h1 id="activity-heading">Activity</h1><p class="attention-intro">The latest 200 significant colony events, independent of notification cooldowns.</p><div class="attention-toolbar"><label>Find events<input id="activity-query" type="search" placeholder="Building, event or resource" /></label><label>Priority<select id="activity-severity"><option value="all">All priorities</option><option value="urgent">Urgent failures</option><option value="bottleneck">Bottlenecks</option><option value="info">Information</option></select></label><label>History window<select id="activity-window"><option value="all">Retained history</option><option value="30">30 seconds</option><option value="120">2 minutes</option><option value="600">10 minutes</option></select></label><button data-attention-open>View unresolved issues</button></div><p id="activity-coverage" class="attention-muted"></p><div id="activity-list"></div><section id="activity-contributor" class="attention-card"></section>`;
  function removedContext() {
    if (!inspected) return '';
    return markup`<h2 tabindex="-1" data-attention-key="contributor-heading">${game.byId(inspected.id) ? 'Inspected contributor' : 'Contributor removed'}</h2><p>${game.byId(inspected.id) ? 'Building details are open in the docked inspector. Inspect preserves the camera.' : 'This building no longer exists. Its historical event describes the former building; its current production and controls are unavailable. Choose a surviving supplier or explicitly locate its former site.'}</p>${trusted(referenceActions(inspected, 'contributor'))}`;
  }
  function detail(issues: AttentionIssue[]) {
    if (!selected)
      return markup`<h2 tabindex="-1" data-attention-key="detail-heading">Issue evidence</h2><p>Choose a persistent issue to see its actual input, output or local-resource evidence. Inspect opens building details; Locate explicitly moves to the map.</p>${trusted(inspected && !game.byId(inspected.id) ? removedContext() : '')}`;
    const current = issues.find((issue) => issue.key === selected?.key);
    if (current) selected = current;
    const issue = selected;
    return markup`<h2 tabindex="-1" data-attention-key="detail-heading">${issue.title}</h2>${trusted(!current ? '<p class="attention-muted">This issue is no longer active. Its last evidence is retained here as context; this does not assert that production has resumed. See Activity for the recorded transition.</p>' : markup`<p><strong>Persistent bottleneck</strong> · observed for ${age(issue.since)}</p>`)}${trusted(referenceActions(issue.entity, 'affected'))}<details data-attention-expand="evidence-${issue.entity.id}" open><summary data-attention-key="evidence-${issue.entity.id}">Evidence and next steps</summary><ul>${trusted(issue.evidence.map((line) => markup`<li>${line}</li>`).join(''))}</ul><p>${issue.advice}</p></details><div class="attention-actions">${trusted(issue.goods.map((good) => markup`<button data-attention-good="${good}" data-attention-key="good-${good}">Economy: ${game.GOODS[good].name}</button>`).join(''))}<button data-attention-logistics data-attention-key="logistics">Open Logistics</button><button data-attention-reference data-attention-key="reference">Diagnosis reference</button></div>${trusted(issue.contributors.length ? markup`<h3>Current suppliers</h3><p>These surviving producers make an eligible ingredient. Their existence does not establish available stock or an active delivery.</p>${trusted(issue.contributors.map((ref) => referenceActions(ref, 'supplier-' + ref.id)).join(''))}` : issue.reason === 'inputs' ? '<p>No completed eligible supplier is currently present. Stored stock may still supply the recipe; inspect Economy before choosing another producer.</p>' : '')}${trusted(inspected && !game.byId(inspected.id) ? removedContext() : '')}`;
  }
  function eventRow(event: ActivityEvent) {
    return markup`<article class="attention-event" data-event-id="${event.id}"><div class="attention-event-time">${at(event.time)}<span>${event.severity === 'bottleneck' ? 'Bottleneck' : event.severity === 'urgent' ? 'Urgent' : 'Information'}</span></div><div><p>${event.message}</p>${trusted(event.entity ? referenceActions(event.entity, 'event-' + event.id) : '')}${trusted(event.good ? markup`<button data-attention-good="${event.good}" data-attention-key="event-good-${event.id}">Economy: ${game.GOODS[event.good].name}</button>` : '')}${trusted(event.kind.startsWith('issue-') && event.entity ? markup`<button data-attention-issue="${event.entity.id}" data-attention-key="event-issue-${event.id}">View current attention</button>` : '')}${trusted(event.kind.startsWith('storage-') ? '<button data-attention-save>Open saves and export recovery</button>' : '')}</div></article>`;
  }
  function update(force = false) {
    // Current evidence must refresh even with Atlas collapsed or simulation age unchanged.
    // The observation query already owns deliberate-pause and demand suppression.
    const issues = game.activeAttention();
    const storageFailed = !game.saveHealth?.ok,
      graphicsFailed = game.renderingAvailable === false,
      urgent = Number(storageFailed) + Number(graphicsFailed),
      count = issues.length + urgent;
    const badge = requireElement('atlas-attention-count');
    const badgeLabel = count + ' active Attention issue' + (count === 1 ? '' : 's');
    if (badge.textContent !== String(count)) badge.textContent = String(count);
    if (badge.getAttribute('aria-label') !== badgeLabel)
      badge.setAttribute('aria-label', badgeLabel);
    if (badge.dataset.urgent !== String(urgent > 0)) badge.dataset.urgent = String(urgent > 0);
    if (!force && game.workspace !== 'attention' && game.workspace !== 'activity') return;
    const stamp = JSON.stringify([
      game.workspace,
      Math.floor(game.state.time * 2),
      game.attentionData.nextId,
      issues,
      game.saveHealth,
      game.renderingAvailable,
      selected?.key,
      inspected?.id,
    ]);
    if (!force && lastStamp === stamp) return;
    lastStamp = stamp;
    refs.clear();
    const failures = [
      storageFailed
        ? markup`<article class="attention-card urgent"><h2>Urgent · Browser storage unavailable</h2><p>${game.saveHealth?.message || 'No browser storage is available.'}</p><p>The current colony remains exportable. Previous valid checkpoints are preserved on a failed write. Export a recovery file, free browser storage and retry saving.</p><button data-attention-save>Open saves and export recovery</button></article>`
        : '',
      graphicsFailed
        ? '<article class="attention-card urgent"><h2>Urgent · Graphics unavailable</h2><p>The renderer failed and the colony is paused. Follow the visible graphics recovery panel to reload. Stored checkpoints remain available.</p><button data-attention-save>Open saves and export recovery</button></article>'
        : '',
    ].filter(Boolean);
    const query = (requireElement<HTMLInputElement>('attention-query').value || '').toLowerCase(),
      severity = requireElement<HTMLSelectElement>('attention-severity').value;
    const filtered = issues.filter(
      (issue) =>
        severity !== 'urgent' &&
        [issue.title, game.BSPEC[issue.entity.type].name, ...issue.evidence]
          .join(' ')
          .toLowerCase()
          .includes(query),
    );
    const statusText =
      failures.length +
      ' urgent failures · ' +
      issues.length +
      ' persistent bottlenecks · ' +
      filtered.length +
      ' bottlenecks match filters.';
    const status = requireElement('attention-status');
    if (status.textContent !== statusText) status.textContent = statusText;
    const visibleFailures =
      severity !== 'bottleneck'
        ? failures.filter((html) => !query || html.toLowerCase().includes(query)).join('')
        : '';
    replace(
      host,
      'attention-list',
      markup`${trusted(visibleFailures)}${trusted(
        filtered
          .map(
            (issue) =>
              markup`<article class="attention-card"><span class="attention-priority">Persistent bottleneck · ${age(issue.since)}</span><h2>${issue.title}</h2><p>${label(issue.entity)}</p><button data-attention-issue="${issue.entity.id}" data-attention-key="issue-${issue.entity.id}">Evidence and actions</button></article>`,
          )
          .join(''),
      )}${trusted(
        !filtered.length && !visibleFailures
          ? markup`<p class="empty-state">${issues.length || failures.length ? 'No issues match these filters.' : 'No persistent issues need attention. Ordinary waits and intentional pauses are excluded.'}</p>`
          : '',
      )}`,
    );
    replace(host, 'attention-detail', detail(issues));
    const journal = game.activityHistory(),
      filter = requireElement<HTMLInputElement>('activity-query').value.toLowerCase(),
      priority = requireElement<HTMLSelectElement>('activity-severity').value,
      window = requireElement<HTMLSelectElement>('activity-window').value;
    const from =
      window === 'all'
        ? journal.started
        : Math.max(journal.started, game.state.time - Number(window));
    const retainedFrom = journal.events[0]?.time ?? journal.started;
    requireElement('activity-coverage').textContent =
      `Observation coverage began at ${at(journal.started)} simulation age. ${window === 'all' ? 'Retained history' : 'Requested interval'}: ${at(from)}–${at(game.state.time)}. ${journal.events.length} retained significant events${journal.events.length === 200 ? '; older events may have been dropped' : ''}. Earliest retained event: ${at(retainedFrom)}. Earlier unrecorded activity is unavailable. This is a significant-event journal, not a complete delivery or route log.`;
    const events = journal.events
      .filter(
        (event) =>
          event.time >= from &&
          (priority === 'all' || priority === event.severity) &&
          [
            event.message,
            event.good ? game.GOODS[event.good].name : '',
            event.entity ? game.BSPEC[event.entity.type].name : '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(filter),
      )
      .reverse();
    replace(
      historyHost,
      'activity-list',
      events.map(eventRow).join('') ||
        '<p class="empty-state">No recorded significant events match this view. Unrecorded earlier history is unavailable.</p>',
    );
    replace(historyHost, 'activity-contributor', removedContext());
  }
  function showAttentionEntity(id: number, history = false) {
    if (history) {
      const event = game
        .activityHistory()
        .events.reverse()
        .find((event) => event.entity?.id === id);
      const building = game.byId(id);
      inspected = building
        ? { id: building.id, type: building.type, x: building.x, y: building.y }
        : event?.entity || null;
      game.switchWorkspace('activity');
    } else {
      selected = game.activeAttention().find((issue) => issue.entity.id === id) || null;
      game.switchWorkspace('attention');
    }
    update(true);
    const heading =
      requireElement(history ? 'activity-heading' : 'attention-detail').querySelector<HTMLElement>(
        'h2',
      ) || requireElement(history ? 'activity-heading' : 'attention-heading');
    heading.tabIndex = -1;
    revealReportHeading(history ? historyHost : host, heading);
  }
  for (const parent of [host, historyHost]) {
    parent.addEventListener('input', () => update(true));
    parent.addEventListener('change', () => update(true));
    parent.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.attentionIssue) showAttentionEntity(+button.dataset.attentionIssue);
      else if (button.dataset.attentionInspect) {
        inspected = refs.get(+button.dataset.attentionInspect) ?? null;
        if (inspected) {
          if (!game.inspectContributor(inspected.id)) game.showRemovedContributor(inspected);
          update(true);
        }
      } else if (button.dataset.attentionLocate) {
        const ref = refs.get(+button.dataset.attentionLocate);
        if (ref) game.locateContributor(game.byId(ref.id) ? ref.id : ref);
      } else if (button.dataset.attentionGood) {
        game.showEconomyResource(button.dataset.attentionGood as Good);
      } else if (button.hasAttribute('data-attention-logistics')) game.switchWorkspace('logistics');
      else if (button.hasAttribute('data-attention-reference')) game.openReference('diagnosis');
      else if (button.hasAttribute('data-attention-save')) game.openSaveManager();
      else if (button.hasAttribute('data-attention-history')) game.switchWorkspace('activity');
      else if (button.hasAttribute('data-attention-open')) game.switchWorkspace('attention');
    });
  }
  observePresentation(game, 'worldLoaded', () => {
    selected = inspected = null;
    refs.clear();
    updateReport.reset();
    lastStamp = '';
    update(true);
  });
  observePresentation(game, 'productionControlChanged', () => update(true));
  observePresentation(game, 'buildingDemolished', (e) => {
    if (inspected?.id === e.id) game.showRemovedContributor(inspected);
    update(true);
  });
  game.registerReportWindow('attention', 'Attention', 'data-attention-key');
  game.registerReportWindow('activity', 'Activity', 'data-attention-key');
  return { updateAttentionView: () => update(), showAttentionEntity };
}
export interface AttentionViewSubsystem {
  updateAttentionView: () => void;
  showAttentionEntity: (id: number, history?: boolean) => void;
}
