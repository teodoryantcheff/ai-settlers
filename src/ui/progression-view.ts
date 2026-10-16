import { html as markup, trusted } from './markup.ts';
import { createLiveReportUpdater } from './live-report.ts';
import { observePresentation } from './domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type { Inventory } from '../types.ts';

/** Live colony choices and achieved statistics share the actual progression commands. */
export function createProgressionView(game: GameRuntime): ProgressionViewSubsystem {
  let lastJourneyHTML = '',
    lastEconomyHTML = '';
  let registered = false;
  const replaceView = createLiveReportUpdater({
    focusAttribute: 'id',
    disclosureAttribute: 'id',
    disclosureDefault: 'markup',
    fallback: (element) => element.querySelector<HTMLElement>('h2,h3,summary'),
  });
  function journeyAction() {
    const lesson = game.currentLesson();
    if (!lesson) return;
    game.switchWorkspace?.('map');
    const outpost = lesson.step.building === 'guard' && game.pendingOutpost();
    if (outpost) {
      game.inspectBuilding(outpost, 'journey');
      game.cam.x = (outpost.x + 0.5) * game.TS - game.vw / game.z / 2;
      game.cam.y = (outpost.y + 0.5) * game.TS - game.vh / game.z / 2;
      game.clampCam();
    } else
      game.setMode(
        lesson.step.building === 'road' ? 'road' : 'build',
        lesson.step.building === 'road' ? null : lesson.step.building,
      );
  }
  function journeyHTML(actionId: string, full = false) {
    const lesson = game.currentLesson();
    const count = game.state.milestones.length;
    let html = markup`<span class="eyebrow">COLONY JOURNEY · ${count} / ${game.journeySteps.length} complete</span>`;
    if (lesson) {
      const waiting = lesson.step.building === 'guard' && game.pendingOutpost();
      html += markup`<strong>${lesson.step.title}</strong><p>${lesson.step.text}</p><button id="${actionId}">${
        waiting
          ? 'Inspect Outpost'
          : lesson.step.building === 'road'
            ? 'Draw a road'
            : 'Place ' + game.BSPEC[lesson.step.building].name
      }</button>`;
    } else
      html += markup`<strong>Journey complete</strong><p>Balance deliveries, fulfill optional contracts and bank ${game.GOAL} gold. Keep managing after the objective is achieved.</p>`;
    if (full)
      html += markup`<ol class="journey-milestones">${trusted(
        game.journeySteps
          .map(
            (step, index) =>
              markup`<li><b>${
                game.state.milestones.includes(index)
                  ? '✓ Completed'
                  : lesson?.index === index
                    ? '→ Next guidance'
                    : 'Upcoming'
              }</b> · ${step.title}</li>`,
          )
          .join(''),
      )}</ol>`;
    return html;
  }
  function conditions(cost: Inventory) {
    const report = game.actionAvailability(cost);
    const missing = report.materials
      .filter((row) => row.missing)
      .map((row) => 'Need ' + row.missing + ' more ' + game.GOODS[row.good].name);
    const reclaim = report.materials
      .filter((row) => row.reclaim)
      .map((row) => row.reclaim + ' ' + game.GOODS[row.good].name);
    return {
      affordable: report.affordable,
      text:
        (missing.length ? missing.join('; ') + '.' : 'Ready to spend.') +
        (reclaim.length
          ? ' Spending would reclaim ' +
            reclaim.join(', ') +
            ' from uncollected optional warehouse transfers.'
          : ''),
      evidence: markup`<ul>${trusted(
        report.materials
          .map(
            (row) =>
              markup`<li><b>${game.GOODS[row.good].name}</b>: ${row.required} required; ${row.available} available; ${row.reserved} reserved (including ${row.spendable - row.available} reclaimable optional transfer promises). ${row.spendable} spendable.</li>`,
          )
          .join(''),
      )}</ul>`,
    };
  }
  function stockEvidence(key: string, html: string) {
    return markup`<details id="availability-${key}" class="progression-availability"><summary id="availability-${key}-summary">Stock available to this action</summary>${trusted(html)}</details>`;
  }
  function gameplayHUD() {
    if (!registered && game.registerReportWindow) {
      game.registerReportWindow('colony', 'Colony', 'id');
      registered = true;
    }
    const journey = journeyHTML('colony-lesson-build', true);
    if (journey !== lastJourneyHTML) {
      replaceView(document.getElementById('colony-journey-body'), journey);
      lastJourneyHTML = journey;
    }
    const colonyLesson = document.getElementById('colony-lesson-build');
    if (colonyLesson) colonyLesson.onclick = journeyAction;
    const auto = document.getElementById('colony-auto-status');
    if (auto)
      auto.textContent = game.state.auto
        ? 'Enabled · colonists make building and road decisions. Manual placement temporarily holds planning; pause and utility screens suspend simulation.'
        : 'Off · you choose construction and roads. Press P or use Enable autoplay.';
    const autoButton = document.getElementById('colony-autoplay');
    if (autoButton) {
      autoButton.textContent = game.state.auto ? 'Disable autoplay' : 'Enable autoplay';
      autoButton.setAttribute('aria-pressed', String(game.state.auto));
    }
    const toolbar = document.getElementById('autob');
    toolbar.textContent = game.state.auto ? 'AUTO ON' : 'AUTO OFF';
    toolbar.className = game.state.auto ? 'on' : '';
    toolbar.setAttribute('aria-pressed', String(game.state.auto));
    const objective = document.getElementById('colony-objective');
    if (objective)
      objective.textContent = game.state.won
        ? '✓ 200-gold objective achieved. Current treasury: ' +
          game.state.gold +
          ' Gold. Later spending keeps the achievement.'
        : 'Bank ' +
          game.GOAL +
          ' Gold to complete the objective. Treasury: ' +
          game.state.gold +
          ' Gold · Gold spent on upgrades: ' +
          game.state.spentGold +
          '.';
    document.getElementById('colony-achievement')?.classList.toggle('hidden', !game.state.won);
    let html =
      '<section class="progression-upgrades"><h2 tabindex="-1">Colony improvements</h2><p>Gold spent here leaves the treasury instead of advancing the banked-gold objective. Improvements affect nominal cycles or movement; shortages, output reserves and routes still matter.</p>';
    for (const kind of ['haul', 'production'] as const) {
      const level = game.state.upgrades[kind] || 0,
        price = 15 * (level + 1),
        availability = conditions({ gold: price });
      html += markup`<article class="progression-card" data-progression-card="upgrade-${kind}"><h3 tabindex="-1">${kind === 'haul' ? 'Carrier training' : 'Workshop methods'}</h3><p>Level ${level} / 3 · ${
        kind === 'haul'
          ? '+12% carrier movement speed per level; current increase ' + 12 * level + '%.'
          : 'Cycle duration ×0.9 per level; current duration ' +
            (100 * Math.pow(0.9, level)).toFixed(1) +
            '% of base.'
      }</p><p>${
        level >= 3
          ? 'All three levels purchased.'
          : 'Spend ' + price + ' Gold from storage. Treasury decreases by ' + price + '.'
      }</p><button id="upgrade-${kind}" data-upgrade="${kind}" ${level >= 3 || !availability.affordable ? 'disabled' : ''}>${level >= 3 ? 'Complete' : 'Buy level ' + (level + 1)}</button><p class="progression-condition">${level >= 3 ? 'Maximum level reached.' : availability.text}</p>${trusted(level < 3 ? stockEvidence('upgrade-' + kind, availability.evidence) : '')}</article>`;
    }
    html +=
      '</section><section class="progression-contracts"><h2 tabindex="-1">Optional contracts</h2><p>Each contract spends stored materials once and delivers the listed reward to storage. Set a warehouse stock target if demand limits production before enough goods accumulate.</p>';
    game.contracts.forEach((contract, index) => {
      const done = game.state.contracts.includes(index),
        availability = conditions(contract.cost);
      html += markup`<article class="progression-card" data-progression-card="contract-${index}"><h3 tabindex="-1">${contract.name}</h3><p><b>Spend:</b> ${game.costStr2(contract.cost)}</p><p><b>Receive:</b> ${game.costStr2(contract.reward)}</p><button id="contract-${index}" data-contract="${index}" ${done || !availability.affordable ? 'disabled' : ''}>${done ? 'Fulfilled' : 'Fulfill contract'}</button><p class="progression-condition">${done ? 'Reward received. This contract can only be fulfilled once.' : availability.text}</p>${trusted(!done ? stockEvidence('contract-' + index, availability.evidence) : '')}</article>`;
    });
    html += '</section>';
    if (html !== lastEconomyHTML) {
      replaceView(document.getElementById('economybody'), html);
      lastEconomyHTML = html;
    }
    const working = game.units.filter(
      (unit) => unit.kind === 'carrier' && unit.phase !== 'idle',
    ).length;
    const carriers = game.units.filter((unit) => unit.kind === 'carrier').length;
    const perf = document.getElementById('perftext');
    if (perf && typeof game.renderStats !== 'undefined')
      perf.textContent =
        'Frame ' +
        (game.renderStats.frameMs || 0).toFixed(1) +
        ' ms · p95 ' +
        (game.renderStats.p95Ms || 0).toFixed(1) +
        ' ms · Draw ' +
        (game.renderStats.drawMs || 0).toFixed(1) +
        ' ms · Carriers busy ' +
        working +
        '/' +
        carriers;
  }
  function renderVictory() {
    const completed = game.buildings.filter((building) => building.done).length;
    const guards = game.buildings.filter((building) => building.type === 'guard');
    const settlers = game.units.filter((unit) => !unit.dead).length;
    const observed = game.economicWindow('lifetime');
    const stat = (label: string, value: string | number) =>
      trusted(markup`<div><dt>${label}</dt><dd>${value}</dd></div>`);
    let html = markup`<h2>Current settlement</h2><dl class="victory-grid">${stat(
      'Simulation age',
      Math.floor(game.state.time / 60) + 'm ' + (game.state.time % 60).toFixed(1) + 's',
    )}${stat('Current treasury', game.state.gold + ' Gold')}${stat('Completed buildings', completed)}${stat('Construction sites', game.buildings.length - completed)}${stat(
      'Manned outposts',
      guards.filter((building) => building.done && building.manned).length + ' / ' + guards.length,
    )}${stat('Road tiles', game.tiles.filter((tile) => tile.road).length)}${stat('Mobile settlers', settlers)}${stat('Contracts fulfilled', game.state.contracts.length + ' / ' + game.contracts.length)}</dl><h2>Recorded economic achievements</h2>`;
    if (observed.available) {
      html += markup`<dl class="victory-grid">${stat('Gold produced', observed.totals.produced.gold || 0)}${stat('Produced gold delivered to storage', observed.totals.outputStored.gold || 0)}${stat('Gold received from contracts', observed.totals.contractReward.gold || 0)}${stat('Gold spent on upgrades', observed.totals.upgradeSpent.gold || 0)}</dl><p class="muted">Recorded from ${observed.from.toFixed(1)} to ${observed.to.toFixed(1)} simulation seconds (${observed.elapsed.toFixed(1)} seconds of coverage). Colony totals include demolished producers. These are current recorded totals; the original victory time is not recorded.</p>`;
    } else
      html +=
        '<p>Economic measurements unavailable: no covered simulation time has been recorded. Historical achievement quantities are not inferred.</p>';
    replaceView(document.getElementById('winstats'), html);
  }
  function showVictory() {
    if (!game.state.won) return;
    renderVictory();
    game.openLayer?.('win', { blocking: true });
  }
  document.getElementById('colony-autoplay')?.addEventListener('click', () => {
    game.toggleAutoplay();
    gameplayHUD();
  });
  document.getElementById('colony-achievement')?.addEventListener('click', showVictory);
  document
    .getElementById('colony-map')
    ?.addEventListener('click', () => game.switchWorkspace('map'));
  document.getElementById('wingo').onclick = () => {
    if (game.continueColony) game.continueColony();
    else game.closeLayer?.('win');
  };
  document.getElementById('winhome')?.addEventListener('click', () => game.returnHome());
  observePresentation(game, 'victory', showVictory);
  observePresentation(game, 'worldLoaded', () => {
    lastJourneyHTML = '';
    lastEconomyHTML = '';
  });
  return {
    gameplayHUD,
    showVictory,
    renderVictory,
    get lastJourneyHTML() {
      return lastJourneyHTML;
    },
    set lastJourneyHTML(value) {
      lastJourneyHTML = value;
    },
    get lastEconomyHTML() {
      return lastEconomyHTML;
    },
    set lastEconomyHTML(value) {
      lastEconomyHTML = value;
    },
  };
}
export interface ProgressionViewSubsystem {
  gameplayHUD: () => void;
  showVictory: () => void;
  renderVictory: () => void;
  lastJourneyHTML: string;
  lastEconomyHTML: string;
}
