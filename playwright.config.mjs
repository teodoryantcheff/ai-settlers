import { defineConfig } from '@playwright/test';
import { launchOptions, resolveProfile } from './scripts/render-profile.mjs';
const port = Number(process.env.PLAYWRIGHT_PORT || 8765);
export default defineConfig({
  testDir: './tests/browser',
  // Each worker is a Chromium sharing the GPU; keep cores free for its renderer.
  workers: 3,
  // SETTLERS_RENDER_PROFILE chooses the WebGL configuration (scripts/render-profile.mjs);
  // global setup verifies Chromium's actual renderer before any test runs.
  globalSetup: './tests/browser/helpers/rendering.mjs',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: launchOptions(resolveProfile()),
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
  },
  timeout: 30000,
});
