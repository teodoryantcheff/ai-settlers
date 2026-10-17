import { test, expect } from './helpers/test.mjs';
test.setTimeout(120000);
async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
    );
    window.requestAnimationFrame = (callback) => {
      window.__inspectorFrame = callback;
      return 0;
    };
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => window.__inspectorFrame(1000));
  await page.locator('#startb').press('Enter');
  await page.locator('#sp0').press('Enter');
  await page.waitForFunction(() => {
    const g = window.productionArtPreview.game;
    g.hudTick();
    return document.getElementById('spd').textContent === 'PAUSED';
  });
}
test('inspector shows live stock while preserving native target focus and exact demolition confirmation', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('warehouse', 51, 48);
    Object.assign(b, { done: true, constructionProgress: 1, stock: { planks: 7, stone: 3 } });
    g.buildings.push(b);
    g.inspectContributor(b.id);
    g.updateInfo();
  });
  await expect(page.locator('[data-inspector-live]')).toContainText('7 Planks');
  await page.locator('#infobody details').first().locator('summary').click();
  const target = page.locator('[data-target="planks"]');
  await target.fill('17');
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.selected.stock.planks = 9;
    g.state.paused = false;
    g.step(2);
    g.updateInfo();
  });
  await expect(target).toBeFocused();
  await expect(target).toHaveValue('17');
  await expect(page.locator('[data-inspector-live]')).toContainText('9 Planks');
  await page.locator('#dz').click();
  await expect(page.locator('#demolition-dialog')).toBeVisible();
  await expect(page.locator('#demolition-evidence')).toContainText('Construction refund');
  await expect(page.locator('#demolition-evidence')).toContainText('Local stock salvage');
  await expect(page.locator('#demolition-evidence')).toContainText('9 Planks');
  await page.locator('#demolition-cancel').click();
  expect(
    await page.evaluate(() =>
      window.productionArtPreview.game.buildings.some((b) => b.type === 'warehouse'),
    ),
  ).toBe(true);
  await page.locator('#dz').click();
  await page.locator('#demolition-confirm').click();
  expect(
    await page.evaluate(() =>
      window.productionArtPreview.game.buildings.some((b) => b.type === 'warehouse'),
    ),
  ).toBe(false);
  await expect(page.locator('#infobody')).toContainText('was demolished');
});

test('producer, construction and outpost inspectors expose evidence and retain focused controls', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('bakery', 51, 48);
    Object.assign(b, { done: true, constructionProgress: 1, stock: { flour: 2 }, disabled: false });
    g.buildings.push(b);
    const well = g.newBuilding('well', 52, 50);
    Object.assign(well, { done: true, constructionProgress: 1 });
    g.buildings.push(well);
    g.state.paused = false;
    g.step(16);
    g.state.paused = true;
    g.inspectContributor(b.id);
    g.updateInfo();
  });
  await expect(page.locator('[data-inspector-live]')).toContainText('Local water');
  await expect(page.locator('.production-dashboard')).toContainText('Observed');
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
    await page.screenshot({ path: test.info().outputPath('inspector-producer-' + width + '.png') });
  }
  const toggle = page.locator('[data-production]');
  await toggle.click();
  await expect(toggle).toHaveText('Resume production');
  await expect(toggle).toBeFocused();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.upgrades.production = 1;
    g.updateInfo();
  });
  await expect(page.locator('#infobody')).toContainText('Bread / 10.8s');
  await expect(toggle).toBeFocused();
  await expect(page.locator('[data-inspector-live]')).toContainText('paused');
  await toggle.click();
  await expect(toggle).toHaveText('Pause production');
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('farm', 54, 48);
    b.got = { planks: 1, stone: 2, tools: 1 };
    b.constructionProgress = 0.25;
    g.buildings.push(b);
    g.inspectContributor(b.id);
    g.updateInfo();
  });
  const priority = page.locator('[data-priority]');
  await priority.selectOption('2');
  await priority.focus();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.selected.constructionProgress = 0.5;
    g.updateInfo();
  });
  await expect(priority).toBeFocused();
  await expect(priority).toHaveValue('2');
  await expect(page.locator('[data-inspector-live]')).toContainText('Construction 50%');
  await page.locator('#dz').click();
  await expect(page.locator('#demolition-evidence')).toContainText(
    'Delivered construction goods only',
  );
  await expect(page.locator('#demolition-evidence')).toContainText('1 Stone');
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
    await page.screenshot({
      path: test.info().outputPath('inspector-demolition-' + width + '.png'),
    });
  }
  await page.locator('#demolition-cancel').click();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('guard', 57, 48);
    Object.assign(b, { done: true, constructionProgress: 1, manned: true });
    g.buildings.push(b);
    g.recomputeTerritory();
    g.inspectContributor(b.id);
    g.updateInfo();
  });
  await expect(page.locator('[data-inspector-live]')).toContainText('Manned outpost');
  await page.locator('#dz').click();
  await expect(page.locator('#demolition-evidence')).toContainText('Soldiers returned');
  await expect(page.locator('#demolition-evidence')).toContainText('Equipment returned');
  await page.locator('#demolition-cancel').click();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.inspectContributor(g.anyStorage().id);
    g.updateInfo();
  });
  await page.locator('#dz').click();
  await expect(page.locator('#demolition-confirm')).toBeDisabled();
  await expect(page.locator('#demolition-evidence')).toContainText('headquarters cannot');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dz')).toBeFocused();
});

