import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as base, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../../..');
const directory = process.env.SETTLERS_BROWSER_COVERAGE;

/** Preferences of the standard boot: native rendering without motion or weather. */
export const STANDARD_PREFS = { quality: 0.75, reducedMotion: true, weather: false };

/**
 * Hold animation frames: the game loop's callback waits in `window.__frame` until a
 * test runs it with `frame(page, ms)`, so draws and simulation never follow the
 * browser's schedule. Install before the page loads.
 */
export function holdFrames(page) {
  return page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => {
      window.__frame = callback;
      return 0;
    };
  });
}

/** Run one held animation frame at timestamp `ms`. */
export function frame(page, ms = 1000) {
  return page.evaluate((ms) => window.__frame(ms), ms);
}

/** Seed preferences before boot, unless the page already remembers its own. */
export function seedPrefs(page, prefs = STANDARD_PREFS) {
  return page.addInitScript((prefs) => {
    if (localStorage.getItem('settlers.prefs') === null)
      localStorage.setItem('settlers.prefs', JSON.stringify(prefs));
  }, prefs);
}

/** Load the game page and wait for the booted colony, without starting it. */
export async function load(page, url = '/tests/game.html?seed=2024') {
  await page.goto(url);
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30000 });
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
}

/** The standard boot every shared page starts from: seed 2024, started, HUD current. */
export async function bootStandard(page) {
  await holdFrames(page);
  await seedPrefs(page);
  await load(page);
  await frame(page);
  await page.locator('#startb').click();
  await page.evaluate(() => window.productionArtPreview.game.hudTick());
}

function writeCoverage(entries, name) {
  const result = [];
  for (const entry of entries) {
    const file = new URL(entry.url).pathname.replace(/^\//, '');
    if (!/^game\.(?:min|test)\.js$/.test(file)) continue;
    result.push({
      scriptId: entry.scriptId,
      url: pathToFileURL(path.join(root, file)).href,
      functions: entry.functions,
    });
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, `coverage-browser-${name}.json`),
    JSON.stringify({ result }),
  );
}

/** Browser state outside the game that a test may change on the shared page. */
async function resetBrowser(page, use) {
  page.removeAllListeners('pageerror');
  page.removeAllListeners('console');
  page.removeAllListeners('dialog');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.emulateMedia({ reducedMotion: null, colorScheme: null });
  await page.setViewportSize(use.viewport);
}

/**
 * Shared Playwright entry point. `page` is one standard-booted page per worker: the
 * dev hook `resetForTest()` returns it to its booted state before each test, then
 * a fingerprint (time, entities, open panels, camera, preferences, storage) must
 * match the one taken after boot, or the test fails before it starts. A failed
 * test restarts the worker, so the next test boots afresh. `freshPage` is a new
 * unbooted page for tests that need their own pre-boot setup.
 *
 * With SETTLERS_BROWSER_COVERAGE set, pages record V8 block coverage of the game
 * bundles and write it in NODE_V8_COVERAGE format, rewritten to on-disk file URLs
 * so c8 maps it back to `src/` through the bundles' source maps and merges it with
 * Node coverage. The shared page writes once per worker, a fresh page per test.
 */
export const test = base.extend({
  shared: [
    async ({ browser }, use, workerInfo) => {
      const options = workerInfo.project.use;
      const context = await browser.newContext({
        baseURL: options.baseURL,
        viewport: options.viewport,
      });
      const page = await context.newPage();
      if (directory) await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await bootStandard(page);
      await page.evaluate(() => (window.__sharedBoot = true));
      const baseline = await page.evaluate(() => window.productionArtPreview.resetForTest());
      await use({ page, baseline, viewport: options.viewport });
      if (directory)
        writeCoverage(await page.coverage.stopJSCoverage(), `${workerInfo.workerIndex}-shared`);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ shared }, use) => {
    const { page, baseline } = shared;
    await resetBrowser(page, shared);
    const state = await page.evaluate(() => window.productionArtPreview.resetForTest());
    expect(state, 'shared page did not return to its booted state after the previous test').toEqual(
      baseline,
    );
    await use(page);
    if (!(await page.evaluate(() => window.__sharedBoot === true)))
      throw new Error('This test navigated the shared page; use the freshPage fixture instead');
  },
  freshPage: async ({ context }, use, testInfo) => {
    const page = await context.newPage();
    if (!directory) return use(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    writeCoverage(
      await page.coverage.stopJSCoverage(),
      `${testInfo.workerIndex}-${testInfo.testId}`,
    );
  },
});

export { expect };
