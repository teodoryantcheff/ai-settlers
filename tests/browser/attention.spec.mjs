import { test, expect } from './helpers/test.mjs';
import { openAtlas, expectMapFocus } from './helpers/atlas.mjs';
test.setTimeout(120000);
function logErrors(page) {
  page.on('pageerror', (error) => console.log('Browser error:', error.message));
}
async function shortage(page) {
  return page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    let placed = false;
    for (let y = hq.y - 6; y <= hq.y + 6 && !placed; y++)
      for (let x = hq.x - 6; x <= hq.x + 6 && !placed; x++)
        if (game.canPlace('sawmill', x, y)[0]) placed = game.placeBuilding('sawmill', x, y);
    if (!placed) throw Error('No valid sawmill site');
    for (let i = 0; i < 9000; i++) game.step(1 / 60);
    game.hudTick();
    const issue = game.activeAttention().find((issue) => issue.entity.type === 'sawmill');
    if (!issue) throw Error('Actual sawmill did not mature a missing-log issue');
    return issue;
  });
}
test('Attention shows an actual shortage, pure drilldowns and live keyboard state; Activity survives saves and removal', async ({
  page,
}) => {
  logErrors(page);
  const issue = await shortage(page);
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="attention"]').click();
  await expect(page.getByRole('region', { name: 'Attention window', exact: true })).toBeVisible();
  await expect(page.locator('#attention-list')).toContainText('Missing accessible supply');
  await page.locator(`#attention-list [data-attention-issue="${issue.entity.id}"]`).click();
  await expect(page.locator('#attention-detail h2').first()).toBeFocused();
  await expect(page.locator('#attention-detail')).toContainText('No reachable available stored');
  await page.locator('#attention-detail [data-attention-reference]').click();
  await expect(page.locator('#reference-search')).toBeFocused();
  await expect(page.locator('#reference-topic')).toHaveValue('diagnosis');
  await expect(page.locator('#reference-results')).toContainText(
    'Diagnose a shortage or stalled chain',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#attention-detail [data-attention-reference]')).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const camera = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await page.locator('#attention-detail [data-attention-inspect]').first().click();
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(camera);
  const summary = page.locator('#attention-detail summary').first();
  await summary.focus();
  const opened = await summary.locator('..').evaluate((element) => element.open);
  if (!opened) await summary.click();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    for (let i = 0; i < 60; i++) game.step(1 / 60);
    game.hudTick();
  });
  await expect(summary).toBeFocused();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  await page.locator('#attention-query').fill('sawmill');
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      const game = window.productionArtPreview.game;
      game.activeAttention();
      game.activityHistory();
      game.updateAttentionView();
    }
  });
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  await expect(page.locator('#attention-query')).toBeFocused();
  await page.locator('#attention-detail [data-attention-good="logs"]').click();
  await expect(page.locator('#workspace-economy')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(camera);
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="attention"]').click();
  await expect(page.locator('#attention-query')).toHaveValue('sawmill');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('#workspace-attention').evaluate((el) => {
      el.scrollTop = 0;
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.locator('#attention-detail [data-attention-locate]').first().click();
  await expectMapFocus(page);
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const b = game.selected;
    game.demolish(b);
    game.hudTick();
    const entry = game.saveCheckpoint('attention history');
    game.loadCheckpoint(entry.id);
    game.hudTick();
  });
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="activity"]').click();
  await expect(page.getByRole('region', { name: 'Activity window', exact: true })).toBeVisible();
  await expect(page.locator('#activity-list')).toContainText('Sawmill: demolished');
  await expect(page.locator('#activity-list')).toContainText(
    'issue closed because the building was demolished',
  );
  await expect(page.locator('#activity-list')).toContainText('former location');
  await page.locator('#activity-query').fill('Sawmill');
  await page.locator('#activity-window').selectOption('600');
  const removed = page.locator('#activity-list [data-attention-inspect]').first();
  await removed.click();
  await expect(page.locator('#activity-contributor')).toContainText('Contributor removed');
  await removed.focus();
  await page.evaluate(() => {
    const query = document.getElementById('activity-query');
    query.value = 'no matching event';
    query.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#activity-heading')).toBeFocused();
  await page.locator('#activity-query').fill('Sawmill');
  const noMove = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="attention"]').click();
  await expect(page.locator('#attention-list')).not.toContainText('Missing accessible supply');
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="activity"]').click();
  await expect(page.locator('#activity-query')).toHaveValue('Sawmill');
  await expect(page.locator('#activity-window')).toHaveValue('600');
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(noMove);
  await page.locator('#activity-contributor [data-attention-locate]').click();
  await expectMapFocus(page);
});
test('production pause suppresses a persisted issue while globally paused and urgent storage recovery remains accessible', async ({
  page,
}) => {
  logErrors(page);
  const issue = await shortage(page);
  await page.evaluate((id) => {
    const game = window.productionArtPreview.game;
    game.state.paused = true;
    game.inspectContributor(id);
    game.hudTick();
  }, issue.entity.id);
  await openAtlas(page);
  await page.locator('#workspace-nav [data-workspace="attention"]').click();
  await expect(page.locator('#attention-list')).toContainText('Missing accessible supply');
  await page.locator('[data-production]').click();
  await expect(page.locator('#attention-status')).toContainText('0 persistent bottlenecks');
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw Error('quota failure');
    };
    game.saveGame();
    Storage.prototype.setItem = original;
    game.hudTick();
    // hudTick refreshes at most every 250 ms; the Attention view need not wait for it.
    game.updateAttentionView();
  });
  await expect(page.locator('#attention-list')).toContainText(
    'Urgent · Browser storage unavailable',
  );
  await page.locator('#attention-list [data-attention-save]').click();
  await expect(page.locator('#savedata')).toBeVisible();
  await expect(page.locator('#savedata')).toContainText('Export');
});

