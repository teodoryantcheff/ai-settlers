// Each case either reads the welcome screen, loses its WebGL context or removes page
// controls, so none can share a page.
import { test, expect, frame, holdFrames, load, seedPrefs } from './helpers/test.mjs';
test.setTimeout(90000);
const stateLine = (page, root) =>
  page.locator(root).getByRole('status', { name: 'Simulation state' });
async function menu(page) {
  if (!(await page.locator('#utility').evaluate((node) => node.open)))
    await page.locator('#utility summary').click();
}
test('blocking screens show readable remembered simulation settings without changing the colony', async ({
  freshPage: page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await holdFrames(page);
  await seedPrefs(page, { quality: 0.75, reducedMotion: true, weather: false, muted: true });
  await load(page);
  await frame(page, 1000);
  await expect(stateLine(page, '#start')).toContainText('Simulation suspended');
  await expect(stateLine(page, '#start')).toContainText('1× selected');
  await expect(stateLine(page, '#start')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('welcome-readable-state-1280.png') });
  await page.locator('#startb').click();
  await frame(page, 1100);
  const before = await page.evaluate(() => window.productionArtPreview.game.exportSave());
  await menu(page);
  await page.locator('#mixb').click();
  await expect(page.locator('#speedpref')).toBeFocused();
  await expect(stateLine(page, '#mix')).toContainText('Player setting: running');
  await page.locator('#settings-help').click();
  await frame(page, 1200);
  await expect(stateLine(page, '#help')).toContainText('Player setting: running');
  await expect(stateLine(page, '#help')).toBeInViewport();
  expect(await page.evaluate(() => window.productionArtPreview.game.exportSave())).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-help')).toBeFocused();
  await page.locator('#speedpref').focus();
  await page.locator('#speedpref').selectOption('4');
  await frame(page, 1300);
  await expect(page.locator('#speedpref')).toBeFocused();
  await expect(stateLine(page, '#mix')).toContainText('4× selected');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(false);
  await page.screenshot({ path: test.info().outputPath('settings-readable-state-1280.png') });
  await page.keyboard.press('Escape');
  await frame(page, 1400);
  expect(await page.evaluate(() => window.productionArtPreview.game.state.time)).toBeGreaterThan(
    JSON.parse(before).st.time,
  );
  await page.locator('#sp0').click();
  await menu(page);
  await page.locator('#mixb').click();
  await expect(stateLine(page, '#mix')).toContainText('Player setting: manually paused');
  await page.locator('#speedpref').selectOption('2');
  await frame(page, 1500);
  await expect(stateLine(page, '#mix')).toContainText('2× selected');
  await page.locator('#settings-help').click();
  await frame(page, 1600);
  await expect(stateLine(page, '#help')).toContainText('Player setting: manually paused');
  await page.keyboard.press('Escape');
  await expect(stateLine(page, '#mix')).toContainText('Player setting: manually paused');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(true);
  await page.locator('#sp2').click();
  await menu(page);
  await page.locator('#mixb').click();
  await expect(stateLine(page, '#mix')).toContainText('Player setting: running');
  const age = await page.evaluate(() => window.productionArtPreview.game.state.time);
  const supported = await page.locator('#pixi-view').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.productionArtPreview.game.renderingAvailable))
    .toBe(false);
  await frame(page, 1700);
  await page.evaluate(() => window.productionArtPreview.game.blockingLayerOpen());
  await expect(stateLine(page, '#mix')).toContainText('Graphics unavailable');
  await expect(stateLine(page, '#mix')).not.toContainText('Simulation suspended');
  await expect(stateLine(page, '#mix')).toContainText('Export to protect progress');
  await expect(stateLine(page, '#mix')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('graphics-unavailable-state-1280.png') });
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => ({
      paused: window.productionArtPreview.game.state.paused,
      age: window.productionArtPreview.game.state.time,
    })),
  ).toEqual({ paused: true, age });
  expect(errors).toEqual([]);
});

test('dismissal restores a usable parent control when the invoker disappears or is disabled', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page, { quality: 0.75, reducedMotion: true });
  await load(page);
  await page.locator('#startb').click();
  await menu(page);
  await page.locator('#mixb').click();
  await page.locator('#settings-help').click();
  await page.locator('#settings-help').evaluate((button) => (button.disabled = true));
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
  await expect(page.locator('#speedpref')).toBeFocused();
  await page.locator('#settings-help').evaluate((button) => (button.disabled = false));
  await page.locator('#settings-help').click();
  await page.locator('#settings-help').evaluate((button) => button.remove());
  await page.keyboard.press('Escape');
  await expect(page.locator('#speedpref')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#utility summary')).toBeFocused();
});

test('graphics reload review dismisses independently and restores focus to its recovery root', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page, { quality: 0.75, reducedMotion: true });
  await load(page);
  await page.locator('#startb').click();
  await page.locator('#pixi-view').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await expect(page.locator('#renderer-status')).toBeVisible();
  await page.locator('#recovery-reload').click();
  await expect(page.locator('#recovery-reload-confirmation')).toBeVisible();
  await expect(page.locator('#recovery-cancel-reload')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#recovery-confirm-reload')).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('nested-recovery-review.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#recovery-reload-confirmation')).toBeHidden();
  await expect(page.locator('#recovery-reload')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#renderer-status')).toBeVisible();
  expect(await page.evaluate(() => window.productionArtPreview.game.blockingLayerOpen())).toBe(
    true,
  );
});
