import { defineConfig } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT || 8765);
export default defineConfig({
  testDir: './tests/browser',
  // Software WebGL is load-sensitive; callers may explicitly override --workers.
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
  },
  timeout: 30000,
});
