import { test, expect } from './helpers/test.mjs';

test.setTimeout(120000);
async function boot(page) {
  await page.addInitScript(() => {
    if (!location.search.includes('rememberAtlas'))
      localStorage.setItem(
        'settlers.prefs',
        JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
      );
    window.requestAnimationFrame = (callback) => {
      window.__fullMapFrame = callback;
      return 0;
    };
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => window.__fullMapFrame(1000));
  await page.locator('#startb').press('Enter');
  await page.locator('#sp0').press('Enter');
}

test('map fills the viewport and selected inspector overlays preserve map and camera', async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator('#inspectordock')).toBeHidden();
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { cam: { ...g.cam }, width: g.vw, height: g.vh };
  });
  const canvas = await page.locator('#view').boundingBox();
  expect(canvas).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  const point = await page.evaluate(() => {
    const g = window.productionArtPreview.game,
      b = g.anyStorage(),
      r = g.view.getBoundingClientRect();
    return {
      x: r.left + ((b.x + 0.5) * g.TS - g.cam.x) * g.z,
      y: r.top + ((b.y + 0.5) * g.TS - g.cam.y) * g.z,
    };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#inspectordock')).toBeVisible();
  await expect(page.locator('#infobody')).toContainText('Headquarters');
  expect(await page.locator('#view').boundingBox()).toEqual(canvas);
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { cam: { ...g.cam }, width: g.vw, height: g.vh };
    }),
  ).toEqual(before);
  await page.locator('#ic').click();
  await expect(page.locator('#inspectordock')).toBeHidden();
  expect(await page.evaluate(() => window.productionArtPreview.game.selected)).toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#inspectordock')).toBeVisible();
});

test('Atlas starts collapsed, stays open across destinations and remembers the explicit choice', async ({
  page,
}) => {
  await boot(page);
  const toggle = page.locator('#atlas-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#workspace-nav')).toBeHidden();
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { cam: { ...g.cam }, width: g.vw, height: g.vh };
  });
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#workspace-nav')).toBeVisible();
  await page.locator('[data-workspace="economy"]').press('Enter');
  await expect(page.locator('#workspace-economy')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-workspace="map"]').press('Enter');
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { cam: { ...g.cam }, width: g.vw, height: g.vh };
    }),
  ).toEqual(before);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settlers.prefs')).atlasExpanded),
  ).toBe(true);
  // The reload query retains the saved presentation choice instead of reapplying test defaults.
  await page.goto('/tests/game.html?seed=2024&rememberAtlas=1');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#startb').press('Enter');
  await toggle.press('Enter');
  await expect(page.locator('#workspace-nav')).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settlers.prefs')).atlasExpanded),
  ).toBe(false);
});

test('analysis keeps submitting the full map and minimap while simulation remains live', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#atlas-toggle').click();
  await page.locator('[data-workspace="economy"]').click();
  await expect(page.locator('#workspace-economy')).toBeVisible();
  await expect(page.locator('#view')).toBeVisible();
  await page.locator('#sp1').press('Enter');
  const time = await page.evaluate(() => window.productionArtPreview.game.state.time);
  const before = await page.evaluate(() => window.productionArtPreview.game.renderStats.samples);
  await page.evaluate(() => window.__fullMapFrame(2000));
  expect(
    await page.evaluate(() => window.productionArtPreview.game.renderStats.samples),
  ).toBeGreaterThan(before);
  await expect(page.locator('#mini')).toBeVisible();
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBeGreaterThan(
    time,
  );
});

