const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  DEFAULT_MODULES,
  fakeDom,
  fakeElement,
  fakeWindow,
  installGlobals,
  pinClock,
} = require('./helpers/game.cjs');

function interfaceGame(t) {
  const clock = pinClock(1000);
  t.after(clock.restore);
  const dom = fakeDom();
  const { window } = fakeWindow();
  t.after(installGlobals({ document: dom.document, window }));
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'hud'],
    stubs: { view: fakeElement('view'), mini: fakeElement('mini') },
  });
  game.initializeColony();
  return { game, dom };
}

test('building status displays markup characters as text and keeps resource icons', (t) => {
  const { game, dom } = interfaceGame(t);
  const original = game.GOODS.planks.name;
  t.after(() => {
    game.GOODS.planks.name = original;
  });
  game.GOODS.planks.name = '<Planks & "boards">';
  const site = game.newBuilding('sawmill', 51, 48);
  game.buildings.push(site);
  game.selected = site;
  game.updateInfo();
  assert.match(
    dom.node('infobody').innerHTML,
    /Needs 3 more &lt;planks &amp; &quot;boards&quot;&gt;/,
  );
  assert.doesNotMatch(dom.node('infobody').innerHTML, /<planks|<Planks/);
  assert.match(dom.node('infobody').innerHTML, /<svg class="resource-icon"/);
});

test('advisor reasons display markup characters from colony rules as text', (t) => {
  const { game, dom } = interfaceGame(t);
  const original = game.BSPEC.well.rad;
  t.after(() => {
    game.BSPEC.well.rad = original;
  });
  game.BSPEC.well.rad = '6 <well & "service">';
  const bakery = game.newBuilding('bakery', 51, 48);
  Object.assign(bakery, { done: true, prog: 1, blockedReason: 'water' });
  game.buildings.push(bakery);
  assert.equal(game.advisorDecision().action.bt, 'well');
  game.hudTick();
  assert.match(
    dom.node('advrows').innerHTML,
    /within 6 &lt;well &amp; &quot;service&quot;&gt; tiles/,
  );
  assert.doesNotMatch(dom.node('advrows').innerHTML, /<well/);
});

test('reference recipes display goods names as text without changing the recipe wording', (t) => {
  const dom = fakeDom();
  const { window } = fakeWindow();
  t.after(installGlobals({ document: dom.document, window }));
  const { game } = createGame({ seed: 2024, modules: [...DEFAULT_MODULES, 'reference'] });
  game.initializeColony();
  const original = game.GOODS.logs.name;
  t.after(() => {
    game.GOODS.logs.name = original;
  });
  game.GOODS.logs.name = '<Logs & "timber">';
  game.renderReference('building-sawmill');
  const output = dom.node('reference-results').innerHTML;
  assert.match(output, /2 &lt;Logs &amp; &quot;timber&quot;&gt; → 1 Planks\./);
  assert.doesNotMatch(output, /<Logs/);
});

test('resource balance rows remain markup while goods names are displayed as text', (t) => {
  const dom = fakeDom();
  const { window } = fakeWindow();
  t.after(installGlobals({ document: dom.document, window }));
  dom.node('workspace-economy').querySelector = (selector) => dom.node(selector.slice(1));
  dom.node('economy-chain').value = 'all';
  const { game } = createGame({
    seed: 2024,
    modules: [...DEFAULT_MODULES, 'economyView'],
    stubs: { workspace: 'economy', registerReportWindow() {} },
  });
  game.initializeColony();
  const original = game.GOODS.logs.name;
  t.after(() => {
    game.GOODS.logs.name = original;
  });
  game.GOODS.logs.name = '<Logs & "timber">';
  game.updateEconomyView();
  const output = dom.node('economy-balances').innerHTML;
  assert.match(output, /<tr data-economy-good="logs">/);
  assert.match(output, /<svg class="resource-icon"/);
  assert.match(output, /&lt;Logs &amp; &quot;timber&quot;&gt;/);
  assert.doesNotMatch(output, /<Logs/);
});
