import { test, expect, frame } from './helpers/test.mjs';
test.setTimeout(120000);
// Paused, so frames redraw placement feedback without advancing the colony. The
// catalog runs on a live frame loop, as players see it; only the visual fixture
// below submits explicit frames.
async function begin(page, live = true) {
  await page.locator('#sp0').press('Enter');
  if (live)
    await page.evaluate(() => {
      window.__liveFrames = setInterval(() => window.__frame(performance.now()), 16);
    });
  await draw(page);
}
test.afterEach(({ page }) => page.evaluate(() => clearInterval(window.__liveFrames)));
async function draw(page) {
  await frame(page, await page.evaluate(() => performance.now()));
}
// Queued after transient help's 120 ms leave timer, so it runs once that has fired.
function afterLeaveTimer(page) {
  return page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)));
}
test('catalog search exposes recipe alternatives and placement requirements before choosing a tool', async ({
  page,
}) => {
  await begin(page);
  await page.locator('#paletteb').press('Enter');
  await expect(page.locator('#catalog-search')).toBeVisible();
  await page.locator('#catalog-search').fill('gold');
  const mine = page.locator('.pb[data-b="mine_gold"]');
  await expect(mine).toBeVisible();
  await mine.focus();
  const details = page.getByRole('tooltip').filter({ hasText: 'Fish, bread, meat or provisions' });
  await expect(details).toBeVisible();
  await expect(details).toContainText('mountain');
  await expect(details).toContainText('3 Planks');
  await expect(page.locator('.pb[data-b="farm"]')).toBeHidden();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode)).toBeNull();
  await mine.press('Enter');
  await expect(page.locator('#paletteitems')).toBeHidden();
  await expect(page.locator('#paletteb')).toBeFocused();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('mine_gold');
});

async function choose(page, type) {
  await page.locator('#paletteb').press('Enter');
  await page.locator('#catalog-search').fill('');
  await page.locator('#catalog-chain').selectOption('all');
  await page.locator(`.pb[data-b="${type}"]`).press('Enter');
}
async function move(page, x, y) {
  const point = await page.evaluate(
    ({ x, y }) => {
      const g = window.productionArtPreview.game;
      const r = g.view.getBoundingClientRect();
      return {
        x: r.left + ((x + 0.5) * g.TS - g.cam.x) * g.z,
        y: r.top + ((y + 0.5) * g.TS - g.cam.y) * g.z,
      };
    },
    { x, y },
  );
  await page.mouse.move(point.x, point.y);
  await draw(page);
  return point;
}
async function clearSites(page) {
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.tiles = g.tiles.map((tile) => ({ ...tile }));
    for (let y = 46; y <= 52; y++)
      for (let x = 49; x <= 56; x++) {
        Object.assign(g.tiles[g.idx(x, y)], { t: g.GRASS, tree: 0, rock: null, deposit: null });
        g.owned[g.idx(x, y)] = 1;
        g.emitGameEvent('tileChanged', { index: g.idx(x, y) });
      }
  });
}

test('placement distinguishes spatial permission from affordability and keeps repeat building efficient', async ({
  page,
}) => {
  await begin(page);
  await clearSites(page);
  await page.evaluate(() => {
    window.productionArtPreview.game.anyStorage().stock = { planks: 2, stone: 3, tools: 1 };
  });
  await choose(page, 'farm');
  const point = await move(page, 51, 48);
  await expect(page.locator('#placement-feedback')).toContainText('Cannot build here');
  await expect(page.locator('#placement-feedback')).toContainText('Suitable ground and spacing');
  await expect(page.locator('#placement-feedback')).toContainText(
    'Required goods are missing from reachable storage',
  );
  await expect(page.locator('#placement-feedback')).toContainText('3 Planks: 2 free');
  await page.mouse.click(point.x, point.y);
  expect(
    await page.evaluate(
      () => window.productionArtPreview.game.buildings.filter((b) => b.type === 'farm').length,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    window.productionArtPreview.game.anyStorage().stock.planks = 3;
  });
  await expect(page.locator('#placement-feedback')).toContainText('Ready to build');
  await page.mouse.click(point.x, point.y);
  const second = await move(page, 54, 48);
  await page.mouse.click(second.x, second.y);
  expect(
    await page.evaluate(
      () => window.productionArtPreview.game.buildings.filter((b) => b.type === 'farm').length,
    ),
  ).toBe(2);
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('farm');
});

