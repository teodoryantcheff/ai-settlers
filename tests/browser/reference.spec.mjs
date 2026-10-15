import { test, expect } from '@playwright/test';
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
test.setTimeout(90000);
async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
    );
    window.requestAnimationFrame = (callback) => {
      window.__referenceFrame = callback;
      return 0;
    };
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => window.__referenceFrame(1000));
}
test('searchable reference retains native keyboard focus and exact recipes through nested session layers', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#welcome-reference').click();
  const search = page.locator('#reference-search');
  await expect(search).toBeFocused();
  await search.fill('mine');
  await search.press('Space');
  await search.type('coal');
  await expect(search).toHaveValue('mine coal');
  await expect(page.locator('#reference-results')).toContainText('Fish, bread, meat or provisions');
  await expect(page.locator('#reference-results')).not.toContainText('Iron Smelter');
  await search.fill('legacy');
  await page.locator('#reference-topic').selectOption('buildings');
  await expect(page.locator('#reference-results')).toContainText('Iron ore + 1 Coal');
  await expect(page.locator('#reference-results')).toContainText(
    'original wood-and-stone toolsmith',
  );
  await search.fill('water');
  await expect(page.locator('#reference-results')).toContainText('no transported water');
  await page.keyboard.press('Escape');
  await expect(page.locator('#welcome-reference')).toBeFocused();
  await expect(page.locator('#start')).toBeVisible();
  await page.locator('#welcome-about').click();
  await expect(page.locator('#about-body')).toContainText('Version 2.0.0');
  await expect(page.locator('#about-body')).toContainText('Blue Byte');
  await expect(page.locator('#about-body a').first()).toHaveAttribute(
    'href',
    /\/assets\/art\/prompts\.md$/,
  );
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: test.info().outputPath('about-' + width + '.png') });
  }
  await page.keyboard.press('Escape');
  await page.locator('#startb').click();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.paused = false;
    g.updateReferenceContext();
  });
  const headquarters = await page.evaluate(() => {
    const g = window.productionArtPreview.game,
      b = g.anyStorage(),
      rect = g.view.getBoundingClientRect();
    return {
      x: rect.left + ((b.x + 0.5) * g.TS - g.cam.x) * g.z,
      y: rect.top + ((b.y + 0.5) * g.TS - g.cam.y) * g.z,
    };
  });
  await page.mouse.click(headquarters.x, headquarters.y);
  await page.locator('#reference-context summary').click();
  expect(await page.evaluate(() => window.productionArtPreview.game.blockingLayerOpen())).toBe(
    false,
  );
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.time = 10;
    g.updateReferenceContext();
    return { paused: g.state.paused, seed: g.seed, cam: { ...g.cam } };
  });
  await page.locator('#reference-context [data-reference]').click();
  await expect(search).toBeFocused();
  await expect(page.locator('#reference-topic')).toHaveValue('buildings');
  await expect(page.locator('#reference-results')).toContainText('Headquarters');
  await page.locator('#reference-topic').selectOption('controls');
  await search.fill('water');
  await expect(page.locator('#reference-results')).toContainText('No matching reference articles');
  await page.screenshot({ path: test.info().outputPath('reference-no-results-1280.png') });
  await page.locator('#reference-topic').selectOption('all');
  await expect(page.locator('#reference-results')).toContainText('Water is local coverage');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.resize();
      g.draw();
    });
    await page.screenshot({ path: test.info().outputPath('reference-' + width + '.png') });
    await page.locator('#help').evaluate((element) => {
      element.scrollTop = 300;
    });
    const stack = await page.locator('#help').evaluate((element) => {
      const state = element.querySelector('.layer-simulation-state').getBoundingClientRect();
      const search = element.querySelector('.reference-filters').getBoundingClientRect();
      return { stateBottom: state.bottom, searchTop: search.top, rootScroll: window.scrollY };
    });
    expect(stack.searchTop).toBeGreaterThanOrEqual(stack.stateBottom);
    expect(stack.rootScroll).toBe(0);
    await page.screenshot({ path: test.info().outputPath('reference-scrolled-' + width + '.png') });
    await page.locator('#help').evaluate((element) => {
      element.scrollTop = 0;
    });
  }
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { paused: g.state.paused, seed: g.seed, cam: { ...g.cam } };
    }),
  ).toEqual(before);
});

