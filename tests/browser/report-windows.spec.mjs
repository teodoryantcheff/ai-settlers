import { test, expect } from './helpers/test.mjs';
import { openAtlas } from './helpers/atlas.mjs';
test.setTimeout(120000);
async function boot(page) {
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__reportFrame = callback;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
    );
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => window.__reportFrame(1000));
  await page.locator('#startb').press('Enter');
}
async function economy(page) {
  await openAtlas(page);
  await page.locator('[data-workspace="economy"]').press('Enter');
}

test('Economy opens as one nonblocking window beside inspection without resizing or moving the map', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.inspectContributor(g.anyStorage().id);
  });
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { cam: { ...g.cam }, width: g.vw, height: g.vh, time: g.state.time };
  });
  await economy(page);
  const report = page.getByRole('region', { name: 'Economy window', exact: true });
  await expect(report).toBeVisible();
  await expect(page.locator('#inspectordock')).toBeVisible();
  const box = await report.boundingBox(),
    dock = await page.locator('#inspectordock').boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(dock.x);
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { cam: { ...g.cam }, width: g.vw, height: g.vh };
    }),
  ).toEqual({ cam: before.cam, width: before.width, height: before.height });
  await page.evaluate(() => window.__reportFrame(1100));
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBeGreaterThan(
    before.time,
  );
  expect(await page.evaluate(() => window.productionArtPreview.game.blockingLayerOpen())).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Close Economy window', exact: true }).click();
  await expect(report).toBeHidden();
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
    before.cam,
  );
});

test('pointer and keyboard window geometry survives closing and remains reachable after viewport resize', async ({
  page,
}) => {
  await boot(page);
  await economy(page);
  const report = page.getByRole('region', { name: 'Economy window', exact: true });
  const original = await report.boundingBox();
  const title = await report.locator('.report-titlebar h2').boundingBox();
  await page.mouse.move(title.x + 30, title.y + 10);
  await page.mouse.down();
  await page.mouse.move(title.x + 70, title.y + 40, { steps: 4 });
  await page.mouse.up();
  const moved = await report.boundingBox();
  expect(moved.x).toBeGreaterThan(original.x);
  expect(moved.y).toBeGreaterThan(original.y);
  const move = page.getByRole('button', { name: 'Move Economy window', exact: true });
  await move.focus();
  await move.press('ArrowLeft');
  expect((await report.boundingBox()).x).toBeLessThan(moved.x);
  const resize = page.getByRole('button', { name: 'Resize Economy window', exact: true });
  const grip = await resize.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 80, grip.y + grip.height / 2 - 70, { steps: 4 });
  await page.mouse.up();
  const smaller = await report.boundingBox();
  expect(smaller.width).toBeLessThan(moved.width);
  expect(smaller.height).toBeLessThan(moved.height);
  await resize.focus();
  await resize.press('ArrowRight');
  await resize.press('ArrowDown');
  const remembered = await report.boundingBox();
  expect(remembered.width).toBeGreaterThan(smaller.width);
  expect(remembered.height).toBeGreaterThan(smaller.height);
  await page.getByRole('button', { name: 'Close Economy window', exact: true }).click();
  await economy(page);
  expect(await report.boundingBox()).toEqual(remembered);
  await page.setViewportSize({ width: 1280, height: 720 });
  const constrained = await report.boundingBox(),
    bar = await page.locator('#bar').boundingBox();
  expect(constrained.x).toBeGreaterThanOrEqual(0);
  expect(constrained.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(constrained.x + constrained.width).toBeLessThanOrEqual(1280);
  expect(constrained.y + constrained.height).toBeLessThanOrEqual(720);
  await expect(move).toBeVisible();
  await expect(resize).toBeVisible();
  await resize.click();
  await expect(resize).toBeFocused();
});

