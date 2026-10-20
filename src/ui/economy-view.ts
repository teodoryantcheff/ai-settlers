import { requireElement } from './dom.ts';
import { html as markup, trusted } from './markup.ts';
import { createLiveReportUpdater } from './live-report.ts';
import { revealReportHeading } from './report-navigation.ts';
import type { GameRuntime } from '../runtime.ts';
import type {
  Building,
  EconomicFlow,
  Good,
  ProductionBlockReason,
  ProductionRateWindow,
} from '../types.ts';
import { eligibleIngredients, productionTiming } from '../gameplay/production-rules.ts';
import { RESOURCE_GROUPS, resourceIcon } from './resource-icons.ts';
import { observePresentation } from './domain-feedback.ts';
import type { RemovedContributor } from './workspace.ts';

/** Live reports keep their controls mounted and read only passive economic observations. */
export function createEconomyView(game: GameRuntime): EconomyViewSubsystem {
  const host = requireElement('workspace-economy');
  let window: ProductionRateWindow = 30;
  let selectedGood: Good | null = null;
  let inspected: RemovedContributor | null = null;
  const goods = RESOURCE_GROUPS.flatMap((group) => group.goods);

  const number = (value: number) => value.toFixed(1);
  const flowLabels = {
    produced: 'Production',
    consumed: 'Ingredient consumption',
    inputArrived: 'Producer input arrivals',
    outputStored: 'Output delivered to storage',
    constructionSpent: 'Construction spending',
    contractSpent: 'Contract spending',
    upgradeSpent: 'Upgrade spending',
    contractReward: 'Contract rewards',
    refund: 'Demolition refunds',
    salvage: 'Local stock salvage',
    transferred: 'Warehouse transfers',
  } as const;
  host.innerHTML = markup`<h1 id="economy-heading" class="report-content-heading">Stock and production</h1>
    <p class="economy-intro">Physical stock, supply chains and completed deliveries · rates in goods per simulation minute.</p>
    <div class="economy-controls"><label>Reporting window <select id="economy-window"><option value="30">30 seconds</option><option value="120">2 minutes</option><option value="600">10 minutes</option><option value="lifetime">Lifetime</option></select></label>
    <label>Production chain <select id="economy-chain"><option value="all">All chains</option>${trusted(RESOURCE_GROUPS.map((group, i) => markup`<option value="${i}">${group?.name ?? ''}</option>`).join(''))}</select></label>
    <label>Find a resource <input id="economy-query" type="search" placeholder="Name or supply chain"></label></div>
    <p id="economy-coverage" class="economy-coverage" aria-live="polite"></p>
    <div id="economy-balances"></div><div id="economy-detail"></div>`;
  requireElement('economy-window').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    window = value === 'lifetime' ? value : (+value as 30 | 120 | 600);
    updateEconomyView();
  });
  for (const id of ['economy-chain', 'economy-query'])
    requireElement(id).addEventListener(
      id === 'economy-query' ? 'input' : 'change',
      updateEconomyView,
    );
  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.economyResource) {
      selectedGood = button.dataset.economyResource as Good;
      updateEconomyView();
      revealResource();
    }
    if (button.dataset.economyInspect) {
      const building = game.byId(+button.dataset.economyInspect);
      if (building) {
        inspected = { id: building.id, type: building.type, x: building.x, y: building.y };
        game.inspectContributor(building.id);
        updateEconomyView();
      }
    }
    if (button.dataset.economyLocate) {
      if (button.dataset.economyLocate === 'former' && inspected) game.locateContributor(inspected);
      else game.locateContributor(+button.dataset.economyLocate);
    }
  });
  function showEconomyResource(good: Good) {
    if (!goods.includes(good)) return;
    selectedGood = good;
    game.switchWorkspace('economy');
    updateEconomyView();
    revealResource();
  }
  function revealResource() {
    const heading = host.querySelector<HTMLElement>('#economy-detail h2');
    revealReportHeading(host, heading);
  }
  const stockBar = requireElement('goods');
  function openStock(event: Event) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-good]');
    if (
      target &&
      (event.type === 'click' || ['Enter', ' '].includes((event as KeyboardEvent).key))
    ) {
      event.preventDefault();
      showEconomyResource(target.dataset.good as Good);
    }
  }
  stockBar.addEventListener('click', openStock);
  stockBar.addEventListener('keydown', openStock);

  const updateReport = createLiveReportUpdater({
    focusAttribute: 'data-economy-key',
    disclosureAttribute: 'data-economy-explanation',
    disclosureDefault: 'closed',
    fallback: (element) =>
      element.querySelector<HTMLElement>('h2,h3') || host.querySelector<HTMLElement>('h1'),
  });
  function replaceReport(id: string, html: string) {
    updateReport(host.querySelector<HTMLElement>('#' + id), html);
  }
  function history(good: Good) {
    const samples = game.economicHistory(window === 'lifetime' ? 600 : window);
    if (samples.length < 2)
      return '<p class="economy-muted">History unavailable — waiting for two simulation-time samples.</p>';
    const series = (['produced', 'consumed', 'outputStored'] as const).map((flow) => ({
      flow,
      points: samples.slice(1).map((sample, i) => ({
        time: sample.time,
        from: samples[i].time,
        value:
          (((sample.totals[flow][good] || 0) - (samples[i].totals[flow][good] || 0)) * 60) /
          (sample.time - samples[i].time),
      })),
    }));
    const max = Math.max(1, ...series.flatMap((entry) => entry.points.map((point) => point.value)));
    const last = samples.at(-1);
    if (!last) return '';
    const first = samples[0].time,
      elapsed = last.time - first;
    return markup`<figure class="economy-history"><figcaption>Recorded recent flow · ${number(elapsed)} simulation seconds · goods/min${window === 'lifetime' ? ' (latest ten minutes only)' : ''}</figcaption>
      <svg viewBox="0 0 600 146" role="img" aria-label="Measured ${game.GOODS[good].name} flow history: production, consumption and output delivered to storage"><title>Observed rates from ${number(first)} to ${number(last.time)} simulation seconds, maximum ${number(max)} goods per minute</title>
      <text x="24" y="13" fill="var(--ink-dim)" font-size="12">${number(max)}</text><text x="2" y="108" fill="var(--ink-dim)" font-size="12">0</text><text x="24" y="137" fill="var(--ink-dim)" font-size="12">${number(first)}s</text><text x="592" y="137" text-anchor="end" fill="var(--ink-dim)" font-size="12">${number(last.time)}s</text><path d="M24 18V108H592" fill="none" stroke="var(--brass-dim)"/>${trusted(series.map(({ flow, points }) => markup`<path class="economy-flow-${flow}" fill="none" stroke-width="2" d="${points.map((point, i) => `${i ? 'V' : `M${24 + ((point.from - first) / elapsed) * 568},`}${108 - (point.value / max) * 82} H${24 + ((point.time - first) / elapsed) * 568}`).join(' ')}"/>`).join(''))}</svg>
      <div class="economy-chart-key"><span class="economy-flow-produced">● Production</span><span class="economy-flow-consumed">● Consumption</span><span class="economy-flow-outputStored">● Delivered to storage</span></div>
      <p class="economy-muted">Two-second observations; no estimates between samples. Paused and offline time add no history. Exact totals are below.</p></figure>`;
  }
  function capacity(building: Building) {
    const spec = game.BSPEC[building.type];
    const timing = productionTiming(building, spec, game.state.upgrades.production);
    const { base: cycle, tier, variety } = timing;
    const output = spec.prod === 'gather' ? 2 : 1;
    const theoretical = ((output * 60) / cycle / timing.upgradeFactor) * timing.foodMultiplier;
    const reasons: Partial<Record<ProductionBlockReason, string>> = {
      paused: 'Intentionally paused',
      exhausted: 'Deposit exhausted',
      output: 'Output awaiting collection fills local stock',
      demand: 'Demand satisfied; reserves are plentiful',
      reserve: 'Stock reserve policy',
      water: 'Needs local well support',
      inputs: 'Waiting for ingredients',
      resources: 'No natural resource in working range',
    };
    return `${number(theoretical)} goods/min nominal · ${output} per ${cycle}s base cycle · production upgrade ${tier}/3${variety ? ` · current meal variety +${Math.round(variety * 100)}%` : ''}. ${!building.done ? 'Construction unfinished.' : reasons[game.productionProgress(building)?.reason ?? ''] || 'No current production constraint.'} Requires sustained ingredients, resource access, local well support where applicable and collection. Capacity is a theoretical ceiling, not a forecast.`;
  }
  function recipe(building: Building) {
    const spec = game.BSPEC[building.type];
    if (!spec.out) return '';
    const inputs = eligibleIngredients(spec);
    const link = (good: Good, quantity: number, role: string) =>
      markup`<button data-economy-resource="${good}" data-economy-key="recipe-${building.id}-${role}-${good}">${quantity} ${game.GOODS[good].name}</button>`;
    const input = Object.entries(inputs)
      .map(([good, quantity]) => link(good as Good, quantity, 'input'))
      .join(spec.prod === 'mine' ? ' or ' : ' + ');
    return markup`<p class="economy-recipe">${trusted(input || 'Natural resources')} → ${trusted(link(spec.out, spec.prod === 'gather' ? 2 : 1, 'output'))} per cycle${spec.prod === 'mine' ? ' · choose one edible alternative' : ''}${spec.water ? ' · working well within 6 tiles (local support, not cargo)' : ''}</p>`;
  }
  function contributors(good: Good) {
    const holders = new Set(game.resourceAccounting(good).contributors.map((entry) => entry.id));
    const relevant = game.buildings.filter((building) => {
      const spec = game.BSPEC[building.type];
      return spec.out === good || !!eligibleIngredients(spec)[good] || holders.has(building.id);
    });
    const former =
      inspected && !game.byId(inspected.id)
        ? markup`<aside class="economy-former"><h3>Contributor removed</h3><p>${game.BSPEC[inspected.type].name} no longer exists. Its recorded production remains in colony lifetime totals; its former location is (${inspected.x}, ${inspected.y}).</p><button data-economy-locate="former" data-economy-key="former-locate">Locate former site</button></aside>`
        : '';
    return markup`<section class="economy-contributors"><h3>Contributing buildings</h3>${trusted(former)}${trusted(
      relevant.length
        ? relevant
            .map((building) => {
              const spec = game.BSPEC[building.type];
              const producer = spec.out === good;
              const consumer = !!eligibleIngredients(spec)[good];
              const metric = game.productionWindow(building.metrics, window);
              const roles = [
                producer ? 'Producer' : '',
                consumer
                  ? 'Consumer' + (spec.prod === 'mine' ? ' · one of four edible alternatives' : '')
                  : '',
                spec.store && building.done ? 'Storage' : '',
                !building.done ? 'Construction' : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const observed =
                producer || consumer
                  ? markup`<p class="economy-muted">Observed ${number(metric.elapsed)}s; delivery coverage ${number(metric.deliveryElapsed)}s. Produced ${metric.elapsed ? number(((metric.produced[good] || 0) * 60) / metric.elapsed) : 'unavailable'} · Consumed ${metric.elapsed ? number(((metric.consumed[good] || 0) * 60) / metric.elapsed) : 'unavailable'} · Input arrivals ${metric.deliveryElapsed ? number(((metric.inputDelivered[good] || 0) * 60) / metric.deliveryElapsed) : 'unavailable'} · Output stored ${metric.deliveryElapsed ? number(((metric.outputDelivered[good] || 0) * 60) / metric.deliveryElapsed) : 'unavailable'} goods/min.</p>`
                  : '';
              return markup`<article><div class="economy-contributor-heading"><strong>${spec.name} #${building.id}</strong><span>${roles}</span><div><button data-economy-inspect="${building.id}" data-economy-key="inspect-${building.id}">Inspect</button><button data-economy-locate="${building.id}" data-economy-key="locate-${building.id}">Locate</button></div></div>${trusted(recipe(building))}${trusted(observed)}${trusted(producer ? markup`<details data-economy-explanation="capacity-${building.id}"><summary data-economy-key="capacity-${building.id}">Nominal capacity and limiting conditions</summary><p>${capacity(building)}</p></details>` : '')}</article>`;
            })
            .join('')
        : '<p>No current producer, consumer or holder for this resource. Colony totals include former buildings.</p>',
    )}</section>`;
  }
  function updateEconomyView() {
    if (game.workspace !== 'economy') return;
    const measured = game.economicWindow(window);
    const coverage = requireElement('economy-coverage');
    const text = measured.available
      ? `Observed ${number(measured.elapsed)} simulation seconds (${number(measured.from)}–${number(measured.to)}). ${window === 'lifetime' ? 'Lifetime means recorded coverage; older unrecorded history is unavailable.' : 'Two-second samples; partial windows show only actual coverage.'}`
      : 'History unavailable — gathering observations. Current stock remains available; missing measurements are not zero.';
    if (coverage.textContent !== text) coverage.textContent = text;
    const query = requireElement('economy-query', HTMLInputElement).value.trim().toLowerCase();
    const chain = requireElement('economy-chain', HTMLSelectElement).value;
    const filtered = goods.filter((good) => {
      const group = RESOURCE_GROUPS.find((entry) => entry.goods.includes(good));
      return (
        (chain === 'all' || group === RESOURCE_GROUPS[+chain]) &&
        `${game.GOODS[good].name} ${group?.name ?? ''}`.toLowerCase().includes(query)
      );
    });
    replaceReport(
      'economy-balances',
      markup`<h2>Resource balances</h2><p class="economy-muted">Stored includes reserved goods. Available = stored − reserved. Goods outside storage are listed separately.</p><div class="economy-table-scroll"><table><caption>Physical stock and measured flow · goods/min</caption><thead><tr><th scope="col">Resource / chain</th><th scope="col">Stored</th><th scope="col">Reserved</th><th scope="col">Available</th><th scope="col">In transit</th><th scope="col">Produced /min</th><th scope="col">Consumed /min</th></tr></thead><tbody>${trusted(
        filtered
          .map((good) => {
            const stock = game.resourceAccounting(good);
            const group = RESOURCE_GROUPS.find((entry) => entry.goods.includes(good));
            return markup`<tr data-economy-good="${good}"><th scope="row"><button data-economy-resource="${good}" data-economy-key="resource-${good}" aria-expanded="${selectedGood === good}">${trusted(resourceIcon(good))}${game.GOODS[good].name}</button><small>${group?.name ?? ''}</small></th><td>${stock.stored}</td><td>${stock.reserved}</td><td>${stock.available}</td><td>${stock.inTransit}</td><td>${measured.available ? number(measured.rates.produced[good] || 0) : '—'}</td><td>${measured.available ? number(measured.rates.consumed[good] || 0) : '—'}</td></tr>`;
          })
          .join(''),
      )}</tbody></table></div>${trusted(filtered.length ? '' : '<p class="empty-state">No resources match these filters. Clear the search or choose another chain.</p>')}`,
    );
    if (!selectedGood) {
      replaceReport(
        'economy-detail',
        '<p class="empty-state">Select a resource to reconcile local stocks, follow its production chain and inspect contributing buildings.</p>',
      );
      return;
    }
    const good = selectedGood,
      stock = game.resourceAccounting(good);
    replaceReport(
      'economy-detail',
      markup`<section aria-labelledby="economy-resource-heading"><h2 id="economy-resource-heading" tabindex="-1" data-economy-key="resource-heading">${trusted(resourceIcon(good))}${game.GOODS[good].name} · resource detail</h2><p>Reserved stock is part of stored stock, not additional goods. In transit means collected cargo only.</p>
      <dl class="economy-stock">${trusted(
        Object.entries({
          'Stored stock': stock.stored,
          'Reserved stock': stock.reserved,
          'Available stock': stock.available,
          'Goods in transit': stock.inTransit,
          'Producer input stock': stock.producerInputs,
          'Output awaiting collection': stock.awaitingCollection,
          'Construction materials delivered': stock.constructionMaterials,
          'Other local stock': stock.otherLocal,
          'Physical goods across all locations': stock.physicalGoods,
        })
          .map(([label, value]) => markup`<div><dt>${label}</dt><dd>${value}</dd></div>`)
          .join(''),
      )}</dl>
      <p class="economy-muted">${stock.reclaimable ? `${stock.reclaimable} uncollected warehouse-transfer reservations may be reclaimed by eligible actions. Reachability and committed construction/ingredient promises still apply; this does not change Available stock.` : 'Construction and ingredient reservations remain committed; eligible actions may reclaim optional uncollected warehouse transfers.'}</p>
      ${trusted(history(good))}<h3>Recorded flows</h3><p class="economy-muted">Creation, consumption, spending and refunds are separate from internal movement. Transfers and pickups do not count as producer output arriving at storage. Initial stocks are excluded from production.</p><table class="economy-flows"><thead><tr><th scope="col">Flow</th><th scope="col">Goods in covered interval</th><th scope="col">Goods / simulation minute</th></tr></thead><tbody>${trusted(
        Object.entries(flowLabels)
          .map(
            ([flow, label]) =>
              markup`<tr><th scope="row">${label}</th><td>${measured.available ? measured.totals[flow as EconomicFlow][good] || 0 : 'Unavailable'}</td><td>${measured.available ? number(measured.rates[flow as EconomicFlow][good] || 0) : '—'}</td></tr>`,
          )
          .join(''),
      )}</tbody></table>${trusted(contributors(good))}</section>`,
    );
  }
  observePresentation(game, 'buildingDemolished', (event) => {
    if (inspected?.id === event.id) {
      game.showRemovedContributor(inspected);
      updateEconomyView();
    }
  });
  observePresentation(game, 'worldLoaded', () => {
    inspected = null;
    updateReport.reset();
    updateEconomyView();
  });
  game.registerReportWindow('economy', 'Economy', 'data-economy-key');
  return { updateEconomyView, showEconomyResource };
}
export interface EconomyViewSubsystem {
  updateEconomyView: () => void;
  showEconomyResource: (good: Good) => void;
}
