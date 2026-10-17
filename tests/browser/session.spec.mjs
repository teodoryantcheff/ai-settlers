import { test, expect } from './helpers/test.mjs';
test.setTimeout(60000);
async function boot(page) {
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__sessionFrame = callback;
      return 0;
    };
    if (localStorage.getItem('settlers.prefs') === null)
      localStorage.setItem(
        'settlers.prefs',
        JSON.stringify({ quality: 0.75, reducedMotion: true, weather: false }),
      );
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game);
  await page.evaluate(() => window.__sessionFrame(1000));
}
async function frame(page, time) {
  await page.evaluate((time) => window.__sessionFrame(time), time);
}
async function menu(page) {
  if (!(await page.locator('#utility').evaluate((element) => element.open)))
    await page.locator('#utility summary').click();
}
async function snapshot(page) {
  return page.evaluate(() => window.productionArtPreview.game.exportSave());
}
async function speedLabel(page, text) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.productionArtPreview.game.hudTick();
        return document.getElementById('spd').textContent;
      }),
    )
    .toBe(text);
}

test('named seeded colony, guarded replacement and Home Continue preserve the actual live world', async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator('#continueb')).toBeDisabled();
  await expect(page.locator('#start')).toContainText('200 gold');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#startb')).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`first-welcome-${width}.png`) });
  }
  await page.locator('#new-colony-name').fill('Oakbridge');
  await page.locator('#new-colony-seed').fill('42');
  await page.locator('#startb').click();
  expect(
    await page.evaluate(() => ({
      name: window.productionArtPreview.game.colonyName,
      seed: window.productionArtPreview.game.seed,
      time: window.productionArtPreview.game.state.time,
    })),
  ).toEqual({ name: 'Oakbridge', seed: 42, time: 0 });
  await page.evaluate(() => window.productionArtPreview.game.saveCheckpoint('Initial colony'));
  await frame(page, 1100);
  const before = await snapshot(page);
  await menu(page);
  await page.locator('#homeb').click();
  await frame(page, 1200);
  await expect(page.locator('#continueb')).toBeEnabled();
  expect(await snapshot(page)).toBe(before);
  await page.locator('#continueb').click();
  expect(await snapshot(page)).toBe(before);
  await menu(page);
  await page.locator('#mixb').click();
  await page.locator('#speedpref').selectOption('8');
  await page.keyboard.press('Escape');
  const beforeReplacement = await snapshot(page);
  await menu(page);
  await page.locator('#homeb').click();
  await page.locator('#new-colonyb').click();
  await page.locator('#new-colony-name').fill('Harbor');
  await page.locator('#new-colony-seed').fill('123');
  await page.locator('#startb').click();
  await expect(page.locator('#session-confirm')).toContainText(
    'Current unsaved progress will be replaced',
  );
  expect(await snapshot(page)).toBe(beforeReplacement);
  await page.locator('#cancel-new-colony').click();
  expect(await snapshot(page)).toBe(beforeReplacement);
  await page.locator('#startb').click();
  await page.locator('#confirm-new-colony').click();
  expect(
    await page.evaluate(() => ({
      name: window.productionArtPreview.game.colonyName,
      seed: window.productionArtPreview.game.seed,
      time: window.productionArtPreview.game.state.time,
      coverage: window.productionArtPreview.game.economicWindow('lifetime').available,
      speed: window.productionArtPreview.game.state.speed,
      quality: window.productionArtPreview.game.presentationPrefs.quality,
    })),
  ).toEqual({ name: 'Harbor', seed: 123, time: 0, coverage: false, speed: 8, quality: 0.75 });
  expect(
    await page.evaluate(() => window.productionArtPreview.game.listSaves()[0].colonyName),
  ).toBe('Oakbridge');
  await menu(page);
  await page.locator('#homeb').click();
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#continueb')).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`welcome-${width}.png`) });
  }
  const harbor = await snapshot(page);
  await page.locator('#load-colonyb').click();
  await expect(page.locator('#savedata')).toBeVisible();
  await page.locator('.save-entry').getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('#save-confirm')).toContainText(
    'Current unsaved progress will be replaced',
  );
  await page.keyboard.press('Escape');
  expect(await snapshot(page)).toBe(harbor);
  await page.locator('.save-entry').getByRole('button', { name: 'Load', exact: true }).click();
  await page.locator('#confirm-save-action').click();
  await expect(page.locator('#start')).toBeHidden();
  expect(
    await page.evaluate(() => ({
      name: window.productionArtPreview.game.colonyName,
      seed: window.productionArtPreview.game.seed,
      age: window.productionArtPreview.game.state.time,
      blocked: window.productionArtPreview.game.blockingLayerOpen(),
    })),
  ).toEqual({ name: 'Oakbridge', seed: 42, age: 0, blocked: false });
});

test('initial Continue loads the validated checkpoint rather than a new seed world', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#new-colony-name').fill('Saved colony');
  await page.locator('#new-colony-seed').fill('42');
  await page.locator('#startb').click();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.step(2);
    game.saveCheckpoint('Two seconds');
  });
  const saved = await snapshot(page);
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('#continueb')).toBeEnabled();
  await expect(page.locator('#welcome-continuation')).toContainText('Saved colony');
  await page.locator('#continueb').click();
  expect(await snapshot(page)).toBe(saved);
});

test('nested settings preserve running and paused states, native input, persistence and failed writes', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#startb').click();
  await frame(page, 1100);
  const time = await page.evaluate(() => window.productionArtPreview.game.state.time);
  await menu(page);
  await page.locator('#mixb').click();
  await frame(page, 1200);
  await expect(page.locator('#speedpref')).toBeFocused();
  await speedLabel(page, 'SUSPENDED · 1×');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBe(time);
  await page.locator('#settings-help').click();
  await frame(page, 1300);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mix')).toBeVisible();
  await expect(page.locator('#settings-help')).toBeFocused();
  await page.locator('#speedpref').selectOption('4');
  await speedLabel(page, 'SUSPENDED · 4×');
  await page.locator('#motionpref').check();
  await page.locator('#qualitypref').selectOption('1');
  await page.locator('#advisorpref').uncheck();
  await page.locator('#mutepref').check();
  await expect(page.locator('#settings-status')).toContainText('remembered');
  await page.keyboard.press('Escape');
  await frame(page, 1400);
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBeGreaterThan(
    time,
  );
  await speedLabel(page, '4×');
  await page.locator('#sp0').click();
  await menu(page);
  await page.locator('#mixb').click();
  await page.locator('#settings-help').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(true);
  await speedLabel(page, 'PAUSED');
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.locator('#welcome-settings').click();
  await expect(page.locator('#motionpref')).toBeChecked();
  await expect(page.locator('#qualitypref')).toHaveValue('1');
  await expect(page.locator('#advisorpref')).not.toBeChecked();
  await expect(page.locator('#mutepref')).toBeChecked();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'settlers.prefs')
        throw new DOMException('Settings quota exhausted', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('#qualitypref').selectOption('0.75');
  await expect(page.locator('#settings-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#settings-status')).toContainText('quota exhausted');
  expect(
    await page.evaluate(() => window.productionArtPreview.game.presentationPrefs.quality),
  ).toBe(0.75);
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: test.info().outputPath(`settings-${width}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#start')).toBeVisible();
  await page.locator('#welcome-about').click();
  await expect(page.locator('#about')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#welcome-about')).toBeFocused();
});
