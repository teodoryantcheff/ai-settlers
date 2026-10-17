import { test, expect } from './helpers/test.mjs';
import { openAtlas } from './helpers/atlas.mjs';

test.setTimeout(90000);
async function boot(page) {
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__mapControlsFrame = callback;
      return 0;
    };
    if (!localStorage.getItem('settlers.prefs'))
      localStorage.setItem(
        'settlers.prefs',
        JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
      );
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
  await page.evaluate(() => window.__mapControlsFrame(1000));
  await page.locator('#startb').press('Enter');
  await page.locator('#sp0').press('Enter');
}

test('direct map choices remain shared, keyboard accessible and remembered without changing the colony', async ({
  page,
}) => {
  await boot(page);
  const controls = page.getByRole('group', { name: 'Map modes' });
  await expect(controls.getByRole('button')).toHaveCount(5);
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  for (const [name, overlay] of [
    ['Normal', 'none'],
    ['Routes', 'routes'],
    ['Workload', 'workload'],
    ['Resource reach', 'reach'],
    ['Stalled buildings', 'stalls'],
  ]) {
    const button = controls.getByRole('button', { name, exact: true });
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(() => window.productionArtPreview.game.presentationPrefs.overlay),
    ).toBe(overlay);
    expect(await controls.locator('[aria-pressed="true"]').count()).toBe(1);
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.draw();
      g.hudTick();
    });
  }
  await page.evaluate(() => window.productionArtPreview.game.setMapOverlay('routes'));
  await expect(controls.getByRole('button', { name: 'Routes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await controls.getByRole('button', { name: 'Stalled buildings', exact: true }).press('Enter');
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.locator('#startb').press('Enter');
  await expect(
    controls.getByRole('button', { name: 'Stalled buildings', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await controls.getByRole('button', { name: 'Normal', exact: true }).focus();
  await page.keyboard.press('4');
  expect(
    await page.evaluate(() => ({
      speed: window.productionArtPreview.game.state.speed,
      paused: window.productionArtPreview.game.state.paused,
    })),
  ).toEqual({ speed: 4, paused: false });
});

test('minimap remains navigable during analysis and remembers collapse without moving the map', async ({
  page,
}) => {
  await boot(page);
  const toggle = page.getByRole('button', { name: 'Collapse minimap', exact: true });
  const mini = page.locator('#mini');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { cam: { ...g.cam }, width: g.vw, height: g.vh };
  });
  await toggle.press('Enter');
  await expect(mini).toBeHidden();
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { cam: { ...g.cam }, width: g.vw, height: g.vh };
    }),
  ).toEqual(before);
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.locator('#startb').press('Enter');
  await expect(mini).toBeHidden();
  await page.getByRole('button', { name: 'Expand minimap', exact: true }).press('Enter');
  await expect(mini).toBeVisible();
  await openAtlas(page);
  await page.locator('[data-workspace="economy"]').press('Enter');
  await expect(mini).toBeVisible();
  const box = await mini.boundingBox();
  const start = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await page.mouse.down();
  const clicked = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  expect(clicked).not.toEqual(start);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65);
  await page.mouse.up();
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).not.toEqual(
    clicked,
  );
  await expect(page.locator('#workspace-economy')).toBeVisible();
});

for (const [width, height, quality, motion] of [
  [1440, 900, 1, false],
  [1280, 720, 0.75, true],
]) {
  test(`map navigation fits ${width} at quality ${quality} with Reduced Motion ${motion}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await boot(page);
    await page.evaluate(
      ({ quality, motion }) => {
        const g = window.productionArtPreview.game;
        g.presentationPrefs.quality = quality;
        g.presentationPrefs.reducedMotion = motion;
        g.resize();
        g.draw();
        g.drawMini();
      },
      { quality, motion },
    );
    await page.getByRole('button', { name: 'Resource reach', exact: true }).press('Space');
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.draw();
      g.hudTick();
    });
    const modes = await page.locator('#map-controls').boundingBox();
    const mini = await page.locator('#minimap-panel').boundingBox();
    const palette = await page.locator('#palette').boundingBox();
    expect(modes.x).toBeGreaterThanOrEqual(palette.x + palette.width);
    expect(modes.x + modes.width).toBeLessThanOrEqual(mini.x);
    await expect(page.getByRole('button', { name: 'Resource reach', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.screenshot({ path: test.info().outputPath(`map-controls-${width}.png`) });
    await page.getByRole('button', { name: 'Workload', exact: true }).press('Enter');
    await page.evaluate(() => window.productionArtPreview.game.draw());
    await page.screenshot({ path: test.info().outputPath(`map-workload-${width}.png`) });
    await openAtlas(page);
    const shiftedPalette = await page.locator('#palette').boundingBox();
    expect(shiftedPalette.x + shiftedPalette.width).toBeLessThanOrEqual(modes.x);
    await page.locator('#paletteb').press('Enter');
    const expandedPalette = await page.locator('#palette').boundingBox();
    expect(expandedPalette.y + expandedPalette.height).toBeLessThanOrEqual(modes.y);
    await page.evaluate(() =>
      window.productionArtPreview.game.inspectContributor(
        window.productionArtPreview.game.anyStorage().id,
      ),
    );
    const inspector = await page.locator('#inspectordock').boundingBox();
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(mini.y);
    await page.screenshot({ path: test.info().outputPath(`map-controls-overlays-${width}.png`) });
  });
}
