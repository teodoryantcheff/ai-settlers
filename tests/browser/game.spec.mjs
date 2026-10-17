import { test, expect } from './helpers/test.mjs';

test.setTimeout(60000);

async function boot(page, url) {
  await page.addInitScript(() => {
    // UI assertions need native rendering, but do not need full-resolution effects.
    if (!localStorage.getItem('settlers.prefs'))
      localStorage.setItem('settlers.prefs', JSON.stringify({ quality: 0.75, showFps: true }));
  });
  await page.goto(url);
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
}

test('legacy armory shows the same iron-ore shortage in its inspector and muted persistent notice', async ({
  page,
}) => {
  await boot(page, '/tests/game.html?shortagefeedback&seed=2024');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await expect(page.locator('#infobody')).toContainText('no iron ore');
  await expect(page.locator('#msgs')).toContainText('blocked — needs iron ore', { timeout: 30000 });
  await expect(page.locator('#msgs')).not.toContainText('needs iron bars');
  expect(await page.evaluate(() => window.productionArtPreview.game.muted)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('legacy-armory-shortage.png') });
});

test('all resources remain visible at desktop sizes', async ({ page }) => {
  await boot(page, '/?seed=2024');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click();
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#goods .gd')).toHaveCount(17);
    const boxes = await page.locator('#goods .gd').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, width: r.width, right: r.right, height: r.height };
      }),
    );
    expect(boxes.every((b) => b.x >= 0 && b.right <= width && b.width > 30 && b.height > 15)).toBe(
      true,
    );
    const fpsBox = await page.locator('#fps').boundingBox();
    expect(fpsBox.x + fpsBox.width).toBeLessThanOrEqual(width);
    expect(fpsBox.x).toBeGreaterThanOrEqual(0);
  }
});

test('FPS remains visible and updates while the simulation is paused', async ({ page }) => {
  await boot(page, '/?seed=2024');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click();
  await page.locator('#sp0').click();
  await expect(page.locator('#spd')).toHaveText('PAUSED');
  await page.evaluate(() => {
    document.getElementById('fps').textContent = 'Waiting for frame sample';
  });
  await expect(page.locator('#fps')).toHaveText(/^\d+ FPS$/, { timeout: 15000 });
  await expect(page.locator('#fps')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('fps-counter.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#fps')).toBeVisible();
  const fpsBox = await page.locator('#fps').boundingBox();
  expect(fpsBox.x).toBeGreaterThanOrEqual(0);
  expect(fpsBox.x + fpsBox.width).toBeLessThanOrEqual(390);
});

test('built-in placement and interface scenarios pass', async ({ page }) => {
  // Both exhaustive scenarios share a cold software-GPU boot in this case.
  test.setTimeout(90000);
  await boot(page, '/tests/game.html?uitest&buildrules&seed=2024');
  await expect(page.locator('#uitres')).toContainText('UITEST_OK', { timeout: 30000 });
  await expect(page.locator('#brres')).toContainText('BUILD_RULES OK', { timeout: 30000 });
});

test('save import is transactional and settings persist', async ({ page }) => {
  await boot(page, '/?seed=2024');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click();
  await page.locator('#sp0').click();
  await page.locator('#utility summary').click();
  await page.locator('#saveb').click();
  await page.locator('#checkpoint-name').fill('Settings checkpoint');
  await page.locator('#create-checkpoint').click();
  const saved = await page.evaluate(() => localStorage.getItem('settlers.saves.v1'));
  await page.locator('#savecode').fill(btoa('{"v":2,"t":[]}'));
  await page.locator('#pastecode').click();
  expect(await page.evaluate(() => localStorage.getItem('settlers.saves.v1'))).toBe(saved);
  await page.locator('[data-close="savedata"]').click();
  await page.locator('#utility summary').click();
  // Keyboard activation avoids waiting for two slow software-GPU animation frames.
  await expect(page.locator('#mixb')).toBeVisible();
  await page.locator('#mixb').press('Enter');
  await page.locator('#motionpref').check();
  await page.locator('#weatherpref').uncheck();
  await page.locator('#claritypref').check();
  await page.locator('#qualitypref').selectOption('0.75');
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('body')).toHaveClass(/reduced-motion/);
  await expect(page.locator('body')).toHaveClass(/clarity-view/);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settlers.prefs')).weather),
  ).toBe(false);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settlers.prefs')).clarity),
  ).toBe(true);
});

test('save/load scenario restores a live colony', async ({ page }) => {
  await boot(page, '/tests/game.html?saveload&seed=123');
  // This scenario advances through timer-driven save/load stages while rendering.
  await expect(page.locator('#slres')).toContainText('SAVELOAD_OK', { timeout: 30000 });
});

