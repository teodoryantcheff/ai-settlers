import { requireElement } from './dom.ts';
import { requireCanvas2D } from '../rendering/canvas-context.ts';
import { html as markup, trusted, formatGoods } from './markup.ts';
import type { TransientHelp } from './transient-help.ts';
import type { PlacementFeedback } from './placement-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import type { BuildingType } from '../types.ts';

type CatalogTool = BuildingType | 'road' | 'demolish';
const groups: Record<string, string> = {
  lumberjack: 'Timber & stone',
  fisherman: 'Food & brewing',
  mine_coal: 'Mining & metalwork',
  warehouse: 'Settlement & routes',
};
export const buildingPurposes: Partial<Record<BuildingType, string>> = {
  lumberjack: 'Cuts mature trees into logs for the timber chain.',
  forester: 'Replants the nearest completed lumberjack’s clearing, or its own neighborhood.',
  sawmill: 'Turns logs into construction planks.',
  quarry: 'Cuts nearby rocks into construction stone.',
  fisherman: 'Catches fish, ready to feed mines. Build near water.',
  farm: 'Grows grain for windmills, pig farms and breweries. Grain is not edible.',
  windmill: 'Mills grain into flour. Send flour to a bakery to make bread.',
  bakery: 'Bakes flour into bread for mines. Needs a completed working well within 6 tiles.',
  pigfarm: 'Feeds grain to pigs. A butcher turns pigs into edible meat.',
  butcher: 'Turns pigs into meat for mines.',
  well: 'Supplies local water to bakeries and breweries within 6 tiles. Water needs no carrier.',
  brewery: 'Brews grain into beer for contracts. Needs a completed working well within 6 tiles.',
  mine_coal: 'Extracts coal for smelting iron and forging weapons.',
  mine_iron: 'Extracts iron ore for smelters.',
  mine_gold: 'Extracts gold to bank toward the 200-gold objective or invest in the colony.',
  smelter: 'Smelts iron ore and coal into iron bars for toolsmiths and armories.',
  workshop: 'Makes basic tools from planks and stone. Needs no tools to construct.',
  toolsmith: 'Makes tools from iron bars and planks, faster than the basic workshop.',
  armory: 'Forges iron bars and coal into weapons for outposts.',
  warehouse: 'Stores goods and requests stock targets from connected storage.',
  guard: 'Claims a small land radius before manning; an arriving soldier expands its territory.',
};
function toolDetails(game: GameRuntime, type: CatalogTool) {
  if (type === 'road')
    return {
      name: 'Road',
      purpose: 'Paves clear owned tiles along a walking route so carriers travel faster.',
      cost: '0 goods',
      recipe: 'No goods consumed.',
      requirements:
        'Start on clear ground inside your territory. A walking route must connect the endpoints.',
    };
  if (type === 'demolish')
    return {
      name: 'Demolish',
      purpose: 'Removes a building after deliberate confirmation.',
      cost: 'No construction cost',
      recipe:
        'Refunds rounded-down half of completed construction costs, or half the materials delivered to an unfinished site; local stock is salvaged separately.',
      requirements: 'Headquarters and the last storehouse are protected.',
    };
  const sp = game.BSPEC[type];
  let recipe =
    sp.prod === 'mine' && sp.out
      ? 'Fish, bread, meat or provisions (1 of any) → 1 ' + game.GOODS[sp.out].name
      : sp.in && sp.out
        ? formatGoods(game.GOODS, sp.in) + ' → 1 ' + game.GOODS[sp.out].name
        : sp.out
          ? 'Produces ' + game.GOODS[sp.out].name + ' from local work.'
          : type === 'well'
            ? 'Local water support; no transported water inventory.'
            : type === 'forester'
              ? 'Plants trees on clear owned ground.'
              : 'No production recipe.';
  if (sp.time && (sp.prod === 'craft' || sp.prod === 'mine'))
    recipe += ' · Base cycle ' + sp.time + 's.';
  let requirements =
    type === 'fisherman'
      ? 'Grass or sand with water within 2 tiles. The site and all passable neighboring tiles must be owned.'
      : 'Owned meadow inside the map edges; all passable neighboring tiles must be owned. Keep about 2 tiles between buildings.';
  if (sp.resKind)
    requirements +=
      ' Must border a mountain with a remaining ' +
      game.GOODS[sp.resKind].name.toLowerCase() +
      ' deposit.';
  if (type === 'quarry') requirements += ' Rocks must be within ' + sp.rad + ' tiles.';
  if (type === 'lumberjack')
    requirements +=
      ' Mature trees within ' +
      sp.rad +
      ' tiles supply work; no trees does not prevent construction.';
  if (sp.water)
    requirements +=
      ' Production needs a working, connected Well within ' +
      game.BSPEC.well.rad +
      ' tiles; construction can proceed without one.';
  if (type === 'guard')
    requirements +=
      ' Completion claims a small unmanned radius; a soldier expands it to full range.';
  return {
    name: sp.name,
    purpose: buildingPurposes[type] || '',
    cost: formatGoods(game.GOODS, sp.cost || {}),
    recipe,
    requirements,
  };
}

