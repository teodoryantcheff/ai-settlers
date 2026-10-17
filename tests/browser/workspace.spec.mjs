import { test, expect, frame, load, seedPrefs } from './helpers/test.mjs';
import { openAtlas } from './helpers/atlas.mjs';

test.setTimeout(120000);

// Suspension is observed against the browser's own animation frames.
async function bootLive(page) {
  await seedPrefs(page, { quality: 0.75 });
  await load(page);
  await page.locator('#startb').press('Enter');
}
/** Let the browser run `count` real animation frames, each one a game-loop turn. */
function liveFrames(page, count) {
  return page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const next = () => (--count <= 0 ? resolve() : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
    count,
  );
}

test('live analysis preserves map and selection while leaving placement safely', async ({
  freshPage: page,
}) => {
  await bootLive(page);
  await page.locator('#sp0').press('Enter');
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.selectMapTarget(g.anyStorage(), null);
    g.setMode('build', 'farm');
  });
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { cam: { ...g.cam }, selected: g.selected.id };
  });
  await openAtlas(page);
  await page.getByRole('button', { name: 'Economy', exact: true }).press('Enter');
  await expect(page.locator('#workspace-economy')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { cam: { ...g.cam }, selected: g.selected.id, mode: g.mode };
    }),
  ).toEqual({ ...before, mode: null });
  await page.locator('#sp1').press('Enter');
  const time = await page.evaluate(() => window.productionArtPreview.game.state.time);
  await expect
    .poll(() => page.evaluate(() => window.productionArtPreview.game.state.time), {
      timeout: 20000,
    })
    .toBeGreaterThan(time);
  await openAtlas(page);
  await page.getByRole('button', { name: 'Map', exact: true }).press('Enter');
  await expect(page.locator('#view')).toBeVisible();
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
    before.cam,
  );
});

test('nested utility dialogs suspend running time and return keyboard focus', async ({
  freshPage: page,
}) => {
  await bootLive(page);
  await page.locator('#utility summary').press('Enter');
  await page.locator('#mixb').press('Enter');
  await expect(page.locator('#mix')).toBeVisible();
  await expect(page.locator('#speedpref')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-close="mix"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#speedpref')).toBeFocused();
  const time = await page.evaluate(() => window.productionArtPreview.game.state.time);
  await liveFrames(page, 10);
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBe(time);
  await expect(page.locator('#settings-help')).toBeVisible();
  await page.locator('#settings-help').press('Enter');
  await expect(page.locator('#help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
  await expect(page.locator('#mix')).toBeVisible();
  await expect(page.locator('#settings-help')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mix')).toBeHidden();
  await expect(page.locator('#utility summary')).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.productionArtPreview.game.state.time), {
      timeout: 20000,
    })
    .toBeGreaterThan(time);
  await page.locator('#sp0').press('Enter');
  await page.locator('#utility summary').press('Enter');
  await page.locator('#mixb').press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#spd')).toHaveText('PAUSED');
});

test('atlas layout keeps stored goods visible and map input aligned at desktop sizes', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.locator('#sp0').press('Enter');
  let now = 1000;
  for (const [width, height, quality, motion] of [
    [1440, 900, '1', false],
    [1280, 720, '0.75', true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#utility summary').press('Enter');
    await page.locator('#mixb').press('Enter');
    await page.locator('#qualitypref').selectOption(quality);
    await page.locator('#motionpref').setChecked(motion);
    await page.keyboard.press('Escape');
    await openAtlas(page);
    await page.getByRole('button', { name: 'Map', exact: true }).press('Enter');
    await frame(page, (now += 100));
    const point = await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      const hq = g.anyStorage();
      const r = g.view.getBoundingClientRect();
      return {
        x: r.left + ((hq.x + 0.5) * g.TS - g.cam.x) * g.z,
        y: r.top + ((hq.y + 0.5) * g.TS - g.cam.y) * g.z,
      };
    });
    await page.mouse.click(point.x, point.y);
    await frame(page, (now += 100));
    await expect(page.locator('#info')).toBeVisible();
    await expect(page.locator('#infobody')).toContainText('Headquarters');
    const boxes = await page.locator('#goods .gd').evaluateAll((goods) =>
      goods.map((good) => {
        const r = good.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      }),
    );
    expect(boxes).toHaveLength(17);
    expect(boxes.every((box) => box.left >= 0 && box.right <= width && box.width >= 30)).toBe(true);
    const canvas = await page.locator('#view').boundingBox();
    expect(canvas).toEqual({ x: 0, y: 0, width, height });
    const camera = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
    await page.locator('#atlas-toggle').press('Enter');
    await expect(page.locator('#workspace-nav')).toBeHidden();
    expect(await page.locator('#view').boundingBox()).toEqual(canvas);
    expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
      camera,
    );
    await openAtlas(page);
    expect(await page.locator('#view').boundingBox()).toEqual(canvas);
    expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
      camera,
    );
    await page.screenshot({ path: test.info().outputPath(`atlas-map-${width}.png`) });
    await openAtlas(page);
    await page.getByRole('button', { name: 'Economy', exact: true }).press('Enter');
    await page.screenshot({ path: test.info().outputPath(`atlas-economy-${width}.png`) });
  }
});
