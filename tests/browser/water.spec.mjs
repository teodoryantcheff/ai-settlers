import { test, expect } from './helpers/test.mjs';
test.use({ viewport: { width: 1200, height: 850 } });
test.setTimeout(60000);

test('painted water keeps the shoreline and simulation stable across motion and quality settings', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 1, reducedMotion: true, weather: false }),
    );
  });
  await page.goto('/tests/game.html?capture&seed=2024');
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    document.getElementById('start').classList.add('hidden');
    for (const id of ['adv', 'palette', 'mini', 'hint', 'msgs'])
      document.getElementById(id).style.display = 'none';
    g.state.paused = true;
    g.hudTick();
    g.gameplayHUD();
    g.resize();
    g.z = 1.7;
    g.cam.x = 29.5 * g.TS - g.vw / g.z / 2;
    g.cam.y = 28.5 * g.TS - g.vh / g.z / 2;
    g.clampCam();
    g.draw();
    return JSON.stringify({ tiles: g.tiles, state: g.state, cam: g.cam });
  });
  await expect(page.locator('#painted-art-status')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('painted-water.png') });
  const after = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.presentationPrefs.reducedMotion = false;
    performance.now = () => 6000;
    g.draw();
    performance.now = () => 9000;
    g.draw();
    g.presentationPrefs.quality = 0.75;
    g.presentationPrefs.reducedMotion = true;
    g.resize();
    g.draw();
    return JSON.stringify({ tiles: g.tiles, state: g.state, cam: g.cam });
  });
  expect(after).toBe(before);
  await page.screenshot({ path: test.info().outputPath('painted-water-low-quality.png') });
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  expect(errors).toEqual([]);
});