/** Persistent DOM controls: search/filter changes do not replace focused elements or artwork. */
export function createCatalogView(
  game: GameRuntime,
  select: (type: CatalogTool) => void,
  feedback: PlacementFeedback,
  help: TransientHelp,
) {
  const cards: Array<{
    type: CatalogTool;
    group: string;
    text: string;
    element: HTMLButtonElement;
  }> = [];
  const helpCleanup: Array<() => void> = [];
  const search = requireElement<HTMLInputElement>('catalog-search');
  const chain = requireElement<HTMLSelectElement>('catalog-chain');
  function filter() {
    help.dismiss();
    const query = (search.value || '').trim().toLowerCase();
    const group = chain.value || 'all';
    let count = 0;
    for (const card of cards) {
      card.element.hidden = !(
        card.text.includes(query) &&
        (group === 'all' || card.group === group)
      );
      if (!card.element.hidden) count++;
    }
    requireElement('catalog-count').textContent =
      count + ' of ' + cards.length + ' buildings and tools';
    requireElement('catalog-empty').hidden = count > 0;
  }
  search.addEventListener('input', filter);
  chain.addEventListener('change', filter);
  requireElement('catalog-clear').addEventListener('click', () => {
    search.value = '';
    chain.value = 'all';
    filter();
    search.focus();
  });
  function build() {
    const palette = requireElement('paletteitems');
    const helpHost = requireElement('catalog-help-host');
    for (const cleanup of helpCleanup.splice(0)) cleanup();
    helpHost.innerHTML = '';
    palette.innerHTML = '';
    cards.length = 0;
    let group = '';
    for (const name of game.ORDER) {
      const type = name as CatalogTool;
      if (groups[type]) group = groups[type];
      const details = toolDetails(game, type);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pb';
      button.dataset.b = type;
      const icon = document.createElement('canvas');
      icon.width = 128;
      icon.height = 128;
      icon.style.width = '64px';
      icon.style.height = '64px';
      icon.setAttribute('aria-hidden', 'true');
      const context = requireCanvas2D(icon, game.reportGraphicsFailure);
      context.scale(2, 2);
      context.imageSmoothingEnabled = true;
      if (type === 'road') context.drawImage(game.ART.road, 10, 10, 44, 44);
      else if (type === 'demolish') {
        context.strokeStyle = '#9e733d';
        context.lineWidth = 5;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(18, 51);
        context.lineTo(42, 16);
        context.stroke();
        context.fillStyle = '#bcc6c3';
        context.beginPath();
        context.moveTo(31, 20);
        context.lineTo(42, 10);
        context.lineTo(54, 22);
        context.lineTo(47, 33);
        context.closePath();
        context.fill();
      } else game.drawSpriteIcon(context, type, 32, 32, 58);
      button.appendChild(icon);
      const title = document.createElement('span');
      title.className = 'catalog-name';
      title.textContent = details.name;
      button.appendChild(title);
      const popup = document.createElement('div');
      popup.id = 'catalog-detail-' + type;
      popup.className = 'transient-help catalog-popup';
      popup.setAttribute('role', 'tooltip');
      const cost =
        type === 'road' || type === 'demolish'
          ? details.cost
          : formatGoods(game.GOODS, game.BSPEC[type].cost, {
              icons: true,
              className: 'catalog-good',
            });
      popup.innerHTML = markup`<h3>${details.name}</h3><p class="catalog-chain-name">${group}</p><p>${details.purpose}</p><p><strong>Cost</strong><br>${trusted(cost)}</p><p><strong>Recipe</strong><br>${details.recipe}</p><p><strong>Placement</strong><br>${details.requirements}</p>`;
      helpHost.appendChild(popup);
      helpCleanup.push(help.bind(button, popup));
      const text = [
        group,
        details.name,
        details.purpose,
        details.cost,
        details.recipe,
        details.requirements,
      ].join(' ');
      button.setAttribute('aria-label', details.name);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('mouseenter', () => game.SND.tick());
      button.onclick = () => select(type);
      palette.appendChild(button);
      cards.push({ type, group, text: text.toLowerCase(), element: button });
    }
    filter();
  }
  function updatePlacement() {
    if (game.mode?.type === 'demolish') return;
    const placement = game.placementPreview?.();
    const road = game.roadPreview?.();
    if (!placement && !road) {
      feedback.clear();
      return;
    }
    let html = '';
    const row = (label: string, ok: boolean | null, reason: string) =>
      markup`<div class="placement-check ${ok === false ? 'failed' : ok === null ? 'unknown' : 'passed'}"><b>${ok === false ? '✖ ' : ok === null ? '— ' : '✓ '}${label}</b><span>${reason}</span></div>`;
    if (placement) {
      const { checks, spending } = placement;
      html = markup`<h3>${game.BSPEC[(game.mode as { bt: BuildingType }).bt].name} · ${placement.canBuild ? 'Ready to build' : 'Cannot build here'}</h3>`;
      html += row(
        'Terrain & spacing',
        checks.terrain.ok,
        game.placementText(checks.terrain.reason) || 'Suitable ground and spacing',
      );
      html += row(
        'Ownership',
        checks.ownership.ok,
        game.placementText(checks.ownership.reason) || 'Site and required neighbors are owned',
      );
      html += row(
        'Nearby resources',
        checks.resources.ok,
        game.placementText(checks.resources.reason) ||
          (game.BSPEC[(game.mode as { bt: BuildingType }).bt].resKind ||
          ['quarry', 'fisherman'].includes((game.mode as { bt: BuildingType }).bt)
            ? 'Required nearby resources are present'
            : 'No nearby-resource construction requirement'),
      );
      html += row(
        'Affordability',
        spending.affordable,
        spending.affordable
          ? 'Enough spendable stock in reachable storage'
          : 'Required goods are missing from reachable storage',
      );
      html += markup`<div class="placement-materials">${trusted(
        spending.materials
          .map(
            (material) =>
              markup`<span>${material.required} ${game.GOODS[material.good].name}: ${material.free} free${
                material.optionalTransfers
                  ? ' + ' + material.optionalTransfers + ' optional transfer reservations'
                  : ''
              }</span>`,
          )
          .join(''),
      )}</div>`;
      const reclaim = spending.materials.filter((material) => material.reclaim > 0);
      if (reclaim.length)
        html += markup`<p class="placement-note">${
          placement.canBuild
            ? 'Building here reclaims '
            : 'When placement and the full cost are valid, construction can reclaim '
        }${reclaim
          .map((material) => material.reclaim + ' ' + game.GOODS[material.good].name)
          .join(
            ', ',
          )} from uncollected optional warehouse transfers. Construction and producer-input promises stay protected.</p>`;
      if (placement.operatingSupport)
        html += row(
          'Production support',
          placement.operatingSupport.ok,
          placement.operatingSupport.reason,
        );
      html += markup`<p class="placement-note">${placement.summary}</p>`;
    } else if (road) {
      html = markup`<h3>Road plan · ${road.ok ? road.count + ' new tiles' : 'Cannot pave this route'}</h3>`;
      html += row('Resource cost', true, '0 goods — roads consume no resources');
      html += row(
        'Route & ownership',
        road.ok,
        road.reason ||
          'Only clear owned tiles are paved; occupied or unowned route tiles are skipped',
      );
      if (road.ok)
        html += markup`<p class="placement-note">${road.summary} Hold Shift when choosing an endpoint to continue the plan.</p>`;
    }
    feedback.show(
      html,
      placement ? placement.x + ', ' + placement.y : game.ht.x + ', ' + game.ht.y,
    );
  }
  return { build, updatePlacement };
}
