import { test, expect } from './helpers/test.mjs';
import { openAtlas } from './helpers/atlas.mjs';
test.setTimeout(120000);
async function boot(page, quality = 0.75) {
  await page.addInitScript((quality) => {
    window.requestAnimationFrame = (callback) => {
      window.__progressionFrame = callback;
      return 0;
    };
    if (!localStorage.getItem('settlers.prefs'))
      localStorage.setItem(
        'settlers.prefs',
        JSON.stringify({ quality, reducedMotion: true, weather: false, muted: true }),
      );
  }, quality);
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game);
  await page.evaluate(() => window.__progressionFrame(1000));
  await page.locator('#startb').click();
}
test('V opens Colony guidance over the live map and retains native window context', async ({
  page,
}) => {
  await boot(page, 1);
  await expect(page.locator('#adv')).toBeHidden();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.setMode('road');
    g.anchor = { x: 48, y: 48 };
    g.keys.r = true;
    g.ghost = { x: 49, y: 48 };
  });
  const before = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await page.keyboard.press('v');
  const window = page.getByRole('region', { name: 'Colony window', exact: true });
  await expect(window).toBeVisible();
  await expect(page.locator('#adv')).toBeVisible();
  await expect(page.locator('#colony-guidance')).toHaveAttribute('open', '');
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return {
        mode: g.mode,
        anchor: g.anchor,
        held: g.keys.r,
        ghost: g.ghost,
        cam: { ...g.cam },
      };
    }),
  ).toEqual({ mode: null, anchor: null, held: false, ghost: null, cam: before });
  await page.locator('#colony-lesson-build').click();
  await expect(window).toBeHidden();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode)).toEqual({
    type: 'build',
    bt: 'lumberjack',
  });
  await page.keyboard.press('v');
  await expect(window).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.locator('#colony-guidance')).not.toHaveAttribute('open', '');
  await expect(page.locator('#objective')).toBeVisible();
  await expect(page.locator('#autob')).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.locator('#colony-guidance')).toHaveAttribute('open', '');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Move Colony window', exact: true }).focus();
    await page.keyboard.press('Shift+ArrowDown');
    const oldSize = await window.boundingBox();
    await page.getByRole('button', { name: 'Resize Colony window', exact: true }).focus();
    await page.keyboard.press('Shift+ArrowLeft');
    expect((await window.boundingBox()).width).toBe(oldSize.width - 48);
    const box = await window.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await page.locator('#advdetails summary').click();
    await page.locator('#advdetails summary').focus();
    const scroll = await page.locator('#workspace-colony').evaluate((el) => el.scrollTop);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await expect(page.locator('#advdetails summary')).toBeFocused();
    expect(await window.boundingBox()).toEqual(box);
    expect(await page.locator('#workspace-colony').evaluate((el) => el.scrollTop)).toBe(scroll);
    await page.screenshot({ path: test.info().outputPath(`colony-guidance-${width}.png`) });
  }
});

test('Advisor keeps live action focus, and V respects native input and blocking utilities', async ({
  page,
}) => {
  await boot(page);
  const id = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const hq = g.anyStorage();
    for (const [type, offset] of [
      ['lumberjack', 1],
      ['sawmill', 2],
    ]) {
      const b = g.newBuilding(type, hq.x + offset, hq.y);
      b.done = true;
      g.buildings.push(b);
    }
    const armory = g.newBuilding('armory', hq.x + 3, hq.y);
    Object.assign(armory, {
      done: true,
      constructionProgress: 1,
      stock: { coal: 1 },
    });
    armory.metrics.elapsed = 60;
    armory.metrics.inputBlocked = 60;
    g.buildings.push(armory);
    g.hudTick();
    return armory.id;
  });
  await page.keyboard.press('v');
  const advice = page.locator(`#adv [data-focus="${id}"]`);
  await advice.focus();
  await page.waitForTimeout(300);
  await page.evaluate((id) => {
    const g = window.productionArtPreview.game;
    g.anyStorage().stock.iron_bars = 1;
    g.hudTick();
  }, id);
  await expect(advice).toBeFocused();
  await expect(advice).toContainText('Improve Armory deliveries');
  await advice.press('Enter');
  await expect(page.getByRole('region', { name: 'Colony window', exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.productionArtPreview.game.selected.id)).toBe(id);
  await page.keyboard.press('v');
  await page.locator('#utility summary').click();
  await page.locator('#saveb').click();
  await page.locator('#checkpoint-name').fill('Colony');
  await page.locator('#checkpoint-name').press('v');
  await expect(page.locator('#checkpoint-name')).toHaveValue('Colonyv');
  await expect(page.locator('#colony-guidance')).toHaveAttribute('open', '');
  await page.locator('#close-saves').focus();
  await page.keyboard.press('v');
  await expect(page.locator('#savedata')).toBeVisible();
  await expect(page.locator('#colony-guidance')).toHaveAttribute('open', '');
  await page.locator('#close-saves').click();
  await page.locator('#goods [data-good="gold"]').click();
  await expect(page.getByRole('region', { name: 'Economy window', exact: true })).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.getByRole('region', { name: 'Economy window', exact: true })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Colony window', exact: true })).toBeVisible();
});

