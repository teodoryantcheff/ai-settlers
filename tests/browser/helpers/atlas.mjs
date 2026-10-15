import { expect } from '@playwright/test';

/** Open navigation only when the next user action needs an Atlas destination. */
export async function openAtlas(page) {
  const toggle = page.locator('#atlas-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#workspace-nav')).toBeVisible();
}

/** Locate returns keyboard navigation to a visible map destination. */
export async function expectMapFocus(page) {
  const expanded = await page.locator('#atlas-toggle').getAttribute('aria-expanded');
  const destination =
    expanded === 'true'
      ? page.locator('#workspace-nav [data-workspace="map"]')
      : page.locator('#atlas-toggle');
  await expect(destination).toBeVisible();
  await expect(destination).toBeFocused();
}