test('road plans show zero resource cost and rejection evidence before committing', async ({
  page,
}) => {
  await begin(page);
  await clearSites(page);
  await choose(page, 'road');
  const start = await move(page, 49, 50);
  await page.mouse.click(start.x, start.y);
  const end = await move(page, 52, 50);
  await expect(page.locator('#placement-feedback')).toContainText('4 new tiles');
  await expect(page.locator('#placement-feedback')).toContainText('0 goods');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.roadsBuilt)).toBe(0);
  await page.mouse.click(end.x, end.y);
  expect(await page.evaluate(() => window.productionArtPreview.game.state.roadsBuilt)).toBe(4);
  const next = await move(page, 49, 51);
  await page.mouse.click(next.x, next.y);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    Object.assign(g.tiles[g.idx(52, 51)], { t: g.WATER, tree: 0, rock: null, deposit: null });
    g.emitGameEvent('tileChanged', { index: g.idx(52, 51) });
  });
  await move(page, 52, 51);
  await expect(page.locator('#placement-feedback')).toContainText('Cannot pave this route');
  await expect(page.locator('#placement-feedback')).toContainText('No walking route');
});

test('catalog and placement feedback remain legible at both desktop sizes', async ({ page }) => {
  test.setTimeout(180000);
  await begin(page, false);
  await clearSites(page);
  for (const [width, height, quality, motion] of [
    [1440, 900, '1', false],
    [1280, 720, '0.75', true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.keyboard.press('Escape');
    if (!(await page.locator('#utility').evaluate((node) => node.open)))
      await page.locator('#utility summary').click();
    await page.locator('#mixb').click();
    await page.locator('#qualitypref').selectOption(quality);
    await page.locator('#motionpref').setChecked(motion);
    await page.keyboard.press('Escape');
    await page.locator('#paletteb').press('Enter');
    await page.locator('#catalog-search').fill('');
    await page.locator('#catalog-chain').selectOption('all');
    const palette = await page.locator('#palette').boundingBox();
    const atlas = await page.locator('#atlas-toggle').boundingBox();
    expect(palette.y).toBeGreaterThanOrEqual(atlas.y + atlas.height + 8);
    await draw(page);
    await page.locator('#catalog-chain').selectOption('Timber & stone');
    await page.locator('.pb[data-b="lumberjack"]').focus();
    await expect(page.locator('#catalog-detail-lumberjack')).toBeVisible();
    await draw(page);
    await page.locator('#catalog-chain').selectOption('all');
    await page.locator('.pb[data-b="farm"]').press('Enter');
    await page.evaluate(() => {
      window.productionArtPreview.game.anyStorage().stock = { planks: 2, stone: 3, tools: 1 };
    });
    await move(page, 51, 48);
    await expect(page.locator('#placement-feedback')).toContainText('Cannot build here');
    const feedback = await page.locator('#placement-feedback').boundingBox();
    const minimap = await page.locator('#minimap-panel').boundingBox();
    expect(feedback.y + feedback.height).toBeLessThanOrEqual(minimap.y - 8);
    await draw(page);
    await page.evaluate(() => {
      window.productionArtPreview.game.anyStorage().stock.planks = 3;
    });
    await draw(page);
    await expect(page.locator('#placement-feedback')).toContainText('Ready to build');
    await draw(page);
  }
});

test('the compact palette presents five illustrated choices per row and retains filters after selection', async ({
  page,
}) => {
  await begin(page);
  await page.locator('#paletteb').press('Enter');
  const cards = page.locator('#paletteitems .pb');
  await expect(cards).toHaveCount(23);
  const firstRow = await cards.evaluateAll((cards) =>
    cards.slice(0, 5).map((card) => {
      const r = card.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    }),
  );
  expect(new Set(firstRow.map((card) => card.y)).size).toBe(1);
  expect(new Set(firstRow.map((card) => card.x)).size).toBe(5);
  expect(firstRow.every((card) => card.width >= 76)).toBe(true);
  await page.locator('#catalog-chain').selectOption('Food & brewing');
  await page.locator('#catalog-search').fill('grain');
  await expect(page.locator('.pb[data-b="farm"]')).toBeVisible();
  await expect(page.locator('.pb[data-b="lumberjack"]')).toBeHidden();
  await page.locator('.pb[data-b="farm"]').press('Enter');
  await expect(page.locator('#paletteitems')).toBeHidden();
  await expect(page.locator('#paletteb')).toBeFocused();
  await page.locator('#paletteb').press('Enter');
  await expect(page.locator('#catalog-search')).toHaveValue('grain');
  await expect(page.locator('#catalog-chain')).toHaveValue('Food & brewing');
});

test('ordinary play hides permanent instructions and active construction offers explicit cancellation', async ({
  page,
}) => {
  await begin(page);
  await expect(page.locator('#hint')).toBeHidden();
  await choose(page, 'farm');
  await expect(page.locator('#hint')).toBeVisible();
  await expect(page.locator('#hint')).toContainText('Farm');
  await page.locator('#paletteb').press('Enter');
  await expect(page.locator('#hint')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel tool', exact: true }).press('Enter');
  await expect(page.locator('#hint')).toBeHidden();
  await expect(page.locator('#paletteb')).toBeFocused();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode)).toBeNull();
});

test('placement evidence remains readable under its pointer and cannot issue a hidden map command', async ({
  page,
}) => {
  await begin(page);
  await clearSites(page);
  await choose(page, 'farm');
  await move(page, 51, 48);
  const feedback = page.locator('#placement-feedback');
  await expect(feedback).toContainText('Ready to build');
  const box = await feedback.boundingBox();
  await page.evaluate(() => {
    window.__feedbackCommands = 0;
    const g = window.productionArtPreview.game;
    g.gameEvents.on('placementRejected', () => window.__feedbackCommands++);
    g.gameEvents.on('buildingPlaced', () => window.__feedbackCommands++);
  });
  await page.mouse.move(box.x + box.width / 2, box.y + 24);
  await expect(feedback.locator('.placement-snapshot')).toBeVisible();
  await expect(feedback).toContainText('Snapshot from last map position');
  await page.mouse.click(box.x + box.width / 2, box.y + 24);
  expect(await page.evaluate(() => window.__feedbackCommands)).toBe(0);
  await expect(feedback).toBeVisible();
  const camera = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await feedback.focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(camera);
  await move(page, 54, 48);
  await expect(feedback.locator('.placement-snapshot')).toBeHidden();
  await expect(feedback).toBeVisible();
});

test('demolition feedback keeps precise snapshots and still requires the actual building confirmation', async ({
  page,
}) => {
  await begin(page);
  await clearSites(page);
  await choose(page, 'farm');
  const point = await move(page, 51, 48);
  await page.mouse.click(point.x, point.y);
  await choose(page, 'demolish');
  await move(page, 51, 48);
  const feedback = page.locator('#placement-feedback');
  await expect(feedback).toContainText('Refund:');
  await expect(feedback).toContainText('Local stock salvage:');
  await expect(feedback).toContainText('Territory lost:');
  const box = await feedback.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await expect(feedback.locator('.placement-snapshot')).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + 20);
  await expect(page.locator('#demolition-dialog')).toBeHidden();
  await expect(feedback).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#demolition-dialog')).toBeVisible();
  await expect(page.locator('#demolition-evidence')).toContainText('Construction refund');
  await page.locator('#demolition-confirm').press('Enter');
  expect(
    await page.evaluate(
      () => window.productionArtPreview.game.buildings.filter((b) => b.type === 'farm').length,
    ),
  ).toBe(0);
});