test('Colony connects live Journey actions, spending conditions and saved autoplay state', async ({
  page,
}) => {
  await boot(page);
  await openAtlas(page);
  await page.locator('[data-workspace="colony"]').click();
  await expect(page.locator('#colony-journey-body')).toContainText('Start the timber chain');
  await page.locator('#colony-lesson-build').click();
  await expect(page.locator('#view')).toBeVisible();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode)).toEqual({
    type: 'build',
    bt: 'lumberjack',
  });
  await page.keyboard.press('Escape');
  await openAtlas(page);
  await page.locator('[data-workspace="colony"]').click();
  await expect(page.locator('#upgrade-haul')).toBeDisabled();
  await expect(page.locator('[data-progression-card="upgrade-haul"]')).toContainText(
    'Need 15 more Gold',
  );
  await page.locator('#contract-0').click();
  await page.locator('#contract-2').click();
  await expect(page.locator('#upgrade-haul')).toBeEnabled();
  await expect(page.locator('[data-progression-card="upgrade-haul"]')).toContainText(
    'Spend 15 Gold',
  );
  await page.locator('#upgrade-haul').click();
  await expect(page.locator('#economybody h2').first()).toBeFocused();
  expect(
    await page.evaluate(() => ({
      gold: window.productionArtPreview.game.state.gold,
      spent: window.productionArtPreview.game.state.spentGold,
      level: window.productionArtPreview.game.state.upgrades.haul,
    })),
  ).toEqual({ gold: 2, spent: 15, level: 1 });
  await expect(page.locator('[data-progression-card="upgrade-haul"]')).toContainText(
    'Need 28 more Gold',
  );
  await page.locator('#availability-upgrade-haul-summary').click();
  await page.locator('#availability-upgrade-haul-summary').focus();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.claimContract(5);
    g.gameplayHUD();
  });
  await expect(page.locator('#availability-upgrade-haul-summary')).toBeFocused();
  await expect(page.locator('#availability-upgrade-haul')).toHaveAttribute('open', '');
  await expect(page.locator('#availability-upgrade-haul')).toContainText('12 available');

  await page.locator('#colony-journey summary').click();
  await expect(page.locator('#colony-journey-body')).toBeHidden();
  await page.locator('#colony-autoplay').click();
  await expect(page.locator('#colony-auto-status')).toContainText('Enabled');
  await expect(page.locator('#autob')).toHaveText('AUTO ON');
  await page.evaluate(() => window.productionArtPreview.game.saveCheckpoint('Managed colony'));
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.locator('#continueb').click();
  await page.evaluate(() => window.__progressionFrame(1000));
  await page.evaluate(() => window.productionArtPreview.game.gameplayHUD());
  await expect(page.locator('#autob')).toHaveText('AUTO ON');
  await openAtlas(page);
  await page.locator('[data-workspace="colony"]').click();
  await expect(page.locator('#colony-auto-status')).toContainText('Enabled');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#colony-objective').scrollIntoViewIfNeeded();
    await expect(page.locator('#goods .gd')).toHaveCount(17);
    await page.screenshot({ path: test.info().outputPath(`colony-${width}.png`) });
    await page.locator('#availability-upgrade-haul-summary').scrollIntoViewIfNeeded();
    if (!(await page.locator('#availability-upgrade-haul').evaluate((element) => element.open)))
      await page.locator('#availability-upgrade-haul-summary').click();
    await page.screenshot({ path: test.info().outputPath(`colony-stock-${width}.png`) });
  }
});