test('demolition hover presents exact recovery before the deliberate Shift shortcut', async ({
  page,
}) => {
  await boot(page);
  const point = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('farm', 51, 48);
    Object.assign(b, { done: true, constructionProgress: 1, stock: { grain: 5 } });
    g.buildings.push(b);
    g.activateTool('demolish');
    g.resize();
    const r = g.view.getBoundingClientRect();
    return {
      x: r.left + (51 * g.TS - g.cam.x) * g.z,
      y: r.top + (48 * g.TS - g.cam.y) * g.z,
      id: b.id,
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => window.productionArtPreview.game.updateHint());
  await expect(page.locator('#placement-feedback')).toContainText('Refund:');
  await expect(page.locator('#placement-feedback')).toContainText('1 Planks');
  await expect(page.locator('#placement-feedback')).toContainText('5 Grain');
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
  expect(
    await page.evaluate((id) => window.productionArtPreview.game.byId(id), point.id),
  ).toBeNull();
  await expect(page.locator('#demolition-dialog')).toBeHidden();
});

test('real producer countdown suspends for a full batch and resumes without losing work or native focus', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.units.length = 0;
    g.spawnT = 1e6;
    const b = g.newBuilding('lumberjack', 51, 48);
    Object.assign(b, { done: true, constructionProgress: 1, timer: 3, stock: { logs: 8 } });
    g.buildings.push(b);
    g.tiles[g.idx(52, 48)].tree = 4;
    g.step(0.25);
    g.inspectContributor(b.id);
    g.updateInfo();
  });
  await expect(page.locator('.inspector-status p').first()).toContainText('Output blocked');
  await expect(page.locator('[data-cycle-countdown]')).toHaveText('3.0s remaining · suspended');
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
    await page.screenshot({
      path: test.info().outputPath(`producer-countdown-blocked-${width}.png`),
    });
  }
  const windowControl = page.locator('[data-rate-window]');
  await windowControl.focus();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.selected.stock.logs = 6;
    g.updateInfo();
  });
  await expect(page.locator('[data-cycle-countdown]')).toHaveText(
    '3.0s remaining · simulation held',
  );
  await expect(windowControl).toBeFocused();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.paused = false;
    g.step(1);
    g.updateInfo();
  });
  await expect(windowControl).toBeFocused();
  await expect(page.locator('[data-cycle-countdown]')).toHaveText(
    '2.0s of work remaining at current speed',
  );
  await expect(page.locator('.inspector-status p').first()).not.toContainText('blocked');
  const toggle = page.locator('[data-production]');
  await toggle.click();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.step(1);
    g.updateInfo();
  });
  await expect(toggle).toBeFocused();
  await expect(page.locator('[data-cycle-countdown]')).toHaveText('2.0s remaining · suspended');
  await toggle.click();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.step(2);
    g.updateInfo();
  });
  await expect(toggle).toBeFocused();
  await expect(page.locator('[data-inspector-live]')).toContainText('8 Logs');
  await expect(page.locator('[data-cycle-countdown]')).toHaveText('7.0s remaining · suspended');
  expect(
    await page.evaluate(() => window.productionArtPreview.game.selected.metrics.produced.logs),
  ).toBe(2);
});

test('loading a replacement colony discards stale inspector edits and disclosures for reused building IDs', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('warehouse', 51, 48);
    Object.assign(b, { done: true, constructionProgress: 1, targets: { planks: 7 } });
    g.buildings.push(b);
    g.inspectContributor(b.id);
    g.updateInfo();
    window.__inspectorSave = g.exportSave();
    window.__inspectorBuildingId = b.id;
  });
  const details = page.locator('#infobody details').first();
  await details.locator('summary').click();
  const target = page.locator('[data-target="planks"]');
  await target.fill('17');
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.importSave(window.__inspectorSave);
    g.inspectContributor(window.__inspectorBuildingId);
    g.updateInfo();
  });
  await expect(target).toHaveValue('7');
  await expect(details).not.toHaveAttribute('open');
  expect(await page.evaluate(() => window.productionArtPreview.game.selected.targets.planks)).toBe(
    7,
  );
});

test('completion preserves a focused construction priority until focus leaves, then mounts producer controls', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const b = g.newBuilding('farm', 51, 48);
    g.buildings.push(b);
    g.inspectContributor(b.id);
    g.updateInfo();
  });
  const priority = page.locator('[data-priority]');
  await priority.selectOption('2');
  await priority.focus();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    Object.assign(g.selected, { done: true, constructionProgress: 1 });
    g.updateInfo();
  });
  await expect(priority).toBeFocused();
  await expect(page.locator('[data-inspector-live]')).not.toContainText('Construction 0%');
  await page.locator('#ic').focus();
  await expect(page.locator('[data-production]')).toHaveText('Pause production');
  await expect(page.locator('[data-priority]')).toHaveCount(0);
  await expect(page.locator('#ic')).toBeFocused();
});