test('keyboard buttons keep pause state and Escape closes a focused text field', async ({
  page,
}) => {
  await boot(page, '/?seed=2024');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click();
  await page.locator('#sp0').click();
  await page.locator('#economyb').press('Space');
  await expect(page.locator('#economy')).toBeVisible();
  await expect(page.locator('#spd')).toHaveText('PAUSED');
  await expect(page.locator('#colony-map')).toBeVisible();
  await page.locator('#colony-map').press('Enter');
  await expect(page.locator('#economy')).toBeHidden();
  await expect(page.locator('#spd')).toHaveText('PAUSED');
  await page.locator('#utility summary').click();
  await expect(page.locator('#savepanelb')).toBeVisible();
  await page.locator('#savepanelb').press('Enter');
  await page.locator('#savecode').fill('still editing');
  await page.locator('#savecode').press('Escape');
  await expect(page.locator('#savedata')).toBeHidden();
});

test('shared interaction transitions preserve real map, inspector, road, Journey and load controls', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await boot(page, '/tests/game.html?seed=2024');
  await page.waitForFunction(() => window.productionArtPreview?.game);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click();
  await page.locator('#sp0').click();
  const ids = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.placeBuilding('farm', 51, 48);
    const farm = g.buildings.at(-1).id;
    g.placeBuilding('well', 48, 51);
    const well = g.buildings.at(-1).id;
    // A nearby impassable endpoint lets actual mouse clicks exercise road rejection.
    const water = g.idx(52, 49);
    Object.assign(g.tiles[water], { t: g.WATER, tree: 0, rock: null, deposit: null });
    g.emitGameEvent('tileChanged', { index: water });
    return { farm, well, hq: g.anyStorage().id };
  });
  async function choose(type) {
    await page.locator('#paletteb').press('Enter');
    await page.locator(`.pb[data-b="${type}"]`).press('Enter');
    await expect(page.locator('#paletteitems')).toBeHidden();
    await expect(page.locator('#paletteb')).toBeFocused();
  }
  async function mapClick(x, y, shift = false) {
    const point = await page.evaluate(
      ({ x, y }) => {
        const g = window.productionArtPreview.game;
        const r = g.view.getBoundingClientRect();
        return {
          x: r.left + ((x + 0.5) * g.TS - g.cam.x) * g.z,
          y: r.top + ((y + 0.5) * g.TS - g.cam.y) * g.z,
        };
      },
      { x, y },
    );
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    if (shift) await page.keyboard.up('Shift');
  }
  async function openUtility() {
    if (!(await page.locator('#utility').evaluate((element) => element.open)))
      await page.locator('#utility summary').click();
  }
  async function state() {
    return page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return {
        mode: g.mode?.type || null,
        selected: g.selected?.id || null,
        anchor: g.anchor,
        armed: g.demoArm?.id || null,
        tile: g.selInfo,
        overlay: g.presentationPrefs.overlay,
        cam: g.cam,
        time: g.state.time,
        messages: g.msgs.map((message) => ({
          text: message.t,
          age: performance.now() - message.at,
        })),
      };
    });
  }
  await choose('demolish');
  await mapClick(51, 48);
  expect((await state()).armed).toBe(ids.farm);
  expect(await page.evaluate((id) => !!window.productionArtPreview.game.byId(id), ids.farm)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('map-raze-armed.png') });
  await page.locator('#demolition-confirm').click();
  expect(
    await page.evaluate((id) => window.productionArtPreview.game.byId(id), ids.farm),
  ).toBeNull();
  await mapClick(48, 48, true);
  expect(await page.evaluate((id) => !!window.productionArtPreview.game.byId(id), ids.hq)).toBe(
    true,
  );
  await expect(page.locator('#msgs')).toContainText('headquarters cannot be razed');
  await mapClick(55, 50);
  await expect(page.locator('#msgs')).toContainText('No building there to raze');
  await page.keyboard.press('Escape');
  await mapClick(48, 51);
  expect((await state()).selected).toBe(ids.well);
  await page.locator('#dz').press('Enter');
  await expect(page.locator('#demolition-dialog')).toBeVisible();
  await page.locator('#demolition-confirm').press('Enter');
  expect(
    await page.evaluate((id) => window.productionArtPreview.game.byId(id), ids.well),
  ).toBeNull();
  expect((await state()).selected).toBeNull();
  await expect(page.locator('#dz')).toBeHidden();

  await choose('road');
  await mapClick(49, 48);
  await mapClick(52, 49, true);
  expect((await state()).anchor).toEqual({ x: 49, y: 48 });
  await mapClick(50, 51, true);
  expect((await state()).anchor).toEqual({ x: 50, y: 51 });
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return g.tiles[g.idx(50, 51)].road;
    }),
  ).toBe(true);
  await mapClick(52, 49);
  expect((await state()).anchor).toBeNull();

  // A starved producer and pending outpost supply real advisor and Journey buttons.
  const inspection = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('guard', 51, 48);
    const armory = g.newBuilding('armory', 54, 48);
    Object.assign(armory, {
      done: true,
      constructionProgress: 1,
      legacyIndustry: true,
      stock: { coal: 1 },
    });
    armory.metrics.elapsed = 60;
    armory.metrics.inputBlocked = 60;
    g.buildings.push(b, armory);
    g.state.milestones = [0, 1, 2, 3];
    g.hudTick();
    g.gameplayHUD();
    return { outpost: b.id, armory: armory.id };
  });
  const outpost = inspection.outpost;
  await page.keyboard.press('v');
  await expect(page.locator(`#adv [data-focus="${inspection.armory}"]`)).toBeVisible();
  await page.locator(`#adv [data-focus="${inspection.armory}"]`).press('Enter');
  expect((await state()).mode).toBeNull();
  expect((await state()).selected).toBe(inspection.armory);
  expect((await state()).overlay).toBe('routes');
  await page.keyboard.press('f');
  expect((await state()).mode).toBeNull();
  expect((await state()).selected).toBe(inspection.armory);
  expect((await state()).tile).toBeNull();
  await page.keyboard.press('v');
  await page.locator('#colony-lesson-build').press('Enter');
  expect((await state()).mode).toBeNull();
  expect((await state()).selected).toBe(outpost);
  await expect(page.locator('#infobody')).toContainText('Outpost');
  const journeyCam = (await state()).cam;
  expect(
    await page.evaluate((cam) => {
      const g = window.productionArtPreview.game;
      const b = g.pendingOutpost();
      return Math.abs(cam.x - ((b.x + 0.5) * g.TS - g.vw / g.z / 2)) < 0.01;
    }, journeyCam),
  ).toBe(true);
  await page.screenshot({ path: test.info().outputPath('journey-inspection.png') });

  await choose('road');
  await mapClick(49, 48);
  await page.locator('#paletteb').press('Enter');
  await page.locator('#economyb').press('Enter');
  await expect(page.locator('#economy')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#economy')).toBeHidden();
  await expect(page.locator('#paletteitems')).toBeVisible();
  // Dedicated Colony navigation cancels pending map placement, while preserving the tray.
  expect((await state()).anchor).toBeNull();
  expect((await state()).mode).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.locator('#paletteitems')).toBeHidden();
  expect((await state()).mode).toBeNull();
  await page.keyboard.press('Escape');
  expect((await state()).mode).toBeNull();
  expect((await state()).anchor).toBeNull();

  await openUtility();
  await page.locator('#saveb').press('Enter');
  await page.locator('#checkpoint-name').fill('Interaction checkpoint');
  await page.locator('#create-checkpoint').click();
  await page.locator('#close-saves').click();
  await choose('demolish');
  await mapClick(51, 48);
  expect((await state()).armed).toBe(outpost);
  await page.keyboard.press('Escape');
  await openUtility();
  await page.locator('#savepanelb').press('Enter');
  await page.locator('#savecode').fill(btoa('{"v":2}'));
  await page.locator('#pastecode').press('Enter');
  expect((await state()).mode).toBe('demolish');
  expect((await state()).armed).toBe(outpost);
  await page.locator('#savecode').press('Escape');
  await openUtility();
  await page.locator('#loadb').press('Enter');
  await page
    .locator('.save-entry')
    .filter({ hasText: 'Interaction checkpoint' })
    .getByRole('button', { name: 'Load', exact: true })
    .click();
  if (await page.locator('#save-confirm').isVisible())
    await page.locator('#confirm-save-action').click();
  const loaded = await state();
  expect(loaded).toMatchObject({ mode: null, selected: null, armed: null, anchor: null });
  expect(loaded.messages.some((message) => message.text === '✓ Game loaded')).toBe(true);
  await test.info().attach('loaded-interaction-state', {
    body: JSON.stringify(loaded),
    contentType: 'application/json',
  });
  // Inspect a building in the replacement world through real map input. This is
  // durable visible load feedback even when a software-GPU terrain rebuild
  // outlasts the transient seven-second message feed.
  await mapClick(48, 48);
  expect((await state()).selected).toBe(ids.hq);
  await expect(page.locator('#infobody')).toContainText('Headquarters');
  await page.screenshot({ path: test.info().outputPath('loaded-inspection.png') });
  expect(errors).toEqual([]);
});