test('Colony explains and spends reclaimable optional warehouse promises exactly once', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.anyStorage().stock.planks = 12;
    const warehouse = g.newBuilding('warehouse', 54, 48);
    warehouse.done = true;
    warehouse.targets.planks = 12;
    g.buildings.push(warehouse);
    g.recomputeTerritory();
    g.step(1 / 60);
    g.gameplayHUD();
  });
  await page.keyboard.press('v');
  const card = page.locator('[data-progression-card="contract-0"]');
  await expect(page.locator('#contract-0')).toBeEnabled();
  await expect(card).toContainText(
    'Spending would reclaim 2 Planks from uncollected optional warehouse transfers',
  );
  await page.locator('#availability-contract-0-summary').click();
  await expect(card).toContainText('12 required; 10 available; 2 reserved');
  await expect(card).toContainText('12 spendable');
  await page.locator('#contract-0').click();
  await expect(page.locator('#contract-0')).toBeDisabled();
  await expect(card).toContainText('can only be fulfilled once.');
  await expect(page.locator('#economybody h2').first()).toBeFocused();
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return {
        planks: g.totalGood('planks'),
        gold: g.state.gold,
        tools: g.totalGood('tools'),
        transfers: g.jobs.filter((j) => j.kind === 'transfer' && j.good === 'planks').length,
      };
    }),
  ).toEqual({ planks: 0, gold: 5, tools: 20, transfers: 0 });
  await expect(page.locator('[data-progression-card="contract-2"]')).toContainText(
    'Need 18 more Planks',
  );
});

test('earned victory stays achieved after spending and continues through Home without rollback', async ({
  page,
}) => {
  // Generate the acceptance colony with the real production graph and normal fixed steps.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createGame } = require('../helpers/game.cjs');
  const { game } = createGame({
    seed: 42,
    headless: true,
    modules: ['world', 'state', 'map', 'navigation', 'economy'],
  });
  game.initializeColony();
  game.state.auto = true;
  for (let i = 0; i < 7200 * 60 && game.state.gold < 199; i++) game.step(1 / 60);
  expect(game.state.gold).toBe(199);
  expect(game.state.won).toBe(false);
  const raw = game.exportSave();
  await boot(page, 1);
  await page.evaluate((raw) => {
    const game = window.productionArtPreview.game;
    game.importSave(raw);
    for (let i = 0; i < 60 * 60 && !game.state.won; i++) game.step(1 / 60);
    game.gameplayHUD();
    game.hudTick();
    game.drawMini();
    game.draw();
  }, raw);
  await expect(page.locator('#win')).toBeVisible();
  await expect(page.locator('#winstats')).toContainText('Simulation age');
  await expect(page.locator('#winstats')).toContainText('Produced gold delivered to storage');
  await expect(page.locator('#winstats')).toContainText('Recorded from 0.0');
  expect(
    await page.evaluate(() => ({
      gold: window.productionArtPreview.game.state.gold,
      won: window.productionArtPreview.game.state.won,
    })),
  ).toEqual({ gold: 200, won: true });
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#wingo')).toBeInViewport();
    await expect(page.locator('#winhome')).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`victory-${width}.png`) });
  }
  await page.locator('#wingo').click();
  await expect(page.locator('#win')).toBeHidden();
  await openAtlas(page);
  await page.locator('[data-workspace="colony"]').click();
  await page.locator('#colony-autoplay').click();
  await expect(page.locator('#colony-auto-status')).toContainText('Off');
  await page.locator('#upgrade-haul').click();
  expect(
    await page.evaluate(() => ({
      gold: window.productionArtPreview.game.state.gold,
      won: window.productionArtPreview.game.state.won,
    })),
  ).toEqual({ gold: 185, won: true });
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.step(1 / 60);
    g.gameplayHUD();
    g.hudTick();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.productionArtPreview.game.hudTick();
        return document.getElementById('goaltxt').textContent;
      }),
    )
    .toContain('Goal achieved');
  await expect(page.locator('#colony-objective')).toContainText(
    'Later spending keeps the achievement',
  );
  await openAtlas(page);
  await page.locator('[data-workspace="economy"]').click();
  await expect(page.locator('#workspace-economy')).toBeVisible();
  const age = await page.evaluate(() => window.productionArtPreview.game.state.time);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.step(1 / 60);
    g.hudTick();
  });
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBeGreaterThan(
    age,
  );
  await openAtlas(page);
  await page.locator('[data-workspace="colony"]').click();
  await page.locator('#colony-achievement').click();
  await page.locator('#winhome').click();
  const current = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await expect(page.locator('#start')).toBeVisible();
  await page.locator('#continueb').click();
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(current);
});
