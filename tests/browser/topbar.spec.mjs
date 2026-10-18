import { test, expect, bootStandard } from './helpers/test.mjs';

test.setTimeout(90000);
// Queued after transient help's 120 ms leave timer, so it runs once that has fired.
function afterLeaveTimer(page) {
  return page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)));
}
// The HUD redraws at most every 250 ms; tick until it shows the expected text.
async function expectHud(page, selector, text) {
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        window.productionArtPreview.game.hudTick();
        return document.querySelector(selector).textContent;
      }, selector),
    )
    .toBe(text);
}
async function settings(page) {
  await page.locator('#utility summary').click();
  await page.locator('#mixb').click();
}

// Reloads with remembered settings, then replaces Storage.prototype.setItem.
test('FPS is optional and settings honestly report persistence failures', async ({
  freshPage: page,
}) => {
  await bootStandard(page);
  await expect(page.locator('#fps')).toBeHidden();
  await settings(page);
  await page.getByRole('checkbox', { name: 'Show FPS counter' }).check();
  await expect(page.locator('#settings-status')).toContainText('Settings remembered');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settlers.prefs')).showFps),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fps')).toBeVisible();
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('#fps')).toBeVisible();
  await page.locator('#startb').click();
  await settings(page);
  await expect(page.getByRole('checkbox', { name: 'Show FPS counter' })).toBeChecked();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'settlers.prefs') throw new DOMException('Preferences quota exhausted');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('checkbox', { name: 'Show FPS counter' }).uncheck();
  await expect(page.locator('#settings-status')).toContainText('could not be remembered');
  await page.keyboard.press('Escape');
  await expect(page.locator('#fps')).toBeHidden();
});

test('only urgent save failure occupies the bar and opens file recovery', async ({ page }) => {
  await expect(page.locator('#atlas-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#save-recovery')).toBeHidden();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'settlers.autosave') throw new DOMException('Checkpoint storage is full');
      return original.call(this, key, value);
    };
    window.productionArtPreview.game.saveGame(true);
  });
  await expect(page.locator('#save-recovery')).toBeVisible();
  await expect(page.locator('#save-recovery')).toContainText('Save failed');
  await page.locator('#save-recovery').press('Enter');
  await expect(page.locator('#savedata')).toBeVisible();
  await expect(page.locator('#save-health')).toContainText('Checkpoint storage is full');
  const download = page.waitForEvent('download');
  await page.locator('#export-file').click();
  expect((await download).suggestedFilename()).toMatch(/2024.json$/);
});

test('population and stored-resource explanations support pointer reading, keyboard and Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.productionArtPreview.game.setMode('road'));
  await page.locator('#ppl').hover();
  const population = page.getByRole('tooltip').filter({ hasText: 'Carrier capacity' });
  await expect(population).toBeVisible();
  await expect(population).toContainText('Active carriers: 8');
  await expect(population).toContainText('Idle settler pool: 6');
  await expect(population).toContainText('Soldier pool: 3');
  const before = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    return { mode: g.mode, selected: g.selected?.id, time: g.state.time, paused: g.state.paused };
  });
  await population.hover();
  await afterLeaveTimer(page);
  await expect(population).toBeVisible();
  await population.click();
  expect(
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      return { mode: g.mode, selected: g.selected?.id, time: g.state.time, paused: g.state.paused };
    }),
  ).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(population).toBeHidden();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.type)).toBe('road');
  await page.mouse.move(900, 400);
  await page.locator('#goods [data-good="gold"]').focus();
  const gold = page.getByRole('tooltip').filter({ hasText: 'Gold stored stock' });
  await expect(gold).toBeVisible();
  await expect(gold).toContainText('Includes reserved stock');
  await expect(gold).toContainText('Banked objective progress is shown separately');
  await page.keyboard.press('Escape');
  await expect(gold).toBeHidden();
  await afterLeaveTimer(page);
  await expect(gold).toBeHidden();
  await page.evaluate(() => {
    document.getElementById('sp0').focus();
    document.querySelector('#goods [data-good="gold"]').focus();
  });
  await expect(gold).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-economy')).toBeVisible();
  await expect(page.locator('#economy-detail')).toContainText('Gold');
  await page.locator('#ppl').focus();
  await expect(population).toBeVisible();
  await settings(page);
  await expect(population).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(population).toBeHidden();
});

