import { test, expect } from './helpers/test.mjs';

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
test.setTimeout(60000);

test('illustrated village stays stable in daylight, dusk and compact layouts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__polishFrame = callback;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ reducedMotion: true, weather: false, quality: 1, clarity: false }),
    );
  });
  await page.goto('/tests/game.html?economyshot&seed=2024&z=5');
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
  const before = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.selected = null;
    game.selInfo = null;
    game.updateInfo();
    game.hudTick();
    game.gameplayHUD();
    game.resize();
    game.drawMini();
    game.draw();
    return JSON.stringify({
      state: game.state,
      buildings: game.buildings,
      units: game.units,
      cam: game.cam,
    });
  });
  await expect(page.locator('#painted-art-status')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await page.screenshot({ path: test.info().outputPath('village-daylight.png') });
  const after = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.TESTMODE = false;
    performance.now = () => 220000;
    game.draw();
    game.draw();
    return JSON.stringify({
      state: game.state,
      buildings: game.buildings,
      units: game.units,
      cam: game.cam,
    });
  });
  expect(after).toBe(before);
  await page.screenshot({ path: test.info().outputPath('village-dusk.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.presentationPrefs.quality = 0.75;
    game.resize();
    game.draw();
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#goods .gd')).toHaveCount(17);
  await expect(page.locator('#goods .resource-icon')).toHaveCount(17);
  await expect(page.locator('#goods [data-good=planks]')).toHaveAttribute(
    'aria-label',
    'Planks: 48 stored stock. Open resource accounting',
  );
  await page.screenshot({ path: test.info().outputPath('village-mobile.png') });
  const gold = page.locator('#goods [data-good=gold]');
  await gold.focus();
  await expect(gold).toBeInViewport();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Gold stored stock' })).toBeVisible();
  expect(errors).toEqual([]);
});
