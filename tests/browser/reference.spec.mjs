// The welcome screen, failing boots and a lost WebGL context each need their own page.
import { test, expect, frame, holdFrames, load, seedPrefs } from './helpers/test.mjs';
test.setTimeout(90000);
async function boot(page) {
  await seedPrefs(page);
  await holdFrames(page);
  await load(page);
  await frame(page, 1000);
}
test('searchable reference retains native keyboard focus and exact recipes through nested session layers', async ({
  freshPage: page,
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
  // The colony starts at the size the reference sweep below ends on, so the
  // camera comparison measures the reference window alone.
  await page.setViewportSize({ width: 1280, height: 720 });
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

test('loading stages explain artwork work and report an incomplete pack before play', async ({
  freshPage: page,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.addInitScript(() => {
    localStorage.setItem('settlers.prefs', JSON.stringify({ quality: 0.75, reducedMotion: true }));
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
  release();
  await expect(page.locator('#boot')).toHaveAttribute('data-stage', 'failed');
  await expect(page.locator('#boot-stage')).toContainText('Painted artwork could not load');
  await expect(page.locator('#boot-error-controls')).toContainText('Reload to retry');
});

test('unavailable WebGL has explicit browser recovery and leaves checkpoints untouched', async ({
  freshPage: page,
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
});

test('actual WebGL context loss pauses and exports the preserved live colony even when storage fails', async ({
  freshPage: page,
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
  await page.keyboard.press('Escape');
  await expect(page.locator('#renderer-status')).toBeVisible();
});
