import { test, expect, frame } from './helpers/test.mjs';
import { openAtlas, expectMapFocus } from './helpers/atlas.mjs';
test.setTimeout(120000);
test('Logistics distinguishes real job stages, completed arrivals and actual route evidence', async ({
  page,
}) => {
  await frame(page);
  await openAtlas(page);
  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Logistics window', exact: true })).toBeVisible();
  await expect(page.locator('#logistics-completions')).toContainText('History unavailable');
  const initial = await page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    for (const type of ['lumberjack', 'sawmill', 'farm']) {
      let placed = false;
      for (let y = hq.y - 7; y <= hq.y + 7 && !placed; y++)
        for (let x = hq.x - 7; x <= hq.x + 7 && !placed; x++)
          if (game.canPlace(type, x, y)[0]) placed = game.placeBuilding(type, x, y);
      if (!placed) throw new Error('No valid construction location');
    }
    game.step(1 / 60);
    game.updateLogisticsView();
    const report = game.currentTransport();
    return {
      queued: report.rows.filter((row) => row.stage === 'queued').length,
      assigned: report.rows.filter((row) => row.stage === 'assigned').length,
    };
  });
  expect(initial.queued).toBeGreaterThan(0);
  expect(initial.assigned).toBeGreaterThan(0);
  await expect(page.locator('[data-live-stage="carrying"]')).toHaveText('0');
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    for (let tick = 0; tick < 15; tick++) game.step(1 / 60);
    game.updateLogisticsView();
  });
  const cargo = await page.evaluate(() =>
    window.productionArtPreview.game
      .currentTransport()
      .rows.find((row) => row.stage === 'carrying' && row.route),
  );
  expect(cargo).toBeTruthy();
  await page.locator(`[data-logistics-select="${cargo.key}"]`).click();
  await expect(page.locator('#logistics-detail h2')).toBeFocused();
  await expect(page.locator('#logistics-detail')).toContainText('Physically carrying');
  await expect(page.locator('#logistics-detail')).toContainText('Measured ETA unavailable');
  await expect(page.locator('#logistics-detail svg[role="img"]')).toHaveAttribute(
    'aria-label',
    /Actual current carrier path/,
  );
  const cam = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await page.locator('#logistics-detail [data-logistics-inspect]').last().click();
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(cam);
  const coordinates = page.getByText('Recorded path coordinates', { exact: true });
  await coordinates.click();
  await coordinates.focus();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.step(1 / 60);
    game.updateLogisticsView();
  });
  await expect(coordinates).toBeFocused();
  await expect(coordinates.locator('..')).toHaveAttribute('open', '');
  await page.locator('#logistics-window').selectOption('600');
  await page.locator('#logistics-stage').selectOption('carrying');
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.locator('#logistics-query').fill(cargo.good);
  await page.evaluate(() => window.productionArtPreview.game.updateLogisticsView());
  await expect(page.locator('#logistics-query')).toBeFocused();
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  await openAtlas(page);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await openAtlas(page);
  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  await expect(page.locator('#logistics-window')).toHaveValue('600');
  await expect(page.locator('#logistics-stage')).toHaveValue('carrying');
  await expect(page.locator('#logistics-query')).toHaveValue(cargo.good);
  for (const [width, height, quality] of [
    [1440, 900, 1],
    [1280, 720, 0.75],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((quality) => {
      const game = window.productionArtPreview.game;
      game.presentationPrefs.quality = quality;
      game.resize();
      game.draw();
      game.hudTick();
    }, quality);
    await page.locator('#workspace-logistics').evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({ path: test.info().outputPath(`logistics-overview-${width}.png`) });
    await page
      .locator('#logistics-detail')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: test.info().outputPath(`logistics-route-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.locator('#logistics-detail [data-logistics-locate]').last().click();
  await expect(page.locator('#workspace-logistics')).toBeHidden();
  await expectMapFocus(page);
  await openAtlas(page);
  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    for (let tick = 0; tick < 120 * 60; tick++) game.step(1 / 60);
    game.updateLogisticsView();
  });
  const arrivals = await page.evaluate(() =>
    Object.values(window.productionArtPreview.game.cargoWindow('lifetime').totals).reduce(
      (sum, count) => sum + count,
      0,
    ),
  );
  expect(arrivals).toBeGreaterThan(0);
  await expect(page.locator('#logistics-completions')).toContainText('Completed arrivals');
  await expect(page.locator('#logistics-completions')).toContainText('simulation seconds');
  await expect(page.locator('#logistics-detail')).toContainText('no longer active');
});

test('rerouted recovered cargo stays physical and removed contributors retain former-site navigation', async ({
  page,
}) => {
  await frame(page);
  const evidence = await page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    let site;
    for (let y = hq.y - 7; y <= hq.y + 7 && !site; y++)
      for (let x = hq.x - 7; x <= hq.x + 7 && !site; x++)
        if (game.canPlace('farm', x, y)[0] && game.placeBuilding('farm', x, y))
          site = game.buildings.at(-1);
    if (!site) throw new Error('No construction site');
    for (let tick = 0; tick < 15; tick++) game.step(1 / 60);
    const cargo = game.currentTransport().rows.find((row) => row.stage === 'carrying');
    if (!cargo) throw new Error('No physical cargo collected');
    return { key: cargo.key, siteId: site.id, x: site.x, y: site.y };
  });
  await openAtlas(page);
  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  await page.locator(`[data-logistics-select="${evidence.key}"]`).click();
  await page.locator('#logistics-detail [data-logistics-inspect]').last().click();
  await page.evaluate(
    (id) => window.productionArtPreview.game.demolish(window.productionArtPreview.game.byId(id)),
    evidence.siteId,
  );
  await expect(page.locator('#logistics-detail')).toContainText('Recovered cargo');
  await expect(page.locator('#logistics-detail')).toContainText('Physically carrying');
  await expect(page.locator('#logistics-detail')).toContainText('Contributor removed');
  await expect(page.locator('#logistics-detail')).toContainText(`(${evidence.x}, ${evidence.y})`);
  expect(
    await page.evaluate(() =>
      Object.values(window.productionArtPreview.game.cargoWindow('lifetime').totals).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Locate former site' }).click();
  await expect(page.locator('#workspace-logistics')).toBeHidden();
  await expectMapFocus(page);
});

test('missing live assignment evidence has its own count and filter without asserting pickup state', async ({
  page,
}) => {
  await frame(page);
  const key = await page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    let placed = false;
    for (let y = hq.y - 7; y <= hq.y + 7 && !placed; y++)
      for (let x = hq.x - 7; x <= hq.x + 7 && !placed; x++)
        if (game.canPlace('farm', x, y)[0]) placed = game.placeBuilding('farm', x, y);
    if (!placed) throw new Error('No valid construction location');
    game.step(1 / 60);
    const assigned = game.currentTransport().rows.find((row) => row.stage === 'assigned');
    if (!assigned) throw new Error('No actual assignment');
    game.units = game.units.filter((unit) => unit.id !== assigned.carrierId);
    return assigned.key;
  });
  await openAtlas(page);
  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  await expect(page.locator('[data-live-stage="unknown"]')).toHaveText('1');
  await expect(page.locator('[data-live-stage="queued"]')).toHaveText('0');
  await page.locator('#logistics-stage').selectOption('unknown');
  await expect(page.locator('[data-logistics-select]')).toHaveCount(1);
  await page.locator(`[data-logistics-select="${key}"]`).click();
  await expect(page.locator('#logistics-detail')).toContainText('carrier evidence unavailable');
  await expect(page.locator('#logistics-detail')).toContainText(
    'Pickup, physical cargo and travel stage are unavailable',
  );
  await expect(page.locator('#logistics-detail')).not.toContainText('Cargo has not been collected');
  await expect(page.locator('#logistics-detail svg[role="img"]')).toHaveCount(0);
});

test('Logistics route action shares the central diagnostic choice without changing the colony', async ({
  page,
}) => {
  await frame(page);
  await openAtlas(page);
  await page.getByRole('button', { name: 'Logistics', exact: true }).click();
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { save: g.exportSave(), camera: { ...g.cam } };
  });
  await expect(page.getByRole('button', { name: 'Show routes on map', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show routes on map', exact: true }).press('Enter');
  await expect(page.locator('#map-modes [data-map-overlay="routes"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Logistics window', exact: true })).toBeVisible();
  await page.locator('#map-modes [data-map-overlay="none"]').click();
  await expect(page.locator('#map-modes [data-map-overlay="routes"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Show routes on map', exact: true }).click();
  expect(
    await page.evaluate(() => window.productionArtPreview.game.presentationPrefs.overlay),
  ).toBe('routes');
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { save: g.exportSave(), camera: { ...g.cam } };
    }),
  ).toEqual(before);
});

test('Logistics keeps its own window and live native context across Economy, inspection and Locate', async ({
  page,
}) => {
  await frame(page);
  const cargo = await page.evaluate(() => {
    const g = window.productionArtPreview.game,
      hq = g.anyStorage();
    let site;
    for (let y = hq.y - 7; y <= hq.y + 7 && !site; y++)
      for (let x = hq.x - 7; x <= hq.x + 7 && !site; x++)
        if (g.canPlace('farm', x, y)[0] && g.placeBuilding('farm', x, y)) site = g.buildings.at(-1);
    if (!site) throw new Error('No valid construction site');
    for (let i = 0; i < 15; i++) g.step(1 / 60);
    const row = g
      .currentTransport()
      .rows.find((row) => row.stage === 'carrying' && row.good === 'planks' && row.route);
    if (!row) throw new Error('No actual planks cargo');
    return { key: row.key, target: row.targetId };
  });
  await openAtlas(page);
  await page.locator('[data-workspace="logistics"]').press('Enter');
  const report = page.getByRole('region', { name: 'Logistics window', exact: true });
  const host = page.locator('#workspace-logistics');
  await page.locator(`[data-logistics-select="${cargo.key}"]`).click();
  const camera = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  const geometry = await report.boundingBox();
  await page.locator('#logistics-detail [data-logistics-inspect]').last().click();
  expect(await report.boundingBox()).toEqual(geometry);
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(camera);
  expect(await page.evaluate(() => window.productionArtPreview.game.selected.id)).toBe(
    cargo.target,
  );
  const coordinates = page.getByText('Recorded path coordinates', { exact: true });
  await coordinates.click();
  await page.locator('#logistics-window').selectOption('120');
  await page.locator('#logistics-stage').selectOption('carrying');
  const query = page.locator('#logistics-query');
  await query.fill('plank');
  await host.evaluate((el) => (el.scrollTop = 180));
  const scroll = await host.evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  const title = await report.locator('.report-titlebar h2').boundingBox();
  await page.mouse.move(title.x + 20, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x + 42, title.y + 20, { steps: 3 });
  await page.mouse.up();
  const resize = page.getByRole('button', { name: 'Resize Logistics window', exact: true });
  await resize.press('Shift+ArrowLeft');
  await resize.press('Shift+ArrowUp');
  const remembered = await report.boundingBox();
  expect(remembered.width).toBeLessThan(geometry.width);
  expect(remembered.height).toBeLessThan(geometry.height);
  await query.focus();
  await host.evaluate((el, scroll) => (el.scrollTop = scroll), scroll);
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.locator('[data-workspace="economy"]').press('Enter');
  const economy = page.getByRole('region', { name: 'Economy window', exact: true });
  await expect(economy).toBeVisible();
  await expect(report).toBeHidden();
  await page.getByRole('button', { name: 'Resize Economy window', exact: true }).press('ArrowLeft');
  const economyGeometry = await economy.boundingBox();
  await page.locator('[data-workspace="logistics"]').press('Enter');
  await expect(economy).toBeHidden();
  await expect(report).toBeVisible();
  expect(await report.boundingBox()).toEqual(remembered);
  await expect(query).toBeFocused();
  await expect(query).toHaveValue('plank');
  await expect(page.locator('#logistics-window')).toHaveValue('120');
  await expect(page.locator('#logistics-stage')).toHaveValue('carrying');
  await expect(coordinates.locator('..')).toHaveAttribute('open', '');
  expect(await host.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.evaluate(() => window.productionArtPreview.game.updateLogisticsView());
  await expect(query).toBeFocused();
  expect(await host.evaluate((el) => el.scrollTop)).toBe(scroll);
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  const age = await page.evaluate(() => window.productionArtPreview.game.state.time);
  await frame(page, 1100);
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBeGreaterThan(
    age,
  );
  expect(await page.evaluate(() => window.productionArtPreview.game.blockingLayerOpen())).toBe(
    false,
  );
  await expect(query).toBeFocused();
  await expect(coordinates.locator('..')).toHaveAttribute('open', '');
  await page.locator('[data-workspace="economy"]').press('Enter');
  expect(await economy.boundingBox()).toEqual(economyGeometry);
  await page.locator('[data-workspace="logistics"]').press('Enter');
  await page.locator('#logistics-detail [data-logistics-locate]').last().click();
  await expect(report).toBeHidden();
  await expectMapFocus(page);
  const point = await page.evaluate((id) => {
    const g = window.productionArtPreview.game,
      b = g.byId(id);
    return { x: ((b.x + 0.5) * g.TS - g.cam.x) * g.z, y: ((b.y + 0.5) * g.TS - g.cam.y) * g.z };
  }, cargo.target);
  const atlas = await page.locator('#workspace-nav').boundingBox(),
    dock = await page.locator('#inspectordock').boundingBox();
  const bar = await page.locator('#bar').boundingBox(),
    modes = await page.locator('#map-modes').boundingBox();
  expect(point.x).toBeGreaterThan(atlas.x + atlas.width);
  expect(point.x).toBeLessThan(dock.x);
  expect(point.y).toBeGreaterThan(bar.y + bar.height);
  expect(point.y).toBeLessThan(modes.y);
  await page.locator('[data-workspace="logistics"]').press('Enter');
  expect(await report.boundingBox()).toEqual(remembered);
  await expect(query).toHaveValue('plank');
  await expect(page.locator('#logistics-window')).toHaveValue('120');
  await expect(page.locator('#logistics-detail')).toContainText('Planks');
});