test('Economy restores edited filters, useful focus, disclosures and scroll after close or report switch', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game,
      b = g.newBuilding('sawmill', 51, 48);
    Object.assign(b, { done: true, constructionProgress: 1, stock: { logs: 2 } });
    g.buildings.push(b);
  });
  await page.locator('#goods [data-good="planks"]').press('Enter');
  await page.locator('#economy-window').selectOption('120');
  await page.locator('#economy-chain').selectOption('0');
  const query = page.locator('#economy-query');
  await query.fill('plank');
  const host = page.locator('#workspace-economy');
  await host.evaluate((el) => (el.scrollTop = 200));
  const scroll = await host.evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  const save = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.getByRole('button', { name: 'Close Economy window', exact: true }).click();
  await economy(page);
  await expect(query).toBeFocused();
  await expect(query).toHaveValue('plank');
  expect(await host.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.locator('[data-workspace="logistics"]').press('Enter');
  await page.locator('[data-workspace="economy"]').press('Enter');
  await expect(query).toBeFocused();
  await expect(page.locator('#economy-window')).toHaveValue('120');
  await expect(page.locator('#economy-chain')).toHaveValue('0');
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(save);
  const summary = page.getByText('Nominal capacity and limiting conditions', { exact: true });
  await summary.click();
  const deepScroll = await host.evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: 'Close Economy window', exact: true }).click();
  await page.evaluate(() => window.productionArtPreview.game.step(2));
  const afterStep = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await economy(page);
  await expect(summary).toBeFocused();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  expect(await host.evaluate((el) => el.scrollTop)).toBe(deepScroll);
  await page.locator('#goods [data-good="logs"]').press('Enter');
  await expect(page.locator('#economy-resource-heading')).toContainText('Logs');
  await expect(page.locator('#economy-resource-heading')).toBeFocused();
  await expect(query).toHaveValue('plank');
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(afterStep);
});

test('Inspect retains Economy and its camera; Locate cancels pending zoom and reveals the site in clear map space', async ({
  page,
}) => {
  await boot(page);
  await openAtlas(page);
  const id = await page.evaluate(() => {
    const g = window.productionArtPreview.game,
      b = g.newBuilding('sawmill', 80, 80);
    Object.assign(b, { done: true, constructionProgress: 1 });
    g.buildings.push(b);
    return b.id;
  });
  await page.locator('#goods [data-good="planks"]').press('Enter');
  const report = page.getByRole('region', { name: 'Economy window', exact: true });
  const geometry = await report.boundingBox(),
    cam = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await page.locator(`[data-economy-inspect="${id}"]`).click();
  expect(await report.boundingBox()).toEqual(geometry);
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(cam);
  await expect(page.locator('#infobody')).toContainText('Sawmill');
  await page.evaluate(() => {
    window.productionArtPreview.game.presentationPrefs.reducedMotion = false;
  });
  const save = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.mouse.move(1000, 880);
  await page.mouse.wheel(0, -120);
  await page.locator(`[data-economy-locate="${id}"]`).click();
  await expect(report).toBeHidden();
  await page.waitForTimeout(180);
  const point = await page.evaluate((id) => {
    const g = window.productionArtPreview.game,
      b = g.byId(id);
    g.draw();
    return { x: ((b.x + 0.5) * g.TS - g.cam.x) * g.z, y: ((b.y + 0.5) * g.TS - g.cam.y) * g.z };
  }, id);
  const dock = await page.locator('#inspectordock').boundingBox(),
    bar = await page.locator('#bar').boundingBox(),
    mini = await page.locator('#mini').boundingBox();
  const atlas = await page.locator('#workspace-nav').boundingBox();
  expect(point.x).toBeGreaterThan(atlas?.x + atlas?.width || 0);
  expect(point.x).toBeLessThan(dock.x);
  expect(point.y).toBeGreaterThan(bar.y + bar.height);
  expect(point.y).toBeLessThan(mini.y);
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(save);
  await economy(page);
  await expect(report).toBeVisible();
  expect(await report.boundingBox()).toEqual(geometry);
  await expect(page.locator('#economy-resource-heading')).toContainText('Planks');
  await page.locator('#minimap-toggle').click();
  await expect(page.locator('#mini')).toBeHidden();
  await page.locator(`[data-economy-locate="${id}"]`).click();
  const collapsedPoint = await page.evaluate((id) => {
    const g = window.productionArtPreview.game,
      b = g.byId(id);
    g.draw();
    return { x: ((b.x + 0.5) * g.TS - g.cam.x) * g.z, y: ((b.y + 0.5) * g.TS - g.cam.y) * g.z };
  }, id);
  const modes = await page.locator('#map-modes').boundingBox();
  expect(collapsedPoint.y).toBeLessThan(modes.y);
  expect(collapsedPoint.x).toBeLessThan(dock.x);
});

