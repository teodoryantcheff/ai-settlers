import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as base, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../../..');
const directory = process.env.SETTLERS_BROWSER_COVERAGE;

/**
 * Shared Playwright entry point. With SETTLERS_BROWSER_COVERAGE set, every page
 * records V8 block coverage of the game bundles and writes it in NODE_V8_COVERAGE
 * format, rewritten to on-disk file URLs so c8 maps it back to `src/` through
 * the bundles' source maps and merges it with Node coverage.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (!directory) return use(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    const entries = await page.coverage.stopJSCoverage();
    const result = [];
    for (const entry of entries) {
      const name = new URL(entry.url).pathname.replace(/^\//, '');
      if (!/^game\.(?:min|test)\.js$/.test(name)) continue;
      result.push({
        scriptId: entry.scriptId,
        url: pathToFileURL(path.join(root, name)).href,
        functions: entry.functions,
      });
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `coverage-browser-${testInfo.workerIndex}-${testInfo.testId}.json`),
      JSON.stringify({ result }),
    );
  },
});

export { expect };
