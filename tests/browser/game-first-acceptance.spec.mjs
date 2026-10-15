import { test, expect } from '@playwright/test';
import { openAtlas, expectMapFocus } from './helpers/atlas.mjs';

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

async function frame(page) {
  await page.evaluate(() => {
    window.__gameFirstTime += 300;
    window.__gameFirstFrame(window.__gameFirstTime);
  });
}
async function usable(control) {
  await expect(control).toBeInViewport();
  expect(
    await control.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
}
async function capture(page, name) {
  await frame(page);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  expect(await page.evaluate(() => window.productionRendererStats.backend)).toBe('PixiJS WebGL');
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  await page.screenshot({ path: test.info().outputPath(name + '.png') });
}

for (const [width, height, quality, reducedMotion] of [
  [1440, 900, 1, false],
  [1440, 900, 0.75, true],
  [1280, 720, 1, true],
  [1280, 720, 0.75, false],
]) {
  test(`combined game surfaces preserve control at ${width} q${quality} motion ${reducedMotion}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      ({ quality, reducedMotion }) => {
        localStorage.setItem(
          'settlers.prefs',
          JSON.stringify({ quality, reducedMotion, muted: true, weather: false }),
        );
        window.__gameFirstTime = 100000;
        performance.now = () => window.__gameFirstTime;
        window.requestAnimationFrame = (callback) => {
          window.__gameFirstFrame = callback;
          return 0;
        };
      },
      { quality, reducedMotion },
    );
    await page.goto('/tests/game.html?seed=2024');
    await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
    await page.waitForFunction(() => window.productionArtPreview?.game);
    await frame(page);
    await page.locator('#startb').press('Enter');
    await page.locator('#sp0').press('Enter');
    await frame(page);
    const hq = await page.evaluate(() => {
      const g = window.productionArtPreview.game,
        hq = g.anyStorage();
      g.inspectContributor(hq.id);
      g.msgs.splice(0);
      for (let i = 0; i < 3; i++)
        g.msg('Headquarters holds the colony supplies. Inspect or open reports while paused.', {
          workspace: 'activity',
          entity: { id: hq.id, type: hq.type, x: hq.x, y: hq.y },
        });
      return hq.id;
    });
    await openAtlas(page);
    await page.locator('#paletteb').press('Enter');
    if (width === 1280 && quality === 1) {
      await page.locator('.pb[data-b="demolish"]').focus();
      await page.setViewportSize({ width: 1440, height: 900 });
      await frame(page);
      await page.setViewportSize({ width, height });
      await frame(page);
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
      await expect(page.locator('#paletteitems')).toBeVisible();
      await page.locator('#catalog-search').focus();
    }
    await frame(page);
    const before = await page.evaluate(() => ({
      cam: { ...window.productionArtPreview.game.cam },
      save: window.productionArtPreview.game.exportSave(),
    }));
    expect(await page.locator('#view').boundingBox()).toEqual({ x: 0, y: 0, width, height });
    await expect(page.locator('#goods [data-good]')).toHaveCount(17);
    for (const control of [
      page.locator('#paletteb'),
      page.locator('#ic'),
      page.locator('#minimap-toggle'),
      page.locator('#utility summary'),
      page.getByRole('button', { name: 'Help', exact: true }),
    ])
      await usable(control);
    for (const mode of ['Normal', 'Routes', 'Workload', 'Resource reach', 'Stalled buildings']) {
      const button = page.getByRole('button', { name: mode, exact: true });
      await button.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await frame(page);
    }
    await page.getByRole('button', { name: 'Normal', exact: true }).press('Enter');
    await expect(page.locator('#paletteitems')).toBeVisible();
    await expect(page.locator('#paletteb')).toHaveAttribute('aria-expanded', 'true');
    await capture(page, `combined-map-${width}-q${quality}`);
    await page.locator('#catalog-search').fill('gold');
    const mine = page.locator('.pb[data-b="mine_gold"]');
    await mine.focus();
    const popup = page.locator('#catalog-detail-mine_gold');
    await expect(popup).toBeVisible();
    const popupBox = await popup.boundingBox();
    await page.mouse.move(popupBox.x + 20, popupBox.y + 30);
    await expect(popup).toBeVisible();
    if (width === 1280 && quality === 1) await capture(page, 'combined-map-popup-1280-q1');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(page.locator('#paletteitems')).toBeVisible();
    await mine.press('Enter');
    expect(await page.evaluate(() => window.productionArtPreview.game.mode.type)).toBe('build');
    await page.locator('#goods [data-good="planks"]').press('Enter');
    expect(await page.evaluate(() => window.productionArtPreview.game.mode)).toBeNull();
    const report = page.getByRole('region', { name: 'Economy window', exact: true });
    await expect(report).toBeVisible();
    await page.locator(`[data-economy-inspect="${hq}"]`).first().press('Enter');
    await expect(page.locator('#inspectordock')).toBeVisible();
    const move = page.getByRole('button', { name: 'Move Economy window', exact: true });
    const resize = page.getByRole('button', { name: 'Resize Economy window', exact: true });
    await move.focus();
    await move.press('ArrowDown');
    await resize.focus();
    await resize.press('ArrowLeft');
    const geometry = await report.boundingBox();
    await page.locator('#economy-query').fill('headquarters');
    await page.locator('#workspace-nav [data-workspace="logistics"]').press('Enter');
    await page.locator('#workspace-nav [data-workspace="economy"]').press('Enter');
    await expect(page.locator('#economy-query')).toHaveValue('headquarters');
    expect(await report.boundingBox()).toEqual(geometry);
    for (const control of [
      move,
      resize,
      page.getByRole('button', { name: 'Close Economy window', exact: true }),
      page.locator('#ic'),
      page.locator('#minimap-toggle'),
    ])
      await usable(control);
    expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
      before.cam,
    );
    await capture(page, `combined-report-${width}-q${quality}`);
    await page.locator('#ppl').focus();
    await expect(page.locator('#population-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#population-help')).toBeHidden();
    await expect(report).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(report).toBeHidden();
    await expectMapFocus(page);
    if (width === 1280 && quality === 1) {
      await page.locator('#utility summary').press('Enter');
      await page.locator('#mixb').press('Enter');
      await page.locator('#settings-help').press('Enter');
      await page.keyboard.press('Escape');
      await expect(page.locator('#settings-help')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('#utility summary')).toBeFocused();
      expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(true);
    }
    await page.locator('#goods [data-good="planks"]').press('Enter');
    const mini = await page.locator('#mini').boundingBox();
    await page.mouse.click(mini.x + mini.width * 0.75, mini.y + mini.height * 0.7);
    const moved = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
    expect(moved).not.toEqual(before.cam);
    await page.locator(`[data-economy-inspect="${hq}"]`).first().press('Enter');
    expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(moved);
    await page.locator(`[data-economy-locate="${hq}"]`).first().press('Enter');
    await expect(report).toBeHidden();
    await expectMapFocus(page);
    expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(
      before.save,
    );
    expect(await page.locator('#view').boundingBox()).toEqual({ x: 0, y: 0, width, height });
    expect(errors).toEqual([]);
  });
}