test('opening and switching reports ends held map gestures while new gestures and inspection remain usable', async ({
  page,
}) => {
  await boot(page);
  const camera = () => page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  const saved = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  // Keep the original right button down across V, reproducing the native review finding.
  await page.mouse.move(1350, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1340, 400);
  const dragged = await camera();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Colony window', exact: true })).toBeVisible();
  expect(await camera()).toEqual(dragged);
  expect(await page.evaluate(() => window.productionArtPreview.game.keys.r)).toBe(false);
  await page.mouse.move(1330, 400);
  expect(await camera()).toEqual(dragged);
  await page.keyboard.up('ArrowRight');

  // Releasing the canceled drag over the canvas must not become a fresh cancel click.
  const hq = await page.evaluate(() => {
    const g = window.productionArtPreview.game,
      id = g.anyStorage().id;
    g.inspectContributor(id);
    return id;
  });
  await expect(page.locator('#inspectordock')).toBeVisible();
  await page.mouse.move(1000, 400);
  await page.mouse.up({ button: 'right' });
  expect(await page.evaluate(() => window.productionArtPreview.game.selected?.id)).toBe(hq);
  await expect(page.getByRole('region', { name: 'Colony window', exact: true })).toBeVisible();

  // A new explicit drag remains intentional navigation beside an open report.
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(990, 400);
  const fresh = await camera();
  expect(fresh.x).toBeGreaterThan(dragged.x);
  await page.mouse.up({ button: 'right' });
  expect(await page.evaluate(() => window.productionArtPreview.game.selected?.id)).toBe(hq);
  await page.locator('#goods [data-good="gold"]').press('Enter');
  await expect(page.getByRole('region', { name: 'Economy window', exact: true })).toBeVisible();
  expect(await camera()).toEqual(fresh);
  await page.mouse.move(1000, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(990, 400);
  const switched = await camera();
  await page.keyboard.press('v');
  await page.mouse.move(980, 400);
  expect(await camera()).toEqual(switched);
  await page.mouse.up({ button: 'right' });
  expect(await page.evaluate(() => window.productionArtPreview.game.selected?.id)).toBe(hq);

  // The same navigation boundary ends a held minimap gesture, then accepts a new one.
  await page.keyboard.press('Escape');
  const mini = await page.locator('#mini').boundingBox();
  await page.mouse.move(mini.x + mini.width * 0.4, mini.y + mini.height * 0.5);
  await page.mouse.down();
  const miniHeld = await camera();
  await page.keyboard.press('v');
  expect(await camera()).toEqual(miniHeld);
  await page.mouse.move(mini.x + mini.width * 0.5, mini.y + mini.height * 0.5);
  expect(await camera()).toEqual(miniHeld);
  await page.mouse.up();
  await page.mouse.down();
  await page.mouse.move(mini.x + mini.width * 0.6, mini.y + mini.height * 0.5);
  expect(await camera()).not.toEqual(miniHeld);
  await page.mouse.up();
  await page.mouse.click(1000, 400, { button: 'right' });
  expect(await page.evaluate(() => window.productionArtPreview.game.selected)).toBe(null);
  await expect(page.getByRole('region', { name: 'Colony window', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(saved);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.draw();
    g.drawMini();
  });
  await page.screenshot({ path: test.info().outputPath('report-gesture-navigation.png') });
});
