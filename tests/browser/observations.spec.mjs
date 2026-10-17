import { test, expect } from './helpers/test.mjs';

test.setTimeout(60000);

test('real production inspector exposes ten-minute coverage and reconciled colony stock', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__observationFrame = callback;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
    );
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click();
  const evidence = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const hq = game.anyStorage();
    for (const type of ['lumberjack', 'sawmill']) {
      let placed = false;
      for (let y = hq.y - 7; y <= hq.y + 7 && !placed; y++)
        for (let x = hq.x - 7; x <= hq.x + 7 && !placed; x++)
          if (game.canPlace(type, x, y)[0]) placed = game.placeBuilding(type, x, y);
      if (!placed) throw new Error('No valid construction location');
    }
    for (let tick = 0; tick < 120 * 60; tick++) game.step(1 / 60);
    const mill = game.buildings.find((b) => b.type === 'sawmill');
    if (!mill.done) throw new Error('Real material deliveries did not finish construction');
    game.selectMapTarget(mill, { x: mill.x, y: mill.y });
    game.hudTick();
    game.draw();
    return {
      covered: game.economicWindow(600).elapsed,
      stored: game.resourceAccounting('planks').stored,
    };
  });
  expect(evidence.covered).toBeGreaterThan(119.9);
  await page.locator('[data-rate-window]').selectOption('600');
  await expect(page.locator('[data-rate-window]')).toHaveValue('600');
  await expect(page.locator('#infobody')).toContainText('arrived at storage');
  await page.getByText('Colony resource accounting', { exact: true }).click();
  await expect(page.locator('.production-accounting')).toContainText(`Stored ${evidence.stored}`);
  await expect(page.locator('.production-accounting')).toContainText('part of stored');
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
    await expect(page.locator('[data-rate-window]')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`observations-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
