import { resolveProfile, startVerifiedBrowser } from '../../../scripts/render-profile.mjs';

/**
 * Playwright global setup: before any test, launch Chromium exactly as the workers
 * will and verify its actual renderer against the selected profile, printing both.
 */
export default async function verifyRendering(config) {
  const { browser } = await startVerifiedBrowser(
    resolveProfile(),
    config.projects[0].use.launchOptions,
  );
  await browser.close();
}
