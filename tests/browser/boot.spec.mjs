import { test, expect } from './helpers/test.mjs';

for (const missing of ['goaltxt', 'boot-stage']) {
  test(
    'missing #' + missing + ' shows an accessible boot failure before graphics starts',
    async ({ page }) => {
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
