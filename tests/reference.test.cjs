const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  DEFAULT_MODULES,
  fakeDom,
  fakeWindow,
  installGlobals,
  pinClock,
} = require('./helpers/game.cjs');
pinClock(0);
function reference() {
  const dom = fakeDom();
  dom.document.baseURI = 'http://localhost/';
  const { window } = fakeWindow();
  installGlobals({ document: dom.document, window });
  const { game } = createGame({ seed: 2024, modules: [...DEFAULT_MODULES, 'reference'] });
  game.initializeColony();
  return { game, dom };
}
test('reference explains actual recipes without changing colony state', () => {
  const { game: g, dom } = reference();
  const before = {
    rng: g.SR.getState(),
    jobs: g.jobs.length,
    stock: JSON.stringify(g.anyStorage().stock),
    owned: g.owned.slice(),
  };
  g.renderReference('buildings');
  const html = dom.node('reference-results').innerHTML;
  assert.match(html, /Fish, bread, meat or provisions/);
  assert.match(html, /Iron bars/);
  assert.match(html, /local water/i);
  assert.match(html, /6 tiles/);
  assert.equal(g.SR.getState(), before.rng);
  assert.equal(g.jobs.length, before.jobs);
  assert.equal(JSON.stringify(g.anyStorage().stock), before.stock);
  assert.deepEqual(g.owned, before.owned);
});

test('About credits the shipped metadata and artwork provenance without changing the colony', () => {
  const { game: g, dom } = reference();
  g.renderAbout();
  const html = dom.node('about-body').innerHTML;
  assert.match(
    html,
    new RegExp('Version ' + require('../package.json').version.replace(/\./g, '\\.')),
  );
  assert.match(html, /Blue Byte/);
  assert.match(html, /PixiJS/);
  assert.match(html, /assets\/art\/prompts\.md/);
  assert.match(html, /built-in image generation tool/);
});

test('provenance links resolve beside a versioned Pages bundle rather than the page root', () => {
  const { game: g, dom } = reference();
  dom.document.baseURI = 'https://settlement.invalid/';
  dom.document.querySelectorAll = () => [
    { src: 'https://settlement.invalid/releases/known/game.min.js' },
  ];
  g.renderAbout();
  const html = dom.node('about-body').innerHTML;
  assert.match(
    html,
    /href="https:\/\/settlement\.invalid\/releases\/known\/assets\/art\/prompts\.md"/,
  );
  assert.match(html, /releases\/known\/assets\/art\/manifest\.json/);
});
