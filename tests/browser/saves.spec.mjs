import { test, expect } from './helpers/test.mjs';

test.setTimeout(60000);
async function openSaves(page) {
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.hudTick();
    game.drawMini();
    game.draw();
  });
  await page.locator('#utility summary').click();
  await page.locator('#savepanelb').click();
  await expect(page.locator('#savedata')).toBeVisible();
}

test('checkpoint metadata, rename, confirmations, separate autosave and files work in the real game', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSaves(page);
  await page.locator('#colony-name').fill('Riverbend');
  await page.locator('#colony-name').press('Tab');
  await page.locator('#checkpoint-name').fill('Before expansion');
  await page.locator('#create-checkpoint').click();
  const first = page
    .locator('.save-entry')
    .filter({ has: page.getByText('Before expansion', { exact: true }) });
  await expect(first).toContainText('Riverbend · Seed 2024');
  await expect(first).toContainText('0.0 simulation seconds · 0 gold · 1 building');
  await first.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.locator('#rename-checkpoint').fill('Timber reserve');
  await page.locator('#confirm-save-action').click();
  const renamed = page
    .locator('.save-entry')
    .filter({ has: page.getByText('Timber reserve', { exact: true }) });
  await expect(renamed).toBeVisible();
  await expect(renamed.getByRole('button', { name: 'Rename', exact: true })).toBeFocused();
  await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#save-confirm')).toBeHidden();
  await expect(page.locator('#savedata')).toBeVisible();
  await expect(renamed).toBeVisible();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.step(0.25);
    game.saveAutosave();
    game.refreshSaveManager();
  });
  await expect(page.locator('.save-entry')).toHaveCount(2);
  await expect(
    page.locator('.save-entry').filter({ has: page.getByText('Autosave', { exact: true }) }),
  ).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('settlers.saves.v1'));
  await renamed.getByRole('button', { name: 'Overwrite', exact: true }).click();
  await expect(page.locator('#save-confirm')).toContainText('Overwrite Timber reserve');
  expect(await page.evaluate(() => localStorage.getItem('settlers.saves.v1'))).toBe(before);
  await page.locator('#cancel-save-action').click();
  await renamed.getByRole('button', { name: 'Overwrite', exact: true }).click();
  await page.locator('#confirm-save-action').click();
  await expect(renamed).toContainText('0.3 simulation seconds');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-file').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Riverbend-2024.json');
  const json = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.locator('#import-file').setInputFiles({
    name: 'riverbend.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });
  await expect(page.locator('#save-confirm')).toContainText('Import Riverbend');
  await page.locator('#confirm-save-action').click();
  await expect(page.locator('#savedata')).toBeHidden();
  await page.locator('#utility summary').click();
  await page.locator('#savepanelb').click();
  await expect(page.locator('.save-entry')).toHaveCount(3);
  await page
    .locator('.save-entry')
    .filter({ hasText: 'Imported checkpoint' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await page.locator('#confirm-save-action').click();
  await expect(page.locator('.save-entry')).toHaveCount(2);
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#create-checkpoint')).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`saves-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('storage failure preserves valid checkpoints, reports quiet autosave failure and allows file export', async ({
  page,
}) => {
  await openSaves(page);
  await page.locator('#checkpoint-name').fill('Safe checkpoint');
  await page.locator('#create-checkpoint').click();
  const prior = await page.evaluate(() => localStorage.getItem('settlers.saves.v1'));
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'settlers.saves.v1' || key === 'settlers.autosave.v1')
        throw new DOMException('Browser storage quota exhausted', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    window.productionArtPreview.game.step(0.25);
    window.productionArtPreview.game.saveGame(true);
  });
  await expect(page.locator('#save-health')).toContainText('quota exhausted');
  await expect(page.locator('#save-recovery')).toContainText('Save failed');
  await expect(page.locator('#save-health')).toContainText(
    'Previous valid checkpoints are preserved',
  );
  await page.locator('#create-checkpoint').click();
  await expect(page.locator('#save-status')).toContainText('quota exhausted');
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: test.info().outputPath(`save-failure-${width}.png`) });
  }
  expect(await page.evaluate(() => localStorage.getItem('settlers.saves.v1'))).toBe(prior);
  await page.locator('.save-entry').getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('#save-confirm')).toContainText(
    'Current unsaved progress will be replaced',
  );
  await page.locator('#cancel-save-action').click();
  const validImport = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.locator('#savecode').fill(validImport);
  await page.locator('#pastecode').click();
  await page.locator('#confirm-save-action').click();
  await expect(page.locator('#save-status')).toContainText('quota exhausted');
  expect(await page.evaluate(() => localStorage.getItem('settlers.saves.v1'))).toBe(prior);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-file').click();
  await downloadPromise;
  await page.locator('#savecode').fill('{"v":2,"t":[]}');
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#pastecode').click();
    await expect(page.locator('#save-status')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#save-status')).toBeInViewport();
    await expect(page.locator('#pastecode')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`invalid-import-${width}.png`) });
  }
  expect(await page.evaluate(() => localStorage.getItem('settlers.saves.v1'))).toBe(prior);
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBe(0.25);
});
