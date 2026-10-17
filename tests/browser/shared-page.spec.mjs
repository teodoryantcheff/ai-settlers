import { test, expect, frame } from './helpers/test.mjs';

// Both tests share one worker page, in order: the second sees what reset left.
test.describe.configure({ mode: 'serial' });

let booted;

test('a test may change colony, interface, camera, preferences and storage', async ({ page }) => {
  booted = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await page.evaluate(() => {
    const game = window.productionArtPreview.game,
      hq = game.anyStorage();
    let placed = false;
    for (let y = hq.y - 6; y <= hq.y + 6 && !placed; y++)
      for (let x = hq.x - 6; x <= hq.x + 6 && !placed; x++)
        if (game.canPlace('lumberjack', x, y)[0]) placed = game.placeBuilding('lumberjack', x, y);
    if (!placed) throw new Error('No lumberjack site');
    for (let i = 0; i < 300; i++) game.step(1 / 60);
    game.selected = game.buildings.at(-1);
    game.state.speed = 4;
    game.zi = 5;
    game.z = game.zooms[5];
    game.cam.x += 300;
    game.presentationPrefs.weather = true;
    game.setMuted(true);
    game.saveCheckpoint('Leftover');
    localStorage.setItem('leftover', '1');
  });
  await frame(page, 2000);
  await page.locator('#utility summary').click();
  await page.locator('#savepanelb').click();
  await expect(page.locator('#savedata')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
});

test('the next test starts from the booted colony and interface', async ({ page }) => {
  const state = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    return {
      save: game.exportSave(),
      saves: game.listSaves().length,
      selected: game.selected,
      speed: game.state.speed,
      weather: game.presentationPrefs.weather,
      muted: game.muted,
      leftover: localStorage.getItem('leftover'),
      view: [innerWidth, innerHeight],
    };
  });
  expect(state).toEqual({
    save: booted,
    saves: 0,
    selected: null,
    speed: 1,
    weather: false,
    muted: false,
    leftover: null,
    view: [1440, 900],
  });
  await expect(page.locator('#savedata')).toBeHidden();
  await expect(page.locator('#utility')).not.toHaveAttribute('open', '');
});
