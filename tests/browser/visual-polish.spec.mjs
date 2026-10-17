// The ?economyshot scenario and fixed dusk wall time need their own page.
import { test, expect, holdFrames, seedPrefs } from './helpers/test.mjs';

test.setTimeout(60000);

test('illustrated village stays stable in daylight, dusk and compact layouts', async ({
  freshPage: page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await holdFrames(page);
  await seedPrefs(page, { reducedMotion: true, weather: false, quality: 1, clarity: false });
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
  const gold = page.locator('#goods [data-good=gold]');
  await gold.focus();
  await expect(gold).toBeInViewport();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Gold stored stock' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('construction stages and work effects draw without touching the simulation', async ({
  freshPage: page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await holdFrames(page);
  await seedPrefs(page, { reducedMotion: false, weather: false, quality: 1, clarity: false });
  await page.goto('/tests/game.html?devshot&seed=2024');
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
  const result = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    // Walls differ by type from stage 2; stage 3 adds the roof slats.
    for (const [type, progress] of [
      ['guard', 0.5],
      ['farm', 0.6],
      ['warehouse', 0.8],
      ['lumberjack', 0.5],
    ]) {
      const site = game.buildings.find((b) => b.type === type && b.done);
      Object.assign(site, { done: false, constructionProgress: progress });
    }
    for (const b of game.buildings) {
      const spec = game.BSPEC[b.type];
      for (const good in spec.in) b.stock[good] = 3;
    }
    const hq = game.anyStorage();
    game.z = 1;
    game.cam.x = (hq.x + 0.5) * game.TS - game.vw / game.z / 2;
    game.cam.y = (hq.y + 0.5) * game.TS - game.vh / game.z / 2;
    game.clampCam();
    game.state.paused = false;
    const snapshot = () =>
      JSON.stringify({
        tiles: game.tiles,
        buildings: game.buildings,
        units: game.units,
        rng: game.SR.getState(),
      });
    const before = snapshot();
    const time = game.state.time;
    // devshot pins work poses to simulation time; sweep it through every effect phase.
    for (let step = 0; step < 24; step++) {
      game.state.time = time + step * 0.05;
      game.draw();
    }
    game.state.time = time;
    return {
      unchanged: snapshot() === before,
      working: game.buildings.filter((b) => game.buildingWorking(b)).map((b) => b.type),
    };
  });
  expect(result.working).toEqual(expect.arrayContaining(['sawmill', 'armory', 'quarry']));
  expect(result.unchanged).toBe(true);
  expect(errors).toEqual([]);
});
