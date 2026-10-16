import { html as markup, trusted, formatGoods } from './markup.ts';
import { artworkAssetURL } from '../rendering/painted-assets.ts';
import type { GameRuntime } from '../runtime.ts';
import type { BuildingType, Good } from '../types.ts';
import { recipeRequirements, edibleGoods } from '../gameplay/production-rules.ts';
import { buildingPurposes } from './catalog-view.ts';
import { resourceIcon } from './resource-icons.ts';

interface Article {
  id: string;
  topic: string;
  title: string;
  body: string;
}

/** Search and contextual copy read the same specs and recipe rules as simulation. */
export function createReferenceView(game: GameRuntime): ReferenceViewSubsystem {
  const search = document.getElementById('reference-search') as HTMLInputElement;
  const topic = document.getElementById('reference-topic') as HTMLSelectElement;
  const results = document.getElementById('reference-results');
  let articles: Article[] = [];
  function buildingArticle(type: BuildingType): Article {
    const spec = game.BSPEC[type];
    const recipe =
      spec.prod === 'mine'
        ? `Fish, bread, meat or provisions: consume 1 of any → 1 ${game.GOODS[spec.out].name}. The best-stocked meal is chosen; grain, flour, pigs and beer are not mine meals.`
        : spec.in
          ? `${formatGoods(game.GOODS, recipeRequirements({ type }, spec), { empty: 'None' })} → 1 ${game.GOODS[spec.out].name}.`
          : spec.out
            ? `${spec.prod === 'gather' ? '2' : '1'} ${game.GOODS[spec.out].name} per successful local work cycle.`
            : type === 'well'
              ? 'Local water support; no transported water inventory.'
              : type === 'forester'
                ? 'Plants saplings for future harvesting; no transported output.'
                : 'No production recipe.';
    let requirements =
      type === 'fisherman'
        ? 'Grass or sand with water within 2 tiles.'
        : 'Owned meadow; keep about 2 tiles between buildings.';
    if (type !== 'hq') requirements += ' The site and passable neighboring tiles must be owned.';
    if (spec.resKind)
      requirements += ` Must border a mountain with a remaining ${game.GOODS[spec.resKind].name} deposit.`;
    if (type === 'quarry') requirements += ` Rocks within ${spec.rad} tiles supply work.`;
    if (type === 'lumberjack')
      requirements += ` Mature trees within ${spec.rad} tiles supply work.`;
    if (spec.water)
      requirements +=
        ' Production needs a completed, working, connected well within 6 tiles. Water is local coverage, never carried cargo.';
    let extra = '';
    if (type === 'armory')
      extra = markup`<p><strong>Retained legacy armory recipe:</strong> ${formatGoods(game.GOODS, recipeRequirements({ type, legacyIndustry: true }, spec), { empty: 'None' })} → 1 Weapons. Existing migrated armories keep this recipe; new armories use iron bars. ${game.buildings.filter((b) => b.type === 'armory' && b.legacyIndustry).length} retained legacy armories in this colony.</p>`;
    if (type === 'workshop' || type === 'toolsmith')
      extra +=
        '<p>Legacy toolsmith migration: older saves migrate the original wood-and-stone toolsmith into the basic Workshop, preserving stock, delivered materials, timers and pickups. The current Toolsmith uses iron bars and planks.</p>';
    if (spec.prod === 'mine')
      extra +=
        '<p>Legacy provisions remain an eligible meal. Different stocked food types can improve mining speed; inspect actual food variety and measured output separately.</p>';
    if (type === 'guard')
      extra += markup`<p>Unmanned outposts claim up to ${Math.min(spec.rad, 3)} tiles of land radius. A soldier expands this to ${spec.rad}. Territory follows an orthogonal flood through traversable land; water and mountains restrict it. A queued deployment is not a walking soldier.</p>`;
    const purpose =
      type === 'hq'
        ? 'Starting storage and colony center. Headquarters demolition is protected.'
        : type === 'guard'
          ? 'Claims land, with a larger territory after a soldier arrives.'
          : buildingPurposes[type] || '';
    return {
      id: 'building-' + type,
      topic: 'buildings',
      title: spec.name,
      body: markup`<p>${purpose}</p><dl><dt>Construction goods</dt><dd>${formatGoods(game.GOODS, spec.cost, { empty: 'None' })}</dd><dt>Recipe / output</dt><dd>${recipe}</dd><dt>Placement and work</dt><dd>${requirements}</dd></dl>${trusted(spec.time && (spec.prod === 'craft' || spec.prod === 'mine') ? markup`<p>Base nominal recipe cycle: ${spec.time} simulation seconds. Production upgrades reduce cycle time; input, ${spec.water ? 'local water, ' : ''}reserve and output limits still apply. Nominal capacity is not a forecast. Economy shows current capacity and measured rates separately.</p>` : '')}${trusted(extra)}`,
    };
  }
  function collect(): Article[] {
    const articles: Article[] = [
      {
        id: 'resources',
        topic: 'resources',
        title: 'Resource accounting and measurements',
        body: '<p>Stored includes Reserved; Available subtracts these promises. Do not add reservations to physical goods again. Producer input stock, output awaiting collection, collected cargo and materials delivered to construction sites are separate locations.</p><p>Queued work and assignment are not goods in transit. Optional uncollected warehouse-transfer reservations can be reclaimed by eligible spending; construction and ingredient promises stay protected. Placement shows exactly how much can be reclaimed.</p><p>Rates use goods per simulation minute, independently of speed. Windows cover 30 seconds, 2 minutes, 10 minutes or recorded lifetime. Actual covered time is shown; missing history is unavailable, not zero. Ten minutes of recent samples and lifetime colony totals survive saves and demolition. Paused, hidden and offline time add no simulated history. Internal transfers never create goods.</p>',
      },
      {
        id: 'transport',
        topic: 'transport',
        title: 'Transport, carriers and arrival evidence',
        body: '<p>Queued: no carrier assigned. Assigned: a live carrier is approaching pickup. Carrying: a good has been collected and is physically in transit. Arrived: the good reached its destination. Assignment records without a matched live carrier have unavailable evidence.</p><p>Construction and producer-input jobs use supplies from connected storage. Producers hold output until carriers collect it. Storage delivery destinations may be chosen after pickup. Warehouse targets request transfers from other connected stores; zero means no request.</p><p>Logistics shows current recorded paths and carrier positions. Historical routes and measured arrival times are unavailable; an active path cannot prove a historical delay or predict an ETA. Roads speed travel; clear ground and a connected walking route are required to plan one.</p>',
      },
      {
        id: 'diagnosis',
        topic: 'diagnosis',
        title: 'Diagnose a shortage or stalled chain',
        body: '<p>Inspect the building first: required local stock, eligible ingredients, local water, remaining natural resources, output waiting for collection and intentional pause. Distinguish absent supply from existing delivery work. A free colony stock total alone does not prove a reachable source or scheduled arrival.</p><p>Follow the resource in Economy to actual producers and consumers, then Logistics to queued, assigned and carrying work. Inspect preserves the camera; Locate deliberately moves to the map. Brief waits, satisfied demand, reserved construction supplies and manual production pauses are ordinary conditions, not persistent alarms.</p><p>Attention gathers sustained unresolved conditions with evidence and possible actions; recovery remains in Activity. Unknown coverage, deleted contributors and missing carrier evidence are stated explicitly. Reaching victory does not stop ordinary management or issue diagnosis.</p>',
      },
      {
        id: 'expansion',
        topic: 'expansion',
        title: 'Territory, construction and demolition',
        body: `<p>Completed buildings claim land through an orthogonal flood over traversable ground. Outposts claim a smaller radius until a soldier arrives; water and mountains block the flood. Headquarters are always protected. Storage demolition requires at least two completed stores before any storage structure can be removed; an unfinished warehouse is also protected while only the headquarters is complete.</p><p>Placement separates terrain, ownership, nearby resources and reachable storage affordability. Construction priority changes which work is urgent. A site must receive all required goods before builders advance its progress.</p><p>Demolition is deliberate: review exact per-resource rounded-down half completed construction cost, or half materials actually delivered to an unfinished site. Local stock is salvaged separately. The quote names the receiving storage, soldier/equipment return and actual territory loss. Shift+click immediately applies the visible hovered-target or inspector consequences.</p>`,
      },
      {
        id: 'progression',
        topic: 'progression',
        title: 'Gold, Journey, contracts and upgrades',
        body: markup`<p>Bank ${game.GOAL} gold to reach the colony objective. Produced gold waiting at a mine is not yet banked. Carriers deliver it to completed storage; moving gold between warehouses does not earn it again.</p><p>Journey introduces timber, food, expansion and mining. Colony groups optional contracts, gold-funded hauling/production upgrades and autoplay. Spending gold delays the treasury objective; costs and rewards are shown before the action. Upgrades change nominal capacity or movement rather than rewriting recorded output.</p><p>After victory, Continue Colony keeps production, reports and management available. Return Home keeps the live colony for Continue. Named checkpoints and a separate autosave preserve deliberate recovery points.</p>`,
      },
      {
        id: 'controls',
        topic: 'controls',
        title: 'Map, keyboard and navigation controls',
        body: '<p>Left-click to inspect or place the current building. Repeat placement stays active until canceled. Right-drag or arrow keys pan; the wheel zooms around the pointer. Right-click or Escape cancels the current map tool. Roads use start/end clicks; Shift+click chains waypoints.</p><p>Space pauses or resumes. Use the visible speed buttons for 1×, 2×, 4× or 8×. V opens or toggles Advisor and Journey guidance in Colony; H opens reference. P toggles autoplay and M toggles mute. On Map, F selects the next flagged building; G or Home centers headquarters; WASD also pans and +/− zooms. The 1, 2, 4 and 8 keys select a speed and resume simulation. Tab and Shift+Tab move through controls; Enter/Space activate native buttons. Typing, arrow navigation and Space in inputs/selects retain native behavior; modified browser shortcuts remain available.</p><p>Workspace changes preserve camera and selected contributors, and cancel pending placement when leaving Map. Economy/Logistics and compact explanations stay live. Full reference, saves, settings, About and replacement confirmations suspend simulation without changing your manual pause choice. Escape closes the nearest dismissible layer and restores focus.</p>',
      },
      {
        id: 'settings',
        topic: 'settings',
        title: 'Settings, rendering quality and recovery',
        body: '<p>Gameplay/interface groups simulation speed and guidance. Visual/accessibility groups Reduced Motion, weather, Visual clarity and rendering quality 1 or 0.75. Audio groups mute, music and individual volumes; essential notices remain visible while muted.</p><p>Choices apply immediately and report whether browser storage remembered them. Preferences and saved-colony checkpoints are separate. Save/import failures preserve the previous valid checkpoint or live colony. JSON export of the current colony does not require browser storage.</p><p>Native WebGL is required; there is no Canvas world fallback. Graphics failure pauses play and preserves the in-memory colony for export before a browser reload. An incomplete painted art pack leaves the existing standard artwork active atomically; gameplay can continue with the same simulation and renderer.</p>',
      },
    ];
    for (const type of Object.keys(game.BSPEC) as BuildingType[])
      articles.push(buildingArticle(type));
    for (const good of Object.keys(game.GOODS) as Good[]) {
      const producers = (Object.keys(game.BSPEC) as BuildingType[])
        .filter((type) => game.BSPEC[type].out === good)
        .map((type) => game.BSPEC[type].name);
      articles.push({
        id: 'resource-' + good,
        topic: 'resources',
        title: game.GOODS[good].name,
        body: markup`<p>${trusted(resourceIcon(good))}${edibleGoods.includes(good) ? 'An edible mine meal. Grain, flour, pigs and beer are not edible mine meals. ' : ''}${good === 'gold' ? 'Banked storage gold funds contracts/upgrades and the objective. ' : ''}Current production sources: ${producers.join(', ') || 'No current producer recipe; retained stocks and rewards can remain valid'}.</p><p>Use Economy for this resource’s physical locations, reservations, covered production/consumption and completed deliveries. Inspect contributors before choosing Locate.</p>`,
      });
    }
    return articles;
  }
  function filter() {
    const query = (search.value || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const chosen = topic.value || 'all';
    const visible = articles.filter(
      (article) =>
        (chosen === 'all' || article.topic === chosen) &&
        query.every((word) =>
          (article.title + ' ' + article.body.replace(/<[^>]*>/g, ' '))
            .toLocaleLowerCase()
            .includes(word),
        ),
    );
    results.innerHTML =
      visible
        .map(
          (article) =>
            markup`<article id="reference-${article.id}" data-reference-article="${article.id}"><h3>${article.title}</h3>${trusted(article.body)}</article>`,
        )
        .join('') ||
      '<p class="empty-state">No matching reference articles. Try a building, ingredient, delivery stage or another topic.</p>';
    document.getElementById('reference-count').textContent = visible.length + ' reference articles';
  }
  function renderReference(article?: string) {
    articles = collect();
    if (article) {
      document.getElementById('help').scrollTop = 0;
      topic.value = article.startsWith('building-')
        ? 'buildings'
        : article.startsWith('resource-')
          ? 'resources'
          : article;
      search.value = '';
      if (article.startsWith('building-'))
        search.value = game.BSPEC[article.slice(9) as BuildingType]?.name || '';
      if (article.startsWith('resource-'))
        search.value = game.GOODS[article.slice(9) as Good]?.name || '';
    }
    filter();
  }
  function renderAbout() {
    const provenance = artworkAssetURL('prompts.md').href,
      manifest = artworkAssetURL().href;
    document.getElementById('about-body').innerHTML =
      markup`<p class="reference-lead">The Settlers — browser tribute · <strong>Version 2.0.0</strong></p><p>A peaceful settlement game about production chains, carriers, roads and the 200-gold objective. An independent browser tribute inspired by The Settlers (1993), Blue Byte; this project is not an official release of the original game.</p><h3>Credits and acknowledgments</h3><p>Game code, procedural source artwork, sound and music are provided by this project. The native WebGL renderer uses PixiJS v8. Painted building, foliage, meadow and mountain artwork was generated with the built-in image generation tool.</p><h3>Artwork provenance</h3><p>The original generated images, style references and exact prompts are included with the project. Crop definitions live in the manifest; runtime installation preserves gameplay footprints and sprite anchors.</p><p><a href="${provenance}" target="_blank" rel="noopener">Read the artwork prompts and provenance</a> · <a href="${manifest}" target="_blank" rel="noopener">Artwork crop manifest</a></p><p>Named colonies are stored in this browser. Export JSON to keep an independent copy.</p>`;
  }
  function updateReferenceContext() {
    const workspace = game.workspace || 'map';
    const b = game.selected;
    const article =
      workspace === 'logistics'
        ? 'transport'
        : workspace === 'economy'
          ? 'resources'
          : workspace === 'colony'
            ? 'progression'
            : workspace === 'attention' || workspace === 'activity'
              ? 'diagnosis'
              : b
                ? 'building-' + b.type
                : 'controls';
    const explanation =
      article === 'resources'
        ? 'Stored includes reserved goods; available subtracts promises. Collected cargo and producer stocks are separate physical locations.'
        : article === 'transport'
          ? 'Assignment is not pickup, and pickup is not arrival. Current paths are evidence; historical delay and arrival time may be unavailable.'
          : article === 'diagnosis'
            ? 'Follow the actual missing input, local water, output stock and carrier evidence before choosing an intervention. Brief and intentional pauses are ordinary conditions.'
            : article === 'progression'
              ? 'Gold spending delays the treasury objective. Optional contracts, upgrades and autoplay remain available as shown in Colony.'
              : b
                ? markup`<p>${
                    b.type === 'guard'
                      ? 'Outposts claim a smaller territory before a soldier arrives.'
                      : buildingPurposes[b.type] || 'Colony storage holds reserved and free goods.'
                  }</p><p>${
                    game.BSPEC[b.type].prod === 'mine'
                      ? 'Mine meals: fish, bread, meat or provisions; one of any.'
                      : game.BSPEC[b.type].in
                        ? 'Actual recipe: ' +
                          formatGoods(game.GOODS, recipeRequirements(b, game.BSPEC[b.type]), {
                            empty: 'None',
                          }) +
                          ' → ' +
                          game.GOODS[game.BSPEC[b.type].out].name +
                          '.'
                        : 'Inspect actual stock, current status and consequences before acting.'
                  }</p>`
                : 'Map and compact explanations remain live. Full utility screens suspend simulation and preserve your manual pause choice.';
    const node = document.getElementById('reference-context-copy');
    const html = markup`${trusted(b && article.startsWith('building-') ? explanation : markup`<p>${explanation}</p>`)}<button type="button" data-reference="${article}">Read the full reference</button>`;
    if (node.innerHTML !== html && !node.contains(document.activeElement)) node.innerHTML = html;
  }
  search.addEventListener('input', filter);
  topic.addEventListener('change', filter);
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-reference]');
    if (button) {
      event.preventDefault();
      game.openReference(button.dataset.reference);
    }
  });
  document.getElementById('helpx').onclick = () => game.closeLayer('help');
  return { renderReference, renderAbout, updateReferenceContext };
}
export interface ReferenceViewSubsystem {
  renderReference: (article?: string) => void;
  renderAbout: () => void;
  updateReferenceContext: () => void;
}
