import { requireElement } from './dom.ts';
import { requireCanvas2D } from '../rendering/canvas-context.ts';
import { html as markup, trusted, escapeMarkup, formatGoods } from './markup.ts';
import { createLiveReportUpdater } from './live-report.ts';
import { createInspectorView } from './inspector-view.ts';
import { createPlacementFeedback } from './placement-feedback.ts';
import { createTransientHelp } from './transient-help.ts';
import { createMapControls } from './map-controls.ts';
import { createCatalogView } from './catalog-view.ts';
import { RESOURCE_GROUPS, resourceIcon } from './resource-icons.ts';
import { observePresentation } from './domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type {
  Building,
  BuildingType,
  Good,
  Inventory,
  PresentationPreferences,
  TilePoint,
} from '../types.ts';

/** Live middle/right-button drag state for camera panning. */
export interface PanDrag {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  moved: boolean;
}

export function createHud(game: GameRuntime, internals?: HudInternals): HudSubsystem {
  let advOn = true,
    started = false;
  const transientHelp = createTransientHelp({ canShow: () => !game.blockingLayerOpen?.() });
  const resourceHelp = new Map<Good, HTMLElement>();
  const resourceHelpCleanup: Array<() => void> = [];
  const populationControl = requireElement('ppl');
  const populationHelp = requireElement('population-help');
  transientHelp.bind(populationControl, populationHelp);
  let preferencesHealth: PreferencesHealth = {
    status: 'unchanged',
    message: 'Changes apply immediately and are remembered in this browser.',
  };
  function reportPreferences(status: PreferencesHealth['status'], message: string) {
    preferencesHealth = { status, message };
    game.emitGameEvent('preferencesResult', { ...preferencesHealth });
    if (status === 'failed') game.msg(message);
  }
  const mapControls = createMapControls(game, () => {
    miniDown = false;
  });
  const placementFeedback = createPlacementFeedback(game);
  const inspector = createInspectorView(game, placementFeedback);
  const { updateInfo, tileInfo } = inspector;
  function observedFlows(record: Inventory, elapsed: number, allowed?: Inventory) {
    return formatGoods(game.GOODS, record, {
      elapsed,
      allowed,
      omitZero: true,
      lowerCase: true,
      separator: ', ',
      empty: '0',
    });
  }
  const replaceAdvice = createLiveReportUpdater({
    focusAttribute: 'id',
    disclosureAttribute: 'id',
    disclosureDefault: 'markup',
    fallback: () => requireElement('advtoggle'),
  });
  function advTick() {
    const decision = game.advisorDecision(),
      action = decision.action,
      bottleneck = decision.bottleneck;
    let h = '';
    if (decision.waiting) {
      h = markup`<button type="button" class="ar warn" data-focus="${decision.waiting.id}"><div class="l1"><span class="ag warn">→</span><span>Finish the Outpost</span></div><div class="why">${
        decision.waiting.done
          ? 'The garrison is pending. Inspect its dispatch or walking soldier; manning extends the border.'
          : 'Deliver its construction materials before starting another expansion.'
      }</div></button>`;
    } else if (bottleneck && decision.shortage && decision.missing) {
      h = markup`<button type="button" class="ar warn" data-focus="${bottleneck.id}"><div class="l1"><span class="ag warn">!</span><span>Restore ${game.GOODS[decision.missing].name.toLowerCase()} supply</span></div><div class="why">${game.BSPEC[bottleneck.type].name} needs inputs, but none are ready for delivery. Check its suppliers for exhausted resources or paused work.</div></button>`;
    } else if (bottleneck) {
      const pct = Math.round((bottleneck.metrics.inputBlocked / bottleneck.metrics.elapsed) * 100);
      h = markup`<button type="button" class="ar warn" data-focus="${bottleneck.id}"><div class="l1"><span class="ag warn">!</span><span>Improve ${game.BSPEC[bottleneck.type].name} deliveries</span></div><div class="why">Waiting for inputs during ${pct}% of its observed time. Inspect its route and nearby suppliers.</div></button>`;
    } else if (action)
      h = markup`<button type="button" class="ar warn" data-b="${action.bt}"><div class="l1"><span class="ag warn">→</span><span>${game.BSPEC[action.bt].name}</span><span class="st">${action.have}${action.site ? ' + ' + action.site : ''} / ${action.target}</span></div><div class="why">${action.why}</div></button>`;
    else
      h =
        '<div class="ar ok"><div class="l1"><span class="ag ok">✓</span><span>The core economy is supplied</span></div><div class="why">Inspect long routes, fulfill a contract, or grow the treasury.</div></div>';
    const key = decision.waiting?.id || bottleneck?.id;
    h = h.replace(
      '<button ',
      markup`<button id="advisor-${key ? 'focus-' + key : 'build-' + action?.bt}" `,
    );
    if (h !== lastAdvHTML) {
      replaceAdvice(requireElement('advrows'), h);
      lastAdvHTML = h;
    }
    let details = '';
    for (const b of game.buildings) {
      const sp = game.BSPEC[b.type],
        m = b.metrics;
      if (!b.done || !sp.out) continue;
      const elapsed = (m && m.elapsed) || 0,
        rate = elapsed > 0 ? (((m.produced[sp.out] || 0) / elapsed) * 60).toFixed(1) : '—',
        waiting = elapsed > 0 ? Math.round((m.inputBlocked / elapsed) * 100) : 0;
      details += markup`<div>${sp.name}: ${rate} ${game.GOODS[sp.out].name.toLowerCase()}/min · waiting ${waiting}%${trusted(
        sp.in
          ? markup`<small>Consumes ${observedFlows(
              m.consumed,
              elapsed,
              sp.prod === 'mine' ? undefined : sp.in,
            )}/min · Arrivals ${observedFlows(
              m.delivered,
              elapsed,
              sp.prod === 'mine' ? undefined : sp.in,
            )}/min</small>`
          : '',
      )}</div>`;
    }
    requireElement('advmetrics').innerHTML =
      details || 'Production rates appear after buildings begin working.';
  }
  let hudT = 0,
    lastGoodsHTML: string | null = null,
    lastAdvHTML: string | null = null,
    lastSpeedBtn: string | null = null,
    lastHint: string | null = null,
    lastPpl: string | null = null,
    lastGoal: string | null = null,
    lastGoalFill: string | null = null,
    _prevWon = false;
  const messageNodes = new Map<object, HTMLDivElement>();
  function hudTick() {
    mapControls.update();
    const now = performance.now();
    if (now - hudT < 250) return;
    hudT = now;
    if (lastGoodsHTML === null) {
      resourceHelpCleanup.splice(0).forEach((cleanup) => cleanup());
      resourceHelp.clear();
      requireElement('goods').innerHTML = RESOURCE_GROUPS.map(
        (group) =>
          markup`<div class="resource-group" role="group" aria-label="${group.name}">${trusted(
            group.goods
              .map(
                (g) =>
                  markup`<span class="gd" tabindex="0" data-good="${g}" role="button">${trusted(resourceIcon(g))}<b>0</b></span>`,
              )
              .join(''),
          )}</div>`,
      ).join('');
      document.querySelectorAll<HTMLElement>('#goods [data-good]').forEach((trigger) => {
        const good = trigger.dataset.good as Good;
        const popup = document.createElement('div');
        popup.className = 'transient-help';
        popup.setAttribute('role', 'tooltip');
        document.body.appendChild(popup);
        resourceHelp.set(good, popup);
        const unbind = transientHelp.bind(trigger, popup);
        resourceHelpCleanup.push(() => {
          unbind();
          popup.remove();
        });
      });
      lastGoodsHTML = 'initialized';
    }
    document.querySelectorAll<HTMLElement>('#goods [data-good]').forEach((node) => {
      const good = node.dataset.good as Good;
      const count = game.totalGood(good);
      const popup = resourceHelp.get(good);
      const explanation =
        game.GOODS[good].name +
        ' stored stock: ' +
        count +
        '.\nIncludes reserved stock; goods carried between buildings are separate. Activate to open resource accounting.' +
        (good === 'gold'
          ? '\nBanked objective progress is shown separately in the gold goal.'
          : '');
      if (popup && popup.textContent !== explanation) popup.textContent = explanation;
      const countNode = node.querySelector('b');
      if (countNode) countNode.textContent = String(count);
      node.setAttribute(
        'aria-label',
        game.GOODS[good].name + ': ' + count + ' stored stock. Open resource accounting',
      );
    });
    let n = 0;
    for (let i = 0; i < game.units.length; i++) if (game.units[i].kind === 'carrier') n++;
    const cap = game.carrierCap();
    const pplTxt = n + ' carriers';
    if (pplTxt !== lastPpl) {
      populationControl.textContent = pplTxt;
      populationControl.setAttribute('aria-label', n + ' active carriers. Population details');
      lastPpl = pplTxt;
    }
    const populationCopy = requireElement('population-help-copy');
    const populationText =
      'Active carriers: ' +
      n +
      '\nCarrier capacity: ' +
      cap +
      '\nIdle settler pool: ' +
      game.serfPool +
      '\nSoldier pool: ' +
      game.soldierPool;
    if (populationCopy.textContent !== populationText) populationCopy.textContent = populationText;
    const gt = game.state.won
      ? '✓ Goal achieved · ' + game.state.gold + ' banked'
      : 'Banked gold ' + game.state.gold + ' / ' + game.GOAL;
    if (gt !== lastGoal) {
      requireElement('goaltxt').textContent = gt;
      lastGoal = gt;
    }
    const pct =
      (game.state.won
        ? 100
        : Math.min(100, Math.round((game.state.gold / game.GOAL) * 1000) / 10)) + '%';
    if (pct !== lastGoalFill) {
      requireElement('goalfill').style.width = pct;
      lastGoalFill = pct;
    }
    if (game.state.won && !_prevWon) {
      _prevWon = true;
      game.SND.fanfare();
      const storage = game.anyStorage();
      game.FX.pop(storage ? storage.x + 0.5 : game.W / 2, storage ? storage.y + 0.5 : game.H / 2);
    }
    const liveMessages = new Set<object>(),
      feed = requireElement('msgs');
    for (let i = 0; i < game.msgs.length; i++) {
      const message = game.msgs[i],
        age = (now - message.at) / 1000;
      if (age >= 7) continue;
      liveMessages.add(message);
      let node = messageNodes.get(message);
      if (!node) {
        node = document.createElement('div');
        node.textContent = message.t;
        if (message.context) {
          const context = message.context;
          const link = document.createElement('button');
          link.className = 'message-context';
          link.textContent = context.workspace === 'attention' ? 'View issue' : 'View activity';
          link.onclick = () => {
            if (context.entity)
              game.showAttentionEntity?.(context.entity.id, context.workspace === 'activity');
            else game.switchWorkspace?.(context.workspace);
          };
          node.appendChild(link);
        }
        messageNodes.set(message, node);
        feed.appendChild(node);
      }
      // Retain each node while it fades: rebuilding a live log would announce
      // the same notice repeatedly to screen readers on every opacity change.
      // Five fully readable seconds before the two-second fade, including mute.
      node.style.opacity = String(Math.round(Math.max(0, Math.min(1, (7 - age) / 2)) * 10) / 10);
    }
    for (const [cachedMessage, cachedNode] of messageNodes) {
      if (!liveMessages.has(cachedMessage)) {
        cachedNode.remove();
        messageNodes.delete(cachedMessage);
      }
    }
    advTick();
    game.gameplayHUD();
    game.updateEconomyView?.();
    game.updateLogisticsView?.();
    game.updateAttentionView?.();
    updateInfo();
    updateHint();
    const suspended = modalOpen();
    const cur = 'sp' + (game.state.paused || suspended ? '0' : game.state.speed);
    const speedKey = cur + ':' + suspended + ':' + game.state.paused + ':' + game.state.speed;
    if (speedKey !== lastSpeedBtn) {
      ['sp0', 'sp1', 'sp2', 'sp4', 'sp8'].forEach(function (id) {
        requireElement(id).className = '';
      });
      requireElement(cur).className = 'on';
      const indicator = requireElement('spd');
      indicator.textContent = suspended
        ? 'SUSPENDED · ' + game.state.speed + '\u00d7'
        : game.state.paused
          ? 'PAUSED'
          : game.state.speed + '\u00d7';
      const reason = suspended
        ? 'Temporary utility screen suspends simulation. Closing it keeps your ' +
          (game.state.paused ? 'paused' : 'running') +
          ' choice at ' +
          game.state.speed +
          '×.'
        : game.state.paused
          ? 'Colony manually paused. Selected speed ' + game.state.speed + '×.'
          : 'Colony running at ' + game.state.speed + '×.';
      indicator.title = reason;
      indicator.setAttribute('aria-label', indicator.textContent + '. ' + reason);
      lastSpeedBtn = speedKey;
    }
  }
  function updateHint() {
    catalog.updatePlacement();
    inspector.tick();
    const h = requireElement('hint');
    let t = '';
    if (game.mode && game.mode.type === 'build') {
      const deposit = game.BSPEC[game.mode.bt].resKind;
      if (game.ghost && !game.ghost.ok)
        t =
          '\u2716 ' +
          game.BSPEC[game.mode.bt].name +
          ': ' +
          game.placementText(game.ghost.reason) +
          (game.suggestFor(game.ghost.reason)
            ? ' \u2192 ' + game.suggestFor(game.ghost.reason)
            : '');
      else if (hlTiles && hlTiles.length && deposit)
        t =
          'Placing: ' +
          game.BSPEC[game.mode.bt].name +
          ' (' +
          costStr(game.mode.bt) +
          ') \u2014 glowing tiles are ' +
          game.GOODS[deposit].name.toLowerCase() +
          ' deposits; build on the grass beside them';
      else {
        t =
          'Placing: ' +
          game.BSPEC[game.mode.bt].name +
          ' (' +
          costStr(game.mode.bt) +
          ') \u2014 keep clicking to repeat; right-click/Esc to stop';
        if (game.mode.bt === 'guard')
          t += ' \u2022 dashed gold border = land it claims once manned';
      }
    } else if (game.mode && game.mode.type === 'road')
      t = game.anchor
        ? 'Road: click the end point (right-click to cancel)'
        : 'Road: click the start point';
    else if (game.mode && game.mode.type === 'demolish')
      t =
        'Demolish: inspect the construction refund and local-stock salvage before confirming (right-click/Esc to cancel)';
    else
      t =
        (game.state.auto
          ? 'AUTO-PLAY \u2014 the colonists build for you (P to stop) \u2022 '
          : '') +
        'Click to inspect \u2022 Buildings: choose a tool \u2022 Right-drag/arrows: pan \u2022 Wheel: zoom \u2022 Space: pause \u2022 V: Colony guidance';
    h.hidden = !game.mode;
    const label = game.mode
      ? game.mode.type === 'build'
        ? game.BSPEC[game.mode.bt].name + ' · repeat placement'
        : game.mode.type === 'road'
          ? 'Road · choose ' + (game.anchor ? 'end point' : 'start point')
          : 'Demolish · review before confirming'
      : '';
    const toolLabel = requireElement('tool-label');
    if (toolLabel.textContent !== label) toolLabel.textContent = label;
    if (t !== lastHint) {
      requireElement('map-help-copy').textContent = t;
      lastHint = t;
    }
  }
  function costStr(type: BuildingType | 'road' | 'demolish') {
    const sp = game.BSPEC[type as BuildingType];
    if (type === 'road') return 'free';
    if (type === 'demolish') return '';
    return formatGoods(game.GOODS, sp.cost, { lowerCase: true, separator: ', ' });
  }
  function costStr2(o: Inventory) {
    return formatGoods(game.GOODS, o, { lowerCase: true });
  }

  let hlTiles: number[] | null = null,
    hlSpots: number[] | null = null;
  function refreshGhost() {
    // recompute the placement ghost for the current hover tile; also called from
    // recomputeTerritory so the ghost never goes stale when the border moves
    if (game.mode && game.mode.type === 'build' && game.hoverIn) {
      game.ghost = { x: game.ht.x, y: game.ht.y, ok: true, reason: null, in: true };
      const preview = game.placementPreview?.();
      const spatial = preview
        ? ([preview.checks.ok, preview.checks.reason] as ReturnType<typeof game.canPlace>)
        : game.canPlace(game.mode.bt, game.ht.x, game.ht.y);
      const spending = preview?.spending || game.buildingAffordability?.(game.mode.bt, game.ht);
      if (spatial[0] && spending && !spending.affordable) {
        const missing = spending.materials.find(
          (material) => material.available < material.required,
        );
        spatial[0] = false;
        spatial[1] = missing
          ? {
              code: 'stock',
              good: missing.good,
              required: missing.required,
              available: missing.available,
            }
          : { code: 'unreachable-stock' };
      }
      game.ghost.ok = spatial[0];
      game.ghost.reason = spatial[1];
    } else game.ghost = null;
  }
  function rebuildHighlights() {
    hlTiles = null;
    hlSpots = null;
    if (
      game.mode &&
      game.mode.type === 'build' &&
      game.mode.bt &&
      game.BSPEC[game.mode.bt].resKind
    ) {
      hlTiles = [];
      hlSpots = [];
      for (let i = 0; i < game.tiles.length; i++) {
        const t4 = game.tiles[i];
        if (
          t4.t === game.MTN &&
          t4.deposit &&
          t4.deposit.kind === game.BSPEC[game.mode.bt].resKind &&
          t4.deposit.amt > 0
        ) {
          hlTiles.push(i);
          for (let d13 = 0; d13 < 8; d13++) {
            const nx10 = (i % game.W) + game.DX[d13],
              ny10 = ((i / game.W) | 0) + game.DY[d13];
            if (!game.inB(nx10, ny10)) continue;
            const n10 = game.idx(nx10, ny10);
            if (
              game.passI(n10) &&
              game.owned[n10] &&
              !game.buildingAt(nx10, ny10) &&
              hlSpots.indexOf(n10) < 0
            )
              hlSpots.push(n10);
          }
        }
      }
    }
  }
  const { cancelMode } = game;
  function refreshPalette() {
    const ps = document.querySelectorAll<HTMLElement>('.pb');
    for (let i = 0; i < ps.length; i++)
      ps[i].classList.toggle(
        'on',
        !!game.mode &&
          ps[i].dataset.b === (game.mode.type === 'build' ? game.mode.bt : game.mode.type),
      );
    for (const btn of ps)
      btn.setAttribute('aria-pressed', btn.classList.contains('on') ? 'true' : 'false');
    const active = game.mode && (game.mode.type === 'build' ? game.mode.bt : game.mode.type);
    requireElement('palettestatus').textContent = active
      ? active === 'road'
        ? 'Road selected'
        : active === 'demolish'
          ? 'Raze selected'
          : game.BSPEC[active].name + ' selected'
      : 'Choose a building';
  }
  function selectAt(ht: TilePoint) {
    let best = null,
      bd = 1.6;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        d = Math.hypot(b.x - ht.x, b.y - ht.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    game.selectMapTarget(best, ht);
  }
  let hoverCamX: number | null = null,
    hoverCamY: number | null = null,
    hoverZoom: number | null = null;
  function syncHover(clientX: number, clientY: number, dwell: boolean) {
    const r = game.view.getBoundingClientRect();
    game.mouse.x = clientX - r.left;
    game.mouse.y = clientY - r.top;
    game.mouseSeen = true;
    if (dwell) game.hovT = performance.now();
    game.hovX = clientX;
    game.hovY = clientY;
    hoverCamX = game.cam.x;
    hoverCamY = game.cam.y;
    hoverZoom = game.z;
    const w = game.screenToWorld(game.mouse.x, game.mouse.y);
    game.ht.x = Math.floor(w.x / game.TS);
    game.ht.y = Math.floor(w.y / game.TS);
    game.hoverIn =
      game.mouse.x >= 0 &&
      game.mouse.y >= 0 &&
      game.mouse.x < r.width &&
      game.mouse.y < r.height &&
      game.inB(game.ht.x, game.ht.y);
    refreshGhost();
  }
  game.view.addEventListener('mousemove', function (e) {
    if (pan) {
      if (Math.abs(e.clientX - pan.ox) + Math.abs(e.clientY - pan.oy) > 5) pan.moved = true;
      game.cam.x -= (e.clientX - pan.sx) / game.z;
      game.cam.y -= (e.clientY - pan.sy) / game.z;
      pan.sx = e.clientX;
      pan.sy = e.clientY;
      game.clampCam();
    }
    syncHover(e.clientX, e.clientY, true);
  });
  let pan: PanDrag | null = null,
    suppressCtx = false;
  function cancelMapGestures() {
    // The old drag's eventual contextmenu must not dismiss retained inspection.
    if (pan) suppressCtx = true;
    pan = null;
    miniDown = false;
  }
  game.view.addEventListener('mousedown', function (e) {
    syncHover(e.clientX, e.clientY, true);
    game.initAudio();
    if (e.button === 1 || e.button === 2) {
      suppressCtx = false;
      pan = { sx: e.clientX, sy: e.clientY, ox: e.clientX, oy: e.clientY, moved: false };
      return;
    }
    if (e.button !== 0) return;
    if (!game.hoverIn) return;
    if (game.mode && game.mode.type === 'build') {
      game.placeBuilding(game.mode.bt, game.ht.x, game.ht.y);
    } else if (game.mode && game.mode.type === 'demolish') {
      let tgt = null,
        td = 1.45;
      for (let di5 = 0; di5 < game.buildings.length; di5++) {
        const b4 = game.buildings[di5],
          dd5 = Math.hypot(b4.x - game.ht.x, b4.y - game.ht.y);
        if (dd5 < td) {
          td = dd5;
          tgt = b4;
        }
      }
      const action = game.demolitionInput(tgt, e.shiftKey);
      if (action === 'missing') {
        game.msg(
          '\u2716 No building there to raze \u2014 click directly on one (raze-able buildings are marked with a red \u2715)',
        );
      } else if (action === 'armed' && tgt) {
        game.msg(
          'Review the demolition consequences for ' +
            game.BSPEC[tgt.type].name +
            ' before confirming',
        );
      }
    } else if (game.mode && game.mode.type === 'road') {
      game.roadInput(game.ht, e.shiftKey);
    } else selectAt(game.ht);
  });
  game.view.addEventListener('mouseup', function (e) {
    if (e.button === 1 || e.button === 2) {
      if (pan) {
        // Browsers may emit contextmenu before or after mouseup. Decide whether
        // this was a cancel click only once the gesture has finished.
        if (e.button === 2 && !pan.moved) cancelMode();
        suppressCtx = true;
      }
      pan = null;
    }
  });
  game.view.addEventListener('mouseleave', function () {
    if (pan && pan.moved) suppressCtx = true;
    pan = null;
    game.hoverIn = false;
    game.mouseSeen = false;
    game.ghost = null;
  });
  game.view.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (pan) return;
    if (suppressCtx) {
      suppressCtx = false;
      return;
    }
    cancelMode();
  });
  game.view.addEventListener(
    'wheel',
    function (e) {
      e.preventDefault();
      syncHover(e.clientX, e.clientY, true);
      game.zoomAt(game.zi + (e.deltaY < 0 ? 1 : -1), game.mouse.x, game.mouse.y);
    },
    { passive: false },
  );
  function buildingNear(x: number, y: number, r: number) {
    let best = null,
      bd = r;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }
  function jumpFlagged() {
    const flagged = [];
    for (let i = 0; i < game.buildings.length; i++)
      if (game.bStatus(game.buildings[i]).bad) flagged.push(game.buildings[i]);
    if (!flagged.length) {
      game.msg('Nothing needs attention right now');
      return;
    }
    game.flagIdx++;
    const b = flagged[game.flagIdx % flagged.length];
    game.zoomAnim = null;
    game.cam.x = b.x * game.TS - game.vw / game.z / 2;
    game.cam.y = b.y * game.TS - game.vh / game.z / 2;
    game.clampCam();
    game.inspectBuilding(b, 'flagged');
    game.msg('Needs attention: ' + game.BSPEC[b.type].name);
  }
  function centerHQ() {
    let hq = null;
    for (let i = 0; i < game.buildings.length; i++)
      if (game.buildings[i].type === 'hq') hq = game.buildings[i];
    if (!hq) return;
    game.zoomAnim = null;
    game.cam.x = hq.x * game.TS - game.vw / game.z / 2;
    game.cam.y = hq.y * game.TS - game.vh / game.z / 2;
    game.clampCam();
  }
  function tooltipTick(now: number) {
    const tt = requireElement('tt');
    const show =
      (!game.workspace || game.workspace === 'map') &&
      game.hoverIn &&
      game.mouseSeen &&
      !pan &&
      !game.mode &&
      now - game.hovT > 320 &&
      !modalOpen();
    if (!show) {
      if (tt.style.display !== 'none') tt.style.display = 'none';
      return;
    }
    const b = buildingNear(game.ht.x, game.ht.y, 1.0);
    let txt: string;
    if (b) {
      txt = game.BSPEC[b.type].name;
      const st = game.bStatus(b);
      if (st.bad && st.lines.length) txt += ' \u2014 ' + st.lines[0].t;
    } else txt = tileInfo(game.ht);
    if (txt !== game.ttStr) {
      tt.textContent = txt;
      game.ttStr = txt;
    }
    const nx = Math.min(window.innerWidth - 240, game.hovX + 14) + 'px',
      ny = Math.min(window.innerHeight - 40, game.hovY + 18) + 'px';
    if (tt.style.display !== 'block') tt.style.display = 'block';
    if (tt.style.left !== nx) tt.style.left = nx;
    if (tt.style.top !== ny) tt.style.top = ny;
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('settlers.prefs') || '{}');
      for (const key of ['musVol', 'sfxVol', 'ambVol'])
        if (typeof p[key] === 'number' && p[key] >= 0 && p[key] <= 1) {
          if (key === 'musVol') game.musVol = p[key];
          if (key === 'sfxVol') game.sfxVol = p[key];
          if (key === 'ambVol') game.ambVol = p[key];
        }
      if (p.muted) game.setMuted(true);
      if (p.music === false) game.setMusicVol(false);
      if ([1, 2, 4, 8].indexOf(p.speed) >= 0) game.state.speed = p.speed;
      game.presentationPrefs.reducedMotion =
        p.reducedMotion === true ||
        (!Object.hasOwn(p, 'reducedMotion') &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      game.presentationPrefs.atlasExpanded = p.atlasExpanded === true;
      game.presentationPrefs.showFps = p.showFps === true;
      game.presentationPrefs.minimapVisible = p.minimapVisible !== false;
      game.presentationPrefs.weather = p.weather !== false;
      game.presentationPrefs.clarity = p.clarity === true;
      game.presentationPrefs.quality = p.quality === 0.75 ? 0.75 : 1;
      if (['none', 'routes', 'workload', 'reach', 'stalls'].indexOf(p.overlay) >= 0)
        game.presentationPrefs.overlay = p.overlay;
      if (p.adv === false) {
        advOn = false;
        (requireElement('colony-guidance') as HTMLDetailsElement).open = false;
        requireElement('advb').className = '';
      }
    } catch (e) {
      reportPreferences(
        'failed',
        'Saved settings unavailable: ' +
          (e instanceof Error ? e.message : String(e)) +
          '. Current defaults apply for this session.',
      );
    }
    applyPresentationPrefs();
  }
  function applyPresentationPrefs() {
    game.setAtlasExpanded?.(game.presentationPrefs.atlasExpanded, false);
    requireElement('fps').hidden = !game.presentationPrefs.showFps;
    (requireElement('fpspref') as HTMLInputElement).checked = game.presentationPrefs.showFps;
    const atlasArt = requireElement<HTMLCanvasElement>('atlas-art');
    if (game.drawSpriteIcon) {
      const context = requireCanvas2D(atlasArt, game.reportGraphicsFailure);
      context.clearRect(0, 0, atlasArt.width, atlasArt.height);
      game.drawSpriteIcon(context, 'hq', atlasArt.width / 2, atlasArt.height / 2, 64);
    }
    document.body.classList.toggle('reduced-motion', game.presentationPrefs.reducedMotion);
    document.body.classList.toggle('clarity-view', game.presentationPrefs.clarity);
    (requireElement('motionpref') as HTMLInputElement).checked =
      game.presentationPrefs.reducedMotion;
    (requireElement('weatherpref') as HTMLInputElement).checked = game.presentationPrefs.weather;
    (requireElement('claritypref') as HTMLInputElement).checked = game.presentationPrefs.clarity;
    (requireElement('qualitypref') as HTMLSelectElement).value = String(
      game.presentationPrefs.quality,
    );
    mapControls.update();
    mapControls.paint();
  }
  let prefsT: number | null = null;
  function savePrefsSoon() {
    if (prefsT) return;
    reportPreferences('pending', 'Changes applied. Remembering settings…');
    prefsT = setTimeout(function () {
      prefsT = null;
      savePrefs();
    }, 600);
  }
  function savePrefs() {
    try {
      localStorage.setItem(
        'settlers.prefs',
        JSON.stringify(
          Object.assign(
            {
              muted: game.muted,
              music: game.musicOn,
              adv: advOn,
              musVol: game.musVol,
              sfxVol: game.sfxVol,
              ambVol: game.ambVol,
              speed: game.state.speed,
            },
            game.presentationPrefs,
          ),
        ),
      );
      reportPreferences('saved', 'Settings remembered in this browser.');
      return true;
    } catch (e) {
      reportPreferences(
        'failed',
        'Settings could not be remembered: ' +
          (e instanceof Error ? e.message : String(e)) +
          '. Current choices still apply for this session.',
      );
      return false;
    }
  }
  let miniDown = false;
  game.mini.addEventListener('mousedown', function (e) {
    miniDown = true;
    game.miniClick(e);
    e.preventDefault();
  });
  game.mini.addEventListener('mousemove', function (e) {
    if (miniDown) game.miniClick(e);
  });
  window.addEventListener('mouseup', function () {
    miniDown = false;
  });
  game.mini.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (
      (e.target as HTMLInputElement).matches('input,textarea,select') ||
      (e.target as HTMLInputElement).isContentEditable
    )
      return;
    if (k === 'Escape') {
      if (game.workspace && game.workspace !== 'map') {
        game.switchWorkspace('map');
        game.focusWorkspaceNavigation?.();
      } else {
        if (!requireElement('paletteitems').classList.contains('hidden')) {
          setPaletteExpanded(false);
          requireElement('paletteb').focus();
        } else if (!e.repeat) cancelMode();
        (requireElement('utility') as HTMLDetailsElement).open = false;
      }
      e.preventDefault();
      return;
    }
    if ((e.target as HTMLElement).closest('#placement-feedback')) return;
    if (modalOpen()) return;
    const onMap = !game.workspace || game.workspace === 'map';
    if (onMap && (k === 'ArrowLeft' || k === 'a' || k === 'A')) game.keys.l = true;
    if (onMap && (k === 'ArrowRight' || k === 'd' || k === 'D')) game.keys.r = true;
    if (onMap && (k === 'ArrowUp' || k === 'w' || k === 'W')) game.keys.u = true;
    if (onMap && (k === 'ArrowDown' || k === 's' || k === 'S')) game.keys.d = true;
    if (k === ' ') {
      if ((e.target as HTMLInputElement).closest('button,summary,a')) return;
      e.preventDefault();
      if (!e.repeat) game.state.paused = !game.state.paused;
    }
    if (e.repeat) return;
    if (k === 'm' || k === 'M') toggleMute();
    if (k === 'v' || k === 'V') toggleAdv();
    if (k === 'p' || k === 'P') toggleAuto();
    if (onMap && (k === 'f' || k === 'F')) jumpFlagged();
    if (onMap && (k === 'g' || k === 'G' || k === 'Home')) centerHQ();
    if (k === '1') {
      game.state.paused = false;
      game.state.speed = 1;
    }
    if (k === '2') {
      game.state.paused = false;
      game.state.speed = 2;
    }
    if (k === '4') {
      game.state.paused = false;
      game.state.speed = 4;
    }
    if (k === '8') {
      game.state.paused = false;
      game.state.speed = 8;
    }
    if (k === 'h' || k === 'H') toggleHelp();
    if (onMap && (k === '+' || k === '=')) game.zoomAt(game.zi + 1);
    if (onMap && (k === '-' || k === '_')) game.zoomAt(game.zi - 1);
  });
  window.addEventListener('keyup', function (e) {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') game.keys.l = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') game.keys.r = false;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') game.keys.u = false;
    if (k === 'ArrowDown' || k === 's' || k === 'S') game.keys.d = false;
  });
  window.addEventListener('blur', function () {
    game.keys.l = game.keys.r = game.keys.u = game.keys.d = false;
    cancelMapGestures();
  });
  function keyPan(dt: number) {
    const sp = (700 / game.z) * dt;
    if (game.keys.l) game.cam.x -= sp;
    if (game.keys.r) game.cam.x += sp;
    if (game.keys.u) game.cam.y -= sp;
    if (game.keys.d) game.cam.y += sp;
    game.clampCam();
  }
  function toggleMute() {
    game.setMuted(!game.muted);
    requireElement('mute').style.opacity = game.muted ? '0.4' : '1';
    savePrefs();
    game.SND.ui();
  }
  function toggleMusic() {
    game.setMusicVol(!game.musicOn);
    requireElement('musicb').classList.toggle('off', !game.musicOn);
    requireElement('mute').style.opacity = game.muted ? '0.4' : '1';
    savePrefs();
    if (!game.muted && game.musicOn) game.SND.ui();
  }
  function toggleHelp() {
    const help = requireElement('help');
    if (help.classList.contains('hidden')) {
      if (game.openReference) game.openReference();
      else game.openLayer('help');
    } else game.closeLayer('help');
  }
  function setAdvisorVisible(visible: boolean) {
    advOn = visible;
    (requireElement('colony-guidance') as HTMLDetailsElement).open = advOn;
    requireElement('advb').className = advOn ? 'on' : '';
    savePrefs();
  }
  function toggleAdv() {
    const opening = game.workspace !== 'colony';
    setAdvisorVisible(opening || !advOn);
    if (opening) game.switchWorkspace('colony');
    const guidance = requireElement('colony-guidance');
    if (advOn && !guidance.contains(document.activeElement)) {
      const summary = requireElement('colony-guidance-summary');
      summary.focus({ preventScroll: true });
      summary.scrollIntoView({ block: 'nearest' });
    }
    if (!advOn && guidance.contains(document.activeElement))
      requireElement('colony-guidance-summary').focus({ preventScroll: true });
    (requireElement('utility') as HTMLDetailsElement).open = false;
  }
  function toggleAdvisorDetails() {
    const compact = requireElement('adv').classList.toggle('compact');
    const button = requireElement('advtoggle');
    button.setAttribute('aria-expanded', compact ? 'false' : 'true');
    button.title = compact ? 'Show advisor details' : 'Compact advisor';
  }
  function toggleAuto() {
    game.state.auto = !game.state.auto;
    requireElement('autob').className = game.state.auto ? 'on' : '';
    requireElement('autob').textContent = game.state.auto ? 'AUTO ON' : 'AUTO OFF';
    requireElement('autob').setAttribute('aria-pressed', String(game.state.auto));
    if (game.state.auto) {
      game.state.paused = false;
      game.autoT = 0;
      game.msg('AUTO-PLAY: the colonists build for you \u2014 P to stop');
    } else game.msg('Auto-play off');
  }
  requireElement('autob').onclick = toggleAuto;
  requireElement('musicb').onclick = toggleMusic;
  requireElement('advb').onclick = toggleAdv;
  requireElement('advtoggle').onclick = toggleAdvisorDetails;
  function openPanel(id: string) {
    if (id === 'economy') {
      game.switchWorkspace('colony');
      return;
    }
    if (requireElement(id).classList.contains('hidden')) game.openLayer(id);
    else game.closeLayer(id);
    (requireElement('utility') as HTMLDetailsElement).open = false;
    if (id === 'mix') {
      game.initAudio();
      for (const data of [
        ['musvol', game.musVol],
        ['sfxvol', game.sfxVol],
        ['ambvol', game.ambVol],
      ] as [string, number][]) {
        (requireElement(data[0]) as HTMLInputElement).value = String(Math.round(data[1] * 100));
        volLbl(data[0] + 'v', data[1]);
      }
    }
    if (id === 'economy') game.gameplayHUD();
  }
  requireElement('settings-help').addEventListener('click', () =>
    game.openReference ? game.openReference('settings') : toggleHelp(),
  );
  requireElement('mixb').onclick = function () {
    if (game.openSettings) game.openSettings();
    else openPanel('mix');
  };
  requireElement('savepanelb').onclick = function () {
    game.openSaveManager?.();
  };
  requireElement('economyb').onclick = function () {
    openPanel('economy');
  };
  document.querySelectorAll<HTMLElement>('[data-close]').forEach(function (btn) {
    btn.onclick = function () {
      if (btn.dataset.close === 'savedata') game.closeSaveManager?.();
      else if (btn.dataset.close === 'economy') game.switchWorkspace('map');
      else game.closeLayer(btn.dataset.close);
    };
  });
  function volLbl(id: string, v: number) {
    requireElement(id).textContent = Math.round(v * 100) + '%';
  }
  const musicVolume = requireElement('musvol') as HTMLInputElement;
  musicVolume.oninput = function () {
    game.setMusVol(+musicVolume.value / 100);
    volLbl('musvolv', +musicVolume.value / 100);
    savePrefsSoon();
  };
  const sfxVolume = requireElement('sfxvol') as HTMLInputElement;
  sfxVolume.oninput = function () {
    game.setSfxVol(+sfxVolume.value / 100);
    volLbl('sfxvolv', +sfxVolume.value / 100);
    savePrefsSoon();
  };
  const ambienceVolume = requireElement('ambvol') as HTMLInputElement;
  ambienceVolume.oninput = function () {
    game.setAmbVol(+ambienceVolume.value / 100);
    volLbl('ambvolv', +ambienceVolume.value / 100);
    savePrefsSoon();
  };
  const motionPref = requireElement('motionpref') as HTMLInputElement;
  motionPref.onchange = function () {
    game.presentationPrefs.reducedMotion = motionPref.checked;
    applyPresentationPrefs();
    savePrefs();
  };
  const fpsPref = requireElement('fpspref') as HTMLInputElement;
  fpsPref.onchange = function () {
    game.presentationPrefs.showFps = fpsPref.checked;
    requireElement('fps').hidden = !fpsPref.checked;
    game.resize?.();
    savePrefs();
  };
  const weatherPref = requireElement('weatherpref') as HTMLInputElement;
  weatherPref.onchange = function () {
    game.presentationPrefs.weather = weatherPref.checked;
    savePrefs();
  };
  const qualityPref = requireElement('qualitypref') as HTMLSelectElement;
  qualityPref.onchange = function () {
    if (+qualityPref.value !== 1 && +qualityPref.value !== 0.75) return;
    game.presentationPrefs.quality = +qualityPref.value as 1 | 0.75;
    game.resize();
    savePrefs();
  };
  const clarityPref = requireElement('claritypref') as HTMLInputElement;
  clarityPref.onchange = function () {
    game.presentationPrefs.clarity = clarityPref.checked;
    applyPresentationPrefs();
    savePrefs();
  };
  requireElement('economybody').onclick = function (e) {
    const btn = (e.target as HTMLInputElement).closest('button');
    if (!btn) return;
    if (btn.dataset.upgrade === 'haul' || btn.dataset.upgrade === 'production')
      game.buyUpgrade(btn.dataset.upgrade);
    if (btn.dataset.contract !== undefined) game.claimContract(+btn.dataset.contract);
    game.gameplayHUD();
  };
  requireElement('colony-guidance').addEventListener('toggle', () => {
    const open = (requireElement('colony-guidance') as HTMLDetailsElement).open;
    if (open !== advOn) setAdvisorVisible(open);
  });
  requireElement('advb').className = 'on';
  requireElement('adv').addEventListener('click', function (e) {
    let el = e.target as HTMLElement | null;
    while (el && el.id !== 'adv' && !el.classList.contains('ar')) el = el.parentElement;
    if (!el || !el.classList.contains('ar')) return;
    if (el.dataset.focus) {
      game.switchWorkspace('map');
      game.inspectBuilding(game.byId(+el.dataset.focus), 'advisor');
      if (game.selected) {
        game.cam.x = game.selected.x * game.TS - game.vw / game.z / 2;
        game.cam.y = game.selected.y * game.TS - game.vh / game.z / 2;
        game.clampCam();
        mapControls.setMapOverlay('routes');
      }
      return;
    }
    const bt = el.dataset.b as BuildingType | undefined;
    if (!bt || !game.BSPEC[bt]) return;
    game.switchWorkspace('map');
    game.activateTool('build', bt);
  });
  requireElement('sp0').onclick = function () {
    game.state.paused = true;
  };
  requireElement('sp1').onclick = function () {
    game.state.paused = false;
    game.state.speed = 1;
  };
  requireElement('sp2').onclick = function () {
    game.state.paused = false;
    game.state.speed = 2;
  };
  requireElement('sp4').onclick = function () {
    game.state.paused = false;
    game.state.speed = 4;
  };
  requireElement('sp8').onclick = function () {
    game.state.paused = false;
    game.state.speed = 8;
  };
  requireElement('saveb').onclick = function () {
    game.initAudio();
    game.openSaveManager?.();
  };
  requireElement('loadb').onclick = function () {
    game.initAudio();
    game.openSaveManager?.();
  };
  requireElement('mute').onclick = toggleMute;
  requireElement('helpb').onclick = toggleHelp;
  requireElement('helpx').onclick = toggleHelp;
  requireElement('startb').onclick = function () {
    if (game.startNewColonyFromForm) {
      game.startNewColonyFromForm();
      return;
    }
    game.initAudio();
    game.closeLayer('start');
    game.state.paused = false;
    started = true;
    game.SND.ui();
  };
  function setPaletteExpanded(expanded: boolean) {
    transientHelp.dismiss();
    (requireElement('palette') as HTMLDetailsElement).classList.toggle('compact', !expanded);
    requireElement('paletteitems').classList.toggle('hidden', !expanded);
    requireElement('catalog-controls').classList.toggle('hidden', !expanded);
    const button = requireElement('paletteb');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.title = expanded ? 'Close building palette' : 'Open building palette';
  }
  const catalog = createCatalogView(
    game,
    (type) => {
      game.initAudio();
      game.SND.ui();
      setPaletteExpanded(false);
      if (game.mode && game.mode.type === 'build' && game.mode.bt === type) {
        cancelMode();
        requireElement('paletteb').focus({ preventScroll: true });
        return;
      }
      game.activateTool(
        type === 'road' ? 'road' : type === 'demolish' ? 'demolish' : 'build',
        type === 'road' || type === 'demolish' ? null : type,
      );
      requireElement('paletteb').focus({ preventScroll: true });
    },
    placementFeedback,
    transientHelp,
  );
  requireElement('tool-cancel').onclick = () => {
    transientHelp.dismiss();
    cancelMode();
    updateHint();
    requireElement('paletteb').focus({ preventScroll: true });
  };
  const mapHelp = requireElement('map-help');
  const mapHelpPopup = requireElement('map-help-popup');
  transientHelp.bind(mapHelp, mapHelpPopup);
  mapHelp.onclick = () => game.openReference('controls');
  function buildPalette() {
    catalog.build();
    requireElement('paletteb').onclick = function () {
      setPaletteExpanded(requireElement('paletteitems').classList.contains('hidden'));
    };
  }
  const fpsElement = requireElement('fps');
  let fpsSampleStart: number | null = null,
    fpsFrames = 0;
  function resetFps() {
    fpsSampleStart = null;
    fpsFrames = 0;
    if (fpsElement.textContent !== '— FPS') fpsElement.textContent = '— FPS';
  }
  function updateFps(ts: number) {
    if (document.visibilityState === 'hidden') {
      resetFps();
      return;
    }
    if (fpsSampleStart === null) {
      fpsSampleStart = ts;
      return;
    }
    fpsFrames++;
    const elapsed = ts - fpsSampleStart;
    if (elapsed >= 500) {
      const text = Math.round((fpsFrames * 1000) / elapsed) + ' FPS';
      if (fpsElement.textContent !== text) fpsElement.textContent = text;
      fpsSampleStart = ts;
      fpsFrames = 0;
    }
  }
  function modalOpen() {
    return !!game.blockingLayerOpen?.();
  }
  // A committed load replaced the world: reset every HUD-local view of it.
  observePresentation(game, 'territoryChanged', () => {
    rebuildHighlights();
    refreshGhost();
  });
  observePresentation(game, 'worldLoaded', function (event) {
    transientHelp.dismiss();
    _prevWon = game.state.won;
    lastGoodsHTML = null;
    game.lastJourneyHTML = '';
    game.lastEconomyHTML = '';
    lastSpeedBtn = null;
    requireElement('autob').className = game.state.auto ? 'on' : '';
    started = true;
    centerHQ();
    updateInfo();
    game.msg(event.reason === 'new' ? 'New colony started' : '✓ Game loaded');
    game.SND.ui();
  });

  // Test-only view of closure internals; never merged into the runtime.
  if (internals) {
    Object.assign(internals, {
      escapeMarkup,
      savePrefs,
      toggleMute,
      toggleMusic,
      toggleAdvisorDetails,
      resetHudThrottle: () => {
        hudT = 0;
      },
    });
    Object.defineProperties(internals, {
      pan: {
        get: () => pan,
        enumerable: true,
      },
      miniDown: {
        get: () => miniDown,
        enumerable: true,
      },
    });
  }

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    setMapOverlay: mapControls.setMapOverlay,
    cancelMapGestures,
    get started() {
      return started;
    },
    beginSession() {
      started = true;
    },
    get advisorVisible() {
      return advOn;
    },
    setAdvisorVisible,
    get preferencesHealth() {
      return preferencesHealth;
    },
    hudTick,
    updateInfo,
    requestDemolitionConfirmation: inspector.request,
    costStr2,
    get hlTiles() {
      return hlTiles;
    },
    get hlSpots() {
      return hlSpots;
    },
    refreshGhost,
    rebuildHighlights,
    refreshToolView() {
      transientHelp.dismiss();
      rebuildHighlights();
      refreshGhost();
      refreshPalette();
      updateHint();
    },
    tooltipTick,
    keyPan,
    modalOpen,
    resetFps,
    updateFps,
    loadPrefs,
    persistPreferences: savePrefs,
    toggleAutoplay: toggleAuto,
    buildPalette,
    updateHint,
    refreshHover() {
      if (game.mode?.type === 'build') refreshGhost();
      if (
        game.mouseSeen &&
        (hoverCamX !== game.cam.x || hoverCamY !== game.cam.y || hoverZoom !== game.z)
      )
        syncHover(game.hovX, game.hovY, false);
    },
  };
}