test('overlay edges retain real hover, placement, pan and zoom coordinates at both supported qualities', async ({
  page,
}) => {
  await boot(page);
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
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.resize();
      g.inspectContributor(g.anyStorage().id);
      g.draw();
    });
    const dock = await page.locator('#inspectordock').boundingBox();
    const point = await page.evaluate(
      ({ x, y }) => {
        const g = window.productionArtPreview.game;
        let site;
        for (let ty = 38; ty < 60 && !site; ty++)
          for (let tx = 38; tx < 60; tx++) {
            if (g.canPlace('well', tx, ty)[0]) {
              site = { x: tx, y: ty };
              break;
            }
          }
        if (!site) throw new Error('No legal well site in acceptance colony');
        g.cam.x = (site.x + 0.5) * g.TS - x / g.z;
        g.cam.y = (site.y + 0.5) * g.TS - y / g.z;
        g.clampCam();
        g.draw();
        const r = g.view.getBoundingClientRect();
        return {
          ...site,
          screenX: r.left + ((site.x + 0.5) * g.TS - g.cam.x) * g.z,
          screenY: r.top + ((site.y + 0.5) * g.TS - g.cam.y) * g.z,
        };
      },
      { x: dock.x - 16, y: dock.y + 110 },
    );
    await page.mouse.move(point.screenX, point.screenY);
    expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.ht }))).toEqual({
      x: point.x,
      y: point.y,
    });
    await page.mouse.click(point.screenX, point.screenY);
    await expect(page.locator('#infobody')).toContainText('TERRAIN');
    await page.evaluate(() => window.productionArtPreview.game.setMode('build', 'well'));
    const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
    await page.locator('#atlas-toggle').click();
    await page.locator('#atlas-toggle').click();
    expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toEqual(
      before,
    );
    expect(await page.evaluate(() => window.productionArtPreview.game.mode.type)).toBe('build');
    await page.mouse.move(point.screenX, point.screenY);
    expect(await page.evaluate(() => window.productionArtPreview.game.ghost.ok)).toBe(true);
    await page.mouse.click(point.screenX, point.screenY);
    expect(
      await page.evaluate(
        ({ x, y }) => window.productionArtPreview.game.buildingAt(x, y)?.type,
        point,
      ),
    ).toBe('well');
    await page.keyboard.press('Escape');
    const cam = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
    await page.mouse.move(point.screenX, point.screenY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(point.screenX - 32, point.screenY + 24, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    const panned = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
    expect(panned.x).toBeGreaterThan(cam.x);
    expect(panned.y).toBeLessThan(cam.y);
    const anchor = await page.evaluate(
      ({ x, y }) => window.productionArtPreview.game.screenToWorld(x, y),
      { x: point.screenX - 32, y: point.screenY + 24 },
    );
    const zoom = await page.evaluate(() => window.productionArtPreview.game.zi);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(180);
    await page.evaluate(() => window.productionArtPreview.game.draw());
    expect(await page.evaluate(() => window.productionArtPreview.game.zi)).toBe(zoom + 1);
    const afterAnchor = await page.evaluate(
      ({ x, y }) => window.productionArtPreview.game.screenToWorld(x, y),
      { x: point.screenX - 32, y: point.screenY + 24 },
    );
    expect(afterAnchor.x).toBeCloseTo(anchor.x, 4);
    expect(afterAnchor.y).toBeCloseTo(anchor.y, 4);
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.inspectContributor(g.anyStorage().id);
      g.draw();
      g.drawMini();
    });
    await page.screenshot({ path: test.info().outputPath(`full-map-inspector-${width}.png`) });
    await page.locator('#atlas-toggle').click();
    await page.screenshot({
      path: test.info().outputPath(`full-map-atlas-inspector-${width}.png`),
    });
    const saved = await page.evaluate(() => window.productionArtPreview.game.exportSave());
    await page.evaluate((raw) => window.productionArtPreview.game.importSave(raw), saved);
    await expect(page.locator('#inspectordock')).toBeHidden();
    await expect(page.locator('#atlas-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(await page.locator('#view').boundingBox()).toEqual({ x: 0, y: 0, width, height });
    await page.locator('#atlas-toggle').click();
  }
});

test('expanded Atlas leaves Buildings reachable while detailed Advisor lives in Colony', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#atlas-toggle').click();
  await expect(page.locator('#adv')).toBeHidden();
  const atlas = await page.locator('#workspace-nav').boundingBox();
  const buildings = await page.locator('#paletteb').boundingBox();
  expect(buildings.x).toBeGreaterThanOrEqual(atlas.x + atlas.width);
  await page.locator('#paletteb').click();
  await expect(page.locator('#paletteitems')).toBeVisible();
});