test('collapsed Atlas counts current issues and urgent evidence, with immediate paused recovery and a keyboard route', async ({
  page,
}) => {
  logErrors(page);
  const toggle = page.locator('#atlas-toggle');
  const badge = page.locator('#atlas-attention-count');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(badge).toHaveText('0');
  const issue = await shortage(page);
  await page.evaluate(() => window.productionArtPreview.game.updateAttentionView());
  await expect(badge).toHaveText('1');
  await expect(toggle).toHaveAccessibleName(/1 active Attention issue/);
  await expect(toggle).toHaveAccessibleDescription(/choose Attention/);
  await page.evaluate((id) => {
    const g = window.productionArtPreview.game;
    g.state.paused = true;
    g.inspectContributor(id);
    g.hudTick();
  }, issue.entity.id);
  const time = await page.evaluate(() => window.productionArtPreview.game.state.time);
  await page.locator('[data-production]').click();
  await expect(badge).toHaveText('0');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBe(time);
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.msg('Ordinary feedback is not a new Attention issue');
    g.updateAttentionView();
  });
  await expect(badge).toHaveText('0');
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw Error('quota failure');
    };
    g.saveGame();
    Storage.prototype.setItem = original;
    g.updateAttentionView();
    g.hudTick();
    g.setMode('road');
  });
  await expect(badge).toHaveText('1');
  await expect(page.locator('#save-recovery')).toBeVisible();
  const save = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await toggle.press('Enter');
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.type)).toBe('road');
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(save);
  await expect(badge).toBeHidden();
  await page.locator('#workspace-nav [data-workspace="attention"]').press('Enter');
  await expect(page.locator('#attention-list')).toContainText(
    'Urgent · Browser storage unavailable',
  );
  await page.getByRole('button', { name: 'Close Attention window', exact: true }).press('Enter');
  await toggle.press('Enter');
  await expect(badge).toHaveText('1');
  await expect(badge).toBeVisible();
  await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.saveGame();
    g.updateAttentionView();
  });
  await expect(badge).toHaveText('0');
});

