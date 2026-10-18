import { defineConfig } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT || 8765);
export default defineConfig({
  testDir: './tests/browser',
  // Each worker is a Chromium sharing the GPU; keep cores free for its renderer.
  workers: 3,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      // The machine's real GPU through ANGLE, as players run the game. Chromium
      // falls back to SwiftShader where no GPU is available.
      args: [
        '--headless=new',
        '--enable-gpu',
        '--ignore-gpu-blocklist',
        '--use-angle=gl',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
  },
  timeout: 30000,
});
