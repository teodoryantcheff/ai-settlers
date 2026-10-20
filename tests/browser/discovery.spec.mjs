import { test, expect, frame, holdFrames, load, seedPrefs } from './helpers/test.mjs';

test.setTimeout(60000);

test('exploration choice starts off, stays with the colony, and conceals terrain on the real WebGL map', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page);
  await load(page);
  await frame(page);
  await expect(page.locator('#new-colony-fog')).not.toBeChecked();
  await page.locator('#new-colony-fog').check();
  await page.locator('#new-colony-seed').fill('42');
  await page.locator('#startb').click();
  await frame(page, 1100);
  const initial = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.paused = true;
    g.drawMini();
    g.draw();
    const mini = document.getElementById('mini').getContext('2d');
    g.selectMapTarget(null, { x: 10, y: 10 });
    return {
      enabled: g.state.explorationFog,
      hidden: g.isRevealed(g.idx(10, 10)),
      known: g.isRevealed(g.idx(48, 48)),
      color: Array.from(mini.getImageData(20, 20, 1, 1).data),
      description: document.getElementById('infobody').textContent,
      saved: g.exportSave(),
      camera: { ...g.cam },
    };
  });
  expect(initial.enabled).toBe(true);
  expect(initial.hidden).toBe(false);
  expect(initial.known).toBe(true);
  expect(initial.color).toEqual([68, 76, 72, 255]);
  expect(initial.description).toContain('Unexplored land');
  const result = await page.evaluate((save) => {
    const g = window.productionArtPreview.game;
    for (const quality of [1, 0.75]) {
      g.presentationPrefs.quality = quality;
      g.presentationPrefs.reducedMotion = true;
      g.resize();
      g.draw();
    }
    g.cam.x += 100;
    g.cam.y += 50;
    g.draw();
    const camera = { ...g.cam };
    g.importSave(save);
    g.draw();
    return {
      camera,
      after: { ...g.cam },
      enabled: g.state.explorationFog,
      hidden: g.isRevealed(g.idx(10, 10)),
      failure: document.getElementById('renderer-status').classList.contains('show'),
    };
  }, initial.saved);
  expect(result.enabled).toBe(true);
  expect(result.hidden).toBe(false);
  expect(result.after).toEqual(initial.camera);
  expect(result.failure).toBe(false);
});

test('settlers over unexplored land stay visible and inspectable without revealing their route', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.resetColony(42, 'Walkers', true);
    const before = Array.from(g.revealed);
    const u = g.units[0];
    u.x = 65;
    u.y = 48;
    g.cam.x = 60 * g.TS;
    g.cam.y = 43 * g.TS;
    g.draw();
    g.selectMapTarget(null, { x: 65, y: 48 });
    return {
      before,
      after: Array.from(g.revealed),
      info: document.getElementById('infobody').textContent,
      id: u.id,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.info).toContain(`carrier #${result.id}`);
  expect(result.info).toContain('Unexplored land');
});
