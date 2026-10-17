import { requireElement } from './dom.ts';
import { html as markup, trusted } from './markup.ts';
import { createLiveReportUpdater } from './live-report.ts';
import { revealReportHeading } from './report-navigation.ts';
import type { GameRuntime } from '../runtime.ts';
import type { Good, ProductionRateWindow } from '../types.ts';
import type { TransportEndpoint, TransportRow } from '../simulation/transport.ts';
import { ingredientShortages, eligibleIngredients } from '../gameplay/production-rules.ts';
import { RESOURCE_GROUPS, resourceIcon } from './resource-icons.ts';
import { observePresentation } from './domain-feedback.ts';
import type { RemovedContributor } from './workspace.ts';

/** Logistics displays recorded arrivals and current routes without assigning jobs or predicting travel. */
export function createLogisticsView(game: GameRuntime): LogisticsViewSubsystem {
  const host = requireElement('workspace-logistics');
  let window: ProductionRateWindow = 30;
  let selected: TransportRow | null = null;
  let inspected: RemovedContributor | null = null;
  const goods = RESOURCE_GROUPS.flatMap((group) => group.goods);
  const stages = {
    queued: 'Queued · no carrier assigned',
    assigned: 'Assigned · awaiting pickup',
    carrying: 'Physically carrying',
    unknown: 'Assignment recorded · carrier evidence unavailable',
  };
  const kinds = {
    fetch: 'Supply delivery',
    deliver: 'Producer collection',
    transfer: 'Warehouse transfer',
    recovered: 'Recovered cargo',
  };

  const updateReport = createLiveReportUpdater({
    focusAttribute: 'data-logistics-key',
    disclosureAttribute: 'data-logistics-explanation',
    disclosureDefault: 'closed',
    fallback: (element) =>
      element.querySelector<HTMLElement>('h2,h3') || host.querySelector<HTMLElement>('h1'),
  });
  function replace(id: string, html: string) {
    updateReport(host.querySelector<HTMLElement>('#' + id), html);
  }
  function endpoint(endpoint: TransportEndpoint | null, id: number | null) {
    return endpoint
      ? `${game.BSPEC[endpoint.type].name} #${endpoint.id} (${endpoint.x}, ${endpoint.y})${endpoint.done ? '' : ' · construction'}`
      : id
        ? `Former or unavailable building #${id}`
        : 'Not recorded';
  }
  function actions(target: TransportEndpoint | null, label: string, key: string) {
    return target
      ? markup`<button data-logistics-inspect="${target.id}" data-logistics-key="inspect-${key}">Inspect ${label}</button><button data-logistics-locate="${target.id}" data-logistics-key="locate-${key}">Locate ${label}</button>`
      : '';
  }
  function routeDetail(row: TransportRow) {
    if (!row.route || !row.position)
      return '<p>Current route unavailable: no matched live carrier path is recorded for this delivery.</p>';
    const remaining = row.route.points.slice(row.route.next);
    const points = [
      row.position,
      ...remaining.map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 })),
    ];
    const minX = Math.min(...points.map((point) => point.x)),
      minY = Math.min(...points.map((point) => point.y));
    const extent = Math.max(
      1,
      Math.max(...points.map((point) => point.x)) - minX,
      Math.max(...points.map((point) => point.y)) - minY,
    );
    const scale = 140 / extent;
    const left = (300 - (Math.max(...points.map((point) => point.x)) - minX) * scale) / 2;
    const top = (180 - (Math.max(...points.map((point) => point.y)) - minY) * scale) / 2;
    const plot = points.map(
      (point) => `${left + (point.x - minX) * scale},${top + (point.y - minY) * scale}`,
    );
    const end = plot.at(-1);
    if (!end) return '';
    return markup`<figure class="logistics-route"><figcaption>Actual current carrier path · ${remaining.length} remaining recorded tiles</figcaption><svg viewBox="0 0 300 180" role="img" aria-label="Actual current carrier path from its observed position to the active path endpoint"><title>Carrier #${row.carrierId}: current position (${row.position.x.toFixed(1)}, ${row.position.y.toFixed(1)}), ${remaining.length} recorded remaining tiles</title><polyline points="${plot.join(' ')}" fill="none" stroke="var(--forest)" stroke-width="3"/><circle cx="${plot[0].split(',')[0]}" cy="${plot[0].split(',')[1]}" r="5" fill="var(--brass)"/><circle cx="${end.split(',')[0]}" cy="${end.split(',')[1]}" r="5" fill="var(--forest)"/></svg><p class="logistics-muted">Brass: observed carrier position. Green: active path endpoint. Tile coordinates, not a history of earlier routes.</p></figure><details data-logistics-explanation="route-${row.key}"><summary data-logistics-key="route-${row.key}">Recorded path coordinates</summary><p>${remaining.length ? remaining.map((point) => `(${point.x}, ${point.y})`).join(' → ') : 'The carrier is at the end of this recorded path.'}</p></details>`;
  }
  function selection(rows: TransportRow[]) {
    if (!selected)
      return '<p class="empty-state">Choose a delivery to inspect its actual cargo, endpoints and current route. Inspect opens details; Locate explicitly moves to the map.</p>';
    const current =
      rows.find((row) => row.key === selected?.key) ||
      rows.find(
        (row) =>
          row.kind === 'recovered' &&
          selected?.stage === 'carrying' &&
          row.carrierId === selected?.carrierId &&
          row.good === selected?.good,
      );
    if (current) selected = current;
    const removed =
      inspected && !game.byId(inspected.id)
        ? markup`<aside class="logistics-removed"><h3>Contributor removed</h3><p>${game.BSPEC[inspected.type].name} no longer exists. Its former location is (${inspected.x}, ${inspected.y}). Current cargo may be rerouted to surviving storage.</p><button data-logistics-former data-logistics-key="former">Locate former site</button></aside>`
        : '';
    const row = selected;
    return markup`<h2 tabindex="-1" data-logistics-key="evidence-heading">${trusted(resourceIcon(row.good))}${game.GOODS[row.good].name} · delivery evidence</h2>${trusted(removed)}${trusted(current ? markup`<p><strong>${stages[row.stage]}</strong> · ${kinds[row.kind]}${row.carrierId ? ' · carrier #' + row.carrierId : ''}</p><dl class="logistics-endpoints"><div><dt>Pickup source</dt><dd>${endpoint(row.source, row.sourceId)}</dd>${trusted(actions(row.source, 'source', row.key + '-source'))}</div><div><dt>Delivery destination</dt><dd>${endpoint(row.target, row.targetId)}${!row.targetId && row.kind === 'deliver' && ['queued', 'assigned'].includes(row.stage) ? ' · storage chosen after collection' : ''}</dd>${trusted(actions(row.target, 'destination', row.key + '-target'))}</div></dl><p>${row.stage === 'carrying' ? 'One good is physically carried. Assignment and pickup are not completed arrival.' : row.stage === 'unknown' ? 'Assignment is recorded, but no live carrier matches this job. Pickup, physical cargo and travel stage are unavailable.' : 'Cargo has not been collected; this job is not goods in transit.'}${row.position ? ` Current carrier position: (${row.position.x.toFixed(1)}, ${row.position.y.toFixed(1)}).` : ''}</p>${trusted(routeDetail(row))}` : '<p class="empty-state">This delivery is no longer active. It may have arrived, been canceled or been replaced. Its individual outcome and former route are unavailable; completed arrival totals below cover recorded physical deliveries.</p>')}<p class="logistics-muted">Measured ETA unavailable. Complete historical route records are unavailable. Current paths are observed evidence and do not establish a historical delay or forecast an arrival time.</p>`;
  }
  function waiting(rows: TransportRow[]) {
    const outputs = game.buildings.flatMap((building) => {
      if (!building.done) return [];
      const known = new Set<Good>();
      const output = game.BSPEC[building.type].out;
      if (output) known.add(output);
      // Output is also identifiable by a real producer-collection job.
      for (const row of rows)
        if (row.kind === 'deliver' && row.sourceId === building.id) known.add(row.good);
      return [...known]
        .filter((good) => (building.stock[good] || 0) > 0)
        .map((good) => ({ building, good }));
    });
    const inputs = game.buildings.filter(
      (building) =>
        building.done &&
        game.BSPEC[building.type].in &&
        ingredientShortages(building, game.BSPEC[building.type]).length,
    );
    return markup`<h2>Goods waiting at buildings</h2><h3>Output awaiting collection</h3>${trusted(
      outputs.length
        ? outputs
            .map(({ building, good }) => {
              return markup`<article><strong>${game.BSPEC[building.type].name} #${building.id}</strong> · ${building.stock[good]} ${game.GOODS[good].name} outside storage ${trusted(actions({ id: building.id, type: building.type, x: building.x, y: building.y, done: building.done }, 'producer', 'waiting-out-' + building.id + '-' + good))}</article>`;
            })
            .join('')
        : '<p>No producer output currently awaits collection.</p>',
    )}<h3>Producer ingredient shortfalls</h3><p class="logistics-muted">These are current recipe shortfalls, not alarms. Intentional pauses are labeled. Queued and assigned supplies have not yet arrived.</p>${trusted(
      inputs.length
        ? inputs
            .map((building) => {
              const spec = game.BSPEC[building.type];
              const inbound = rows.filter(
                (row) => row.targetId === building.id && !!eligibleIngredients(spec)[row.good],
              );
              const shortages =
                spec.prod === 'mine'
                  ? 'Needs one edible meal: bread, meat, fish or provisions'
                  : ingredientShortages(building, spec)
                      .map(
                        (shortage) =>
                          `${game.GOODS[shortage.good].name}: ${shortage.have}/${shortage.need} local input`,
                      )
                      .join(' · ');
              return markup`<article><strong>${spec.name} #${building.id}</strong> · ${shortages}${building.disabled ? ' · intentionally paused' : ''}<p class="logistics-muted">Incoming: ${inbound.filter((row) => row.stage === 'queued').length} queued, ${inbound.filter((row) => row.stage === 'assigned').length} assigned before pickup, ${inbound.filter((row) => row.stage === 'carrying').length} physically carrying${inbound.some((row) => row.stage === 'unknown') ? `; ${inbound.filter((row) => row.stage === 'unknown').length} assignment records with unavailable carrier evidence` : ''}. Zero incoming is absence of current deliveries; supplier availability and reachability require inspection.</p>${trusted(actions({ id: building.id, type: building.type, x: building.x, y: building.y, done: building.done }, 'consumer', 'waiting-in-' + building.id))}</article>`;
            })
            .join('')
        : '<p>No current recipe shortfall at completed producers.</p>',
    )}`;
  }
  function updateLogisticsView() {
    if (game.workspace !== 'logistics') return;
    const snapshot = game.currentTransport();
    const stage = requireElement<HTMLSelectElement>('logistics-stage').value;
    const query = requireElement<HTMLInputElement>('logistics-query').value.trim().toLowerCase();
    const filtered = snapshot.rows.filter(
      (row) =>
        (stage === 'all' || row.stage === stage) &&
        `${row.good} ${game.GOODS[row.good].name} ${endpoint(row.source, row.sourceId)} ${endpoint(row.target, row.targetId)} ${row.carrierId || ''} ${kinds[row.kind]}`
          .toLowerCase()
          .includes(query),
    );
    replace(
      'logistics-live',
      markup`<h2>Current transport</h2><p class="logistics-muted">Live quantities are independent of the reporting window. Only physically collected goods are in transit.</p><dl class="logistics-counts">${trusted(
        Object.entries(stages)
          .filter(([stage]) => stage !== 'unknown')
          .map(
            ([stage, label]) =>
              markup`<div><dt>${label}</dt><dd data-live-stage="${stage}">${snapshot.rows.filter((row) => row.stage === stage).length}</dd></div>`,
          )
          .join(''),
      )}<div><dt>Idle carriers / all carriers</dt><dd>${snapshot.carriers.filter((carrier) => carrier.state === 'idle').length} / ${snapshot.carriers.length}</dd></div></dl>${trusted(snapshot.rows.some((row) => row.stage === 'unknown') ? markup`<p class="logistics-muted">Assignment evidence unavailable: <strong data-live-stage="unknown">${snapshot.rows.filter((row) => row.stage === 'unknown').length}</strong> recorded assignments have no matched live carrier; pickup/cargo status is unknown.</p>` : '')}<div class="logistics-table-scroll"><table><caption>Active delivery jobs and recovered cargo</caption><thead><tr><th scope="col">Stage</th><th scope="col">Good / purpose</th><th scope="col">Source → destination</th><th scope="col">Carrier</th><th scope="col">Evidence</th></tr></thead><tbody>${trusted(filtered.map((row) => markup`<tr><td>${stages[row.stage]}</td><td>${trusted(resourceIcon(row.good))}${game.GOODS[row.good].name}<small>${kinds[row.kind]}</small></td><td>${endpoint(row.source, row.sourceId)} → ${endpoint(row.target, row.targetId)}${!row.targetId && row.kind === 'deliver' && ['queued', 'assigned'].includes(row.stage) ? ' (storage chosen after pickup)' : ''}</td><td>${row.carrierId ? '#' + row.carrierId : row.stage === 'unknown' ? 'Unavailable' : 'Unassigned'}</td><td><button data-logistics-select="${row.key}" data-logistics-key="select-${row.key}" aria-expanded="${selected?.key === row.key}">Details</button></td></tr>`).join(''))}</tbody></table></div>${trusted(filtered.length ? '' : '<p class="empty-state">No active deliveries match these filters. Completed deliveries appear separately below.</p>')}`,
    );
    replace('logistics-detail', selection(snapshot.rows));
    const arrival = game.cargoWindow(window);
    replace(
      'logistics-completions',
      markup`<h2>Completed arrivals</h2>${trusted(
        arrival.available
          ? markup`<p>Observed ${arrival.elapsed.toFixed(1)} simulation seconds (${arrival.from.toFixed(1)}–${arrival.to.toFixed(1)}). Recorded arrivals only; earlier unrecorded history is unavailable.</p><table><thead><tr><th scope="col">Good</th><th scope="col">Arrivals in covered interval</th><th scope="col">Goods / simulation minute</th></tr></thead><tbody>${trusted(
              goods
                .filter((good) => arrival.totals[good])
                .map(
                  (good) =>
                    markup`<tr><th scope="row">${game.GOODS[good].name}</th><td>${arrival.totals[good]}</td><td>${(arrival.rates[good] ?? 0).toFixed(1)}</td></tr>`,
                )
                .join(''),
            )}</tbody></table>${trusted(Object.values(arrival.totals).some((value) => value > 0) ? '' : '<p>No completed goods arrivals observed during this covered interval.</p>')}`
          : '<p class="empty-state">History unavailable — gathering carrier-arrival observations. Missing history is not zero completed deliveries.</p>',
      )}<p class="logistics-muted">Counts include producer inputs, storage arrivals, construction and returned cargo once they actually arrive. Initial stock, assignments, pickups, soldier deployments and direct salvage are excluded. Transfers count as arrivals but do not create goods.</p>`,
    );
    replace(
      'logistics-workload',
      markup`<h2>Carrier workload</h2>${trusted(snapshot.carriers.length ? markup`<div class="logistics-carriers">${trusted(snapshot.carriers.map((carrier) => markup`<article><strong>Carrier #${carrier.id}</strong> · ${carrier.state === 'pickup' ? 'Assigned before pickup' : carrier.state === 'carrying' && carrier.cargo ? 'Physically carrying ' + game.GOODS[carrier.cargo].name : carrier.state === 'idle' ? 'Idle' : 'Moving without cargo'}<small>Position (${carrier.position.x.toFixed(1)}, ${carrier.position.y.toFixed(1)}) · ${carrier.route ? Math.max(0, carrier.route.points.length - carrier.route.next) + ' current path tiles remaining' : 'No current path recorded'}</small></article>`).join(''))}</div>` : '<p>No carriers are currently present.</p>')}<p class="logistics-muted">${snapshot.deployments} active soldier deployments are separate from carrier cargo. Historical route workload and measured travel times are unavailable.</p>`,
    );
    replace('logistics-waiting', waiting(snapshot.rows));
  }
  host.innerHTML = `<h1 id="logistics-heading" class="report-content-heading">Deliveries and carrier workload</h1><p class="logistics-intro">Separate promised work from collected cargo and completed arrivals. Follow current carrier paths and goods waiting for collection.</p><div class="logistics-map-actions"><button id="logistics-routes" aria-controls="map-modes">Show routes on map</button><span class="logistics-muted">Highlight current carrier routes on the live map.</span></div><div class="logistics-controls"><label>Arrival reporting window <select id="logistics-window"><option value="30">30 seconds</option><option value="120">2 minutes</option><option value="600">10 minutes</option><option value="lifetime">Lifetime</option></select></label><label>Live stage <select id="logistics-stage"><option value="all">All stages</option><option value="queued">Queued · unassigned</option><option value="assigned">Assigned · before pickup</option><option value="carrying">Physically carrying</option><option value="unknown">Assignment evidence unavailable</option></select></label><label>Find resource / building / carrier <input id="logistics-query" type="search"></label></div><div id="logistics-live"></div><section id="logistics-detail"></section><section id="logistics-completions"></section><section id="logistics-workload"></section><section id="logistics-waiting"></section>`;
  requireElement('logistics-routes').addEventListener('click', () => game.setMapOverlay('routes'));
  requireElement('logistics-window').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    window = value === 'lifetime' ? value : (+value as 30 | 120 | 600);
    updateLogisticsView();
  });
  for (const id of ['logistics-stage', 'logistics-query'])
    requireElement(id).addEventListener(
      id === 'logistics-query' ? 'input' : 'change',
      updateLogisticsView,
    );
  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.logisticsSelect) {
      selected =
        game.currentTransport().rows.find((row) => row.key === button.dataset.logisticsSelect) ||
        null;
      updateLogisticsView();
      const heading = host.querySelector<HTMLElement>('#logistics-detail h2');
      revealReportHeading(host, heading);
    }
    if (button.dataset.logisticsInspect) {
      const building = game.byId(+button.dataset.logisticsInspect);
      if (building) {
        inspected = { id: building.id, type: building.type, x: building.x, y: building.y };
        game.inspectContributor(building.id);
        updateLogisticsView();
      }
    }
    if (button.dataset.logisticsLocate) game.locateContributor(+button.dataset.logisticsLocate);
    if (button.hasAttribute('data-logistics-former') && inspected)
      game.locateContributor(inspected);
  });
  observePresentation(game, 'buildingDemolished', (event) => {
    if (inspected?.id === event.id) {
      game.showRemovedContributor(inspected);
      updateLogisticsView();
    }
  });
  observePresentation(game, 'worldLoaded', () => {
    selected = null;
    inspected = null;
    updateReport.reset();
    updateLogisticsView();
  });
  game.registerReportWindow('logistics', 'Logistics', 'data-logistics-key');
  return { updateLogisticsView };
}
export interface LogisticsViewSubsystem {
  updateLogisticsView: () => void;
}
