import { test, expect } from '@playwright/test';
import { openAtlas } from './helpers/atlas.mjs';

test.use({
  launchOptions: {
    args: [
      '--enable-webgl',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-accelerated-2d-canvas',
    ],
  },
});
test.setTimeout(120000);

async function boot(page) {
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
    );
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game);
  await page.locator('#startb').click();
  await page.evaluate(() => window.productionArtPreview.game.hudTick());
}

test('Economy reports real stock and honest simulation coverage without changing colony state', async ({
  page,
}) => {
  await boot(page);
  await openAtlas(page);
  await page.getByRole('button', { name: 'Economy', exact: true }).click();
  await expect(page.locator('#economy-coverage')).toContainText('History unavailable');
  const stock = await page.evaluate(() =>
    window.productionArtPreview.game.resourceAccounting('planks'),
  );
  await expect(page.locator('[data-economy-good="planks"]')).toContainText(String(stock.stored));
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    for (let i = 0; i < 600; i++) game.step(1 / 60);
    game.updateEconomyView();
  });
  await expect(page.locator('#economy-coverage')).toContainText('10.0 simulation seconds');
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.locator('#economy-window').selectOption('600');
  await page.locator('#economy-query').fill('plank');
  await page.locator('#economy-balances [data-economy-resource="planks"]').click();
  await expect(page.locator('#economy-detail')).toContainText(
    'Reserved stock is part of stored stock',
  );
  await expect(page.locator('#economy-detail')).toContainText('Construction spending');
  await expect(page.locator('#economy-detail')).toContainText('Output delivered to storage');
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
});

test('real chain drilldowns preserve navigation, show nominal capacity and retain former contributors', async ({
  page,
}) => {
  await boot(page);
  const mill = await page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    for (const type of ['lumberjack', 'sawmill']) {
      let placed = false;
      for (let y = hq.y - 7; y <= hq.y + 7 && !placed; y++)
        for (let x = hq.x - 7; x <= hq.x + 7 && !placed; x++)
          if (game.canPlace(type, x, y)[0]) placed = game.placeBuilding(type, x, y);
      if (!placed) throw new Error('No valid chain location');
    }
    for (let tick = 0; tick < 120 * 60; tick++) game.step(1 / 60);
    const mill = game.buildings.find((building) => building.type === 'sawmill');
    if (!mill.done || !(game.economicWindow('lifetime').totals.produced.planks > 0))
      throw new Error('Real chain did not produce planks');
    game.hudTick();
    return {
      id: mill.id,
      x: mill.x,
      y: mill.y,
      produced: game.economicWindow('lifetime').totals.produced.planks,
      cam: { ...game.cam },
    };
  });
  await page.locator('#goods [data-good="planks"]').press('Enter');
  await expect(page.locator('#economy-detail')).toContainText('Planks · resource detail');
  await page.locator('#economy-window').selectOption('lifetime');
  await page.locator('#economy-chain').selectOption('0');
  await page.locator('#economy-query').fill('plank');
  const camBeforeInspect = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await page.locator(`[data-economy-inspect="${mill.id}"]`).click();
  await expect(page.locator('#info')).toContainText('Sawmill');
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
    camBeforeInspect,
  );
  await page.getByText('Nominal capacity and limiting conditions', { exact: true }).click();
  await expect(page.locator('#economy-detail')).toContainText('7.5 goods/min nominal');
  await expect(page.locator('#economy-detail')).toContainText('not a forecast');
  const capacitySummary = page.getByText('Nominal capacity and limiting conditions', {
    exact: true,
  });
  await capacitySummary.focus();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    for (let tick = 0; tick < 120; tick++) game.step(1 / 60);
    game.updateEconomyView();
  });
  await expect(capacitySummary).toBeFocused();
  await expect(capacitySummary.locator('..')).toHaveAttribute('open', '');
  await expect(page.locator('.economy-history svg')).toHaveAttribute(
    'aria-label',
    /Measured Planks flow history/,
  );
  await openAtlas(page);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await openAtlas(page);
  await page.getByRole('button', { name: 'Economy', exact: true }).click();
  await expect(page.locator('#economy-window')).toHaveValue('lifetime');
  await expect(page.locator('#economy-chain')).toHaveValue('0');
  await expect(page.locator('#economy-query')).toHaveValue('plank');
  await page.locator('#goods [data-good="logs"]').press('Enter');
  await expect(page.locator('#economy-detail')).toContainText('Logs · resource detail');
  await expect(page.locator('#economy-query')).toHaveValue('plank');
  await expect(page.locator('#economy-chain')).toHaveValue('0');
  await page.locator('#economy-balances [data-economy-resource="planks"]').click();
  await page.locator('#economy-query').focus();
  await page.evaluate(() => window.productionArtPreview.game.updateEconomyView());
  await expect(page.locator('#economy-query')).toBeFocused();
  for (const [width, height, quality] of [
    [1440, 900, 1],
    [1280, 720, 0.75],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((quality) => {
      const game = window.productionArtPreview.game;
      game.presentationPrefs.quality = quality;
      game.resize();
      game.draw();
    }, quality);
    await page.locator('#workspace-economy').evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({ path: test.info().outputPath(`economy-overview-${width}.png`) });
    await page
      .locator('#economy-resource-heading')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: test.info().outputPath(`economy-detail-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.locator(`[data-economy-locate="${mill.id}"]`).click();
  await expect(page.locator('#workspace-economy')).toBeHidden();
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).not.toEqual(
    mill.cam,
  );
  await openAtlas(page);
  await page.getByRole('button', { name: 'Economy', exact: true }).click();
  await page.locator(`[data-economy-inspect="${mill.id}"]`).focus();
  const productionBeforeDemolition = await page.evaluate((id) => {
    const game = window.productionArtPreview.game;
    const production = game.economicWindow('lifetime').totals.produced.planks;
    game.demolish(game.byId(id));
    return production;
  }, mill.id);
  await expect(page.locator('#economy-resource-heading')).toBeFocused();
  await expect(page.locator('.economy-former')).toContainText('Contributor removed');
  await expect(page.locator('.economy-former')).toContainText(`(${mill.x}, ${mill.y})`);
  expect(
    await page.evaluate(
      () => window.productionArtPreview.game.economicWindow('lifetime').totals.produced.planks,
    ),
  ).toBe(productionBeforeDemolition);
  await page.getByRole('button', { name: 'Locate former site' }).click();
  await expect(page.locator('#view')).toBeVisible();
});