test('two compact rows retain dense stock, banked objective and essential controls at both desktop sizes', async ({
  page,
}) => {
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const hq = g.anyStorage();
    for (const good of Object.keys(g.GOODS)) hq.stock[good] = 98765;
    hq.stock.logs = 12345;
    hq.reservedStock.logs = 345;
    g.state.gold = 37;
  });
  await expectHud(page, '#goods [data-good="logs"] b', '12345');
  await expect(page.locator('#goods [data-good="gold"] b')).toHaveText('98765');
  await expect(page.locator('#goaltxt')).toHaveText('Banked gold 37 / 200');
  for (const [width, height, quality, motion] of [
    [1440, 900, '1', false],
    [1280, 720, '0.75', true],
  ]) {
    // Native focus immediately after resizing must never scroll the map viewport.
    await page.setViewportSize({ width, height });
    await settings(page);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
    await page.locator('#qualitypref').selectOption(quality);
    await page.locator('#motionpref').setChecked(motion);
    await page.getByRole('checkbox', { name: 'Show FPS counter' }).check();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
    await expect.poll(() => page.evaluate(() => window.productionArtPreview.game.vw)).toBe(width);
    const bar = await page.locator('#bar').boundingBox();
    expect(bar.height).toBeLessThanOrEqual(68);
    const fit = await page.locator('#bar').evaluate((bar) => {
      const bounds = bar.getBoundingClientRect();
      return [
        ...bar.querySelectorAll(
          '#goods [data-good],#objective,#spd,.speedcontrols,#autob,#ppl,#fps,#utility summary',
        ),
      ].map((node) => {
        const box = node.getBoundingClientRect();
        return {
          id: node.id || node.dataset.good || node.className,
          x: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          fits: node.scrollWidth <= node.clientWidth + 1,
          barBottom: bounds.bottom,
        };
      });
    });
    expect(fit).toHaveLength(24);
    expect(
      fit.filter(
        (box) =>
          box.x < 0 || box.right > width || box.top < 0 || box.bottom > box.barBottom || !box.fits,
      ),
    ).toEqual([]);
    await expect(page.locator('#ppl')).toHaveText('8 carriers');
    await page.locator('#sp0').click();
    await expectHud(page, '#spd', 'PAUSED');
    await settings(page);
    await expectHud(page, '#spd', 'SUSPENDED · 1×');
    await page.keyboard.press('Escape');
    await page.locator('#sp1').click();
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.anyStorage().reservedStock.logs = 0;
      g.state.won = true;
      g.state.gold = 37;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'settlers.autosave') throw new DOMException('Checkpoint storage is full');
        return original.call(this, key, value);
      };
      g.saveGame(true);
    });
    await expectHud(page, '#goaltxt', '✓ Goal achieved · 37 banked');
    await expect(page.locator('#save-recovery')).toBeInViewport();
    await expect(page.locator('#utility summary')).toBeInViewport();
    const camera = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
    await settings(page);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(
      camera,
    );
    const point = await page.evaluate(() => {
      const g = window.productionArtPreview.game,
        hq = g.anyStorage(),
        r = g.view.getBoundingClientRect();
      return {
        x: r.left + ((hq.x + 0.5) * g.TS - g.cam.x) * g.z,
        y: r.top + ((hq.y + 0.5) * g.TS - g.cam.y) * g.z,
      };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('#infobody')).toContainText('Headquarters');
  }
});