test('catalog explanations permit pointer reading, consume Escape first and cannot place on the map', async ({
  page,
}) => {
  await begin(page);
  await choose(page, 'farm');
  await page.locator('#paletteb').press('Enter');
  await page.locator('#catalog-search').fill('gold');
  const mine = page.locator('.pb[data-b="mine_gold"]');
  await mine.focus();
  const popup = page.locator('#catalog-detail-mine_gold');
  await expect(popup).toBeVisible();
  await expect(mine).toHaveAttribute('aria-describedby', 'catalog-detail-mine_gold');
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  const box = await popup.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.locator('#catalog-search').focus();
  await afterLeaveTimer(page);
  await expect(popup).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('farm');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(page.locator('#paletteitems')).toBeVisible();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('farm');
});

test('adjacent Help offers current-tool instructions and opens the existing full reference', async ({
  page,
}) => {
  await begin(page);
  await choose(page, 'farm');
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.focus();
  await expect(page.locator('#map-help-popup')).toBeVisible();
  await expect(page.locator('#map-help-copy')).toContainText('keep clicking to repeat');
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-help-popup')).toBeHidden();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('farm');
  await help.press('Enter');
  await expect(page.locator('#help')).toBeVisible();
  await expect(page.locator('#reference-results')).toContainText(
    'Map, keyboard and navigation controls',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
  await expect(help).toBeFocused();
});

test('changing catalog filters dismisses explanations for entries that leave the results', async ({
  page,
}) => {
  await begin(page);
  await page.locator('#paletteb').press('Enter');
  await page.locator('#catalog-search').fill('gold');
  const mine = page.locator('.pb[data-b="mine_gold"]');
  const popup = page.locator('#catalog-detail-mine_gold');
  await mine.focus();
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.locator('#catalog-search').fill('grain');
  await expect(mine).toBeHidden();
  await expect(popup).toBeHidden();
  await expect(page.locator('.pb[data-b="farm"]')).toBeVisible();
});

test('keyboard report opening dismisses catalog help while its pointer stays over the popup', async ({
  page,
}) => {
  await begin(page);
  await page.locator('#paletteb').press('Enter');
  await page.locator('#catalog-search').fill('gold');
  await page.locator('.pb[data-b="mine_gold"]').focus();
  const popup = page.locator('#catalog-detail-mine_gold');
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Colony window', exact: true })).toBeVisible();
  await expect(popup).toBeHidden();
});