export interface PreferencesHealth {
  status: 'unchanged' | 'pending' | 'saved' | 'failed';
  message: string;
}

export interface HudSubsystem {
  setMapOverlay: (overlay: PresentationPreferences['overlay']) => void;
  cancelMapGestures: () => void;
  toggleAutoplay: () => void;
  beginSession: () => void;
  readonly advisorVisible: boolean;
  setAdvisorVisible: (visible: boolean) => void;
  readonly preferencesHealth: PreferencesHealth;
  readonly started: boolean;
  hudTick: () => void;
  updateInfo: () => void;
  requestDemolitionConfirmation: (building: Building) => void;
  costStr2: (o: Inventory) => string;
  readonly hlTiles: number[] | null;
  readonly hlSpots: number[] | null;
  refreshGhost: () => void;
  rebuildHighlights: () => void;
  refreshToolView: () => void;
  tooltipTick: (now: number) => void;
  keyPan: (dt: number) => void;
  modalOpen: () => boolean;
  resetFps: () => void;
  updateFps: (ts: number) => void;
  loadPrefs: () => void;
  persistPreferences: () => boolean;
  buildPalette: () => void;
  updateHint: () => void;
  refreshHover: () => void;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface HudInternals {
  escapeMarkup: (text: string) => string;
  savePrefs: () => boolean;
  toggleMute: () => void;
  toggleMusic: () => void;
  toggleAdvisorDetails: () => void;
  /** Let the next hudTick() refresh at once instead of waiting out its 250 ms. */
  resetHudThrottle: () => void;
  readonly pan: PanDrag | null;
  readonly miniDown: boolean;
}
