import type { PlacementFeedback } from './placement-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type { Building, Good, Inventory, ProductionRateWindow, TilePoint } from '../types.ts';
import type { DemolitionQuote } from '../simulation/economy.ts';
import { eligibleIngredients, recipeRequirements } from '../gameplay/production-rules.ts';
import { resourceIcon } from './resource-icons.ts';
import { buildingPurposes as buildingHelp } from './catalog-view.ts';
import { observePresentation } from './domain-feedback.ts';

/** Owns inspector evidence, mounted controls, refresh and native interaction retention. */
export function createInspectorView(
  game: GameRuntime,
  feedback: PlacementFeedback,
  internals?: InspectorInternals,
) {
  let productionRateWindow: ProductionRateWindow = 30;
  let inspectorKey = '';
  let illustratedType = '';
  let confirmationId: number | null = null;
  const goods = (stock: Inventory) =>
    Object.entries(stock || {})
      .filter(([, n]) => n > 0)
      .map(([good, n]) => `${resourceIcon(good as Good)}${n} ${game.GOODS[good as Good].name}`)
      .join(' · ') || 'None';
  const receiver = (store: DemolitionQuote['receiver']) =>
    store
      ? `${game.BSPEC[store.type].name} #${store.id} at ${store.x}, ${store.y}`
      : 'No completed storage receiver';
  function consequences(b: Building, q = game.demolitionQuote(b)) {
    if (!q.allowed) return `<p class="inspector-warning">${q.reason}</p>`;
    return (
      `<p><strong>Construction refund</strong><br>${goods(q.refund)}<br><small>${q.completed ? 'Completed cost' : 'Delivered construction goods only'}: each resource is halved and rounded down.</small></p>` +
      `<p><strong>Local stock salvage</strong><br>${goods(q.salvage)}<br><small>Full local stock, separate from construction refund.</small></p>` +
      `<p>Refund and salvage receiver: ${receiver(q.receiver)}.</p>` +
      (q.returnedSoldiers || b.type === 'guard'
        ? `<p>Soldiers returned to the available pool: ${q.returnedSoldiers}. Equipment returned: ${goods(q.equipment)}${q.equipmentReceiver ? ' to ' + receiver(q.equipmentReceiver) : ''}.</p>`
        : '') +
      `<p>Territory lost: ${q.territoryLost} tiles. Other buildings outside the remaining territory: ${q.affectedBuildings.length}${q.affectedBuildings.length ? ' (IDs ' + q.affectedBuildings.join(', ') + ')' : ''}. Existing buildings remain.</p>` +
      `<p>Delivery work cancelled: ${q.cancelledDeliveries.queued} queued · ${q.cancelledDeliveries.assigned} assigned · ${q.cancelledDeliveries.carrying} carrying${q.cancelledDeliveries.unknown ? ' · ' + q.cancelledDeliveries.unknown + ' assignment records with unavailable carrier evidence' : ''}. Carried goods seek another storage receiver.</p>`
    );
  }
  function shortcut(b: Building, q = game.demolitionQuote(b)) {
    if (!q.allowed) return '<p class="inspector-warning">' + q.reason + '</p>';
    return (
      '<p><strong>Shift+click immediately demolishes.</strong><br>Refund: ' +
      goods(q.refund) +
      '.<br>Local stock salvage: ' +
      goods(q.salvage) +
      '.<br>Receiver: ' +
      receiver(q.receiver) +
      '.<br>Territory lost: ' +
      q.territoryLost +
      ' tiles; ' +
      q.affectedBuildings.length +
      ' other buildings outside remaining territory.' +
      (q.returnedSoldiers
        ? '<br>Soldiers returned: ' +
          q.returnedSoldiers +
          '; equipment: ' +
          goods(q.equipment) +
          '.'
        : '') +
      '</p>'
    );
  }
  function live(b: Building, work = game.productionProgress?.(b)) {
    const sp = game.BSPEC[b.type],
      status = game.buildingStatus ? game.buildingStatus(b) : game.bStatus(b);
    const simulationHeld =
      game.state.paused || game.blockingLayerOpen?.() || document.visibilityState === 'hidden';
    let html =
      `<h2>${sp.name} <small>#${b.id} · ${b.x}, ${b.y}</small></h2><div class="inspector-status" role="status">` +
      (work
        ? `<p class="${work.reason && !['paused', 'demand', 'reserve'].includes(work.reason) ? 'inspector-warning' : 'inspector-evidence'}">${work.explanation}</p>`
        : '') +
      (work?.reason
        ? '<div class="inspector-supporting"><p class="muted">Usual work and supporting building evidence. The current constraint above governs activity.</p>'
        : '') +
      status.lines
        .map(
          (line) =>
            `<p class="${line.w ? 'inspector-warning' : 'inspector-evidence'}">${line.t}</p>`,
        )
        .join('') +
      (work?.reason ? '</div>' : '') +
      '</div>';
    if (!b.done) {
      html += `<p><strong>Construction ${Math.round(b.prog * 100)}%</strong></p><progress max="1" value="${b.prog}"></progress>`;
      for (const good of Object.keys(b.needs) as Good[])
        html += `<p>${resourceIcon(good)}${game.GOODS[good].name}: ${b.got[good] || 0} / ${b.needs[good]} delivered</p>`;
    } else {
      if (work)
        html += `<section class="inspector-cycle" aria-label="Current production progress"><h3>Current work countdown</h3><p data-cycle-countdown><strong>${work.remaining.toFixed(1)}s ${work.suspended ? 'remaining · suspended' : simulationHeld ? 'remaining · simulation held' : 'of work remaining at current speed'}</strong></p><p>${work.suspended ? 'The countdown is preserved until the constraint clears.' : simulationHeld ? 'Simulation is paused or suspended. This active-work countdown resumes when play runs.' : 'Time to the next attempt if current conditions continue; output is not guaranteed.'}</p><p class="muted">Normal interval: ${work.duration.toFixed(1)}s (${work.base}s base · upgrade ${work.tier}/3${work.variety ? ' · meal variety +' + Math.round(work.variety * 100) + '%' : ''}). ${sp.prod === 'plant' ? 'Foresters use a 5s base check when the area is sufficiently planted, otherwise a 7s base attempt. ' : ''}Startup and resource retries can use different intervals; elapsed cycle progress is not recorded.</p></section>`;
      html += `<h3>${sp.store ? 'Stored goods' : 'Local stock'}</h3><p>${goods(b.stock)}</p>`;
      if (sp.store) html += `<p>Reserved (part of stored): ${goods(b.res)}</p>`;
      if (game.incomingDeliveryStages) {
        const relevant = sp.store
          ? Object.keys(game.GOODS)
          : Object.keys(eligibleIngredients(b, sp));
        const inbound = relevant
          .map((g) => {
            const s = game.incomingDeliveryStages(g as Good, b.id);
            return s.queued + s.assigned + s.carrying + (s.unknown || 0)
              ? `${game.GOODS[g as Good].name}: ${s.queued} queued · ${s.assigned} assigned · ${s.carrying} carrying${s.unknown ? ' · ' + s.unknown + ' assignments with unavailable carrier evidence' : ''}`
              : '';
          })
          .filter(Boolean);
        if (inbound.length)
          html += `<h3>Known incoming work</h3><p>${inbound.join('<br>')}</p><p class="muted">Queued work has no carrier. Assigned work has not been picked up. Carrying means the goods have been collected. Arrival times are not guaranteed.</p>`;
      }
      if (sp.water)
        html += `<p>Local water: ${game.hasLocalWater?.(b) ? 'working connected well within 6 tiles' : 'no working connected well within 6 tiles'}. Water is local coverage, not transported stock.</p>`;
      if (b.type === 'guard')
        html += `<p>${b.man ? 'Manned' : 'Unmanned'} outpost · current claim radius ${b.man ? sp.rad : Math.min(sp.rad, 3)} tiles, restricted by traversable land.</p>`;
    }
    return html;
  }
  function request(b: Building) {
    confirmationId = b.id;
    game.demoArm = b;
    game.openLayer('demolition-dialog');
    updateConfirmation();
  }
  function updateConfirmation() {
    if (
      confirmationId === null ||
      document.getElementById('demolition-dialog').classList.contains('hidden')
    )
      return;
    const b = game.byId(confirmationId);
    const content = document.getElementById('demolition-evidence');
    const confirm = document.getElementById('demolition-confirm') as HTMLButtonElement;
    if (!b) {
      content.textContent = 'This building no longer exists.';
      confirm.disabled = true;
      return;
    }
    const quote = game.demolitionQuote(b);
    const html =
      `<h3>${game.BSPEC[b.type].name} #${b.id} at ${b.x}, ${b.y}</h3>` + consequences(b, quote);
    if (content.innerHTML !== html) content.innerHTML = html;
    confirm.disabled = !quote.allowed;
  }
  document.getElementById('demolition-cancel').onclick = () => {
    game.demoArm = null;
    game.closeLayer('demolition-dialog');
    confirmationId = null;
  };
  document.getElementById('demolition-confirm').onclick = () => {
    const b = confirmationId === null ? null : game.byId(confirmationId);
    if (!b || !game.demolitionQuote(b).allowed) {
      updateConfirmation();
      return;
    }
    game.closeLayer('demolition-dialog');
    confirmationId = null;
    game.demoArm = null;
    game.demolish(b);
    game.updateInfo();
  };
  function tick() {
    updateConfirmation();
    if (game.mode?.type !== 'demolish') return;
    const target = game.hoverIn
      ? game.buildings.reduce<Building | null>(
          (best, b) =>
            Math.hypot(b.x - game.ht.x, b.y - game.ht.y) < 1.45 &&
            (!best ||
              Math.hypot(b.x - game.ht.x, b.y - game.ht.y) <
                Math.hypot(best.x - game.ht.x, best.y - game.ht.y))
              ? b
              : best,
          null,
        )
      : null;
    if (!target) feedback.clear();
    else
      feedback.show(
        `<h3>Demolish ${game.BSPEC[target.type].name} #${target.id}</h3>${shortcut(target)}<p><strong>Click the building to review and confirm. Shift+click immediately applies these consequences.</strong></p>`,
        target.x + ', ' + target.y,
      );
  }
  function observedProduction(b: Building) {
    const sp = game.BSPEC[b.type];
    const rates = game.productionWindow(b.metrics, productionRateWindow);
    const rate = (record: Inventory, good: Good, elapsed: number) =>
      elapsed > 0 ? (((record[good] || 0) / elapsed) * 60).toFixed(1) : '—';
    const produced = rate(rates.produced, sp.out, rates.elapsed);
    const delivered = rate(rates.outputDelivered, sp.out, rates.deliveryElapsed);
    const waiting =
      rates.elapsed > 0
        ? Math.max(0, Math.min(100, Math.round((rates.inputBlocked / rates.elapsed) * 100)))
        : null;
    let h =
      '<section class="production-dashboard" aria-label="Observed production rates">' +
      '<div class="production-heading"><span>' +
      game.GOODS[sp.out].name +
      ' output</span><span>per minute</span></div><div class="production-cards">' +
      '<div class="production-card"><span class="production-caption">Produced</span>' +
      '<strong data-produced-rate>' +
      produced +
      '</strong><span class="production-caption">at this building</span></div>' +
      '<div class="production-card"><span class="production-caption">Delivered out</span>' +
      '<strong data-delivered-rate>' +
      delivered +
      '</strong><span class="production-caption">arrived at storage</span></div></div>' +
      '<div class="production-wait"><div class="production-heading"><span>Waiting for inputs</span><strong>' +
      (waiting === null ? '—' : waiting + '%') +
      '</strong></div>' +
      (waiting === null
        ? '<div class="production-track production-empty"></div>'
        : '<div class="production-track" role="meter" aria-label="Time waiting for inputs" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
          waiting +
          '"><span style="width:' +
          waiting +
          '%"></span></div>') +
      '<span class="production-note">' +
      (waiting === null
        ? 'Gathering observations…'
        : 'Share of observed time without required supplies') +
      '</span></div>';
    if (game.economicWindow && game.resourceAccounting) {
      const stock = game.resourceAccounting(sp.out);
      const colony = game.economicWindow('lifetime');
      h +=
        '<details class="production-accounting"><summary>Colony resource accounting</summary>' +
        '<p>Stored ' +
        stock.stored +
        ' · Reserved ' +
        stock.reserved +
        ' (part of stored) · Available ' +
        stock.available +
        '<br>In transit ' +
        stock.inTransit +
        ' · Producer input stock ' +
        stock.producerInputs +
        ' · Output awaiting collection ' +
        stock.awaitingCollection +
        '</p><p>' +
        (colony.available
          ? 'Recorded colony production: ' +
            (colony.totals.produced[sp.out] || 0) +
            ' over ' +
            colony.elapsed.toFixed(1) +
            ' simulation seconds'
          : 'Colony history unavailable — gathering observations') +
        '</p></details>';
    }
    if (sp.in) {
      const allowed = sp.prod === 'mine' ? undefined : recipeRequirements(b, sp);
      const goods = [
        ...new Set([
          ...Object.keys(allowed || {}),
          ...Object.keys(rates.consumed),
          ...Object.keys(rates.inputDelivered),
        ]),
      ].filter((g) => (!allowed || allowed[g as Good]) && game.GOODS[g as Good]) as Good[];
      const perMinute = (record: Inventory, good: Good, elapsed: number) =>
        elapsed > 0 ? ((record[good] || 0) / elapsed) * 60 : 0;
      const max = Math.max(
        1,
        ...goods.flatMap((g) => [
          perMinute(rates.consumed, g, rates.elapsed),
          perMinute(rates.inputDelivered, g, rates.deliveryElapsed),
        ]),
      );
      h +=
        '<div class="production-inputs"><div class="production-heading"><span>Input flow</span><span>per minute</span></div>' +
        '<div class="production-legend"><span class="flow-arrived">Delivered in</span><span class="flow-used">Consumed</span></div>';
      for (const g of goods) {
        h +=
          '<div class="production-resource"><div class="production-resource-name">' +
          game.GOODS[g].name +
          '</div>';
        for (const [record, elapsed, kind, label] of [
          [rates.inputDelivered, rates.deliveryElapsed, 'arrived', 'Delivered in'],
          [rates.consumed, rates.elapsed, 'used', 'Consumed'],
        ] as const) {
          const value = rate(record, g, elapsed);
          h +=
            '<div class="production-flow flow-' +
            kind +
            '" aria-label="' +
            game.GOODS[g].name +
            ': ' +
            label +
            ' ' +
            value +
            ' per minute">' +
            '<div class="production-track" aria-hidden="true"><span style="width:' +
            ((perMinute(record, g, elapsed) / max) * 100).toFixed(1) +
            '%"></span></div><strong>' +
            value +
            '</strong></div>';
        }
        h += '</div>';
      }
      if (!goods.length)
        h += '<p class="production-note">No input deliveries or consumption observed yet.</p>';
      h += '</div>';
    }
    h +=
      '<footer class="production-coverage">Observed ' +
      rates.elapsed.toFixed(1) +
      's of simulation time' +
      (rates.sampleInterval ? ' · 2s samples' : '') +
      (rates.deliveryElapsed < rates.elapsed
        ? '<br>Deliveries: ' + rates.deliveryElapsed.toFixed(1) + 's observed'
        : '') +
      '</footer></section>';
    return h;
  }
  var infoBody = document.getElementById('infobody'),
    lastInfoHTML: string | null = null;
  // Markup each section last received; browsers serialize it back differently.
  let rendered = new WeakMap<Element, string>();
  function section(selector: string, html: string) {
    const node = infoBody.querySelector(selector);
    if (node && html !== undefined) rendered.set(node, html);
  }
  function render(node: Element, html: string) {
    if (rendered.get(node) === html) return false;
    node.innerHTML = html;
    rendered.set(node, html);
    return true;
  }
  function updateInfo() {
    game.updateReferenceContext?.();
    var el = document.getElementById('info');
    var b = game.selected;
    const dock = document.getElementById('inspectordock');
    if (dock) dock.hidden = !b && !game.selInfo && !game.removedContributor;
    const illustration = document.getElementById('inspector-art') as HTMLCanvasElement;
    const type = b?.type || game.removedContributor?.type;
    if (illustration) {
      illustration.hidden = !type;
      if (type && type !== illustratedType && game.drawSpriteIcon) {
        const context = illustration.getContext('2d');
        context.clearRect(0, 0, illustration.width, illustration.height);
        game.drawSpriteIcon(context, type, illustration.width / 2, illustration.height / 2, 192);
        illustratedType = type;
      }
    }
    if (!b && !game.selInfo && game.removedContributor) {
      const former = game.removedContributor;
      el.style.display = 'block';
      infoBody.textContent =
        game.BSPEC[former.type].name +
        ' was demolished. Its recorded history remains part of this colony. Locate its former site at ' +
        former.x +
        ', ' +
        former.y +
        '.';
      document.getElementById('dz').style.display = 'none';
      lastInfoHTML = null;
      return;
    }
    if (!b && !game.selInfo) {
      el.style.display = 'none';
      lastInfoHTML = null;
      return;
    }
    el.style.display = 'block';
    game.clearRemovedContributor?.();
    var h = '';
    if (b) {
      var sp = game.BSPEC[b.type];
      const work = game.productionProgress?.(b);
      var liveHTML = live(b, work);
      var quote = game.demolitionQuote?.(b);
      var quoteHTML = quote ? shortcut(b, quote) : '';
      h = '<div data-inspector-live>' + liveHTML + '</div><div data-inspector-controls>';
      const referenceStart = h.length;
      if (buildingHelp[b.type])
        h +=
          '<p class="muted">' +
          (b.type === 'armory' && b.legacyIndustry
            ? 'This established armory retains its original iron ore and coal recipe.'
            : buildingHelp[b.type]) +
          '</p>';
      if (sp.prod === 'craft' || sp.prod === 'mine')
        h +=
          '<span style="color:#c8b890">Input ' +
          (sp.prod === 'mine'
            ? '1 fish, bread, meat or provisions'
            : formatCost(recipeRequirements(b, sp))) +
          ' \u2192 ' +
          game.GOODS[sp.out].name +
          ' / ' +
          (
            work?.duration ??
            sp.time *
              Math.pow(
                0.9,
                Math.min(3, (game.state.upgrades && game.state.upgrades.production) || 0),
              )
          )
            .toFixed(1)
            .replace(/\.0$/, '') +
          's</span><br>';
      else if (sp.cost)
        h += '<span style="color:#c8b890">Cost: ' + formatCost(sp.cost, ', ') + '</span><br>';
      var referenceHTML = h.substring(referenceStart);
      h =
        h.substring(0, referenceStart) +
        '<div data-inspector-reference>' +
        referenceHTML +
        '</div>';
      if (!b.done)
        h +=
          '<label>Construction priority<select data-priority><option value="0" ' +
          (!b.priority ? 'selected' : '') +
          '>Normal</option><option value="1" ' +
          (b.priority === 1 ? 'selected' : '') +
          '>High</option><option value="2" ' +
          (b.priority === 2 ? 'selected' : '') +
          '>Urgent</option></select></label>';
      if (b.done && sp.prod && sp.prod !== 'none')
        h +=
          '<button data-production>' +
          (b.disabled ? 'Resume production' : 'Pause production') +
          '</button>';
      if (b.done && sp.store) {
        h +=
          '<details><summary>Warehouse stock targets</summary><p class="muted">Carriers replenish targets from other stores. Food, beer, tool, and weapon producers work toward requested reserves. Zero means no request.</p>';
        for (var good in game.GOODS)
          h +=
            '<label>' +
            game.GOODS[good as Good].name +
            '<input type="number" min="0" max="500" step="1" data-target="' +
            good +
            '" value="' +
            ((b.targets && b.targets[good as Good]) || 0) +
            '"></label>';
        h += '</details>';
      }
      var m = b.metrics;
      if (b.done && m && sp.out) {
        h +=
          '<label>Rate window<select data-rate-window><option value="30" ' +
          (productionRateWindow === 30 ? 'selected' : '') +
          '>Last 30 seconds</option><option value="120" ' +
          (productionRateWindow === 120 ? 'selected' : '') +
          '>Last 2 minutes</option><option value="600" ' +
          (productionRateWindow === 600 ? 'selected' : '') +
          '>Last 10 minutes</option><option value="lifetime" ' +
          (productionRateWindow === 'lifetime' ? 'selected' : '') +
          '>Lifetime</option></select></label>';
        var productionHTML = observedProduction(b);
        h += '</div><div data-production-stats>' + productionHTML + '</div>';
      } else h += '</div>';
      if (game.demolitionQuote)
        h += '<div class="inspector-demolition" data-demolition-quote>' + quoteHTML + '</div>';
    } else {
      h =
        '<b style="color:#ffd23f">TERRAIN</b><br><span style="color:#c8b890">' +
        tileInfo(game.selInfo) +
        '</span>';
    }
    var editing = infoBody.contains(document.activeElement);
    const key = b ? b.id + ':' + b.type + ':' + b.done : 'terrain';
    const liveNode = infoBody.querySelector('[data-inspector-live]');
    if (
      b &&
      liveNode &&
      (inspectorKey === key || (editing && inspectorKey.startsWith(b.id + ':' + b.type + ':')))
    ) {
      render(liveNode, liveHTML);
      const stats = infoBody.querySelector('[data-production-stats]');
      if (
        stats &&
        productionHTML &&
        !stats.contains(document.activeElement) &&
        rendered.get(stats) !== productionHTML
      ) {
        const open = stats.querySelector('details')?.open;
        render(stats, productionHTML);
        if (open && stats.querySelector('details')) stats.querySelector('details').open = true;
      }
      const reference = infoBody.querySelector('[data-inspector-reference]');
      if (reference) render(reference, referenceHTML);
      const demolition = infoBody.querySelector('[data-demolition-quote]');
      if (demolition) render(demolition, quoteHTML);
      for (const input of infoBody.querySelectorAll<HTMLInputElement>('[data-target]'))
        if (input !== document.activeElement)
          input.value = String(b.targets?.[input.dataset.target as Good] || 0);
      const priority = infoBody.querySelector<HTMLSelectElement>('[data-priority]');
      if (priority && priority !== document.activeElement) priority.value = String(b.priority || 0);
      const toggle = infoBody.querySelector('[data-production]');
      if (toggle) toggle.textContent = b.disabled ? 'Resume production' : 'Pause production';
    } else if (editing && productionHTML && document.activeElement.matches('[data-rate-window]')) {
      const stats = infoBody.querySelector('[data-production-stats]');
      if (stats) render(stats, productionHTML);
    } else if (
      h !== lastInfoHTML &&
      (!editing || !b || !inspectorKey.startsWith(b.id + ':' + b.type + ':'))
    ) {
      const wasOpen = infoBody.querySelector('details')?.open;
      infoBody.innerHTML = h;
      lastInfoHTML = h;
      inspectorKey = key;
      section('[data-inspector-live]', liveHTML);
      section('[data-production-stats]', productionHTML);
      section('[data-inspector-reference]', referenceHTML);
      section('[data-demolition-quote]', quoteHTML);
      const details = infoBody.querySelector('details');
      if (details && wasOpen) details.open = true;
    }
    document.getElementById('dz').style.display = b ? '' : 'none';
    updateDzBtn(quote);
  }
  infoBody.addEventListener('change', function (e) {
    if (!game.selected) return;
    if ((e.target as HTMLSelectElement).matches('[data-rate-window]')) {
      var window = (e.target as HTMLSelectElement).value;
      if (window === 'lifetime' || window === '30' || window === '120' || window === '600')
        productionRateWindow = window === 'lifetime' ? window : (+window as 30 | 120 | 600);
      // Refresh the numbers immediately without replacing the focused select.
      var stats = infoBody.querySelector('[data-production-stats]');
      if (stats) render(stats, observedProduction(game.selected));
    }
    const input = e.target as HTMLInputElement;
    if (input.matches('[data-priority]')) game.setBuildingPriority(game.selected, +input.value);
    if (input.matches('[data-target]'))
      game.setStockTarget(game.selected, input.dataset.target as Good, +input.value);
    lastInfoHTML = null;
  });
  infoBody.addEventListener('click', function (e) {
    if (game.selected && (e.target as HTMLInputElement).matches('[data-production]')) {
      game.selected.disabled = !game.selected.disabled;
      game.emitGameEvent('productionControlChanged', { building: game.selected });
      lastInfoHTML = null;
      updateInfo();
    }
  });
  function updateDzBtn(quote = game.selected && game.demolitionQuote?.(game.selected)) {
    // the panel raze button arms like map clicks: confirm before razing
    var dz = document.getElementById('dz'),
      armed = game.demoArm && game.selected && game.demoArm === game.selected;
    dz.textContent =
      quote && !quote.allowed ? 'Demolition unavailable' : armed ? 'Review demolition' : 'Demolish';
    dz.title =
      quote?.reason ||
      'Review exact recovery and territory consequences. Shift+click confirms immediately.';
    dz.style.borderColor = armed ? '#ffd23f' : '';
  }
  document.getElementById('dz').onclick = function (e) {
    if (!game.selected) return;
    if (game.demolitionInput(game.selected, e.shiftKey) === 'armed') {
      game.msg(
        'Review the demolition consequences for ' +
          game.BSPEC[game.selected.type].name +
          ' before confirming',
      );
    }
    updateDzBtn();
  };
  infoBody.addEventListener('focusout', () => queueMicrotask(updateInfo));
  document.getElementById('ic').onclick = function () {
    game.dismissInspector();
  };
  function tileInfo(ht: TilePoint) {
    var tl = game.tiles[game.idx(ht.x, ht.y)];
    if (tl.t === game.WATER) return 'Water';
    if (tl.t === game.MTN)
      return tl.res
        ? game.GOODS[tl.res.kind].name + ' deposit: ' + tl.res.amt
        : 'Bare mountainside';
    var s = tl.tree
      ? tl.tree >= 4
        ? 'Mature forest'
        : 'Young trees (' + tl.tree + '/4)'
      : 'Meadow';
    if (tl.rock) s += ' \u2014 rock (' + tl.rock.amt + ')';
    if (tl.road) s += ' \u2014 road';
    s += game.owned[game.idx(ht.x, ht.y)] ? ' \u2014 your land' : ' \u2014 unclaimed';
    return s;
  }
  function reset() {
    illustratedType = '';
    inspectorKey = '';
    lastInfoHTML = null;
    rendered = new WeakMap();
    confirmationId = null;
    infoBody.innerHTML = '';
  }
  observePresentation(game, 'worldLoaded', reset);
  if (internals) {
    Object.assign(internals, { observedProduction, updateDzBtn });
    Object.defineProperty(internals, 'productionRateWindow', {
      get: () => productionRateWindow,
      set: (value: ProductionRateWindow) => {
        productionRateWindow = value;
      },
      enumerable: true,
    });
  }
  function formatCost(stock: Inventory, separator = ' + ') {
    return Object.entries(stock)
      .map(([good, amount]) => amount + ' ' + game.GOODS[good as Good].name.toLowerCase())
      .join(separator);
  }
  return { updateInfo, request, tick, tileInfo };
}

/** Test-only inspector state; kept out of the runtime surface. */
export interface InspectorInternals {
  observedProduction: (b: Building) => string;
  updateDzBtn: () => void;
  productionRateWindow: ProductionRateWindow;
}
