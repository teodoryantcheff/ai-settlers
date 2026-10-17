import { test, expect } from './helpers/test.mjs';

for (const missing of ['goaltxt', 'boot-stage']) {
  test(
    'missing #' + missing + ' shows an accessible boot failure before graphics starts',
    async ({ freshPage: page }) => {
      await page.route('**/tests/game.html?seed=2024', async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        expect(html).toContain('id="' + missing + '"');
        await route.fulfill({
          response,
          body: html.replace('id="' + missing + '"', 'id="removed-' + missing + '"'),
        });
      });
      await page.goto('/tests/game.html?seed=2024');
      const alert = page.locator(missing === 'boot-stage' ? '#boot-failure' : '#boot');
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert).toContainText('Missing required page element #' + missing);
      await expect(alert.getByRole('button', { name: 'Reload page' })).toBeVisible();
      expect(await page.evaluate(() => window.productionRendererStats)).toBeUndefined();
      await page.screenshot({ path: test.info().outputPath('missing-' + missing + '.png') });
    },
  );
}

test('manifest crops match a full alpha scan of the browser-decoded sheets', async ({
  freshPage: page,
}) => {
  await page.goto('/tests/game.html?seed=2024');
  await page.waitForFunction(() => window.productionArtPreview?.scanPaintedCrop);
  const scan = await page.evaluate(async () => {
    const { paintedRegions, scanPaintedCrop } = window.productionArtPreview;
    const base = new URL('../assets/art/', location.href);
    const manifest = await (await fetch(new URL('manifest.json', base))).json();
    const pixels = new Map();
    async function sheet(name) {
      if (!pixels.has(name)) {
        const image = new Image();
        image.src = new URL(manifest.sheets[name], base).href;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        pixels.set(name, context.getImageData(0, 0, canvas.width, canvas.height));
      }
      return pixels.get(name);
    }
    const regions = [...paintedRegions(manifest)];
    const mismatches = [];
    for (const [name, region] of regions) {
      const scanned = scanPaintedCrop(await sheet(region.sheet), region);
      if (JSON.stringify(scanned) !== JSON.stringify(region.crop))
        mismatches.push({ name, manifest: region.crop, scanned });
    }
    return { regions: regions.length, mismatches };
  });
  // Stale crops mean the pack changed without `npm run crop:art`.
  expect(scan).toEqual({ regions: 34, mismatches: [] });
});