test('crowded muted notices stay below the bar, clear of palette and map controls, and keep evidence links and timing', async ({
  page,
}) => {
  logErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const issue = await shortage(page);
  await page.evaluate(
    (id) => window.productionArtPreview.game.inspectContributor(id),
    issue.entity.id,
  );
  await page.locator('#paletteb').press('Enter');
  await page.evaluate((entity) => {
    const g = window.productionArtPreview.game;
    window.__noticeTime = 100000;
    performance.now = () => window.__noticeTime;
    g.setMuted(true);
    g.msgs.splice(0);
    for (let i = 0; i < 8; i++)
      g.msg(`Notice ${i + 1}: colony feedback remains readable while sound is muted.`, {
        workspace: 'attention',
        entity,
      });
    g.hudTick();
  }, issue.entity);
  const feed = page.locator('#msgs');
  await expect(feed.locator(':scope > div')).toHaveCount(8);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.resize();
      g.draw();
    });
    const box = await feed.boundingBox(),
      bar = await page.locator('#bar').boundingBox(),
      palette = await page.locator('#palette').boundingBox(),
      modes = await page.locator('#map-modes').boundingBox(),
      minimap = await page.locator('#mini').boundingBox(),
      inspectorClose = await page.locator('#ic').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    const overlaps = (a, b) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlaps(box, palette)).toBe(false);
    expect(overlaps(box, modes)).toBe(false);
    expect(overlaps(box, minimap)).toBe(false);
    expect(overlaps(box, inspectorClose)).toBe(false);
  }
  const cam = await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }));
  await feed.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => ({ ...window.productionArtPreview.game.cam }))).toEqual(cam);
  await feed.locator('.message-context').first().press('Enter');
  await expect(page.locator('#attention-detail h2').first()).toBeFocused();
  await expect(page.locator('#attention-detail')).toContainText('No reachable available stored');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      g.resize();
      g.draw();
    });
    const close = page.getByRole('button', { name: 'Close Attention window', exact: true });
    await expect(close).toBeInViewport();
    expect(
      await close.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    ).toBe(true);
  }

  await page.getByRole('button', { name: 'Close Attention window', exact: true }).press('Enter');
  await page.evaluate(() => window.productionArtPreview.game.setMode('road'));
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await feed
    .locator(':scope > div')
    .first()
    .click({ position: { x: 5, y: 5 } });
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  expect(await page.evaluate(() => window.productionArtPreview.game.anchor)).toBeNull();
  expect(await page.evaluate(() => window.productionArtPreview.game.mode.type)).toBe('road');
  for (const [now, opacity, count] of [
    [105000, '1', 8],
    [106000, '0.5', 8],
    [107000, null, 0],
  ]) {
    await page.evaluate((now) => {
      window.__noticeTime = now;
      window.productionArtPreview.game.hudTick();
    }, now);
    await expect(feed.locator(':scope > div')).toHaveCount(count);
    if (opacity)
      expect(
        await feed
          .locator(':scope > div')
          .first()
          .evaluate((el) => el.style.opacity),
      ).toBe(opacity);
  }
  // The shared page keeps the browser clock for later tests.
  await page.evaluate(() => delete performance.now);
});

