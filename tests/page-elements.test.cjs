const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootGame, reportBootError } = require('../src/bootstrap.ts');
const { PAGE_ELEMENT_IDS } = require('../src/ui/dom.ts');
const {
  createGame,
  DEFAULT_MODULES,
  fakeDom,
  fakeElement,
  fakeWindow,
  installGlobals,
} = require('./helpers/game.cjs');

for (const [workspace, module, update, missing] of [
  ['economy', 'economyView', 'updateEconomyView', 'economy-query'],
  ['economy', 'economyView', 'updateEconomyView', 'economy-chain'],
  ['logistics', 'logisticsView', 'updateLogisticsView', 'logistics-stage'],
  ['logistics', 'logisticsView', 'updateLogisticsView', 'logistics-query'],
]) {
  test('a missing report filter names #' + missing, (t) => {
    const dom = fakeDom();
    let removed = false;
    const lookup = dom.document.getElementById;
    dom.document.getElementById = (id) => (removed && id === missing ? null : lookup(id));
    dom.node('workspace-' + workspace).querySelector = (selector) =>
      dom.document.getElementById(selector.slice(1));
    t.after(installGlobals({ document: dom.document, window: fakeWindow().window }));
    const { game } = createGame({
      modules: [...DEFAULT_MODULES, module],
      stubs: { workspace: 'map', registerReportWindow() {} },
    });
    game.initializeColony();
    game.workspace = workspace;
    removed = true;
    assert.throws(() => game[update](), new RegExp('Missing required page element #' + missing));
  });
}

test('a missing interface element stops assembly and the boot alert names its id', (t) => {
  const dom = fakeDom();
  const lookup = dom.document.getElementById;
  dom.document.getElementById = (id) => (id === 'atlas-toggle' ? null : lookup(id));
  dom.node('boot-error-controls').querySelector = () => fakeElement();
  t.after(
    installGlobals({
      document: dom.document,
      window: fakeWindow().window,
      console: { ...console, error() {} },
    }),
  );
  assert.throws(
    () => createGame({ modules: ['workspace'] }),
    (error) => {
      assert.match(error.message, /atlas-toggle/);
      reportBootError(error);
      return true;
    },
  );
  assert.match(dom.node('boot-stage').textContent, /atlas-toggle/);
  assert.equal(dom.node('boot').dataset.stage, 'failed');
  assert.equal(dom.node('boot-progress').hidden, true);
  assert.equal(dom.node('boot-error-controls').hidden, false);
});

for (const missing of [
  'boot',
  'boot-stage',
  'boot-progress',
  'boot-error-controls',
  'boot-reload',
  'boot-error-paragraph',
]) {
  test('boot failure remains visible when ' + missing + ' is absent', (t) => {
    const dom = fakeDom();
    const lookup = dom.document.getElementById;
    dom.document.getElementById = (id) => (id === missing ? null : lookup(id));
    lookup('boot-error-controls').querySelector = () =>
      missing === 'boot-error-paragraph' ? null : fakeElement();
    t.after(installGlobals({ document: dom.document, console: { ...console, error() {} } }));
    assert.doesNotThrow(() =>
      reportBootError(new Error('Missing required page element #' + missing)),
    );
    const fallback = dom.document.body.children.find((node) => node.id === 'boot-failure');
    assert.ok(fallback, 'a replacement alert is mounted without depending on boot markup');
    assert.match(fallback.textContent, new RegExp(missing));
  });
}

test('boot detects a missing control used only on later HUD frames before starting graphics', async (t) => {
  const dom = fakeDom();
  const lookup = dom.document.getElementById;
  dom.document.getElementById = (id) => (id === 'goaltxt' ? null : lookup(id));
  t.after(installGlobals({ document: dom.document, window: fakeWindow().window }));
  await assert.rejects(bootGame(), /Missing required page element #goaltxt/);
  assert.equal(dom.document.documentElement.dataset.renderer, undefined);
});

test('boot reporting retains the live-colony graphics recovery and its export controls', (t) => {
  const dom = fakeDom();
  const lookup = dom.document.getElementById;
  dom.document.getElementById = (id) => (id === 'boot' ? null : lookup(id));
  dom.document.querySelector = (selector) =>
    selector === '#renderer-status:not(.hidden)' &&
    !dom.node('renderer-status').classList.contains('hidden')
      ? dom.node('renderer-status')
      : null;
  dom.node('renderer-status').classList.add('hidden');
  t.after(
    installGlobals({
      document: dom.document,
      window: fakeWindow().window,
      console: { ...console, error() {} },
    }),
  );
  const { game } = createGame({
    modules: ['workspace', 'recovery'],
    stubs: { keys: {}, state: { paused: false, speed: 1 } },
  });
  game.emitGameEvent('rendererFailed', { reason: 'Initial world paint failed' });
  reportBootError(new Error('Initial world paint failed'));
  assert.equal(game.state.paused, true);
  assert.equal(dom.node('renderer-status').classList.contains('hidden'), false);
  assert.match(dom.node('recovery-reason').textContent, /Initial world paint failed/);
  assert.equal(
    dom.document.body.children.some((node) => node.id === 'boot-failure'),
    false,
    'the boot alert must not cover live-colony export recovery',
  );
});

test('every static interface id exists in the page or authored report markup', () => {
  const root = path.resolve(__dirname, '..');
  const files = [
    'src/bootstrap.ts',
    ...['src/ui', 'src/application'].flatMap((directory) =>
      fs
        .readdirSync(path.join(root, directory))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => directory + '/' + name),
    ),
  ];
  const sources = files.map((file) => ({
    file,
    source: fs.readFileSync(path.join(root, file), 'utf8'),
  }));
  const ids = (source) => [...source.matchAll(/\bid="([^"$]+)"/g)].map((match) => match[1]);
  const pageIds = ids(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.equal(
    new Set(PAGE_ELEMENT_IDS).size,
    PAGE_ELEMENT_IDS.length,
    'boot contract has no duplicates',
  );
  assert.deepEqual(
    [...PAGE_ELEMENT_IDS].sort(),
    pageIds.sort(),
    'boot validates the complete authored page',
  );
  const authored = new Set([
    ...pageIds,
    ...sources.flatMap(({ source }) => [
      ...ids(source),
      ...[...source.matchAll(/\.id\s*=\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bjourneyHTML\(['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ]),
  ]);
  const missing = [];
  let lookups = 0;
  for (const { file, source } of sources) {
    // Accept multiline calls and generic element types; concatenated IDs are dynamic.
    const calls = source.matchAll(
      /\b(requireElement|getElementById|querySelector(?:All)?)(?:<[^>]+>)?\(\s*([^()]*)\)/g,
    );
    for (const [, name, expression] of calls) {
      if (name === 'getElementById')
        assert.equal(file, 'src/ui/dom.ts', 'interface lookups use the shared guard');
      const literal = expression.trim().match(/^(['"])([^'"]+)\1(?:\s*,.*)?$/);
      const conditional = expression.includes('?') && expression.includes(':');
      const values = literal
        ? [literal[2]]
        : conditional
          ? [...expression.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
          : [];
      for (let id of values) {
        if (name.startsWith('querySelector')) {
          const match = id.match(/^#([\w-]+)/);
          if (!match) continue;
          id = match[1];
        }
        lookups++;
        if (!authored.has(id)) missing.push(file + ': #' + id);
      }
    }
  }
  assert.ok(lookups > 160, 'the check covers the interface lookups');
  assert.deepEqual(missing, [], 'static lookups must name authored elements');
});
