import { test, expect } from './helpers/test.mjs';
import { openAtlas } from './helpers/atlas.mjs';

test.setTimeout(120000);

async function paint(page) {
  // HUD updates are intentionally throttled in real time. Await the displayed
  // stock rather than capturing a stale frame after fast fixed-step simulation.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const game = window.productionArtPreview.game;
        game.hudTick();
        return ['logs', 'planks', 'tools'].every(
          (good) =>
            document.querySelector(`#goods [data-good="${good}"] b`)?.textContent ===
            String(game.totalGood(good)),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.updateInfo();
    game.updateHint();
    game.gameplayHUD();
    game.drawMini();
    game.draw();
  });
}
async function capture(page, name) {
  await expect(page.locator('#goods .gd')).toHaveCount(17);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(name + '.png') });
}

test('native first colony carries Journey construction through real deliveries, output and durable reports', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__acceptanceFrame = callback;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 1, reducedMotion: false, weather: true, muted: true }),
    );
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game);
  await page.evaluate(() => window.__acceptanceFrame(1000));
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await page.locator('#startb').click();
  await paint(page);
  await capture(page, 'fresh-map-1440-q1');
  for (const workspace of ['attention', 'activity', 'economy']) {
    await openAtlas(page);
    await page.locator(`#workspace-nav [data-workspace="${workspace}"]`).click();
    await capture(page, `fresh-${workspace}-1440-q1`);
  }
  await expect(page.locator('#economy-coverage')).toContainText('History unavailable');
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="colony"]').click();
  await page.locator('#colony-lesson-build').click();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('lumberjack');
  await page.getByRole('button', { name: 'Cancel tool', exact: true }).press('Enter');
  await page.locator('#paletteb').press('Enter');
  await page.locator('#catalog-search').fill('lumberjack');
  await page.locator('.pb[data-b="lumberjack"]').press('Enter');
  await expect(page.locator('#paletteitems')).toBeHidden();
  const site = await page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    const rect = game.view.getBoundingClientRect();
    // Observe the actual seeded terrain and use the existing camera transform.
    for (let radius = 2; radius <= 7; radius++)
      for (let y = hq.y - radius; y <= hq.y + radius; y++)
        for (let x = hq.x - radius; x <= hq.x + radius; x++) {
          if (!game.canPlace('lumberjack', x, y)[0]) continue;
          const point = {
            x: rect.left + ((x + 0.5) * game.TS - game.cam.x) * game.z,
            y: rect.top + ((y + 0.5) * game.TS - game.cam.y) * game.z,
          };
          if (
            point.x < rect.left + 280 ||
            point.x > rect.right - 180 ||
            point.y < rect.top + 210 ||
            point.y > rect.bottom - 130
          )
            continue;
          let trees = 0;
          for (let ty = y - 6; ty <= y + 6; ty++)
            for (let tx = x - 6; tx <= x + 6; tx++)
              if (
                game.inB(tx, ty) &&
                (tx - x) ** 2 + (ty - y) ** 2 <= 36 &&
                game.tiles[game.idx(tx, ty)].tree >= 3
              )
                trees++;
          if (trees >= 3) return { x, y, point };
        }
    throw Error('No visible natural lumberjack site with mature trees');
  });
  await page.mouse.move(site.point.x, site.point.y);
  await paint(page);
  await expect(page.locator('#placement-feedback')).toContainText('Ready to build');
  await page.mouse.click(site.point.x, site.point.y);
  const id = await page.evaluate(
    ({ x, y }) =>
      window.productionArtPreview.game.buildings.find((b) => b.x === x && b.y === y)?.id,
    site,
  );
  expect(id).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('lumberjack');
  await page.mouse.click(site.point.x, site.point.y);
  await paint(page);
  await expect(page.locator('#placement-feedback')).toContainText('Cannot build here');
  expect(
    await page.evaluate(
      ({ x, y }) =>
        window.productionArtPreview.game.buildings.filter((b) => b.x === x && b.y === y).length,
      site,
    ),
  ).toBe(1);
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.bt)).toBe('lumberjack');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.productionArtPreview.game.mode)).toBeNull();
  await page.mouse.click(site.point.x, site.point.y);
  await expect(page.locator('#infobody')).toContainText('Lumberjack');
  const arrival = await page.evaluate((id) => {
    const game = window.productionArtPreview.game,
      b = game.byId(id);
    for (let i = 0; i < 60 * 60 && !Object.values(b.got).some((v) => v > 0); i++) game.step(1 / 60);
    game.hudTick();
    return { got: Object.values(b.got).reduce((sum, value) => sum + value, 0), done: b.done };
  }, id);
  expect(arrival.got).toBeGreaterThan(0);
  expect(arrival.done).toBe(false);
  await paint(page);
  await expect(page.locator('#infobody')).toContainText(/[1-9]\d* \/ [1-9]\d* delivered/);
  await capture(page, 'first-material-arrival-1440-q1');
  const production = await page.evaluate((id) => {
    const game = window.productionArtPreview.game,
      b = game.byId(id);
    for (let i = 0; i < 180 * 60; i++) {
      game.step(1 / 60);
      const totals = game.economicWindow('lifetime').totals;
      if ((totals.produced.logs || 0) >= 2 && (totals.outputStored.logs || 0) >= 1) break;
    }
    game.hudTick();
    return {
      done: b.done,
      produced: game.economicWindow('lifetime').totals.produced.logs,
      stored: game.economicWindow('lifetime').totals.outputStored.logs,
      stock: game.resourceAccounting('logs').stored,
      milestone: game.state.milestones.includes(0),
      events: game
        .activityHistory()
        .events.filter((e) => e.entity?.id === id)
        .map((e) => e.kind),
    };
  }, id);
  expect(production.done).toBe(true);
  expect(production.produced).toBeGreaterThanOrEqual(2);
  expect(production.stored).toBeGreaterThanOrEqual(1);
  expect(production.stock).toBe(production.stored);
  expect(production.milestone).toBe(true);
  expect(production.events).toEqual(
    expect.arrayContaining(['building-placed', 'building-completed', 'production-started']),
  );
  await page.keyboard.press('v');
  await expect(page.locator('#colony-journey-body')).toContainText('Make your own planks');
  await page.locator('#goods [data-good="logs"]').click();
  await page.locator('#economy-window').selectOption('lifetime');
  await expect(page.locator('#economy-detail')).toContainText('Logs · resource detail');
  await expect(page.locator('#economy-detail')).toContainText('Output delivered to storage');
  await page.locator(`#economy-detail [data-economy-inspect="${id}"]`).click();
  await expect(page.locator('#infobody')).toContainText('Lumberjack');
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="activity"]').click();
  await page.locator('#activity-query').fill('Lumberjack');
  await expect(page.locator('#activity-list')).toContainText('construction started');
  await expect(page.locator('#activity-list')).toContainText('construction completed');
  await expect(page.locator('#activity-list')).toContainText('first observed production');

  for (const [width, height, quality, reducedMotion] of [
    [1440, 900, 1, false],
    [1280, 720, 0.75, true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ({ quality, reducedMotion }) => {
        const game = window.productionArtPreview.game;
        Object.assign(game.presentationPrefs, { quality, reducedMotion, weather: !reducedMotion });
        game.resize();
      },
      { quality, reducedMotion },
    );
    for (const workspace of ['activity', 'attention', 'economy', 'logistics', 'colony', 'map']) {
      await openAtlas(page);
      await page.locator(`#workspace-nav [data-workspace="${workspace}"]`).click();
      if (workspace !== 'map')
        await page
          .locator(`#workspace-${workspace}`)
          .evaluate((element) => (element.scrollTop = 0));
      await paint(page);
      await capture(page, `first-colony-${workspace}-${width}-q${quality}`);
    }
  }
  // Cross-quality map canaries use the same colony and camera, without advancing its world.
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  for (const [width, height, quality] of [
    [1280, 720, 1],
    [1440, 900, 0.75],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((quality) => {
      const game = window.productionArtPreview.game;
      game.presentationPrefs.quality = quality;
      game.resize();
    }, quality);
    await paint(page);
    await capture(page, `cross-quality-map-${width}-q${quality}`);
  }
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  expect(errors).toEqual([]);
});
