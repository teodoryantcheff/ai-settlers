import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Run against a local Pages preview or a deployed URL, never development scenarios.
const base = process.argv[2] || 'http://127.0.0.1:8788/';
const browser = await chromium.launch({
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-accelerated-2d-canvas',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  const sheets = new Map();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const match = response.url().match(/\/assets\/art\/(buildings|foliage|meadow)\.png$/);
    if (match) sheets.set(match[1], response.status());
  });
  await page.addInitScript(() => {
    localStorage.setItem('settlers.prefs', JSON.stringify({ reducedMotion: true, quality: 0.75 }));
  });
  const response = await page.goto(new URL('?seed=2024', base).href);
  assert.equal(response.status(), 200);
  const headers = response.headers();
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['cache-control'], 'no-cache');
  assert.equal(headers['x-robots-tag'], 'noindex');
  await page.waitForFunction(
    () => !document.querySelector('#boot') && window.productionRendererStats?.nativeSprites > 0,
  );
  assert.equal(await page.evaluate(() => window.productionRendererStats.backend), 'PixiJS WebGL');
  assert.equal(await page.locator('#painted-art-status').count(), 0);
  assert.deepEqual(Object.fromEntries(sheets), { buildings: 200, foliage: 200, meadow: 200 });
  const script = await page.locator('script[src]').last().getAttribute('src');
  assert.match(script, /^releases\/[a-f0-9]{16}\/game\.min\.js$/);
  const bundle = await page.request.get(new URL(script, base).href);
  assert.equal(bundle.status(), 200);
  assert.equal(bundle.headers()['cache-control'], 'public, max-age=31536000, immutable');
  for (const missing of ['tests/game.html', 'src/main.ts', 'game.test.js', 'missing-page']) {
    assert.equal((await page.request.get(new URL(missing, base).href)).status(), 404);
  }
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click({ force: true });
  await page.locator('#start').waitFor({ state: 'hidden' });
  await page.locator('#sp0').click();
  await page.locator('#utility summary').click();
  await page.locator('#saveb').click();
  const saved = await page.evaluate(() => localStorage.getItem('settlers.save'));
  assert.ok(saved);
  await page.locator('#loadb').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('settlers.save')), saved);
  await page.locator('#utility summary').click();
  if (process.env.PAGES_SCREENSHOT) await page.screenshot({ path: process.env.PAGES_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log(`Pages smoke check passed: ${base} (WebGL, artwork, headers, 404s, save/load).`);
} finally {
  await browser.close();
}
