import { test, expect, frame, holdFrames, seedPrefs, load } from './helpers/test.mjs';

test.setTimeout(90000);
// The welcome screen before any colony starts, at full quality with motion.
async function boot(page) {
  await holdFrames(page);
  await seedPrefs(page, { quality: 1, reducedMotion: false, muted: true, weather: false });
  await load(page);
  await frame(page);
}
async function readableField(field) {
  const contrast = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color) => {
      const channels = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          const channel = n / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color),
      background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

test('utility fields stay readable and preserve editing through nested checkpoint review', async ({
  freshPage: page,
}) => {
  await boot(page);
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    expect((await page.locator('#welcome-heading').boundingBox()).height).toBeLessThanOrEqual(36);
    await page.locator('#start .panel').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: test.info().outputPath(`welcome-${width}.png`) });
  }
  await page.locator('#load-colonyb').click();
  await expect(page.locator('#save-list')).toContainText('No checkpoints');
  await page.locator('#savecode').fill('A colony file can be pasted here');
  await readableField(page.locator('#savecode'));
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#savecode').focus();
    await page.screenshot({ path: test.info().outputPath(`empty-saves-${width}.png`) });
    await expect(page.locator('#savecode')).toHaveValue('A colony file can be pasted here');
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#load-colonyb')).toBeFocused();
  await page.locator('#startb').click();
  await page.locator('#utility summary').click();
  await page.locator('#saveb').click();
  await page.locator('#checkpoint-name').fill('First settlement');
  await readableField(page.locator('#checkpoint-name'));
  await page.locator('#create-checkpoint').click();
  await page.locator('.save-entry').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.locator('#rename-checkpoint').fill('Before expansion');
  await readableField(page.locator('#rename-checkpoint'));
  await page.keyboard.press('Escape');
  await expect(page.locator('#save-confirm')).toBeHidden();
  await expect(page.locator('#checkpoint-name')).toHaveValue('First settlement');
});