test('Attention and Activity retain independent window context and recover focus when paused current evidence disappears', async ({
  page,
}) => {
  logErrors(page);
  const issue = await shortage(page);
  await openAtlas(page);
  await page.locator('[data-workspace="attention"]').press('Enter');
  const attention = page.getByRole('region', { name: 'Attention window', exact: true });
  const activity = page.getByRole('region', { name: 'Activity window', exact: true });
  await page
    .getByRole('button', { name: 'Resize Attention window', exact: true })
    .press('Shift+ArrowLeft');
  await page
    .getByRole('button', { name: 'Resize Attention window', exact: true })
    .press('Shift+ArrowUp');
  await page.getByRole('button', { name: 'Move Attention window', exact: true }).press('ArrowDown');
  const attentionBox = await attention.boundingBox();
  await page.locator('#attention-query').fill('sawmill');
  await page.locator('#attention-severity').selectOption('bottleneck');
  await page.locator(`#attention-list [data-attention-issue="${issue.entity.id}"]`).click();
  const summary = page.locator('#attention-detail summary').first();
  await summary.click();
  await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  await page.locator('#workspace-attention').evaluate((el) => {
    el.scrollTop = 120;
  });
  const attentionScroll = await page.locator('#workspace-attention').evaluate((el) => el.scrollTop);
  expect(attentionScroll).toBeGreaterThan(0);
  await page.locator('[data-workspace="activity"]').press('Enter');
  await expect(attention).toBeHidden();
  await expect(activity).toBeVisible();
  await page
    .getByRole('button', { name: 'Resize Activity window', exact: true })
    .press('Shift+ArrowLeft');
  await page
    .getByRole('button', { name: 'Resize Activity window', exact: true })
    .press('Shift+ArrowLeft');
  for (let i = 0; i < 4; i++)
    await page
      .getByRole('button', { name: 'Resize Activity window', exact: true })
      .press('Shift+ArrowUp');
  const activityBox = await activity.boundingBox();
  expect(activityBox.width).not.toBe(attentionBox.width);
  await page.locator('#activity-query').fill('sawmill');
  await page.locator('#activity-severity').selectOption('bottleneck');
  await page.locator('#activity-window').selectOption('600');
  await page.locator('#activity-query').focus();
  await page.locator('#workspace-activity').evaluate((el) => {
    el.scrollTop = 80;
  });
  const activityScroll = await page.locator('#workspace-activity').evaluate((el) => el.scrollTop);
  expect(activityScroll).toBeGreaterThan(0);
  const saved = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.locator('[data-workspace="economy"]').press('Enter');
  await expect(activity).toBeHidden();
  await page.locator('[data-workspace="attention"]').press('Enter');
  await expect(summary).toBeFocused();
  await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  await expect(page.locator('#attention-query')).toHaveValue('sawmill');
  await expect(page.locator('#attention-severity')).toHaveValue('bottleneck');
  expect(await attention.boundingBox()).toEqual(attentionBox);
  expect(await page.locator('#workspace-attention').evaluate((el) => el.scrollTop)).toBe(
    attentionScroll,
  );
  await page.locator('[data-workspace="activity"]').press('Enter');
  await expect(page.locator('#activity-query')).toBeFocused();
  await expect(page.locator('#activity-query')).toHaveValue('sawmill');
  await expect(page.locator('#activity-severity')).toHaveValue('bottleneck');
  await expect(page.locator('#activity-window')).toHaveValue('600');
  expect(await activity.boundingBox()).toEqual(activityBox);
  expect(await page.locator('#workspace-activity').evaluate((el) => el.scrollTop)).toBe(
    activityScroll,
  );
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(saved);
  await page.getByRole('button', { name: 'Close Activity window', exact: true }).press('Enter');
  await page.locator('[data-workspace="activity"]').press('Enter');
  expect(await activity.boundingBox()).toEqual(activityBox);
  await expect(page.locator('#activity-query')).toBeFocused();
  await page.locator('[data-workspace="attention"]').press('Enter');
  await page.locator(`#attention-list [data-attention-issue="${issue.entity.id}"]`).focus();
  await page.evaluate((id) => {
    const g = window.productionArtPreview.game;
    g.state.paused = true;
    g.byId(id).disabled = true;
    // A current query must see an edited producer without advancing time or relying on an event.
    g.updateAttentionView();
  }, issue.entity.id);
  await expect(page.locator('#attention-heading')).toBeFocused();
  await expect(page.locator('#attention-status')).toContainText('0 persistent bottlenecks');
  await expect(page.locator('#atlas-attention-count')).toHaveText('0');
  await expect(page.locator('#attention-detail')).toContainText('no longer active');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