test('loading stages explain artwork work and preserve the playable atomic fallback', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.addInitScript(() => {
    localStorage.setItem('settlers.prefs', JSON.stringify({ quality: 0.75, reducedMotion: true }));
    window.requestAnimationFrame = (callback) => {
      window.__referenceFrame = callback;
      return 0;
    };
  });
  await page.route('**/assets/art/manifest.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.route('**/assets/art/foliage.png', (route) =>
    route.fulfill({ status: 404, body: 'Artwork unavailable' }),
  );
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot-stage')).toContainText('Loading and validating painted artwork');
  await expect(page.locator('[data-boot-stage="3"]')).toHaveAttribute('aria-current', 'step');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: test.info().outputPath('loading-' + width + '.png') });
  }
  release();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => window.__referenceFrame(1000));
  await expect(page.locator('#painted-art-status')).toContainText('Standard artwork is active');
  await page.locator('#painted-art-status summary').click();
  await expect(page.locator('#painted-art-status')).toContainText(
    'incomplete pack was not installed',
  );
  expect(await page.evaluate(() => window.productionArtPreview.game.ART.paintedStatus.state)).toBe(
    'fallback',
  );
  expect(await page.evaluate(() => window.productionRendererStats.backend)).toBe('PixiJS WebGL');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.resize();
      g.draw();
    });
    await page.screenshot({ path: test.info().outputPath('artwork-fallback-' + width + '.png') });
  }
  await page.locator('#painted-art-status [data-reference]').click();
  await expect(page.locator('#reference-results')).toContainText('incomplete painted art pack');
  await page.keyboard.press('Escape');
  await page
    .locator('#painted-art-status')
    .getByRole('button', { name: 'Keep playing with standard artwork' })
    .click();
  await expect(page.locator('#painted-art-status')).toHaveCount(0);
});

test('unavailable WebGL has explicit browser recovery and leaves checkpoints untouched', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('recovery-sentinel', 'keep');
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (/webgl/.test(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#boot-stage')).toContainText('WebGL is required');
  await expect(page.locator('#boot-reload')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('recovery-sentinel'))).toBe('keep');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: test.info().outputPath('webgl-unavailable-' + width + '.png') });
  }
});

test('actual WebGL context loss pauses and exports the preserved live colony even when storage fails', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#startb').click();
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.paused = false;
    g.step(1);
    g.saveCheckpoint('Before graphics failure');
    const before = {
      seed: g.seed,
      rng: g.SR.getState(),
      time: g.state.time,
      ids: g.buildings.map((b) => b.id),
      checkpoints: g.listSaves(),
    };
    Storage.prototype.setItem = function () {
      throw new DOMException('Storage full', 'QuotaExceededError');
    };
    return before;
  });
  expect(
    await page.locator('#pixi-view').evaluate((canvas) => {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const extension = gl.getExtension('WEBGL_lose_context');
      extension.loseContext();
      return !!extension;
    }),
  ).toBe(true);
  await expect(page.locator('#renderer-status')).toBeVisible();
  await expect(page.locator('#recovery-reason')).toContainText('WebGL context lost');
  await expect(page.locator('#renderer-status')).toContainText('cannot retain unsaved memory');
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return {
        paused: g.state.paused,
        seed: g.seed,
        rng: g.SR.getState(),
        time: g.state.time,
        ids: g.buildings.map((b) => b.id),
        checkpoints: g.listSaves(),
      };
    }),
  ).toEqual({ paused: true, ...before });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#recovery-export').click();
  const download = await downloadPromise;
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved.seed).toBe(before.seed);
  expect(saved.b.map((b) => b.id)).toEqual(before.ids);
  expect(saved.st.paused).toBe(true);
  await page.locator('#recovery-reload').click();
  await expect(page.locator('#recovery-reload-confirmation')).toContainText(
    'Reload discards the in-memory colony',
  );
  await page.locator('#recovery-cancel-reload').click();
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: test.info().outputPath('graphics-recovery-' + width + '.png') });
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#renderer-status')).toBeVisible();
});
