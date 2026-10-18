import assert from 'node:assert/strict';
import { launchOptions, resolveProfile, startVerifiedBrowser } from './render-profile.mjs';

// Run against a local Pages preview or a deployed URL, never development scenarios.
// SETTLERS_RENDER_PROFILE selects the WebGL configuration (scripts/render-profile.mjs).
const base = process.argv[2] || 'http://127.0.0.1:8788/';
const profile = resolveProfile();
const { browser, evidence } = await startVerifiedBrowser(
  profile,
  launchOptions(profile, { args: ['--disable-accelerated-2d-canvas'] }),
);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  const sheets = new Map();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const match = new URL(response.url()).pathname.match(/\/assets\/art\/(.+\.png)$/);
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
  const script = await page.locator('script[src]').last().getAttribute('src');
  assert.match(script, /^releases\/[a-f0-9]{16}\/game\.min\.js$/);
  const manifest = await page.request.get(
    new URL('assets/art/manifest.json', new URL(script, base)).href,
  );
  assert.equal(manifest.status(), 200);
  const activeFiles = Object.values((await manifest.json()).sheets);
  assert.equal(activeFiles.length, 35);
  assert.deepEqual(
    Object.fromEntries(sheets),
    Object.fromEntries(activeFiles.map((file) => [file, 200])),
  );
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
  await page.locator('#checkpoint-name').fill('Production smoke checkpoint');
  await page.locator('#create-checkpoint').click();
  const checkpoint = page
    .locator('.save-entry')
    .filter({ has: page.getByText('Production smoke checkpoint', { exact: true }) });
  await checkpoint.waitFor({ state: 'visible' });
  const saved = await page.evaluate(() => localStorage.getItem('settlers.saves'));
  assert.ok(saved);
  const entry = JSON.parse(saved).entries.find(
    (entry) => entry.name === 'Production smoke checkpoint',
  );
  assert.equal(entry.kind, 'manual');
  assert.equal(entry.data.seed, 2024);
  await page.locator('#colony-name').fill('Unsaved smoke colony');
  await page.locator('#colony-name').press('Tab');
  await checkpoint.getByRole('button', { name: 'Load', exact: true }).click();
  await page.locator('#confirm-save-action').click();
  await page.locator('#savedata').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => localStorage.getItem('settlers.saves')), saved);
  await page.locator('#utility summary').click();
  await page.locator('#saveb').click();
  assert.equal(await page.locator('#colony-name').inputValue(), entry.data.identity.name);
  await page.locator('#close-saves').click();
  if (process.env.PAGES_SCREENSHOT) await page.screenshot({ path: process.env.PAGES_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log(
    `Pages smoke check passed: ${base} (WebGL, artwork, headers, 404s, save/load) ` +
      `on ${evidence.mode} profile "${evidence.profile}": ${evidence.actualRenderer}.`,
  );
} finally {
  await browser.close();
}
